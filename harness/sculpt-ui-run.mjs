import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const CACHE = 'harness/cache'; let meta = null, bin = null;
for (const f of readdirSync(CACHE)) {
  if (f.endsWith('.json') && f.startsWith('monstruo-1024')) meta = `${CACHE}/${f}`;
  if (f.endsWith('.bin') && f.startsWith('monstruo-1024')) bin = `${CACHE}/${f}`;
}
mkdirSync('harness/out', { recursive: true });
await build({ entryPoints: ['harness/sculpt-ui.tsx'], bundle: true, outfile: 'harness/out/sculpt-ui.js',
  format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning' });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;box-sizing:border-box}
.absolute{position:absolute}.inset-0{top:0;left:0;right:0;bottom:0}.overflow-hidden{overflow:hidden}
.block{display:block}.touch-none{touch-action:none}.left-2{left:8px}.bottom-2{bottom:8px}.flex{display:flex}
.gap-2{gap:8px}.pointer-events-none{pointer-events:none}</style></head><body><div id="root"></div>
<script src="/sculpt-ui.js"></script></body></html>`;
const server = createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  const send = (t, b) => { res.writeHead(200, { 'content-type': t }); res.end(b); };
  if (u === '/') return send('text/html', html);
  if (u === '/sculpt-ui.js') return send('text/javascript', readFileSync('harness/out/sculpt-ui.js'));
  if (u === '/world.json') return send('application/json', readFileSync(meta));
  if (u === '/world.bin') return send('application/octet-stream', readFileSync(bin));
  res.writeHead(404); res.end('no');
});
await new Promise((r) => server.listen(4175, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto('http://localhost:4175/');
await page.waitForFunction('window.wgReady === true', null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'harness/out/sculpt-1-loaded.png' });
const land0 = await page.evaluate('window.wgLand()');
console.log(`tierra inicial ${land0}`);

// Drag across the map and time every move: this is the number that matters.
await page.mouse.move(600, 380);
await page.waitForTimeout(200);
await page.screenshot({ path: 'harness/out/sculpt-2-brush.png' });
const t0 = Date.now();
await page.mouse.down();
const times = [];
for (let k = 1; k <= 30; k++) {
  const a = Date.now();
  await page.mouse.move(600 + k * 9, 380 + Math.sin(k / 3) * 60);
  times.push(Date.now() - a);
}
console.log(`30 movimientos del pincel: total ${Date.now() - t0} ms, mediana ${times.sort((x,y)=>x-y)[15]} ms por movimiento`);
await page.screenshot({ path: 'harness/out/sculpt-3-live.png' });
await page.mouse.up();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'harness/out/sculpt-4-committed.png' });
console.log(`tierra tras el trazo ${await page.evaluate('window.wgLand()')}, ediciones ${await page.evaluate('window.wgEdits')}`);
console.log(errors.length ? `ERRORES:\n${errors.slice(0, 5).join('\n')}` : 'sin errores de consola');
await browser.close(); server.close();
