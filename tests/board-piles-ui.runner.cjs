// Actual product CSS in isolated Electron, desktop and narrow-window property workflows.
const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-codex-properties-ui-'));
app.setPath('userData', path.join(directory, 'profile'));

async function main(options = {}) {
  await app.whenReady();
  const file = process.argv[2] || './tests/board-piles-ui.browser.tsx';
  const exported = process.argv[3] || 'testBoardPilesUi';
  if (!/^test\w+$/.test(exported) || !path.resolve(root, file).startsWith(path.join(root, 'tests') + path.sep)) throw Error('Expected a test file and exported test function.');
  const {build}=await import('vite'),{default:tailwind}=await import('@tailwindcss/vite');
  const styles=await build({configFile:false,root,plugins:[tailwind()],logLevel:'error',build:{write:false,minify:false,rollupOptions:{input:path.join(root,'src/index.css')}}});
  fs.writeFileSync(path.join(directory,'styles.css'),styles.output.find(item=>item.type==='asset'&&item.fileName.endsWith('.css')).source+'\nhtml,body,#root{height:100%;margin:0}');
  await esbuild.build({
    stdin: {
      contents: `import {${exported} as run} from ${JSON.stringify(path.resolve(root, file))}; globalThis.IS_REACT_ACT_ENVIRONMENT = true; run().then(tests => window.__result = {ok:true,tests}).catch(error => window.__result = {ok:false,error:error.stack || String(error)});`,
      resolveDir: root,
    },
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome130', outfile: path.join(directory, 'test.js'),
    alias: { '@': path.join(root, 'src') }, loader: { '.css': 'css' },
    banner: {js:'const __qaEmptyGlob=()=>({});'},
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob':'__qaEmptyGlob', 'import.meta.url': '"file:///reference-ui.js"' },
    logLevel: 'warning',
  });
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css">' + (fs.existsSync(path.join(directory, 'test.css')) ? '<link rel="stylesheet" href="test.css">' : '') + '</head><body class="bg-deep text-text-primary"><div id="root"></div><script>window.addEventListener("error", event => { window.__result = {ok:false,error:event.error?.stack || event.message}; });</script><script src="test.js"></script></body></html>');
  await app.whenReady();
  await options.setup?.();
  const win = new BrowserWindow({ show: false, useContentSize: true, width: 1280, height: 800, minWidth: 100, minHeight: 100, webPreferences: { preload: options.preloadFile, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.removeMenu();
  await options.window?.(win);
  win.webContents.session.on('will-download',(_event,item)=>{
    const destination=path.join(directory,path.basename(item.getFilename()));item.setSavePath(destination);
    item.once('done',async(_event,state)=>{if(!win.isDestroyed())await win.webContents.executeJavaScript(`window.__downloaded=${JSON.stringify({path:destination})};window.__downloaded.state=${JSON.stringify(state)}`);});
  });
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') console.error(`${details.sourceId}:${details.lineNumber} ${details.message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Test renderer exited: ${details.reason} (${details.exitCode})`);
    app.exit(1);
  });
  await win.loadFile(path.join(directory, 'index.html'));
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript('({ result: window.__result ?? null, want: window.__want ?? null, shot: window.__shot ?? null, native: window.__native ?? null })');
    if (state.native) {
      for (const event of state.native.events) {
        if (event.type === 'text') await win.webContents.insertText(event.text);
        else win.webContents.sendInputEvent(event);
      }
      // Yield input delivery before the next handshake. Native select popups
      // can pause page animation frames, so waiting for a RAF here deadlocks.
      await new Promise(resolve => setTimeout(resolve, 25));
      await win.webContents.executeJavaScript(`window.__native = null; window.__nativeAck = ${state.native.n}; 0`);
    }
    if (state.want) {
      win.setContentSize(state.want.w, state.want.h);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await win.webContents.executeJavaScript(`window.__want = null; window.__sizeAck = ${state.want.n}; 0`);
    }
    if (state.shot) {
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await new Promise(resolve => setTimeout(resolve, 250));
      const file = path.join(directory, `${state.shot.name}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      console.log(`SCREENSHOT ${file}`);
      await win.webContents.executeJavaScript(`window.__shot = null; window.__shotDone = ${JSON.stringify(state.shot.name)}; 0`);
    }
    if (state.result) {
      if (!state.result.ok) throw new Error(state.result.error);
      for (const test of state.result.tests) console.log(`PASS ${test}`);
      await options.close?.();
      app.exit(0);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Codex properties UI test timed out');
}
module.exports = { main, directory };
main().catch((error) => { console.error(error.stack || error); app.exit(1); });
