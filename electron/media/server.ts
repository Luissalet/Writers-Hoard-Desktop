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

export const MEDIA_SERVER_URL = `http://${HOST}:${PORT}`;

let server: http.Server | null = null;

function setCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Filename');
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy(); // guard against absurd payloads
    });
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { method, url } = req;

  if (method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === 'GET' && url === '/api/health') {
    sendJson(res, 200, { ok: true, platforms: SUPPORTED_PLATFORMS });
    return;
  }

  if (method === 'POST' && url === '/api/detect') {
    const body = await readJsonBody(req);
    const target = String(body.url ?? '').trim();
    if (!target) {
      sendJson(res, 400, { error: 'url is required' });
      return;
    }
    sendJson(res, 200, { platform: detectPlatform(target) });
    return;
  }

  if (method === 'POST' && url === '/api/download') {
    const body = await readJsonBody(req);
    const target = String(body.url ?? '').trim();
    const fmtRaw = String(body.format ?? 'video').toLowerCase();
    if (!target) {
      sendJson(res, 400, { error: 'url is required' });
      return;
    }
    if (fmtRaw !== 'video' && fmtRaw !== 'audio') {
      sendJson(res, 400, { error: "format must be 'video' or 'audio'" });
      return;
    }

    let outcome;
    try {
      outcome = await downloadMedia(target, fmtRaw as MediaFormat);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const { filePath, filename, sizeBytes, cleanup } = outcome;
    const encoded = encodeURIComponent(filename);
    const safeAscii = filename.replace(/["\\]/g, '').replace(/[^\x20-\x7E]/g, '_');

    setCors(res);
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

  sendJson(res, 404, { error: 'not found' });
}

export function startMediaServer(): Promise<void> {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        try {
          sendJson(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
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
  server?.close();
  server = null;
}
