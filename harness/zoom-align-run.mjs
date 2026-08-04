import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

mkdirSync('harness/out', { recursive: true });
await build({
  entryPoints: ['harness/zoom-align.tsx'], bundle: true, outfile: 'harness/out/zoom-align.js',
  format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
const js = readFileSync('harness/out/zoom-align.js');
const server = createServer((req, res) => {
  if (req.url.startsWith('/app.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(js); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><html><body style="margin:0;background:#111"><script src="/app.js"></script></body></html>');
});
await new Promise((r) => server.listen(8127, r));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 700, height: 520 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e));
page.on('console', (m) => {
  if (m.type() === 'error' || /shader|GLSL|WebGL/i.test(m.text())) logs.push(m.text().slice(0, 600));
});
// El guión es síncrono y puede tardar minutos en SwiftShader: esperar al
// evento `load` es esperar a que TERMINE, y eso no cabe en el plazo de goto.
await page.goto('http://localhost:8127/', { waitUntil: 'commit', timeout: 60000 });
await page.waitForFunction(() => window.zoomAlign !== undefined, { timeout: 180000 }).catch(() => {});
const result = await page.evaluate(() => window.zoomAlign ?? 'sin resultado');
console.log(result);
if (logs.length) console.log('mensajes:\n' + logs.join('\n'));
await browser.close();
server.close();
