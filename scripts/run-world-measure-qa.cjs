// Ruler area and real-scale outline through the normal map view, with trusted
// pointer clicks, in an isolated hidden Electron profile with real workers.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-measure-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-measure-qa', configureServer(instance) { instance.middlewares.use('/__world_measure_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_measure_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_measure_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 900) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const tests = [];
  await wait('window.__lookReady', 'preview');
  await wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Carta'&&!e.disabled)`, 'forged');
  await pause(2500);
  const canvasRect = await js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>({e,r:e.getBoundingClientRect()})).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height)[0].r;return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const mapPixels = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0];const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i+=97)h=(h*31+d[i])>>>0;return h;})()`);
  // Ruler: four trusted clicks enclose a shape.
  await js(`[...document.querySelectorAll('button')].find(b=>(b.title||'').startsWith('Regla:'))?.click()`);
  await wait(`document.querySelector('[data-testid="worldgen-ruler"]')`, 'ruler readout');
  const click = async (u, v) => { const x = Math.round(canvasRect.x + canvasRect.w * u), y = Math.round(canvasRect.y + canvasRect.h * v); win.webContents.sendInputEvent({ type: 'mouseMove', x, y }); await pause(40); win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(30); win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(350); };
  for (const [u, v] of [[0.40, 0.40], [0.55, 0.40], [0.55, 0.55], [0.40, 0.55]]) await click(u, v);
  await wait(`document.querySelector('[data-testid="worldgen-ruler-area"]')`, 'area line');
  const areaText = await js(`document.querySelector('[data-testid="worldgen-ruler-area"]').textContent`);
  assert(/km²/.test(areaText) && /perímetro cerrado/.test(areaText), areaText);
  tests.push(`Four trusted ruler clicks enclose a shape; the readout reports it: "${areaText}"`);
  await pause(400); fs.writeFileSync(path.join(evidence, 'ruler-area-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Real outline at this scale, from the toolbar select.
  const select = `document.querySelector('select[aria-label="Comparar con un lugar real a esta escala"]')`;
  await wait(select, 'scale select');
  const before = await mapPixels();
  await js(`(()=>{const s=${select};const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'iberia');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  let after = before; for (let i = 0; i < 60 && after === before; i++) { await pause(150); after = await mapPixels(); }
  assert.notEqual(after, before, 'Choosing a real outline did not change the map');
  tests.push('Choosing Península Ibérica draws its outline over the map at this scale');
  await pause(500); fs.writeFileSync(path.join(evidence, 'scale-iberia-1440.png'), (await win.webContents.capturePage()).toPNG());
  await js(`(()=>{const s=${select};const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  let cleared = after; for (let i = 0; i < 60 && cleared === after; i++) { await pause(150); cleared = await mapPixels(); }
  assert.notEqual(cleared, after, 'Clearing the comparison left the outline');
  tests.push('Clearing the comparison removes the outline');
  win.setContentSize(640, 900); await pause(1200);
  fs.writeFileSync(path.join(evidence, 'ruler-area-640.png'), (await win.webContents.capturePage()).toPNG());
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
