// Native executor/IPC and the normal audit Undo in the existing isolated CSS runner.
// This does not start an HTTP server or a stdio adapter.
// Resolve the actual Journey worker bundle in the isolated runner's temporary output.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) throw Error('Use Electron for this Native wrapper.');
  const { ipcMain } = require('electron');
  const runner = require(path.join(root, 'scripts/run-codex-properties-ui.cjs'));
  const nativeFile = path.join(runner.directory, 'world-hour-native.cjs');
  const preloadFile = path.join(runner.directory, 'world-hour-preload.cjs');
  const journeyWorkerFile = path.join(runner.directory, 'world-hour-journey-worker.js');
  await build({
    entryPoints: [path.join(root, 'src/engines/worldgen/journey.worker.ts')],
    bundle: true, platform: 'browser', format: 'esm', outfile: journeyWorkerFile,
    alias: { '@': path.join(root, 'src') }, logLevel: 'warning',
  });
  await build({
    stdin: { contents: "export {executeTool} from './electron/aibridge/executor';export {undoBridgeChange} from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';", resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', outfile: nativeFile,
    external: ['electron'], alias: { '@': path.join(root, 'src') }, logLevel: 'warning',
  });
  fs.writeFileSync(preloadFile, "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:fn=>{const listener=(_,payload)=>fn(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});contextBridge.exposeInMainWorld('__worldHourNative',{execute:payload=>ipcRenderer.invoke('world-hour:execute',payload),undo:index=>ipcRenderer.invoke('world-hour:undo',index)});");
  let api, win;
  process.argv[2] = 'tests/world-persistent-hour.browser.tsx';
  process.argv[3] = 'testWorldPersistentHourNative';
  process.argv[4] = '240000';
  await runner.main({
    preloadFile,
    setup: async () => {
      const rendererFile = path.join(runner.directory, 'test.js');
      const emitted = fs.readFileSync(rendererFile, 'utf8');
      const reference = 'new URL("./journey.worker.ts", "file:///reference-ui.js")';
      assert.equal(emitted.split(reference).length - 1, 1, 'Expected exactly one emitted Journey worker URL.');
      const resolved = emitted.replace(reference, `new URL(${JSON.stringify(pathToFileURL(journeyWorkerFile).href)})`);
      const sha = value => createHash('sha256').update(value).digest('hex');
      fs.writeFileSync(rendererFile, resolved);
      console.log('HOUR_REAL_WORKER_ASSET ' + JSON.stringify({ replacements: 1, rendererBeforeRaw: sha(emitted), rendererAfterRaw: sha(resolved), workerSourceRaw: sha(fs.readFileSync(path.join(root, 'src/engines/worldgen/journey.worker.ts'))), workerBundleRaw: sha(fs.readFileSync(journeyWorkerFile)) }));
      api = require(nativeFile);
      await api.setBridgeConfig({ enabled: false, writesEnabled: true });
      ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, win.webContents); api.resolveBridgeReply(payload); });
      ipcMain.handle('world-hour:execute', (event, payload) => { assert.equal(event.sender, win.webContents); return api.executeTool(payload, { origin: 'bridge', clientLabel: 'world-hour-native-qa' }); });
      ipcMain.handle('world-hour:undo', (event, index) => { assert.equal(event.sender, win.webContents); return api.undoBridgeChange(index); });
    },
    window: window => { win = window; api.setBridgeWindowResolver(() => win); },
    close: async () => {
      ipcMain.removeHandler('world-hour:execute');
      ipcMain.removeHandler('world-hour:undo');
      ipcMain.removeHandler('aibridge:reply');
      api.setBridgeWindowResolver(() => null);
    },
  });
}
main().catch(error => {
  console.error(error.stack || error);
  if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1;
});
