// The play grid through the toolbar: hexes of a chosen size over the atlas and
// the Carta, saved with the world's look and back after reopening.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-grid-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-grid-qa', configureServer(instance) { instance.middlewares.use('/__world_grid_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_grid_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_grid_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const look = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const r=await db.generatedWorlds.get('${W}');return r.presentation?.grid ?? null;})()`);
  const set = (sel, v) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const p=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await wait(`document.querySelector('[data-testid="worldgen-grid"] select')`, 'grid control');
  // The atlas canvas itself, hashed: the grid must change what the atlas draws, not only the Carta.
  const atlasHash = () => js(`(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i+=7)h=(h*31+d[i])|0;return h;})()`);
  let beforeGrid = await atlasHash(); for (let i = 0; i < 20; i++) { await pause(800); const again = await atlasHash(); if (again === beforeGrid) break; beforeGrid = again; }
  await set('[data-testid="worldgen-grid"] select', 'hex');
  await wait(`document.querySelector('[data-testid="worldgen-grid"] input')`, 'grid size');
  await set('[data-testid="worldgen-grid"] input', '400');
  let grid; for (let i = 0; i < 60; i++) { grid = await look(); if (grid?.km === 400) break; await pause(150); }
  assert(grid && grid.kind === 'hex' && grid.km === 400, `Grid not saved: ${JSON.stringify(grid)}`);
  tests.push('Choosing Hexes and 400 km in the toolbar saves the grid with the world\'s look');
  await pause(1200); const afterGrid = await atlasHash();
  assert(afterGrid !== beforeGrid, 'The atlas canvas did not change when the grid was turned on');
  tests.push('The atlas (Mapa) canvas draws the grid: its pixels change when the grid is turned on');
  await pause(1200); fs.writeFileSync(path.join(evidence, 'grid-atlas-1440.png'), (await win.webContents.capturePage()).toPNG());
  await click('Carta'); await pause(3500);
  fs.writeFileSync(path.join(evidence, 'grid-carta-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Atlas and Carta captured with the hex grid');
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  await wait(`document.querySelector('[data-testid="worldgen-grid"] select')?.value==='hex' && document.querySelector('[data-testid="worldgen-grid"] input')?.value==='400'`, 'grid restored');
  tests.push('Reopening restores the hex grid and its size in the toolbar');
  await set('[data-testid="worldgen-grid"] select', '');
  for (let i = 0; i < 60; i++) { grid = await look(); if (!grid) break; await pause(150); }
  assert(!grid, 'Turning the grid off was not saved');
  tests.push('Choosing No grid removes it from the saved look');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
