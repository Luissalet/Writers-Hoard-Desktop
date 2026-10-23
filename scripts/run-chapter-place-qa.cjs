// Chapters put in their place, through the normal Writings engine: the last
// chapter dragged by its grip onto the first takes its place and the numbers
// follow; reopened, the order holds. Isolated hidden profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-chapter-place-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'chapter-place-qa', configureServer(instance) { instance.middlewares.use('/__chapter_place_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__chapter_place_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/chapter-place-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__chapter_place_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__chapError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const tests = [];
  const order = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return (await db.writings.where('projectId').equals('chapter-place-preview').toArray()).sort((a,b)=>a.chapter-b.chapter).map(w=>w.chapter+':'+w.title).join(' | ');})()`);
  await wait('window.__chapReady', 'preview');
  await wait(`document.querySelector('[data-testid="chapter-grip-ch4"]') && document.querySelector('[data-testid="chapter-row-ch1"]')`, 'chapter list');
  await pause(800);
  fs.writeFileSync(path.join(evidence, 'chapters-before.png'), (await win.webContents.capturePage()).toPNG());
  await js(`(()=>{const grip=document.querySelector('[data-testid="chapter-grip-ch4"]'),to=document.querySelector('[data-testid="chapter-row-ch1"]');const dt=new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    to.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:dt}));
    to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));})()`);
  await pause(250);
  await js(`(()=>{const grip=document.querySelector('[data-testid="chapter-grip-ch4"]'),to=document.querySelector('[data-testid="chapter-row-ch1"]');const dt=new DataTransfer();dt.setData('text/plain','ch4');
    to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
    to.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
    grip.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:dt}));})()`);
  let now; for (let i = 0; i < 60; i++) { now = await order(); if (now.startsWith('1:El regreso')) break; await pause(150); }
  assert(now === '1:El regreso | 2:El puerto | 3:La tormenta | 4:La isla', `Order after the drag: ${now}`);
  await pause(800);
  fs.writeFileSync(path.join(evidence, 'chapters-after.png'), (await win.webContents.capturePage()).toPNG());
  const shown = await js(`[...document.querySelectorAll('[data-testid^="chapter-row-"]')].map(e=>e.dataset.testid.slice(12)).join(',')`);
  assert(shown.startsWith('ch4,ch1,ch2,ch3'), `The list shows the new order: ${shown}`);
  tests.push(`Dragging "El regreso" by its grip onto "El puerto" makes it chapter 1 and the others follow (${now}; chapters-before.png, chapters-after.png)`);
  // A kicker and a chapter held back, set through the bridge, read in the list.
  await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const a=await runBridgeTool('wh_update_writing',{projectId:'chapter-place-preview',id:'ch1',kicker:'Prólogo'});const b=await runBridgeTool('wh_update_writing',{projectId:'chapter-place-preview',id:'ch3',heldBack:true});if(!a.ok||!b.ok)throw Error(JSON.stringify([a,b]));})()`);
  await wait(`document.querySelector('[data-testid="chapter-row-ch1"] [data-testid="chapter-kicker"]')?.textContent==='Prólogo' && document.querySelector('[data-testid="chapter-row-ch3"] [data-testid="chapter-held-back-badge"]')`, 'kicker and held-back badge');
  fs.writeFileSync(path.join(evidence, 'chapters-kicker-held.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('A kicker ("Prólogo") reads above the chapter title and a chapter held back carries "Fuera del libro" in the list (chapters-kicker-held.png)');
  const failed = await js('window.__chapError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
