// A single landmass through the normal engine: choose "Una isla", change its size
// with the control under Advanced (the cell readout follows), regenerate, look at
// it on the map and in 3D, reopen. Isolated hidden Electron profile, real workers.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-landmass-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-landmass-qa', configureServer(instance) { instance.middlewares.use('/__world_landmass_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_landmass_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_landmass_qa`);
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
  await click('Una isla');
  await wait(`document.body.textContent.includes('Una sola isla de unos 900 km')`, 'island hint');
  await js(`(()=>{const d=[...document.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent.includes('Ajustar terreno y clima'));if(d)d.open=true;})()`);
  await wait(`document.querySelector('[data-testid="worldgen-landmass-note"]')`, 'landmass note');
  const before = await js(`document.querySelector('[data-testid="worldgen-landmass-cell"]').textContent`);
  // The size control: a range input inside the landmass note, set as a person drags it.
  await js(`(()=>{const input=document.querySelector('[data-testid="worldgen-landmass-note"] input[type=range]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'1400');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('[data-testid="worldgen-landmass-note"]').textContent.includes('1400')||document.querySelector('[data-testid="worldgen-landmass-note"]').textContent.includes('1.400')`, 'size shown');
  const after = await js(`document.querySelector('[data-testid="worldgen-landmass-cell"]').textContent`);
  assert(before !== after, `The cell readout did not follow the size: ${before} / ${after}`);
  const shapeOff = await js(`(()=>{const find=t=>{const label=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(t));return label&&document.getElementById(label.htmlFor);};return {land:find('Superficie de tierra')?.disabled,mountains:find('Montañas')?.disabled};})()`);
  assert(shapeOff.land === true && shapeOff.mountains === false, `Land share off, relief on: ${JSON.stringify(shapeOff)}`);
  tests.push(`"Una isla" shows the size control under Advanced; 1400 km updates the cell readout (${after.trim()}); the land share is set by the landmass, the relief controls stay live`);
  await click('Regenerar'); await click('Sustituir terreno');
  let saved;
  for (let i = 0; i < 150; i++) { saved = await record(); if (saved.starter === 'landmass') break; await pause(200); }
  assert(saved.starter === 'landmass' && saved.km === 1400, `Regeneration saved ${JSON.stringify(saved)}`);
  await pause(800); await wait(forged, 'island forged');
  await wait(`document.body.textContent.includes('Estás viendo la configuración guardada')`, 'island settled');
  await pause(2500);
  // Green ground in the middle of the view: the land is in the frame, not off in the sea.
  const greenIn = async () => {
    const r = await js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:Math.round(c.x+c.width*0.25),y:Math.round(c.y+c.height*0.25),width:Math.round(c.width*0.5),height:Math.round(c.height*0.5)};})()`);
    win.webContents.invalidate(); await pause(300); await win.webContents.capturePage(r);
    const b = (await win.webContents.capturePage(r)).toBitmap();
    let green = 0; for (let i = 0; i < b.length; i += 4) if (b[i + 1] > b[i + 2] + 8 && b[i + 1] > b[i] - 4 && b[i + 1] > 50) green++;
    return green / (b.length / 4);
  };
  const mapGreen = await greenIn();
  fs.writeFileSync(path.join(evidence, 'island-map-1440.png'), (await win.webContents.capturePage()).toPNG());
  assert(mapGreen > 0.05, `The map does not show the island in the middle of the view (${(mapGreen * 100).toFixed(1)}% land)`);
  tests.push(`Regenerate + Replace terrain saves starter "landmass" at 1400 km; the map opens framed on the island (${(mapGreen * 100).toFixed(0)}% of the middle of the view is land; island-map-1440.png)`);
  await click('Mundo 3D');
  await wait(button('Maqueta'), '3D view'); await pause(6000);
  const threeGreen = await greenIn();
  fs.writeFileSync(path.join(evidence, 'island-3d-1440.png'), (await win.webContents.capturePage()).toPNG());
  assert(threeGreen > 0.05, `The tabletop model does not show the island (${(threeGreen * 100).toFixed(1)}% land)`);
  // Round the block is the room, not the planet's sea: the corners of the view hold no water or land.
  const corner = await js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:Math.round(c.x+8),y:Math.round(c.y+c.height-90),width:80,height:60};})()`);
  const cb = (await win.webContents.capturePage(corner)).toBitmap();
  let wet = 0; for (let i = 0; i < cb.length; i += 4) if (cb[i] > cb[i + 2] + 25 || cb[i + 1] > cb[i + 2] + 25) wet++;
  assert(wet / (cb.length / 4) < 0.05, `The room round the block shows water or land (${(wet / (cb.length / 4) * 100).toFixed(1)}%)`);
  tests.push(`In 3D the tabletop model is the island and its sea (${(threeGreen * 100).toFixed(0)}% of the middle of the view is land; island-3d-1440.png)`);
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const reopened = await record();
  assert(reopened.starter === 'landmass' && reopened.km === 1400, `Reopened ${JSON.stringify(reopened)}`);
  tests.push('Reopening keeps the island and its size');
  // A small island at a finer detail: the map frames it close once the geography is built,
  // and the tabletop model shows it, again after going to the map and back.
  await click('Mapa'); await pause(800);
  await click('Una isla');
  await js(`(()=>{const d=[...document.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent.includes('Ajustar terreno y clima'));if(d)d.open=true;})()`);
  await wait(`document.querySelector('[data-testid="worldgen-landmass-note"] input[type=range]')`, 'size control again');
  await js(`(()=>{const input=document.querySelector('[data-testid="worldgen-landmass-note"] input[type=range]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'400');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('Rápido');
  await click('Regenerar'); await click('Sustituir terreno');
  let small;
  for (let i = 0; i < 300; i++) { small = await js(`(async()=>{const r=await (await import('/src/db/index.ts')).db.generatedWorlds.get('world-presentation-preview-world');return {km:r.params.landmassKm,width:r.params.width};})()`); if (small.km === 400 && small.width === 1024) break; await pause(200); }
  assert(small.km === 400 && small.width === 1024, `Small island not saved: ${JSON.stringify(small)}`);
  await pause(1500); await wait(forged, 'small island forged', 3000);
  await wait(`document.body.textContent.includes('Estás viendo la configuración guardada')`, 'small island settled', 3000);
  await pause(4000);
  const smallMap = await greenIn();
  fs.writeFileSync(path.join(evidence, 'small-island-map-1440.png'), (await win.webContents.capturePage()).toPNG());
  const band = await js(`document.body.textContent.match(/[0-9.]+ km de ancho/)?.[0] ?? ''`);
  assert(smallMap > 0.05, `The map does not frame the 400 km island (${(smallMap * 100).toFixed(1)}% land, ${band})`);
  await click('Mundo 3D'); await wait(button('Maqueta'), '3D again'); await pause(7000);
  const small3d = await greenIn();
  fs.writeFileSync(path.join(evidence, 'small-island-3d-1440.png'), (await win.webContents.capturePage()).toPNG());
  await click('Mapa'); await pause(1500); await click('Mundo 3D'); await wait(button('Maqueta'), '3D a third time'); await pause(7000);
  const small3dAgain = await greenIn();
  fs.writeFileSync(path.join(evidence, 'small-island-3d-again-1440.png'), (await win.webContents.capturePage()).toPNG());
  assert(small3d > 0.03 && small3dAgain > 0.03, `The tabletop model does not show the 400 km island (${(small3d * 100).toFixed(1)}%, after going back ${(small3dAgain * 100).toFixed(1)}%)`);
  tests.push(`A 400 km island at 1024 cells: the map frames it (${band}, ${(smallMap * 100).toFixed(0)}% land) and the tabletop model shows it (${(small3d * 100).toFixed(0)}%), again after going to the map and back (${(small3dAgain * 100).toFixed(0)}%)`);
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
