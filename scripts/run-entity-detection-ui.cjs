const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), directory = path.join(root, 'work/entity-detection-ui');
fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader');
async function main() {
  const modelDirectory = process.argv[2]; if (!modelDirectory) throw Error('Pass the isolated prepared model directory');
  const { compile } = require('@tailwindcss/node'), { Scanner } = require('@tailwindcss/oxide');
  const compiler = await compile(fs.readFileSync(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} });
  const scanner = new Scanner({ sources: [{ base: path.join(root, 'src'), pattern: '**/*.{ts,tsx}', negated: false }, { base: path.join(root, 'tests'), pattern: 'entity-detection-layout.browser.tsx', negated: false }] });
  fs.writeFileSync(path.join(directory, 'styles.css'), compiler.build(scanner.scan()) + '\n' + fs.readFileSync(path.join(root, 'src/components/editor/entityDetection/entityDetection.css'), 'utf8'));
  await esbuild.build({ stdin: { contents: `import {testEntityDetectionLayout as run} from './tests/entity-detection-layout.browser.tsx';globalThis.IS_REACT_ACT_ENVIRONMENT=true;run().then(tests=>window.__result={ok:true,tests}).catch(error=>window.__result={ok:false,error:error.stack||String(error)});`, resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome130', outfile: path.join(directory, 'test.js'), alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///entity-test.js"' }, logLevel: 'warning' });
  for (const entry of ['worker', 'runtime', 'ipc']) await esbuild.build({ entryPoints: [path.join(root, `electron/entityDetection/${entry}.ts`)], bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22', outfile: path.join(directory, `${entry}.cjs`) });
  const blockedWorker = path.join(directory, 'blocked-worker.cjs'); fs.writeFileSync(blockedWorker, `globalThis.fetch=()=>{throw Error('NETWORK_BLOCKED')};require('./worker.cjs');`);
  const { EntityDetectionRuntime } = require(path.join(directory, 'runtime.cjs')), { registerEntityDetectionIpc } = require(path.join(directory, 'ipc.cjs'));
  const runtime = new EntityDetectionRuntime(modelDirectory, blockedWorker); registerEntityDetectionIpc(require('electron').ipcMain, runtime);
  fs.writeFileSync(path.join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{entityDetection:{status:()=>ipcRenderer.invoke('entity-detection:status'),prepare:()=>ipcRenderer.invoke('entity-detection:prepare'),detect:text=>ipcRenderer.invoke('entity-detection:detect',text)}});`);
  // Start unprepared only at the runtime marker; model assets stay intact.
  const marker = path.join(modelDirectory, 'ready.json'); if (fs.existsSync(marker)) fs.unlinkSync(marker);
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body class="bg-deep text-text-primary"><div id="root"></div><script src="test.js"></script></body></html>');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, useContentSize: true, width: 1440, height: 1000, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(directory, 'preload.cjs') } });
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  await win.loadFile(path.join(directory, 'index.html'));
  const deadline = Date.now() + 180000;
  try {
    while (Date.now() < deadline) {
      const state = await win.webContents.executeJavaScript('({result:window.__result??null,want:window.__want??null,shot:window.__shot??null,key:window.__key??null})');
      if (state.want) { win.setContentSize(state.want.w, state.want.h); await new Promise(resolve => setTimeout(resolve, 150)); await win.webContents.executeJavaScript(`window.__want=null;window.__sizeAck=${state.want.n};0`); }
      if (state.shot) { fs.writeFileSync(path.join(directory, state.shot.name + '.png'), (await win.webContents.capturePage()).toPNG()); await win.webContents.executeJavaScript(`window.__shot=null;window.__shotDone=${JSON.stringify(state.shot.name)};0`); }
      if (state.key) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: state.key.key }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: state.key.key }); await win.webContents.executeJavaScript(`window.__key=null;window.__keyAck=${state.key.n};0`); }
      if (state.result) { fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(state.result, null, 2)); if (!state.result.ok) throw Error(state.result.error); state.result.tests.forEach(test => console.log('PASS ' + test)); return; }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw Error('Entity UI timeout');
  } finally { await runtime.close(); win.destroy(); }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
