#!/usr/bin/env node
// ============================================================================
// Fake OpenAI-compatible image server — for testing the Image Studio
// ============================================================================
//
//   node scripts/fake-image-server.mjs [port]      (default 8100, Odysseus' port)
//
// Answers GET /v1/models and POST /v1/images/generations with real PNGs
// (a flat colour derived from the prompt, plus the seed in the corner) so the
// whole pipeline — connection, model list, generation, download policy,
// Gallery row, thumbnail — can be exercised without a GPU or a diffusion
// runtime. Also serves GET /v1/images/progress/:id like Odysseus does.

import http from 'node:http';
import { deflateSync } from 'node:zlib';

const PORT = Number(process.argv[2] || 8100);

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** Solid-colour PNG with a lighter square in the corner: enough to see. */
function makePng(width, height, rgb, seed) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const inBadge = x < 48 + (seed % 40) && y < 48;
      const [r, g, b] = inBadge ? rgb.map((v) => Math.min(255, v + 90)) : rgb;
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function colourFor(prompt) {
  let h = 0;
  for (const ch of prompt) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [60 + (h % 150), 60 + ((h >> 8) % 150), 60 + ((h >> 16) % 150)];
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

const progress = new Map();

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
    json(res, 200, { object: 'list', data: [{ id: 'fake-sd-1.5', object: 'model', owned_by: 'fake' }, { id: 'fake-flux-schnell', object: 'model', owned_by: 'fake' }] });
    return;
  }
  if (req.method === 'GET' && url.startsWith('/v1/images/progress/')) {
    const id = url.slice('/v1/images/progress/'.length);
    json(res, progress.has(id) ? 200 : 404, progress.get(id) ?? { error: 'unknown request' });
    return;
  }
  if (req.method === 'POST' && (url === '/v1/images/generations' || url === '/images/generations')) {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        json(res, 400, { error: { message: 'bad json' } });
        return;
      }
      if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
        json(res, 400, { error: { message: 'prompt is required' } });
        return;
      }
      const [w, h] = String(body.size ?? '1024x1024').split('x').map((v) => Math.max(64, Math.min(2048, Number(v) || 1024)));
      const n = Math.max(1, Math.min(4, Number(body.n) || 1));
      const seed = typeof body.seed === 'number' ? body.seed : Math.floor(Math.random() * 1e6);
      const rid = body.request_id || `fake-${Date.now()}`;
      progress.set(rid, { status: 'done', step: 8, total: 8 });
      // Pretend to work: a short delay so Cancel has something to cancel.
      setTimeout(() => {
        const data = [];
        for (let i = 0; i < n; i += 1) {
          const png = makePng(w, h, colourFor(`${body.prompt}#${i}`), seed + i);
          data.push({ b64_json: png.toString('base64'), revised_prompt: `${body.prompt} (fake #${i + 1})`, seed: seed + i });
        }
        json(res, 200, { created: Math.floor(Date.now() / 1000), data });
      }, 1500);
    });
    return;
  }
  json(res, 404, { error: { message: `no route ${req.method} ${url}` } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fake-image-server] http://127.0.0.1:${PORT}/v1  (models: fake-sd-1.5, fake-flux-schnell)`);
});
