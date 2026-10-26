// Real stdio/HTTP/executor/IPC/renderer transport; prepared independently, never drawing certification.
const {app,BrowserWindow,ipcMain}=require('electron');
const {build}=require('esbuild');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'wh-icon-svg-native-'));
app.setPath('userData',path.join(directory,'profile'));process.env.HOARD_EVENTS='0';
let bridge,window,adapter,adapterExit,reader,deadline,closing=false,adapterStderr='';
const waiting=new Map(),replies=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}}

async function finish(code,counts){
 if(closing)return;closing=true;clearTimeout(deadline);
 for(const pending of waiting.values()){clearTimeout(pending.timer);pending.reject(Error('SVG native fixture is closing'));}waiting.clear();
 let actualExit=null;
 try{
  if(adapter){
   adapter.stdin.end();
   try{actualExit=await bounded(adapterExit,5000,'SVG adapter did not exit after EOF');}
   catch(error){adapter.kill();actualExit=await bounded(adapterExit,3000,'SVG adapter did not terminate');throw error;}
   assert.deepEqual(actualExit,{code:0,signal:null},'Actual adapter exit must be observed');
   assert.equal(adapterStderr,'','Adapter stderr after actual exit');
  }
 }catch(error){code=1;console.error(error.stack||String(error));}
 reader?.close();bridge?.stopAiBridge();
 if(window&&!window.isDestroyed()){const closed=new Promise(resolve=>window.once('closed',resolve));window.destroy();await closed;}
 ipcMain.removeHandler('aibridge:reply');
 console.log('SVG_NATIVE_PRIVATE_TEMP '+directory);
 if(code===0){
  console.log('PASS real SVG MCP stdio/authenticated private HTTP/executor/IPC/renderer equals public SDK strings/null; no-project and scoped readonly clients; business/notes/ledger/nav/flush/audit/config/token unchanged. JSON is not drawing evidence.');
  console.log('SVG_NATIVE_COUNTS '+JSON.stringify({...counts,adapterExit:actualExit,profileRetained:true,secondKeyClaim:false,hubEventsEnabled:false,drawingClaim:false}));
 }
 app.exit(code);
}

