// Map stamps through the normal tools: choose one in Point → Stamp, place it with
// a trusted click, drag it with Move, see it in the Carta and after reopening.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-stamps-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-stamps-qa', configureServer(instance) { instance.middlewares.use('/__world_stamps_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_stamps_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_stamps_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const row = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const r=await db.generatedWorlds.get('${W}');return deserializeEdits(r.edits).filter(e=>e.kind==='stamp'||e.kind==='move');})()`);
  const send = event => win.webContents.sendInputEvent(event);
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const tap = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(400); };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await click('Pincel'); await click('Colocar'); await click('Sello');
  await wait(`document.querySelector('[data-testid="stamp-picker"]')`, 'stamp picker');
  await click('Fortalezas');
  await wait(`document.querySelector('[data-testid="stamp-wizardTower"]')`, 'wizard tower');
  await js(`document.querySelector('[data-testid="stamp-wizardTower"]').click()`);
  await js(`document.querySelector('[data-testid="stamp-size-L"]').click()`);
  await js(`(()=>{const i=document.querySelector('[data-testid="stamp-name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Torre de Ébano');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(300);
  const shootPicker = async (name) => {
    const box = await js(`(()=>{const e=document.querySelector('[data-testid="stamp-picker"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()`);
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(700);
    fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage(box)).toPNG());
  };
  await shootPicker('stamps-picker-1440.png');
  await js('window.scrollTo(0,0)'); await pause(300);
  const rect = await canvasRect();
  const at = { x: Math.round(rect.x + rect.w * 0.42), y: Math.round(rect.y + rect.h * 0.5) };
  await tap(at.x, at.y);
  let edits; for (let i = 0; i < 60; i++) { edits = await row(); if (edits.some(e => e.kind === 'stamp')) break; await pause(150); }
  const placed = edits.find(e => e.kind === 'stamp');
  assert(placed && placed.glyph === 'wizardTower' && placed.size === 'L' && placed.name === 'Torre de Ébano', `Stamp not placed: ${JSON.stringify(edits)}`);
  tests.push(`Point → Stamp → Forts → Wizard's tower, size L, named "${placed.name}", placed with a trusted click at ${Math.round(placed.x)},${Math.round(placed.y)}`);
  // Its picture is on the map canvas (amber-ish ink differs from the sea underneath).
  await pause(600);
  const inked = await js(`(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const r=c.getBoundingClientRect(),k=c.width/r.width;const d=c.getContext('2d').getImageData(Math.round((${at.x}-r.x-12)*k),Math.round((${at.y}-r.y-14)*k),Math.round(24*k),Math.round(28*k)).data;let light=0;for(let i=0;i<d.length;i+=4)if(d[i]>220&&d[i+1]>200&&d[i+2]>170)light++;return light;})()`);
  assert(inked > 20, `No stamp ink at the click (${inked})`);
  tests.push(`The stamp is drawn on the map where it was placed (${inked} pale paper pixels)`);
  // Move it with the Move tool, a trusted drag.
  await click('Mover'); await pause(400);
  const to = { x: at.x + 80, y: at.y + 30 };
  send({ type: 'mouseMove', x: at.x, y: at.y }); await pause(60);
  send({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  for (let s = 1; s <= 12; s++) { send({ type: 'mouseMove', x: Math.round(at.x + (to.x - at.x) * s / 12), y: Math.round(at.y + (to.y - at.y) * s / 12), button: 'left', modifiers: ['leftButtonDown'] }); await pause(20); }
  send({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  let move; for (let i = 0; i < 60; i++) { edits = await row(); move = edits.find(e => e.kind === 'move' && e.target === 'stamp'); if (move) break; await pause(150); }
  assert(move && move.key === `stamp:${Math.round(placed.x)},${Math.round(placed.y)}`, `Move not saved: ${JSON.stringify(edits)}`);
  tests.push('The Move tool drags the stamp to a new place and saves a move under its key');
  await pause(800); fs.writeFileSync(path.join(evidence, 'stamps-atlas-1440.png'), (await win.webContents.capturePage()).toPNG());
  await click('Carta'); await pause(3500);
  fs.writeFileSync(path.join(evidence, 'stamps-carta-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Carta view captured with the stamp and its name');
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const kept = await row();
  assert(kept.some(e => e.kind === 'stamp' && e.glyph === 'wizardTower') && kept.some(e => e.kind === 'move' && e.target === 'stamp'), 'Reopen lost the stamp');
  tests.push('Reopening keeps the stamp and its move');
  win.setContentSize(640, 900); await click('Pincel'); await click('Colocar'); await click('Sello'); await pause(1200);
  await shootPicker('stamps-picker-640.png');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
