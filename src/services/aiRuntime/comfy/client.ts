// ============================================================================
// ComfyUI — the legacy HTTP + WebSocket transport
// ============================================================================
//
// Every documented route this needs exists in ComfyUI's own server.py and has
// for years, which is why it is the transport that works against a manual
// checkout, a portable build and ComfyUI Desktop alike, with nothing extra
// installed:
//
//   POST /prompt           {prompt, client_id} → {prompt_id}
//   GET  /ws?clientId=     progress / executing / execution_error
//   GET  /history/{id}     outputs → filenames
//   GET  /view?filename=…  the bytes
//   POST /upload/image     references and masks
//   GET  /object_info      installed node classes and model folders
//   GET  /system_stats     VRAM
//   POST /interrupt        cancel what is running
//   POST /queue {delete}   cancel what is only queued
//
// Transport is injected rather than imported so this file stays free of
// Electron and of the DOM: the adapter passes `net.fetch` and a real
// WebSocket, the tests pass a fake server. A v2 transport slots in by
// implementing the same small surface.

import type { AiErrorCode } from '../types';
import { indexObjectInfo, type ComfyObjectInfo } from './objectInfo';
import type { ComfyGraph } from './types';

export class ComfyError extends Error {
  code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = 'ComfyError';
    this.code = code;
  }
}

export interface ComfyRequestInit {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}

export type ComfyFetch = (url: string, init?: ComfyRequestInit) => Promise<Response>;

export interface ComfySocketHandlers {
  onMessage: (data: string) => void;
  onClose: () => void;
}

export interface ComfySocket {
  close: () => void;
}

export type ComfySocketFactory = (url: string, handlers: ComfySocketHandlers) => ComfySocket | null;

export interface ComfyProgress {
  /** 0..1 across the whole submission, as far as the server has said. */
  fraction: number;
  value: number;
  max: number;
  /** The node currently running, for a label. */
  node: string | null;
}

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

