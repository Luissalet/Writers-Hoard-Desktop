// Blank sea starter through the normal engine: choose the preset, regenerate,
// paint a coast with trusted pointer input on the 2D map, recalculate climate
// and rivers, reopen. Isolated hidden Electron profile, real Vite workers.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-blank-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-blank-qa', configureServer(instance) { instance.middlewares.use('/__world_blank_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_blank_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_blank_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const forged = button('Carta');
  const tests = [];
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await click('Mar en blanco');
  await wait(`document.body.textContent.includes('Mar abierto y nada más')`, 'preset hint');
  await click('Regenerar'); await click('Sustituir terreno');
  let recipe;
  for (let i = 0; i < 150; i++) { recipe = await js(`(async()=>{const r=await (await import('/src/db/index.ts')).db.generatedWorlds.get('world-presentation-preview-world');return {starter:r.params.starter??null,edits:r.edits};})()`); if (recipe.starter === 'sea') break; await pause(200); }
  assert.equal(recipe.starter, 'sea', `Regeneration did not save the blank starter: ${JSON.stringify(recipe)} ${await js('document.querySelector("[role=dialog]")?.textContent ?? "no dialog"')}`);
  await pause(800); await wait(forged, 'blank sea forged');
  tests.push('Normal Parameters panel: Blank sea + Regenerate + Replace terrain saves starter "sea"');
  await pause(1500); fs.writeFileSync(path.join(evidence, 'blank-sea-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Paint a coast with the Coast brush (Land operation).
  await click('Pincel'); await click('Costa');
  await wait(`${button('Tierra')}`, 'land operation chip'); await js(`${button('Tierra')}.click()`);
  const rect = await js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const pts = [[0.38, 0.40], [0.45, 0.47], [0.52, 0.52], [0.58, 0.58], [0.5, 0.62], [0.42, 0.55], [0.38, 0.4]].map(([u, v]) => ({ x: Math.round(rect.x + rect.w * u), y: Math.round(rect.y + rect.h * v) }));
  const send = event => win.webContents.sendInputEvent(event);
  send({ type: 'mouseMove', x: pts[0].x, y: pts[0].y }); await pause(60);
  send({ type: 'mouseDown', x: pts[0].x, y: pts[0].y, button: 'left', clickCount: 1 });
  for (let i = 1; i < pts.length; i++) for (let s = 1; s <= 12; s++) { const x = Math.round(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * s / 12), y = Math.round(pts[i - 1].y + (pts[i].y - pts[i - 1].y) * s / 12); send({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); await pause(16); }
  send({ type: 'mouseUp', x: pts.at(-1).x, y: pts.at(-1).y, button: 'left', clickCount: 1 });
  await pause(1500);
  for (let i = 0; i < 100; i++) { const r = await js(`(async()=>{const r=await (await import('/src/db/index.ts')).db.generatedWorlds.get('world-presentation-preview-world');return r.edits;})()`); if (/"kind":"land"/.test(r)) break; if (i === 99) throw Error('Painted coast was not saved'); await pause(200); }
  tests.push('Trusted pointer strokes with the Coast brush paint land on the blank sea and the stroke is saved with the world');
  await click('Recalcular clima y ríos');
  await pause(4000);
  fs.writeFileSync(path.join(evidence, 'blank-sea-painted-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Reopen and look at the chart.
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()');
  await wait(forged, 'reopened'); await click('Carta'); await pause(3500);
  fs.writeFileSync(path.join(evidence, 'blank-sea-reopened-carta-1440.png'), (await win.webContents.capturePage()).toPNG());
  const after = await js(`(async()=>{const r=await (await import('/src/db/index.ts')).db.generatedWorlds.get('world-presentation-preview-world');return {starter:r.params.starter,land:/"kind":"land"/.test(r.edits)};})()`);
  assert(after.starter === 'sea' && after.land, 'Reopened world lost the starter or the painted coast');
  tests.push('Reopening keeps the blank-sea recipe and the painted coast; chart captured');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
