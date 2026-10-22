// Closing a river crossing through the map's right-click menu: "Sin paso por el
// río aquí" near a river saves a crossing edit and draws a cross on the water;
// right-clicking it again opens it; it survives reopening.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-crossing-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-crossing-qa', configureServer(instance) { instance.middlewares.use('/__world_crossing_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_crossing_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_crossing_qa`);
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
  const menuOpen = () => js(`!!document.querySelector('[data-testid="worldgen-map-menu"] [role=menuitem]')`);
  const right = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 }); for (let i = 0; i < 20 && !(await menuOpen()); i++) await pause(50); await pause(80); };
  const menuItems = () => js(`[...document.querySelectorAll('[data-testid="worldgen-map-menu"] [role=menuitem]')].map(b=>b.dataset.testid)`);
  const closeMenu = async () => { send({ type: 'keyDown', keyCode: 'Escape' }); send({ type: 'keyUp', keyCode: 'Escape' }); await pause(200); };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  const rect = await canvasRect();
  // Walk a grid of spots until the menu offers to close a crossing (a river runs within a cell).
  let spot = null;
  for (let fy = 0.2; fy <= 0.85 && !spot; fy += 0.05) for (let fx = 0.08; fx <= 0.92 && !spot; fx += 0.04) {
    const x = Math.round(rect.x + rect.w * fx), y = Math.round(rect.y + rect.h * fy);
    await right(x, y);
    const items = await menuItems();
    if (items.includes('worldgen-menu-crossing-block')) spot = { x, y };
    else await closeMenu();
  }
  assert(spot, 'No spot near a river offered "Sin paso por el río aquí"');
  // The cross sits on the river cell nearest the click, up to a cell and a half away: a generous area round it.
  const area = { x: spot.x - 60, y: spot.y - 60, width: 120, height: 120 };
  await closeMenu();
  send({ type: 'mouseMove', x: spot.x + 200, y: spot.y + 120 }); await pause(500);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage(area);
  const before = (await win.webContents.capturePage(area)).toBitmap();
  await right(spot.x, spot.y);
  await wait(`document.querySelector('[data-testid="worldgen-menu-crossing-block"]')`, 'close item');
  await js(`document.querySelector('[data-testid="worldgen-menu-crossing-block"]').click()`);
  const closed = await editsWhere(l => l.some(e => e.kind === 'crossing' && e.blocked === true), 'crossing closed');
  const edit = closed.find(e => e.kind === 'crossing');
  send({ type: 'mouseMove', x: spot.x + 200, y: spot.y + 120 }); await pause(600);
  // The cross is drawn over the names (a red stroke on a white halo); give the map a few frames to redraw.
  let red = 0;
  for (let attempt = 0; attempt < 12 && red <= 8; attempt++) {
    win.webContents.invalidate(); await pause(250); await win.webContents.capturePage(area);
    const after = (await win.webContents.capturePage(area)).toBitmap();
    red = 0; for (let i = 0; i < after.length; i += 4) if (after[i + 2] > 140 && after[i + 1] < 80 && after[i] < 90 && !(before[i + 2] > 140 && before[i + 1] < 80 && before[i] < 90)) red++;
  }
  assert(red > 8, `No cross drawn where the crossing was closed (${red} new red pixels)`);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'crossing-closed-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Right-click near a river → "Sin paso por el río aquí" saves a closed crossing at ${edit.x},${edit.y} and draws a red cross there (${red} pixels)`);
  // Right-click it again: the menu offers to open it.
  await right(spot.x, spot.y);
  await wait(`document.querySelector('[data-testid="worldgen-menu-crossing-open"]')`, 'open item');
  await js(`document.querySelector('[data-testid="worldgen-menu-crossing-open"]').click()`);
  await editsWhere(l => { const last = l.filter(e => e.kind === 'crossing').pop(); return last && last.blocked === false; }, 'crossing opened');
  tests.push('Right-clicking the same spot offers "Abrir de nuevo el paso", which saves the crossing open again');
  // Close it once more and reopen the world: the menu still knows it is closed.
  await right(spot.x, spot.y);
  await wait(`document.querySelector('[data-testid="worldgen-menu-crossing-block"]')`, 'close item again');
  await js(`document.querySelector('[data-testid="worldgen-menu-crossing-block"]').click()`);
  await editsWhere(l => { const last = l.filter(e => e.kind === 'crossing').pop(); return last && last.blocked === true; }, 'closed again');
  await pause(1000);
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  await pause(1500);
  await right(spot.x, spot.y);
  await wait(`document.querySelector('[data-testid="worldgen-menu-crossing-open"]')`, 'still closed after reopening');
  await closeMenu();
  tests.push('Closed again and reopened: right-clicking there offers to open it, so the closed crossing was kept');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