async function run(){
 deadline=setTimeout(()=>{console.error('SVG native total deadline180s');void finish(1);},180000);
 const reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));process.env.WH_AIBRIDGE_PORT=String(port);
 const common={bundle:true,alias:{'@':path.join(root,'src')},logLevel:'warning'};
 const bridgeFile=path.join(directory,'bridge.cjs'),adapterFile=path.join(directory,'stdio.cjs');
 await build({...common,stdin:{contents:"export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';",resolveDir:root},platform:'node',format:'cjs',external:['electron'],outfile:bridgeFile});
 await build({...common,entryPoints:[path.join(root,'electron/aibridge/mcpStdio.ts')],platform:'node',format:'cjs',outfile:adapterFile});
 await build({...common,entryPoints:[path.join(root,'tests/local-tool-icon-svg.native.renderer.ts')],platform:'browser',format:'iife',jsx:'automatic',outfile:path.join(directory,'renderer.js'),loader:{'.css':'empty'},banner:{js:'const __noInstalledSourceModules = () => ({});'},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{"DEV":false,"BASE_URL":"/"}','import.meta.glob':'__noInstalledSourceModules','import.meta.url':'"file:///native-icon-svg.js"'}});
 fs.writeFileSync(path.join(directory,'preload.cjs'),"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});");
 fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>');
 await app.whenReady();bridge=require(bridgeFile);
 await bridge.setBridgeConfig({enabled:true,writesEnabled:false});const token=await bridge.getBridgeToken();
 assert.equal((await bridge.getBridgeConfig()).writesEnabled,false);
 ipcMain.handle('aibridge:reply',(event,payload)=>{assert.equal(event.sender,window.webContents);replies.push({id:payload.id,ok:payload.ok,code:payload.code});bridge.resolveBridgeReply(payload);});
 window=new BrowserWindow({show:false,webPreferences:{preload:path.join(directory,'preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 window.webContents.on('console-message',entry=>{if(entry.level==='error')console.error('RENDERER '+entry.message);});
 bridge.setBridgeWindowResolver(()=>window);await window.loadFile(path.join(directory,'index.html'));
 let fixture;const readyDeadline=Date.now()+30000;
 while(!fixture){
  const error=await window.webContents.executeJavaScript('window.__svgNativeFailure ?? null');if(error)throw Error(error);
  fixture=await window.webContents.executeJavaScript('window.__svgNativeReady ?? null');
  if(!fixture){if(Date.now()>readyDeadline)throw Error('SVG renderer did not become ready');await sleep(40);}
 }
 // These two flags describe this fixture's setup, not a global engine-registry measurement.
 assert.equal(fixture.sourceHostMounted,false);assert.equal(fixture.sourceModulesRegistered,false);
 const renderer=(name,args)=>window.webContents.executeJavaScript(`window.${name}(${args===undefined?'':JSON.stringify(args)})`);
 const snapshot=()=>renderer('__svgNativeSnapshot');
 const before=await snapshot();assert.equal(before.projects,0);assert.equal(before.sourceDocuments,0);assert.equal(before.tables.length,88);
 assert.equal(before.ledger.dirty,1);assert.equal(before.flushes,0);assert.equal(before.changed,0);assert.deepEqual(before.navigation,[]);
 await bridge.appendAudit({at:1,tool:'svg-native-sentinel',summary:'Own immutable SVG audit',before:{notes:'Own audit must survive readonly SVG'},kind:'update',ok:true});
 const names=['audit.jsonl','audit.jsonl.1','audit.offset','config.json','token'];
 const durable=()=>Object.fromEntries(names.map(name=>{try{return[name,fs.readFileSync(path.join(app.getPath('userData'),'aibridge',name))];}catch(error){if(error.code==='ENOENT')return[name,null];throw error;}}));
 const filesBefore=durable(); // keys.json lastUsedAt deliberately excluded, never print a token.
 await bridge.startAiBridge({version:'private-svg-native',hasWindow:()=>true});
 adapter=spawn(process.execPath,[adapterFile],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',WH_BRIDGE_TOKEN:token,WH_BRIDGE_TOKEN_FILE:'',WH_BRIDGE_URL:`http://127.0.0.1:${port}`,WH_PUBLISHING_MODULE:'',WH_MCP_NO_AUTOSTART:'0',HOARD_EVENTS:'0'}});
 adapterExit=new Promise(resolve=>{adapter.once('close',(code,signal)=>resolve({code,signal}));adapter.once('error',error=>resolve({error:String(error)}));});
 let nextId=0;adapter.stderr.on('data',chunk=>{adapterStderr+=chunk.toString();});
 reader=createInterface({input:adapter.stdout});reader.on('line',line=>{
  try{const message=JSON.parse(line),pending=waiting.get(message.id);assert(pending,'Unexpected adapter reply');clearTimeout(pending.timer);waiting.delete(message.id);pending.resolve(message);}
  catch(error){console.error('Invalid SVG adapter protocol '+String(error));void finish(1);}
 });
 adapter.once('close',()=>{for(const pending of waiting.values()){clearTimeout(pending.timer);pending.reject(Error('SVG adapter closed before replying'));}waiting.clear();});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{waiting.delete(id);reject(Error('SVG RPC deadline: '+adapterStderr.slice(-300)));},20000);waiting.set(id,{resolve,reject,timer});adapter.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const initialized=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'independent-icon-svg',version:'1'}});assert(!initialized.error);assert.equal(initialized.result.serverInfo.name,'writers-hoard');
 const listed=await rpc('tools/list',{});assert(!listed.error);
 const matches=listed.result.tools.filter(tool=>tool.name==='wh_local_tool_icon_svg');assert.equal(matches.length,1);
 const tool=matches[0];assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.idempotentHint,true);
 assert.equal(tool.inputSchema.properties.id.type,'string');assert.equal(tool.inputSchema.properties.id.minLength,0);assert(tool.inputSchema.required.includes('id'));
 for(const key of ['projectId','eraId']){assert.equal(tool.inputSchema.properties[key].type,'string');assert(!tool.inputSchema.required.includes(key));}
 const metadata=listed.result.tools.find(tool=>tool.name==='wh_local_tool_icons');assert(metadata);assert.deepEqual(metadata.inputSchema.properties.action.enum,['packs','get','search']);
 let calls=0;
 const call=async(args,relayed=true)=>{
  const prior=replies.length,response=await rpc('tools/call',{name:'wh_local_tool_icon_svg',arguments:args});assert(!response.error);calls++;
  assert.equal(replies.length-prior,relayed?1:0,'Normal validation/IPC boundary changed');
  const blocks=response.result.content;assert.equal(blocks.length,1);assert.equal(blocks[0].type,'text');
  return{isError:response.result.isError===true,value:JSON.parse(blocks[0].text)};
 };
 const valid=async args=>{const actual=await call(args);assert.equal(actual.isError,false,JSON.stringify(actual.value));assert.deepEqual(actual.value,await renderer('__svgNativeExpected',args.id),'SVG/null bytes differ from actual SDK companion');return actual.value;};
 const castle=await valid({id:'Castle'});assert.equal(typeof castle,'string');assert(castle.includes('<svg')&&castle.includes('http://www.w3.org/2000/svg'));
 assert.equal(await valid({id:'writer-map-symbols/1:Castle'}),castle);
 const wand=await valid({id:'Wand2'});assert.equal(await valid({id:'WandSparkles'}),wand);assert.equal(await valid({id:'writer-map-symbols/1:Wand2'}),wand);
 for(const id of ['ChartScatter','Drumstick'])assert.equal(typeof await valid({id}),'string');
 for(const id of ['other-pack:Castle','https://example.invalid/icon.svg','NoSuchSvgSymbol','castle'])assert.equal(await valid({id}),null);
 assert.equal(await valid({id:''}),null,'Empty identity is an unknown SVG, not a validation error');
 assert.equal(await valid({id:123}),null,'Normal string-schema coercion accepts a numeric unknown identity');
 const missingScope={projectId:fixture.projectId+'-missing',eraId:'not-created'};
 assert.equal(await valid({id:'Castle',...missingScope}),castle);assert.equal(await valid({id:'NoSuchSvgSymbol',...missingScope}),null);
 assert.deepEqual(await snapshot(),before,'Global SVG reads changed empty business/ledger/navigation');assert.deepEqual(durable(),filesBefore,'Global SVG reads changed private audit/config/token');
 const seed=await renderer('__svgNativeSeed');assert.equal(seed.projectId,fixture.projectId);
 const sentinel=await snapshot();assert.equal(sentinel.projects,1);assert.equal(sentinel.sourceDocuments,0);assert.deepEqual(sentinel.tables.find(table=>table.name==='projects').rows[0].enabledEngines,[]);
 for(const eraId of [undefined,'past']){
  const scoped=await renderer('__svgNativeScoped',{id:'Castle',...(eraId?{eraId}:{})});assert.equal(scoped.sdk,castle);assert.equal(scoped.callTool,castle);
  assert.equal(await valid({id:'Castle',projectId:fixture.projectId,...(eraId?{eraId}:{})}),castle);
 }
 assert.equal(await valid({id:'Castle',projectId:fixture.projectId,eraId:'era-not-in-project'}),castle);
 for(const args of [{},{id:null},{id:{bad:true}},{id:['Castle']}]){const failure=await call(args,false);assert.equal(failure.isError,true);assert.equal(failure.value.code,'bad-args');}
 assert.equal(await valid({id:'Castle'}),castle,'Valid query did not recover after errors');assert.equal(adapterStderr,'','Adapter stderr must be empty');
 assert.deepEqual(await snapshot(),sentinel,'SVG reads/errors/scoped SDK calls changed all tables, notes, ledger, nav, flushes or events');
 assert.deepEqual(durable(),filesBefore,'SVG reads/errors changed audit/config/token content');assert.equal((await bridge.getBridgeConfig()).writesEnabled,false);
 const cleanup=await renderer('__svgNativeCleanup');assert.deepEqual(cleanup,{projects:0,writings:0,sourceDocuments:0});
 await finish(0,{mcpCalls:calls,rendererReplies:replies.length,rendererErrors:replies.filter(reply=>!reply.ok).length,tablesCompared:before.tables.length,ownPort:port,cleanup});
}
run().catch(error=>{console.error(error.stack||String(error));void finish(1);});
