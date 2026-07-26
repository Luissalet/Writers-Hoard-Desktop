// One question only: does the globe come out as a globe? The full run takes ten
// minutes on a software rasteriser, which is far too slow a loop for a question
// this specific.
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CACHE = 'harness/cache';
let meta = null, bin = null;
for (const f of readdirSync(CACHE)) {
  if (f.endsWith('.json') && f.startsWith('monstruo-1024')) meta = `${CACHE}/${f}`;
  if (f.endsWith('.bin') && f.startsWith('monstruo-1024')) bin = `${CACHE}/${f}`;
}
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}.absolute{position:absolute}.inset-0{top:0;left:0;right:0;bottom:0}
.overflow-hidden{overflow:hidden}button{background:none;border:0;color:#fff}
</style></head><body><div id="root"></div><script src="/sculpt3d-ui.js"></script></body></html>`;
const server = createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  const send = (t, b) => { res.writeHead(200, { 'content-type': t }); res.end(b); };
  if (u === '/') return send('text/html', html);
  if (u === '/sculpt3d-ui.js') return send('text/javascript', readFileSync('harness/out/sculpt3d-ui.js'));
  if (u === '/world.json') return send('application/json', readFileSync(meta));
  if (u === '/world.bin') return send('application/octet-stream', readFileSync(bin));
  res.writeHead(204); res.end();
});
await new Promise((r) => server.listen(4178, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 420, height: 320 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('ERROR', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLA', m.text().slice(0, 300)); });

await page.goto('http://localhost:4178/');
await page.waitForFunction('window.wgReady === true');
await page.waitForTimeout(2500);
await page.mouse.move(210, 160);
await page.waitForTimeout(400);
await page.keyboard.press('s');           // shadows off; this GPU is a CPU
await page.waitForTimeout(1500);
// Turn the camera FIRST. The full run only saw a broken globe after an orbit, so
// the suspect is the switch inheriting a camera pose rather than the globe itself.
await page.mouse.down({ button: 'middle' });
await page.mouse.move(300, 110, { steps: 5 });
await page.mouse.up({ button: 'middle' });
// After an orbit, `page.screenshot` in this container sometimes never returns —
// while the page itself answers `evaluate` in three milliseconds. That is the
// software rasteriser's capture path, not the view, so the check is: is the main
// thread free?
{
  const t = Date.now();
  await page.evaluate('1');
  console.log(`tras orbitar, la página responde en ${Date.now() - t} ms`);
}
await page.waitForTimeout(4000);
await page.keyboard.press('g');           // to the globe
await page.waitForTimeout(9000);
await page.screenshot({ path: 'harness/out/globo.png' });

await page.mouse.move(210, 160);
await page.waitForTimeout(3000);
console.log('lectura bajo el puntero:', await page.evaluate(
  `(document.body.innerText.match(/-?\\d+ m[^·]*· [\\d.]+°[NS] [\\d.]+°[EO]/) || ['(nada: el rayo no toca el globo)'])[0]`));
await page.screenshot({ path: 'harness/out/globo-puntero.png' });

// And can it be sculpted there? The whole reason the globe exists is the seam and
// the poles, which is to say: sculpting, not looking.
const before = await page.evaluate('window.wgSum()');
await page.mouse.down();
for (let k = 1; k <= 6; k++) await page.mouse.move(210 + k * 4, 160 + k * 2);
await page.mouse.up();
await page.waitForTimeout(4000);
const after = await page.evaluate('window.wgSum()');
console.log(`esculpir sobre el globo: suma ${before} → ${after} ${after !== before ? '·' : '✗ no cambió'}`);
console.log(`ediciones: ${await page.evaluate('window.wgSteps()')}`);
await page.screenshot({ path: 'harness/out/globo-esculpido.png' });

await browser.close();
server.close();
