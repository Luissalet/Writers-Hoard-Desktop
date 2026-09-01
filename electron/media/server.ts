// ============================================================================
// Writers Hoard — embedded media-downloader HTTP service (main process)
// ============================================================================
//
// Implements the EXACT same JSON contract the renderer already speaks to the
// old Python/Flask server, so `src/services/mediaDownloader.ts` needs zero
// changes:
//
//   GET  /api/health              -> { ok, platforms }
//   POST /api/detect   {url}      -> { platform }
//   POST /api/download {url,format} -> streams the file (octet-stream) with
//                                      Content-Disposition: attachment
//
// Bound strictly to 127.0.0.1 (no firewall prompt, not reachable off-box).

import { app } from 'electron';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import {
  detectPlatform,
  downloadMedia,
  SUPPORTED_PLATFORMS,
  type MediaFormat,
} from './ytdlp';

const HOST = '127.0.0.1';
const PORT = Number(process.env.MEDIA_DOWNLOADER_PORT || 8765);
/** Same value main.ts loads the renderer from during development. */
const RENDERER_DEV_ORIGIN = new URL(
  process.env.ELECTRON_RENDERER_URL || 'http://localhost:5174',
).origin;

export const MEDIA_SERVER_URL = `http://${HOST}:${PORT}`;

let server: http.Server | null = null;
/** Live /api/download children, so quitting takes their yt-dlp/ffmpeg with it. */
const activeDownloads = new Set<AbortController>();

/**
 * Only our own renderer may use this server. It loads from file:// (Origin
 * absent or the literal "null") in production and from exactly one dev origin
 * otherwise. Trusting "any localhost port" let any local page — a dev server,
 * a notebook — POST arbitrary URLs here and read the bytes back cross-origin.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin || origin === 'null') return true; // file:// renderer / same-machine tools
  if (app.isPackaged) return false;
  try {
    return new URL(origin).origin === RENDERER_DEV_ORIGIN;
  } catch {
    return false;
  }
}

function setCors(res: http.ServerResponse, origin?: string): void {
  // Echo the validated origin; "null" covers the file:// renderer.
  res.setHeader('Access-Control-Allow-Origin', origin && origin !== 'null' ? origin : 'null');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Filename');
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, origin?: string): void {
  setCors(res, origin);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Resolves the parsed body, or `null` when the caller must stop and write
 * nothing more: the payload was refused with a 413, or the client went away.
 * It always settles — `req.destroy()` alone fires neither 'end' nor 'error'.
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
        raw = ''; // release the accumulated payload before unwinding
        settle(null);
        // Answer first, drop the connection once it has flushed: destroying
        // the request socket ahead of the write would swallow the 413.
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

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { method, url } = req;
  const origin = req.headers.origin;

  // Reject requests from real web origins outright (see isAllowedOrigin).
  if (!isAllowedOrigin(origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden origin' }));
    return;
  }

  if (method === 'OPTIONS') {
    setCors(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === 'GET' && url === '/api/health') {
    sendJson(res, 200, { ok: true, platforms: SUPPORTED_PLATFORMS }, origin);
    return;
  }

  if (method === 'POST' && url === '/api/detect') {
    const body = await readJsonBody(req, res, origin);
    if (!body) return; // already answered (413), or the client went away
    const target = String(body.url ?? '').trim();
    if (!target) {
      sendJson(res, 400, { error: 'url is required' }, origin);
      return;
    }
    sendJson(res, 200, { platform: detectPlatform(target) }, origin);
    return;
  }

  if (method === 'POST' && url === '/api/download') {
    const body = await readJsonBody(req, res, origin);
    if (!body) return; // already answered (413), or the client went away
    const target = String(body.url ?? '').trim();
    const fmtRaw = String(body.format ?? 'video').toLowerCase();
    if (!target) {
      sendJson(res, 400, { error: 'url is required' }, origin);
      return;
    }
    // Anything else would reach yt-dlp as an option, not as a URL.
    if (!/^https?:\/\//i.test(target)) {
      sendJson(res, 400, { error: 'unsupported url' }, origin);
      return;
    }
    if (fmtRaw !== 'video' && fmtRaw !== 'audio') {
      sendJson(res, 400, { error: "format must be 'video' or 'audio'" }, origin);
      return;
    }

    // Tracked and abortable: a client that hangs up — or a quit — must take
    // the yt-dlp/ffmpeg child and its temp directory with it.
    const controller = new AbortController();
    activeDownloads.add(controller);
    res.on('close', () => controller.abort());

    let outcome;
    try {
      outcome = await downloadMedia(target, fmtRaw as MediaFormat, controller.signal);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }, origin);
      return;
    } finally {
      activeDownloads.delete(controller);
    }

    const { filePath, filename, sizeBytes, cleanup } = outcome;
    const encoded = encodeURIComponent(filename);
    const safeAscii = filename.replace(/["\\]/g, '').replace(/[^\x20-\x7E]/g, '_');

    setCors(res, origin);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(sizeBytes),
      'Content-Disposition': `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`,
      'X-Filename': encoded,
    });

    const stream = createReadStream(filePath);
    let cleaned = false;
    const finish = () => {
      if (cleaned) return;
      cleaned = true;
      void cleanup();
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
}

export function startMediaServer(): Promise<void> {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        try {
          sendJson(res, 500, { error: err instanceof Error ? err.message : 'internal error' }, req.headers.origin);
        } catch {
          /* response already sent */
        }
      });
    });
    server.on('error', (err) => {
      server = null;
      reject(err);
    });
    server.listen(PORT, HOST, () => {
      console.log(`[media] embedded downloader listening on ${MEDIA_SERVER_URL}`);
      resolve();
    });
  });
}

export function stopMediaServer(): void {
  for (const controller of activeDownloads) controller.abort();
  activeDownloads.clear();
  server?.close();
  server = null;
}
