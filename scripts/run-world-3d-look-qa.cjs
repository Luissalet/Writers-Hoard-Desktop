// The 3D world's look: opens the World 3D tab on the preview world and keeps a
// picture of every skin on the plane and on the globe, so a change to the
// renderer can be judged by eye against the last run.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-3d-look-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-3d-look-qa', configureServer(instance) { instance.middlewares.use('/__world_3d_look_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_3d_look_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_3d_look_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const shot = async name => { await pause(5000); win.webContents.invalidate(); await pause(500); await win.webContents.capturePage(); fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG()); };
  const tests = [];
  await wait('window.__lookReady', 'preview'); await wait(button('Carta'), 'first forge');
  await click('Mundo 3D');
  await pause(1500);
  const extra = (process.env.WH_3D_LOOK_EXTRA || '').split(',').filter(Boolean);
  for (const shape of ['Plano', 'Globo']) {
    await click(shape);
    for (const skin of ['Satélite', 'Dibujado', 'Arcilla', 'Pintado']) {
      await click(skin);
      const name = `3d-${shape.toLowerCase()}-${skin.normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase()}.png`;
      await shot(name);
      tests.push(`World 3D, ${shape} · ${skin}: ${name}`);
      for (const look of extra) { if (await js(`!!${button(look)}`)) { await click(look); await shot(name.replace('.png', `-${look.toLowerCase()}.png`)); await click(look); } }
    }
  }
  // The stage: the landscape instead of the model, saved with the world's look and still chosen after reopening.
  const W = 'world-presentation-preview-world';
  const stored = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const w=await db.generatedWorlds.get('${W}');return w?.presentation?.stage3D ?? null;})()`);
  const storedWhere = async (want, what) => { let v; for (let i = 0; i < 80; i++) { v = await stored(); if (v === want) return; await pause(150); } throw Error(`${what}: stored ${v}`); };
  await click('Plano'); await click('Satélite');
  const pressed = id => js(`document.querySelector('[data-testid="worldgen-stage-${id}"]')?.getAttribute('aria-pressed')`);
  assert.equal(await pressed('maqueta'), 'true', 'The model is the default stage');
  await js(`document.querySelector('[data-testid="worldgen-stage-paisaje"]').click()`);
  await storedWhere('paisaje', 'landscape saved');
  await shot('3d-plano-satelite-paisaje.png');
  // Close the world and open it again: the engine comes back from the database alone.
  await js('window.__lookUnmount()'); await pause(400); await js('window.__lookMount()');
  await wait(button('Carta'), 'forge after reopening');
  await click('Mundo 3D'); await pause(1500);
  await wait(`document.querySelector('[data-testid="worldgen-stage-paisaje"]')?.getAttribute('aria-pressed')==='true'`, 'landscape still chosen after reopening');
  await js(`document.querySelector('[data-testid="worldgen-stage-maqueta"]').click()`);
  await storedWhere('maqueta', 'model saved back');
  await shot('3d-plano-satelite-maqueta-reloaded.png');
  tests.push('Stage: Maqueta is the default on the plane; Paisaje is saved with the world\'s look (3d-plano-satelite-paisaje.png), still chosen after closing and reopening the world, and Maqueta saved back (3d-plano-satelite-maqueta-reloaded.png)');
  const failed = await js('window.__lookError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
