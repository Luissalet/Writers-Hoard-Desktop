const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const directory = process.env.WRITER_DOCUMENT_FULL_APP_QA;
const runtime = require(path.join(directory, 'runtime.cjs'));
app.setPath('userData', path.join(directory, `profile-${Date.now()}`));
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const assert = (value, message) => { if (!value) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const failures = [];
const downloads = [];
async function main() {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1280, height: 1000, minWidth: 100, minHeight: 100, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const expectedUrl = pathToFileURL(path.join(directory, 'index.html')).href;
  const assertSender = (event, channel) => {
    assert(event.sender === win.webContents && event.senderFrame === event.sender.mainFrame && runtime.isExactRendererDocumentUrl(event.senderFrame.url, expectedUrl) && runtime.isIpcChannelAllowedForRole(channel, 'main'), `Unexpected sender for ${channel}`);
  };
  runtime.registerDocumentIpc(assertSender);
  runtime.registerAiIpc({ assertIpcSender: assertSender, window: () => win });
  runtime.registerFaustusIpc(assertSender, async () => {});
  runtime.setBridgeWindowResolver(() => win);
  ipcMain.handle('aibridge:reply', (event, value) => { assertSender(event, 'aibridge:reply'); runtime.resolveBridgeReply(value); });
  ipcMain.handle('aibridge:getInfo', async () => ({ enabled: false, writesEnabled: true, running: false, token: '', toolCount: 0, port: 63007, url: 'http://127.0.0.1:63007' }));
  ipcMain.handle('updates:getState', () => ({ phase: 'disabled', supported: false }));
  ipcMain.handle('ollama:getStatus', () => ({ installed: false, running: false }));
  ipcMain.on('forge:memory', event => { event.returnValue = os.totalmem(); });
  ipcMain.on('shutdown:setWarning', () => {});
  win.webContents.on('console-message', detail => { if (detail.level === 'error') failures.push(detail.message); });
  win.webContents.on('render-process-gone', (_event, detail) => failures.push(`Renderer exited ${detail.reason}`));
  win.webContents.session.on('will-download', (_event, item) => {
    const destination = path.join(directory, path.basename(item.getFilename()));
    item.setSavePath(destination);
    item.once('done', (_event, state) => downloads.push({ path: destination, state }));
  });
  await win.loadFile(path.join(directory, 'index.html'));
  async function ready() {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const result = await win.webContents.executeJavaScript('({ready:!!window.__documentQa,error:window.__documentQaError})');
      if (result.error) throw new Error(result.error);
      if (result.ready) return;
      await sleep(50);
    }
    throw new Error('Full application did not become ready');
  }
  const call = method => win.webContents.executeJavaScript(`window.__documentQa.${method}()`);
  await ready();
  const formatted = await call('format');
  const rendererReloaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload(); await rendererReloaded; await ready();
  const reloaded = await call('snapshot');
  assert(reloaded.row.content === formatted.html && reloaded.html.includes('<table'), 'Autosaved formatting was lost after full renderer reload');
  await call('imported');
  const deadline = Date.now() + 10000;
  while (downloads.length < 2 && Date.now() < deadline) await sleep(50);
  assert(downloads.length >= 2 && downloads.every(item => item.state === 'completed'), 'Native exports did not download');
  const docx = downloads.find(item => item.path.endsWith('.docx'));
  const pdf = downloads.find(item => item.path.endsWith('.pdf'));
  assert(docx && fs.readFileSync(docx.path).subarray(0, 2).toString() === 'PK', 'Actual DOCX download invalid');
  assert(pdf && fs.readFileSync(pdf.path).subarray(0, 5).toString() === '%PDF-', 'Actual PDF download invalid');
  await call('frame');
  await fs.promises.writeFile(path.join(directory, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(390, 1000); await sleep(250); const narrow = await call('responsive');
  await call('frame');
  await fs.promises.writeFile(path.join(directory, 'mobile.png'), (await win.webContents.capturePage()).toPNG());
  assert(narrow.viewport.scrollWidth <= narrow.viewport.width + 1, `Page overflow at 390: ${narrow.viewport.scrollWidth}`);
  assert(failures.length === 0, `Renderer errors: ${failures.join('\n')}`);
  const binary = path.join(root, 'native/bin/writer-document-engine.exe');
  const result = { ok: true, tests: ['Full App native toolbar DOM -> autosave -> renderer reload', 'Native DOCX file picker -> original preservation -> import -> undo', 'Native PNG page loaded through actual preload and IPC', 'Actual DOCX/PDF Blob downloads written without dialogs', 'Real Tailwind desktop and narrow view screenshots without page overflow'], downloads, rendererErrors: failures, viewport: narrow.viewport, binarySha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(binary)).digest('hex') };
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  result.tests.forEach(test => console.log(`PASS ${test}`));
}
main().then(async () => { await runtime.stopDocumentEngine(); win?.destroy(); app.exit(0); }).catch(async error => {
  console.error(error.stack || error);
  if (win && !win.isDestroyed()) { await fs.promises.writeFile(path.join(directory, 'failure.png'), (await win.webContents.capturePage()).toPNG()); fs.writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ error: String(error.stack || error), rendererErrors: failures }, null, 2)); }
  await runtime.stopDocumentEngine(); win?.destroy(); app.exit(1);
});
