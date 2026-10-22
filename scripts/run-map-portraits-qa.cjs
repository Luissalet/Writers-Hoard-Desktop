// Classic map pins as portraits: a pin linked to an entry with a picture shows
// it, framed in the pin's colour with its name under it; the Portraits and
// Names layers turn that off and every name on, saved with the map.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-map-portraits-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'map-portraits-qa', configureServer(instance) { instance.middlewares.use('/__map_portraits_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__map_portraits_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/vvd-map-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1520, height: 1240, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__map_portraits_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 300) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__mapError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const shot = async name => { await pause(500); win.webContents.invalidate(); await pause(300); await win.webContents.capturePage(); fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG()); };
  const map = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return db.worldMaps.get('vvd-map-preview-atlas');})()`);
  const marker = id => `document.querySelector('[data-testid="map-pin-marker-${id}"]')`;
  const tests = [];
  await wait('window.__mapReady', 'map preview');
  // An entry with a picture (drawn here: a little banner; the write tells the open views, as the Codex editor's does), linked to the harbour pin.
  await js(`(async()=>{const c=document.createElement('canvas');c.width=c.height=96;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,0,96);g.addColorStop(0,'#2f5d7c');g.addColorStop(1,'#c9a35a');x.fillStyle=g;x.fillRect(0,0,96,96);x.fillStyle='#f2e6c8';x.beginPath();x.moveTo(48,14);x.lineTo(78,70);x.lineTo(18,70);x.closePath();x.fill();
    const {db}=await import('/src/db/index.ts');await db.codexEntries.update('avila',{avatar:c.toDataURL('image/png')});await db.mapPins.update('harbour',{linkedEntryId:'avila',color:'#2f8a63'});const {notifyDataChanged}=await import('/src/engines/_shared/dataChanged.ts');notifyDataChanged({source:'other',projectId:'vvd-map-preview'});})()`);
  try { await wait(`${marker('harbour')}?.dataset.portrait==='true'`, 'harbour pin shows the picture', 100); }
  catch (error) { console.log('DEBUG', JSON.stringify(await js(`(async()=>{const {db}=await import('/src/db/index.ts');const e=await db.codexEntries.get('avila');const p=await db.mapPins.get('harbour');return {avatar:!!e?.avatar,link:p?.linkedEntryId,html:${marker('harbour')}?.outerHTML.slice(0,300),boxes:[...document.querySelectorAll('[data-testid^=map-layer-]')].map(b=>b.dataset.testid+':'+b.checked),fiber:(()=>{const el=${marker('harbour')};const k=Object.keys(el).find(k=>k.startsWith('__reactFiber'));let f=el[k];while(f&&!(f.memoizedProps&&f.memoizedProps.codexEntries))f=f.return;return f?f.memoizedProps.codexEntries.map(e=>e.id+':'+!!e.avatar):null;})()};})()`))); throw error; }
  const look = await js(`(()=>{const m=${marker('harbour')};const img=m.querySelector('img');const r=m.getBoundingClientRect();return{src:img.src.slice(0,22),loaded:img.complete&&img.naturalWidth>0,w:Math.round(r.width),iconW:Math.round(${marker('fortress')}.getBoundingClientRect().width),border:getComputedStyle(m).borderTopColor,name:document.querySelector('[data-testid="map-pin-name-harbour"]')?.textContent,other:${marker('fortress')}?.dataset.portrait??null,otherName:!!document.querySelector('[data-testid="map-pin-name-fortress"]')};})()`);
  assert(look.src.startsWith('data:image/png;base64') && look.loaded && look.w > look.iconW && /47, 138, 99/.test(look.border) && look.name === 'Puerto del Viento' && look.other === null && !look.otherName, `Portrait pin ${JSON.stringify(look)}`);
  await shot('map-portrait-pin.png');
  tests.push(`A pin linked to an entry with a picture shows it (${look.w} px on screen against ${look.iconW} px for an icon pin, framed in the pin's green, "${look.name}" under it); a pin without one keeps its icon and shows its name only on hover`);
  // Portraits off: the harbour is an icon again, and the choice is saved with the map.
  await js(`document.querySelector('[data-testid="map-layer-portraits"]').click()`);
  await wait(`${marker('harbour')} && !${marker('harbour')}.dataset.portrait`, 'portraits off');
  let saved; for (let i = 0; i < 50; i++) { saved = (await map()).layerVisibility; if (saved?.portraits === false) break; await pause(100); }
  assert.equal(saved?.portraits, false, `Saved ${JSON.stringify(saved)}`);
  // Names on: every pin's name in view.
  await js(`document.querySelector('[data-testid="map-layer-names"]').click()`);
  await wait(`document.querySelector('[data-testid="map-pin-name-fortress"]') && document.querySelector('[data-testid="map-pin-name-harbour"]')`, 'every name shown');
  for (let i = 0; i < 50; i++) { saved = (await map()).layerVisibility; if (saved?.names === true) break; await pause(100); }
  assert.equal(saved?.names, true, `Saved names ${JSON.stringify(saved)}`);
  await shot('map-names-on.png');
  tests.push('Layers → Retratos off turns the pin back into its icon and Nombres on shows every pin name (map-names-on.png); both are saved with the map');
  // Portraits back on through the bridge, as an agent would; then undo.
  const reply = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');return runBridgeTool('wh_set_map_layers',{mapId:'vvd-map-preview-atlas',portraits:true});})()`);
  assert(reply.ok, JSON.stringify(reply).slice(0, 300));
  await wait(`${marker('harbour')}?.dataset.portrait==='true'`, 'portraits back through the bridge');
  const audit = reply.result.__audit;
  const undone = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');return runBridgeTool('__undo',{entry:{tool:'wh_set_map_layers',kind:'update',entityId:${JSON.stringify(audit.entityId)},projectId:${JSON.stringify(audit.projectId)},before:${JSON.stringify(audit.before)},summary:'layers'}});})()`);
  assert(undone.ok, JSON.stringify(undone).slice(0, 300));
  await wait(`${marker('harbour')} && !${marker('harbour')}.dataset.portrait`, 'undo puts the icon back');
  tests.push('Bridge: wh_set_map_layers turns portraits back on (the open map follows) and undo turns them off again');
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
