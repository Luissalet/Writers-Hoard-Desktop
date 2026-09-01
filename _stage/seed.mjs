import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'http://127.0.0.1:8766';
const root = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'writers-hoard');
const TOKEN = fs.readFileSync(path.join(root, 'aibridge', 'token'), 'utf8').trim();

function call(tool, args) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ tool, args });
    const req = http.request({
      method: 'POST', hostname: '127.0.0.1', port: 8766, path: '/api/call',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ ok: false, raw: raw.slice(0, 300) }); } });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(data); req.end();
  });
}

const P = process.argv[2];
if (!P) { console.error('usage: seed.mjs <projectId>'); process.exit(2); }

const chapters = [
  [1, 'Capitulo 1', 'Aurelia cruzo el patio al alba. Marek la seguia de lejos y no dijo nada.'],
  [2, 'Capitulo 2', 'Aurelia hablo con el herrero sobre la carta. Marek callaba junto a la puerta.'],
  [3, 'Capitulo 3', 'Marek encontro la carta escondida bajo la piedra suelta del pozo.'],
  [4, 'Capitulo 4', 'Marek volvio al patio vacio. Nadie lo esperaba ya en la casa grande.'],
  [5, 'Capitulo 5', 'Marek quemo la carta y salio de la ciudad antes del amanecer.'],
  [6, 'Capitulo 6', 'Marek llego al mar. El viaje habia terminado y no quedaba nadie.'],
];

const steps = [
  ['wh_enable_engine', { projectId: P, engineId: 'seeds' }],
  ['wh_enable_engine', { projectId: P, engineId: 'outline' }],
  ...chapters.map(([chapter, title, content]) => ['wh_create_writing', { projectId: P, title, chapter, content, status: 'draft' }]),
  ['wh_create_codex_entry', { projectId: P, title: 'Aurelia', type: 'character', content: 'Hija del herrero. Desaparece a mitad del libro.' }],
  ['wh_create_codex_entry', { projectId: P, title: 'Marek', type: 'character', content: 'Un mensajero.' }],
  ['wh_create_seed', { projectId: P, title: 'La carta escondida', description: 'Se planta pronto y nunca se paga.' }],
  ['wh_create_outline', { projectId: P, title: 'Esquema principal' }],
];

for (const [tool, args] of steps) {
  const res = await call(tool, args);
  const summary = res.ok === false ? `FAIL ${JSON.stringify(res).slice(0, 180)}` : 'ok';
  console.log(`${tool}: ${summary}`);
}
const outlines = await call('wh_list_outlines', { projectId: P });
const outlineId = outlines?.result?.outlines?.[0]?.id ?? outlines?.outlines?.[0]?.id;
console.log('outlineId: ' + outlineId);
if (outlineId) {
  for (const [text, i] of [['Aurelia descubre la carta', 1], ['Marek decide marcharse', 2], ['El final en el mar', 3]]) {
    const res = await call('wh_create_beat', { outlineId, title: text, level: 'beat', order: i });
    console.log('beat: ' + (res.ok === false ? JSON.stringify(res).slice(0, 160) : 'ok'));
  }
}
