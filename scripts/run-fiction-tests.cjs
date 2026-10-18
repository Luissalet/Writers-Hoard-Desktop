// Actual Electron bridge/MCP and complete renderer, with an isolated profile,
// synthetic worlds and a synthetic family model/voice endpoint only.
const { app, BrowserWindow, ipcMain } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-fiction907-'));
const reports = process.env.WRITER_FICTION_REPORT || directory;
fs.mkdirSync(reports, { recursive: true });
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('use-angle', 'swiftshader');
const packaged = process.argv.includes('--packaged');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
let cleanup = async () => {};

async function main() {
  const voicePath = path.join(directory, 'synthetic.wav');
  fs.writeFileSync(voicePath, Buffer.from('RIFF0000WAVEfmt synthetic audio'));
  const fakeHub = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let result = { ok: true };
      if (req.url === '/api/apps/prospero/call') result = { ok: true, result: { ok: true, path: voicePath } };
      if (req.url === '/api/link/chat') result = { ok: true, text: 'La noche sintética llega al faro.\n```json\n{"scene":{"mood":"tranquila"}}\n```', provider: 'synthetic', model: 'cpu-fixture', ms: 1 };
      if (req.url?.startsWith('/api/link/status')) result = { ok: true, llm: { available: true, provider: 'synthetic', model: 'cpu-fixture', reason: 'Synthetic test endpoint' } };
      if (req.url === '/api/apps/prospero') result = { state: 'running' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  });
  const hubPort = await listen(fakeHub);
  process.env.HOARD_HUB_URL = `http://127.0.0.1:${hubPort}`;
  process.env.HOARD_EVENTS = '0';
  const probe = http.createServer();
  const bridgePort = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  process.env.WH_AIBRIDGE_PORT = String(bridgePort);
  const modulePath = path.join(directory, 'integration.cjs');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fiction-integration.ts')], outfile: modulePath,
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'], alias: { '@': path.join(root, 'src') }, logLevel: 'warning' });
  const { runFictionIntegration } = require(modulePath);
  const result = await runFictionIntegration(root, directory, bridgePort, packaged);
  fs.writeFileSync(path.join(reports, packaged ? 'packaged-api-mcp.json' : 'api-mcp.json'), JSON.stringify(result, null, 2));
  console.log('PASS actual bridge API / MCP / native fiction / shutdown', result);

  // The UI uses the same compiled singleton as the actual tool executor.
  // Build a tiny accessor into that same module export to avoid a second owner.
  const accessor = path.join(directory, 'ui-service.cjs');
  await esbuild.build({ stdin: { contents: `export { fictionService } from './electron/fiction/service'; export { createRendererRequestHandler } from './electron/rendererServer';`, resolveDir: root },
    outfile: accessor, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning' });
  // A separate bundled module has separate state: use a fresh isolated service
  // configured to the same synthetic data after the first owner is closed.
  const uiModule = path.join(directory, 'ui-owner.cjs');
  await esbuild.build({ entryPoints: [path.join(root, 'electron/fiction/service.ts')], outfile: uiModule, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning' });
  const uiOwner = require(uiModule);
  const storyRoot = path.join(root, 'story');
  uiOwner.configureFiction({ configFile: path.join(directory, 'fiction/modules.json'), dataDir: path.join(directory, 'worlds'), cwd: storyRoot,
    command: packaged ? path.join(storyRoot, 'runtime/writer-fiction-worker/writer-fiction-worker.exe') : path.join(storyRoot, '.venv/Scripts/python.exe'),
    args: packaged ? [] : [path.join(storyRoot, 'worker.py')] });
  const service = uiOwner.fictionService();
  ipcMain.handle('fixture:fiction:status', () => service.status());
  ipcMain.handle('fixture:fiction:set', (_event, module, enabled, dataDir) => service.setModule(module, enabled, dataDir));
  ipcMain.handle('fixture:fiction:request', (_event, method, apiPath, body) => service.request(method, apiPath, body));
  const preload = path.join(directory, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{isDesktop:true,platform:process.platform,quickNote:{setContext:async()=>{},onCapture:()=>()=>{},onOpenInline:()=>()=>{},ack:()=>{}},faustus:{getInfo:()=>ipcRenderer.invoke('fixture:faustus:info'),request:request=>ipcRenderer.invoke('fixture:faustus:request',request),cancel:async()=>{},onEvent:listener=>{const fn=(_event,value)=>listener(value);ipcRenderer.on('fixture:faustus:event',fn);return()=>ipcRenderer.removeListener('fixture:faustus:event',fn)}},fiction:{status:()=>ipcRenderer.invoke('fixture:fiction:status'),setModule:(...args)=>ipcRenderer.invoke('fixture:fiction:set',...args),request:(...args)=>ipcRenderer.invoke('fixture:fiction:request',...args)}});`);
  const { createRendererRequestHandler } = require(accessor);
  const staticServer = http.createServer((req, res) => {
    if (req.url === '/__qa-faustus-panel.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(`if(!customElements.get('faustus-chat'))customElements.define('faustus-chat',class extends HTMLElement{connectedCallback(){this.textContent='Synthetic Faustus panel';}loadHistory(){return Promise.resolve();}appendDraft(){}});`);
      return;
    }
    if (req.url?.startsWith('/__qa/')) {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const args = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : [];
          const result = req.url === '/__qa/faustus-info' ? { server: `http://127.0.0.1:${rendererPort}`, embed_url: `http://127.0.0.1:${rendererPort}/__qa-faustus-panel.js`, data_space_id: 'writer-synthetic-space', tool_server_id: 'writer-synthetic-tools' }
            : req.url === '/__qa/status' ? await service.status()
            : req.url === '/__qa/set' ? await service.setModule(...args)
              : req.url === '/__qa/request' ? await service.request(...args) : null;
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
        } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(error) })); }
      });
      return;
    }
    if (req.url === '/__qa-bridge.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(`if(!window.electronAPI){const call=async(path,args=[])=>{const r=await fetch('/__qa/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const result=await r.json();if(!r.ok)throw new Error(result.error);return result;};const listeners=new Set();window.electronAPI={isDesktop:true,platform:'win32',quickNote:{setContext:()=>{},onCapture:()=>()=>{},onOpenInline:()=>()=>{},ack:()=>{}},faustus:{getInfo:()=>call('faustus-info'),onEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},cancel:async()=>{},request:async request=>{queueMicrotask(()=>{for(const listener of listeners){listener({id:request.id,type:'chunk',chunk:new TextEncoder().encode('{"conversations":[]}')});listener({id:request.id,type:'end'});}});return{status:200,statusText:'OK',headers:[['Content-Type','application/json']]};}},fiction:{status:()=>call('status'),setModule:(...args)=>call('set',args),request:(...args)=>call('request',args)}};}`);
      return;
    }
    if (req.url === '/' && process.argv.includes('--hold')) {
      // Browser-only QA transport. The production bundle and native IPC are
      // unchanged; the shim reaches this isolated worker/data directory only.
      const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
        .replace(/(<script src="(?:\.\/|\/)renderer-prelude\.js">)/, '<script src="/__qa-bridge.js"></script>$1');
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
      return;
    }
    void createRendererRequestHandler(path.join(root, 'dist'), req.headers.host)(req, res);
  });
  const rendererPort = await listen(staticServer);
  let faustusInfoCalls = 0;
  ipcMain.handle('fixture:faustus:info', () => {
    faustusInfoCalls++;
    return { server: `http://127.0.0.1:${rendererPort}`, embed_url: `http://127.0.0.1:${rendererPort}/__qa-faustus-panel.js`, data_space_id: 'writer-synthetic-space', tool_server_id: 'writer-synthetic-tools' };
  });
  ipcMain.handle('fixture:faustus:request', (event, request) => {
    setImmediate(() => {
      event.sender.send('fixture:faustus:event', { id: request.id, type: 'chunk', chunk: new TextEncoder().encode('{"conversations":[]}') });
      event.sender.send('fixture:faustus:event', { id: request.id, type: 'end' });
    });
    return { status: 200, statusText: 'OK', headers: [['Content-Type', 'application/json']] };
  });
  const win = new BrowserWindow({ show: false, width: 1440, height: 1040,
    webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => { if (details.level === 'error') { errors.push(details.message); console.error('RENDERER', details.message); } });
  cleanup = async () => { await service.close(); win.destroy(); staticServer.close(); fakeHub.close(); };
  await win.loadURL(`http://127.0.0.1:${rendererPort}/#/fiction`);
  async function waitFor(code, label) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { if (await win.webContents.executeJavaScript(code)) return; await sleep(80); }
    throw new Error(`Timed out: ${label}\n${JSON.stringify(errors)}\n${await win.webContents.executeJavaScript('document.documentElement.outerHTML.slice(-3000)')}`);
  }
  await waitFor(`document.querySelectorAll('[role="switch"]').length===4`, 'fiction switches');
  const off = await service.status();
  if (off.running || off.enabled.length) throw new Error('First UI visit must be all OFF and no worker.');
  if (faustusInfoCalls) throw new Error('The fiction page must not connect Faustus until its button is pressed.');
  await win.webContents.executeJavaScript(`window.__fixtureErrors=[];window.addEventListener('error',e=>window.__fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__fixtureErrors.push(String(e.reason)));`);
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(reports, 'desktop-off.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('[role="switch"]').click()`);
  await waitFor(`!![...document.querySelectorAll('div')].find(node=>node.shadowRoot)?.shadowRoot.querySelector('.grid-cards .btn')`, 'native world library');
  const shadow = `[...document.querySelectorAll('div')].find(node=>node.shadowRoot).shadowRoot`;
  await win.webContents.executeJavaScript(`${shadow}.querySelector('.grid-cards .btn').click()`);
  await waitFor(`${shadow}.querySelector('.transcript')!==null`, 'native play view');
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(reports, 'desktop-play.png'), (await win.webContents.capturePage()).toPNG());
  const sections = await win.webContents.executeJavaScript(`[...${shadow}.querySelectorAll('.nav-item')].map(node=>node.textContent)`);
  if (sections.length < 12) throw new Error('A native fiction section is missing.');
  await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Faustus"]').click()`);
  await waitFor(`!!document.querySelector('faustus-chat')`, 'explicit Faustus panel');
  const context = await win.webContents.executeJavaScript(`document.querySelector('faustus-chat').contextProvider()`);
  const oldSpace = fs.readFileSync(path.join(directory, 'worlds/copilot-space-id'), 'utf8').trim();
  if (context.origin.app_id !== 'scheherazade' || context.origin.data_space_id !== oldSpace || !context.active_objects.some(object => object.kind === 'world')) throw new Error('The fiction copilot must preserve its original space and world context.');
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('aside button')].find(button=>button.title==='Close'||button.title==='Cerrar').click()`);
  await win.webContents.executeJavaScript(`document.querySelector('[role="switch"]').click()`);
  await waitFor(`document.querySelector('[role="switch"]').getAttribute('aria-checked')==='false'`, 'OFF persists');
  const stopped = await service.status();
  if (stopped.running) throw new Error('OFF returned while its worker was running.');
  const uiErrors = await win.webContents.executeJavaScript('window.__fixtureErrors');
  if (errors.length || uiErrors.length) throw new Error(JSON.stringify({ errors, uiErrors }));
  fs.writeFileSync(path.join(reports, 'browser.json'), JSON.stringify({ fullRenderer: true, isolatedProfile: directory,
    switches: 4, allOffAtStart: true, worldLibrary: true, play: true, sections, noRuntimeErrors: true, workerJoinedOnOff: true,
    faustusExplicitOnly: true, faustusLegacySpacePreserved: true, faustusContext: context }, null, 2));
  console.log('PASS full renderer / native fiction / 4 switches OFF / worker shutdown');
  if (process.argv.includes('--hold')) {
    const ready = { url: `http://127.0.0.1:${rendererPort}/#/fiction`, stopFile: path.join(reports, 'STOP'),
      dataDir: path.join(directory, 'worlds'), profile: path.join(directory, 'profile'), apiMcp: result,
      transport: 'Production renderer, synthetic browser IPC shim, owned private stdio engine' };
    fs.writeFileSync(path.join(reports, 'browser-ready.json'), JSON.stringify(ready, null, 2));
    console.log('READY_BROWSER', JSON.stringify(ready));
    const deadline = Date.now() + 40 * 60 * 1000;
    while (Date.now() < deadline && !fs.existsSync(ready.stopFile)) await sleep(1000);
  }
  await cleanup();
  app.quit();
}
app.whenReady().then(main).catch(async error => {
  console.error(error.stack || error);
  fs.writeFileSync(path.join(reports, 'failure.txt'), error.stack || String(error));
  await cleanup();
  app.exit(1);
});
