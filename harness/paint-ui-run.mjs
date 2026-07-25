// Bundle the paint UI, serve it, drive it with a real browser, and check that a
// drag on the ocean actually creates land on the map.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CACHE = 'harness/cache';
let meta = null, bin = null;
// Find the cached world (the key includes a params-length hash).
const { readdirSync } = await import('node:fs');
for (const f of readdirSync(CACHE)) {
  if (f.endsWith('.json') && f.startsWith('monstruo-1024')) meta = `${CACHE}/${f}`;
  if (f.endsWith('.bin') && f.startsWith('monstruo-1024')) bin = `${CACHE}/${f}`;
}
if (!meta || !bin) throw new Error('no cached world; run any harness script first');
console.log(`mundo: ${meta}`);

mkdirSync('harness/out', { recursive: true });
const OUT = 'harness/out/paint-ui.js';
await build({
  entryPoints: ['harness/paint-ui.tsx'],
  bundle: true,
  outfile: OUT,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
console.log('bundle listo');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,sans-serif;background:#16161a}
button{font:inherit;color:inherit;background:#2a2a32;border:1px solid #3a3a44;border-radius:4px;cursor:pointer}
input[type=range]{width:100%}
input[type=text],input:not([type]){background:#0e0e12;color:#eee;border:1px solid #3a3a44;border-radius:4px;padding:4px}
kbd{background:#333;padding:0 3px;border-radius:3px}
.absolute{position:absolute}.inset-0{top:0;left:0;right:0;bottom:0}
.overflow-hidden{overflow:hidden}.block{display:block}
.flex{display:flex}.flex-col{flex-direction:column}.grid{display:grid}
.pointer-events-none{pointer-events:none}
.touch-none{touch-action:none}
.left-0{left:0}.top-0{top:0}
</style></head><body><div id="root"></div><script src="/paint-ui.js"></script></body></html>`;

const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  if (url === '/') return send('text/html', html);
  if (url === '/paint-ui.js') return send('text/javascript', readFileSync(OUT));
  if (url === '/world.json') return send('application/json', readFileSync(meta));
  if (url === '/world.bin') return send('application/octet-stream', readFileSync(bin));
  res.writeHead(404); res.end('no');
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4173/');
await page.waitForFunction('window.wgReady === true', null, { timeout: 120000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'harness/out/ui-1-loaded.png' });

const landBefore = await page.evaluate('window.wgLandCells()');
console.log(`tierra inicial ${landBefore}`);

// --- the coast brush ---
await page.getByRole('button', { name: 'Costa' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: 'harness/out/ui-2-coast-tool.png' });

// Find open ocean by SAMPLING THE RENDERED PIXELS, not by mapping screen to world.
// The first version of this test did the mapping itself and got it wrong — the map
// does not show the whole world at zoom 1 — so it aimed its brush at land and then
// reported that the brush barely worked.
const target = await page.evaluate(() => {
  const cv = document.querySelector('canvas');
  const r = cv.getBoundingClientRect();
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const kx = cv.width / r.width, ky = cv.height / r.height;
  const watery = (px, py) => {
    const i = ((py * ky) | 0) * cv.width * 4 + ((px * kx) | 0) * 4;
    const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
    return B > R + 24 && B > 90;
  };
  let best = null;
  for (let py = 70; py < r.height - 70; py += 10) {
    for (let px = 70; px < r.width - 70; px += 10) {
      let sea = 0, n = 0;
      for (let dy = -55; dy <= 55; dy += 11) for (let dx = -55; dx <= 55; dx += 11) {
        n++; if (watery(px + dx, py + dy)) sea++;
      }
      if (!best || sea / n > best.frac) best = { px: r.left + px, py: r.top + py, frac: sea / n };
      if (best.frac === 1) return best;
    }
  }
  return best;
});
console.log(`océano abierto en pantalla (${target.px.toFixed(0)}, ${target.py.toFixed(0)}), ${(target.frac * 100).toFixed(0)} % mar`);

await page.mouse.move(target.px, target.py);
await page.waitForTimeout(120);
await page.screenshot({ path: 'harness/out/ui-3-brush-ring.png' });
await page.mouse.down();
for (let k = 1; k <= 12; k++) {
  await page.mouse.move(target.px + k * 6, target.py + Math.sin(k / 2) * 10);
  await page.waitForTimeout(16);
}
await page.screenshot({ path: 'harness/out/ui-4-stroke-live.png' });
const tUp = Date.now();
await page.mouse.up();
// How long until the map actually shows the new land? Poll the pixel under the
// stroke until it stops being water.
await page.waitForFunction(() => window.wgEdits === 1, null, { timeout: 30000 });
console.log(`  del soltar el ratón a la edición aplicada: ${Date.now() - tUp} ms`);
await page.waitForTimeout(3500);
await page.screenshot({ path: 'harness/out/ui-5-after-stroke.png' });

const landAfter = await page.evaluate('window.wgLandCells()');
const edits = await page.evaluate('window.wgEdits');
console.log(`tierra tras la pincelada ${landAfter} (+${landAfter - landBefore}); ediciones ${edits}`);

// --- undo ---
await page.getByRole('button', { name: /Deshacer/ }).click();
await page.waitForTimeout(2500);
const landUndone = await page.evaluate('window.wgLandCells()');
console.log(`tras deshacer ${landUndone} — ${landUndone === landBefore ? 'exacto' : 'NO COINCIDE'}`);
await page.screenshot({ path: 'harness/out/ui-6-undone.png' });

// --- biome brush ---
await page.getByRole('button', { name: 'Bioma' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: 'harness/out/ui-7-biome-panel.png' });

// --- a marker on land ---
const onLand = await page.evaluate(() => {
  const cv = document.querySelector('canvas');
  const r = cv.getBoundingClientRect();
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const kx = cv.width / r.width, ky = cv.height / r.height;
  for (let py = 90; py < r.height - 90; py += 6) {
    for (let px = 90; px < r.width - 90; px += 6) {
      let land = 0, n = 0;
      for (let dy = -18; dy <= 18; dy += 9) for (let dx = -18; dx <= 18; dx += 9) {
        const i = (((py + dy) * ky) | 0) * cv.width * 4 + (((px + dx) * kx) | 0) * 4;
        const R = img.data[i], B = img.data[i + 2];
        n++; if (R > B) land++;
      }
      if (land === n) return { px: r.left + px, py: r.top + py };
    }
  }
  return null;
});
await page.getByRole('button', { name: 'Marca' }).click();
await page.waitForTimeout(150);
await page.mouse.click(onLand.px, onLand.py);
await page.waitForTimeout(3000);
await page.screenshot({ path: 'harness/out/ui-8-marker.png' });
const markers = await page.evaluate('window.wgWorld.painted ? window.wgWorld.painted.markers.length : 0');
console.log(`marcadores tras el clic: ${markers}`);

console.log(errors.length ? `ERRORES:\n${errors.slice(0, 8).join('\n')}` : 'sin errores de consola');
await browser.close();
server.close();
writeFileSync('harness/out/ui-report.txt', `land ${landBefore} → ${landAfter} → ${landUndone}\nedits ${edits}\nmarkers ${markers}\nerrors ${errors.length}\n`);
