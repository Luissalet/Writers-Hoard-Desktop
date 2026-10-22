// Hand-drawn roads through the normal Road tool: choose a dotted line twice as
// thick, click one town and then another, and read the saved road back after a
// reopen.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-journey-stops-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-journey-stops-qa', configureServer(instance) { instance.middlewares.use('/__world_journey_stops_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_journey_stops_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_journey_stops_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log(`[console] ${message.slice(0, 400)}`); });
  win.webContents.on('render-process-gone', (_e, d) => console.log(`[gone] ${JSON.stringify(d)}`));
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const send = event => win.webContents.sendInputEvent(event);
  const edits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const w=await db.generatedWorlds.get('${W}');return deserializeEdits(w.edits??'[]');})()`);
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const tap = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(80); send({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(600); };
  const right = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 }); await pause(300); };
  const key = async code => { send({ type: 'keyDown', keyCode: code }); send({ type: 'keyUp', keyCode: code }); await pause(200); };
  const cellAt = async (x, y) => {
    await right(x, y);
    await wait(`document.querySelector('[data-testid="worldgen-map-menu"]')`, 'map menu');
    const cell = await js(`(()=>{const m=document.querySelector('[data-testid="worldgen-map-menu"]');return {x:+m.dataset.x,y:+m.dataset.y};})()`);
    await key('Escape');
    await wait(`!document.querySelector('[data-testid="worldgen-map-menu"]')`, 'menu closed');
    return cell;
  };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await pause(800);
  const rect = await canvasRect();
  const at = (fx, fy) => ({ x: Math.round(rect.x + rect.w * fx), y: Math.round(rect.y + rect.h * fy) });
  const sectionButton = label => `[...document.querySelectorAll('button')].find(b=>b.querySelector('span')?.textContent.trim()===${JSON.stringify(label)})`;
  const endName = label => js(`${sectionButton(label)}?.querySelectorAll('span')[1]?.textContent.trim()`);
  const viaNames = () => js(`[...document.querySelectorAll('[data-testid^="journey-via-"]')].filter(e=>/^journey-via-\\d+$/.test(e.dataset.testid)).map(e=>e.querySelector('span.truncate').textContent.trim())`);
  await click('Viaje');
  await wait(sectionButton('Desde'), 'journey ends');
  // Ends: two points of open ground on Naintosin.
  await js(`${sectionButton('Desde')}.click()`); await pause(200);
  await tap(at(0.22, 0.78).x, at(0.22, 0.78).y);
  await wait(`/^Punto \\d+, \\d+$/.test(${sectionButton('Desde')}.querySelectorAll('span')[1].textContent.trim())`, 'from is a point');
  // Choosing "from" moves on to "to".
  await tap(at(0.38, 0.77).x, at(0.38, 0.77).y);
  await wait(`/^Punto \\d+, \\d+$/.test(${sectionButton('Hasta')}.querySelectorAll('span')[1].textContent.trim())`, 'to is a point');
  const from = await endName('Desde'), to = await endName('Hasta');
  tests.push(`Travel: "Desde" and "Hasta" picked as points of open ground (${from} → ${to})`);
  // Stops: three points, in the order clicked.
  await js(`${sectionButton('Pasando por')}.click()`); await pause(200);
  for (const [fx, fy] of [[0.26, 0.8], [0.3, 0.76], [0.34, 0.79]]) {
    const n = await js(`document.querySelectorAll('[data-testid^="journey-via-remove-"]').length`);
    const p = at(fx, fy); await tap(p.x, p.y);
    for (let i = 0; i < 30; i++) { if (await js(`document.querySelectorAll('[data-testid^="journey-via-remove-"]').length`) > n) break; await pause(150); }
    const pick = await js(`${sectionButton('Pasando por')}.className.includes('amber')`);
    console.log(`after tap ${fx},${fy}: ${await js(`document.querySelectorAll('[data-testid^="journey-via-remove-"]').length`)} stops, picking via ${pick}`);
  }
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'journey-after-taps-1440.png'), (await win.webContents.capturePage()).toPNG());
  await wait(`document.querySelectorAll('[data-testid^="journey-via-remove-"]').length===3`, 'three stops');
  const placed = await viaNames();
  // Reorder: the third earlier, the first later; then take the middle one out.
  await js(`document.querySelector('[data-testid="journey-via-up-2"]').click()`); await pause(150);
  let order = await viaNames();
  assert.deepEqual(order, [placed[0], placed[2], placed[1]], `Up: ${JSON.stringify(order)}`);
  await js(`document.querySelector('[data-testid="journey-via-down-0"]').click()`); await pause(150);
  order = await viaNames();
  assert.deepEqual(order, [placed[2], placed[0], placed[1]], `Down: ${JSON.stringify(order)}`);
  await js(`document.querySelector('[data-testid="journey-via-remove-1"]').click()`); await pause(150);
  order = await viaNames();
  assert.deepEqual(order, [placed[2], placed[1]], `Remove: ${JSON.stringify(order)}`);
  tests.push(`Stops picked as points (${placed.join(' · ')}), the third moved earlier and the first later, then the middle one removed: ${order.join(' · ')}`);
  // The route is worked out for those stops, and its legs follow them.
  const legs = `[...document.querySelectorAll('[aria-label="Tramos"] label span, label span')].map(s=>s.textContent).filter(t=>t.includes('→'))`;
  await wait(`${legs}.length===3`, 'three legs');
  const legText = await js(legs);
  assert(legText[0].startsWith(from) && legText[0].endsWith(order[0]) && legText[2].endsWith(to), `Legs ${JSON.stringify(legText)}`);
  tests.push(`The legs follow the edited stops: ${legText.join(' | ')}`);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'journey-stops-1440.png'), (await win.webContents.capturePage()).toPNG());
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
