// The reader's-eye map through the normal tools: paint Seen and Heard-of strokes
// with chapters using the Fog brush, hide one again with Ctrl, open the Reader's
// view, step its chapter, change how it starts, and reopen.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-fog-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-fog-qa', configureServer(instance) { instance.middlewares.use('/__world_fog_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_fog_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_fog_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const setValue = (selector, value, kind = 'HTMLInputElement', event = 'input') => js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(i,${JSON.stringify(String(value))});i.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const fogEdits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const r=await db.generatedWorlds.get('${W}');return deserializeEdits(r.edits||'[]').filter(e=>e.kind==='fog');})()`);
  const look = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return (await db.generatedWorlds.get('${W}'))?.presentation?.readerStart;})()`);
  const send = event => win.webContents.sendInputEvent(event);
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const drag = async (from, to, modifiers = []) => {
    send({ type: 'mouseMove', x: from.x, y: from.y, modifiers }); await pause(60);
    send({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1, modifiers }); await pause(40);
    for (let s = 1; s <= 10; s++) { send({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * s / 10), y: Math.round(from.y + (to.y - from.y) * s / 10), button: 'left', modifiers: ['leftButtonDown', ...modifiers] }); await pause(25); }
    send({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1, modifiers }); await pause(500);
  };
  // The pixel on the map canvas under a screen point.
  const pixel = p => js(`(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const r=c.getBoundingClientRect(),k=c.width/r.width;return [...c.getContext('2d').getImageData(Math.round((${p.x}-r.x)*k),Math.round((${p.y}-r.y)*k),1,1).data];})()`);
  const isPaper = px => Math.abs(px[0] - 236) < 6 && Math.abs(px[1] - 227) < 6 && Math.abs(px[2] - 200) < 6;
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(500); };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await click('Pincel'); await click('Niebla');
  await wait(`document.querySelector('[data-testid="paint-fog"]')`, 'fog controls');
  const rect = await canvasRect();
  const A = { x: Math.round(rect.x + rect.w * 0.34), y: Math.round(rect.y + rect.h * 0.52) };
  const B = { x: Math.round(rect.x + rect.w * 0.64), y: Math.round(rect.y + rect.h * 0.52) };
  const C = { x: Math.round(rect.x + rect.w * 0.5), y: Math.round(rect.y + rect.h * 0.2) };
  // Seen from chapter 1 around A.
  await js(`document.querySelector('[data-testid="paint-fog-seen"] button').click()`);
  await setValue('[data-testid="paint-fog-chapter"]', 1);
  await drag({ x: A.x - 30, y: A.y }, { x: A.x + 30, y: A.y });
  // Heard of from chapter 3 around B.
  await js(`document.querySelector('[data-testid="paint-fog-heard"] button').click()`);
  await setValue('[data-testid="paint-fog-chapter"]', 3);
  await drag({ x: B.x - 30, y: B.y }, { x: B.x + 30, y: B.y });
  let edits; for (let i = 0; i < 80; i++) { edits = await fogEdits(); if (edits.length >= 2) break; await pause(150); }
  assert(edits.length === 2 && edits[0].op === 'seen' && edits[0].chapter === 1 && edits[1].op === 'heard' && edits[1].chapter === 3, `Fog strokes not saved: ${JSON.stringify(edits.map(e => [e.op, e.chapter]))}`);
  tests.push('Fog brush: a Seen stroke from chapter 1 and a Heard-of stroke from chapter 3, painted with trusted drags, are saved with op and chapter');
  await settle(); fs.writeFileSync(path.join(evidence, 'fog-author-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Ctrl hides again: a short stroke past the west end of A, from the start.
  await setValue('[data-testid="paint-fog-chapter"]', '');
  await drag({ x: A.x - 72, y: A.y }, { x: A.x - 64, y: A.y }, ['control']);
  for (let i = 0; i < 80; i++) { edits = await fogEdits(); if (edits.length >= 3) break; await pause(150); }
  assert(edits.length === 3 && edits[2].op === 'hide' && edits[2].chapter === undefined, `Ctrl stroke: ${JSON.stringify(edits.map(e => [e.op, e.chapter]))}`);
  tests.push('Ctrl with the Fog brush paints Hide (no chapter)');
  // The reader's view: blank paper where the story has not been.
  await js(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Mano'))?.click()`); await pause(300);
  await js(`document.querySelector('[data-testid="worldgen-reader-toggle"]').click()`);
  await wait(`document.querySelector('[data-testid="worldgen-reader-chapter"]:not([disabled])')`, 'reader chapter');
  await settle();
  const rectAfter = await canvasRect();
  assert(JSON.stringify(rectAfter) === JSON.stringify(rect), `Opening the reader's view moved the map: ${JSON.stringify(rect)} → ${JSON.stringify(rectAfter)}`);
  let pa = await pixel(A), pb = await pixel(B), pc = await pixel(C);
  assert(isPaper(pc) && !isPaper(pa) && !isPaper(pb), `Reader view (all): A ${pa} B ${pb} C ${pc}`);
  tests.push('Opening the reader\'s view leaves the map where it was; everything painted: unpainted ground is blank paper; the Seen and Heard-of ground is not');
  fs.writeFileSync(path.join(evidence, 'fog-reader-all-1440.png'), (await win.webContents.capturePage()).toPNG());
  const options = await js(`[...document.querySelectorAll('[data-testid="worldgen-reader-chapter"] option')].map(o=>o.value)`);
  assert(JSON.stringify(options) === '["","1","3"]', `Chapter options ${JSON.stringify(options)}`);
  await setValue('[data-testid="worldgen-reader-chapter"]', '1', 'HTMLSelectElement', 'change'); await settle();
  pa = await pixel(A); pb = await pixel(B);
  assert(!isPaper(pa) && isPaper(pb), `Reader view up to chapter 1: A ${pa} B ${pb}`);
  tests.push('Up to chapter 1 the chapter-3 rumour is still blank paper while the chapter-1 ground is shown');
  fs.writeFileSync(path.join(evidence, 'fog-reader-ch1-1440.png'), (await win.webContents.capturePage()).toPNG());
  await setValue('[data-testid="worldgen-reader-chapter"]', '3', 'HTMLSelectElement', 'change'); await settle();
  pb = await pixel(B);
  assert(!isPaper(pb), `Up to chapter 3 the rumour should show: ${pb}`);
  tests.push('Up to chapter 3 the Heard-of ground appears under its wash');
  // How the reader's map starts, saved with the look.
  await setValue('[data-testid="worldgen-reader-start"]', 'ink', 'HTMLSelectElement', 'change');
  let start; for (let i = 0; i < 60; i++) { start = await look(); if (start === 'ink') break; await pause(150); }
  assert(start === 'ink', `readerStart not saved: ${start}`); await settle();
  pc = await pixel(C);
  assert(!isPaper(pc), `With "All seen" the unpainted ground should be shown: ${pc}`);
  tests.push('"All seen" as the starting state is saved with the world\'s look and shows unpainted ground');
  await setValue('[data-testid="worldgen-reader-start"]', 'blank', 'HTMLSelectElement', 'change');
  for (let i = 0; i < 60; i++) { start = await look(); if (start === 'blank') break; await pause(150); }
  await click('Carta'); await pause(3500);
  // The Carta's paper share across its canvases (the ink layer carries the fog).
  const cartaPaper = () => js(`(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));let best=0;for(const c of document.querySelectorAll('canvas')){if(c.width<300)continue;const d=c.getContext('2d')?.getImageData(0,0,c.width,c.height).data;if(!d)continue;let n=0;for(let i=0;i<d.length;i+=16)if(d[i+3]===255&&Math.abs(d[i]-236)<6&&Math.abs(d[i+1]-227)<6&&Math.abs(d[i+2]-200)<6)n++;best=Math.max(best,n/(d.length/16));}return best;})()`);
  let onPaper = 0; for (let i = 0; i < 30; i++) { onPaper = await cartaPaper(); if (onPaper > 0.5) break; await pause(300); }
  fs.writeFileSync(path.join(evidence, 'fog-reader-carta-1440.png'), (await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[data-testid="worldgen-reader-toggle"]').click()`); await pause(800);
  const offPaper = await cartaPaper();
  assert(onPaper > 0.5 && offPaper < onPaper / 2, `Carta reader's view: paper ${onPaper} on, ${offPaper} off`);
  tests.push(`The Carta draws the reader's view too (${Math.round(onPaper * 100)}% blank paper with it, ${Math.round(offPaper * 100)}% without)`);
  await js(`document.querySelector('[data-testid="worldgen-reader-toggle"]').click()`); await pause(300);
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const kept = await fogEdits();
  assert(kept.length === 3, 'Reopen lost fog strokes');
  await wait(`document.querySelector('[data-testid="worldgen-reader-toggle"]')`, 'reader toggle');
  const pressed = await js(`document.querySelector('[data-testid="worldgen-reader-toggle"]').getAttribute('aria-pressed')`);
  assert(pressed === 'false' && (await look()) === 'blank', 'Reopen state');
  tests.push('Reopening keeps the three strokes and the saved start; the reader\'s view starts closed');
  win.setContentSize(640, 900); await pause(800);
  await js(`document.querySelector('[data-testid="worldgen-reader-toggle"]').click()`); await settle(); await pause(800);
  fs.writeFileSync(path.join(evidence, 'fog-reader-640.png'), (await win.webContents.capturePage()).toPNG());
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
