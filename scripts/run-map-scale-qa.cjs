// Classic map scale through the normal editor: a pasted key names lettered
// pins; measuring two points and saying how far apart they are sets the
// scale; the scale bar, path length, travel time, region area, a real place
// at the same scale and the path styles follow, saved and re-read.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-map-scale-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'map-scale-qa', configureServer(instance) { instance.middlewares.use('/__map_scale_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__map_scale_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/vvd-map-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1520, height: 1240, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__map_scale_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 300) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__mapError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const until = async (read, ok, what, tries = 60) => { let value; for (let i = 0; i < tries; i++) { value = await read(); if (ok(value)) return value; await pause(100); } throw Error(`${what}: ${JSON.stringify(value)}`); };
  const byId = id => js(`document.querySelector('[data-testid="${id}"]').click()`);
  const set = (id, value, kind = 'HTMLInputElement', event = 'input') => js(`(()=>{const i=document.querySelector('[data-testid="${id}"]');Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(i,${JSON.stringify(String(value))});i.dispatchEvent(new Event('${event}',{bubbles:true}));if('${event}'!=='change')i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const db = body => js(`(async()=>{const {db}=await import('/src/db/index.ts');${body}})()`);
  const map = () => db(`return db.worldMaps.get('vvd-map-preview-atlas');`);
  const shot = async name => { await pause(300); win.webContents.invalidate(); await pause(200); await win.webContents.capturePage(); await pause(150); fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG()); };
  const spot = (x, y) => js(`(()=>{const s=document.querySelector('[data-testid="map-surface"]');s.scrollIntoView({block:'center'});const r=s.getBoundingClientRect();return {x:Math.round(r.left+r.width*${x}/100),y:Math.round(r.top+r.height*${y}/100)};})()`);
  const press = async at => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y }); await pause(40);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 }); await pause(40);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 }); await pause(200);
  };
  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
  const aspect = 800 / 1400;
  const tests = [];
  await wait('window.__mapReady', 'map preview');

  // 1. A pasted key names the pins still called by their letter (pins added, then the page reopened).
  await db(`await db.mapPins.bulkPut([{id:'key-a',projectId:'vvd-map-preview',mapId:'vvd-map-preview-atlas',name:'A',icon:'village',position:{x:40,y:70}},{id:'key-b',projectId:'vvd-map-preview',mapId:'vvd-map-preview-atlas',name:'b.',icon:'village',position:{x:55,y:75}}]);`);
  win.reload(); await pause(500); await wait('window.__mapReady', 'map preview after adding lettered pins');
  await js(`document.querySelector('[data-testid="map-scale-panel"]').open = true`); await pause(150);
  await set('map-key-text', 'A. El viejo molino\nB) Posada del cruce / C - Atalaya', 'HTMLTextAreaElement');
  await byId('map-key-preview'); await wait(`document.querySelector('[data-testid="map-key-matches"]')`, 'key preview');
  const preview = await js(`({items:[...document.querySelectorAll('[data-testid="map-key-matches"] li')].map(l=>l.textContent),apply:document.querySelector('[data-testid="map-key-apply"]')?.textContent})`);
  assert(/Nombrar 2/.test(preview.apply) && preview.items.some(t => /C\. Atalaya/.test(t)), `Key preview ${JSON.stringify(preview)}`);
  await byId('map-key-apply');
  await until(() => db(`return [await db.mapPins.get('key-a'),await db.mapPins.get('key-b')].map(p=>p.name);`), names => names.join() === 'El viejo molino,Posada del cruce', 'Key names');
  await wait(`document.querySelector('[data-testid="map-key-done"]')`, 'key done message');
  tests.push('Pasted key "A. El viejo molino / B) Posada del cruce / C - Atalaya": pins "A" and "b." renamed after a preview that lists C as having no pin');

  // 2. Measure two points across half the picture and call it 100 km: the scale is set from it.
  await byId('map-measure-toggle'); await pause(150);
  await press(await spot(20, 50)); await press(await spot(70, 50));
  const marked = await js(`document.querySelectorAll('[data-testid="map-measure-line"] circle').length`);
  assert.equal(marked, 2, 'Two measuring points');
  await set('map-measure-known', 100); await pause(100);
  await byId('map-measure-calibrate');
  const scaled = await until(map, m => !!m.widthKm, 'Scale saved');
  assert(near(scaled.widthKm, 200, 1.5), `Width ${scaled.widthKm}`);
  await wait(`document.querySelector('[data-testid="map-scale-bar"]') && document.querySelector('[data-testid="map-measure-km"]')`, 'scale bar and measured km');
  const readout = await js(`({bar:+document.querySelector('[data-testid="map-scale-bar"]').dataset.km,km:+document.querySelector('[data-testid="map-measure-km"]').dataset.km,rows:document.querySelectorAll('[data-testid="map-measure-travel"] tr').length,status:document.querySelector('[data-testid="map-scale-status"]').textContent})`);
  assert(readout.bar === 50 && near(readout.km, 100, 1.5) && readout.rows === 3 && /200 km/.test(readout.status), `Readout ${JSON.stringify(readout)}`);
  tests.push(`Measuring 20%→70% across the picture and saying "100 km" sets the scale to ${scaled.widthKm.toFixed(1)} km edge to edge; the line now reads ${readout.km.toFixed(1)} km with foot/horse/carriage times and a 50 km scale bar`);
  await press(await spot(70, 80));
  const longer = await js(`+document.querySelector('[data-testid="map-measure-km"]').dataset.km`);
  const expected = 100 + 0.3 * 200 * aspect;
  assert(near(longer, expected, 1.5), `Third point ${longer} vs ${expected}`);
  tests.push(`A third point 30% lower adds its leg (${longer.toFixed(1)} km against ${expected.toFixed(1)} km expected for this picture's proportions)`);
  await shot('map-scale-measure-1520.png');
  await byId('map-measure-toggle'); await pause(150);

  // 3. Typing a width replaces it.
  await set('map-scale-width', 350); await byId('map-scale-set');
  await until(map, m => m.widthKm === 350, 'Typed width');
  tests.push('Typing 350 km as the width saves it');

  // 4. A path shows its length and travel time and takes a style; a region shows its area.
  await byId('map-feature-select-road'); await wait(`document.querySelector('[data-testid="map-feature-measure"] [data-km]')`, 'path length');
  const road = (await map()).features.find(f => f.id === 'road');
  let want = 0; for (let i = 1; i < road.points.length; i++) want += Math.hypot((road.points[i].x - road.points[i - 1].x) / 100 * 350, (road.points[i].y - road.points[i - 1].y) / 100 * 350 * aspect);
  const shown = await js(`+document.querySelector('[data-testid="map-feature-measure"] [data-km]').dataset.km`);
  assert(near(shown, want, 0.01), `Path length ${shown} vs ${want}`);
  await set('map-feature-path-style', 'river', 'HTMLSelectElement', 'change'); await pause(100);
  await byId('map-feature-save');
  await until(async () => (await map()).features.find(f => f.id === 'road'), f => f.pathStyle === 'river', 'Path style saved');
  await wait(`document.querySelector('[data-feature-id="road"] [data-path-style="river"]')`, 'river drawn');
  tests.push(`Camino de la Sal reads ${shown.toFixed(1)} km (computed ${want.toFixed(1)}) with travel times, and saved as a river is drawn as one`);
  await byId('map-feature-select-north'); await wait(`document.querySelector('[data-testid="map-feature-measure"] [data-km2]')`, 'region area');
  const north = (await map()).features.find(f => f.id === 'north');
  let twice = 0; north.points.forEach((a, i) => { const b = north.points[(i + 1) % north.points.length]; twice += a.x * b.y - b.x * a.y; });
  const area = Math.abs(twice) / 2 / 10000 * 350 * 350 * aspect, areaShown = await js(`+document.querySelector('[data-testid="map-feature-measure"] [data-km2]').dataset.km2`);
  assert(near(areaShown, area, 0.01), `Area ${areaShown} vs ${area}`);
  tests.push(`Marca del Norte reads ${Math.round(areaShown)} km² (computed ${Math.round(area)}) and its perimeter`);

  // 5. A real place at the same scale, dragged.
  await set('map-real-place', 'iceland', 'HTMLSelectElement', 'change');
  await wait(`document.querySelector('[data-testid="map-real-outline"] polygon') && document.querySelector('[data-testid="map-real-size"]')`, 'real outline');
  const box = () => js(`(()=>{const r=document.querySelector('[data-testid="map-real-outline"]').getBoundingClientRect();const s=document.querySelector('[data-testid="map-surface"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,wPct:r.width/s.width*100,size:document.querySelector('[data-testid="map-real-size"]').textContent};})()`);
  const before = await box();
  // Iceland is about 480 km wide: at 350 km for the whole picture it is wider than the picture.
  assert(before.wPct > 100 && /\d/.test(before.size), `Outline ${JSON.stringify(before)}`);
  await set('map-scale-width', 2000); await byId('map-scale-set'); await until(map, m => m.widthKm === 2000, 'Wider scale');
  await pause(300);
  const small = await box();
  assert(small.wPct > 15 && small.wPct < 35, `At 2000 km Iceland should be about a quarter of the width: ${JSON.stringify(small)}`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(small.x), y: Math.round(small.y) }); await pause(40);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(small.x), y: Math.round(small.y), button: 'left', clickCount: 1 }); await pause(40);
  for (let k = 1; k <= 8; k++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(small.x) - k * 15, y: Math.round(small.y) + k * 5, button: 'left', modifiers: ['leftButtonDown'] }); await pause(30); }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(small.x) - 120, y: Math.round(small.y) + 40, button: 'left', clickCount: 1 }); await pause(250);
  const moved = await box();
  assert(near(moved.x, small.x - 120, 12) && near(moved.y, small.y + 40, 12), `Drag ${JSON.stringify({ small, moved })}`);
  tests.push(`Iceland at the same scale: wider than the map at 350 km, about ${Math.round(small.wPct)}% of its width at 2000 km (${small.size.split('·')[0].trim()}), and dragged 120 px left`);
  await js(`document.querySelector('[data-testid="map-surface"]').scrollIntoView({block:'center'})`); await shot('map-scale-real-1520.png');

  // 6. Export draws the path style and the scale bar.
  const svg = await js(`(async()=>{const g=await import('/src/components/maps/mapGeometry.ts');return g.exportMapSvg('',1400,800,[{id:'t',kind:'path',name:'Senda',color:'#e4a853',pathStyle:'trail',points:[{x:10,y:10},{x:50,y:10}]},{id:'r',kind:'path',name:'Camino',color:'#e4a853',pathStyle:'road',points:[{x:10,y:20},{x:50,y:20}]}],[],{pins:true,region:true,path:true,label:true},[],2000);})()`);
  assert(svg.includes('stroke-dasharray') && svg.includes('stroke="#2b2620"') && svg.includes('data-scale-km="500"'), 'SVG export misses the path styles or the scale bar');
  tests.push('SVG export draws the trail dashed, the road with its casing and a 500 km scale bar at 2000 km');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
