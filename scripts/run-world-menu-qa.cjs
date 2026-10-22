// The world map's right-click menu through trusted input: a village, a note,
// a story event and a spring that runs downhill, each at the clicked spot,
// Escape, and reopen.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-menu-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-menu-qa', configureServer(instance) { instance.middlewares.use('/__world_menu_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_menu_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_menu_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const byId = id => js(`document.querySelector('[data-testid="${id}"]').click()`);
  const setValue = (selector, value, kind = 'HTMLInputElement', event = 'input') => js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(i,${JSON.stringify(String(value))});i.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const storyEdits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const {storyEventsFrom}=await import('/src/engines/worldgen/core/storyEvents.ts');const r=await db.generatedWorlds.get('${W}');const e=deserializeEdits(r.edits||'[]');return {raw:e.filter(x=>x.kind==='story'||x.kind==='storyRemove').length,events:storyEventsFrom(e)};})()`);
  const send = event => win.webContents.sendInputEvent(event);
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const tap = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(500); };

  const edits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const w=await db.generatedWorlds.get('${W}');return deserializeEdits(w.edits??'[]');})()`);
  // The painting session saves after a short pause: read until the change is there.
  const editsWhere = async (ok, what) => { let list; for (let i = 0; i < 80; i++) { list = await edits(); if (ok(list)) return list; await pause(150); } throw Error(`${what}: ${JSON.stringify(list).slice(0, 400)}`); };
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(400); };
  const right = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 }); await pause(300); };
  const menuAt = async (x, y) => { await right(x, y); await wait(`document.querySelector('[data-testid="worldgen-map-menu"]')`, 'map menu'); return js(`[...document.querySelectorAll('[data-testid="worldgen-map-menu"] [role=menuitem]')].map(b=>b.dataset.testid)`); };
  const ask = async (item, value) => { await byId(item); await wait(`document.querySelector('[data-testid="worldgen-menu-text"]')`, 'menu field'); await setValue('[data-testid="worldgen-menu-text"]', value); await byId('worldgen-menu-create'); await pause(300); };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  const rect = await canvasRect();
  const A = { x: Math.round(rect.x + rect.w * 0.45), y: Math.round(rect.y + rect.h * 0.45) };
  const before = (await edits()).length;
  // 1. The menu and its items.
  const items = await menuAt(A.x, A.y);
  assert.deepEqual(items, ['worldgen-menu-place', 'worldgen-menu-label', 'worldgen-menu-spring', 'worldgen-menu-story'], `Items ${items}`);
  const spot = await js(`(()=>{const m=document.querySelector('[data-testid="worldgen-map-menu"]');return {x:+m.dataset.x,y:+m.dataset.y};})()`);
  fs.writeFileSync(path.join(evidence, 'world-menu-1440.png'), (await win.webContents.capturePage()).toPNG());
  // 3. A label here.
  await menuAt(A.x + 40, A.y + 30); await ask('worldgen-menu-label', 'Aquí hay dragones');
  let list = await editsWhere(l => l.some(e => e.kind === 'label' && e.text === 'Aquí hay dragones'), 'Label saved');
  assert(list.some(e => e.kind === 'label' && e.text === 'Aquí hay dragones' && e.style === 'note'), 'Label');
  tests.push('Right-click → "Texto aquí" writes the note "Aquí hay dragones" there');
  // 4. A story event here.
  await menuAt(A.x - 40, A.y + 20); await ask('worldgen-menu-story', 'Encuentro en el camino');
  list = await editsWhere(l => l.some(e => e.kind === 'story' && e.title === 'Encuentro en el camino'), 'Story saved');
  assert(list.some(e => e.kind === 'story' && e.title === 'Encuentro en el camino' && e.status === 'happened'), 'Story event');
  tests.push('Right-click → "Suceso aquí" adds the event "Encuentro en el camino" at that spot');
  // 5. A spring: the river runs downhill on its own. Try a few spots until one is on land.
  let river = null, tries = 0, landAt = null;
  for (const [fx, fy] of [[0.45, 0.4], [0.35, 0.35], [0.55, 0.5], [0.3, 0.55], [0.6, 0.3], [0.5, 0.6], [0.4, 0.5], [0.25, 0.3]]) {
    tries++;
    const n = (await edits()).filter(e => e.kind === 'river').length;
    await menuAt(Math.round(rect.x + rect.w * fx), Math.round(rect.y + rect.h * fy)); await byId('worldgen-menu-spring'); await pause(300);
    let rivers = []; for (let i = 0; i < 20; i++) { rivers = (await edits()).filter(e => e.kind === 'river'); if (rivers.length > n) break; await pause(150); }
    if (rivers.length > n) { river = rivers[rivers.length - 1]; landAt = { x: Math.round(rect.x + rect.w * fx), y: Math.round(rect.y + rect.h * fy) }; break; }
  }
  assert(river && river.pts.length >= 2 && river.width === 2, `No spring ran after ${tries} tries`);
  tests.push(`Right-click → "Manantial aquí": a river of ${river.pts.length} points runs downhill from the spot (found land on try ${tries}; sea spots say the water has nowhere to run)`);
  // 2. A village on the land the spring rose from.
  const landSpot = await menuAt(landAt.x, landAt.y).then(() => js(`(()=>{const m=document.querySelector('[data-testid="worldgen-map-menu"]');return {x:+m.dataset.x,y:+m.dataset.y};})()`));
  await ask('worldgen-menu-place', 'Villaprueba');
  list = await editsWhere(l => l.some(e => e.kind === 'marker' && e.name === 'Villaprueba'), 'Village saved');
  const village = list.find(e => e.kind === 'marker' && e.name === 'Villaprueba');
  assert(village && village.marker === 'settlement' && village.rank === 'village' && village.x === Math.floor(landSpot.x) && village.y === Math.floor(landSpot.y), `Village ${JSON.stringify(village)}`);
  tests.push(`Right-click → "Pueblo aquí" places the village Villaprueba on the clicked land cell (${Math.floor(landSpot.x)}, ${Math.floor(landSpot.y)})`);
  await settle(); fs.writeFileSync(path.join(evidence, 'world-menu-river-1440.png'), (await win.webContents.capturePage()).toPNG());
  // 6. Escape closes it and changes nothing.
  const count = (await edits()).length;
  await menuAt(A.x, A.y); send({ type: 'keyDown', keyCode: 'Escape' }); send({ type: 'keyUp', keyCode: 'Escape' }); await pause(300);
  await wait(`!document.querySelector('[data-testid="worldgen-map-menu"]')`, 'menu closed');
  assert.equal((await edits()).length, count, 'Escape changed the world');
  tests.push('Escape closes the menu and changes nothing');
  // 7. Reopen: all of it is still there.
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  list = await edits();
  assert(list.length === count && list.length >= before + 4, `Reopen ${list.length}`);
  tests.push(`Reopening keeps the ${list.length - before} additions`);
  // The village is a real place of the atlas now, under its name.
  let found; for (let i = 0; i < 40; i++) { found = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');return runBridgeTool('wh_find_place',{worldId:'${W}',query:'Villaprueba'});})()`); if (found.ok && found.result.places?.length) break; await pause(500); }
  assert(found.ok && found.result.places?.some(p => p.name === 'Villaprueba'), `Find Villaprueba ${JSON.stringify(found).slice(0, 300)}`);
  tests.push('wh_find_place finds "Villaprueba" in the atlas');
  await wait(`!document.body.textContent.includes('recalculando')`, 'recalculation done', 400);
  await settle(); fs.writeFileSync(path.join(evidence, 'world-menu-reopen-1440.png'), (await win.webContents.capturePage()).toPNG());
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
