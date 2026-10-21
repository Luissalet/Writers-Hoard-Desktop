// Normal external MCP -> HTTP -> IPC, actual PNG compositor and offline readers.
const {app,BrowserWindow,ipcMain,nativeImage}=require('electron');
const {build}=require('esbuild');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{createInterface}=require('node:readline'),assert=require('node:assert/strict');
const runner=require('../scripts/run-codex-properties-ui.cjs'),directory=runner.directory,root=path.resolve(__dirname,'..');
process.argv[2]='./tests/source-tool-reading.browser.ts';process.argv[3]='testSourceToolReading';
let bridge,win,child;
const preloadFile=path.join(directory,'preload.cjs');
fs.writeFileSync(preloadFile,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{documentImages:{capture:r=>ipcRenderer.invoke('document-image:capture',r)},aiBridge:{onRequest:fn=>{const l=(_,r)=>fn(r);ipcRenderer.on('aibridge:request',l);return()=>ipcRenderer.removeListener('aibridge:request',l)},reply:r=>ipcRenderer.invoke('aibridge:reply',r)}});`);
runner.main({preloadFile,async setup(){
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));process.env.WH_AIBRIDGE_PORT=String(reserve.address().port);await new Promise(r=>reserve.close(r));
 const file=path.join(directory,'native.cjs');await build({bundle:true,logLevel:'warning',platform:'node',format:'cjs',alias:{'@':path.join(root,'src')},stdin:{contents:`export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';export * from './electron/documentImage';export {isIpcChannelAllowedForRole} from './electron/security';`,resolveDir:root},external:['electron'],outfile:file});
 bridge=require(file);await bridge.setBridgeConfig({enabled:true,writesEnabled:true});
 ipcMain.handle('aibridge:reply',(event,payload)=>{assert.equal(event.sender,win.webContents);bridge.resolveBridgeReply(payload);});
 bridge.registerDocumentImageIpc((event,channel)=>{assert.equal(event.sender,win.webContents);assert.equal(event.senderFrame,event.sender.mainFrame);assert(bridge.isIpcChannelAllowedForRole(channel,'main'));});
},window(w){win=w;bridge.setBridgeWindowResolver(()=>win);},async close(){
 await bridge.startAiBridge({version:'synthetic-qa',hasWindow:()=>true});const token=await bridge.getBridgeToken(),url='http://127.0.0.1:'+process.env.WH_AIBRIDGE_PORT,adapter=path.join(directory,'mcp.cjs');
 await build({bundle:true,logLevel:'warning',platform:'node',format:'cjs',alias:{'@':path.join(root,'src')},entryPoints:[path.join(root,'electron/aibridge/mcpStdio.ts')],outfile:adapter});
 child=spawn(process.execPath,[adapter],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',WH_BRIDGE_TOKEN:token,WH_BRIDGE_URL:url}});
 const pending=new Map(),lines=createInterface({input:child.stdout});let sequence=0,stderr='';child.stderr.on('data',data=>stderr+=data);
 lines.on('line',line=>{const reply=JSON.parse(line),item=pending.get(reply.id);if(item){clearTimeout(item.timer);pending.delete(reply.id);item.resolve(reply);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP timeout '+stderr.slice(-400)));},180000);pending.set(id,{resolve,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const call=async(name,args)=>{const reply=await rpc('tools/call',{name,arguments:args});assert(!reply.error,JSON.stringify(reply.error));const text=JSON.parse(reply.result.content.find(item=>item.type==='text').text);assert(!reply.result.isError,JSON.stringify(text));return text;};
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'source-reading-native',version:'1'}});
 const fixture=await win.webContents.executeJavaScript('window.__sourceReading');
 for(const eraId of [undefined,fixture.eraId])for(const kind of ['reader','wiki']){
  const result=await call(kind==='reader'?'wh_reader_export':'wh_wiki_export',{projectId:fixture.projectId,eraId,locale:'en'});
  assert(result.html.includes(eraId?'ERA_ONLY_NOTEBOOK':'BASE_ONLY_NOTEBOOK'));assert(!result.html.includes(eraId?'BASE_ONLY_NOTEBOOK':'ERA_ONLY_NOTEBOOK'));assert(result.html.includes('FINAL_SOURCE_FIELD'));
  const file=path.join(directory,kind+'-'+(eraId||'base')+'.html');fs.writeFileSync(file,result.html);
  const view=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{partition:'source-reading-'+kind+'-'+(eraId||'base'),contextIsolation:true,sandbox:true}});let network=0;
  view.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{network++;cb({cancel:true});});await view.webContents.session.enableNetworkEmulation({offline:true});await view.loadFile(file);
  assert(await view.webContents.executeJavaScript(`document.body.textContent.includes('FINAL_SOURCE_FIELD')&&document.body.textContent.includes('<b>LITERAL_SOURCE_HTML</b>')&&!Array.from(document.querySelectorAll('b')).some(node=>node.textContent==='LITERAL_SOURCE_HTML')&&typeof window.electronAPI==='undefined'`));assert.equal(network,0);
  const png=path.join(directory,kind+'-'+(eraId||'base')+'.png');fs.writeFileSync(png,(await view.webContents.capturePage()).toPNG());console.log('SCREENSHOT '+png);view.destroy();
 }
 console.log('PASS external native Reader/wiki Base+era, fresh offline profiles, complete source data and literal HTML, no runtime or network');
 for(const eraId of [undefined,fixture.eraId]){
  const image=await call('wh_export_document_image',{projectId:fixture.projectId,eraId,kind:'local-tool',entityId:fixture.documentId,width:640,pageHeight:640,locale:'en'});assert(image.height>640&&image.pages.length>1);assert(image.sourceVersion);assert.equal(image.framing.mode,'complete-flow');
  for(const page of image.pages){const png=Buffer.from(page.dataUrl.split(',')[1],'base64'),decoded=nativeImage.createFromBuffer(png);assert.equal(decoded.getSize().width,page.pixelWidth);assert.equal(decoded.getSize().height,page.pixelHeight);assert(decoded.toBitmap().some(byte=>byte!==255));const file=path.join(directory,'source-'+(eraId||'base')+'-'+page.index+'.png');fs.writeFileSync(file,png);console.log('SCREENSHOT '+file);}
 }
 console.log('PASS external native source document PNG16 actual compositor complete tiling in Base and era');
 const frozen=await win.webContents.executeJavaScript('window.__sourceReadingFrozen');assert(frozen.includes('BASE_ONLY_NOTEBOOK')&&!frozen.includes('CHANGED_LIVE_NOTEBOOK'));
 child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));child=null;lines.close();bridge.stopAiBridge();console.log('Source reading native QA '+directory);
}}).catch(error=>{console.error(error.stack||error);child?.kill();bridge?.stopAiBridge();app.exit(1);});
