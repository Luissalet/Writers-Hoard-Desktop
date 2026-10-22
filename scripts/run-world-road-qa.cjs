// Hand-drawn roads through the normal Road tool: choose a dotted line two and a
// half times as thick, drag a road by hand, and read it back after a reopen.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-road-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-road-qa', configureServer(instance) { instance.middlewares.use('/__world_road_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_road_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_road_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
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
  // The Road tool with a dotted line twice and a half as thick.
  await click('Pincel'); await click('Camino');
  await wait(`document.querySelector('[data-testid="road-pattern"]')`, 'road options');
  await js(`[...document.querySelectorAll('[data-testid="road-pattern"] button')].find(b=>b.textContent.trim()==='Punteada').click()`);
  await js(`(()=>{const i=document.querySelector('[data-testid="road-width"] input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'2.5');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('[data-testid="road-width"]').textContent.includes('×2.5') && [...document.querySelectorAll('[data-testid="road-pattern"] button')].find(b=>b.textContent.trim()==='Punteada').className.includes('amber')`, 'dotted and ×2.5 chosen');
  const roads0 = (await edits()).filter(e => e.kind === 'road').length;
  // A road drawn by hand across Naintosin: press, drag, release.
  const a = { x: Math.round(rect.x + rect.w * 0.22), y: Math.round(rect.y + rect.h * 0.78) }, b = { x: Math.round(rect.x + rect.w * 0.36), y: Math.round(rect.y + rect.h * 0.76) };
  // Pale road ink along the middle of the line, read from the map canvas itself (a hidden window's capture can be stale).
  // The map's canvases along the middle of the line, read from the page itself (a hidden window's capture can be stale).
  const pixelsAlong = () => js(`(()=>{const out=[];for(const c of document.querySelectorAll('canvas')){const r=c.getBoundingClientRect();if(r.width<200)continue;let g=null;try{g=c.getContext('2d');}catch{}if(!g)continue;const k=c.width/r.width;for(let t=0.3;t<=0.7;t+=0.02){const x=${a.x}+(${b.x}-${a.x})*t,y=${a.y}+(${b.y}-${a.y})*t;const d=g.getImageData(Math.round((x-r.x-3)*k),Math.round((y-r.y-3)*k),Math.round(6*k),Math.round(6*k)).data;for(let i=0;i<d.length;i+=4)out.push(d[i],d[i+1],d[i+2],d[i+3]);}}return out;})()`);
  const changed = (before, after) => { let n = 0; for (let i = 0; i < Math.min(before.length, after.length); i += 4) if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 60) n++; return n; };
  const inkBefore = await pixelsAlong();
  assert(inkBefore.length > 0, 'No readable map canvas');
  send({ type: 'mouseMove', x: a.x, y: a.y }); await pause(60);
  send({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 }); await pause(40);
  for (let k = 1; k <= 16; k++) { send({ type: 'mouseMove', x: Math.round(a.x + (b.x - a.x) * k / 16), y: Math.round(a.y + (b.y - a.y) * k / 16), button: 'left', modifiers: ['leftButtonDown'] }); await pause(25); }
  send({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 }); await pause(600);
  let road = null; for (let i = 0; i < 80; i++) { const list = (await edits()).filter(e => e.kind === 'road'); if (list.length > roads0) { road = list[list.length - 1]; break; } await pause(150); }
  if (!road) { win.webContents.invalidate(); await pause(300); await win.webContents.capturePage(); fs.writeFileSync(path.join(evidence, 'road-failed-1440.png'), (await win.webContents.capturePage()).toPNG()); }
  assert(road && road.pattern === 'dotted' && road.width === 2.5 && road.pts.length >= 2 && road.major === false, `Road saved: ${JSON.stringify(road).slice(0, 300)}`);
  let inkChanged = 0; for (let i = 0; i < 40; i++) { inkChanged = changed(inkBefore, await pixelsAlong()); if (inkChanged > 20) break; await pause(150); }
  assert(inkChanged > 20, `The new road is not drawn on the map: ${inkChanged} pixels changed along it`);
  const c1 = await cellAt(a.x, a.y);
  assert(Math.abs(road.pts[0].x - c1.x) < 3 && Math.abs(road.pts[0].y - c1.y) < 3, `The road starts where the drag did: ${JSON.stringify(road.pts[0])} vs ${JSON.stringify(c1)}`);
  tests.push(`Road tool, "Punteada" and thickness ×2.5: a road dragged by hand across Naintosin is saved as a track of ${road.pts.length} points with its dotted pattern and width, starting where the drag did, and drawn at once (${inkChanged} pixels along it changed)`);
  await pause(4000);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'road-dotted-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Reopen: the road is still there with its look; the tool still offers the class's own line.
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const again = (await edits()).filter(e => e.kind === 'road');
  assert(again.length === roads0 + 1 && again[again.length - 1].pattern === 'dotted' && again[again.length - 1].width === 2.5, 'Reopen lost the road');
  await pause(4000);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'road-reopened-1440.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Reopening keeps the road, dotted and ×2.5');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
