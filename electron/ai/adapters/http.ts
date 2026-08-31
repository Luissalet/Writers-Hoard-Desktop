// ============================================================================
// AI adapters — shared HTTP plumbing (main process)
// ============================================================================
//
// Every provider call goes through here: one place that adds the bearer
// header, applies connect/read timeouts, bounds response bodies, maps HTTP
// failures onto the gateway's error codes and never lets a secret into an
// error message. Streaming responses are read line by line, which serves both
// SSE (`data: …`) and NDJSON (one JSON object per line).

import { net } from 'electron';
import type { AiErrorCode } from '@/services/aiRuntime/types';

export class AdapterError extends Error {
  code: AiErrorCode;
  status?: number;

  constructor(code: AiErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.status = status;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  secret?: string | null;
  signal?: AbortSignal;
  /** Time allowed for headers to arrive. */
  connectTimeoutMs?: number;
  /** Largest non-streamed body accepted. */
  maxBodyBytes?: number;
  headers?: Record<string, string>;
}

const DEFAULT_CONNECT_MS = 15_000;
const DEFAULT_MAX_BODY = 8 * 1024 * 1024;

export function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const live = signals.filter((s): s is AbortSignal => Boolean(s));
  if (live.length === 1) return live[0];
  const controller = new AbortController();
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export function redact(text: string, secret: string | null | undefined): string {
  if (!secret || secret.length < 6) return text;
  return text.split(secret).join('[redacted]');
}

/** Map a non-2xx response onto a gateway code, reading the body for hints. */
export async function errorFromResponse(res: Response, secret?: string | null): Promise<AdapterError> {
  let text = '';
  try {
    text = (await res.text()).slice(0, 600);
  } catch {
    text = '';
  }
  const clean = redact(text, secret);
  if (res.status === 401 || res.status === 403) {
    return new AdapterError('unauthorized', `The server refused the credentials (HTTP ${res.status}).`, res.status);
  }
  if (res.status === 404) {
    if (/model|not found|no such/i.test(clean)) {
      return new AdapterError('model-missing', `The server does not have that model (HTTP 404): ${clean.slice(0, 200)}`, 404);
    }
    return new AdapterError('bad-request', `No such route on the server (HTTP 404): ${clean.slice(0, 200)}`, 404);
  }
  if (res.status === 400 || res.status === 422) {
    if (/tool|function/i.test(clean)) {
      return new AdapterError('tools-unsupported', `This model or server does not accept tools: ${clean.slice(0, 200)}`, res.status);
    }
    return new AdapterError('bad-request', `The server rejected the request (HTTP ${res.status}): ${clean.slice(0, 300)}`, res.status);
  }
  if (res.status === 429) {
    return new AdapterError('server-error', `The server is rate-limiting requests (HTTP 429). ${clean.slice(0, 200)}`, 429);
  }
  return new AdapterError('server-error', `The server answered HTTP ${res.status}: ${clean.slice(0, 300)}`, res.status);
}

export function errorFromException(err: unknown, signal?: AbortSignal, secret?: string | null): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = redact(err instanceof Error ? err.message : String(err), secret);
  if (signal?.aborted) {
    const reason = String((signal as AbortSignal & { reason?: unknown }).reason ?? '');
    return /timeout/i.test(reason) || /timeout/i.test(message)
      ? new AdapterError('timeout', 'The server took too long to answer.')
      : new AdapterError('cancelled', 'Cancelled.');
  }
  if (/timeout|timed out/i.test(message)) return new AdapterError('timeout', 'The server took too long to answer.');
  return new AdapterError('unreachable', `Could not reach the server: ${message}`);
}

export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.secret) headers.Authorization = `Bearer ${options.secret}`;
  const timeout = AbortSignal.timeout(options.connectTimeoutMs ?? DEFAULT_CONNECT_MS);
  const signal = combineSignals([options.signal, timeout]);
  try {
    const res = await net.fetch(url, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal,
      // A redirect to another origin could carry the bearer token elsewhere.
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) {
      throw new AdapterError('bad-request', `The server redirected (HTTP ${res.status}); point the connection at the final address.`, res.status);
    }
    return res;
  } catch (err) {
    throw errorFromException(err, options.signal?.aborted ? options.signal : timeout.aborted ? timeout : undefined, options.secret);
  }
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const res = await request(url, options);
  if (!res.ok) throw await errorFromResponse(res, options.secret);
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const text = await readBounded(res, limit);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdapterError('bad-response', `The server did not return JSON: ${redact(text.slice(0, 200), options.secret)}`);
  }
}

export async function readBounded(res: Response, limit: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AdapterError('bad-response', `The response exceeded ${Math.round(limit / 1e6)} MB.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Stream a response line by line. `idleTimeoutMs` bounds the silence between
 * two chunks (a stalled server), not the total duration — a long generation
 * is legitimately long.
 */
export async function streamLines(
  res: Response,
  onLine: (line: string) => void,
  options: { signal?: AbortSignal; idleTimeoutMs?: number } = {},
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const idle = options.idleTimeoutMs ?? 120_000;
  let buffer = '';
  const abort = () => void reader.cancel().catch(() => undefined);
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      let timer: NodeJS.Timeout | undefined;
      const idleGuard = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AdapterError('timeout', 'The server stopped sending data.')), idle);
      });
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), idleGuard]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.trim()) onLine(line);
        newline = buffer.indexOf('\n');
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) onLine(rest);
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}

export function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
