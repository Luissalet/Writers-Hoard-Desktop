// The tabletop model's extras through the normal engine: the painted skin's
// trees standing up on the model, the block as paper sheets and as an
// engraving, clouds with their shadows; saved with the world's look and still
// there after reopening. Isolated hidden Electron profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-3d-model-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-3d-model-qa', configureServer(instance) { instance.middlewares.use('/__world_3d_model_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_3d_model_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_3d_model_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const shot = async name => { await pause(4000); win.webContents.invalidate(); await pause(500); await win.webContents.capturePage(); fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG()); };
  const host = key => js(`document.querySelector('[data-testid="world3d-host"]')?.dataset?.${key} ?? ''`);
  const hostWhere = async (key, ok, what) => { let v; for (let i = 0; i < 200; i++) { v = await host(key); if (ok(v)) return v; await pause(150); } throw Error(`${what}: ${key}=${v}`); };
  const W = 'world-presentation-preview-world';
  const stored = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const w=await db.generatedWorlds.get('${W}');return {block:w?.presentation?.block3D ?? null, clouds:w?.presentation?.clouds ?? null};})()`);
  const storedWhere = async (ok, what) => { let v; for (let i = 0; i < 80; i++) { v = await stored(); if (ok(v)) return v; await pause(150); } throw Error(`${what}: stored ${JSON.stringify(v)}`); };
  const setBlock = value => js(`(()=>{const el=document.querySelector('[data-testid="worldgen-block3d"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  const tests = [];
  await wait('window.__lookReady', 'preview'); await wait(button('Carta'), 'first forge');
  await click('Mundo 3D'); await pause(1500);
  await click('Plano'); await click('Pintado');
  // The painted skin on the tabletop: its trees stand up.
  const trees = Number(await hostWhere('groveTrees', v => Number(v) > 0, 'standing trees'));
  await shot('model-pintado-trees.png');
  tests.push(`Pintado on the tabletop model stands its trees up (${trees} little trees; model-pintado-trees.png)`);
  // The landscape keeps the painted trees on the ground and the landscape's plants.
  await js(`document.querySelector('[data-testid="worldgen-stage-paisaje"]').click()`);
  await hostWhere('groveTrees', v => v === '0', 'no standing trees in the landscape');
  await js(`document.querySelector('[data-testid="worldgen-stage-maqueta"]').click()`);
  await hostWhere('groveTrees', v => Number(v) > 0, 'standing trees back');
  tests.push('In the landscape the trees lie painted again; back on the model they stand');
  // The block: stacked paper (the land rises in sheets), then an engraving.
  await wait(`document.querySelector('[data-testid="worldgen-block3d"]')`, 'block control');
  await setBlock('papel');
  const sheet = Number(await hostWhere('terraceKm', v => Number(v) > 0, 'paper sheets'));
  await storedWhere(v => v.block === 'papel', 'paper saved');
  await shot('model-papel.png');
  tests.push(`Bloque: papel raises the land in ${sheet} km sheets and is saved with the look (model-papel.png)`);
  await setBlock('grabado');
  await hostWhere('terraceKm', v => v === '0', 'no sheets on the engraving');
  await hostWhere('block', v => v === 'grabado', 'engraved block');
  await storedWhere(v => v.block === 'grabado', 'engraving saved');
  await shot('model-grabado.png');
  tests.push('Bloque: grabado draws the block as an engraving, the land as it is (model-grabado.png)');
  // Clouds, with their shadows.
  await js(`document.querySelector('[data-testid="worldgen-clouds"] button').click()`);
  const clouds = Number(await hostWhere('clouds', v => Number(v) > 0, 'clouds'));
  await storedWhere(v => v.clouds === true, 'clouds saved');
  await shot('model-clouds.png');
  tests.push(`Clouds float over the model with their shadows (${clouds} clouds; model-clouds.png)`);
  // Closed and opened again: the look is the one left.
  await js('window.__lookUnmount()'); await pause(400); await js('window.__lookMount()');
  await wait(button('Carta'), 'forge after reopening');
  await click('Mundo 3D'); await pause(1500);
  await hostWhere('block', v => v === 'grabado', 'engraving after reopening');
  await hostWhere('clouds', v => Number(v) > 0, 'clouds after reopening');
  await wait(`document.querySelector('[data-testid="worldgen-block3d"]')?.value==='grabado'`, 'block control after reopening');
  await shot('model-reopened.png');
  tests.push('Reopened: still an engraved block under clouds (model-reopened.png)');
  // Back to the defaults, saved.
  await js(`document.querySelector('[data-testid="worldgen-clouds"] button').click()`);
  await setBlock('roca');
  await storedWhere(v => v.block === 'roca' && v.clouds === false, 'defaults saved back');
  await hostWhere('clouds', v => v === '0', 'clouds gone');
  tests.push('Rock and no clouds saved back');
  const failed = await js('window.__lookError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
