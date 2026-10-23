// Story events told in the manuscript and trade that goes round, through the
// normal engine: an event linked to a chapter from the Story list and dragged to
// the top of its chapter; the trade lens drawing its ways, also on a curved map,
// and the bridge giving each shipment its way. Isolated hidden Electron profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-routes-scenes-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-routes-scenes-qa', configureServer(instance) { instance.middlewares.use('/__world_routes_scenes_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_routes_scenes_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_routes_scenes_qa`);
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
  await pause(800);
  const P = 'world-presentation-preview';
  const storyNow = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const {storyEventsFrom}=await import('/src/engines/worldgen/core/storyEvents.ts');const w=await db.generatedWorlds.get('${W}');return storyEventsFrom(deserializeEdits(w.edits??'[]'));})()`);
  const storyWhere = async (ok, what) => { let e; for (let i = 0; i < 80; i++) { e = await storyNow(); if (ok(e)) return e; await pause(150); } throw Error(`${what}: ${JSON.stringify(e).slice(0, 400)}`); };
  // A chapter of the manuscript, and three events of chapter 2 put down through the bridge.
  const ids = await js(`(async()=>{const {db}=await import('/src/db/index.ts');
    await db.writings.put({id:'qa-huida',projectId:'${P}',title:'La huida',status:'draft',content:'',wordCount:0,chapter:2,tags:[],createdAt:1,updatedAt:1});
    const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const out=[];
    for(const [t,x] of [['Salen de noche',60],['Cruzan el vado',70],['Los alcanzan',80]]){const r=await runBridgeTool('wh_add_story_event',{worldId:'${W}',x,y:60,title:t,chapter:2,type:'journey'});if(!r.ok)throw Error(r.error);out.push(r.result.event.id);}
    return out;})()`);
  await click('Pincel'); await click('Sucesos');
  await wait(`document.querySelector('[data-testid="story-item-${ids[1]}"]')`, 'story list');
  await js(`document.querySelector('[data-testid="story-item-${ids[1]}"]').click()`);
  await wait(`document.querySelector('[data-testid="story-writing-pick"]')`, 'manuscript picker');
  await js(`(()=>{const s=document.querySelector('[data-testid="story-writing-pick"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'qa-huida');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await storyWhere(e => e.find(x => x.id === ids[1])?.writingId === 'qa-huida', 'linked');
  await wait(`document.querySelector('[data-testid="story-writing-open"]') && document.querySelector('[data-testid="story-item-writing-${ids[1]}"]')`, 'open button and mark');
  fs.writeFileSync(path.join(evidence, 'story-linked.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Sucesos: "Cruzan el vado" is linked to the chapter "La huida" from its "Dónde se cuenta" list; the list marks it ¶ and offers to open it (story-linked.png)');
  // Drag the last of chapter 2 onto the first: it goes first.
  await js(`(()=>{const from=document.querySelector('[data-testid="story-row-${ids[2]}"]'),to=document.querySelector('[data-testid="story-row-${ids[0]}"]');const dt=new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    to.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:dt}));
    to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));})()`);
  await pause(200);
  await js(`(()=>{const from=document.querySelector('[data-testid="story-row-${ids[2]}"]'),to=document.querySelector('[data-testid="story-row-${ids[0]}"]');const dt=new DataTransfer();dt.setData('text/plain','${ids[2]}');
    to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
    to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
    from.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:dt}));})()`);
  const ordered = await storyWhere(e => e.filter(x => x.chapter === 2).map(x => x.id).join() === [ids[2], ids[0], ids[1]].join(), 'dragged first');
  const listed = await js(`[...document.querySelectorAll('[data-testid^="story-row-"]')].map(e=>e.dataset.testid.slice(10)).join()`);
  assert(listed.startsWith([ids[2], ids[0], ids[1]].join()), `List order ${listed}`);
  await js('window.__lookUnmount()'); await pause(300); await js('window.__lookMount()'); await wait(forged, 'reopened');
  const reopened = await storyNow();
  assert(reopened.filter(x => x.chapter === 2).map(x => x.id).join() === [ids[2], ids[0], ids[1]].join() && reopened.find(x => x.id === ids[1]).writingId === 'qa-huida', 'Kept after reopening');
  tests.push(`Dragging "Los alcanzan" onto "Salen de noche" puts it first in chapter 2 (${ordered.filter(x => x.chapter === 2).map(x => x.title).join(' → ')}); kept with the link after reopening`);
  // ---- the trade lens -------------------------------------------------------------
  await click('Comercio');
  await wait(`document.querySelector('[data-testid="trade-month"]')`, 'trade lens');
  // A month with shipments on the road.
  const routes = await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');
    for(let m=1;m<=8;m++){const r=await runBridgeTool('wh_world_economy',{worldId:'${W}',month:m,routes:true,limit:5});if(!r.ok)throw Error(r.error);
      const mv=r.result.movements;const bent=mv.filter(x=>x.path&&x.path.length>2);if(mv.length)return {month:m,count:mv.length,bent:bent.length,sea:mv.filter(x=>x.bySea).length,sample:mv[0]};}
    return null;})()`);
  assert(routes && routes.count > 0 && routes.sample.path.length >= 2 && routes.sample.lengthKm > 0, `Bridge routes: ${JSON.stringify(routes).slice(0, 300)}`);
  for (let k = 1; k < routes.month; k++) await js(`document.querySelector('[data-testid="trade-next"]')?.click()`);
  await pause(1200);
  const inked = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let sea=0,land=0;for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];if(Math.abs(r-40)<14&&Math.abs(g-110)<16&&Math.abs(b-190)<16)sea++;else if(Math.abs(r-120)<14&&Math.abs(g-70)<14&&Math.abs(b-30)<14)land++;}return {sea,land};})()`);
  const flat = await inked();
  fs.writeFileSync(path.join(evidence, 'trade-ways.png'), (await win.webContents.capturePage()).toPNG());
  await js(`(()=>{const s=document.querySelector('[data-testid="worldgen-projection"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'mollweide');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await pause(2500);
  const curved = await inked();
  fs.writeFileSync(path.join(evidence, 'trade-mollweide.png'), (await win.webContents.capturePage()).toPNG());
  assert(curved.sea + curved.land > 20, `The lens on Mollweide drew nothing: ${JSON.stringify(curved)}`);
  tests.push(`Comercio: month ${routes.month} has ${routes.count} shipments; the bridge gives each its way (${routes.bent} bend round the coast; ${routes.sample.from} → ${routes.sample.to}, ${routes.sample.lengthKm} km); the lens draws them (trade-ways.png, ${flat.land + flat.sea} px) and also on Mollweide (${curved.land + curved.sea} px, trade-mollweide.png)`);
  await js(`(()=>{const s=document.querySelector('[data-testid="worldgen-projection"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'equirect');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const failed = await js('window.__lookError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
