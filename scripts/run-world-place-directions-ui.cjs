// Directions UI causal QA on the caller's already-running Vite. No server startup or worker URL rewrite.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const exported = process.argv[2];
if (!['testWorldPlaceDirections', 'testWorldPlaceDirectionsEra'].includes(exported)) throw Error('Pass the explicit Directions Base or Era export');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-directions-author-live-'));
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, useContentSize: true, width: 1280, height: 800, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.removeMenu();
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  win.webContents.on('render-process-gone', (_event, details) => { console.error('Renderer gone ' + details.reason); app.exit(1); });
  const baseURL = process.env.WH_TEST_BASE_URL || 'http://127.0.0.1:63395';
  const url = new URL('/tests/world-place-directions.ui.html', baseURL); url.searchParams.set('test', exported);
  console.log('LIVE ' + url.href + ' PRIVATE_PROFILE ' + directory);
  await win.loadURL(url.href);
  const deadline = Date.now() + 240000;
  let stage, warnings = 0;
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript('({ result: window.__result ?? null, native: window.__native ?? null, stage: window.__testStage ?? null, warnings: window.__resizeObserverWarnings ?? 0 })');
    if (state.stage && state.stage !== stage) { stage = state.stage; console.log('STAGE ' + stage); }
    if (state.warnings > warnings) { warnings = state.warnings; console.log('RESIZE_OBSERVER_WARNING ' + warnings); }
    if (state.native) {
      for (const event of state.native.events) {
        if (event.type === 'text') await win.webContents.insertText(event.text);
        else win.webContents.sendInputEvent(event);
      }
      await new Promise(resolve => setTimeout(resolve, 25));
      await win.webContents.executeJavaScript(`window.__native = null; window.__nativeAck = ${state.native.n}; 0`);
    }
    if (state.result) {
      if (!state.result.ok) throw Error(state.result.error);
      for (const test of state.result.tests) console.log('PASS ' + test);
      win.destroy(); app.exit(0); return;
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw Error('Directions live causal QA timed out');
})().catch(error => { console.error(error.stack || error); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); });
