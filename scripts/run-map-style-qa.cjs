// Classic map styling through the normal editor: hatch, outline and lettering
// on a region, drawing order, and a large dot-only pin, saved and re-read.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-map-style-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'map-style-qa', configureServer(instance) { instance.middlewares.use('/__map_style_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__map_style_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/vvd-map-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1520, height: 1240, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__map_style_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 300) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__mapError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const byId = id => js(`document.querySelector('[data-testid="${id}"]').click()`);
  const set = (id, value, kind = 'HTMLInputElement', event = 'input') => js(`(()=>{const i=document.querySelector('[data-testid="${id}"]');Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(i,${JSON.stringify(String(value))});i.dispatchEvent(new Event('${event}',{bubbles:true}));if('${event}'!=='change')i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const check = id => js(`document.querySelector('[data-testid="${id}"]').click()`);
  const map = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return db.worldMaps.get('vvd-map-preview-atlas');})()`);
  const pinRow = id => js(`(async()=>{const {db}=await import('/src/db/index.ts');return db.mapPins.get('${id}');})()`);
  const tests = [];
  await wait('window.__mapReady', 'map preview');
  await byId('map-feature-select-north');
  await wait(`document.querySelector('[data-testid="map-feature-style"]')`, 'style controls');
  await set('map-feature-pattern', 'crosshatch', 'HTMLSelectElement', 'change');
  await wait(`document.querySelector('[data-testid="map-feature-pattern-scale"]')`, 'pattern scale');
  await set('map-feature-pattern-scale', 2);
  await set('map-feature-stroke-width', 5);
  await set('map-feature-stroke-color', '#aa2200');
  await set('map-label-font', 'script', 'HTMLSelectElement', 'change');
  await set('map-label-size', 3);
  await set('map-label-rotation', -20);
  await check('map-label-bold');
  await pause(200);
  await byId('map-feature-save');
  let north; for (let i = 0; i < 50; i++) { north = (await map()).features.find(f => f.id === 'north'); if (north.pattern === 'crosshatch' && north.labelStyle?.bold) break; await pause(100); }
  assert(north.pattern === 'crosshatch' && north.patternScale === 2 && north.strokeWidth === 5 && north.strokeColor === '#aa2200' && north.labelStyle.font === 'script' && north.labelStyle.size === 3 && north.labelStyle.rotation === -20 && north.labelStyle.bold === true, `Saved style: ${JSON.stringify(north)}`);
  tests.push('Marca del Norte: crosshatch ×2, 5 px #aa2200 outline, script lettering size 3, −20°, bold — set in the inspector and saved');
  const drawn = await js(`(()=>{const label=document.querySelector('[data-testid="map-label-north"]');const poly=[...document.querySelectorAll('[data-feature-id="north"] polygon')][0];return {pattern:!!document.querySelector('[data-testid="map-pattern-north"]'),font:label.getAttribute('font-family'),weight:label.getAttribute('font-weight'),transform:label.getAttribute('transform'),stroke:poly.getAttribute('stroke'),width:poly.getAttribute('stroke-width')};})()`);
  assert(drawn.pattern && /Segoe Script/.test(drawn.font) && drawn.weight === '700' && /rotate\(-20/.test(drawn.transform) && drawn.stroke === '#aa2200' && Number(drawn.width) >= 5, `Canvas: ${JSON.stringify(drawn)}`);
  tests.push(`The map draws it: hatch layer, ${drawn.font.split(',')[0]} bold label rotated, outline ${drawn.stroke} ${drawn.width} px`);
  await js(`document.querySelector('[data-testid="map-feature-inspector"]').scrollIntoView({block:'center'})`); await pause(300);
  fs.writeFileSync(path.join(evidence, 'map-style-inspector-1520.png'), (await win.webContents.capturePage()).toPNG());
  // Drawing order: send the region to the front.
  const before = (await map()).features.map(f => f.id).join();
  await byId('map-order-front');
  let order; for (let i = 0; i < 50; i++) { order = (await map()).features.map(f => f.id); if (order[order.length - 1] === 'north') break; await pause(100); }
  assert(order[order.length - 1] === 'north', `Order ${before} → ${order}`);
  let domOrder; for (let i = 0; i < 50; i++) { domOrder = await js(`[...document.querySelectorAll('[data-feature-id]')].map(g=>g.getAttribute('data-feature-id'))`); if (domOrder[domOrder.length - 1] === 'north') break; await pause(100); }
  assert(domOrder[domOrder.length - 1] === 'north', `DOM order ${domOrder}`);
  tests.push(`"Bring to front" saves the new order (${before} → ${order.join()}) and the map draws it on top`);
  // Reselect after picking another shape: the inspector re-reads the saved style.
  await byId('map-feature-select-road'); await pause(150); await byId('map-feature-select-north'); await pause(150);
  const reread = await js(`({pattern:document.querySelector('[data-testid="map-feature-pattern"]').value,font:document.querySelector('[data-testid="map-label-font"]').value,bold:document.querySelector('[data-testid="map-label-bold"]').checked})`);
  assert(reread.pattern === 'crosshatch' && reread.font === 'script' && reread.bold, `Re-read ${JSON.stringify(reread)}`);
  tests.push('Picking another shape and back shows the saved hatch and lettering in the inspector');
  // Add a point by pulling the halfway handle of the first edge, then save.
  const count0 = (await map()).features.find(f => f.id === 'north').points.length;
  await js(`document.querySelector('[data-feature-id="north"]').scrollIntoView({block:'center'})`); await pause(300);
  const mid = await js(`(()=>{const r=document.querySelector('[data-testid="map-midpoint-0"]').getBoundingClientRect();const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);const top=document.elementFromPoint(x,y);return {x,y,top:top?.getAttribute('data-testid')||top?.tagName};})()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: mid.x, y: mid.y }); await pause(50);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: mid.x, y: mid.y, button: 'left', clickCount: 1 }); await pause(60);
  for (let k = 1; k <= 6; k++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: mid.x + k * 5, y: mid.y - k * 6, button: 'left', modifiers: ['leftButtonDown'] }); await pause(30); }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: mid.x + 30, y: mid.y - 36, button: 'left', clickCount: 1 }); await pause(200);
  await byId('map-feature-save');
  let grown; for (let i = 0; i < 50; i++) { grown = (await map()).features.find(f => f.id === 'north'); if (grown.points.length === count0 + 1) break; await pause(100); }
  const vertexCount = await js(`document.querySelectorAll('[data-testid^="map-vertex-"]').length`);
  assert(grown.points.length === count0 + 1, `Add point: ${count0} → ${grown.points.length} (vertices on screen ${vertexCount}, under the handle: ${mid.top})`);
  tests.push(`Pulling the halfway handle of an edge adds a vertex where it is dropped (${count0} → ${grown.points.length} points, saved)`);
  // In two named layers: shown while either is visible.
  await wait(`document.querySelector('[data-testid="map-feature-layer-journeys"]')`, 'layer checkboxes');
  await check('map-feature-layer-journeys'); await pause(150);
  await byId('map-feature-save');
  let layered; for (let i = 0; i < 50; i++) { layered = (await map()).features.find(f => f.id === 'north'); if ((layered.layerIds ?? []).length === 2) break; await pause(100); }
  assert(layered.layerId === 'political' && layered.layerIds.join() === 'political,journeys', `Layers ${JSON.stringify(layered)}`);
  await js(`document.querySelector('[data-testid="map-named-layers"]').open = true`); await pause(100);
  await check('map-named-layer-political'); await pause(400);
  const shownWithOne = await js(`!!document.querySelector('[data-feature-id="north"]')`);
  await check('map-named-layer-journeys'); await pause(400);
  const shownWithNone = await js(`!!document.querySelector('[data-feature-id="north"]')`);
  assert(shownWithOne && !shownWithNone, `Visibility one=${shownWithOne} none=${shownWithNone}`);
  await check('map-named-layer-political'); await pause(200); await check('map-named-layer-journeys'); await pause(300);
  tests.push('Marca del Norte in two named layers (saved as political + journeys): still shown with one hidden, hidden only when both are');
  // A large, dot-only pin with a trusted press.
  const at = await js(`(()=>{const r=document.querySelector('[data-testid="map-pin-marker-harbour"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:r.width};})()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y }); await pause(50);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 }); await pause(60);
  win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 }); await pause(300);
  await wait(`document.querySelector('[data-testid="map-pin-look"]')`, 'pin inspector');
  await byId('map-pin-size-L'); await check('map-pin-hide-icon'); await pause(150);
  await byId('map-pin-save');
  let pin; for (let i = 0; i < 50; i++) { pin = await pinRow('harbour'); if (pin.size === 'L' && pin.hideIcon) break; await pause(100); }
  assert(pin.size === 'L' && pin.hideIcon === true, `Pin ${JSON.stringify(pin)}`);
  // The map may be zoomed out, so the drawn size is compared with the same marker at M.
  let marker; for (let i = 0; i < 50; i++) { marker = await js(`(()=>{const m=document.querySelector('[data-testid="map-pin-marker-harbour"]');const r=m.getBoundingClientRect();return {size:m.dataset.size,w:r.width,icon:!!m.querySelector('svg')};})()`); if (marker.size === 'L' && !marker.icon) break; await pause(100); }
  assert(marker.size === 'L' && marker.w >= at.w * 1.3 && !marker.icon, `Marker ${JSON.stringify(marker)} (M was ${at.w})`);
  tests.push(`Puerto del Viento: size L and no icon, saved and drawn (dot ${Math.round(marker.w)} px against ${Math.round(at.w)} px at M on the zoomed map)`);
  await js('window.scrollTo(0,0)'); await pause(300);
  fs.writeFileSync(path.join(evidence, 'map-style-map-1520.png'), (await win.webContents.capturePage()).toPNG());
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
