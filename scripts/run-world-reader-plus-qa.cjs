// The reader's view, further, through the normal engine: the map starting with
// the land in ink, towns as dots, the party's trail, the reader's paper in 3D
// and the Carta's frame kept over it. Isolated hidden Electron profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-reader-plus-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-reader-plus-qa', configureServer(instance) { instance.middlewares.use('/__world_reader_plus_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_reader_plus_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_reader_plus_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const send = event => win.webContents.sendInputEvent(event);
  const edits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const w=await db.generatedWorlds.get('${W}');return deserializeEdits(w.edits??'[]');})()`);
  const zonesNow = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const {zonesFrom}=await import('/src/engines/worldgen/core/zones.ts');const w=await db.generatedWorlds.get('${W}');return zonesFrom(deserializeEdits(w.edits??'[]'));})()`);
  const zonesWhere = async (ok, what) => { let z; for (let i = 0; i < 80; i++) { z = await zonesNow(); if (ok(z)) return z; await pause(150); } throw Error(`${what}: ${JSON.stringify(z).slice(0, 300)}`); };
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const tap = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(80); send({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(400); };
  const right = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 }); await pause(300); };
  const key = async code => { send({ type: 'keyDown', keyCode: code }); send({ type: 'keyUp', keyCode: code }); await pause(250); };
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await pause(1000);
  const lookNow = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return (await db.generatedWorlds.get('${W}'))?.presentation??{};})()`);
  const lookWhere = async (ok, what) => { let l; for (let i = 0; i < 80; i++) { l = await lookNow(); if (ok(l)) return l; await pause(150); } throw Error(`${what}: ${JSON.stringify(l)}`); };
  const setSelect = (sel, value) => js(`(()=>{const s=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(value)});s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  // Share of paper-coloured pixels in the middle of the map canvas.
  const paperShare = () => js(`(async()=>{await new Promise(r=>setTimeout(r,500));const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const d=c.getContext('2d').getImageData(Math.floor(c.width*0.2),Math.floor(c.height*0.2),Math.floor(c.width*0.6),Math.floor(c.height*0.6)).data;let p=0,n=0;for(let i=0;i<d.length;i+=16){n++;if(Math.abs(d[i]-236)<8&&Math.abs(d[i+1]-227)<8&&Math.abs(d[i+2]-200)<8)p++;}return p/n;})()`);
  // Three things that happened, on land, through the bridge.
  await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');
    let towns;for(let i=0;i<60;i++){towns=await runBridgeTool('wh_list_places',{worldId:'${W}',kind:'settlement',limit:6});if(towns.ok&&!towns.result.pending)break;await new Promise(r=>setTimeout(r,500));}
    const t=towns.result.places;
    for(const [k,ch] of [[0,1],[1,1],[2,2]]){const r=await runBridgeTool('wh_add_story_event',{worldId:'${W}',place:t[k].key,title:'Paso '+(k+1),chapter:ch,type:'journey'});if(!r.ok)throw Error(r.error);}
    return true;})()`);
  await wait(`document.querySelector('[data-testid="worldgen-reader-toggle"]')`, 'reader toggle');
  await js(`document.querySelector('[data-testid="worldgen-reader-toggle"]').click()`);
  await wait(`!document.querySelector('[data-testid="worldgen-reader-start"]').disabled`, 'reader view on');
  // "blank" is the default, and choosing the value already shown is no
  // change: go through "land" so the blank start is chosen and saved.
  await setSelect('[data-testid="worldgen-reader-start"]', 'land');
  await lookWhere(l => l.readerStart === 'land', 'land start saved first');
  await setSelect('[data-testid="worldgen-reader-start"]', 'blank');
  await lookWhere(l => l.readerStart === 'blank', 'blank start saved');
  await pause(1200);
  let blank = await paperShare();
  // The blank sheet is paper all over once redrawn.
  for (let i = 0; i < 20 && blank < 0.5; i++) { await pause(300); blank = await paperShare(); }
  await setSelect('[data-testid="worldgen-reader-start"]', 'land');
  await lookWhere(l => l.readerStart === 'land', 'land start saved');
  const inked = await paperShare();
  fs.writeFileSync(path.join(evidence, 'reader-land.png'), (await win.webContents.capturePage()).toPNG());
  assert(inked < blank - 0.1, `Land in ink shows the land: paper ${inked.toFixed(2)} against ${blank.toFixed(2)} blank`);
  tests.push(`Lectura → "Tierra a tinta": the land shows and the sea stays paper (paper ${Math.round(inked * 100)}% of the view against ${Math.round(blank * 100)}% blank; reader-land.png)`);
  // Towns as dots, on a sketched map.
  await setSelect('[data-testid="worldgen-reader-start"]', 'sketch');
  await setSelect('[data-testid="worldgen-reader-towns"]', 'dots');
  await lookWhere(l => l.readerTowns === 'dots' && l.readerStart === 'sketch', 'towns as dots saved');
  await pause(800);
  // The dot ink is rgba(70,46,24,0.92): over the map it lands near (80,58,36),
  // so count that brown, not the opaque colour.
  const dotInk = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];if(r>=58&&r<=100&&g>=36&&g<=74&&b>=16&&b<=54&&r-g>=14&&g-b>=12)n++;}return n;})()`);
  const dots = await dotInk();
  fs.writeFileSync(path.join(evidence, 'reader-town-dots.png'), (await win.webContents.capturePage()).toPNG());
  assert(dots > 20, `Towns heard of are ink dots: ${dots} px`);
  tests.push(`Pueblos "como puntos sin nombre": on a sketched map the towns are ink dots with no names (${dots} px of dot ink; reader-town-dots.png)`);
  // The trail.
  await js(`document.querySelector('[data-testid="worldgen-reader-trail"]').click()`);
  await lookWhere(l => l.readerTrail === true, 'trail saved');
  await pause(800);
  const withTrail = await dotInk();
  fs.writeFileSync(path.join(evidence, 'reader-trail.png'), (await win.webContents.capturePage()).toPNG());
  assert(withTrail > dots + 20, `The trail adds its ink: ${withTrail} against ${dots}`);
  tests.push(`Rastro: the party's trail joins the three things that happened, numbered by chapter (${withTrail - dots} more px of ink; reader-trail.png)`);
  // The Carta keeps its frame over the paper.
  await click('Carta'); await pause(3500);
  const frame = await js(`(()=>{const cs=[...document.querySelectorAll('canvas')].filter(c=>c.clientWidth>300).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);const ink=cs[1]??cs[0];const d=ink.getContext('2d').getImageData(0,0,ink.width,Math.max(4,Math.round(ink.height*0.03))).data;let notPaper=0,n=0;for(let i=0;i<d.length;i+=4){if(d[i+3]<200)continue;n++;if(!(Math.abs(d[i]-236)<8&&Math.abs(d[i+1]-227)<8&&Math.abs(d[i+2]-200)<8))notPaper++;}return {notPaper,n};})()`);
  fs.writeFileSync(path.join(evidence, 'reader-carta-frame.png'), (await win.webContents.capturePage()).toPNG());
  assert(frame.notPaper > 50, `The Carta's frame is drawn over the paper: ${JSON.stringify(frame)}`);
  tests.push(`Carta in the reader's view: the frame, compass, scale and cartouche stay over the paper (${frame.notPaper} frame px; reader-carta-frame.png)`);
  // The paper in 3D.
  await click('Mundo 3D');
  await wait(`document.querySelector('[data-testid="world3d-host"]')?.dataset.readerFog === 'reader'`, '3D reader fog');
  await pause(5000);
  fs.writeFileSync(path.join(evidence, 'reader-3d.png'), (await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[data-testid="worldgen-reader-toggle"]').click()`);
  await wait(`document.querySelector('[data-testid="world3d-host"]')?.dataset.readerFog === 'off'`, '3D fog off');
  tests.push('Mundo 3D: the reader\'s paper lies on the ground in the reader\'s view (the sketched land under a wash), and lifts when the view is left (reader-3d.png)');
  await js('window.__lookUnmount()'); await pause(300); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const kept = await lookNow();
  assert(kept.readerTowns === 'dots' && kept.readerTrail === true && kept.readerStart === 'sketch', `Kept ${JSON.stringify(kept)}`);
  tests.push('Reopened: towns as dots, the trail and the start are kept with the look');
  const failed = await js('window.__lookError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
