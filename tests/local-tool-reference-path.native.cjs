// Independent transport group: actual MCP stdio -> HTTP executor -> IPC -> renderer/IndexedDB.
const {app,BrowserWindow,ipcMain}=require('electron');
const esbuild=require('esbuild');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const root=path.resolve(__dirname,'..');
const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'wh-reference-path-native-'));
app.setPath('userData',path.join(directory,'profile'));
let native,window,adapter,lines,deadline,exiting=false;
const outstanding=new Map(),rendererReplies=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function finish(code){
  if(exiting)return;exiting=true;clearTimeout(deadline);
  for(const request of outstanding.values())clearTimeout(request.timer);
  outstanding.clear();
  if(adapter){
    const stopped=new Promise(resolve=>adapter.once('exit',resolve));
    adapter.stdin.end();
    await Promise.race([stopped,pause(3000)]);
    if(adapter.exitCode===null&&!adapter.killed){adapter.kill();await Promise.race([stopped,pause(1000)]);}
  }
  lines?.close();
  native?.stopAiBridge();
  if(window&&!window.isDestroyed())window.destroy();
  ipcMain.removeHandler('aibridge:reply');
  console.log('NATIVE_PRIVATE_TEMP '+directory);
  app.exit(code);
}
async function run(){
  deadline=setTimeout(()=>{console.error('Native reference-path harness exceeded 180s external deadline');void finish(1);},180000);
  const socket=net.createServer();
  await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
  const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  process.env.WH_AIBRIDGE_PORT=String(port);
  const common={bundle:true,logLevel:'warning',alias:{'@':path.join(root,'src')}};
  const bridgeFile=path.join(directory,'bridge.cjs'),stdioFile=path.join(directory,'stdio.cjs');
  await esbuild.build({...common,stdin:{contents:"export * from './electron/aibridge/server'; export * from './electron/aibridge/state'; export * from './electron/aibridge/rpc';",resolveDir:root},platform:'node',format:'cjs',external:['electron'],outfile:bridgeFile});
  await esbuild.build({...common,entryPoints:[path.join(root,'electron/aibridge/mcpStdio.ts')],platform:'node',format:'cjs',outfile:stdioFile});
  await esbuild.build({...common,entryPoints:[path.join(root,'tests/local-tool-reference-path.native.renderer.ts')],platform:'browser',format:'iife',jsx:'automatic',outfile:path.join(directory,'renderer.js'),loader:{'.css':'empty'},banner:{js:'const __emptyInstalledSourceGlob = () => ({});'},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{"DEV":false,"BASE_URL":"/"}','import.meta.glob':'__emptyInstalledSourceGlob','import.meta.url':'"file:///native-reference-path.js"'}});
  fs.writeFileSync(path.join(directory,'preload.cjs'),"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});");
  fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>');
  await app.whenReady();
  native=require(bridgeFile);
  await native.setBridgeConfig({enabled:true,writesEnabled:false});
  const token=await native.getBridgeToken();
  ipcMain.handle('aibridge:reply',(event,payload)=>{assert.equal(event.sender,window.webContents);rendererReplies.push({id:payload.id,ok:payload.ok});native.resolveBridgeReply(payload);});
  window=new BrowserWindow({show:false,webPreferences:{preload:path.join(directory,'preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  window.webContents.on('console-message',entry=>{if(entry.level==='error')console.error('RENDERER '+entry.message);});
  native.setBridgeWindowResolver(()=>window);
  await window.loadFile(path.join(directory,'index.html'));
  let fixture;
  const readyUntil=Date.now()+30000;
  while(!fixture){
    const failure=await window.webContents.executeJavaScript('window.__referencePathNativeFailure ?? null');
    if(failure)throw Error(failure);
    fixture=await window.webContents.executeJavaScript('window.__referencePathNativeReady ?? null');
    if(!fixture){if(Date.now()>readyUntil)throw Error('Private normal-registry renderer failed to become ready');await pause(40);}
  }
  assert.equal(fixture.registeredBeforeOpen,true);
  const snapshot=()=>window.webContents.executeJavaScript('window.__referencePathNativeSnapshot()');
  const before=await snapshot();
  assert.deepEqual(before.navigation,[]);assert.equal(before.flushCalls,0);assert.equal(before.ledger.dirty,1);
  await native.startAiBridge({version:'isolated-reference-path-test',hasWindow:()=>true});
  adapter=spawn(process.execPath,[stdioFile],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',WH_BRIDGE_TOKEN:token,WH_BRIDGE_URL:`http://127.0.0.1:${port}`}});
  let nextId=0,adapterErrors='';
  adapter.stderr.on('data',buffer=>{adapterErrors+=buffer.toString();});
  lines=createInterface({input:adapter.stdout});
  lines.on('line',line=>{
    try{const response=JSON.parse(line),pending=outstanding.get(response.id);if(pending){clearTimeout(pending.timer);outstanding.delete(response.id);pending.resolve(response);}}
    catch(error){console.error('Invalid MCP stdout '+String(error));void finish(1);}
  });
  const rpc=(method,params)=>new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{outstanding.delete(id);reject(Error(`MCP ${method} deadline: ${adapterErrors.slice(-500)}`));},30000);
    outstanding.set(id,{resolve,timer});adapter.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'independent-reference-path',version:'1'}});
  const catalog=await rpc('tools/list',{});assert(!catalog.error);
  const matches=catalog.result.tools.filter(tool=>tool.name==='wh_local_tool_reference_resolve');
  assert.equal(matches.length,1);
  assert.equal(matches[0].inputSchema.properties.includePath.type,'boolean');
  assert(!matches[0].inputSchema.required.includes('includePath'));
  assert.equal(matches[0].annotations.readOnlyHint,true);
  const scope={projectId:fixture.projectId,namespace:fixture.namespace,reference:{kind:'codex',documentId:fixture.cardId}};
  const call=async args=>{
    const response=await rpc('tools/call',{name:'wh_local_tool_reference_resolve',arguments:args});assert(!response.error);
    const text=response.result.content.find(block=>block.type==='text');assert(text);
    return{error:response.result.isError===true,value:JSON.parse(text.text)};
  };
  const old=await call(scope),explicitFalse=await call({...scope,includePath:false});
  assert.equal(old.error,false);assert.equal(explicitFalse.error,false);assert.deepEqual(old.value,explicitFalse.value);
  assert.equal(old.value.available,true);assert.equal(old.value.title,'Native Base reference');assert.equal(old.value.provenance,'base');assert(!Object.hasOwn(old.value,'path'));
  const base=await call({...scope,includePath:true}),era=await call({...scope,eraId:fixture.eraId,includePath:true});
  assert.equal(base.error,false);assert.equal(era.error,false);
  assert.equal(base.value.path,`/project/${fixture.projectId}/codex?entry=${fixture.cardId}`);
  assert.equal(base.value.title,'Native Base reference');assert.equal(base.value.provenance,'base');
  assert.equal(era.value.path,`/project/${fixture.projectId}/codex?entry=${fixture.cardId}&era=${fixture.eraId}`);
  assert.equal(era.value.title,'Native Era reference');assert.equal(era.value.provenance,'variant');assert.deepEqual(base.value.reference,era.value.reference);
  const missing=await call({...scope,reference:{kind:'codex',documentId:`${fixture.projectId}-missing`},includePath:true});
  assert.equal(missing.error,false);assert.equal(missing.value.available,false);assert.equal(missing.value.path,null);
  const normalized=await call({...scope,includePath:'true'});
  assert.equal(normalized.error,false);assert.deepEqual(normalized.value,base.value);
  const invalid=await call({...scope,includePath:{invalid:true}});
  assert.equal(invalid.error,true);assert.equal(invalid.value.code,'bad-args');assert.match(invalid.value.error,/includePath|boolean/);
  const afterError=await call(scope);assert.equal(afterError.error,false);assert.deepEqual(afterError.value,old.value);
  const after=await snapshot();assert.deepEqual(after,before,'Read-only native queries changed profile tables, navigation, flusher or ledger');
  assert.equal(rendererReplies.length,7,'The noncoercible type should fail in the executor before renderer IPC; seven valid reads must traverse IPC');
  assert(rendererReplies.every(reply=>reply.ok===true));
  const cleaned=await window.webContents.executeJavaScript('window.__referencePathNativeCleanup()');assert.deepEqual(cleaned,{projects:0,cards:0,variants:0});
  console.log('PASS native reference-path contract: actual MCP stdio/HTTP/executor/IPC/normal renderer; optional schema, old omit/false, Base+era canonical paths before target open, missing/null, normal boolean-string coercion, bad-args then old recovery; complete private DB/navigation/flusher/ledger unchanged');
  console.log('NATIVE_REFERENCE_PATH_COUNTS '+JSON.stringify({mcpQueries:8,rendererReplies:rendererReplies.length,tablesCompared:before.tables.length,cleanup:cleaned,ownPort:port,primaryTokenOnly:true}));
  await finish(0);
}
run().catch(error=>{console.error(error.stack||String(error));void finish(1);});
