// Named zones through the normal engine: "Start a zone here" from the map's
// right-click menu, the other corners clicked, Intro to close it with the name
// typed in the panel; renamed in the list, reopened, and removed.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-zones-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-zones-qa', configureServer(instance) { instance.middlewares.use('/__world_zones_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_zones_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_zones_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const send = event => win.webContents.sendInputEvent(event);
  const edits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const w=await db.generatedWorlds.get('${W}');return deserializeEdits(w.edits??'[]');})()`);
  const zonesNow = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const {zonesFrom}=await import('/src/engines/worldgen/core/zones.ts');const w=await db.generatedWorlds.get('${W}');return zonesFrom(deserializeEdits(w.edits??'[]'));})()`);
  const zonesWhere = async (ok, what) => { let z; for (let i = 0; i < 80; i++) { z = await zonesNow(); if (ok(z)) return z; await pause(150); } throw Error(`${what}: ${JSON.stringify(z).slice(0, 300)}`); };
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const tap = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(80); send({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(400); };
  const right = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 }); await pause(300); };
  const key = async code => { send({ type: 'keyDown', keyCode: code }); send({ type: 'keyUp', keyCode: code }); await pause(250); };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await pause(800);
  const rect = await canvasRect();
  const a = { x: Math.round(rect.x + rect.w * 0.4), y: Math.round(rect.y + rect.h * 0.45) };
  // Right-click: "Empezar una zona aquí".
  await right(a.x, a.y);
  await wait(`document.querySelector('[data-testid="worldgen-menu-zone-start"]')`, 'zone item');
  await js(`document.querySelector('[data-testid="worldgen-menu-zone-start"]').click()`);
  await wait(`document.querySelector('[data-testid="zone-editor"]')`, 'zone tool out');
  await js(`(()=>{const i=document.querySelector('[data-testid="zone-name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'La Marca del Norte');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await js(`[...document.querySelectorAll('[data-testid="zone-patterns"] button')].find(b=>b.textContent.trim()==='Rayado').click()`);
  await pause(300);
  await tap(a.x + 120, a.y); await tap(a.x + 140, a.y + 90); await tap(a.x - 10, a.y + 100);
  assert(!(await zonesNow()).length, 'Nothing before closing');
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'zone-open.png'), (await win.webContents.capturePage()).toPNG());
  await key('Return');
  const zones = await zonesWhere(z => z.length === 1, 'zone saved');
  assert(zones[0].name === 'La Marca del Norte' && zones[0].pts.length === 4 && zones[0].pattern === 'hatch', `Zone ${JSON.stringify(zones[0])}`);
  await pause(1500);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'zone-drawn.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Right-click → "Empezar una zona aquí" brings out the Zones tool with the first corner there; three more clicks and Intro save "La Marca del Norte", hatched, with four corners (zone-drawn.png)');
  // The list: rename it.
  await wait(`document.querySelector('[data-testid="zone-list"] input')`, 'zone list');
  await js(`(()=>{const i=document.querySelector('[data-testid="zone-list"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'La Marca');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`);
  await zonesWhere(z => z[0]?.name === 'La Marca', 'renamed');
  tests.push('Renamed in the list to "La Marca"');
  // Reopen: still there.
  await js('window.__lookUnmount()'); await pause(300); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const kept = await zonesNow();
  assert(kept.length === 1 && kept[0].name === 'La Marca', 'Kept after reopening');
  tests.push('Reopened: the zone is kept');
  // Remove it from the list.
  await js(`${button('Pincel')}?.click()`); await pause(300);
  await js(`${button('Zonas')}?.click()`);
  await wait(`document.querySelector('[data-testid^="zone-remove-"]')`, 'remove button');
  await js(`document.querySelector('[data-testid^="zone-remove-"]').click()`);
  await zonesWhere(z => z.length === 0, 'removed');
  const removals = (await edits()).filter(e => e.kind === 'zoneRemove').length;
  assert(removals === 1, 'One removal edit');
  tests.push('Quitar takes it off (one undoable removal edit)');
  const failed = await js('window.__lookError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
