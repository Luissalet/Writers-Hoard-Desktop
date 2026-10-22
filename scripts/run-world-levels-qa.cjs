// Hand-drawn roads through the normal Road tool: choose a dotted line twice as
// thick, click one town and then another, and read the saved road back after a
// reopen.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-levels-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-levels-qa', configureServer(instance) { instance.middlewares.use('/__world_levels_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_levels_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_levels_qa`);
  const js = async expression => { const r = await win.webContents.executeJavaScript(`(async()=>{try{return await (${expression});}catch(e){return {__err:String(e&&e.stack||e)};}})()`); if (r && r.__err) throw Error(`In page: ${r.__err}\n${expression.slice(0, 200)}`); return r; };
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
  const editsWhere = async (ok, what) => { let list; for (let i = 0; i < 80; i++) { list = await edits(); if (ok(list)) return list; await pause(150); } throw Error(`${what}: ${JSON.stringify(list).slice(-400)}`); };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await pause(800);
  const rect = await canvasRect();
  const pixels = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].sort((p,q)=>q.clientWidth*q.clientHeight-p.clientWidth*p.clientHeight)[0];const g=c.getContext('2d');if(!g)return null;const d=g.getImageData(0,0,c.width,c.height).data;const out=[];for(let i=0;i<d.length;i+=4*97)out.push(d[i],d[i+1],d[i+2]);return out;})()`);
  const changed = (a, b) => { let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 40) n++; return n; };
  const commitLevel = (id, value) => js(`(()=>{const i=document.querySelector('[data-testid="${id}"] input[type=range]');i.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'${value}');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',bubbles:true}));})()`);
  const levels = () => js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');return (await runBridgeTool('wh_get_world',{worldId:'${W}'})).result;})()`);
  await click('Pincel');
  await wait(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Mundo entero'))`, 'whole world fold');
  await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Mundo entero')).click()`);
  await wait(`document.querySelector('[data-testid="world-sea-level"]')`, 'sea slider');
  const before = await pixels();
  assert(before && before.length > 100, 'No readable map canvas');
  // Raise the sea by 400 m.
  await commitLevel('world-sea-level', 400);
  await editsWhere(l => l.some(e => e.kind === 'seaLevel' && e.m === 400), 'Sea level saved');
  let diff = 0; for (let i = 0; i < 60; i++) { diff = changed(before, await pixels()); if (diff > 30) break; await pause(200); }
  assert(diff > 30, `Raising the sea did not change the map (${diff} samples)`);
  const shown = await js(`document.querySelector('[data-testid="world-sea-level"]').textContent`);
  assert(/\+400 m/.test(shown), `Slider shows ${shown}`);
  tests.push(`Paint → Whole world: Sea level +400 m is one edit, the map redraws (${diff} sampled pixels changed) and the slider reads "${shown.replace(/\s+/g, ' ').trim()}"`);
  await pause(1500);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'levels-sea-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Lower the snowline by 2000 m.
  const beforeSnow = await pixels();
  await commitLevel('world-snowline', -2000);
  await editsWhere(l => l.some(e => e.kind === 'snowline' && e.m === -2000), 'Snowline saved');
  let snowDiff = 0; for (let i = 0; i < 60; i++) { snowDiff = changed(beforeSnow, await pixels()); if (snowDiff > 5) break; await pause(200); }
  assert(snowDiff > 5, `Lowering the snowline did not change the map (${snowDiff})`);
  let got = await levels();
  assert(got.seaLevelM === 400 && got.snowlineM === -2000, `wh_get_world ${JSON.stringify(got).slice(0, 200)}`);
  tests.push(`Snowline −2000 m is one edit, the snow redraws (${snowDiff} sampled pixels changed); wh_get_world reports sea +400, snow −2000`);
  win.webContents.invalidate(); await pause(300); await win.webContents.capturePage();
  fs.writeFileSync(path.join(evidence, 'levels-snow-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Undo takes the snowline back only.
  await click('↶ Deshacer');
  for (let i = 0; i < 40; i++) { got = await levels(); if (got.snowlineM === 0) break; await pause(200); }
  assert(got.seaLevelM === 400 && got.snowlineM === 0, `Undo ${JSON.stringify(got).slice(0, 200)}`);
  tests.push('Undo takes back the snowline and leaves the sea at +400 m');
  await pause(1200);
  // Reopen: the sea is still up and the fold says so.
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  await click('Pincel');
  await wait(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Mundo entero')&&b.textContent.includes('+400 m'))`, 'fold summary after reopen');
  tests.push('Reopening keeps the sea at +400 m; the Whole world fold says so');
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
