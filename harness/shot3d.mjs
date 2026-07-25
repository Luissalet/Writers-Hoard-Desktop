import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('harness');
const types = { '.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.json':'application/json' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const f = path.join(root, url === '/' ? 'skin3d.html' : url);
  if (!existsSync(f)) { console.log('404', url, '->', f); res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8099, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const q = process.argv[2] || '';
await page.goto(`http://127.0.0.1:8099/skin3d.html${q}`);
try { await page.waitForFunction('window.__ready === true', { timeout: 90000 }); }
catch { console.log('NOT READY. errors:', errs.slice(0, 5)); }
if (errs.length) console.log('errors:', errs.slice(0, 5));
await page.screenshot({ path: process.env.OUT || 'harness/out/3d-carta.png' });
await browser.close();
server.close();
console.log('shot written');
