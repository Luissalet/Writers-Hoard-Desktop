import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { NATIVE_DOCUMENT_ACTIONS } from '@/services/aiBridge/manifestDocuments';

export type DocumentToolResponse = {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
};

export type DocumentEngineConfiguration = {
  appPath?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
  executablePath?: string;
  executableArgs?: string[];
};

const actions = NATIVE_DOCUMENT_ACTIONS;

type PendingRequest = {
  resolve: (response: DocumentToolResponse) => void;
  timer: ReturnType<typeof setTimeout>;
  action: string;
  mediaLabel?: string;
};

type Engine = {
  child: ChildProcessWithoutNullStreams;
  pending: Map<number, PendingRequest>;
  closing?: DocumentToolResponse;
  closed: Promise<void>;
};

let configuration: DocumentEngineConfiguration = {};
let engine: Engine | undefined;
let nextRequestId = 1;

/** Configure once from Electron's app; the module also runs in plain Node QA. */
export function configureDocumentEngine(options: DocumentEngineConfiguration): void {
  if (engine) throw new Error('Stop the document engine before changing its configuration.');
  configuration = { ...options, executableArgs: options.executableArgs?.slice() };
}

export function isNativeDocumentTool(name: string): boolean {
  return Object.hasOwn(actions, name);
}

function failure(code: string, error: string): DocumentToolResponse {
  return { ok: false, code, error };
}

function resolveExecutable(): string {
  if (configuration.executablePath) return configuration.executablePath;
  if (process.env.WRITER_DOCUMENT_ENGINE_PATH) return process.env.WRITER_DOCUMENT_ENGINE_PATH;
  const binary = process.platform === 'win32' ? 'writer-document-engine.exe' : 'writer-document-engine';
  if (configuration.isPackaged) {
    const resourcesPath = configuration.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (!resourcesPath) throw new Error('The desktop resources directory is unavailable.');
    return path.join(resourcesPath, 'documents', binary);
  }
  return path.join(configuration.appPath ?? process.cwd(), 'native', 'bin', binary);
}

function settle(instance: Engine, id: number, response: DocumentToolResponse): void {
  const request = instance.pending.get(id);
  if (!request) return;
  clearTimeout(request.timer);
  instance.pending.delete(id);
  if (response.ok && request.action === 'document.renderPage' && response.result && typeof response.result === 'object') {
    const result = response.result as Record<string, unknown>;
    if (typeof result.dataBase64 === 'string' && typeof result.mimeType === 'string') {
      response = { ...response, result: { ...result, _media: [{ base64: result.dataBase64, mimeType: result.mimeType, label: request.mediaLabel }] } };
    }
  }
  request.resolve(response);
}

function terminate(instance: Engine, response: DocumentToolResponse): void {
  if (instance.closing) return;
  instance.closing = response;
  for (const request of instance.pending.values()) clearTimeout(request.timer);
  // Only this service's child is terminated. Calls settle after close, so a
  // timed-out mutation cannot still apply after its caller receives an error.
  instance.child.kill();
}

function startEngine(): Engine {
  const child = spawn(resolveExecutable(), configuration.executableArgs ?? [], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let signalClosed!: () => void;
  const instance: Engine = {
    child,
    pending: new Map(),
    closed: new Promise<void>(resolve => { signalClosed = resolve; }),
  };
  engine = instance;
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    if (instance.closing) return;
    buffer += decoder.write(chunk);
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      try {
        const response = JSON.parse(line) as {
          id?: number;
          ok?: boolean;
          result?: unknown;
          error?: { code?: string; message?: string };
        };
        if (typeof response.id !== 'number' || typeof response.ok !== 'boolean') {
          throw new Error('Invalid response envelope');
        }
        settle(instance, response.id, response.ok
          ? { ok: true, result: response.result }
          : failure(response.error?.code ?? 'DOCUMENT_ENGINE_ERROR', response.error?.message ?? 'The document operation failed.'));
      } catch {
        terminate(instance, failure('DOCUMENT_ENGINE_PROTOCOL', 'The document engine returned an invalid response; its in-memory sessions were closed.'));
        return;
      }
    }
  });
  // Consume diagnostics without retaining document contents or filling stderr.
  child.stderr.resume();
  child.on('error', error => {
    instance.closing ??= failure('DOCUMENT_ENGINE_UNAVAILABLE', `The document engine could not start: ${error.message}`);
  });
  child.stdin.on('error', () => {
    terminate(instance, failure('DOCUMENT_ENGINE_EXIT', 'The document engine connection closed; its in-memory sessions were lost.'));
  });
  child.on('close', (code, signal) => {
    const response = instance.closing ?? failure('DOCUMENT_ENGINE_EXIT', `The document engine exited (${signal ?? code ?? 'unknown'}); its in-memory sessions were lost.`);
    for (const id of instance.pending.keys()) settle(instance, id, response);
    if (engine === instance) engine = undefined;
    signalClosed();
  });
  return instance;
}

/** Stop this app's engine at shutdown, settling every outstanding operation. */
export async function stopDocumentEngine(): Promise<void> {
  const instance = engine;
  if (!instance) return;
  terminate(instance, failure('DOCUMENT_ENGINE_STOPPED', 'The document engine was stopped; its in-memory sessions were closed.'));
  await instance.closed;
}

export async function executeDocumentTool(
  tool: string,
  args: Record<string, unknown> = {},
  timeoutMs = 120_000,
): Promise<DocumentToolResponse> {
  if (!isNativeDocumentTool(tool)) return failure('DOCUMENT_TOOL_UNKNOWN', `Unknown document tool: ${tool}`);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return failure('DOCUMENT_TIMEOUT_INVALID', 'The operation timeout must be a positive number.');
  const id = nextRequestId++;
  let request: string;
  try {
    request = `${JSON.stringify({ id, action: actions[tool], args })}\n`;
  } catch {
    return failure('DOCUMENT_ARGUMENTS_INVALID', 'The document arguments could not be encoded as JSON.');
  }
  if (engine?.closing) await engine.closed;
  let instance: Engine;
  try {
    instance = engine ?? startEngine();
  } catch (error) {
    return failure('DOCUMENT_ENGINE_UNAVAILABLE', error instanceof Error ? error.message : String(error));
  }
  return new Promise<DocumentToolResponse>(resolve => {
    const timer = setTimeout(() => {
      terminate(instance, failure('DOCUMENT_ENGINE_TIMEOUT', 'The document operation timed out; the owned engine was stopped and its in-memory sessions were closed.'));
    }, timeoutMs);
    instance.pending.set(id, { resolve, timer, action: actions[tool], mediaLabel: tool === 'wh_document_render' ? `Document page ${args.page ?? 1}` : undefined });
    instance.child.stdin.write(request, 'utf8', error => {
      if (error) terminate(instance, failure('DOCUMENT_ENGINE_EXIT', 'The document engine connection closed; its in-memory sessions were lost.'));
    });
  });
}
