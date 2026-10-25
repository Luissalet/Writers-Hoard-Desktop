const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {build}=require('esbuild');
const root=path.resolve(__dirname,'..');

async function main(){
 if(!process.versions.electron)throw Error('Use Electron for this Native wrapper.');
 const {ipcMain}=require('electron'),runner=require(path.join(root,'scripts/run-codex-properties-ui.cjs'));
 const file=path.join(runner.directory,'context-menu-native.cjs'),preload=path.join(runner.directory,'context-menu-preload.cjs');
 await build({stdin:{contents:"export {executeTool} from './electron/aibridge/executor';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';",resolveDir:root},bundle:true,platform:'node',format:'cjs',outfile:file,external:['electron'],alias:{'@':path.join(root,'src')},logLevel:'warning'});
 fs.writeFileSync(preload,"const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:fn=>{const listener=(_,payload)=>fn(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});contextBridge.exposeInMainWorld('__contextMenuNative',{execute:payload=>ipcRenderer.invoke('context-menu:execute',payload)});");
 let api,win;process.argv[2]='tests/local-tool-context-menus.browser.tsx';process.argv[3]='testLocalToolContextMenuNative';
 await runner.main({
  preloadFile:preload,
  setup:async()=>{
   api=require(file);await api.setBridgeConfig({enabled:false,writesEnabled:true});
   ipcMain.handle('aibridge:reply',(event,payload)=>{assert.equal(event.sender,win.webContents);api.resolveBridgeReply(payload);});
   ipcMain.handle('context-menu:execute',(event,payload)=>{assert.equal(event.sender,win.webContents);return api.executeTool(payload,{origin:'bridge',clientLabel:'context-menu-native-qa'});});
  },
  window:window=>{win=window;api.setBridgeWindowResolver(()=>win);},
  close:async()=>{ipcMain.removeHandler('context-menu:execute');ipcMain.removeHandler('aibridge:reply');api.setBridgeWindowResolver(()=>null);},
 });
}
main().catch(error=>{console.error(error.stack||error);if(process.versions.electron)require('electron').app.exit(1);else process.exitCode=1;});
