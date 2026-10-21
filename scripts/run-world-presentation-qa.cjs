// Saved world look: real WorldgenEngine through Vite (real workers) in a hidden,
// isolated Electron profile. Chooses a style and layers through the normal
// toolbar, reopens the engine, adopts an external change, and captures 1440/640.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-world-look-qa-'));
const evidence = process.env.WH_QA_EVIDENCE || path.join(temp, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); let server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root, cacheDir: path.join(temp, 'vite-cache'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, plugins: [{ name: 'world-look-qa', configureServer(instance) { instance.middlewares.use('/__world_look_qa', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__world_look_qa', '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/tests/world-presentation-preview.tsx"></script></body></html>')); }); } }] });
  await server.listen(); await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = []; win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  await win.loadURL(`${server.resolvedUrls.local[0]}__world_look_qa`);
  const js = expression => win.webContents.executeJavaScript(expression);
  const wait = async (expression, what, tries = 900) => { for (let i = 0; i < tries; i++) { const state = await js(`({ok:!!(${expression}),error:window.__lookError})`); if (state.error) throw Error(state.error); if (state.ok) return; await pause(100); } throw Error(`Timed out: ${what}`); };
  const clickText = text => js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!b)return false;b.click();return true;})()`);
  const styleSelect = `document.querySelector('select[title="Estilo cartográfico"]')`;
  const toggle = title => `document.querySelector('button[title=${JSON.stringify(title)}]')`;
  const tests = [];
  await wait('window.__lookReady', 'preview');
  await wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Carta'&&!e.disabled)`, 'world forged, Carta enabled');
  assert(await clickText('Carta'));
  await wait(styleSelect, 'style select');
  const before = await js('window.__lookRow()');
  assert.equal(before.presentation, null, 'Opening must not write a look to a legacy world');
  assert.equal(await js(`${styleSelect}.value`), 'wonder');
  // Normal UI: pick a style and hide roads.
  await js(`(()=>{const s=${styleSelect};const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'antique');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(toggle('Caminos'), 'roads toggle');
  await js(`${toggle('Caminos')}.click()`);
  await wait(`window.__lookRow().then(r=>window.__lookSaved=r)&&window.__lookSaved&&window.__lookSaved.presentation&&window.__lookSaved.presentation.theme==='antique'&&window.__lookSaved.presentation.layers.roads===false`, 'look saved');
  const saved = await js('window.__lookRow()');
  assert.equal(saved.seed, before.seed); assert.equal(saved.edits, before.edits);
  tests.push('Normal toolbar: choosing Antique and hiding roads saves the look with the world; recipe and edits unchanged');
  await pause(1500);
  fs.writeFileSync(path.join(evidence, 'look-chosen-1440.png'), (await win.webContents.capturePage()).toPNG());
  // Reopen: unmount the engine and mount it again from the stored row.
  await js('window.__lookUnmount()'); await pause(200); await js('window.__lookMount()');
  await wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Carta'&&!e.disabled)`, 'reopened');
  assert(await clickText('Carta'));
  await wait(`${styleSelect}&&${styleSelect}.value==='antique'`, 'reopened with saved style');
  const roadsActive = await js(`${toggle('Caminos')}.className`);
  const forestsActive = await js(`${toggle('Bosques')}.className`);
  assert.notEqual(roadsActive, forestsActive, 'Roads toggle should read hidden while forests stay shown');
  tests.push('Reopening the engine restores the saved style and hidden layer through the same toolbar');
  // External change (agent or another pane) is adopted by the open view.
  await js(`window.__lookExternal({theme:'relief'})`);
  await wait(`${styleSelect}.value==='relief'`, 'external change adopted');
  tests.push('An external saved change (another pane or MCP) is adopted by the open view');
  await pause(1500);
  fs.writeFileSync(path.join(evidence, 'look-external-1440.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(640, 900); await pause(1200);
  fs.writeFileSync(path.join(evidence, 'look-external-640.png'), (await win.webContents.capturePage()).toPNG());
  const final = await js('window.__lookRow()');
  assert.equal(final.presentation.theme, 'relief'); assert.equal(final.presentation.layers.roads, false);
  tests.push('Narrow 640 layout keeps the saved look; captures written');
  const relevant = errors.filter(message => !/Download the React DevTools|favicon/.test(message));
  if (relevant.length) console.log('console errors:\n' + relevant.slice(0, 10).join('\n'));
  for (const test of tests) console.log(`PASS ${test}`);
  console.log(`EVIDENCE ${evidence}`);
}
main().then(async () => { await server?.close(); app.exit(0); }).catch(async error => { console.error(error.stack || error); await server?.close(); app.exit(1); });
