// Run the direct-file workflow's native composition in the existing isolated UI host.
if (!process.versions.electron) throw Error('Run this test with Electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {build} = require('esbuild');
const {ipcMain, app} = require('electron');
const root = path.resolve(__dirname, '..');
const runner = require(path.join(root, 'scripts/run-codex-properties-ui.cjs'));

async function main() {
  const nativeFile = path.join(runner.directory, 'board-file-native.cjs');
  const preloadFile = path.join(runner.directory, 'board-file-preload.cjs');
  await build({stdin: {contents: "export {executeTool} from './electron/aibridge/executor';export {undoBridgeChange} from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';", resolveDir: root}, bundle: true, platform: 'node', format: 'cjs', outfile: nativeFile, external: ['electron'], alias: {'@': path.join(root, 'src')}, logLevel: 'warning'});
  fs.writeFileSync(preloadFile, "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:fn=>{const listener=(_,payload)=>fn(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});contextBridge.exposeInMainWorld('__iconsAudit',{invoke:(op,payload)=>ipcRenderer.invoke('board-file:audit',op,payload)});");
  let native, win;
  process.argv[2] = 'tests/board-file-import.browser.tsx';
  process.argv[3] = 'testBoardFileNativeComposition';
  await runner.main({preloadFile, setup: async () => {
    native = require(nativeFile);
    await native.setBridgeConfig({enabled: false, writesEnabled: true});
    ipcMain.handle('aibridge:reply', (event, payload) => {
      assert.equal(event.sender, win.webContents);
      native.resolveBridgeReply(payload);
    });
    ipcMain.handle('board-file:audit', async (event, operation, payload) => {
      assert.equal(event.sender, win.webContents);
      if (operation === 'execute') return native.executeTool(payload, {origin: 'bridge', clientLabel: 'board-file-qa'});
      if (operation === 'record') return native.getAuditRecord(payload);
      if (operation === 'records') return native.readAudit(20);
      if (operation === 'undo') return native.undoBridgeChange(payload);
      throw Error('Unknown existing audit operation');
    });
  }, window: window => {
    win = window;
    native.setBridgeWindowResolver(() => win);
  }, close: async () => {
    ipcMain.removeHandler('board-file:audit');
    ipcMain.removeHandler('aibridge:reply');
    native.setBridgeWindowResolver(() => null);
  }});
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
