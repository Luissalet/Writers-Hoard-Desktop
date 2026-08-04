import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = 'harness/out/zoom3d';
mkdirSync('harness/out', { recursive: true });
await build({
  entryPoints: ['harness/zoom-skin-view.tsx'], bundle: true,
  outfile: 'harness/out/zoom-skin-view.js',
  format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
const js = readFileSync('harness/out/zoom-skin-view.js');
const files = {
  '/plan.json': ['application/json', readFileSync(`${OUT}/plan.json`)],
  '/elev.bin': ['application/octet-stream', readFileSync(`${OUT}/elev.bin`)],
  '/biome.bin': ['application/octet-stream', readFileSync(`${OUT}/biome.bin`)],
  '/base.png': ['image/png', readFileSync(`${OUT}/base.png`)],
  '/block.png': ['image/png', readFileSync(`${OUT}/block.png`)],
};
const server = createServer((req, res) => {
  const hit = files[req.url];
  if (hit) { res.writeHead(200, { 'Content-Type': hit[0] }); res.end(hit[1]); return; }
  if (req.url.startsWith('/app.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(js); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><html><body style="margin:0;background:#0b0e14">'
    + '<script src="/app.js"></script></body></html>');
});
await new Promise((r) => server.listen(8129, r));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 700 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e));
page.on('console', (m) => {
  if (m.type() === 'error' || /shader|GLSL|WebGL/i.test(m.text())) logs.push(m.text().slice(0, 600));
});
await page.goto('http://localhost:8129/', { waitUntil: 'commit', timeout: 60000 });
await page.waitForFunction(() => window.zoomSkinResult !== undefined, { timeout: 240000 })
  .catch(() => {});
console.log(await page.evaluate(() => window.zoomSkinResult ?? 'sin resultado'));
if (logs.length) console.log('mensajes:\n' + logs.join('\n'));
for (const id of ['antes', 'ahora']) {
  const el = await page.$(`#${id}`);
  if (el) await el.screenshot({ path: `${OUT}/3d-${id}.png` });
}
await browser.close();
server.close();
