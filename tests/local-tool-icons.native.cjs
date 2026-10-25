// Actual private MCP stdio -> authenticated HTTP -> executor -> IPC -> normal renderer.
// This is one transport group, not a claim about drawing, Source state or second-key access.
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
const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'wh-local-icons-native-'));
app.setPath('userData',path.join(directory,'profile'));
process.env.HOARD_EVENTS='0';
let native,window,adapter,adapterExit,lines,deadline,closing=false;
const outstanding=new Map(),rendererReplies=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,milliseconds,label){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
async function close(code,result){
  if(closing)return;closing=true;clearTimeout(deadline);
  for(const request of outstanding.values()){clearTimeout(request.timer);request.reject(Error('Private native fixture is closing'));}
  outstanding.clear();
  let adapterResult=null;
  try{
    if(adapter){
      adapter.stdin.end();
      try{adapterResult=await bounded(adapterExit,5000,'Private MCP adapter did not exit after stdin EOF');}
      catch(error){adapter.kill();adapterResult=await bounded(adapterExit,3000,'Private MCP adapter did not exit after its own termination');throw error;}
      assert.deepEqual(adapterResult,{code:0,signal:null},'Actual private MCP adapter exit must be zero');
    }
  }catch(error){code=1;console.error(error.stack||String(error));}
  lines?.close();
  native?.stopAiBridge();
  if(window&&!window.isDestroyed()){
    const closed=new Promise(resolve=>window.once('closed',resolve));window.destroy();await closed;
  }
  ipcMain.removeHandler('aibridge:reply');
  console.log('NATIVE_PRIVATE_TEMP '+directory);
  if(code===0){
    console.log('PASS native icon metadata: actual MCP stdio/authenticated HTTP/executor/IPC/normal renderer, writes disabled; empty project/Source catalogue and public SDK equality, bounded pages/totals/aliases/unknown, optional ignored scope, errors and recovery; complete private business tables, navigation, ledger and audit content unchanged');
    console.log('NATIVE_LOCAL_TOOL_ICONS_COUNTS '+JSON.stringify({...result,adapterExit:adapterResult,profileRetained:true,secondKeyClaim:false}));
  }
  app.exit(code);
}
async function run(){
  deadline=setTimeout(()=>{console.error('Native icon transport exceeded its 180s total deadline');void close(1);},180000);
  const socket=net.createServer();
  await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  process.env.WH_AIBRIDGE_PORT=String(port);
  const common={bundle:true,logLevel:'warning',alias:{'@':path.join(root,'src')}};
  const bridgeFile=path.join(directory,'bridge.cjs'),stdioFile=path.join(directory,'stdio.cjs');
  await esbuild.build({...common,stdin:{contents:"export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';",resolveDir:root},platform:'node',format:'cjs',external:['electron'],outfile:bridgeFile});
  await esbuild.build({...common,entryPoints:[path.join(root,'electron/aibridge/mcpStdio.ts')],platform:'node',format:'cjs',outfile:stdioFile});
  await esbuild.build({...common,entryPoints:[path.join(root,'tests/local-tool-icons.native.renderer.ts')],platform:'browser',format:'iife',jsx:'automatic',outfile:path.join(directory,'renderer.js'),loader:{'.css':'empty'},banner:{js:'const __emptyInstalledSourceGlob = () => ({});'},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{"DEV":false,"BASE_URL":"/"}','import.meta.glob':'__emptyInstalledSourceGlob','import.meta.url':'"file:///native-local-tool-icons.js"'}});
  fs.writeFileSync(path.join(directory,'preload.cjs'),"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});");
  fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>');
  await app.whenReady();
  native=require(bridgeFile);
  await native.setBridgeConfig({enabled:true,writesEnabled:false});
  const token=await native.getBridgeToken();
  assert.equal((await native.getBridgeConfig()).writesEnabled,false);
  ipcMain.handle('aibridge:reply',(event,payload)=>{
    assert.equal(event.sender,window.webContents);rendererReplies.push({id:payload.id,ok:payload.ok,code:payload.code});native.resolveBridgeReply(payload);
  });
  window=new BrowserWindow({show:false,webPreferences:{preload:path.join(directory,'preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  window.webContents.on('console-message',entry=>{if(entry.level==='error')console.error('RENDERER '+entry.message);});
  native.setBridgeWindowResolver(()=>window);
  await window.loadFile(path.join(directory,'index.html'));
  let fixture;const readyUntil=Date.now()+30000;
  while(!fixture){
    const failure=await window.webContents.executeJavaScript('window.__localToolIconsNativeFailure ?? null');if(failure)throw Error(failure);
    fixture=await window.webContents.executeJavaScript('window.__localToolIconsNativeReady ?? null');
    if(!fixture){if(Date.now()>readyUntil)throw Error('Private icon renderer did not become ready');await pause(40);}
  }
  assert.equal(fixture.sourceHostMounted,false);assert.equal(fixture.enginesRegistered,false);
  const rendererCall=(name,args)=>window.webContents.executeJavaScript(`window.${name}(${args===undefined?'':JSON.stringify(args)})`);
  const snapshot=()=>rendererCall('__localToolIconsNativeSnapshot');
  const before=await snapshot();
  assert.equal(before.projects,0);assert.equal(before.sourceDocuments,0);assert.equal(before.ledger.dirty,1);assert.deepEqual(before.navigation,[]);assert.equal(before.flushCalls,0);
  await native.appendAudit({at:1,tool:'native-fixture-sentinel',summary:'Own immutable audit content',before:{notes:'Preserve the private audit sentinel'},kind:'update',ok:true});
  const auditFiles=['audit.jsonl','audit.jsonl.1','audit.offset'];
  const readFile=name=>{try{return fs.readFileSync(path.join(app.getPath('userData'),'aibridge',name));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  const durable=()=>Object.fromEntries([...auditFiles,'config.json','token'].map(name=>[name,readFile(name)]));
  const beforeFiles=durable();
  // keys.json lastUsedAt is normal authentication bookkeeping, not business/audit content.
  await native.startAiBridge({version:'isolated-local-tool-icons-test',hasWindow:()=>true});
  adapter=spawn(process.execPath,[stdioFile],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',WH_BRIDGE_TOKEN:token,WH_BRIDGE_TOKEN_FILE:'',WH_BRIDGE_URL:`http://127.0.0.1:${port}`,HOARD_EVENTS:'0'}});
  adapterExit=new Promise(resolve=>{adapter.once('exit',(code,signal)=>resolve({code,signal}));adapter.once('error',error=>resolve({error:String(error)}));});
  let nextId=0,adapterErrors='';
  adapter.stderr.on('data',buffer=>{adapterErrors+=buffer.toString();});
  lines=createInterface({input:adapter.stdout});
  lines.on('line',line=>{
    try{const response=JSON.parse(line),pending=outstanding.get(response.id);if(pending){clearTimeout(pending.timer);outstanding.delete(response.id);pending.resolve(response);}}
    catch(error){console.error('Invalid private MCP stdout '+String(error));void close(1);}
  });
  const rpc=(method,params)=>new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{outstanding.delete(id);reject(Error(`MCP ${method} deadline: ${adapterErrors.slice(-300)}`));},20000);
    outstanding.set(id,{resolve,reject,timer});adapter.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  const initialized=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'independent-native-icons',version:'1'}});assert(!initialized.error);
  const catalogue=await rpc('tools/list',{});assert(!catalogue.error);
  const matches=catalogue.result.tools.filter(tool=>tool.name==='wh_local_tool_icons');assert.equal(matches.length,1);
  const tool=matches[0];assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.idempotentHint,true);
  assert.deepEqual(tool.inputSchema.properties.action.enum,['packs','get','search']);assert(tool.inputSchema.required.includes('action'));
  assert(!tool.inputSchema.required.includes('projectId'));assert(!tool.inputSchema.required.includes('eraId'));
  assert.equal(tool.inputSchema.properties.projectId.type,'string');assert.equal(tool.inputSchema.properties.eraId.type,'string');
  let calls=0;
  const call=async(args,relayExpected=true)=>{
    const prior=rendererReplies.length,response=await rpc('tools/call',{name:'wh_local_tool_icons',arguments:args});assert(!response.error);calls++;
    const text=response.result.content.find(block=>block.type==='text');assert(text);
    assert.equal(rendererReplies.length-prior,relayExpected?1:0,'Renderer relay count must match the actual validation boundary');
    return{error:response.result.isError===true,value:JSON.parse(text.text)};
  };
  const valid=async args=>{
    const actual=await call(args);assert.equal(actual.error,false,`Valid icon query failed: ${JSON.stringify(actual.value)}`);
    const expected=await rendererCall('__localToolIconsNativeExpected',args);assert.deepEqual(actual.value,expected,'MCP JSON differs from public SDK metadata');return actual.value;
  };
  const packs=await valid({action:'packs'});assert.equal(packs.length,1);assert.equal(packs[0].id,'writer-map-symbols/1');assert(packs[0].count>100);
  const castle=await valid({action:'get',id:'Castle'});assert.equal(castle.id,'writer-map-symbols/1:Castle');assert.equal(castle.name,'Castle');
  assert.deepEqual(await valid({action:'get',id:castle.id}),castle);
  const alias=await valid({action:'get',id:'Wand2'});assert.equal(alias.name,'WandSparkles');
  assert.equal(await valid({action:'get',id:'other-pack:Castle'}),null);
  assert.equal(await valid({action:'get',id:'https://example.invalid/icon.svg'}),null);
  const first=await valid({action:'search',limit:3}),second=await valid({action:'search',offset:3,limit:3});
  assert.equal(first.total,packs[0].count);assert.equal(second.total,first.total);assert.equal(first.items.length,3);assert.equal(second.items.length,3);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,6);
  const defaults=await valid({action:'search'});assert.equal(defaults.items.length,50);assert.equal(defaults.total,first.total);
  const outside=await valid({action:'search',offset:first.total+9,limit:3});assert.deepEqual(outside.items,[]);assert.equal(outside.total,first.total);
  const words=await valid({action:'search',query:'Map Pin',limit:4});assert(words.total>0);assert(words.items.every(item=>/Map Pin/i.test(item.label)));
  const absent=await valid({action:'search',query:'native-no-such-symbol-1523'});assert.deepEqual(absent,{items:[],total:0});
  const absentScope={projectId:`${fixture.projectId}-missing`,eraId:'missing-era'};
  assert.deepEqual(await valid({action:'packs',...absentScope}),packs);
  assert.deepEqual(await valid({action:'get',id:'Castle',...absentScope}),castle);
  assert.deepEqual(await valid({action:'search',limit:3,...absentScope}),first);
  assert.deepEqual(await snapshot(),before,'Global icon reads changed empty private business tables, navigation or pending ledger');
  assert.deepEqual(durable(),beforeFiles,'Global icon reads changed private audit/config/token content');
  const seeded=await rendererCall('__localToolIconsNativeSeed');assert.equal(seeded.projectId,fixture.projectId);
  const sentinel=await snapshot();assert.equal(sentinel.projects,1);assert.equal(sentinel.sourceDocuments,0);
  assert.deepEqual(await valid({action:'get',id:'Castle',projectId:fixture.projectId,eraId:'not-created'}),castle);
  const invalidCases=[
    {args:{action:'not-an-action'},relay:false,code:'bad-args'},
    {args:{action:'get'},relay:true,code:'bad-args'},
    {args:{action:'search',query:{bad:true}},relay:false,code:'bad-args'},
    {args:{action:'search',offset:-1},relay:true,code:'tool-error'},
    {args:{action:'search',limit:0},relay:true,code:'tool-error'},
    {args:{action:'search',offset:0.5},relay:true,code:'tool-error'},
  ];
  for(const test of invalidCases){const invalid=await call(test.args,test.relay);assert.equal(invalid.error,true);assert.equal(invalid.value.code,test.code);}
  assert.deepEqual(await valid({action:'get',id:'Castle'}),castle,'Valid recovery after invalid requests changed');
  assert.deepEqual(await snapshot(),sentinel,'Icon reads/errors changed private notes, projects, tables, navigation, data events or pending ledger');
  assert.deepEqual(durable(),beforeFiles,'Icon reads/errors changed private audit/config/token content');
  assert.equal((await native.getBridgeConfig()).writesEnabled,false);
  const cleaned=await rendererCall('__localToolIconsNativeCleanup');assert.deepEqual(cleaned,{projects:0,writings:0,sourceDocuments:0});
  await close(0,{mcpCalls:calls,rendererReplies:rendererReplies.length,rendererErrors:rendererReplies.filter(reply=>!reply.ok).length,tablesCompared:before.tables.length,ownPort:port,cleanup:cleaned,hubEventsEnabled:false});
}
run().catch(error=>{console.error(error.stack||String(error));void close(1);});
