// Classic map: the Codex link picker (search, create as a type) and the map's
// right-click menu (new entry here, pin, region, label, comment here), through
// the normal editor with trusted input, saved and re-read after a reload.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-map-picker-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'map-picker-qa', configureServer(instance) { instance.middlewares.use('/__map_picker_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__map_picker_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/vvd-map-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1520, height: 1240, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__map_picker_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 300) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__mapError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const until = async (read, ok, what, tries = 60) => { let value; for (let i = 0; i < tries; i++) { value = await read(); if (ok(value)) return value; await pause(100); } throw Error(`${what}: ${JSON.stringify(value)}`); };
  const byId = id => js(`document.querySelector('[data-testid="${id}"]').click()`);
  const set = (id, value) => js(`(()=>{const i=document.querySelector('[data-testid="${id}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(String(value))});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const db = body => js(`(async()=>{const {db}=await import('/src/db/index.ts');${body}})()`);
  const map = () => db(`return db.worldMaps.get('vvd-map-preview-atlas');`);
  const shot = async name => { await pause(250); fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG()); };
  // A spot on the map image, in percent, as screen coordinates (the map may be zoomed out).
  const spot = (x, y) => js(`(()=>{const s=document.querySelector('[data-testid="map-surface"]');s.scrollIntoView({block:'center'});const r=s.getBoundingClientRect();return {x:Math.round(r.left+r.width*${x}/100),y:Math.round(r.top+r.height*${y}/100)};})()`);
  const press = async (at, button = 'left') => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y }); await pause(40);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button, clickCount: 1 }); await pause(40);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button, clickCount: 1 }); await pause(200);
  };
  const menuAt = async (x, y) => { await press(await spot(x, y), 'right'); await wait(`document.querySelector('[data-testid="map-context-menu"]')`, 'context menu'); return js(`(()=>{const m=document.querySelector('[data-testid="map-context-menu"]');return {x:+m.dataset.x,y:+m.dataset.y,items:[...m.querySelectorAll('[role=menuitem]')].map(b=>b.dataset.testid)};})()`); };
  const near = (a, b, tolerance = 0.8) => Math.abs(a - b) <= tolerance;
  const tests = [];
  await wait('window.__mapReady', 'map preview');

  // 1. Link picker on a shape: accent-free search, then create a new entry as a chosen type.
  await byId('map-feature-select-road');
  await wait(`document.querySelector('[data-testid="map-feature-link"]')`, 'link picker');
  await byId('map-feature-link'); await wait(`document.querySelector('[data-testid="map-feature-link-search"]')`, 'search box');
  await set('map-feature-link-search', 'avila'); await pause(150);
  const found = await js(`[...document.querySelectorAll('[data-testid^="map-feature-link-option-"]')].map(o=>o.dataset.testid)`);
  assert.deepEqual(found, ['map-feature-link-option-avila'], `Search "avila": ${found}`);
  await set('map-feature-link-search', 'Torre del Alba'); await pause(150);
  await byId('map-feature-link-type-next'); await byId('map-feature-link-type-next'); await pause(100);
  const chosen = await js(`document.querySelector('[data-testid="map-feature-link-type"]').dataset.type`);
  assert.equal(chosen, 'faction', 'Type stepping');
  await shot('map-picker-create-1520.png');
  await byId('map-feature-link-create');
  await wait(`/Torre del Alba/.test(document.querySelector('[data-testid="map-feature-link"]').textContent)`, 'picker shows the new entry');
  await byId('map-feature-save');
  const road = await until(async () => (await map()).features.find(f => f.id === 'road'), f => !!f.linkedEntryId && f.linkedEntryId !== 'avila', 'Road link');
  const alba = await db(`return db.codexEntries.get(${JSON.stringify(road.linkedEntryId)});`);
  assert(alba && alba.title === 'Torre del Alba' && alba.type === 'faction', `New entry ${JSON.stringify(alba)}`);
  tests.push('Link picker: "avila" finds "Ávila del Estuario" only; "Torre del Alba" created as a faction from the picker and linked to Camino de la Sal, saved');

  // 2. Link picker on a pin: pick an existing entry by search.
  const harbour = await js(`(()=>{const r=document.querySelector('[data-testid="map-pin-marker-harbour"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  await press(harbour);
  await wait(`document.querySelector('[data-testid="map-pin-link"]')`, 'pin link picker');
  await byId('map-pin-link'); await wait(`document.querySelector('[data-testid="map-pin-link-search"]')`, 'pin search');
  await set('map-pin-link-search', 'orden'); await pause(150);
  await byId('map-pin-link-option-orden'); await pause(100);
  await byId('map-pin-save');
  await until(() => db(`return db.mapPins.get('harbour');`), p => p.linkedEntryId === 'orden', 'Pin link');
  tests.push('Puerto del Viento linked to "Orden de la Sal" by typing "orden" in the pin picker, saved');

  // 3. Right-click: new entry here (a pin linked to a new place).
  const first = await menuAt(60, 30);
  assert(near(first.x, 60) && near(first.y, 30), `Menu spot ${JSON.stringify(first)}`);
  assert.deepEqual(first.items, ['map-menu-new-entry', 'map-menu-add-pin', 'map-menu-region', 'map-menu-path', 'map-menu-label', 'map-menu-comment'], `Menu items ${first.items}`);
  await shot('map-picker-menu-1520.png');
  await byId('map-menu-new-entry'); await wait(`document.querySelector('[data-testid="map-menu-entry-name"]')`, 'name box');
  await set('map-menu-entry-name', 'Vado Gris'); await byId('map-menu-entry-create');
  const vado = await until(() => db(`return (await db.mapPins.where('mapId').equals('vvd-map-preview-atlas').toArray()).find(p=>p.name==='Vado Gris');`), p => !!p, 'New pin');
  const vadoEntry = await db(`return db.codexEntries.get(${JSON.stringify(vado.linkedEntryId)});`);
  assert(near(vado.position.x, 60) && near(vado.position.y, 30) && vadoEntry?.title === 'Vado Gris' && vadoEntry.type === 'location' && vado.icon === 'city', `Vado ${JSON.stringify({ vado, vadoEntry })}`);
  await wait(`!document.querySelector('[data-testid="map-context-menu"]') && document.querySelector('[data-testid="map-pin-marker-${vado.id}"]')`, 'pin drawn and menu closed');
  tests.push(`Right-click → "Nueva ficha aquí" "Vado Gris": a place entry and a pin linked to it at ${vado.position.x.toFixed(1)}%, ${vado.position.y.toFixed(1)}% (clicked 60%, 30%)`);

  // 4. Right-click: start a region here, then two more clicks and finish.
  const count0 = (await map()).features.length;
  await menuAt(62, 75); await byId('map-menu-region'); await pause(150);
  await press(await spot(72, 74)); await press(await spot(67, 88));
  await byId('map-feature-finish');
  const region = await until(async () => (await map()).features, f => f.length === count0 + 1, 'Region').then(f => f[f.length - 1]);
  assert(region.kind === 'region' && region.points.length === 3 && near(region.points[0].x, 62) && near(region.points[0].y, 75), `Region ${JSON.stringify(region.points)}`);
  tests.push(`Right-click → "Empezar región aquí": the region starts at the clicked spot (${region.points[0].x.toFixed(1)}%, ${region.points[0].y.toFixed(1)}%) and takes two more clicks`);

  // 5. Right-click: a label here, placed at once.
  await menuAt(15, 85); await byId('map-menu-label');
  const label = await until(async () => (await map()).features, f => f.length === count0 + 2, 'Label').then(f => f[f.length - 1]);
  assert(label.kind === 'label' && near(label.points[0].x, 15) && near(label.points[0].y, 85), `Label ${JSON.stringify(label)}`);
  tests.push('Right-click → "Rótulo aquí": a label placed at the clicked spot in one step');

  // 6. Right-click: comment here. The notes composer opens with the spot; the comment shows as a marker.
  await menuAt(50, 70); await byId('map-menu-comment');
  await wait(`document.querySelector('textarea[data-comment-body]')`, 'comment composer');
  await js(`(()=>{const t=document.querySelector('textarea[data-comment-body]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'¿Hay puente aquí o se cruza en barca?');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(150);
  await js(`document.querySelector('textarea[data-comment-body]').closest('form').requestSubmit()`);
  const note = await until(() => db(`return (await db.annotations.where('[sourceEngineId+sourceEntityId]').equals(['maps','vvd-map-preview-atlas']).toArray()).find(a=>a.anchor.type==='map_point');`), a => !!a, 'Map comment');
  assert(near(note.anchor.x, 50) && near(note.anchor.y, 70) && /puente/.test(note.noteBody), `Note ${JSON.stringify(note)}`);
  await wait(`document.querySelector('[data-testid="map-comment-${note.id}"]')`, 'comment marker');
  const markerLeft = await js(`document.querySelector('[data-testid="map-comment-${note.id}"]').style.left`);
  assert(near(parseFloat(markerLeft), 50), `Marker left ${markerLeft}`);
  await wait(`document.querySelector('[data-comment-map-point]')`, 'notes panel says "En el mapa"');
  await byId(`map-comment-${note.id}`); await pause(200);
  const ring = await js(`document.querySelector('[data-comment-thread="${note.id}"]').classList.contains('ring-2')`);
  assert(ring, 'Clicking the marker highlights its thread');
  tests.push(`Right-click → "Comentar aquí": the notes composer opens for that spot; the comment is saved at ${note.anchor.x.toFixed(1)}%, ${note.anchor.y.toFixed(1)}%, drawn as a marker there, and the marker brings its thread into view`);

  // 7. Escape closes the menu without doing anything.
  const before = (await map()).features.length;
  await menuAt(40, 40);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await pause(200);
  await wait(`!document.querySelector('[data-testid="map-context-menu"]')`, 'menu closed by Escape');
  assert.equal((await map()).features.length, before, 'Escape changed nothing');
  tests.push('Escape closes the menu and changes nothing');

  // 8. Reload: links, pin and comment marker are still there.
  await js('window.scrollTo(0,0)'); await shot('map-picker-map-1520.png');
  win.reload();
  await pause(500); await wait('window.__mapReady', 'map preview after reload');
  await wait(`document.querySelector('[data-testid="map-comment-${note.id}"]') && document.querySelector('[data-testid="map-pin-marker-${vado.id}"]')`, 'marker and pin after reload');
  // The preview page re-seeds its sample shapes on load, so the road link was checked in the database above; the pin and comment are new rows and must come back on screen.
  tests.push('After a reload the comment marker and the Vado Gris pin are drawn again from the database');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
