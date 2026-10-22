// Story events through the normal tools: write one, click it onto the map, place
// a planned one, change it in the inspector, drag the first, read them back in
// the Reader's view by chapter, remove one, and reopen.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-story-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-story-qa', configureServer(instance) { instance.middlewares.use('/__world_story_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_story_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_story_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const click = async text => { await wait(button(text), `button ${text}`); await js(`${button(text)}.click()`); };
  const byId = id => js(`document.querySelector('[data-testid="${id}"]').click()`);
  const setValue = (selector, value, kind = 'HTMLInputElement', event = 'input') => js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(i,${JSON.stringify(String(value))});i.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const W = 'world-presentation-preview-world';
  const forged = button('Carta');
  const tests = [];
  const storyEdits = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');const {deserializeEdits}=await import('/src/engines/worldgen/core/edits.ts');const {storyEventsFrom}=await import('/src/engines/worldgen/core/storyEvents.ts');const r=await db.generatedWorlds.get('${W}');const e=deserializeEdits(r.edits||'[]');return {raw:e.filter(x=>x.kind==='story'||x.kind==='storyRemove').length,events:storyEventsFrom(e)};})()`);
  const send = event => win.webContents.sendInputEvent(event);
  const canvasRect = () => js(`(()=>{const c=[...document.querySelectorAll('canvas')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const tap = async (x, y) => { send({ type: 'mouseMove', x, y }); await pause(60); send({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(60); send({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(500); };
  const drag = async (from, to) => {
    send({ type: 'mouseMove', x: from.x, y: from.y }); await pause(60);
    send({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 }); await pause(40);
    for (let s = 1; s <= 10; s++) { send({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * s / 10), y: Math.round(from.y + (to.y - from.y) * s / 10), button: 'left', modifiers: ['leftButtonDown'] }); await pause(25); }
    send({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 }); await pause(500);
  };
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(400); };
  // How many pixels of an event colour sit around a screen point on the map canvas.
  const colourNear = (p, rgb) => js(`(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const r=c.getBoundingClientRect(),k=c.width/r.width;const d=c.getContext('2d').getImageData(Math.round((${p.x}-r.x-10)*k),Math.round((${p.y}-r.y-10)*k),Math.round(20*k),Math.round(20*k)).data;let n=0;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-${rgb[0]})<10&&Math.abs(d[i+1]-${rgb[1]})<10&&Math.abs(d[i+2]-${rgb[2]})<10)n++;return n;})()`);
  const FIGHT = [179, 38, 30], CHANGE = [123, 63, 160];
  await wait('window.__lookReady', 'preview'); await wait(forged, 'first forge');
  await click('Pincel'); await click('Sucesos');
  await wait(`document.querySelector('[data-testid="story-draft"]')`, 'story draft');
  const rect = await canvasRect();
  const A = { x: Math.round(rect.x + rect.w * 0.4), y: Math.round(rect.y + rect.h * 0.45) };
  const B = { x: Math.round(rect.x + rect.w * 0.62), y: Math.round(rect.y + rect.h * 0.6) };
  // Without words nothing is placed.
  await tap(A.x, A.y);
  let state = await storyEdits();
  assert.equal(state.raw, 0, 'An event without a title was placed');
  tests.push('A click with no title places nothing (the toast asks for one)');
  await byId('story-type-fight');
  await setValue('[data-testid="story-title"]', 'Emboscada en el vado');
  await setValue('[data-testid="story-chapter"]', 2);
  await byId('story-status-happened');
  await pause(200);
  await tap(A.x, A.y);
  for (let i = 0; i < 60; i++) { state = await storyEdits(); if (state.events.length) break; await pause(150); }
  const ambush = state.events[0];
  assert(ambush && ambush.type === 'fight' && ambush.title === 'Emboscada en el vado' && ambush.chapter === 2 && ambush.status === 'happened', `Ambush: ${JSON.stringify(state)}`);
  await wait(`document.querySelector('[data-testid="story-selected"]') && document.querySelector('[data-testid="story-edit-title"]').value==='Emboscada en el vado'`, 'new event selected');
  await settle();
  const fightInk = await colourNear(A, FIGHT);
  assert(fightInk > 20, `No fight mark at the click (${fightInk})`);
  tests.push(`Fight, "Emboscada en el vado", chapter 2, happened, placed with a trusted click at ${ambush.x.toFixed(1)},${ambush.y.toFixed(1)}; drawn there (${fightInk} red pixels) and selected for editing`);
  // A planned council, later.
  await click('Poner otro');
  await wait(`document.querySelector('[data-testid="story-draft"]')`, 'draft again');
  await byId('story-type-meeting');
  await setValue('[data-testid="story-title"]', 'El consejo');
  await setValue('[data-testid="story-chapter"]', 5);
  await byId('story-status-planned');
  await pause(200);
  await tap(B.x, B.y);
  for (let i = 0; i < 60; i++) { state = await storyEdits(); if (state.events.length >= 2) break; await pause(150); }
  const council = state.events.find(e => e.title === 'El consejo');
  assert(council && council.status === 'planned' && council.chapter === 5 && council.type === 'meeting', `Council: ${JSON.stringify(state.events)}`);
  const listOrder = await js(`[...document.querySelectorAll('[data-testid="story-list"] [data-testid^="story-item-"]')].map(b=>b.textContent)`);
  assert(listOrder.length === 2 && /Emboscada/.test(listOrder[0]) && /consejo/.test(listOrder[1]), `List ${JSON.stringify(listOrder)}`);
  tests.push('A planned meeting "El consejo" in chapter 5 is placed; the story list shows both in chapter order');
  fs.writeFileSync(path.join(evidence, 'story-author-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Change it in the inspector: it happened, and a new title typed and committed on leaving the field.
  await byId('story-edit-status-happened');
  // A hidden test window never holds focus, so leaving the field is sent as the
  // events React listens to: Enter here, focusout below.
  await setValue('[data-testid="story-edit-title"]', 'El consejo de Huuth');
  await pause(150);
  await js(`document.querySelector('[data-testid="story-edit-title"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  for (let i = 0; i < 60; i++) { state = await storyEdits(); const c = state.events.find(e => e.id === council.id); if (c?.status === 'happened' && c.title === 'El consejo de Huuth') break; await pause(150); }
  const changed = state.events.find(e => e.id === council.id);
  assert(changed.status === 'happened' && changed.title === 'El consejo de Huuth', `Inspector: ${JSON.stringify(changed)}`);
  tests.push('The inspector marks the council as happened and renames it to "El consejo de Huuth" (committed with Enter)');
  // A rename committed on leaving the field and a chip clicked straight after: both stick.
  await js(`(()=>{const i=document.querySelector('[data-testid="story-edit-title"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'El gran consejo');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(100);
  await js(`(()=>{document.querySelector('[data-testid="story-edit-title"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}));document.querySelector('[data-testid="story-edit-type-change"]').click();})()`);
  for (let i = 0; i < 60; i++) { state = await storyEdits(); const c = state.events.find(e => e.id === council.id); if (c?.type === 'change' && c.title === 'El gran consejo') break; await pause(150); }
  const both = state.events.find(e => e.id === council.id);
  assert(both.type === 'change' && both.title === 'El gran consejo', `Back-to-back edits: ${JSON.stringify(both)}`);
  tests.push('A rename committed on leaving the field and a kind change clicked straight after both stick');
  // Words typed and not yet committed go to the event they were typed for when another is picked on the map.
  await js(`(()=>{const i=document.querySelector('[data-testid="story-edit-title"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'El consejo final');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(150);
  await tap(A.x, A.y);
  await wait(`document.querySelector('[data-testid="story-edit-title"]')?.value==='Emboscada en el vado'`, 'ambush picked on the map');
  for (let i = 0; i < 60; i++) { state = await storyEdits(); if (state.events.find(e => e.id === council.id)?.title === 'El consejo final') break; await pause(150); }
  assert.equal(state.events.find(e => e.id === council.id).title, 'El consejo final', 'Typed title lost when picking another event');
  tests.push('A title typed without Enter is saved to its own event when another event is picked on the map');
  // Drag the ambush.
  const A2 = { x: A.x + 70, y: A.y - 40 };
  await drag(A, A2);
  for (let i = 0; i < 60; i++) { state = await storyEdits(); const a = state.events.find(e => e.id === ambush.id); if (a && Math.abs(a.x - ambush.x) > 1) break; await pause(150); }
  const movedAmbush = state.events.find(e => e.id === ambush.id);
  assert(Math.abs(movedAmbush.x - ambush.x) > 1 && movedAmbush.title === ambush.title, `Drag: ${JSON.stringify(movedAmbush)}`);
  await settle();
  assert((await colourNear(A2, FIGHT)) > 20, 'The ambush is not drawn where it was dropped');
  tests.push(`Dragging the ambush with the Story tool moves it (${ambush.x.toFixed(1)} → ${movedAmbush.x.toFixed(1)}) and keeps its id and fields`);
  // The reader's view, chapter by chapter.
  await js(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Mano'))?.click()`); await pause(300);
  await js(`document.querySelector('[data-testid="worldgen-reader-toggle"]').click()`);
  await wait(`document.querySelector('[data-testid="worldgen-reader-chapter"]:not([disabled])')`, 'reader chapter');
  const options = await js(`[...document.querySelectorAll('[data-testid="worldgen-reader-chapter"] option')].map(o=>o.value)`);
  assert(options.includes('2') && options.includes('5'), `Story chapters in the picker: ${JSON.stringify(options)}`);
  await setValue('[data-testid="worldgen-reader-chapter"]', '2', 'HTMLSelectElement', 'change'); await settle();
  const ambushCh2 = await colourNear(A2, FIGHT), councilCh2 = await colourNear(B, CHANGE);
  assert(ambushCh2 > 20 && councilCh2 === 0, `Up to chapter 2: ambush ${ambushCh2}, council ${councilCh2}`);
  fs.writeFileSync(path.join(evidence, 'story-reader-ch2-1440.png'), (await win.webContents.capturePage()).toPNG());
  await setValue('[data-testid="worldgen-reader-chapter"]', '5', 'HTMLSelectElement', 'change'); await settle();
  const councilCh5 = await colourNear(B, CHANGE);
  assert(councilCh5 > 20, `Up to chapter 5 the council should show (${councilCh5})`);
  tests.push(`Reader's view: chapters 2 and 5 are offered; up to chapter 2 the reader sees the ambush and not the council, up to 5 both (over the blank paper)`);
  fs.writeFileSync(path.join(evidence, 'story-reader-ch5-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Playing the story: the caption names what happens in each chapter; previous/next step, play advances and stops at the end.
  const caption = () => js(`(()=>{const c=document.querySelector('[data-testid="worldgen-reader-caption"]');return c?{chapter:+c.dataset.chapter,text:c.textContent}:null;})()`);
  const at5 = await caption();
  assert(at5 && at5.chapter === 5 && /Cap[ií]tulo 5/.test(at5.text) && /consejo/i.test(at5.text), `Caption at 5 ${JSON.stringify(at5)}`);
  assert(await js(`document.querySelector('[data-testid="worldgen-reader-next"]').disabled`), 'Next should be off at the last chapter');
  await byId('worldgen-reader-prev'); await settle();
  const at2 = await caption();
  // Stepping follows the story, so the map moves: check the chapter through the caption.
  assert(at2 && at2.chapter === 2 && /Emboscada/.test(at2.text) && !/consejo/i.test(at2.text), `Previous to 2 ${JSON.stringify(at2)}`);
  await byId('worldgen-reader-play');
  assert(await js(`document.querySelector('[data-testid="worldgen-reader-play"]').getAttribute('aria-pressed')==='true'`), 'Play pressed');
  await wait(`document.querySelector('[data-testid="worldgen-reader-caption"]')?.dataset.chapter==='5'`, 'playback reaches chapter 5', 120);
  await wait(`document.querySelector('[data-testid="worldgen-reader-play"]').getAttribute('aria-pressed')==='false'`, 'playback stops at the end', 120);
  await settle();
  tests.push(`Playing the story: the caption reads "${at5.text.trim()}" at chapter 5; Previous goes to chapter 2 (ambush only); Play advances to 5 on its own and stops at the end`);
  fs.writeFileSync(path.join(evidence, 'story-reader-play-1440.png'), (await win.webContents.capturePage()).toPNG());
  await click('Carta'); await pause(3500);
  fs.writeFileSync(path.join(evidence, 'story-reader-carta-1440.png'), (await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[data-testid="worldgen-reader-toggle"]').click()`); await pause(300);
  await click('Mapa'); await pause(800);
  // Remove the council from the list.
  await click('Pincel'); await click('Sucesos');
  await wait(`document.querySelector('[data-testid="story-item-${council.id}"]')`, 'council in list');
  await byId(`story-item-${council.id}`);
  await wait(`document.querySelector('[data-testid="story-remove"]')`, 'remove button');
  await byId('story-remove');
  for (let i = 0; i < 60; i++) { state = await storyEdits(); if (state.events.length === 1) break; await pause(150); }
  assert(state.events.length === 1 && state.events[0].id === ambush.id, `Remove: ${JSON.stringify(state.events)}`);
  tests.push('Picking the council in the story list and removing it leaves only the ambush');
  await pause(1500);
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()'); await wait(forged, 'reopened');
  state = await storyEdits();
  assert(state.events.length === 1 && state.events[0].x === movedAmbush.x, 'Reopen lost the story');
  await click('Pincel'); await click('Sucesos');
  await wait(`document.querySelector('[data-testid="story-item-${ambush.id}"]')`, 'ambush after reopen');
  tests.push('Reopening keeps the moved ambush and the removal; the story list shows it again');
  win.setContentSize(640, 900); await pause(1200);
  fs.writeFileSync(path.join(evidence, 'story-panel-640.png'), (await win.webContents.capturePage()).toPNG());
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
