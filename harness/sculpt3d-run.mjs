// Drive the 3D sculpt view in a real browser: compile the shaders, turn the
// camera, sculpt a stroke on the plane and on the globe, and check that the
// picture and the world both changed. The GPU here is a software rasteriser, so
// the timings are a floor and nothing else — what this run is for is whether it
// WORKS, not how fast.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const CACHE = 'harness/cache';
let meta = null, bin = null;
for (const f of readdirSync(CACHE)) {
  if (f.endsWith('.json') && f.startsWith('monstruo-1024')) meta = `${CACHE}/${f}`;
  if (f.endsWith('.bin') && f.startsWith('monstruo-1024')) bin = `${CACHE}/${f}`;
}
mkdirSync('harness/out', { recursive: true });
await build({
  entryPoints: ['harness/sculpt3d-ui.tsx'], bundle: true, outfile: 'harness/out/sculpt3d-ui.js',
  format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});

// Only the utility classes the component actually leans on for layout; the rest
// is cosmetic and its absence would only make the screenshot uglier.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box;font-family:system-ui,sans-serif}
.absolute{position:absolute}.inset-0{top:0;left:0;right:0;bottom:0}.relative{position:relative}
.overflow-hidden{overflow:hidden}.select-none{user-select:none}.block{display:block}
.flex{display:flex}.flex-col{flex-direction:column}.grid{display:grid}
.items-center{align-items:center}.items-end{align-items:flex-end}.items-start{align-items:flex-start}
.justify-between{justify-content:space-between}.justify-center{justify-content:center}
.gap-0\\.5{gap:2px}.gap-1{gap:4px}.gap-1\\.5{gap:6px}.gap-2{gap:8px}
.left-2{left:8px}.right-2{right:8px}.top-2{top:8px}.bottom-2{bottom:8px}
.pointer-events-none{pointer-events:none}.tabular-nums{font-variant-numeric:tabular-nums}
.w-60{width:240px}.w-12{width:48px}.w-10{width:40px}.w-px{width:1px}.flex-1{flex:1}
.p-1{padding:4px}.p-0\\.5{padding:2px}.p-2\\.5{padding:10px}
.px-2{padding-left:8px;padding-right:8px}.py-1{padding-top:4px;padding-bottom:4px}
.px-1\\.5{padding-left:6px;padding-right:6px}.py-0\\.5{padding-top:2px;padding-bottom:2px}
.rounded{border-radius:4px}.text-white\\/70{color:rgba(255,255,255,.7)}
.text-\\[10px\\]{font-size:10px}.text-\\[9px\\]{font-size:9px}.text-xs{font-size:12px}
.bg-black\\/60{background:rgba(0,0,0,.6)}.bg-black\\/75{background:rgba(0,0,0,.75)}
.bg-black\\/50{background:rgba(0,0,0,.5)}.bg-black\\/45{background:rgba(0,0,0,.45)}
.-translate-x-1\\/2{transform:translateX(-50%)}.left-1\\/2{left:50%}
button{background:none;border:0;color:inherit;cursor:pointer}
</style></head><body><div id="root"></div><script src="/sculpt3d-ui.js"></script></body></html>`;

const server = createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  const send = (t, b) => { res.writeHead(200, { 'content-type': t }); res.end(b); };
  if (u === '/') return send('text/html', html);
  if (u === '/sculpt3d-ui.js') return send('text/javascript', readFileSync('harness/out/sculpt3d-ui.js'));
  if (u === '/world.json') return send('application/json', readFileSync(meta));
  if (u === '/world.bin') return send('application/octet-stream', readFileSync(bin));
  if (u === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end('no');
});
await new Promise((r) => server.listen(4177, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 560, height: 360 } });
// Everything here runs on a software rasteriser, so the only honest timeout is a
// generous one; what is being tested is whether it works, not how fast.
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });

const fails = [];
/**
 * A screenshot that gives up instead of hanging the run.
 *
 * On a software rasteriser a frame can be in flight for a second or more, and
 * asking for a capture on top of one occasionally never returns. That is a fact
 * about this container, not about the view, so it must not be able to end the run.
 */
const shot = async (path) => {
  await page.waitForTimeout(1200);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await page.screenshot(path ? { path, timeout: 45000 } : { timeout: 45000 });
    } catch {
      await page.waitForTimeout(3000);
    }
  }
  console.log(`  (no se pudo capturar ${path || 'la pantalla'}; el rasterizador por software iba muy cargado)`);
  return null;
};
const check = (ok, msg) => { console.log(`${ok ? '·' : '✗'} ${msg}`); if (!ok) fails.push(msg); };

await page.goto('http://localhost:4177/');
await page.waitForFunction('window.wgReady === true', null, { timeout: 180000 });
await page.waitForTimeout(4000);


// A shader that failed to compile leaves the canvas at the clear colour. Ask the
// PICTURE, not the log — and take it as a screenshot rather than reading the
// canvas back: a WebGL context without `preserveDrawingBuffer` is empty by the
// time anything on the page can look at it, which is how the first version of
// this check reported a blank world over a perfectly good render.
const variety = async (file) => {
  const buf = await shot(file);
  if (!buf) return 0;
  const img = await loadImage(buf);
  const g = createCanvas(300, 190);
  const x = g.getContext('2d');
  x.drawImage(img, 0, 0, 300, 190);
  const d = x.getImageData(0, 0, 300, 190).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3));
  return seen.size;
};
const tones0 = await variety('harness/out/sc3d-1-plano.png');
// Cast shadows are the most expensive thing in the shader and this GPU is a CPU.
// They are checked by eye in the screenshot above; the rest of the run turns them
// off so it finishes this century.
await page.mouse.move(280, 190);   // the shortcuts act where the pointer is
await page.keyboard.press('s');
await page.waitForTimeout(1500);
check(tones0 > 60, `el plano dibuja terreno (${tones0} tonos distintos)`);
check(errors.length === 0, `sin errores de consola${errors.length ? `: ${errors[0]}` : ''}`);

// ---- picking: the brush ring has to land where the pointer is ---------------
await page.mouse.move(300, 200);
await page.waitForTimeout(1200);
await shot('harness/out/sc3d-2-pincel.png');
const readout = await page.evaluate(`(document.body.innerText.match(/-?\\d+ m[^·]*· [\\d.]+°[NS] [\\d.]+°[EO]/) || [''])[0]`);
check(!!readout, `el puntero informa de dónde está: ${readout || '(nada)'}`);

// ---- a stroke on the plane --------------------------------------------------
const sum0 = await page.evaluate('window.wgSum()');
const t0 = Date.now();
await page.mouse.down();
const times = [];
for (let k = 1; k <= 12; k++) {
  const a = Date.now();
  await page.mouse.move(300 + k * 7, 200 + Math.sin(k / 3) * 22);
  times.push(Date.now() - a);
}
await shot('harness/out/sc3d-3-trazo.png');
await page.mouse.up();
await page.waitForTimeout(2500);
const total = Date.now() - t0;
times.sort((a, b) => a - b);
console.log(`  12 movimientos: ${total} ms en total, mediana ${times[6]} ms (rasterizador por software)`);
const sum1 = await page.evaluate('window.wgSum()');
check(sum1 > sum0, `levantar sube el terreno (suma ${sum0} → ${sum1})`);
check((await page.evaluate('window.wgSteps()')) === 1, `un trazo es una edición (${await page.evaluate('window.wgSteps()')})`);
await shot('harness/out/sc3d-4-guardado.png');

// ---- symmetry ---------------------------------------------------------------
await page.keyboard.press('x');
await page.waitForTimeout(400);
await page.mouse.move(230, 210);
await page.mouse.down();
for (let k = 1; k <= 5; k++) await page.mouse.move(230 + k * 7, 210 + k * 3);
await page.mouse.up();
await page.waitForTimeout(2500);
check((await page.evaluate('window.wgSteps()')) === 3, `la simetría añade su reflejo (${await page.evaluate('window.wgSteps()')} ediciones en total)`);
await page.evaluate('window.wgUndo()');
await page.waitForTimeout(1200);
check((await page.evaluate('window.wgSteps()')) === 1, `deshacer quita el trazo simétrico entero, no un brazo (quedan ${await page.evaluate('window.wgSteps()')})`);
await page.keyboard.press('x');
await shot('harness/out/sc3d-5-simetria.png');

// ---- orbit: the camera has to move and the picture with it ------------------
const before = await shot();
await page.mouse.move(280, 190);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(390, 140, { steps: 6 });
await page.mouse.up({ button: 'middle' });
await page.waitForTimeout(1500);
const after = await shot('harness/out/sc3d-6-orbita.png');
check(!!before && !!after && !before.equals(after), 'el botón central gira la cámara');

// ---- every brush at least runs ----------------------------------------------
for (const op of ['lower', 'smooth', 'sharpen', 'flatten', 'terrace', 'roughen', 'gully', 'grab']) {
  await page.evaluate(`window.wgSetTool({ terrainOp: ${JSON.stringify(op)} })`);
  await page.waitForTimeout(150);
  const s0 = await page.evaluate('window.wgSum()');
  await page.mouse.move(240, 190);
  await page.mouse.down();
  for (let k = 1; k <= 3; k++) await page.mouse.move(240 + k * 9, 190 + k * 4);
  await page.mouse.up();
  await page.waitForTimeout(1800);
  const s1 = await page.evaluate('window.wgSum()');
  check(s0 !== s1 || op === 'flatten', `el pincel «${op}» cambia el terreno (${s0} → ${s1})`);
}
await shot('harness/out/sc3d-7-pinceles.png');

// ---- the globe --------------------------------------------------------------
await page.keyboard.press('g');
await page.waitForTimeout(3000);
const tonesG = await variety('harness/out/sc3d-8-globo.png');
check(tonesG > 60, `el globo dibuja terreno (${tonesG} tonos)`);
const g0 = await page.evaluate('window.wgSum()');
await page.evaluate('window.wgSetTool({ terrainOp: "raise" })');
await page.mouse.move(280, 175);
await page.waitForTimeout(1000);
await page.mouse.down();
for (let k = 1; k <= 6; k++) await page.mouse.move(280 + k * 4, 175 + k * 2);
await page.mouse.up();
await page.waitForTimeout(2500);
const g1 = await page.evaluate('window.wgSum()');
check(g1 > g0, `se esculpe sobre el globo (suma ${g0} → ${g1})`);
await shot('harness/out/sc3d-9-globo-esculpido.png');

check(errors.length === 0, `sin errores de consola al final${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(`\n${fails.length === 0 ? 'La vista 3D funciona de extremo a extremo.' : `${fails.length} fallos: ${fails.join('; ')}`}`);
await browser.close();
server.close();
process.exit(fails.length ? 1 : 0);