export interface ComfyHistoryEntry {
  outputs: Record<string, { images?: ComfyImageRef[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown };
}

export interface ComfyUploadResult {
  name: string;
  subfolder: string;
  type: string;
}

export interface ComfySystemStats {
  ramTotal: number;
  ramFree: number;
  version?: string;
  devices: Array<{ name: string; vramTotal: number; vramFree: number }>;
}

export interface ComfyClientOptions {
  baseUrl: string;
  clientId: string;
  fetch: ComfyFetch;
  openSocket?: ComfySocketFactory;
  /** How often /history is asked when nothing wakes us. */
  pollIntervalMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Wakes a pending wait early — the WebSocket's whole job. The wake LATCHES:
 * "the queue item finished" routinely arrives while the poll it should shorten
 * is still in flight, and an edge-triggered waker would drop it and sit out a
 * whole poll interval for nothing.
 */
function createWaker(): { wake: () => void; wait: (ms: number, sleep: ComfyClientOptions['sleep'], signal?: AbortSignal) => Promise<void> } {
  let pending: (() => void) | null = null;
  let signalled = false;
  return {
    wake(): void {
      signalled = true;
      const resolve = pending;
      pending = null;
      resolve?.();
    },
    wait(ms, sleep, signal): Promise<void> {
      if (signalled) {
        signalled = false;
        return Promise.resolve();
      }
      const timed = (sleep ?? defaultSleep)(ms, signal);
      const woken = new Promise<void>((resolve) => {
        pending = resolve;
      });
      return Promise.race([timed, woken]).then(() => {
        signalled = false;
      });
    },
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // 8 KB at a time: String.fromCharCode with a whole multi-megabyte image
  // spread into the arguments blows the call stack.
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export type MultipartPart =
  | { name: string; value: string }
  | { name: string; fileName: string; contentType: string; bytes: Uint8Array };

/**
 * /upload/image is the one route that is not JSON. The body is built by hand
 * rather than with FormData so it does not depend on which fetch
 * implementation the adapter injected.
 */
export function multipartBody(parts: readonly MultipartPart[], boundary: string): { contentType: string; body: Uint8Array } {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    if ('value' in part) {
      chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
      continue;
    }
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.fileName}"\r\n` +
          `Content-Type: ${part.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(part.bytes);
    chunks.push(encoder.encode('\r\n'));
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { contentType: `multipart/form-data; boundary=${boundary}`, body };
}

export function webSocketUrl(baseUrl: string, clientId: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const ws = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${ws}/ws?clientId=${encodeURIComponent(clientId)}`;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Both progress shapes ComfyUI has shipped, reduced to one fraction. */
export function readProgressEvent(type: string, data: unknown): ComfyProgress | null {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  if (!record) return null;
  if (type === 'progress') {
    const value = readNumber(record.value);
    const max = readNumber(record.max);
    return { value, max, fraction: max > 0 ? Math.min(1, value / max) : 0, node: typeof record.node === 'string' ? record.node : null };
  }
  if (type === 'progress_state') {
    const nodes = record.nodes && typeof record.nodes === 'object' ? (record.nodes as Record<string, unknown>) : {};
    let value = 0;
    let max = 0;
    let running: string | null = null;
    for (const [id, raw] of Object.entries(nodes)) {
      const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      if (!entry) continue;
      value += readNumber(entry.value);
      max += readNumber(entry.max);
      if (entry.state === 'running') running = id;
    }
    return { value, max, fraction: max > 0 ? Math.min(1, value / max) : 0, node: running };
  }
  return null;
}

export interface ComfyClient {
  objectInfo(signal?: AbortSignal): Promise<ComfyObjectInfo>;
  systemStats(signal?: AbortSignal): Promise<ComfySystemStats>;
  uploadImage(input: { bytes: Uint8Array; fileName: string; contentType: string; subfolder?: string; signal?: AbortSignal }): Promise<ComfyUploadResult>;
  submit(graph: ComfyGraph, signal?: AbortSignal): Promise<string>;
  history(promptId: string, signal?: AbortSignal): Promise<ComfyHistoryEntry | null>;
  view(ref: ComfyImageRef, signal?: AbortSignal): Promise<Uint8Array>;
  cancel(promptId: string): Promise<void>;
  awaitResult(
    promptId: string,
    options: { signal?: AbortSignal; onProgress?: (progress: ComfyProgress) => void; timeoutMs?: number },
  ): Promise<ComfyHistoryEntry>;
}

export function createComfyClient(options: ComfyClientOptions): ComfyClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());
  const pollIntervalMs = options.pollIntervalMs ?? 1000;

  const call = async (path: string, init: ComfyRequestInit = {}): Promise<Response> => {
    let res: Response;
    try {
      res = await options.fetch(`${base}${path}`, init);
    } catch (err) {
      if (init.signal?.aborted) throw new ComfyError('cancelled', 'Cancelled.');
      throw new ComfyError('unreachable', `Could not reach ComfyUI at ${base}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return res;
  };

  const json = async <T>(path: string, init: ComfyRequestInit = {}): Promise<T> => {
    const res = await call(path, init);
    const text = await readBoundedText(res, MAX_JSON_BYTES);
    if (!res.ok) throw httpError(res.status, path, text);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ComfyError('bad-response', `ComfyUI answered ${path} with something that is not JSON.`);
    }
  };

  const historyOf = async (promptId: string, signal?: AbortSignal): Promise<ComfyHistoryEntry | null> => {
    const raw = await json<Record<string, unknown>>(`/history/${encodeURIComponent(promptId)}`, { signal });
    const entry = raw[promptId];
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const outputs: ComfyHistoryEntry['outputs'] = {};
    const rawOutputs = record.outputs && typeof record.outputs === 'object' ? (record.outputs as Record<string, unknown>) : {};
    for (const [nodeId, value] of Object.entries(rawOutputs)) {
      const images = (value as { images?: unknown })?.images;
      if (!Array.isArray(images)) continue;
      outputs[nodeId] = {
        images: images
          .filter((image): image is Record<string, unknown> => Boolean(image) && typeof image === 'object')
          .map((image) => ({
            filename: typeof image.filename === 'string' ? image.filename : '',
            subfolder: typeof image.subfolder === 'string' ? image.subfolder : '',
            type: typeof image.type === 'string' ? image.type : 'output',
          }))
          .filter((image) => image.filename),
      };
    }
    const status = record.status && typeof record.status === 'object' ? (record.status as ComfyHistoryEntry['status']) : undefined;
    return { outputs, ...(status ? { status } : {}) };
  };

  return {
    async objectInfo(signal) {
      return indexObjectInfo(await json<unknown>('/object_info', { signal }));
    },

    async systemStats(signal) {
      const raw = await json<Record<string, unknown>>('/system_stats', { signal });
      const system = (raw.system && typeof raw.system === 'object' ? raw.system : {}) as Record<string, unknown>;
      const devices = Array.isArray(raw.devices) ? raw.devices : [];
      return {
        ramTotal: readNumber(system.ram_total),
        ramFree: readNumber(system.ram_free),
        ...(typeof system.comfyui_version === 'string' ? { version: system.comfyui_version } : {}),
        devices: devices.map((device) => {
          const entry = (device && typeof device === 'object' ? device : {}) as Record<string, unknown>;
          return {
            name: typeof entry.name === 'string' ? entry.name : 'device',
            vramTotal: readNumber(entry.vram_total),
            vramFree: readNumber(entry.vram_free),
          };
        }),
      };
    },

    async uploadImage({ bytes, fileName, contentType, subfolder, signal }) {
      const boundary = `writershoard${now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
      const { contentType: bodyType, body } = multipartBody(
        [
          { name: 'image', fileName, contentType, bytes },
          { name: 'type', value: 'input' },
          { name: 'subfolder', value: subfolder ?? 'writers-hoard' },
          // Overwriting keeps the input folder from growing a copy per run and,
          // more importantly, keeps the file NAME stable — a new name on every
          // submission changes a node input and throws away ComfyUI's cache.
          { name: 'overwrite', value: 'true' },
        ],
        boundary,
      );
      const res = await call('/upload/image', { method: 'POST', headers: { 'Content-Type': bodyType }, body, signal });
      const text = await readBoundedText(res, 1 << 20);
      if (!res.ok) throw httpError(res.status, '/upload/image', text);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ComfyError('bad-response', 'ComfyUI did not answer the upload with JSON.');
      }
      const name = typeof parsed.name === 'string' ? parsed.name : null;
      if (!name) throw new ComfyError('bad-response', 'ComfyUI accepted the upload without naming the file.');
      const folder = typeof parsed.subfolder === 'string' ? parsed.subfolder : '';
      return {
        name,
        subfolder: folder,
        type: typeof parsed.type === 'string' ? parsed.type : 'input',
      };
    },

    async submit(graph, signal) {
      const res = await call('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: options.clientId }),
        signal,
      });
      const text = await readBoundedText(res, 4 << 20);
      if (!res.ok) throw promptRejection(res.status, text);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ComfyError('bad-response', 'ComfyUI did not answer /prompt with JSON.');
      }
      const id = parsed.prompt_id;
      if (typeof id !== 'string' || !id) throw new ComfyError('bad-response', 'ComfyUI accepted the prompt without returning an id.');
      return id;
    },

    history: historyOf,

    async view(ref, signal) {
      const query = `filename=${encodeURIComponent(ref.filename)}&subfolder=${encodeURIComponent(ref.subfolder)}&type=${encodeURIComponent(ref.type)}`;
      const res = await call(`/view?${query}`, { signal });
      if (!res.ok) throw httpError(res.status, '/view', await readBoundedText(res, 4096));
      return new Uint8Array(await readBounded(res, MAX_IMAGE_BYTES));
    },

    async cancel(promptId) {
      // Two calls because a submission can be in either of two places: running
      // (interrupt) or still queued behind another one (delete). Sending only
      // the first leaves a cancelled job to start a minute later.
      try {
        await call('/interrupt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt_id: promptId }),
        });
      } catch {
        // the server may already be gone; cancelling is best effort
      }
      try {
        await call('/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete: [promptId] }),
        });
      } catch {
        // same
      }
    },

