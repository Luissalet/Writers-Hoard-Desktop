// The archive, several at once: two deleted chapters chosen and restored, the
// last chosen and deleted forever after its confirmation. Isolated hidden profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-archive-bulk-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'archive-bulk-qa', configureServer(instance) { instance.middlewares.use('/__archive_bulk_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__archive_bulk_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/archive-bulk-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__archive_bulk_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__arcError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const tests = [];
  const state = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return {writings:(await db.writings.where('projectId').equals('archive-bulk-preview').toArray()).map(w=>w.title).sort(),archived:(await db.documentArchives.where('projectId').equals('archive-bulk-preview').toArray()).map(a=>a.title).sort()};})()`);
  await wait('window.__arcReady', 'preview');
  await wait(`document.querySelector('[data-testid="archive-bulk"]') && document.querySelectorAll('[data-testid^="archive-pick-arc"], [data-testid^="archive-pick-"]').length>=3`, 'archive with choices');
  const ids = await js(`[...document.querySelectorAll('[data-testid^="archive-row-"]')].map(r=>({id:r.dataset.testid.slice(12),title:r.querySelector('h3').textContent}))`);
  const pick = title => js(`document.querySelector('[data-testid="archive-pick-${ids.find(r => r.title === title).id}"]').click()`);
  await pick('Prólogo'); await pick('Epílogo');
  await wait(`/\\(2\\)/.test(document.querySelector('[data-testid="archive-bulk-restore"]').textContent)`, 'two chosen');
  fs.writeFileSync(path.join(evidence, 'archive-two-chosen.png'), (await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[data-testid="archive-bulk-restore"]').click()`);
  let s; for (let i = 0; i < 60; i++) { s = await state(); if (s.writings.length === 2) break; await pause(150); }
  assert(s.writings.join() === 'Epílogo,Prólogo' && s.archived.join() === 'La tormenta', `After restoring two: ${JSON.stringify(s)}`);
  await wait(`/Restaurados: 2/.test(document.body.textContent)`, 'message');
  tests.push('Archivo: two archived chapters chosen and "Restaurar (2)" brings both back; "Restaurados: 2" (archive-two-chosen.png)');
  await wait(`document.querySelector('[data-testid^="archive-pick-"]:not([data-testid="archive-pick-all"])')`, 'last row');
  await js(`document.querySelector('[data-testid="archive-pick-all"]').click()`);
  await js(`document.querySelector('[data-testid="archive-bulk-forget"]').click()`);
  await wait(`[...document.querySelectorAll('[role="dialog"] button')].some(b=>b.textContent.trim()==='Eliminar para siempre')`, 'confirmation');
  fs.writeFileSync(path.join(evidence, 'archive-forget-confirm.png'), (await win.webContents.capturePage()).toPNG());
  await js(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Eliminar para siempre').click()`);
  for (let i = 0; i < 60; i++) { s = await state(); if (!s.archived.length) break; await pause(150); }
  assert(!s.archived.length && s.writings.length === 2, `After deleting forever: ${JSON.stringify(s)}`);
  tests.push('"Elegir todos" and "Eliminar para siempre (1)" ask first, then remove the last archived copy for good (archive-forget-confirm.png)');
  const failed = await js('window.__arcError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
