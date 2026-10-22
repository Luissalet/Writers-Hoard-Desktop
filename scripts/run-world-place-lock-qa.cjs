// Locking and duplicating a place through the normal Index card: lock a town,
// try to move it with the Move tool (nothing moves, a note says why), unlock it
// and move it, duplicate it, and reopen.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-place-lock-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-place-lock-qa', configureServer(instance) { instance.middlewares.use('/__world_place_lock_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_place_lock_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_place_lock_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const byId = id => js(`document.querySelector('[data-testid="${id}"]').click()`);
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
  const toastText = () => js(`[...document.querySelectorAll('[role=status],[role=alert]')].map(e=>e.textContent).join(' | ')`);
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  // The most important town, found through the Index search.
  const town = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');let list;for(let i=0;i<60;i++){list=await runBridgeTool('wh_list_places',{worldId:'${W}',kind:'settlement',limit:5});if(list.ok&&!list.result.pending)break;await new Promise(r=>setTimeout(r,500));}const p=list.result.places[0];return {key:p.key,name:p.name,x:p.x,y:p.y};})()`);
  await click('Índice');
  const search = `document.querySelector('input[placeholder="${await js(`(async()=>{const {useLocaleStore}=await import('/src/stores/localeStore.ts');return '';})()`)}"]')`;
  void search;
  await wait(`[...document.querySelectorAll('input')].find(i=>i.closest('[class]')&&i.placeholder==='Buscar un lugar…')`, 'index search');
  await js(`(()=>{const i=[...document.querySelectorAll('input')].find(i=>i.placeholder==='Buscar un lugar…');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(town.name)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(town.name)}))`, 'search result');
  await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(town.name)})).click()`);
  await wait(`document.querySelector('[data-testid="atlas-lock"]')`, 'place card');
  // Lock it.
  await byId('atlas-lock');
  await editsWhere(l => l.some(e => e.kind === 'lock' && e.key === town.key && e.locked), 'Lock saved');
  await wait(`document.querySelector('[data-testid="atlas-lock"]').getAttribute('aria-pressed')==='true' && document.querySelector('[data-testid="atlas-remove"]').disabled`, 'locked card');
  tests.push(`Index card for ${town.name}: Lock saves a lock edit, the button shows Unlock and Remove is disabled`);
  // Picking it in the Index flies the 3D view there; the flat map follows the same camera. The Move tool does not pick it up.
  await click('Mapa'); await pause(3000);
  const rect = await canvasRect();
  const centre = { x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2) };
  await click('Pincel'); await click('Mover'); await pause(300);
  const moves0 = (await edits()).filter(e => e.kind === 'move').length;
  await drag(centre, { x: centre.x + 60, y: centre.y + 30 });
  let note = ''; for (let i = 0; i < 30 && !/bloqueado/i.test(note); i++) { note = await toastText(); await pause(100); }
  if (!/bloqueado/i.test(note)) { win.webContents.invalidate(); await pause(300); await win.webContents.capturePage(); fs.writeFileSync(path.join(evidence, 'place-locked-failed-1440.png'), (await win.webContents.capturePage()).toPNG()); }
  await pause(500);
  { const now = await edits(); assert.equal(now.filter(e => e.kind === 'move').length, moves0, `A locked town was moved: ${JSON.stringify(now.filter(e => e.kind === 'move' || e.kind === 'lock'))} (town ${town.key})`); }
  assert(/bloqueado/i.test(note), `No note says it is locked: "${note}"`);
  tests.push(`Move tool on the locked town: nothing moves and a note says "${note.split(' | ').find(s => /bloqueado/i.test(s)).trim()}"`);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'place-locked-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Unlock in the card, then the same drag moves it.
  await click('Índice');
  await wait(`document.querySelector('[data-testid="atlas-lock"]')`, 'card again');
  await byId('atlas-lock');
  await editsWhere(l => { const last = l.filter(e => e.kind === 'lock' && e.key === town.key).pop(); return last && last.locked === false; }, 'Unlock saved');
  await click('Pincel'); await click('Mover'); await pause(300);
  // The first drag found nothing to pick up, so it panned the map by the same amount: the town is there now.
  const there = { x: centre.x + 60, y: centre.y + 30 };
  await drag(there, { x: there.x + 50, y: there.y + 20 });
  const moved = await editsWhere(l => l.filter(e => e.kind === 'move').length > moves0, 'Move after unlock');
  const move = moved.filter(e => e.kind === 'move').pop();
  assert.equal(move.key, town.key, 'Another place was moved');
  tests.push(`Unlocked, the same drag moves ${town.name} (to ${move.x.toFixed(1)}, ${move.y.toFixed(1)})`);
  // Duplicate from the card.
  await click('Índice');
  await wait(`document.querySelector('[data-testid="atlas-duplicate"]')`, 'duplicate button');
  const markers0 = (await edits()).filter(e => e.kind === 'marker').length;
  await byId('atlas-duplicate');
  const withCopy = await editsWhere(l => l.filter(e => e.kind === 'marker').length > markers0, 'Copy saved');
  const copy = withCopy.filter(e => e.kind === 'marker').pop();
  assert(copy.marker === 'settlement' && copy.name === `${town.name} 2`, `Copy ${JSON.stringify(copy)}`);
  tests.push(`Duplicate makes "${copy.name}", a ${copy.rank} (a capital's copy is a city) on free land beside ${town.name}`);
  // Lock again and reopen: the card still says it is locked.
  await wait(`document.querySelector('[data-testid="atlas-lock"]')`, 'card');
  await byId('atlas-lock');
  await editsWhere(l => { const last = l.filter(e => e.kind === 'lock' && e.key === town.key).pop(); return last && last.locked === true; }, 'Locked again');
  // An agent cannot hide it either while the view is open (the edit would land on the live list).
  const agent = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const r=await runBridgeTool('wh_remove_place',{worldId:'${W}',key:${JSON.stringify(town.key)}});return {ok:r.ok,error:r.error??''};})()`);
  assert(!agent.ok && /locked/.test(agent.error), `The bridge hid a locked town: ${JSON.stringify(agent)}`);
  tests.push(`With the view open, wh_remove_place on the locked town is refused ("${agent.error.slice(0, 60)}…")`);
  await pause(1200);
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  await click('Índice');
  await wait(`[...document.querySelectorAll('input')].find(i=>i.placeholder==='Buscar un lugar…')`, 'index search again');
  await js(`(()=>{const i=[...document.querySelectorAll('input')].find(i=>i.placeholder==='Buscar un lugar…');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(town.name)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(town.name)}) && !b.textContent.trim().startsWith(${JSON.stringify(town.name + ' 2')}))`, 'search result again');
  await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(town.name)}) && !b.textContent.trim().startsWith(${JSON.stringify(town.name + ' 2')})).click()`);
  await wait(`document.querySelector('[data-testid="atlas-lock"]')?.getAttribute('aria-pressed')==='true'`, 'locked after reopen');
  tests.push('Locked again and reopened: the card shows it locked');
  await pause(4000);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'place-card-1440.png'), (await win.webContents.capturePage()).toPNG());
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
