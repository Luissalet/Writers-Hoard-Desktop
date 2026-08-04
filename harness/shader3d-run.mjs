import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
mkdirSync('harness/out', { recursive: true });
await build({
  entryPoints: ['harness/shader3d.tsx'], bundle: true, outfile: 'harness/out/shader3d.js',
  format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
const js = readFileSync('harness/out/shader3d.js');
const server = createServer((req, res) => {
  if (req.url.startsWith('/app.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(js); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><html><body style="margin:0;background:#111"><script src="/app.js"></script></body></html>');
});
await new Promise((r) => server.listen(8123, r));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 700, height: 460 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e));
page.on('console', (m) => { if (m.type() === 'error' || /shader|GLSL|WebGL/i.test(m.text())) logs.push(m.text().slice(0, 400)); });
await page.goto('http://localhost:8123/', { waitUntil: 'load' });
await page.waitForFunction(() => window.shaderResult !== undefined, { timeout: 60000 }).catch(() => {});
const result = await page.evaluate(() => window.shaderResult ?? 'sin resultado');
console.log('resultado:', result);
if (logs.length) console.log('mensajes:\n' + logs.join('\n'));
await page.screenshot({ path: 'harness/out/shader3d.png' });
await browser.close();
server.close();
