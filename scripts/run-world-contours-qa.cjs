// Contour lines through the normal toolbar: none on the atlas by default, a
// chosen interval draws them on the atlas and the Carta, it is saved with the
// world's look and back after reopening; "Sin curvas" takes them away.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-contours-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-contours-qa', configureServer(instance) { instance.middlewares.use('/__world_contours_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_contours_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_contours_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const send = event => win.webContents.sendInputEvent(event);
  const edits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const w=await db.generatedWorlds.get('${W}');return deserializeEdits(w.edits??'[]');})()`);
  const editsWhere = async (ok, what) => { let list; for (let i = 0; i < 80; i++) { list = await edits(); if (ok(list)) return list; await pause(150); } throw Error(`${what}: ${JSON.stringify(list).slice(-400)}`); };
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const drag = async (from, to) => {
    send({ type: 'mouseMove', x: from.x, y: from.y }); await pause(80);
    send({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 }); await pause(40);
    for (let s = 1; s <= 10; s++) { send({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * s / 10), y: Math.round(from.y + (to.y - from.y) * s / 10), button: 'left', modifiers: ['leftButtonDown'] }); await pause(25); }
    send({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 }); await pause(600);
  };
  const presentation = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return (await db.generatedWorlds.get('${W}')).presentation??{};})()`);
  const choose = value => js(`(()=>{const s=document.querySelector('[data-testid="worldgen-contours"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const sample = async () => { const r = await canvasRect(); win.webContents.invalidate(); await pause(300); await win.webContents.capturePage(); const img = await win.webContents.capturePage({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) }); return img.toBitmap(); };
  const diff = (a, b) => { let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 40) n++; return n; };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await wait(`document.querySelector('[data-testid="worldgen-contours"]')`, 'contours select');
  assert.equal(await js(`document.querySelector('[data-testid="worldgen-contours"]').value`), '', 'Contours start as the look draws them');
  await pause(1500);
  const plain = await sample();
  await choose('200');
  let saved; for (let i = 0; i < 80; i++) { saved = await presentation(); if (saved.contours === 200) break; await pause(150); }
  assert.equal(saved.contours, 200, `Saved ${JSON.stringify(saved)}`);
  await pause(1500);
  const lined = await sample();
  const atlasChange = diff(plain, lined);
  assert(atlasChange > 500, `Contours every 200 m should draw on the atlas (${atlasChange} pixels changed)`);
  fs.writeFileSync(path.join(evidence, 'contours-atlas-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Toolbar "Curvas cada 200 m" draws contour lines on the atlas (${atlasChange} pixels changed) and saves contours: 200 with the look`);
  await click('Carta'); await pause(4000);
  const cartaLined = await sample();
  fs.writeFileSync(path.join(evidence, 'contours-carta-1440.png'), (await win.webContents.capturePage()).toPNG());
  await choose('off');
  for (let i = 0; i < 80; i++) { saved = await presentation(); if (saved.contours === 'off') break; await pause(150); }
  assert.equal(saved.contours, 'off');
  await pause(3000);
  const cartaOff = await sample();
  const cartaChange = diff(cartaLined, cartaOff);
  assert(cartaChange > 300, `"Sin curvas" should take the lines off the Carta (${cartaChange} pixels changed)`);
  tests.push(`On the Carta the lines are drawn too; "Sin curvas" takes them off (${cartaChange} pixels changed) and saves contours: "off"`);
  await choose('500');
  for (let i = 0; i < 80; i++) { saved = await presentation(); if (saved.contours === 500) break; await pause(150); }
  await pause(800);
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  await wait(`document.querySelector('[data-testid="worldgen-contours"]')?.value==='500'`, 'contours after reopening');
  const rendered = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const g=await runBridgeTool('wh_get_world_presentation',{worldId:'${W}'});return g.ok?g.result:g;})()`);
  assert(JSON.stringify(rendered).includes('"contours":500'), `Bridge presentation ${JSON.stringify(rendered).slice(0, 300)}`);
  tests.push('Every 500 m chosen, reopened: the toolbar shows it and wh_get_world_presentation reports contours: 500');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
