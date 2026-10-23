// A small island on a map its own size, through the normal engine: "Una isla" ticks
// "Mapa a la medida de la tierra", 300 km makes a 1000 km sheet, regenerate; the map
// shows rivers and towns, the scale reads the sheet's km, 3D offers no globe; unticked
// it is the planet again. Isolated hidden Electron profile, real workers.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-sheet-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-sheet-qa', configureServer(instance) { instance.middlewares.use('/__world_sheet_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_sheet_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_sheet_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const record = () => js(`(async()=>{const r=await (await import('/src/db/index.ts')).db.generatedWorlds.get('world-presentation-preview-world');return {starter:r.params.starter??null,km:r.params.landmassKm??null};})()`);
  const forged = button('Carta');
  const tests = [];
  // A hidden window runs no animation frames, so the map's flights would stop at their first step;
  // here they come from a timer, as they come from the screen in a visible window.
  await js('window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); window.cancelAnimationFrame = id => clearTimeout(id); true');
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  const row = () => js(`(async()=>{const r=await (await import('/src/db/index.ts')).db.generatedWorlds.get('world-presentation-preview-world');return {starter:r.params.starter??null,km:r.params.landmassKm??null,worldKm:r.params.worldKm??null,width:r.params.width};})()`);
  const openAdvanced = () => js(`(()=>{const d=[...document.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent.includes('Ajustar terreno y clima'));if(d)d.open=true;})()`);
  const sheetBox = `document.querySelector('[data-testid="worldgen-landmass-sheet"] input')`;
  const note = `document.querySelector('[data-testid="worldgen-landmass-note"]').textContent`;
  await click('Una isla');
  await openAdvanced();
  await wait(sheetBox, 'sheet box');
  assert(await js(`${sheetBox}.checked`), 'The island starts on its own sheet');
  assert(/hoja de 2\.?880 km/.test(await js(note)), `Sheet readout for 900 km: ${await js(note)}`);
  await js(`(()=>{const input=document.querySelector('[data-testid="worldgen-landmass-note"] input[type=range]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'300');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`/hoja de 1\\.?000 km/.test(${note})`, 'sheet follows the size');
  await click('Rápido');
  await wait(`/Cada celda mide unos (1|0,98|1,0) km/.test(${note})`, 'cell readout');
  const cellText = await js(`document.querySelector('[data-testid="worldgen-landmass-cell"]').textContent`);
  fs.writeFileSync(path.join(evidence, 'sheet-form.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`"Una isla" ticks "Mapa a la medida de la tierra" (a 2,880 km sheet for 900 km); 300 km makes it 1,000 km and the readout says "${cellText.trim()}" (sheet-form.png)`);
  await click('Regenerar'); await click('Sustituir terreno');
  let saved;
  for (let i = 0; i < 300; i++) { saved = await row(); if (saved.worldKm === 1000 && saved.width === 1024) break; await pause(200); }
  assert(saved.starter === 'landmass' && saved.km === 300 && saved.worldKm === 1000 && saved.width === 1024, `Saved ${JSON.stringify(saved)}`);
  await pause(1500); await wait(forged, 'sheet forged', 3000);
  await wait(`document.body.textContent.includes('Estás viendo la configuración guardada')`, 'sheet settled', 3000);
  // What the bridge reads of the world, and what the saved params give: rivers and towns on a 300 km island
  // (a regenerated world starts with no generated towns until the author allows them, so they are counted
  // from the same params the generator saw).
  const facts = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');
    const got=await runBridgeTool('wh_get_world',{worldId:'world-presentation-preview-world'});
    const {db}=await import('/src/db/index.ts');const row=await db.generatedWorlds.get('world-presentation-preview-world');
    const {generateWorld}=await import('/src/engines/worldgen/core/pipeline.ts');const {buildHumanGeography}=await import('/src/engines/worldgen/core/settlements.ts');
    const w=generateWorld(row.params);let land=0;for(const e of w.elevation)if(e>0)land++;
    return {towns:buildHumanGeography(w,undefined,'places',false).settlements.length,rivers:w.rivers.length,land,worldKm:got.result.worldKm,cellKm:got.result.cellKm,sheet:got.result.sheet};})()`);
  assert(facts.sheet && facts.worldKm === 1000 && facts.towns >= 20 && facts.rivers >= 5 && facts.land > 20000, `The island's places: ${JSON.stringify(facts)}`);
  await pause(3000);
  fs.writeFileSync(path.join(evidence, 'sheet-map.png'), (await win.webContents.capturePage()).toPNG());
  const band = await js(`document.body.textContent.match(/[0-9.]+ km de ancho/)?.[0] ?? ''`);
  const bandKm = Number(band.replace(/\./g, '').replace(/[^0-9]/g, ''));
  assert(bandKm > 0 && bandKm <= 1000, `The band reads the sheet's km: ${band}`);
  tests.push(`Regenerated at 1024 cells: saved as a 1,000 km sheet; the 300 km island has ${facts.land} land cells, ${facts.rivers} rivers and room for ${facts.towns} towns, ${facts.cellKm} km a cell; the map's band says "${band}" (sheet-map.png)`);
  await click('Mundo 3D');
  await wait(button('Maqueta'), '3D view'); await pause(6000);
  const globe = await js(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Globo')`);
  assert(!globe, 'A sheet offers no globe');
  fs.writeFileSync(path.join(evidence, 'sheet-3d.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('In 3D the sheet is a flat model with no globe to turn to (sheet-3d.png)');
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const reopened = await row();
  assert(reopened.worldKm === 1000 && reopened.km === 300, `Reopened ${JSON.stringify(reopened)}`);
  tests.push('Reopening keeps the island on its sheet');
  // Unticked: the planet again.
  await click('Mapa'); await pause(600);
  await openAdvanced();
  await wait(sheetBox, 'sheet box again');
  await js(`${sheetBox}.click()`);
  await wait(`!${sheetBox}.checked && /planeta entero/.test(${note})`, 'sheet off');
  tests.push('Unticking "Mapa a la medida de la tierra" lays the island on the whole planet again');
  const failed = await js('window.__lookError || null');
  assert(!failed, failed);
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
