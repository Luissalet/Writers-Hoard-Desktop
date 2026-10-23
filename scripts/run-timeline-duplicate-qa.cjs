// A timeline event duplicated from the swim lanes' right-click menu: the copy
// sits right after its original with the same date. Isolated hidden profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-timeline-duplicate-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'timeline-duplicate-qa', configureServer(instance) { instance.middlewares.use('/__timeline_duplicate_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__timeline_duplicate_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/timeline-duplicate-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__timeline_duplicate_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__tlError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const tests = [];
  const rows = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return (await db.timelineEvents.where('timelineId').equals('timeline-duplicate-preview-t').toArray()).sort((a,b)=>a.order-b.order).map(e=>e.title+'@'+e.date);})()`);
  await wait('window.__tlReady', 'preview');
  await wait(`document.querySelector('g[aria-label^="La batalla"]')`, 'swim lane event');
  await pause(600);
  await js(`(()=>{const g=document.querySelector('g[aria-label^="La batalla"]');const r=g.getBoundingClientRect();g.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:2}));})()`);
  await wait(`document.querySelector('[data-testid="timeline-event-duplicate"]')`, 'context menu');
  fs.writeFileSync(path.join(evidence, 'timeline-menu.png'), (await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[data-testid="timeline-event-duplicate"]').click()`);
  let now; for (let i = 0; i < 60; i++) { now = await rows(); if (now.length === 4) break; await pause(150); }
  assert(now.join(' | ') === 'La partida@Año 1 | La batalla@Año 2 | La batalla (copia)@Año 2 | El regreso@Año 3', `After duplicating: ${now.join(' | ')}`);
  await wait(`document.querySelector('g[aria-label^="La batalla (copia)"]')`, 'copy drawn');
  fs.writeFileSync(path.join(evidence, 'timeline-duplicated.png'), (await win.webContents.capturePage()).toPNG());
  tests.push(`Right-click on "La batalla" → "Duplicar evento": the copy sits right after it with the same date (${now.join(' | ')}; timeline-menu.png, timeline-duplicated.png)`);
  const failed = await js('window.__tlError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
