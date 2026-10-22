// Painting ground through the normal Brush: a fantasy ground from its own
// swatch row, the one-click Plateau head on the Relief tool, and the view's
// band readout ("World · N km across") following the zoom.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-grounds-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-grounds-qa', configureServer(instance) { instance.middlewares.use('/__world_grounds_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_grounds_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_grounds_qa`);
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
  const band = () => js(`(()=>{const b=document.querySelector('[data-testid="worldgen-view-band"]');return b?{tier:b.dataset.tier,text:b.textContent.trim()}:null;})()`);
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  // The band readout, at the opening zoom and after zooming in with the wheel.
  await wait(`document.querySelector('[data-testid="worldgen-view-band"]')`, 'band readout');
  const band0 = await band();
  assert(/km de ancho$/.test(band0.text), `Band ${JSON.stringify(band0)}`);
  const rect = await canvasRect();
  const centre = { x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2) };
  // A fantasy ground from its own row of swatches, painted with a drag.
  await click('Pincel'); await click('Bioma');
  const swatch = `document.querySelector('button[title="Bosque fúngico"]')`;
  await wait(swatch, 'fungal forest swatch');
  const group = await js(`(()=>{const s=${swatch};return s.closest('div').parentElement.firstElementChild.textContent.trim();})()`);
  assert.equal(group, 'Fantásticos', 'The fantasy grounds have their own row');
  await js(`${swatch}.click()`);
  const before = (await edits()).filter(e => e.kind === 'biome').length;
  // A long stroke across the lower part of the view, so it crosses land as well as sea.
  await drag({ x: Math.round(rect.x + rect.w * 0.1), y: Math.round(rect.y + rect.h * 0.75) }, { x: Math.round(rect.x + rect.w * 0.9), y: Math.round(rect.y + rect.h * 0.78) });
  const painted = await editsWhere(l => l.filter(e => e.kind === 'biome').length > before, 'fungal stroke saved');
  const stroke = painted.filter(e => e.kind === 'biome').pop();
  assert.equal(stroke.biome, 41, `Painted biome ${stroke.biome}`);
  win.webContents.invalidate(); await pause(400); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'grounds-fungal-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Pincel → Bioma has a "Fantásticos" row; "Bosque fúngico" painted with a drag saves a biome stroke of ground 41 (${stroke.stroke.pts.length} points)`);
  // Plateau: one click sets the Relief tool's square flat head; a drag saves a square, flat-edged lift.
  await click('Relieve');
  await wait(`document.querySelector('[data-testid="paint-plateau"]')`, 'plateau button');
  await js(`document.querySelector('[data-testid="paint-plateau"]').click()`);
  await wait(`document.querySelector('[data-testid="paint-plateau"]').getAttribute('aria-pressed')==='true'`, 'plateau pressed');
  const terrain0 = (await edits()).filter(e => e.kind === 'terrain').length;
  await drag({ x: centre.x - 40, y: centre.y + 60 }, { x: centre.x + 40, y: centre.y + 60 });
  const lifted = await editsWhere(l => l.filter(e => e.kind === 'terrain').length > terrain0, 'plateau stroke saved');
  const lift = lifted.filter(e => e.kind === 'terrain').pop();
  assert(lift.op === 'raise' && lift.stroke.tip === 'square' && lift.stroke.curve === 'flat', `Plateau stroke ${JSON.stringify(lift).slice(0, 300)}`);
  tests.push(`Relieve → Meseta in one click: the drag saves a raise with a square head and a flat edge`);
  // Wheel towards zooming in (Electron's sign for the wheel is the opposite of the DOM's on some builds: try one way, then the other).
  const changed = `document.querySelector('[data-testid="worldgen-view-band"]')?.textContent.trim() !== ${JSON.stringify(band0.text)}`;
  const km = text => Number(text.replace(/[^\d]/g, ''));
  for (const dy of [240, -240]) {
    send({ type: 'mouseMove', x: centre.x, y: centre.y }); await pause(100);
    for (let i = 0; i < 12; i++) { send({ type: 'mouseWheel', x: centre.x, y: centre.y, deltaX: 0, deltaY: dy, canScroll: true }); await pause(60); }
    await pause(800);
    if (await js(changed) && km((await band()).text) < km(band0.text)) break;
  }
  await wait(changed, 'band follows the zoom');
  await pause(600);
  const band1 = await band();
  assert(km(band1.text) < km(band0.text), `Zooming in should narrow the view: ${band0.text} → ${band1.text}`);
  tests.push(`View band: "${band0.text}" at the opening zoom, "${band1.text}" after zooming in with the wheel`);
  // Reopen: the fungal ground is still there (the bridge reads the cell under the stroke).
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const under = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const raw=${JSON.stringify(stroke.stroke.pts)};const pts=[];for(let k=1;k<raw.length;k++){for(let t=0;t<=40;t++){pts.push({x:raw[k-1].x+(raw[k].x-raw[k-1].x)*t/40,y:raw[k-1].y+(raw[k].y-raw[k-1].y)*t/40});}}if(raw.length===1)pts.push(raw[0]);let seen=[];for(const p of pts){let r;for(let i=0;i<60;i++){r=await runBridgeTool('wh_place_at',{worldId:'${W}',x:Math.round(p.x),y:Math.round(p.y)});if(r.ok&&!r.result.pending)break;await new Promise(z=>setTimeout(z,500));}seen.push(r.result.ground);if(r.result.ground==='fungalForest')return r.result;}return {ground:null,seen:[...new Set(seen)]};})()`);
  assert.equal(under.ground, 'fungalForest', `After reopening, the ground under the stroke: ${JSON.stringify(under).slice(0, 300)}`);
  tests.push(`Reopened: wh_place_at under the stroke reads ground "${under.ground}"`);
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
