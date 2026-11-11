// Uses the existing CSS runner, plus the real two-key stdio/HTTP/executor/IPC pipeline.
const {app,ipcMain}=require('electron'),{build}=require('esbuild');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process'),{createInterface}=require('node:readline');
const harness=require('../scripts/run-codex-properties-ui.cjs'),root=path.resolve(__dirname,'..'),directory=harness.directory;
process.env.HOARD_EVENTS='0';
const sourceBlock=process.env.WH_NATIVE_SOURCE_BLOCK_FOCUS==='1';
const revocations=[];
const evidence=path.join(root,'_stage/parity-completion-next/sdk-platform',(sourceBlock?'source-block-native-':'native-')+Date.now()+'-'+process.pid);fs.mkdirSync(evidence,{recursive:true});
const preloadFile=path.join(directory,'focus-preload.cjs'),adapterFile=path.join(directory,'focus-stdio.cjs');
// QuickNote is unrelated to focus; this fixture does not capture/relay notes or start its window.
fs.writeFileSync(preloadFile,"const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{platform:process.platform,quickNote:{setContext:()=>{},onCapture:()=>()=>{},onOpenInline:()=>()=>{},ack:()=>{}},aiBridge:{onRequest:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});");
let bridge,window,port,keys,driver,closing=false,toolCalls=0,rpcCalls=0,failure,sourceHostMounted=false,serverStarted=false;
const sessions=[],replies=[],transcript=[],checks=[],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const save=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+'\n');
async function bounded(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]);}finally{clearTimeout(timer);}}
async function close(){
 if(closing)return;closing=true;const errors=[];
 if(sourceBlock&&bridge){
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
 const result={...(sourceBlock?{scenario:'source-block-open',revocations}:{}),ok:!failure&&errors.length===0,toolCalls,rpcCalls,ipcReplies:replies.length,sessions:sessions.map(item=>item.report()),checks,errors,failure,sourceHostMounted,profileRetained:true,privateProfile:directory,serverNeverStarted:!serverStarted,serverClosed:serverStarted&&errors.length===0};save('RESULT.json',result);save('mcp-transcript.json',transcript);save('ipc-replies.json',replies);
 console.log('FOCUS_NATIVE_EVIDENCE '+evidence);console.log('FOCUS_NATIVE_PRIVATE_TEMP '+directory);console.log('FOCUS_NATIVE_RESULT '+JSON.stringify(result));assert.equal(errors.length,0,errors.join('\n'));
}
async function adapter(token,label){
 const child=spawn(process.execPath,[adapterFile],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',WH_BRIDGE_TOKEN:token,WH_BRIDGE_TOKEN_FILE:'',WH_BRIDGE_URL:`http://127.0.0.1:${port}`,WH_PUBLISHING_MODULE:'',WH_MCP_NO_AUTOSTART:'0',HOARD_EVENTS:'0'}});
 const waiting=new Map();let next=0,stderr='',ended=false,actualExit=null;child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
 const exit=new Promise(resolve=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',error=>resolve({error:String(error)}));});
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{const value=JSON.parse(line),pending=waiting.get(value.id);assert(pending,'Unexpected stdio reply');clearTimeout(pending.timer);waiting.delete(value.id);pending.resolve(value);}catch(error){failure=String(error);for(const pending of waiting.values())pending.reject(error);waiting.clear();}});
 child.once('close',()=>{for(const pending of waiting.values()){clearTimeout(pending.timer);pending.reject(Error('Focus stdio closed before reply'));}waiting.clear();});
 const session={rpc:(method,params)=>new Promise((resolve,reject)=>{rpcCalls++;const id=++next,timer=setTimeout(()=>{waiting.delete(id);reject(Error('Focus RPC deadline'));},20000);waiting.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}),close:async()=>{if(ended)return;ended=true;child.stdin.end();try{actualExit=await bounded(exit,5000,'Focus stdio EOF deadline');}catch(error){if(sourceBlock)throw error;child.kill();actualExit=await bounded(exit,3000,'Focus child close deadline');throw error;}finally{lines.close();fs.writeFileSync(path.join(evidence,label+'.stderr.log'),stderr);}assert.deepEqual(actualExit,{code:0,signal:null});},report:()=>({label,exit:actualExit,pending:waiting.size,stderrBytes:Buffer.byteLength(stderr)})};sessions.push(session);
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
 assert.equal(fixture.sourceHostMounted,true);sourceHostMounted=true;save('fixture.json',fixture);const base={projectId:fixture.projectId},GET='wh_workspace_focus_get',SET='wh_workspace_focus_set';
 await bridge.startAiBridge({version:'private-focus-native',hasWindow:()=>true});serverStarted=true;const a=await adapter(keys[0].token,'A'),b=await adapter(keys[1].token,'B');
 async function call(session,name,args,relayed=true){const prior=replies.length,response=await session.rpc('tools/call',{name,arguments:args});toolCalls++;assert(!response.error);assert.equal(replies.length-prior,relayed?1:0);assert.equal(response.result.content.length,1);assert.equal(response.result.content[0].type,'text');const outcome={isError:response.result.isError===true,value:JSON.parse(response.result.content[0].text)};transcript.push({session:session.report().label,name,args,outcome,ipcReplies:replies.length-prior});return outcome;}
 async function ok(session,name,args){const result=await call(session,name,args);assert.equal(result.isError,false,JSON.stringify(result.value));return result.value;}
 if(sourceBlock){
  await driveSourceBlock({a,b,ok,renderer,fixture});
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
process.argv[2]='tests/local-tool-focus.native.renderer.ts';
process.argv[3]=sourceBlock?'testLocalToolSourceBlockNative':'testLocalToolFocusNative';
harness.main({preloadFile,setup,window:async win=>{window=win;bridge.setBridgeWindowResolver(()=>win);win.webContents.once('did-finish-load',()=>{driver=drive(win).catch(async error=>{failure=error.stack||String(error);console.error(failure);await win.webContents.executeJavaScript(`window.__focusNativeFinish?.(${JSON.stringify({ok:false,error:failure})});0`).catch(()=>{});});});},close:async()=>{
 await driver;
 if(failure)throw Error(failure);
 if(sourceBlock){
  const cleanup=await window.webContents.executeJavaScript('window.__focusNativeBlockCleanupReceipt');
  assert.deepEqual(cleanup,{projects:0,sourceHosts:0,pendingExact:true});
  save('cleanup.json',cleanup);
 }
 await close();
}}).catch(async error=>{failure=error.stack||String(error);console.error(failure);try{await close();}finally{app.exit(1);}});
