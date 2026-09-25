// The packaged renderer is served from the same origin the development
// renderer uses (http://127.0.0.1:5174), so both builds open ONE library.
//
// The library lives in the renderer's IndexedDB and localStorage, and both
// are keyed by origin. Loaded from file:// the packaged app had its own,
// empty library while every word written in development sat under
// http://127.0.0.1:5174 in the same userData folder. Same origin, same data.
//
// What this server does, and nothing more: GET/HEAD of files inside the
// built renderer folder, on loopback only, for requests whose Host is exactly
// the renderer origin (a DNS-rebound page cannot read it through another
// name). No directory listing, no writes, no API.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const RENDERER_HOST = '127.0.0.1';
export const RENDERER_PORT = 5174;
export const RENDERER_ORIGIN = `http://${RENDERER_HOST}:${RENDERER_PORT}`;

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
});

/** The file a request path maps to inside `root`, or null when it escapes it. */
export function resolveRendererFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

export function createRendererRequestHandler(root: string, expectedHost: string) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== expectedHost) {
      res.writeHead(421).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = resolveRendererFile(root, req.url || '/');
    if (!file) {
      res.writeHead(403).end();
      return;
    }
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) {
        res.writeHead(404).end();
        return;
      }
      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  };
}

let server: http.Server | null = null;

/**
 * Serve `root` at RENDERER_ORIGIN. Rejects with the listen error (EADDRINUSE
 * when a development session already holds the port) instead of moving to
 * another port: another port is another origin, which is another, empty,
 * library.
 */
export function startRendererServer(root: string, port = RENDERER_PORT): Promise<string> {
  if (server) return Promise.resolve(`http://${RENDERER_HOST}:${port}`);
  const handler = createRendererRequestHandler(root, `${RENDERER_HOST}:${port}`);
  const candidate = http.createServer((req, res) => {
    void handler(req, res);
  });
  return new Promise((resolve, reject) => {
    candidate.once('error', reject);
    candidate.listen(port, RENDERER_HOST, () => {
      candidate.off('error', reject);
      server = candidate;
      resolve(`http://${RENDERER_HOST}:${port}`);
    });
  });
}

export function stopRendererServer(): void {
  server?.close();
  server = null;
}