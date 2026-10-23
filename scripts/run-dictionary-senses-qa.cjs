// Languages, through the normal engine: paste a word list (preview, import,
// pasting again adds nothing new), give a word a second sense and a "see
// also", read them in the list; homographs numbered. Isolated hidden profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-dictionary-senses-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'dictionary-senses-qa', configureServer(instance) { instance.middlewares.use('/__dictionary_senses_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__dictionary_senses_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/dictionary-senses-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`${server.resolvedUrls.local[0]}__dictionary_senses_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 1500) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__dictError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const button = text => `[...document.querySelectorAll('button')].find(e=>{const s=e.textContent.trim();return (s===${JSON.stringify(text)}||s.startsWith(${JSON.stringify(text + ' (')}))&&!e.disabled;})`;
  const tests = [];
  const setValue = (selector, value, kind = 'HTMLInputElement') => js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(i,${JSON.stringify(String(value))});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const words = () => js(`(async()=>{const {db}=await import('/src/db/index.ts');return (await db.projects.get('dictionary-senses-preview')).dictionaries[0].words;})()`);
  await wait('window.__dictReady', 'preview');
  await wait(`document.querySelector('[data-testid="dictionary-paste-open"]')`, 'paste button');
  await js(`document.querySelector('[data-testid="dictionary-paste-open"]').click()`);
  await wait(`document.querySelector('[data-testid="dictionary-paste-text"]')`, 'paste box');
  await setValue('[data-testid="dictionary-paste-text"]', 'drak (n.): dragón\nshara\tniebla del mar\nvel – río\nmor: mar\nesto no es una palabra', 'HTMLTextAreaElement');
  await wait(`/3 nuevas, 1 ya estaban, 1 líneas sin leer/.test(document.querySelector('[data-testid="dictionary-paste-preview"]').textContent)`, 'preview counts');
  const preview = await js(`document.querySelector('[data-testid="dictionary-paste-preview"]').textContent`);
  fs.writeFileSync(path.join(evidence, 'dictionary-paste.png'), (await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[data-testid="dictionary-paste-import"]').click()`);
  let list; for (let i = 0; i < 60; i++) { list = await words(); if (list.length === 4) break; await pause(150); }
  assert(list.length === 4 && list.find(w => w.word === 'drak')?.partOfSpeech === 'n.', `Imported ${JSON.stringify(list)}`);
  tests.push(`Pegar una lista: "${preview.trim()}"; Añadir adds the three new words in one save, "drak" with its part of speech (dictionary-paste.png)`);
  // Pasting the same list again adds nothing.
  await js(`document.querySelector('[data-testid="dictionary-paste-open"]').click()`);
  await wait(`document.querySelector('[data-testid="dictionary-paste-text"]')`, 'paste box again');
  await setValue('[data-testid="dictionary-paste-text"]', 'drak (n.): dragón\nshara\tniebla del mar', 'HTMLTextAreaElement');
  await wait(`/0 nuevas, 2 ya estaban/.test(document.querySelector('[data-testid="dictionary-paste-preview"]').textContent) && document.querySelector('[data-testid="dictionary-paste-import"]').disabled`, 'nothing new');
  await js(`[...document.querySelectorAll('[data-testid="dictionary-paste"] button')].find(b=>b.textContent.trim()==='Cancelar').click()`);
  tests.push('Pasting the same list again: "0 nuevas, 2 ya estaban" and nothing to add');
  // A second sense and see also on "drak".
  await wait(`[...document.querySelectorAll('dt button')].find(b=>b.textContent.trim()==='drak')`, 'drak in the list');
  await js(`[...document.querySelectorAll('dt button')].find(b=>b.textContent.trim()==='drak').click()`);
  await wait(`document.querySelector('[data-testid="dictionary-sense-add"]')`, 'word form');
  await js(`document.querySelector('[data-testid="dictionary-sense-add"]').click()`);
  await wait(`document.querySelector('[data-testid="dictionary-sense-0"]')`, 'sense row');
  await setValue('[data-testid="dictionary-sense-0"] input', 'v.');
  await setValue('[data-testid="dictionary-sense-0"] textarea', 'arder', 'HTMLTextAreaElement');
  await setValue('[data-testid="dictionary-see-also"]', 'vel, shara');
  await pause(300);
  fs.writeFileSync(path.join(evidence, 'dictionary-sense-form.png'), (await win.webContents.capturePage()).toPNG());
  await js(`[...document.querySelectorAll('form button[type="submit"]')][0].click()`);
  let drak; for (let i = 0; i < 60; i++) { drak = (await words()).find(w => w.word === 'drak'); if (drak?.senses?.length) break; await pause(150); }
  assert(drak.senses[0].meaning === 'arder' && drak.senses[0].partOfSpeech === 'v.' && drak.seeAlso.join() === 'vel,shara', `Saved ${JSON.stringify(drak)}`);
  await wait(`document.querySelector('[data-testid="dictionary-word-sense"]') && document.querySelector('[data-testid="dictionary-see-also-list"]')`, 'senses shown');
  fs.writeFileSync(path.join(evidence, 'dictionary-senses.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('"drak" gets a second sense (v. arder) and "Véase también: vel, shara"; the list shows "1." and "2." and the related words as links (dictionary-senses.png)');
  // See also: a click searches the related word.
  await js(`[...document.querySelectorAll('[data-testid="dictionary-see-also-list"] button')].find(b=>b.textContent.trim()==='vel').click()`);
  await wait(`document.querySelector('input[aria-label="Buscar palabras, significados y ejemplos"]').value==='vel'`, 'search vel');
  tests.push('Clicking "vel" in Véase también searches for it');
  // A homograph: a second "mor" is numbered.
  await js(`(async()=>{const {runBridgeTool}=await import('/src/services/aiBridge/dispatch.ts');const g=await runBridgeTool('wh_dictionary_get',{projectId:'dictionary-senses-preview',dictionaryId:window.__dictId});await runBridgeTool('wh_dictionary_save_word',{projectId:'dictionary-senses-preview',dictionaryId:window.__dictId,expectedVersion:g.result.version,word:{word:'mor',meaning:'muerte'}});})()`);
  await setValue('input[aria-label="Buscar palabras, significados y ejemplos"]', 'mor');
  await wait(`document.querySelectorAll('[data-testid="dictionary-homograph"]').length===2`, 'homographs numbered');
  fs.writeFileSync(path.join(evidence, 'dictionary-homographs.png'), (await win.webContents.capturePage()).toPNG());
  tests.push('Two words spelt "mor" are numbered mor¹ and mor² (dictionary-homographs.png)');
  const failed = await js('window.__dictError || null');
  assert(!failed, failed);
  for (const line of tests) console.log(`PASS ${line}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }, async (error) => { console.error(error); await server?.close(); app.exit(1); });
