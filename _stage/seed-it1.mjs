// Seeds the "Prueba Atlas real (Claude)" project with three chapters that carry
// footnotes, so the editor features can be exercised live. Idempotent enough:
// skips if a chapter titled "Cap. de prueba 1" already exists.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = fs.readFileSync(path.join(process.env.APPDATA, 'writers-hoard', 'aibridge', 'token'), 'utf8').trim();
function call(tool, args) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ tool, args, client: 'seed-it1' });
    const req = http.request({ method: 'POST', hostname: '127.0.0.1', port: 8766, path: '/api/call',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => resolve(JSON.parse(raw))); });
    req.write(data); req.end();
  });
}
const projectId = 'proj_mth8y8hc_kbzaa8';
const fn = (id, text) => `<sup data-footnote-id="${id}" data-footnote="${text}" class="wh-footnote-ref"></sup>`;
const para = (n) => `<p>Párrafo ${n}. La ciudad dormía bajo una luz de estaño, y el río, que nadie había visto crecer, arrastraba las últimas hojas del otoño hacia un mar que sólo existía en los mapas antiguos. Nadie hablaba de la torre, aunque todos la miraban al pasar.</p>`;
const chapters = [
  { title: 'Cap. de prueba 1', chapter: 1, content: `<p>El primer capítulo empieza con una nota${fn('fnA1', 'Primera nota al pie: el estaño es una metáfora, no un metal.')} y sigue con prosa.</p>` + Array.from({ length: 30 }, (_, i) => para(i + 1)).join('') + `<p>Y cierra con otra nota${fn('fnA2', 'Segunda nota, mucho más larga, para ver cómo se parte al pie de una página cuando el texto no cabe y hay que reservar espacio para ella.')}.</p>` },
  { title: 'Cap. de prueba 2', chapter: 2, content: `<h2>Una sección</h2><p>Segundo capítulo${fn('fnB1', 'Nota del capítulo dos.')}.</p>` + Array.from({ length: 12 }, (_, i) => para(i + 1)).join('') },
  { title: 'Cap. de prueba 3', chapter: 3, content: `<p>Tercer capítulo, corto, sin notas.</p><blockquote><p>Una cita.</p></blockquote>` },
];
const existing = await call('wh_list_writings', { projectId });
const titles = new Set((existing.result?.writings ?? []).map((w) => w.title));
for (const c of chapters) {
  if (titles.has(c.title)) { console.log('skip', c.title); continue; }
  const r = await call('wh_create_writing', { projectId, title: c.title, content: c.content, chapter: c.chapter, status: 'draft' });
  console.log(c.title, r.ok ? r.result?.writing?.id ?? JSON.stringify(r.result).slice(0, 120) : JSON.stringify(r).slice(0, 300));
}
