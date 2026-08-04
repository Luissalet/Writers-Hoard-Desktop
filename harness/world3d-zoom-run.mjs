import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
mkdirSync('harness/out', { recursive: true });
await build({
  entryPoints: ['harness/world3d-zoom.tsx'], bundle: true,
  outfile: 'harness/out/world3d-zoom.js',
  format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'text' },
  logLevel: 'warning',
});
const js = readFileSync('harness/out/world3d-zoom.js');
const server = createServer((req, res) => {
  if (req.url.startsWith('/app.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(js); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><html><body style="margin:0;background:#0b0e14">'
    + '<script type="module" src="/app.js"></script></body></html>');
});
await new Promise((r) => server.listen(8131, r));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e).slice(0, 400)));
await page.goto('http://localhost:8131/', { waitUntil: 'commit', timeout: 60000 });
await page.waitForFunction(() => window.world3dZoom !== undefined, { timeout: 240000 })
  .catch(() => {});
console.log(await page.evaluate(() => window.world3dZoom ?? 'sin resultado'));
if (logs.length) console.log('paginas:\n' + logs.join('\n'));
await page.screenshot({ path: 'harness/out/zoom3d/world3d.png', timeout: 90000 }).catch(() => {});
await browser.close();
server.close();