    async awaitResult(promptId, { signal, onProgress, timeoutMs }) {
      const deadline = now() + (timeoutMs ?? 20 * 60_000);
      const waker = createWaker();
      let socketFailure: string | null = null;
      const socket = options.openSocket?.(webSocketUrl(base, options.clientId), {
        onMessage(data) {
          const parsed = safeParse(data);
          if (!parsed) return;
          const { type, data: payload } = parsed;
          const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
          // Events for another client's submission must not end ours.
          if (typeof record.prompt_id === 'string' && record.prompt_id !== promptId) return;
          const progress = readProgressEvent(type, payload);
          if (progress && onProgress) onProgress(progress);
          if (type === 'execution_error') {
            socketFailure = typeof record.exception_message === 'string' ? record.exception_message : 'ComfyUI failed to run the workflow.';
            waker.wake();
            return;
          }
          // `executing` with a null node is how ComfyUI has always said "queue
          // item finished"; `execution_success` is the newer event for the same
          // moment. Either one only wakes the poll: /history is the authority.
          if ((type === 'executing' && record.node === null) || type === 'execution_success') waker.wake();
        },
        onClose() {
          socketAlive = false;
        },
      }) ?? null;
      // A factory that declines (no WebSocket in this runtime) is the same
      // situation as a socket that dropped: poll, and do not wait on an event
      // that will never come.
      let socketAlive = Boolean(socket);

      try {
        for (;;) {
          if (signal?.aborted) throw new ComfyError('cancelled', 'Cancelled.');
          const entry = await historyOf(promptId, signal);
          if (entry) {
            if (entry.status?.status_str === 'error') {
              throw new ComfyError('server-error', socketFailure ?? 'ComfyUI failed to run the workflow.');
            }
            return entry;
          }
          if (socketFailure) throw new ComfyError('server-error', socketFailure);
          if (now() > deadline) throw new ComfyError('timeout', 'ComfyUI did not finish the image in time.');
          // A dropped socket is not a failed generation: fall back to the poll
          // interval and keep asking /history until the deadline.
          await waker.wait(socketAlive ? pollIntervalMs : Math.min(pollIntervalMs, 1000), sleep, signal);
        }
      } finally {
        socket?.close();
      }
    },
  };
}

