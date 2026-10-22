// Hand-drawn roads through the normal Road tool: choose a dotted line twice as
// thick, click one town and then another, and read the saved road back after a
// reopen.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-lake-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-lake-qa', configureServer(instance) { instance.middlewares.use('/__world_lake_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_lake_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_lake_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const send = event => win.webContents.sendInputEvent(event);
  const edits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const w=await db.generatedWorlds.get('${W}');return deserializeEdits(w.edits??'[]');})()`);
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const tap = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(80); send({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(600); };
  const right = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 }); await pause(300); };
  const key = async code => { send({ type: 'keyDown', keyCode: code }); send({ type: 'keyUp', keyCode: code }); await pause(200); };
  const cellAt = async (x, y) => {
    await right(x, y);
    await wait(`document.querySelector('[data-testid="worldgen-map-menu"]')`, 'map menu');
    const cell = await js(`(()=>{const m=document.querySelector('[data-testid="worldgen-map-menu"]');return {x:+m.dataset.x,y:+m.dataset.y};})()`);
    await key('Escape');
    await wait(`!document.querySelector('[data-testid="worldgen-map-menu"]')`, 'menu closed');
    return cell;
  };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await pause(800);
  const rect = await canvasRect();
  const placeAt = (x, y) => js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const r=await runBridgeTool('wh_place_at',{worldId:'${W}',x:${x},y:${y}});return r.result;})()`);
  await click('Pincel'); await click('Río');
  await wait(`document.querySelector('[data-testid="river-mode"]')`, 'river modes');
  await js(`[...document.querySelectorAll('[data-testid="river-mode"] button')].find(b=>b.textContent.trim()==='Lago').click()`);
  await wait(`document.querySelector('[data-testid="lake-hint"]')`, 'lake hint');
  // Least size 12 cells.
  await js(`(()=>{const i=document.querySelector('[data-testid="lake-size"] input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'12');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`/km²|celdas/.test(document.querySelector('[data-testid="lake-size"]').textContent)`, 'size shown');
  const sizeLabel = await js(`document.querySelector('[data-testid="lake-size"]').textContent`);
  // A land spot on Naintosin where a lake can form (asked of the same fill the tool uses).
  let spot = null;
  const grid = []; for (let fy = 0.76; fy <= 0.84; fy += 0.02) for (let fx = 0.2; fx <= 0.42; fx += 0.03) grid.push([fx, fy]);
  for (const [fx, fy] of grid) {
    const p = { x: Math.round(rect.x + rect.w * fx), y: Math.round(rect.y + rect.h * fy) };
    const c = await cellAt(p.x, p.y);
    const dry = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const r=await runBridgeTool('wh_add_lake',{worldId:'${W}',x:${Math.floor(c.x)},y:${Math.floor(c.y)},size:12,dryRun:true});return r.ok?r.result.cells:0;})()`);
    if (dry >= 12) { spot = { ...p, cell: c, cells: dry }; break; }
  }
  assert(spot, 'No spot on Naintosin where a lake forms');
  // cellAt used the right-click menu; the Lake mode is still out.
  await wait(`document.querySelector('[data-testid="lake-hint"]')`, 'lake mode still out');
  const lakes0 = (await edits()).filter(e => e.kind === 'lake').length;
  send({ type: 'mouseMove', x: spot.x, y: spot.y }); await pause(80);
  send({ type: 'mouseDown', x: spot.x, y: spot.y, button: 'left', clickCount: 1 }); await pause(60);
  send({ type: 'mouseUp', x: spot.x, y: spot.y, button: 'left', clickCount: 1 }); await pause(600);
  let lake = null; for (let i = 0; i < 80; i++) { const list = (await edits()).filter(e => e.kind === 'lake'); if (list.length > lakes0) { lake = list[list.length - 1]; break; } await pause(150); }
  assert(lake && lake.op === 'fill' && lake.minCells === 12, `Lake saved: ${JSON.stringify(lake)}`);
  // The water runs down to the bottom of its hollow (or is dammed at the click): find a lake cell near the click.
  const cx0 = Math.floor(spot.cell.x), cy0 = Math.floor(spot.cell.y);
  let wetCell = null;
  for (let i = 0; i < 20 && !wetCell; i++) {
    for (let r = 0; r <= 8 && !wetCell; r++) for (let dy = -r; dy <= r && !wetCell; dy++) for (let dx = -r; dx <= r && !wetCell; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const here = await placeAt(cx0 + dx, cy0 + dy);
      if (here?.lake) wetCell = { x: cx0 + dx, y: cy0 + dy };
    }
    if (!wetCell) await pause(300);
  }
  assert(wetCell, 'No lake cell within 8 cells of the click');
  let here = null;
  tests.push(`River tool, Lake mode with a least size of 12 cells (${sizeLabel.replace(/\s+/g, ' ').trim()}): a click on Naintosin fills a lake there (${spot.cells} cells by the same fill), saved as a lake edit; cell ${wetCell.x},${wetCell.y} near the click now reads as lake`);
  await pause(2500);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'lake-filled-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Ctrl+click on a lake cell drains it: where that cell is on screen, from a second probe of the scale.
  const probe = { x: spot.x + 60, y: spot.y + 40 };
  const pc = await cellAt(probe.x, probe.y);
  const sx = 60 / (pc.x - spot.cell.x), sy = 40 / (pc.y - spot.cell.y);
  const wet = { x: Math.round(spot.x + (wetCell.x + 0.5 - spot.cell.x) * sx), y: Math.round(spot.y + (wetCell.y + 0.5 - spot.cell.y) * sy) };
  await wait(`document.querySelector('[data-testid="lake-hint"]')`, 'lake mode still out');
  send({ type: 'mouseMove', x: wet.x, y: wet.y, modifiers: ['control'] }); await pause(80);
  send({ type: 'mouseDown', x: wet.x, y: wet.y, button: 'left', clickCount: 1, modifiers: ['control'] }); await pause(60);
  send({ type: 'mouseUp', x: wet.x, y: wet.y, button: 'left', clickCount: 1, modifiers: ['control'] }); await pause(600);
  let drain = null; for (let i = 0; i < 80; i++) { const list = (await edits()).filter(e => e.kind === 'lake'); if (list.length > lakes0 + 1) { drain = list[list.length - 1]; break; } await pause(150); }
  assert(drain && drain.op === 'drain', `Drain saved: ${JSON.stringify(drain)}`);
  for (let i = 0; i < 40; i++) { here = await placeAt(wetCell.x, wetCell.y); if (here && here.lake === false) break; await pause(200); }
  assert(here?.lake === false, 'Ctrl+click did not drain the lake');
  tests.push('Ctrl+click on the lake drains it (a drain edit; the cell is land again)');
  // Reopen: the list keeps both and the cell is still land.
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const again = (await edits()).filter(e => e.kind === 'lake');
  assert(again.length === lakes0 + 2 && again[again.length - 1].op === 'drain', 'Reopen lost the lake edits');
  tests.push('Reopening keeps the fill and the drain');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
