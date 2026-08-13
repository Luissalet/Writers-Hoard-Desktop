import { build } from 'esbuild';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
mkdirSync('harness/out', { recursive: true });
await build({
  entryPoints: ['harness/world3d-zoom.tsx'], bundle: true,
  outfile: 'harness/out/world3d-zoom.js',
  format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'text' },
  logLevel: 'warning',
  // El alias `@/` de Vite, igual que en views-smoke-run: sin él, el runner se
  // cae en cuanto un módulo del motor importa por alias (i18n, capacity).
  plugins: [{
    name: 'alias-arroba',
    setup(b) {
      b.onResolve({ filter: /^@\// }, (args) => {
        const base = new URL(`../src/${args.path.slice(2)}`, import.meta.url).pathname;
        for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
          if (existsSync(base + ext) && !existsSync(base + ext + '/')) return { path: base + ext };
        }
        return { path: base };
      });
    },
  }],
});
const js = readFileSync('harness/out/world3d-zoom.js');
const server = createServer((req, res) => {
  if (req.url.startsWith('/app.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(js); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  // EL CALZO DE CSS.
  //
  // `World3D` se coloca con clases de Tailwind — `absolute inset-0` — y esta
  // página no lleva Tailwind. Sin ellas el contenedor mide CERO de alto, el
  // lienzo de WebGL nace de 1100x8 y la captura sale negra con una tira de
  // terreno arriba. El banco montaba, no se quejaba, devolvía `ok:true` y no
  // estaba dibujando nada: exactamente la clase de banco que da verde sin
  // medir. Son seis utilidades; se declaran a mano y el banco pasa a ver lo
  // mismo que el lector.
  res.end('<!doctype html><html><head><style>'
    + 'html,body{margin:0;height:100%;background:#0b0e14}'
    + '#root{position:relative;width:100vw;height:100vh}'
    + '.absolute{position:absolute}.relative{position:relative}.fixed{position:fixed}'
    + '.inset-0{inset:0}.overflow-hidden{overflow:hidden}.select-none{user-select:none}'
    + '.pointer-events-none{pointer-events:none}'
    + '</style></head><body>'
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
// El posado de la cámara, la primera pintura de la piel y el reloj de rescate
// tardan; capturar antes daba un fotograma a medio montar.
await page.waitForTimeout(6000);
await page.screenshot({ path: 'harness/out/zoom3d/world3d.png', timeout: 90000 }).catch(() => {});
// Y cuánto de la captura es terreno y no fondo: un lienzo colapsado da ~1 %.
const cobertura = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return 'sin lienzo';
  return `lienzo ${c.width}x${c.height} (css ${c.clientWidth}x${c.clientHeight})`;
});
console.log(cobertura);
await browser.close();
server.close();