function safeParse(data: string): { type: string; data: unknown } | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; data?: unknown };
    if (typeof parsed.type !== 'string') return null;
    return { type: parsed.type, data: parsed.data };
  } catch {
    return null;
  }
}

async function readBounded(res: Response, limit: number): Promise<ArrayBuffer> {
  // Checking the declared length first means a wrong address that answers with
  // something enormous is refused before it is in memory, not after.
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    throw new ComfyError('bad-response', `ComfyUI answered with more than ${Math.round(limit / 1e6)} MB.`);
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > limit) throw new ComfyError('bad-response', `ComfyUI answered with more than ${Math.round(limit / 1e6)} MB.`);
  return buffer;
}

async function readBoundedText(res: Response, limit: number): Promise<string> {
  return new TextDecoder().decode(await readBounded(res, limit));
}

function httpError(status: number, path: string, body: string): ComfyError {
  if (status === 401 || status === 403) return new ComfyError('unauthorized', `ComfyUI refused the request to ${path} (HTTP ${status}).`);
  if (status === 404) return new ComfyError('bad-request', `ComfyUI has no ${path} route (HTTP 404). Check the address in AI settings.`);
  return new ComfyError('server-error', `ComfyUI answered ${path} with HTTP ${status}: ${body.slice(0, 200)}`);
}

/**
 * A rejected /prompt is the failure mode that matters most: it is what a
 * template with a bad node or an uninstalled model produces, and ComfyUI
 * reports it per node. Naming the node and the reason turns a wall of JSON
 * into something a user can act on.
 */
function promptRejection(status: number, body: string): ComfyError {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const error = parsed?.error && typeof parsed.error === 'object' ? (parsed.error as Record<string, unknown>) : null;
  const head = typeof error?.message === 'string' ? error.message : `ComfyUI rejected the workflow (HTTP ${status}).`;
  const nodeErrors = parsed?.node_errors && typeof parsed.node_errors === 'object' ? (parsed.node_errors as Record<string, unknown>) : {};
  const details: string[] = [];
  for (const [nodeId, value] of Object.entries(nodeErrors)) {
    const entry = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    const errors = Array.isArray(entry?.errors) ? entry.errors : [];
    for (const item of errors) {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
      const message = typeof record?.message === 'string' ? record.message : 'rejected';
      const detail = typeof record?.details === 'string' && record.details ? ` (${record.details})` : '';
      details.push(`node ${nodeId}: ${message}${detail}`);
    }
  }
  const suffix = details.length ? ` — ${details.slice(0, 3).join('; ')}` : '';
  return new ComfyError('bad-request', `${head}${suffix}`);
}
