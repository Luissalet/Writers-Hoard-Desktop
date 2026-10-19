// Private stdio worker for the incorporated publishing engine. No HTTP listener,
// model loading, polling or process is created by importing this module.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { PUBLISHING_TOOLS } from '../../src/services/aiBridge/manifestPublishing';

export const PUBLISHING_MODULES = ['library', 'links', 'paperwork', 'publishing'] as const;
type PublishingModule = typeof PUBLISHING_MODULES[number];
export interface PublishingConfig {
  enabled: PublishingModule[];
  automatic: PublishingModule[];
  dataDir: string;
}
export interface PublishingResponse { status: number; type: string; base64: string; headers?: Record<string, string> }
interface WorkerMessage { id: number; ok: boolean; result?: unknown; error?: string }
interface StreamMessage extends WorkerMessage { event?: 'start' | 'chunk'; status?: number; headers?: Record<string, string>; base64?: string }
class OutcomeUnknown extends Error {
  readonly code = 'outcome_unknown';
  readonly outcome_unknown = true;
  readonly reconcile_action = 'read_current_state_before_retry';
  constructor(cause: Error) { super(`The write may have been applied. Read current state before retrying. ${cause.message}`); }
}
export interface PublishingOptions {
  configFile: string;
  dataDir: string;
  command: string;
  args: string[];
  cwd: string;
  nodeCommand?: string;
}

