// Terrain and rivers through the normal Brush: a volcano with a click, the
// ground set to a height in metres, a river put down point by point and turned
// round from the right-click menu; read back after reopening.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-terrain-ops-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-terrain-ops-qa', configureServer(instance) { instance.middlewares.use('/__world_terrain_ops_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_terrain_ops_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_terrain_ops_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const send = event => win.webContents.sendInputEvent(event);
  const edits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const w=await db.generatedWorlds.get('${W}');return deserializeEdits(w.edits??'[]');})()`);
  const editWhere = async (ok, what) => { let list; for (let i = 0; i < 80; i++) { list = await edits(); const hit = list.filter(ok); if (hit.length) return hit[hit.length - 1]; await pause(150); } throw Error(`${what}: ${JSON.stringify(list).slice(-400)}`); };
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const tap = async (x, y, clickCount = 1) => { send({ type: 'mouseMove', x, y }); await pause(80); send({ type: 'mouseDown', x, y, button: 'left', clickCount }); await pause(60); send({ type: 'mouseUp', x, y, button: 'left', clickCount }); await pause(500); };
  const right = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 }); await pause(300); };
  const key = async code => { send({ type: 'keyDown', keyCode: code }); send({ type: 'keyUp', keyCode: code }); await pause(250); };
  const cellAt = async (x, y) => {
    await right(x, y);
    await wait(`document.querySelector('[data-testid="worldgen-map-menu"]')`, 'map menu');
    const cell = await js(`(()=>{const m=document.querySelector('[data-testid="worldgen-map-menu"]');return {x:+m.dataset.x,y:+m.dataset.y};})()`);
    await key('Escape');
    await wait(`!document.querySelector('[data-testid="worldgen-map-menu"]')`, 'menu closed');
    return cell;
  };
  const isLand = c => js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');for(let i=0;i<40;i++){const r=await runBridgeTool('wh_place_at',{worldId:'${W}',x:${Math.floor(c.x)},y:${Math.floor(c.y)}});if(r.ok&&!r.result.pending)return r.result.sea===false&&!r.result.lake&&r.result.elevation>0.05;await new Promise(s=>setTimeout(s,300));}return false;})()`);
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await pause(800);
  const rect = await canvasRect();
  // Land spots on screen, asked of the world itself.
  const spots = [];
  for (let fy = 0.3; fy <= 0.8 && spots.length < 6; fy += 0.05) for (let fx = 0.15; fx <= 0.85 && spots.length < 6; fx += 0.05) {
    const p = { x: Math.round(rect.x + rect.w * fx), y: Math.round(rect.y + rect.h * fy) };
    const c = await cellAt(p.x, p.y);
    if (await isLand(c)) spots.push({ ...p, cell: c });
  }
  assert(spots.length >= 2, `Land spots: ${spots.length}`);
  await click('Pincel'); await click('Relieve');
  await click('Volcán');
  await wait(`document.querySelector('[data-testid="paint-volcano-hint"]')`, 'volcano hint');
  const n0 = (await edits()).length;
  await tap(spots[0].x, spots[0].y);
  const volcano = await editWhere(e => e.kind === 'terrain' && e.op === 'volcano', 'volcano saved');
  assert((await edits()).length === n0 + 1, 'One edit for the volcano');
  tests.push(`Relieve → Volcán: a click on land at ${Math.floor(volcano.stroke.pts[0].x)},${Math.floor(volcano.stroke.pts[0].y)} saves one volcano edit`);
  await click('Altura');
  await wait(`document.querySelector('[data-testid="paint-height"] input')`, 'height input');
  await js(`(()=>{const i=document.querySelector('[data-testid="paint-height"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'1500');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('[data-testid="paint-height"] input').value==='1500'`, 'height shown');
  await tap(spots[1].x, spots[1].y);
  const height = await editWhere(e => e.kind === 'terrain' && e.op === 'height', 'height saved');
  assert(height.stroke.heightM === 1500, `Height ${JSON.stringify(height.stroke)}`);
  tests.push('Relieve → Altura 1500 m: a click saves the ground set to 1,500 m');
  await pause(2500);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'terrain-volcano-height.png'), (await win.webContents.capturePage()).toPNG());
  // A river point by point: three clicks and Intro.
  await click('Río');
  await js(`[...document.querySelectorAll('[data-testid="river-mode"] button')].find(b=>b.textContent.trim()==='Por puntos').click()`);
  await wait(`document.querySelector('[data-testid="river-points-hint"]')`, 'points hint');
  const a = spots[0], b = { x: a.x + 30, y: a.y + 18 }, c = { x: a.x + 62, y: a.y + 10 };
  const rivers0 = (await edits()).filter(e => e.kind === 'river').length;
  await tap(a.x, a.y); await tap(b.x, b.y); await tap(c.x, c.y);
  assert((await edits()).filter(e => e.kind === 'river').length === rivers0, 'No river before finishing');
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'river-points-open.png'), (await win.webContents.capturePage()).toPNG());
  await key('Return');
  const river = await editWhere(e => e.kind === 'river' && e.pts.length === 3, 'river saved');
  tests.push(`Río → Por puntos: three clicks draw nothing until Intro, then save one river through the three points (spring at ${Math.floor(river.pts[0].x)},${Math.floor(river.pts[0].y)})`);
  // Esc throws a half-drawn river away; Retroceso takes a point back.
  await tap(c.x + 40, c.y + 30); await tap(c.x + 60, c.y + 40); await key('Back'); await key('Escape');
  await pause(400);
  assert((await edits()).filter(e => e.kind === 'river').length === rivers0 + 1, 'Esc drew nothing');
  tests.push('Two more clicks, Retroceso and Esc: nothing is drawn');
  // Right-click on the river: turn it round.
  await pause(1500);
  await right(b.x, b.y);
  await wait(`document.querySelector('[data-testid="worldgen-menu-river-reverse"]')`, 'reverse item');
  await js(`document.querySelector('[data-testid="worldgen-menu-river-reverse"]').click()`);
  await editWhere(e => e.kind === 'reverseRiver', 'reverse saved');
  tests.push('Right-click on the river → "Invertir el sentido del río" saves the turn');
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'river-reversed.png'), (await win.webContents.capturePage()).toPNG());
  // Reopened: all four edits are there.
  await js('window.__lookUnmount()'); await pause(300); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const after = await edits();
  assert(after.some(e => e.kind === 'terrain' && e.op === 'volcano') && after.some(e => e.kind === 'terrain' && e.op === 'height' && e.stroke.heightM === 1500) && after.some(e => e.kind === 'river' && e.pts.length === 3) && after.some(e => e.kind === 'reverseRiver'), 'Kept after reopening');
  tests.push('Reopened: the volcano, the height, the river and its turn are kept');
  const failed = await js('window.__lookError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
