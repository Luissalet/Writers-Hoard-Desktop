// Uses the existing CSS runner, plus the real two-key stdio/HTTP/executor/IPC pipeline.
const {app,ipcMain}=require('electron'),{build}=require('esbuild');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process'),{createInterface}=require('node:readline');
const harness=require('../scripts/run-codex-properties-ui.cjs'),root=path.resolve(__dirname,'..'),directory=harness.directory;
process.env.HOARD_EVENTS='0';
const sourceBlock=process.env.WH_NATIVE_SOURCE_BLOCK_FOCUS==='1';
const sourceCommand=process.env.WH_NATIVE_SOURCE_UNDO_COMMAND==='1';
const sourceProvider=process.env.WH_NATIVE_SOURCE_UNDO_PROVIDER==='1';
const sourcePushed=process.env.WH_NATIVE_SOURCE_PUSHED_UNDO==='1';
const sourceOwned=process.env.WH_NATIVE_SOURCE_OWNED_BLOCK_PANEL==='1';
const sourceDerived=process.env.WH_NATIVE_SOURCE_DERIVED_AGENT==='1';
const sourceCatalogue=process.env.WH_NATIVE_RUNTIME_CATALOGUE==='1';
const packageSha=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
assert([sourceBlock,sourceCommand,sourceProvider,sourcePushed,sourceOwned,sourceDerived,sourceCatalogue].filter(Boolean).length<=1,'Select one Native Source scenario');
const sourceScenario=sourceCatalogue?'runtime-package-catalogue':sourceDerived?'source-derived-agent':sourceOwned?'source-owned-block-panel':sourcePushed?'source-pushed-undo':sourceProvider?'source-undo-provider':sourceCommand?'source-undo-command':sourceBlock?'source-block-open':null;
const revocations=[];
const evidence=path.join(root,'_stage/parity-completion-next/sdk-platform',(sourceCatalogue?'runtime-catalogue-native-':sourceDerived?'source-derived-native-':sourceOwned?'source-owned-native-':sourcePushed?'source-pushed-native-':sourceProvider?'source-provider-native-':sourceCommand?'source-command-native-':sourceBlock?'source-block-native-':'native-')+Date.now()+'-'+process.pid);fs.mkdirSync(evidence,{recursive:true});
const preloadFile=path.join(directory,'focus-preload.cjs'),adapterFile=path.join(directory,'focus-stdio.cjs');
// QuickNote is unrelated to focus; this fixture does not capture/relay notes or start its window.
fs.writeFileSync(preloadFile,"const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{platform:process.platform,quickNote:{setContext:()=>{},onCapture:()=>()=>{},onOpenInline:()=>()=>{},ack:()=>{}},aiBridge:{onRequest:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});");
let bridge,window,port,keys,driver,closing=false,toolCalls=0,rpcCalls=0,failure,sourceHostMounted=false,ownedHostMounted=false,runtimeRendererReady=false,serverStarted=false;
const sessions=[],replies=[],transcript=[],checks=[],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const save=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+'\n');
async function bounded(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]);}finally{clearTimeout(timer);}}
async function close(){
 if(closing)return;closing=true;const errors=[];
 if(sourceScenario&&bridge){
  for(const key of keys??[]){
   if(!key.ok)continue;
   try{
    assert.equal((await bridge.bridgeKeys.revoke(key.key.id)).ok,true);
    const prior=replies.length;
    if(serverStarted){
     const response=await fetch('http://127.0.0.1:'+port+'/api/call',{
      method:'POST',headers:{Authorization:'Bearer '+key.token,'Content-Type':'application/json'},
      body:JSON.stringify({tool:'wh_workspace_tabs',args:{}}),signal:AbortSignal.timeout(5000),
     });
     assert.equal(response.status,401);
     assert.equal(replies.length,prior,'Revoked key reached IPC');
     revocations.push({keyId:key.key.id,httpStatus:response.status,newIPC:0});
    }else revocations.push({keyId:key.key.id,httpStatus:null});
   }catch(error){errors.push(String(error));}
  }
  if(!failure&&revocations.filter(row=>row.httpStatus===401).length!==2)errors.push('Expected two revoked credentials to return 401');
 }
 for(const session of sessions)try{await session.close();}catch(error){errors.push(String(error));}
 if(bridge){bridge.stopAiBridge();await bounded(new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();reject(Error('Private focus port still open'));});socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));}),5000,'Focus close deadline').catch(error=>errors.push(String(error)));}
 ipcMain.removeHandler('aibridge:reply');
 const result={...(sourceScenario?{scenario:sourceScenario,revocations}:{}),ok:!failure&&errors.length===0,toolCalls,rpcCalls,ipcReplies:replies.length,sessions:sessions.map(item=>item.report()),checks,errors,failure,sourceHostMounted,...(sourceOwned?{ownedHostMounted}:{}),...(sourceCatalogue?{runtimeRendererReady}:{}),profileRetained:true,privateProfile:directory,serverNeverStarted:!serverStarted,serverClosed:serverStarted&&errors.length===0};save('RESULT.json',result);save('mcp-transcript.json',transcript);save('ipc-replies.json',replies);
 console.log('FOCUS_NATIVE_EVIDENCE '+evidence);console.log('FOCUS_NATIVE_PRIVATE_TEMP '+directory);console.log('FOCUS_NATIVE_RESULT '+JSON.stringify(result));assert.equal(errors.length,0,errors.join('\n'));
}
async function adapter(token,label){
 const child=spawn(process.execPath,[adapterFile],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',WH_BRIDGE_TOKEN:token,WH_BRIDGE_TOKEN_FILE:'',WH_BRIDGE_URL:`http://127.0.0.1:${port}`,WH_PUBLISHING_MODULE:'',...(sourceOwned||sourceDerived||sourceCatalogue?{WH_BRIDGE_GROUPS:''}:{}),WH_MCP_NO_AUTOSTART:'0',HOARD_EVENTS:'0'}});
 const waiting=new Map();let next=0,stderr='',ended=false,actualExit=null;child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
 const exit=new Promise(resolve=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',error=>resolve({error:String(error)}));});
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{const value=JSON.parse(line),pending=waiting.get(value.id);assert(pending,'Unexpected stdio reply');clearTimeout(pending.timer);waiting.delete(value.id);pending.resolve(value);}catch(error){failure=String(error);for(const pending of waiting.values())pending.reject(error);waiting.clear();}});
 child.once('close',()=>{for(const pending of waiting.values()){clearTimeout(pending.timer);pending.reject(Error('Focus stdio closed before reply'));}waiting.clear();});
 const session={rpc:(method,params)=>new Promise((resolve,reject)=>{rpcCalls++;const id=++next,timer=setTimeout(()=>{waiting.delete(id);reject(Error('Focus RPC deadline'));},20000);waiting.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}),close:async()=>{if(ended)return;ended=true;child.stdin.end();try{actualExit=await bounded(exit,5000,'Focus stdio EOF deadline');}catch(error){if(sourceScenario)throw error;child.kill();actualExit=await bounded(exit,3000,'Focus child close deadline');throw error;}finally{lines.close();fs.writeFileSync(path.join(evidence,label+'.stderr.log'),stderr);}assert.deepEqual(actualExit,{code:0,signal:null});},report:()=>({label,exit:actualExit,pending:waiting.size,stderrBytes:Buffer.byteLength(stderr)})};sessions.push(session);
 const initialized=await session.rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'focus-native-fixture',version:'1'}});assert(!initialized.error);assert.equal(initialized.result.serverInfo.name,'writers-hoard');return session;
}
async function setup(){
 const reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));process.env.WH_AIBRIDGE_PORT=String(port);
 const common={bundle:true,platform:'node',format:'cjs',alias:{'@':path.join(root,'src')},logLevel:'warning'},bridgeFile=path.join(directory,'focus-bridge.cjs');
 await build({...common,stdin:{contents:"export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';",resolveDir:root},external:['electron'],outfile:bridgeFile});
 await build({...common,entryPoints:[path.join(root,'electron/aibridge/mcpStdio.ts')],outfile:adapterFile});
 bridge=require(bridgeFile);await bridge.setBridgeConfig({enabled:true,writesEnabled:true});keys=[];for(const label of ['Focus Native A','Focus Native B'])keys.push(await bridge.bridgeKeys.create(label));for(const key of keys)assert.equal(key.ok,true);assert.notEqual(keys[0].token,keys[1].token);assert.notEqual(keys[0].key.id,keys[1].key.id);
 ipcMain.handle('aibridge:reply',(event,payload)=>{assert.equal(event.sender,window.webContents);replies.push({id:payload.id,ok:payload.ok,code:payload.code});bridge.resolveBridgeReply(payload);});
}
async function drive(win){
 const renderer=(name,args)=>win.webContents.executeJavaScript(`window.${name}(${args===undefined?'':JSON.stringify(args)})`);let fixture;const deadline=Date.now()+45000;
 while(!fixture){const result=await win.webContents.executeJavaScript('({ready:window.__focusNativeReady??null,result:window.__result??null})');if(result.result?.ok===false)throw Error(result.result.error);fixture=result.ready;if(!fixture){if(Date.now()>deadline)throw Error('Actual focus UI did not mount');await sleep(40);}}
 if(sourceCatalogue){assert.equal(fixture.runtimeRendererReady,true);runtimeRendererReady=true;}else if(sourceOwned){assert.equal(fixture.ownedHostMounted,true);ownedHostMounted=true;}else{assert.equal(fixture.sourceHostMounted,true);sourceHostMounted=true;}save('fixture.json',fixture);const base={projectId:fixture.projectId},GET='wh_workspace_focus_get',SET='wh_workspace_focus_set';
 await bridge.startAiBridge({version:'private-focus-native',hasWindow:()=>true});serverStarted=true;const a=await adapter(keys[0].token,'A'),b=await adapter(keys[1].token,'B');
 async function call(session,name,args,relayed=true){const prior=replies.length,response=await session.rpc('tools/call',{name,arguments:args});toolCalls++;assert(!response.error);assert.equal(replies.length-prior,relayed?1:0);assert.equal(response.result.content.length,1);assert.equal(response.result.content[0].type,'text');const outcome={isError:response.result.isError===true,value:JSON.parse(response.result.content[0].text)};const loggedArgs=sourceCatalogue&&args.file?{file:{name:args.file.name,mime:args.file.mime,bytes:Buffer.from(args.file.base64,'base64').length,fileSha256:packageSha(Buffer.from(args.file.base64,'base64'))}}:args;transcript.push({session:session.report().label,name,args:loggedArgs,outcome,ipcReplies:replies.length-prior});return outcome;}
 async function ok(session,name,args){const result=await call(session,name,args);assert.equal(result.isError,false,JSON.stringify(result.value));return result.value;}
 if(sourceScenario){
  const run=sourceCatalogue?driveRuntimeCatalogue:sourceDerived?driveSourceDerived:sourceOwned?driveSourceOwned:sourcePushed?driveSourcePushed:sourceProvider?driveSourceProvider:sourceCommand?driveSourceCommand:driveSourceBlock;
  await run({a,b,ok,call,renderer,fixture});
  await renderer('__focusNativeFinish',{ok:true});
  return;
 }
 const baseline=await renderer('__focusNativeSnapshot');save('before.json',baseline);assert.equal(baseline.projects.length,2);assert.equal(baseline.sourceA.document.data.notes,'Saved Focus A');assert.equal(baseline.sourceB.document.data.notes,'Saved Focus B');
 const unchanged=async(label,active)=>{assert.deepEqual(await renderer('__focusNativeSnapshot'),baseline,label+' changed own projects/sources/control/pending');checks.push({label,...await renderer('__focusNativeCheck',{active})});};
 // A successful write carries the normal transport undo handle, even when focus is unavailable.
 // Match that handle to this exact authenticated audit append before checking the UI body.
 const writeAudit=[];
 async function set(session,args,expected){
  const priorAudit=await bridge.readAudit(100),priorSnapshot=await renderer('__focusNativeSnapshot'),value=await ok(session,SET,args);
  assert(value&&typeof value==='object'&&!Array.isArray(value));assert(value._undo&&typeof value._undo==='object');
  assert.deepEqual(Object.keys(value._undo).sort(),['app_id','audit_index']);assert.equal(value._undo.app_id,'writer');assert(Number.isSafeInteger(value._undo.audit_index)&&value._undo.audit_index>=0);
  const audit=await bridge.readAudit(100);assert.equal(audit.length,priorAudit.length+1);assert.deepEqual(audit.slice(1),priorAudit);const row=audit[0];
  assert.equal(row.index,value._undo.audit_index);assert(!priorAudit.some(item=>item.index===row.index));assert.equal(row.tool,SET);assert.equal(row.ok,true);assert.equal(row.origin,'bridge');assert.equal(row.client,'mcp-stdio');assert.equal(row.keyLabel,'Focus Native '+session.report().label);assert.equal(row.projectId,args.projectId);assert.equal(row.eraId,args.eraId);assert.equal(row.kind,'update');
  assert.equal(row.table,undefined);assert.equal(row.entityId,undefined);assert.equal(row.before,undefined);
  assert.deepEqual(value,{...expected,_undo:{app_id:'writer',audit_index:row.index}});
  assert.deepEqual(await renderer('__focusNativeSnapshot'),priorSnapshot,'Focus write changed authored project/source/control/pending data');
  writeAudit.push({session:session.report().label,args,body:expected,undo:value._undo,audit:row});save('checked-write-audit.json',writeAudit);return value;
 }
 for(const session of [a,b]){const listed=await session.rpc('tools/list',{});assert(!listed.error);for(const [name,readonly]of [[GET,true],[SET,false]]){const tools=listed.result.tools.filter(tool=>tool.name===name);assert.equal(tools.length,1);assert.equal(tools[0].annotations.readOnlyHint,readonly);}}
 const initial=await ok(a,GET,base);assert.equal(initial.targets.length,2);for(const target of initial.targets)assert.deepEqual([target.available,target.active],[true,false]);const target=initial.targets.find(item=>item.documentId===fixture.a),eraTarget=initial.targets.find(item=>item.documentId===fixture.b);assert(target&&eraTarget);assert.equal(eraTarget.eraId,fixture.eraId);assert.notEqual(target.hostId,eraTarget.hostId);await unchanged('readonly get',false);
 await set(a,{...base,hostId:target.hostId,active:true},{available:true,active:true});await unchanged('key A entered real shell',true);
 const filtered=await ok(b,GET,{...base,eraId:fixture.eraId,documentId:fixture.b});assert.equal(filtered.targets.length,1);assert.equal(filtered.targets[0].active,true);
 await set(b,{...base,hostId:eraTarget.hostId,eraId:fixture.eraId,active:false},{available:true,active:false});await unchanged('key B exited shared shell',false);
 await set(a,{...base,hostId:'revoked-or-missing',active:true},{available:false,active:false});await set(b,{projectId:fixture.controlId,hostId:target.hostId,active:true},{available:false,active:false});await unchanged('missing and foreign-scope targets',false);
 await bridge.setBridgeConfig({writesEnabled:false});const denied=await call(a,SET,{...base,hostId:target.hostId,active:true},false);assert.equal(denied.isError,true);assert.equal(denied.value.code,'writes-disabled');assert.equal((await ok(b,GET,base)).targets.length,2);await unchanged('disabled write and readonly get',false);await bridge.setBridgeConfig({writesEnabled:true});
 const audit=await bridge.readAudit(100);for(const [index,label]of [[0,'Focus Native A'],[1,'Focus Native B']]){assert(audit.some(row=>row.tool===SET&&row.ok&&row.origin==='bridge'&&row.client==='mcp-stdio'&&row.keyLabel===label),'No normal authenticated write for '+label);const key=(await bridge.bridgeKeys.list()).find(item=>item.id===keys[index].key.id);assert.equal(typeof key.lastUsedAt,'number');}save('audit.json',audit);
 const cleanup=await renderer('__focusNativeCleanup');assert.deepEqual(cleanup,{projects:0,sourceHosts:0,flushes:0});save('cleanup.json',cleanup);
 assert.deepEqual(await ok(a,GET,base),{projectId:fixture.projectId,targets:[]});await set(b,{...base,hostId:target.hostId,active:true},{available:false,active:false});assert.deepEqual(await ok(a,GET,base),{projectId:fixture.projectId,targets:[]});
 const after=await renderer('__focusNativeSnapshot');assert.equal(after.projects.length,2);assert(after.projects.every(row=>row===undefined||row===null));assert.equal(after.sourceA,undefined);assert.equal(after.sourceB,undefined);save('after-cleanup.json',after);
 await a.close();await b.close();await close();await win.webContents.executeJavaScript('window.__focusNativeFinish({ok:true});0');
}
async function driveSourceBlock({a,b,ok,renderer,fixture}){
 const scope={projectId:fixture.projectId}, target={...scope,documentId:fixture.documentId};
 const OPEN='wh_local_tool_document_open',TABS='wh_workspace_tabs',FOCUS='wh_workspace_focus_get';
 for(const session of [a,b]){
  const listed=await session.rpc('tools/list',{});
  assert(!listed.error);
  for(const [name,readOnly] of [[OPEN,false],[TABS,true]]){
   const match=listed.result.tools.filter(tool=>tool.name===name);
   assert.equal(match.length,1);assert.equal(match[0].annotations.readOnlyHint,readOnly);
  }
 }
 const before=await renderer('__focusNativeBlockSnapshot');
 assert.equal(before.source.document.id,fixture.documentId);
 assert.equal(before.source.provenance,'base');
 assert.equal((await ok(b,TABS,scope)).tabs.length,0);
 const open=async(session,blockId,available,applied)=>{
  const {_undo,...result}=await ok(session,OPEN,{...target,blockId});
  assert.deepEqual(result,{available,applied});
 };
 async function observe(session,blockId,count){
  const dom=await renderer('__focusNativeBlockObserve',blockId);
  const tabs=await ok(session,TABS,scope);
  assert.equal(tabs.projectId,fixture.projectId);assert.equal(tabs.tabs.length,count);
  const active=tabs.tabs.find(tab=>tab.id===tabs.activeTabId);
  assert(active?.active);assert.equal(active.id,dom.companion.paneId);
  assert.equal(active.engineId,'local-tool-'+fixture.namespace);
  const route=new URL(active.route,'https://writer.invalid');
  assert.equal(route.pathname,'/project/'+fixture.projectId+'/local-tool-'+fixture.namespace);
  assert.equal(route.searchParams.get('document'),fixture.documentId);
  assert.equal(route.searchParams.get('block'),blockId);
  const focus=await ok(session,FOCUS,{...scope,documentId:fixture.documentId});
  assert(focus.targets.length>0&&focus.targets.every(item=>item.available===true&&item.active===false&&item.documentId===fixture.documentId));
  return {dom,tabs,focus};
 }
 await open(a,'notes',true,true);
 const notes=await observe(b,'notes',1);
 assert.deepEqual(await renderer('__focusNativeBlockSnapshot'),before);
 const saved=await renderer('__focusNativeBlockEdit','Saved through Source block focus');
 const undone=await renderer('__focusNativeBlockUndo',before.source.document.data.notes);
 for(const [snapshot,expectedNotes,revisionDelta] of [[saved,'Saved through Source block focus',1],[undone,before.source.document.data.notes,2]]){
  assert.equal(snapshot.source.provenance,before.source.provenance);
  assert.equal(snapshot.source.lineage,before.source.lineage);
  const {revision,updatedAt,data,...identity}=snapshot.source.document;
  const {revision:beforeRevision,updatedAt:beforeUpdatedAt,data:beforeData,...beforeIdentity}=before.source.document;
  assert.equal(revision,beforeRevision+revisionDelta);
  assert.deepEqual(identity,beforeIdentity);
  assert.deepEqual(data,{...beforeData,notes:expectedNotes});
  assert.deepEqual(snapshot.variants,before.variants);
 }
 await open(b,'items',true,true);
 const items=await observe(a,'items',2);
 assert.notEqual(items.dom.companion.paneId,notes.dom.companion.paneId);
 assert(items.tabs.tabs.some(tab=>tab.id===notes.dom.companion.paneId&&tab.route===notes.tabs.tabs[0].route));
 assert.deepEqual(await renderer('__focusNativeBlockSnapshot'),undone);
 await renderer('__focusNativeBlockUnmount');
 const withoutWorkspace=await renderer('__focusNativeBlockSnapshot');
 assert.deepEqual(withoutWorkspace,undone);
 const tabsBefore=await ok(a,TABS,scope);
 await open(b,'notes',false,false);
 const tabsAfter=await ok(a,TABS,scope);
 assert.deepEqual(tabsAfter,tabsBefore);
 assert.deepEqual(await renderer('__focusNativeBlockSnapshot'),withoutWorkspace);
 save('source-block-observations.json',{before,notes,saved,undone,items,withoutWorkspace,tabsBefore,tabsAfter});
 checks.push({label:'Source block open, live tabs/DOM, saved edit and Undo, unavailable after workspace unmount'});
}
async function driveSourceCommand({a,b,ok,renderer,fixture}){
 const scope={projectId:fixture.projectId,namespace:fixture.namespace,documentId:fixture.documentId};
 const LIST='wh_local_tool_command_list',RUN='wh_local_tool_command_run',READ='wh_local_tool_read';
 const commandId='add-review-checklist';
 const list=async session=>{
  const {commands}=await ok(session,LIST,scope);
  assert(Array.isArray(commands));
  return commands.filter(command=>command.id===commandId);
 };
 const before=await ok(b,READ,scope);
 assert.equal(before.document.id,fixture.documentId);
 assert.equal(before.document.namespace,fixture.namespace);
 assert.equal(before.provenance,'base');
 assert(Array.isArray(before.data.items));
 const principal=await list(b);
 assert.equal(principal.length,1);
 assert.equal(typeof principal[0].instanceId,'string');
 assert(principal[0].instanceId.length>0);
 const opened=await renderer('__focusNativeCommandOpen');
 assert.equal(opened.documentId,fixture.documentId);
 const mounted=await list(a);
 assert.equal(mounted.length,2);
 assert.deepEqual(mounted.find(command=>command.instanceId===principal[0].instanceId),principal[0]);
 const companion=mounted.find(command=>command.instanceId!==principal[0].instanceId);
 assert(companion&&typeof companion.instanceId==='string'&&companion.instanceId.length>0);
 assert.deepEqual(companion.label,{en:'Add review checklist',es:'Añadir pauta de revisión'});
 assert.equal(companion.inputSchema.type,'object');
 assert.deepEqual(await ok(a,READ,scope),before);
 const run=async(session,available,applied)=>{
  const {_undo,...result}=await ok(session,RUN,{...scope,instanceId:companion.instanceId,commandId,input:{locale:'en'}});
  assert.deepEqual(result,{available,applied});
 };
 const identity=({revision,updatedAt,data,document:{version,...document},...rest})=>({document,...rest});
 function appended(snapshot,revisionDelta){
  assert.equal(snapshot.revision,before.revision+revisionDelta);
  assert.deepEqual(identity(snapshot),identity(before));
  const {items,...fields}=snapshot.data,{items:oldItems,...oldFields}=before.data;
  assert.deepEqual(fields,oldFields);
  assert.equal(items.length,oldItems.length+2);
  assert.deepEqual(items.slice(0,oldItems.length),oldItems);
  const added=items.slice(oldItems.length);
  assert(added.every(item=>typeof item.id==='string'&&item.id&&typeof item.text==='string'&&item.text.trim()));
  assert.equal(new Set(items.map(item=>item.id)).size,items.length);
  return items.map(item=>item.text);
 }
 await run(a,true,true);
 const savedA=await ok(b,READ,scope), textsA=appended(savedA,1);
 const visibleA=await renderer('__focusNativeCommandObserve',{texts:textsA,applied:true});
 const visibleUndo=await renderer('__focusNativeCommandUndo',before.data.items.map(item=>item.text));
 const undone=await ok(b,READ,scope);
 assert.equal(undone.revision,before.revision+2);
 assert.deepEqual(identity(undone),identity(before));
 assert.deepEqual(undone.data,before.data);
 const listedByB=await list(b);
 assert.equal(listedByB.length,2);
 assert.deepEqual(listedByB.find(command=>command.instanceId===companion.instanceId),companion);
 await run(b,true,true);
 const savedB=await ok(a,READ,scope), textsB=appended(savedB,3);
 const visibleB=await renderer('__focusNativeCommandObserve',{texts:textsB,applied:true});
 const closed=await renderer('__focusNativeCommandClose');
 assert.equal(closed.paneId,opened.paneId);
 assert.deepEqual(await list(a),principal);
 await run(b,false,false);
 assert.deepEqual(await ok(a,READ,scope),savedB);
 await renderer('__focusNativeCommandCheckPrincipal');
 save('source-command-observations.json',{before,principal,mounted,opened,savedA,visibleA,undone,visibleUndo,listedByB,savedB,visibleB,closed});
 checks.push({label:'Two keys used one Source command instance, real Undo changed only its stack, closed instance unavailable'});
}
async function driveSourceProvider({a,b,ok,renderer,fixture}){
 const scope={projectId:fixture.projectId,namespace:fixture.namespace,documentId:fixture.documentId};
 const LIST='wh_local_tool_undo_provider_list',RUN='wh_local_tool_undo_provider_run',READ='wh_local_tool_read';
 const read=session=>ok(session,READ,scope);
 const list=async session=>{
  const {providers}=await ok(session,LIST,scope);
  assert(Array.isArray(providers));
  return providers.filter(provider=>provider.providerId==='rehearsal-order');
 };
 const binding=({instanceId,providerId,providerToken})=>({instanceId,providerId,providerToken});
 const directions=(provider,canUndo,canRedo)=>assert.deepEqual([provider.canUndo,provider.canRedo],[canUndo,canRedo]);
 const run=async(session,provider,mode,available,applied)=>{
  const {_undo,...result}=await ok(session,RUN,{...scope,...binding(provider),mode});
  assert.deepEqual(result,{available,applied});
 };
 const prepared=await renderer('__focusNativeProviderPrepare');
 const before=await read(b),initial=before.data.items;
 assert.equal(before.document.id,fixture.documentId);
 assert.equal(before.document.namespace,fixture.namespace);
 assert.equal(before.provenance,'base');
 assert.equal(initial.length,3);
 assert.equal(new Set(initial.map(item=>item.id)).size,3);
 const original=initial.map(item=>item.text);
 assert.deepEqual(prepared,original);
 const main=await list(b);
 assert.equal(main.length,1);
 assert(typeof main[0].instanceId==='string'&&main[0].instanceId.length>0);
 assert(typeof main[0].providerToken==='string'&&main[0].providerToken.length>0);
 directions(main[0],false,false);
 const companionFrom=providers=>{
  assert.equal(providers.length,2);
  assert.deepEqual(providers.find(provider=>provider.instanceId===main[0].instanceId),main[0]);
  const companion=providers.find(provider=>provider.instanceId!==main[0].instanceId);
  assert(companion&&typeof companion.instanceId==='string'&&companion.instanceId.length>0);
  assert(typeof companion.providerToken==='string'&&companion.providerToken.length>0);
  assert.notEqual(companion.providerToken,main[0].providerToken);
  assert.deepEqual(companion.label,{en:'Rehearsal order',es:'Orden de ensayo'});
  return companion;
 };
 const opened=await renderer('__focusNativeProviderOpen');
 assert.equal(opened.documentId,fixture.documentId);
 const observed=async(saved,rehearsal,canUndo,canRedo,writerUndo=false)=>renderer('__focusNativeProviderObserve',{saved,rehearsal,canUndo,canRedo,writerUndo});
 await observed(original,original,false,false);
 await renderer('__focusNativeProviderMove',original[0]);
 const reordered=[initial[1],initial[0],initial[2]],rehearsal=reordered.map(item=>item.text);
 const moved=await observed(original,rehearsal,true,false);
 const companion=companionFrom(await list(a));
 directions(companion,true,false);
 assert.deepEqual(await read(b),before);
 await run(a,companion,'undo',true,true);
 const undoneModel=await observed(original,original,false,true);
 assert.deepEqual(await read(b),before);
 const redoProvider=companionFrom(await list(b));
 assert.deepEqual(binding(redoProvider),binding(companion));
 directions(redoProvider,false,true);
 await run(b,redoProvider,'redo',true,true);
 const redoneModel=await observed(original,rehearsal,true,false);
 assert.deepEqual(await read(a),before);
 await renderer('__focusNativeProviderApply');
 const appliedDOM=await observed(rehearsal,rehearsal,false,false,true);
 const afterApply=await read(b);
 const identity=({revision,updatedAt,data,document:{version,...document},...rest})=>({document,...rest});
 assert.equal(afterApply.revision,before.revision+1);
 assert.deepEqual(identity(afterApply),identity(before));
 assert.deepEqual(afterApply.data,{...before.data,items:reordered});
 await renderer('__focusNativeProviderWriterUndo');
 const writerUndoDOM=await observed(original,original,false,false);
 const restored=await read(a);
 assert.equal(restored.revision,before.revision+2);
 assert.deepEqual(identity(restored),identity(before));
 assert.deepEqual(restored.data,before.data);
 const latest=companionFrom(await list(a));
 directions(latest,false,false);
 const closed=await renderer('__focusNativeProviderClose');
 assert.equal(closed,opened.paneId);
 assert.deepEqual(await list(b),main);
 await run(b,latest,'undo',false,false);
 assert.deepEqual(await read(a),restored);
 const afterClose=await renderer('__focusNativeProviderPrincipal',original);
 save('source-provider-observations.json',{before,main,opened,companion,moved,undoneModel,redoProvider,redoneModel,afterApply,appliedDOM,restored,writerUndoDOM,latest,closed,afterClose});
 checks.push({label:'Two keys used one rehearsal provider without writing; Apply and Writer Undo changed the saved order; retired token unavailable'});
}
async function driveSourcePushed({a,b,ok,renderer,fixture}){
 const scope={projectId:fixture.projectId,namespace:fixture.namespace,documentId:fixture.documentId};
 const LIST='wh_local_tool_undo_provider_list',RUN='wh_local_tool_undo_provider_run',READ='wh_local_tool_read';
 const list=async session=>{
  const {providers}=await ok(session,LIST,scope);
  assert(Array.isArray(providers));
  return providers.filter(provider=>provider.providerId==='review-shortlist');
 };
 const binding=({instanceId,providerId,providerToken})=>({instanceId,providerId,providerToken});
 const directions=(provider,canUndo,canRedo)=>assert.deepEqual([provider.canUndo,provider.canRedo],[canUndo,canRedo]);
 const run=async(session,provider,mode,available,applied)=>{
  const {_undo,...result}=await ok(session,RUN,{...scope,...binding(provider),mode});
  assert.deepEqual(result,{available,applied});
 };
 const prepared=await renderer('__focusNativePushedPrepare');
 const before=await ok(b,READ,scope);
 assert.equal(before.document.id,fixture.documentId);
 assert.equal(before.document.namespace,fixture.namespace);
 assert.equal(before.provenance,'base');
 const items=before.data.items.map(item=>item.text),marked=items.slice(0,2);
 assert.equal(items.length,3);
 assert.equal(new Set(items).size,items.length);
 assert.deepEqual(prepared,items);
 const principal=await list(b);
 assert.equal(principal.length,1);
 assert(typeof principal[0].instanceId==='string'&&principal[0].instanceId.length>0);
 assert(typeof principal[0].providerToken==='string'&&principal[0].providerToken.length>0);
 directions(principal[0],false,false);
 const companionFrom=providers=>{
  assert.equal(providers.length,2);
  assert.deepEqual(providers.find(provider=>provider.instanceId===principal[0].instanceId),principal[0]);
  const companion=providers.find(provider=>provider.instanceId!==principal[0].instanceId);
  assert(companion&&typeof companion.instanceId==='string'&&companion.instanceId.length>0);
  assert(typeof companion.providerToken==='string'&&companion.providerToken.length>0);
  assert.notEqual(companion.providerToken,principal[0].providerToken);
  assert.deepEqual(companion.label,{en:'Review shortlist',es:'Lista para revisar'});
  return companion;
 };
 const opened=await renderer('__focusNativePushedOpen');
 assert.equal(opened.documentId,fixture.documentId);
 const observe=(selected,canUndo,canRedo)=>renderer('__focusNativePushedObserve',{items,selected,canUndo,canRedo});
 await observe([],false,false);
 await renderer('__focusNativePushedMark',marked);
 const afterMarks=await observe(marked,true,false);
 assert.deepEqual(await ok(b,READ,scope),before);
 const companion=companionFrom(await list(a));
 directions(companion,true,false);
 await run(a,companion,'undo',true,true);
 const afterUndo=await observe([],false,true);
 assert.deepEqual(await ok(b,READ,scope),before);
 const redoProvider=companionFrom(await list(b));
 assert.deepEqual(binding(redoProvider),binding(companion));
 directions(redoProvider,false,true);
 await run(b,redoProvider,'redo',true,true);
 const afterRedo=await observe(marked,true,false);
 assert.deepEqual(await ok(a,READ,scope),before);
 const closed=await renderer('__focusNativePushedClose');
 assert.equal(closed,opened.paneId);
 assert.deepEqual(await list(a),principal);
 await run(b,companion,'undo',false,false);
 assert.deepEqual(await ok(a,READ,scope),before);
 const afterClose=await renderer('__focusNativePushedPrincipal',items);
 save('source-pushed-observations.json',{before,principal,opened,companion,afterMarks,afterUndo,redoProvider,afterRedo,closed,afterClose});
 checks.push({label:'Two keys undo and redo one grouped shortlist on the same provider, with saved data exact and retired token unavailable'});
}
async function driveSourceOwned({a,b,ok,renderer,fixture}){
 const scope={projectId:fixture.projectId,owner:{kind:fixture.ownerKind,documentId:fixture.ownerId},blockId:fixture.blockId};
 const other={...scope,owner:{...scope.owner,documentId:fixture.otherOwnerId}};
 const era={...scope,eraId:fixture.otherEraId};
 const OPEN='wh_local_tool_block_open',READ='wh_local_tool_block_read';
 assert.equal(scope.owner.kind,'codex');
 assert.notEqual(scope.owner.documentId,other.owner.documentId);
 assert(typeof era.eraId==='string'&&era.eraId.length>0,'Fixture must supply a real unmounted named era');
 const catalogue=async session=>{
  const prior=replies.length,response=await session.rpc('tools/list',{});
  assert(!response.error);
  assert.equal(replies.length,prior);
  const matches=response.result.tools.filter(tool=>tool.name===OPEN);
  assert.equal(matches.length,1);
  const tool=matches[0],schema=tool.inputSchema;
  assert.equal(schema.type,'object');
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual([...schema.required].sort(),['blockId','owner','projectId']);
  assert.deepEqual(Object.keys(schema.properties).sort(),['blockId','eraId','owner','projectId']);
  const owner=schema.properties.owner;
  assert.equal(owner.type,'object');
  assert.equal(owner.additionalProperties,false);
  assert.deepEqual([...owner.required].sort(),['documentId','kind']);
  assert.deepEqual([...owner.properties.kind.enum].sort(),['codex','writings']);
  return tool;
 };
 const advertisedA=await catalogue(a),advertisedB=await catalogue(b);
 assert.deepEqual(advertisedA,advertisedB);
 // Stdio may fall back to its compiled catalogue. Require live server publication too.
 const prior=replies.length,live=await fetch('http://127.0.0.1:'+port+'/api/tools',{
  headers:{Authorization:'Bearer '+keys[0].token},signal:AbortSignal.timeout(5000),
 });
 assert.equal(live.status,200);
 const published=(await live.json()).tools.filter(tool=>tool.name===OPEN);
 assert.equal(published.length,1);
 assert.deepEqual(published[0].schema,advertisedA.inputSchema);
 assert.equal(replies.length,prior);
 save('owned-catalogue.json',{a:advertisedA,b:advertisedB,live:published[0]});

 const open=async(session,scope,available,applied)=>{
  const {_undo,...result}=await ok(session,OPEN,scope);
  assert.deepEqual(result,{available,applied});
 };
 const tabs=session=>ok(session,'wh_workspace_tabs',{projectId:scope.projectId});
 const read=(session,scope)=>ok(session,READ,scope);
 const before=await renderer('__focusNativeOwnedSnapshot');
 assert(before.namedEraIds.includes(era.eraId));
 const inline=await renderer('__focusNativeOwnedObserve',{phase:'initial'});
 const beforeTabs=await tabs(a),beforeOwner=await read(a,scope),beforeOther=await read(b,other),eraOwner=await read(b,era);
 assert.deepEqual(beforeTabs.tabs,[],'Private fixture must start without persisted companions');
 assert.equal(beforeTabs.activeTabId,null);
 assert.equal(beforeTabs.reopenableClosedTabs,0);
 assert.deepEqual(beforeOwner.owner,scope.owner);
 assert.deepEqual(beforeOther.owner,other.owner);
 assert.deepEqual(eraOwner.owner,scope.owner);
 assert.equal(eraOwner.envelope.id,scope.blockId);
 assert.equal(eraOwner.envelope.scope,'host');
 assert.equal(beforeOwner.envelope.id,scope.blockId);
 assert.equal(beforeOther.envelope.id,scope.blockId);
 assert.equal(beforeOwner.envelope.scope,'host');
 assert.equal(beforeOther.envelope.scope,'host');

 await open(a,scope,true,true);
 const opened=await renderer('__focusNativeOwnedObserve',{phase:'open'});
 const firstTabs=await tabs(b);
 assert.deepEqual(firstTabs,beforeTabs,'Opening persisted an ephemeral Owned pane');
 await open(b,scope,true,true);
 const dedup=await renderer('__focusNativeOwnedObserve',{phase:'open',paneId:opened.paneId});
 const secondTabs=await tabs(a);
 assert.deepEqual(secondTabs,beforeTabs,'Selecting the same Owned pane persisted a tab');

 await open(b,other,false,false);
 await open(a,era,false,false);
 const negative=await renderer('__focusNativeOwnedObserve',{phase:'open',paneId:opened.paneId});
 assert.deepEqual(await tabs(b),beforeTabs,'Wrong owner or era changed stored tabs');
 assert.deepEqual(await renderer('__focusNativeOwnedSnapshot'),before);

 await renderer('__focusNativeOwnedRetire');
 const retired=await renderer('__focusNativeOwnedObserve',{phase:'retired',paneId:opened.paneId});
 assert.equal(retired.panelCount,0,'Retired pane still rendered a live block');
 const retiredTabs=await tabs(a);
 assert.deepEqual(retiredTabs,beforeTabs,'Retiring the owner persisted its ephemeral pane');
 await open(b,scope,false,false);
 assert.deepEqual(await tabs(a),beforeTabs,'A stale open changed stored tabs');
 assert.deepEqual(await read(b,scope),beforeOwner);
 assert.deepEqual(await read(a,other),beforeOther);
 const after=await renderer('__focusNativeOwnedSnapshot');
 assert.deepEqual(after,before);
 save('owned-panel-observations.json',{before,inline,beforeTabs,beforeOwner,beforeOther,eraOwner,opened,firstTabs,dedup,secondTabs,negative,retired,retiredTabs,after});
 checks.push({label:'Two authenticated keys opened one exact Owned pane; another owner or era and the retired owner stayed unavailable; durable data and stored tabs unchanged'});
}
async function driveSourceDerived({a,b,ok,call,renderer,fixture}){
 const {projectId,namespace,documentId,controlId,eraId}=fixture;
 const base={projectId,namespace},target={...base,documentId},control={...base,documentId:controlId},era={...target,eraId};
 const DESCRIBE='wh_local_tool_describe',READ='wh_local_tool_read',CALL='wh_local_tool_call',INDEX='wh_local_tool_document_query',UNDO='wh_local_tool_state_undo';
 const catalogue=async session=>{
  const prior=replies.length,response=await session.rpc('tools/list',{});
  assert(!response.error);
  assert.equal(replies.length,prior);
  const tools=[DESCRIBE,READ,CALL,INDEX,UNDO].map(name=>{
   const found=response.result.tools.filter(tool=>tool.name===name);
   assert.equal(found.length,1);
   return found[0];
  });
  return tools;
 };
 const catalogueA=await catalogue(a),catalogueB=await catalogue(b);
 assert.deepEqual(catalogueB,catalogueA);
 const description=await ok(a,DESCRIBE,base);
 assert.deepEqual(await ok(b,DESCRIBE,base),description);
 assert.equal(description.namespace,'examples.derived-quest');
 assert.equal(description.engineId,'local-tool-examples.derived-quest');
 assert.equal(description.contentHash,null);
 assert(!Object.hasOwn(description,'stateFields'));
 assert.deepEqual(description.codec,{version:1,fields:{title:{kind:'scalar'},score:{kind:'scalar'},ready:{kind:'scalar'},objectives:{kind:'list',idKey:'id'},rewards:{kind:'map'},briefing:{kind:'prose'}}});
 assert.deepEqual(description.index,{version:1,fields:{title:{path:'$.title',type:'string'},score:{path:'$.score',type:'number'},ready:{path:'$.ready',type:'boolean'}}});
 const stringId={type:'string',minLength:1},itemSchema={type:'object',properties:{id:stringId,text:{type:'string',minLength:1,maxLength:200},done:{type:'boolean'}},required:['id','text','done'],additionalProperties:false};
 const inputs={
  set_title:{value:{type:'string',maxLength:100}},
  set_score:{value:{type:'integer',minimum:0}},
  set_ready:{value:{type:'boolean'}},
  add_objectives_item:{item:itemSchema,afterId:{type:['string','null'],minLength:1}},
  update_objectives_item:{id:stringId,item:itemSchema},
  remove_objectives_item:{id:stringId},
  set_rewards_key:{key:stringId,value:{type:'number',minimum:0}},
  remove_rewards_key:{key:stringId},
 };
 assert.deepEqual(description.operations.map(op=>op.id).sort(),Object.keys(inputs).sort());
 for(const {id,description:labels,writes,inputSchema} of description.operations){
  assert.equal(writes,true);
  assert(typeof labels.en==='string'&&labels.en.trim()&&typeof labels.es==='string'&&labels.es.trim());
  assert.equal(inputSchema.type,'object');
  assert.equal(inputSchema.additionalProperties,false);
  const {expectedRevision,expectedDocumentVersion,...fields}=inputSchema.properties;
  assert.deepEqual(expectedRevision,{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER});
  assert.deepEqual(expectedDocumentVersion,stringId);
  assert.deepEqual(fields,inputs[id]);
  assert.deepEqual([...inputSchema.required].sort(),Object.keys(inputSchema.properties).sort());
 }
 save('derived-catalogue.json',{catalogueA,catalogueB,description});
 const read=(session,scope=target)=>ok(session,READ,scope);
 const baseline=snapshot=>({expectedRevision:snapshot.revision,expectedDocumentVersion:snapshot.document.version});
 const clean=({_undo,...value})=>value;
 const callInput=(operation,input)=>({...target,operation,input});
 const run=async(session,operation,input)=>clean(await ok(session,CALL,callInput(operation,input)));
 const query=async(session,scope,score)=>{
  const {documents}=await ok(session,INDEX,{...scope,where:{score:{eq:score}}});
  assert.equal(documents.length,1);
  return documents[0];
 };
 const before=await read(a),sibling=await read(b,control),variant=await read(a,era);
 const persistedControls=await renderer('__focusNativeDerivedControls');
 assert.equal(before.document.id,documentId);
 assert.equal(before.document.namespace,namespace);
 assert.equal(before.provenance,'base');
 assert.equal(before.data.score,0);
 assert.deepEqual(before.data.objectives,[]);
 assert.equal(sibling.document.id,controlId);
 assert.equal(sibling.data.score,3);
 assert.equal(variant.document.id,documentId);
 assert.equal(variant.provenance,'variant');
 assert.equal(variant.data.score,19);
 const assertIndex=(row,snapshot)=>{
  assert.equal(row.id,snapshot.document.id);
  assert.equal(row.namespace,namespace);
  assert.equal(row.provenance,snapshot.provenance);
  assert.deepEqual(row.fields,{title:snapshot.data.title,score:snapshot.data.score,ready:snapshot.data.ready});
  assert.deepEqual(row.refs,[]);
 };
 const indexBefore=await query(b,base,0);
 assertIndex(indexBefore,before);
 const domBefore=await renderer('__focusNativeDerivedObserve',{title:before.data.title,score:0,objectives:[]});
 const identity=({revision,updatedAt,data,document:{version,...document},...rest})=>({document,...rest});
 const receipt=(result,current,previous,expected)=>{
  assert.deepEqual(Object.keys(result).sort(),['documentVersion','receiptId','revision']);
  assert(typeof result.receiptId==='string'&&result.receiptId.startsWith('local-state-'));
  assert.equal(result.revision,previous.revision+1);
  assert.equal(result.revision,current.revision);
  assert.equal(result.documentVersion,current.document.version);
  assert.notEqual(current.document.version,previous.document.version);
  assert.deepEqual(identity(current),identity(previous));
  assert.deepEqual(current.data,expected);
 };
 const scored=await run(a,'set_score',{...baseline(before),value:31}),afterScore=await read(b);
 receipt(scored,afterScore,before,{...before.data,score:31});
 const objective={id:'native-derived-objective',text:'Trace the source Ω',done:false};
 const added=await run(b,'add_objectives_item',{...baseline(afterScore),item:objective,afterId:null}),afterAdd=await read(a);
 receipt(added,afterAdd,afterScore,{...afterScore.data,objectives:[objective]});
 assert.notEqual(scored.receiptId,added.receiptId);
 const indexWritten=await query(b,base,31);
 assertIndex(indexWritten,afterAdd);
 const domWritten=await renderer('__focusNativeDerivedObserve',{title:before.data.title,score:31,objectives:[objective]});

 const staleRevision=await call(b,CALL,callInput('set_score',{...baseline(afterAdd),expectedRevision:before.revision,value:73}));
 const staleVersion=await call(a,CALL,callInput('set_score',{...baseline(afterAdd),expectedDocumentVersion:before.document.version,value:74}));
 for(const failure of [staleRevision,staleVersion]){
  assert.equal(failure.isError,true);
  assert.deepEqual(failure.value,{code:'tool-error',error:'conflict'});
 }
 assert.deepEqual(await read(b),afterAdd);

 const undone=clean(await ok(a,UNDO,{...target,receiptId:added.receiptId}));
 const afterUndo=await read(b);
 assert.deepEqual(undone.snapshot,afterUndo);
 assert(typeof undone.receiptId==='string'&&undone.receiptId.startsWith('local-state-'));
 assert.notEqual(undone.receiptId,added.receiptId);
 assert.equal(afterUndo.revision,afterAdd.revision+1);
 assert.notEqual(afterUndo.document.version,afterAdd.document.version);
 assert.deepEqual(identity(afterUndo),identity(before));
 assert.deepEqual(afterUndo.data,afterScore.data);
 const domUndone=await renderer('__focusNativeDerivedObserve',{title:before.data.title,score:31,objectives:[]});
 assert.deepEqual(await read(a,control),sibling);
 assert.deepEqual(await read(b,era),variant);
 const indexUndo=await query(a,base,31);
 assertIndex(indexUndo,afterUndo);
 assert.deepEqual(await renderer('__focusNativeDerivedControls'),persistedControls);
 save('derived-observations.json',{before,sibling,variant,persistedControls,domBefore,indexBefore,scored,afterScore,objective,added,afterAdd,indexWritten,domWritten,staleRevision,staleVersion,undone,afterUndo,indexUndo,domUndone});
 checks.push({label:'Two keys used exact revisions and versions on one derived Source, indexed its scalar edit, rejected two stale baselines, and reversed the list receipt without changing the sibling or named-era variant'});
}
async function driveRuntimeCatalogue({a,b,ok,call,renderer,fixture}){
 const namespace='qa.package-quest2639',projectId=fixture.projectId,engineId='local-tool-'+namespace,scope={projectId,namespace};
 const file=(label,environment,expectedSha,contentHash)=>{
  const filename=process.env[environment];
  assert(typeof filename==='string'&&path.isAbsolute(filename),'Exact fixture path required: '+environment);
  const bytes=fs.readFileSync(filename),fileSha256=packageSha(bytes);
  assert.equal(fileSha256,expectedSha);
  const packet=JSON.parse(bytes.toString('utf8'));
  assert.equal(packet.manifest.namespace,namespace);
  assert.equal(packet.manifest.contentHash,contentHash);
  const catalogue=JSON.parse(Buffer.from(packet.files['metadata/derived-agent-catalogue.json'],'base64').toString('utf8'));
  return {file:{name:label+'.whpackage.json',mime:'application/json',base64:bytes.toString('base64')},fileSha256,bytes:bytes.length,contentHash,catalogue};
 };
 const good=file('good','WH_NATIVE_CATALOGUE_GOOD','86b84bab388d85ec275d66a379f74f64ee6a40d498f30ee1eaa13afff9f47632','b4f952ccdb61fc223a3af47a8d6fa1ebe62ed29e2eed24fb82e9b95d663ee09d');
 const mismatch=file('mismatch','WH_NATIVE_CATALOGUE_MISMATCH','b16a89c79f4810f7c7301a3aa5b8e2afdf8393ba00fd6d24d620f2bb2ba2df67','bd4408edc8ba59c0ed540571802bb131dd41af749ebb20eef3693367435eb19c');
 const inspect='wh_local_package_inspect',install='wh_local_package_install',inventory='wh_local_package_list',list='wh_local_tool_list';
 const describe='wh_local_tool_describe',pinTool='wh_local_tool_pin',create='wh_local_tool_document_create',read='wh_local_tool_read',invoke='wh_local_tool_call',query='wh_local_tool_document_query';
 const catalogue=async session=>{
  const prior=replies.length,response=await session.rpc('tools/list',{});
  assert(!response.error);
  assert.equal(replies.length,prior);
  return [inspect,install,inventory,list,describe,pinTool,create,read,invoke,query,'wh_enable_engine'].map(name=>{
   const matches=response.result.tools.filter(tool=>tool.name===name);
   assert.equal(matches.length,1);
   return matches[0];
  });
 };
 const aTools=await catalogue(a),bTools=await catalogue(b);
 assert.deepEqual(aTools,bTools);
 const getInventory=session=>ok(session,inventory,{namespace});
 const getTool=async session=>(await ok(session,list,{projectId})).tools.filter(tool=>tool.namespace===namespace);
 const snapshot=()=>renderer('__focusNativeCatalogueSnapshot');
 const clean=({_undo,...value})=>value;
 const before=await snapshot();
 assert.deepEqual(before.registry,{engine:false,hashes:[]});
 assert.deepEqual(await getInventory(a),{packages:[]});
 assert.deepEqual(await getTool(b),[]);
 const ids=['add_items_item','remove_items_item','remove_tags_key','set_active','set_count','set_tags_key','set_title','update_items_item'];
 const fields={active:{path:'$.active',type:'boolean'},count:{path:'$.count',type:'number'},title:{path:'$.title',type:'string'}};
 const inspected=[];
 for(const [session,packet,documentBacked] of [[a,good,true],[b,mismatch,false]]){
  const summary=await ok(session,inspect,{file:packet.file});
  assert.equal(summary.installed,false);
  assert.equal(summary.fileSha256,packet.fileSha256);
  assert.equal(summary.bytes,packet.bytes);
  assert.equal(summary.manifest.contentHash,packet.contentHash);
  assert.deepEqual(summary.catalogue,packet.catalogue);
  const [tool]=summary.catalogue.tools;
  assert.equal(summary.catalogue.tools.length,1);
  assert.equal(tool.namespace,namespace);
  assert.equal(tool.documentBacked,documentBacked);
  assert.deepEqual(tool.operations.map(op=>op.id).sort(),ids);
  assert(tool.operations.every(op=>op.writes&&op.inputSchema.additionalProperties===false&&op.inputSchema.required.includes('expectedRevision')&&op.inputSchema.required.includes('expectedDocumentVersion')===documentBacked));
  assert.deepEqual(tool.index,{version:1,fields});
  assert.deepEqual(await snapshot(),before);
  inspected.push(summary);
 }
 assert.deepEqual(await getInventory(b),{packages:[]});
 const rejected=await call(b,install,{file:mismatch.file});
 assert.equal(rejected.isError,true);
 assert.deepEqual(rejected.value,{code:'bad-args',error:'local_runtime_package_prepare: local_runtime_package_catalogue_mismatch'});
 assert.deepEqual(await snapshot(),before);
 assert.deepEqual(await getInventory(a),{packages:[]});
 assert.deepEqual(await getTool(b),[]);

 const installed=clean(await ok(a,install,{file:good.file}));
 assert.equal(installed.installed,true);
 assert.equal(installed.alreadyInstalled,false);
 assert.equal(installed.rebuildRequired,false);
 assert.equal(installed.fileSha256,good.fileSha256);
 assert.equal(installed.manifest.contentHash,good.contentHash);
 assert.deepEqual(installed.catalogue,good.catalogue);
 assert.deepEqual(installed.members,[{namespace,contentHash:good.contentHash,kind:'tool',available:true}]);
 const inventoryGood=await getInventory(b);
 assert.equal(inventoryGood.packages.length,1);
 assert.equal(inventoryGood.packages[0].manifest.contentHash,good.contentHash);
 assert.equal(inventoryGood.packages[0].fileSha256,good.fileSha256);
 assert.equal(inventoryGood.packages[0].status,'available');
 const [unselected]=await getTool(b);
 assert(unselected&&unselected.enabled===false&&unselected.pin===null);
 assert.deepEqual((await snapshot()).registry,{engine:true,hashes:[good.contentHash]});

 const enabled=clean(await ok(a,'wh_enable_engine',{projectId,engineId}));
 assert.equal(enabled.engineId,engineId);
 assert(enabled.enabledEngines.includes(engineId));
 const pinned=clean(await ok(b,pinTool,{...scope,contentHash:good.contentHash,expectedRevision:null}));
 assert.equal(pinned.namespace,namespace);
 assert.equal(pinned.pin.contentHash,good.contentHash);
 assert.equal(pinned.pin.revision,1);
 const [selected]=await getTool(a);
 assert.equal(selected.enabled,true);
 assert.deepEqual(selected.pin,pinned.pin);
 assert.deepEqual(selected.operations.map(op=>op.id).sort(),ids);
 const described=await ok(a,describe,scope);
 assert.equal(described.contentHash,good.contentHash);
 assert(described.document);
 assert.deepEqual(described.index,{version:1,fields});
 assert.deepEqual([...described.operations].sort((x,y)=>x.id.localeCompare(y.id)),[...good.catalogue.tools[0].operations].sort((x,y)=>x.id.localeCompare(y.id)));

 const document=clean(await ok(a,create,{...scope,title:'Native package quest'}));
 const exact={...scope,documentId:document.id};
 const baseline=await ok(b,read,exact);
 assert.equal(baseline.document.id,document.id);
 assert.deepEqual(baseline.data,{title:'Synthetic quest',count:0,active:true,items:[],tags:{},notes:'QA Ω'});
 const written=clean(await ok(b,invoke,{...exact,operation:'set_count',input:{expectedRevision:baseline.revision,expectedDocumentVersion:baseline.document.version,value:9}}));
 const after=await ok(a,read,exact);
 assert.equal(after.revision,baseline.revision+1);
 assert.equal(written.revision,after.revision);
 assert.equal(written.documentVersion,after.document.version);
 assert.notEqual(after.document.version,baseline.document.version);
 assert(typeof written.receiptId==='string'&&written.receiptId.startsWith('local-state-'));
 assert.deepEqual(after.data,{...baseline.data,count:9});
 const indexed=await ok(b,query,{...scope,where:{count:{eq:9}}});
 assert.equal(indexed.documents.length,1);
 assert.equal(indexed.documents[0].id,document.id);
 assert.deepEqual(indexed.documents[0].fields,{title:'Synthetic quest',count:9,active:true});
 save('runtime-catalogue-observations.json',{aTools,bTools,before,inspected,rejected,installed,inventoryGood,unselected,enabled,pinned,selected,described,document,baseline,written,after,indexed});
 checks.push({label:'Data-only inspection, exact mismatch rejection, explicit runtime pin and one derived operation on a real Source document'});
}
process.argv[2]='tests/local-tool-focus.native.renderer.ts';
process.argv[3]=sourceCatalogue?'testLocalToolRuntimeCatalogueNative':sourceDerived?'testLocalToolSourceDerivedNative':sourceOwned?'testLocalToolSourceOwnedNative':sourcePushed?'testLocalToolSourcePushedNative':sourceProvider?'testLocalToolSourceProviderNative':sourceCommand?'testLocalToolSourceCommandNative':sourceBlock?'testLocalToolSourceBlockNative':'testLocalToolFocusNative';
harness.main({preloadFile,setup,window:async win=>{window=win;bridge.setBridgeWindowResolver(()=>win);win.webContents.once('did-finish-load',()=>{driver=drive(win).catch(async error=>{failure=error.stack||String(error);console.error(failure);await win.webContents.executeJavaScript(`window.__focusNativeFinish?.(${JSON.stringify({ok:false,error:failure})});0`).catch(()=>{});});});},close:async()=>{
 await driver;
 if(failure)throw Error(failure);
 if(sourceCatalogue){
  const cleanup=await window.webContents.executeJavaScript('window.__focusNativeCatalogueCleanupReceipt');
  assert.equal(cleanup.allTablesEmpty,true);
  assert.equal(cleanup.pendingExact,true);
  assert.equal(Object.keys(cleanup.tableCounts).length,89);
  assert(Object.values(cleanup.tableCounts).every(count=>count===0));
  save('cleanup.json',cleanup);
 }else if(sourceOwned){
  const cleanup=await window.webContents.executeJavaScript('window.__focusNativeOwnedCleanupReceipt');
  assert.deepEqual(cleanup,{projects:0,ownedInline:0,ownedPanels:0,unavailablePanels:0,pendingExact:true});
  save('cleanup.json',cleanup);
 }else if(sourceScenario){
  const cleanup=await window.webContents.executeJavaScript('window.__focusNativeBlockCleanupReceipt');
  assert.deepEqual(cleanup,{projects:0,sourceHosts:0,pendingExact:true});
  save('cleanup.json',cleanup);
 }
 await close();
}}).catch(async error=>{failure=error.stack||String(error);console.error(failure);try{await close();}finally{app.exit(1);}});