export class PublishingService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private workerPid: number | null = null;
  private workerReady = false;
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; sent?: boolean; mutation?: boolean }>();
  private streams = new Map<number, (message: StreamMessage) => void>();
  private streamOwners = new Map<number, string>();
  private config: PublishingConfig | null = null;
  private configLoading: Promise<PublishingConfig> | null = null;
  private controls: Promise<unknown> = Promise.resolve();
  constructor(private options: PublishingOptions) {}
  get running(): boolean { return this.child !== null; }

  private async readConfig(): Promise<PublishingConfig> {
    if (this.config) return this.config;
    return this.configLoading ??= (async () => {
      let saved: Partial<PublishingConfig> = {};
      try { saved = JSON.parse(await fs.readFile(this.options.configFile, 'utf8')); } catch { /* First run is OFF. */ }
      this.config = {
        enabled: Array.isArray(saved.enabled) ? saved.enabled.filter((item): item is PublishingModule => PUBLISHING_MODULES.includes(item)) : [],
        automatic: Array.isArray(saved.automatic) ? saved.automatic.filter((item): item is PublishingModule => PUBLISHING_MODULES.includes(item)) : [],
        dataDir: typeof saved.dataDir === 'string' && path.isAbsolute(saved.dataDir) ? saved.dataDir : this.options.dataDir,
      };
      return this.config;
    })();
  }

  async status() {
    const config = await this.readConfig();
    return { ...config, enabled: [...config.enabled], running: this.child !== null, pid: this.workerPid ?? this.child?.pid ?? null,
      modules: PUBLISHING_MODULES.map(id => ({ id, enabled: config.enabled.includes(id), automatic: config.automatic.includes(id) })) };
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async save(config: PublishingConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.options.configFile), { recursive: true });
    const temporary = this.options.configFile + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await fs.rename(temporary, this.options.configFile);
  }

  async setModule(module: string, enabled: boolean, dataDir?: string, automatic?: boolean) {
    if (!PUBLISHING_MODULES.includes(module as PublishingModule) || typeof enabled !== 'boolean') throw new Error('Unknown module or invalid enabled value.');
    const id = module as PublishingModule;
    const update = this.controls.then(async () => {
      const previous = await this.readConfig();
      const config = { ...previous, enabled: [...previous.enabled], automatic: [...previous.automatic] };
      if (dataDir !== undefined) {
        if (!path.isAbsolute(dataDir)) throw new Error('Data directory must be an absolute path.');
        if (config.enabled.length > 0 || this.child) throw new Error('Switch publishing OFF before choosing another data directory.');
        config.dataDir = path.resolve(dataDir);
      }
      config.enabled = config.enabled.filter(item => item !== id);
      if (enabled) config.enabled.push(id);
      if (automatic !== undefined) {
        if (typeof automatic !== 'boolean') throw new Error('automatic must be boolean');
        config.automatic = config.automatic.filter(item => item !== id);
        if (automatic) config.automatic.push(id);
      }
      // Persist OFF before waiting for an already-running request to finish.
      await this.save(config);
      this.config = config;
      try {
        await this.serial(async () => {
          if (enabled) await this.startWorker();
          if (!enabled) await this.cancelStreams(id);
          if (this.child) await this.rpc({ op: 'set', module: id, enabled, automatic: config.automatic.includes(id) });
          if (!config.enabled.length) await this.stopWorker();
        });
      } catch (error) {
        config.enabled = config.enabled.filter(item => item !== id);
        await this.save(config);
        this.config = config;
        if (!config.enabled.length) await this.serial(() => this.stopWorker());
        throw error;
      }
    });
    this.controls = update.catch(() => undefined);
    await update;
    return this.status();
  }

  private mutates(message: Record<string, unknown>): boolean {
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(message.method).toUpperCase())) return false;
    if (message.path === '/api/agent/call') {
      try {
        const payload = JSON.parse(Buffer.from(String(message.body), 'base64').toString('utf8'));
        return PUBLISHING_TOOLS.find(tool => tool.name === payload.name)?.writes !== false;
      } catch { return true; }
    }
    return !message.op;
  }

  private rpc(message: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('Publishing worker is not running.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      if (child.stdin.destroyed || child.stdin.writableEnded) { reject(new Error('Publishing worker input is closed.')); return; }
      const entry = { resolve, reject, sent: false, mutation: this.mutates(message) };
      this.pending.set(id, entry);
      entry.sent = true;
      child.stdin.write(JSON.stringify({ ...message, id }) + '\n', error => {
        if (error) { this.pending.delete(id); reject(entry.mutation ? new OutcomeUnknown(error) : error); }
      });
    });
  }

  private async startWorker(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HOARD_EVENTS: '0', WRITER_PUBLISHING_NODE: this.options.nodeCommand || process.execPath, ELECTRON_RUN_AS_NODE: '1' },
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message: WorkerMessage;
      try { message = JSON.parse(line); } catch { return; }
      this.streams.get(message.id)?.(message);
      if ((message as StreamMessage).event) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else {
        const error = new Error(message.error || 'Publishing request failed.');
        pending.reject(pending.sent && pending.mutation ? new OutcomeUnknown(error) : error);
      }
    });
    child.stderr.on('data', () => { /* Library diagnostics must not enter the MCP protocol. */ });
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      if (this.child === child) { this.child = null; this.workerPid = null; this.workerReady = false; }
      lines.close();
      for (const entry of this.pending.values()) entry.reject(entry.sent && entry.mutation ? new OutcomeUnknown(error) : error);
      this.pending.clear();
    };
    child.once('error', fail);
    child.stdin.on('error', fail);
    child.once('exit', (code) => fail(new Error(`Publishing worker exited (${code ?? 'signal'}).`)));
    try {
      const initialized = await this.rpc({ op: 'init', dataDir: (await this.readConfig()).dataDir }) as { pid: number };
      this.workerPid = initialized.pid;
      const config = await this.readConfig();
      for (const module of config.enabled) await this.rpc({ op: 'set', module, enabled: true, automatic: config.automatic.includes(module) });
      this.workerReady = true;
    }
    catch (error) {
      if (this.child === child) {
        const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
        child.stdin.end();
        await exited;
      }
      throw error;
    }
  }

  private async stopWorker(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.workerReady = false;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    await this.rpc({ op: 'shutdown' });
    child.stdin.end();
    await exited;
  }

  private async cancelStreams(module?: string): Promise<void> {
    if (!this.child) return;
    const ids = [...this.streamOwners].filter(([, owner]) => !module || owner === module).map(([id]) => id);
    await Promise.all(ids.map(target => this.rpc({ op: 'cancel', target })));
  }

  close(): Promise<void> { return this.serial(async () => { await this.cancelStreams(); await this.stopWorker(); }); }

  stream(method: string, apiPath: string, headers: Record<string, string> = {}): Promise<Response> {
    let resolveHeaders!: (response: Response) => void;
    let rejectHeaders!: (error: Error) => void;
    const response = new Promise<Response>((resolve, reject) => { resolveHeaders = resolve; rejectHeaders = reject; });
    void (async () => {
      const config = await this.readConfig();
      const module = apiPath.split('/')[1];
      if (!PUBLISHING_MODULES.includes(module as PublishingModule) || !config.enabled.includes(module as PublishingModule)) throw new Error('Module is OFF.');
      if (!this.workerReady) await this.serial(() => this.startWorker());
      const child = this.child!;
      const id = ++this.sequence;
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(value) { controller = value; },
        // Credits are per request: a slow file must never pause the shared stdout.
        pull() {
          if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(JSON.stringify({ op: 'flow', target: id }) + '\n');
        },
        cancel: () => { cancelled = true; return this.rpc({ op: 'cancel', target: id }).then(() => undefined); },
      });
      const complete = new Promise<{ cancelled?: boolean }>((resolve, reject) => {
        this.pending.set(id, { resolve: value => resolve(value as { cancelled?: boolean }), reject });
      });
      this.streams.set(id, message => {
        if (message.event === 'start') resolveHeaders(new Response(method === 'HEAD' || message.status === 204 || message.status === 304 ? null : body, { status: message.status, headers: message.headers }));
        else if (message.event === 'chunk' && !cancelled && message.base64) {
          controller!.enqueue(Buffer.from(message.base64, 'base64'));
        }
      });
      this.streamOwners.set(id, module);
      child.stdin.write(JSON.stringify({ id, op: 'stream', method, path: apiPath, headers }) + '\n');
      try {
        const result = await complete;
        if (!cancelled) {
          if (result?.cancelled) controller!.error(new Error('Publishing stream cancelled before completion.'));
          else controller!.close();
        }
      }
      catch (error) { if (!cancelled) controller!.error(error); throw error; }
      finally { this.streams.delete(id); this.streamOwners.delete(id); }
    })().catch(error => rejectHeaders(error instanceof Error ? error : new Error(String(error))));
    return response;
  }

  request(method: string, apiPath: string, body = '', headers: Record<string, string> = {}, base64 = false): Promise<PublishingResponse> {
    return (async () => {
      const config = await this.readConfig();
      const url = new URL(apiPath, 'http://127.0.0.1:5174');
      if (!apiPath.startsWith('/') || apiPath.startsWith('//') || url.origin !== 'http://127.0.0.1:5174') throw new Error('Expected a local module API path.');
      const module = url.pathname.split('/')[1];
      if (PUBLISHING_MODULES.includes(module as PublishingModule) && !config.enabled.includes(module as PublishingModule)) throw new Error(`${module} is OFF. Enable it explicitly in Writer.`);
      if (!config.enabled.length && module !== 'api') throw new Error('Publishing modules are OFF.');
      if (!this.workerReady) await this.serial(() => this.startWorker());
      return await this.rpc({ method, path: apiPath, body: base64 ? body : Buffer.from(body).toString('base64'), headers }) as PublishingResponse;
    })();
  }

  async tool(name: string, args: Record<string, unknown>) {
    try {
      if (name === 'wh_publishing_modules' || name === 'borges_modules') return { ok: true, result: await this.status() };
      if (name === 'wh_publishing_module_set' || name === 'borges_set_module') return { ok: true, result: await this.setModule(String(args.module), args.enabled as boolean, undefined, args.automatic as boolean | undefined) };
      const response = await this.request('POST', '/api/agent/call', JSON.stringify({ name, arguments: args }), { 'Content-Type': 'application/json' });
      const result = JSON.parse(Buffer.from(response.base64, 'base64').toString('utf8'));
      return response.status < 400 ? { ok: true, result } : { ok: false, code: result.error, error: result.message || result.detail || result.error };

    } catch (error) {
      if (error instanceof OutcomeUnknown) return { ok: false, code: error.code, status: error.code,
        outcome_unknown: true, reconcile_action: error.reconcile_action, error: error.message };
      return { ok: false, code: 'publishing-unavailable', error: error instanceof Error ? error.message : String(error) };
    }
  }
}

let service: PublishingService | null = null;
export function configurePublishing(options: PublishingOptions) { service = new PublishingService(options); }
export function publishingService(): PublishingService {
  if (!service) throw new Error('Publishing engine has not been configured.');
  return service;
}
export function isPublishingTool(name: string) { return PUBLISHING_TOOLS.some(tool => tool.name === name); }
export function closePublishing(): Promise<void> { return service?.close() ?? Promise.resolve(); }
export function isPublishingRunning(): boolean { return service?.running ?? false; }
