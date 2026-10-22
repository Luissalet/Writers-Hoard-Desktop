// Changing a classic map's ground image through the real editor: pick a file of another
// shape, read the confirmation (counts, shape warning), cancel (nothing changes), try a
// broken file, choose another, keep the shapes, confirm, and reopen the page.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-map-ground-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAP = 'map-ground-qa-atlas';
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'map-ground-qa', configureServer(instance) { instance.middlewares.use('/__map_ground_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__map_ground_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/map-ground-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1520, height: 1240, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const base = `${server.resolvedUrls.local[0]}__map_ground_qa`;
  await win.loadURL(base);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 300) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__mapError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const click = id => js(`document.querySelector('[data-testid="${id}"]').click()`);
  // The dialog fades in with requestAnimationFrame; wait for it to finish so the capture shows it.
  const settled = () => js(`(()=>{const d=document.querySelector('[role="dialog"]');if(!d)return 1;let o=1;for(let e=d;e;e=e.parentElement)o*=Number(getComputedStyle(e).opacity);return o;})()`);
  const shot = async name => { for (let i = 0; i < 40 && (await settled()) < 0.99; i++) await pause(100); console.log(`SHOT ${name} opacity=${await settled()}`); await pause(300); win.webContents.invalidate(); await pause(200); await win.webContents.capturePage(); await pause(150); fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG()); };
  const state = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const map=await db.worldMaps.get('${MAP}');const pins=await db.mapPins.where('mapId').equals('${MAP}').toArray();return {image:map.backgroundImage.length,head:map.backgroundImage.slice(0,64)+map.backgroundImage.slice(-64),source:map.source,features:map.features,versions:(map.versions||[]).map(v=>({name:v.name,image:v.backgroundImage.length,pins:v.pins,features:v.features})),pins};})()`);
  // A generated PNG of the given size, or a file that only claims to be one, put in a file input like a real pick.
  const pick = (selector, { w, h, broken }) => js(`(async()=>{
    let file;
    if (${!!broken}) file = new File(['this is not an image'], 'broken.png', { type: 'image/png' });
    else {
      const c = document.createElement('canvas'); c.width = ${w || 1}; c.height = ${h || 1}; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, '#27414a'); g.addColorStop(1, '#8a9b72'); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
      x.strokeStyle = '#d6d0b7'; x.lineWidth = 6; x.strokeRect(10, 10, c.width - 20, c.height - 20);
      x.fillStyle = '#d6d0b7'; x.font = '48px Georgia'; x.fillText('${w}x${h}', 40, 90);
      file = new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'ground.png', { type: 'image/png' });
    }
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector(${JSON.stringify(selector)}); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const MAIN_INPUT = 'input[type="file"]:not([data-testid])', DIALOG_INPUT = '[data-testid="change-ground-choose-input"]';
  const tests = [];
  await wait('window.__mapReady', 'map preview');
  const initial = await state();
  assert.equal(initial.versions.length, 1, 'seed has one era');
  assert.equal(initial.pins.length, 2);

  // 1. A square picture over a 1400 x 800 map: the dialog shows both pictures, the counts and the shape warning.
  await pick(MAIN_INPUT, { w: 900, h: 900 });
  await wait(`document.querySelector('[data-testid="change-ground-dialog"]')`, 'dialog');
  await wait(`document.querySelector('[data-testid="change-ground-different-shape"]')`, 'shape verdict');
  const dialog = await js(`(()=>{const q=id=>document.querySelector('[data-testid="'+id+'"]');return {old:q('change-ground-old-size').textContent,new:q('change-ground-new-size').textContent,places:q('change-ground-count-places').textContent,zones:q('change-ground-count-zones').textContent,paths:q('change-ground-count-paths').textContent,names:q('change-ground-count-names').textContent,verdict:q('change-ground-different-shape').textContent,keep:q('change-ground-fit-keep').checked,stretch:q('change-ground-fit-stretch').checked,confirm:q('change-ground-confirm').disabled,imgs:[...document.querySelectorAll('[data-testid="change-ground-old"] img,[data-testid="change-ground-new"] img')].map(i=>i.naturalWidth)};})()`);
  assert.match(dialog.old, /1400 × 800/); assert.match(dialog.new, /900 × 900/);
  assert.match(dialog.places, /2/); assert.match(dialog.zones, /1/); assert.match(dialog.paths, /1/); assert.match(dialog.names, /1/);
  assert.match(dialog.verdict, /1\.75:1 → 1\.00:1/); assert.ok(dialog.keep && !dialog.stretch && !dialog.confirm, `defaults ${JSON.stringify(dialog)}`);
  assert.ok(dialog.imgs.every(n => n > 0), 'both thumbnails decode');
  await click('change-ground-fit-stretch'); await pause(100);
  assert.equal(await js(`document.querySelector('[data-testid="change-ground-fit-stretch"]').checked`), true);
  await click('change-ground-fit-keep'); await pause(100);
  assert.equal(await js(`document.querySelector('[data-testid="change-ground-fit-keep"]').checked`), true);
  tests.push(`Dialog for a 900x900 file over a 1400x800 map: both sizes shown, counts ${dialog.places.trim()} / ${dialog.zones.trim()} / ${dialog.paths.trim()} / ${dialog.names.trim()}, verdict "${dialog.verdict.slice(0, 40)}…", "Conservar las formas" selected by default and switchable`);
  await shot('map-ground-dialog-1520.png');

  // 2. Cancel: nothing changes.
  await click('change-ground-cancel');
  await wait(`!document.querySelector('[data-testid="change-ground-dialog"]')`, 'dialog closes');
  const afterCancel = await state();
  assert.deepEqual(afterCancel, initial, 'Cancel changed the saved map');
  tests.push('Cancel closes the dialog and leaves the image, shapes, pins and eras exactly as they were (re-read from the database)');

  // 3. A broken file: error shown, Confirm disabled; then choose another from inside the dialog.
  await pick(MAIN_INPUT, { broken: true });
  await wait(`document.querySelector('[data-testid="change-ground-error"]')`, 'error state');
  const broken = await js(`({confirm:document.querySelector('[data-testid="change-ground-confirm"]').disabled,text:document.querySelector('[data-testid="change-ground-error"]').textContent})`);
  assert.equal(broken.confirm, true, 'Confirm must be disabled for an unreadable image');
  tests.push(`An unreadable file shows "${broken.text}" and disables Confirm`);
  await shot('map-ground-error-1520.png');
  await pick(DIALOG_INPUT, { w: 900, h: 900 });
  await wait(`!document.querySelector('[data-testid="change-ground-error"]') && document.querySelector('[data-testid="change-ground-different-shape"]') && !document.querySelector('[data-testid="change-ground-confirm"]').disabled`, 'recovers after choosing another');
  assert.match(await js(`document.querySelector('[data-testid="change-ground-new-size"]').textContent`), /900 × 900/);
  tests.push('"Choose another image" inside the dialog replaces the candidate: the error clears, the new size is read and Confirm is enabled');

  // 4. Confirm with "keep the shapes".
  await click('change-ground-confirm');
  await wait(`!document.querySelector('[data-testid="change-ground-dialog"]')`, 'dialog closes after confirm');
  let after; for (let i = 0; i < 50; i++) { after = await state(); if (after.versions.length === 2) break; await pause(100); }
  assert.equal(after.versions.length, 2, 'an era was captured');
  const era = after.versions[1];
  assert.equal(era.name, 'Antes de cambiar la imagen del mapa'); assert.equal(era.image, initial.image, 'the era keeps the old image');
  assert.notEqual(after.image, initial.image); assert.equal(after.source, 'uploaded');
  // Expected positions, computed here from the geometry, not with the app's helper: 1400x800 inside 900x900.
  const s = Math.min(900 / 1400, 900 / 800), oy = (900 - 800 * s) / 2;
  const expectY = y => (oy + (y / 100) * 800 * s) / 900 * 100, expectX = x => ((x / 100) * 1400 * s) / 900 * 100;
  const close = (a, b) => Math.abs(a - b) < 0.01;
  for (const pin of after.pins) { const was = initial.pins.find(p => p.id === pin.id); assert.ok(close(pin.position.x, expectX(was.position.x)) && close(pin.position.y, expectY(was.position.y)), `Pin ${pin.id} ${JSON.stringify(was.position)} → ${JSON.stringify(pin.position)}`); }
  for (const feature of after.features) { const was = initial.features.find(f => f.id === feature.id); feature.points.forEach((point, i) => assert.ok(close(point.x, expectX(was.points[i].x)) && close(point.y, expectY(was.points[i].y)), `Shape ${feature.id} point ${i}: ${JSON.stringify(was.points[i])} → ${JSON.stringify(point)}`)); }
  for (const pin of era.pins) assert.deepEqual(pin.position, initial.pins.find(p => p.id === pin.id).position, 'the era keeps the old pin coordinates');
  tests.push(`Confirm saved the era "${era.name}" (old image and coordinates) and moved ${after.pins.length} pins and ${after.features.length} shapes to the 900x900 picture (e.g. harbour y ${initial.pins.find(p => p.id === 'harbour').position.y} → ${after.pins.find(p => p.id === 'harbour').position.y})`);
  // The dialog shows both pictures and the era name itself, so check the page once it has closed.
  await wait(`!document.querySelector('[data-testid="change-ground-dialog"]')`, 'the dialog closes');
  await wait(`(()=>{const i=document.querySelector('[data-testid="map-surface"] img');return i && i.naturalWidth === 900 && i.naturalHeight === 900;})()`, 'the map shows the new picture');
  await wait(`document.body.textContent.includes('Antes de cambiar la imagen del mapa')`, 'the era appears in the history');
  tests.push('The editor re-mounted on the new 900x900 picture and the history lists the new era');
  await js('window.scrollTo(0,0)'); await shot('map-ground-result-1520.png');

  // 5. Reload the page over the saved data.
  await win.loadURL(`${base}?keep=1`);
  await wait('window.__mapReady', 'map after reload');
  const reloaded = await state();
  assert.equal(reloaded.image, after.image); assert.deepEqual(reloaded.pins, after.pins); assert.deepEqual(reloaded.features, after.features); assert.equal(reloaded.versions.length, 2);
  await wait(`[...document.querySelectorAll('img')].some(i => i.naturalWidth === 900)`, 'new picture after reload');
  tests.push('After reloading the page the new image, remapped pins and shapes and both eras are still there');

  // 6. A same-shaped picture needs no choice: no shape question, a straight confirm.
  await pick(MAIN_INPUT, { w: 450, h: 450 });
  await wait(`document.querySelector('[data-testid="change-ground-same-shape"]')`, 'same shape verdict');
  assert.equal(await js(`!!document.querySelector('[data-testid="change-ground-fit-keep"]')`), false, 'no fit choice for the same shape');
  await click('change-ground-cancel'); await wait(`!document.querySelector('[data-testid="change-ground-dialog"]')`, 'closed');
  tests.push('A picture of the same shape shows "same shape" and no keep/stretch question');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
