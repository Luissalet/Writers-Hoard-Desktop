// ============================================================================
// Writers Hoard — authenticated loopback media-downloader service
// ============================================================================

import { app } from 'electron';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import {
  detectPlatform,
  downloadMedia,
  SUPPORTED_PLATFORMS,
  type DownloadOutcome,
  type MediaFormat,
} from './ytdlp';
import { mediaDownloadQueue, type MediaDownloadQueue } from './downloadQueue';

const HOST = '127.0.0.1';
const PORT = Number(process.env.MEDIA_DOWNLOADER_PORT || 8765);
/** Same value main.ts loads the renderer from during development. */
const RENDERER_DEV_ORIGIN = new URL(
  process.env.ELECTRON_RENDERER_URL || 'http://localhost:5174',
).origin;

export const MEDIA_SERVER_URL = `http://${HOST}:${PORT}`;
export const MEDIA_AUTH_HEADER = 'X-Writers-Hoard-Media-Token';
const MEDIA_AUTH_HEADER_LOWER = MEDIA_AUTH_HEADER.toLowerCase();

type OperationalMethod = 'GET' | 'POST';

const API_ROUTES: Readonly<Record<string, OperationalMethod>> = Object.freeze({
  '/api/health': 'GET',
  '/api/detect': 'POST',
  '/api/download': 'POST',
});

type DownloadExecutor = (
  url: string,
  format: MediaFormat,
  signal: AbortSignal,
) => Promise<DownloadOutcome>;

export interface MediaRequestHandlerOptions {
  authToken: string;
  isPackaged: boolean;
  rendererDevOrigin: string;
  queue?: MediaDownloadQueue;
  download?: DownloadExecutor;
  controllers?: Set<AbortController>;
}

let server: http.Server | null = null;
let serverAuthToken: string | null = null;
/** Live and queued HTTP downloads, so shutdown cancels either state. */
const activeHttpDownloads = new Set<AbortController>();

export function createMediaServerToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Origin is only a second defence. file:// sends either no Origin or `null`,
 * both of which remain acceptable only because every operational route also
 * requires the unguessable per-start token.
 */
function isAllowedOrigin(
  origin: string | undefined,
  isPackaged: boolean,
  rendererDevOrigin: string,
): boolean {
  if (origin === undefined || origin === 'null') return true;
  return !isPackaged && origin === rendererDevOrigin;
}

function addVary(res: http.ServerResponse, values: readonly string[]): void {
  const current = res.getHeader('Vary');
  const parts = new Set(
    (typeof current === 'string' ? current.split(',') : [])
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const value of values) parts.add(value);
  res.setHeader('Vary', [...parts].join(', '));
}

function setCorsOrigin(res: http.ServerResponse, origin?: string): void {
  if (origin === undefined) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  addVary(res, ['Origin']);
}

function setDownloadExposeHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Filename');
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  origin?: string,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  if (res.destroyed || res.writableEnded) return;
  setCorsOrigin(res, origin);
  for (const [name, value] of Object.entries(extraHeaders ?? {})) res.setHeader(name, value);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function validToken(req: http.IncomingMessage, expectedToken: string): boolean {
  const supplied = req.headers[MEDIA_AUTH_HEADER_LOWER];
  if (typeof supplied !== 'string') return false;
  const expected = Buffer.from(expectedToken, 'utf8');
  const candidate = Buffer.from(supplied, 'utf8');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function requestedHeaderNames(raw: string | undefined): string[] | null {
  if (raw === undefined) return [];
  const names = raw.split(',').map((name) => name.trim().toLowerCase());
  if (names.some((name) => !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name))) return null;
  return [...new Set(names)].sort();
}

function expectedPreflightHeaders(method: OperationalMethod): string[] {
  return method === 'POST'
    ? ['content-type', MEDIA_AUTH_HEADER_LOWER].sort()
    : [MEDIA_AUTH_HEADER_LOWER];
}

function handlePreflight(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin: string | undefined,
): void {
  if (origin === undefined) {
    sendJson(res, 400, { error: 'invalid preflight' });
    return;
  }
  const routeMethod = API_ROUTES[req.url ?? ''];
  if (!routeMethod) {
    sendJson(res, 404, { error: 'not found' }, origin);
    return;
  }
  const requestedMethod = req.headers['access-control-request-method'];
  const requestedHeaders = requestedHeaderNames(req.headers['access-control-request-headers']);
  const expectedHeaders = expectedPreflightHeaders(routeMethod);
  if (
    requestedMethod !== routeMethod
    || requestedHeaders === null
    || requestedHeaders.length !== expectedHeaders.length
    || requestedHeaders.some((name, index) => name !== expectedHeaders[index])
  ) {
    sendJson(res, 403, { error: 'preflight denied' }, origin);
    return;
  }

  setCorsOrigin(res, origin);
  addVary(res, ['Access-Control-Request-Method', 'Access-Control-Request-Headers']);
  res.setHeader('Access-Control-Allow-Methods', routeMethod);
  res.setHeader(
    'Access-Control-Allow-Headers',
    routeMethod === 'POST'
      ? `Content-Type, ${MEDIA_AUTH_HEADER}`
      : MEDIA_AUTH_HEADER,
  );
  res.setHeader('Access-Control-Max-Age', '600');
  res.writeHead(204);
  res.end();
}

/**
 * Resolves the parsed body, or `null` when the caller must stop and write
 * nothing more: the payload was refused with a 413, or the client went away.
 */
function readJsonBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const settle = (body: Record<string, unknown> | null): void => {
      if (settled) return;
      settled = true;
      resolve(body);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      raw += chunk;
      if (raw.length > 1_000_000) {
        raw = '';
        settle(null);
        res.once('finish', () => req.destroy());
        sendJson(res, 413, { error: 'request body too large' }, origin);
      }
    });
    req.on('end', () => {
      try {
        settle(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        settle({});
      }
    });
    req.on('error', () => settle(null));
    req.on('aborted', () => settle(null));
    req.on('close', () => settle(null));
  });
}

export function createMediaRequestHandler(
  options: MediaRequestHandlerOptions,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  if (!options.authToken) throw new Error('media server auth token is required');
  const queue = options.queue ?? mediaDownloadQueue;
  const executeDownload = options.download ?? downloadMedia;
  const controllers = options.controllers ?? new Set<AbortController>();

  return async (req, res): Promise<void> => {
    const method = req.method ?? '';
    const requestUrl = req.url ?? '';
    const origin = req.headers.origin;

    if (!isAllowedOrigin(origin, options.isPackaged, options.rendererDevOrigin)) {
      sendJson(res, 403, { error: 'forbidden origin' });
      return;
    }

    if (method === 'OPTIONS') {
      handlePreflight(req, res, origin);
      return;
    }

    const isApiRequest = requestUrl === '/api' || requestUrl.startsWith('/api/');
    if (isApiRequest && !validToken(req, options.authToken)) {
      sendJson(res, 401, { error: 'unauthorized' }, origin);
      return;
    }

    const routeMethod = API_ROUTES[requestUrl];
    if (routeMethod && method !== routeMethod) {
      sendJson(res, 405, { error: 'method not allowed' }, origin, { Allow: routeMethod });
      return;
    }

    if (method === 'GET' && requestUrl === '/api/health') {
      sendJson(res, 200, { ok: true, platforms: SUPPORTED_PLATFORMS }, origin);
      return;
    }

    if (method === 'POST' && (requestUrl === '/api/detect' || requestUrl === '/api/download')) {
      const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== 'application/json') {
        sendJson(res, 415, { error: 'application/json required' }, origin);
        return;
      }
    }

    if (method === 'POST' && requestUrl === '/api/detect') {
      const body = await readJsonBody(req, res, origin);
      if (!body) return;
      const target = String(body.url ?? '').trim();
      if (!target) {
        sendJson(res, 400, { error: 'url is required' }, origin);
        return;
      }
      sendJson(res, 200, { platform: detectPlatform(target) }, origin);
      return;
    }

    if (method === 'POST' && requestUrl === '/api/download') {
      const body = await readJsonBody(req, res, origin);
      if (!body) return;
      const target = String(body.url ?? '').trim();
      const fmtRaw = String(body.format ?? 'video').toLowerCase();
      if (!target) {
        sendJson(res, 400, { error: 'url is required' }, origin);
        return;
      }
      if (!/^https?:\/\//i.test(target)) {
        sendJson(res, 400, { error: 'unsupported url' }, origin);
        return;
      }
      if (fmtRaw !== 'video' && fmtRaw !== 'audio') {
        sendJson(res, 400, { error: "format must be 'video' or 'audio'" }, origin);
        return;
      }

      const controller = new AbortController();
      controllers.add(controller);
      res.on('close', () => controller.abort());

      let outcome: DownloadOutcome;
      try {
        outcome = await queue.enqueue(
          (signal) => executeDownload(target, fmtRaw as MediaFormat, signal),
          controller.signal,
        );
      } catch (error) {
        if (!res.destroyed && !res.writableEnded) {
          const cancelled = controller.signal.aborted;
          sendJson(
            res,
            cancelled ? 499 : 500,
            { error: cancelled ? 'cancelled' : error instanceof Error ? error.message : String(error) },
            origin,
          );
        }
        return;
      } finally {
        controllers.delete(controller);
      }

      const { filePath, filename, sizeBytes, cleanup } = outcome;
      const encoded = encodeURIComponent(filename);
      const safeAscii = filename.replace(/["\\]/g, '').replace(/[^\x20-\x7E]/g, '_');

      setCorsOrigin(res, origin);
      setDownloadExposeHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(sizeBytes),
        'Content-Disposition': `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`,
        'X-Filename': encoded,
      });

      const stream = createReadStream(filePath);
      let cleaned = false;
      const finish = (): void => {
        if (cleaned) return;
        cleaned = true;
        void cleanup().catch(() => undefined);
      };
      stream.pipe(res);
      stream.on('error', () => {
        res.destroy();
        finish();
      });
      res.on('close', finish);
      stream.on('close', finish);
      return;
    }

    sendJson(res, 404, { error: 'not found' }, origin);
  };
}

export function startMediaServer(): Promise<void> {
  if (server) return Promise.resolve();
  serverAuthToken = createMediaServerToken();
  const handle = createMediaRequestHandler({
    authToken: serverAuthToken,
    isPackaged: app.isPackaged,
    rendererDevOrigin: RENDERER_DEV_ORIGIN,
    controllers: activeHttpDownloads,
  });

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      handle(req, res).catch((error) => {
        sendJson(
          res,
          500,
          { error: error instanceof Error ? error.message : 'internal error' },
        );
      });
    });
    server.on('error', (error) => {
      server = null;
      serverAuthToken = null;
      reject(error);
    });
    server.listen(PORT, HOST, () => {
      console.log(`[media] embedded downloader listening on ${MEDIA_SERVER_URL}`);
      resolve();
    });
  });
}

export function stopMediaServer(): void {
  for (const controller of activeHttpDownloads) controller.abort();
  activeHttpDownloads.clear();
  server?.close();
  server = null;
  serverAuthToken = null;
}
