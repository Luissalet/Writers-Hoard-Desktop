// Two actual MCP stdio keys -> private normal Mainbridge HTTP -> Native executor -> IPC -> real Vite renderer.
// Prepared own app Host/Surface transport. No synthetic tool response or parallel state writer.
const { app, BrowserWindow, ipcMain } = require('electron'), { build } = require('esbuild');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process'), { createInterface } = require('node:readline');
const root=path.resolve(__dirname,'..'),label=process.argv[2];if(!/^[a-z][a-z0-9-]{0,63}$/.test(label||''))throw Error('Fresh own Native label required');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-local-app-native-'+label+'-'));
app.setPath('userData', path.join(directory, 'profile')); app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.HOARD_EVENTS = '0';
const evidence = path.join(directory, 'evidence'); fs.mkdirSync(evidence, { recursive: true });
const preloadFile = path.join(directory, 'preload.cjs'), adapterFile = path.join(directory, 'stdio.cjs');
// Complete imperative shape for this surface; QuickNote is explicit inert and opens no window.
fs.writeFileSync(preloadFile, "const{contextBridge,ipcRenderer}=require('electron');const api={platform:process.platform};api.quickNote={setContext:()=>{},onCapture:()=>()=>{},onOpenInline:()=>()=>{},ack:()=>{}};api.aiBridge={onRequest:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)};contextBridge.exposeInMainWorld('electronAPI',api);");
let bridge, win, port, keys = [], driver, failure, closing = false, serverStarted = false, serverClosed = false, toolCalls = 0, rpcCalls = 0;
const sessions = [], replies = [], transcript = [], checks = [];
const crypto=require('node:crypto');let cleanupReport,rendererCleanup=false;const blocked=[],revocations=[];
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(row=>{const file=path.join(dir,row.name);return row.isDirectory()?walk(file):[file];});
const collectPaths=()=>[...walk(path.join(root,'src')),...walk(path.join(root,'electron')),...['package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json'].map(name=>path.join(root,name)),...['local-app-host.author.tsx','local-app-host.fixture.tsx','local-app-host.native.renderer.tsx','local-app-host.native.html','local-app-host.native.cjs','local-app-host.native.run.cjs'].map(name=>path.join(root,'tests',name))].sort();
const sourcePaths=collectPaths();
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),inputs=sourcePaths.map(file=>({path:path.relative(root,file).replaceAll('\\','/'),sha256:sha(file)}));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scrub = value => { let text = String(value); for (const key of keys) if (key.token) text = text.split(key.token).join('[REDACTED]'); return text; };
const save = (name, value) => fs.writeFileSync(path.join(evidence, name), scrub(JSON.stringify(value, null, 2)) + '\n');
save('INPUTS.json',inputs);
async function bounded(promise, ms, label) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); })]); } finally { clearTimeout(timer); } }
async function close() {
 if(closing)return;closing=true;const errors=[];
 if(win&&!win.isDestroyed()&&!rendererCleanup)try{const available=await win.webContents.executeJavaScript('typeof window.__sdkNativeCleanup==="function"');if(available){cleanupReport=await win.webContents.executeJavaScript('window.__sdkNativeCleanup()');rendererCleanup=true;}}catch(error){errors.push('Renderer cleanup: '+scrub(error));}
 for(const session of sessions)try{await session.close();}catch(error){errors.push(scrub(error));}
 if(bridge){for(const key of keys)try{const revoked=await bridge.bridgeKeys.revoke(key.key.id);assert.equal(revoked.ok,true);if(!serverStarted){revocations.push({id:key.key.id,revoked:true,httpVerified:false});continue;}const prior=replies.length,response=await fetch(`http://127.0.0.1:${port}/api/call`,{method:'POST',headers:{Authorization:'Bearer '+key.token,'Content-Type':'application/json'},body:JSON.stringify({tool:'wh_local_app_list',args:{}}),signal:AbortSignal.timeout(5000)});assert.equal(response.status,401);assert.equal(replies.length,prior);revocations.push({id:key.key.id,revoked:true,httpStatus:response.status,noNewIPC:replies.length===prior});}catch(error){errors.push('Revoke: '+scrub(error));}}
 if(bridge)bridge.stopAiBridge();
 if(serverStarted){for(let i=0;i<100&&!serverClosed;i++){serverClosed=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',error=>resolve(error.code==='ECONNREFUSED'));});if(!serverClosed)await sleep(20);}if(!serverClosed)errors.push('Private Mainbridge remains open');}
 ipcMain.removeHandler('aibridge:reply');if(bridge)bridge.setBridgeWindowResolver(()=>null);
 if(win&&!win.isDestroyed())win.destroy();
 const after=inputs.map(input=>({...input,afterSha256:fs.existsSync(path.join(root,input.path))?sha(path.join(root,input.path)):null})),sourceUnchanged=after.every(row=>row.sha256===row.afterSha256)&&JSON.stringify(collectPaths())===JSON.stringify(sourcePaths);if(!sourceUnchanged)errors.push('Source changed during Native run');if(blocked.length)errors.push('Unexpected external requests');
 if(cleanupReport&&!cleanupReport.allTablesEmpty)errors.push('Native private all-table cleanup incomplete');
 save('SOURCE-AFTER.json',after);save('cleanup.json',cleanupReport??null);save('mcp-transcript.json',transcript);save('ipc-replies.json',replies);
 const result={ok:!failure&&errors.length===0,toolCalls,rpcCalls,ipcReplies:replies.length,sessions:sessions.map(session=>session.report()),checks,sourceUnchanged,inputCount:inputs.length,cleanup:cleanupReport,serverStarted,serverClosed,windowDestroyed:!!win&&win.isDestroyed(),revocations,blocked,privateProfile:directory,errors,failure:failure&&scrub(failure),attribution:'Two real MCP stdio keys/Native executor/IPC, private renderer on existing Vite63395. No Brave/downloaded file/global parity claim.'};
 save('RESULT.json',result);console.log('LOCAL_APP_NATIVE_EVIDENCE '+evidence);console.log('LOCAL_APP_NATIVE_RESULT '+JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
async function adapter(token, label) {
  const child = spawn(process.execPath, [adapterFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: token, WH_BRIDGE_TOKEN_FILE: '', WH_BRIDGE_URL: `http://127.0.0.1:${port}`, WH_BRIDGE_GROUPS: '', WH_PUBLISHING_MODULE: '', WH_MCP_NO_AUTOSTART: '0', HOARD_EVENTS: '0' } });
  const waiting = new Map(); let sequence = 0, stderr = '', ended = false, actualExit = null;
  const exit = new Promise(resolve => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', error => resolve({ error: scrub(error) })); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { try { const value = JSON.parse(line), pending = waiting.get(value.id); assert(pending, 'Unexpected stdio reply'); clearTimeout(pending.timer); waiting.delete(value.id); pending.resolve(value); } catch (error) { failure = scrub(error); for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(error); } waiting.clear(); } });
  child.once('close', () => { for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(Error('Local App stdio closed before reply')); } waiting.clear(); });
  const session = {
    rpc: (method, params) => new Promise((resolve, reject) => { rpcCalls++; const id = ++sequence, timer = setTimeout(() => { waiting.delete(id); reject(Error('Local App RPC deadline')); }, 30000); waiting.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }),
    close: async () => { if (ended) return; ended = true; child.stdin.end(); try { actualExit = await bounded(exit, 5000, 'Local App stdio EOF deadline'); } catch (error) { child.kill(); actualExit = await bounded(exit, 3000, 'Local App stdio termination deadline'); throw error; } finally { lines.close(); fs.writeFileSync(path.join(evidence, label + '.stderr.log'), scrub(stderr)); } assert.deepEqual(actualExit, { code: 0, signal: null }); assert.equal(waiting.size,0,'Native stdio pending replies after EOF');assert.equal(Buffer.byteLength(stderr),0,'Native stdio stderr not empty'); },
    report: () => ({ label, exit: actualExit, pending: waiting.size, stderrBytes: Buffer.byteLength(stderr) }),
  };
  sessions.push(session); const initialized = await session.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'local-app-native', version: '1' } }); assert(!initialized.error); assert.equal(initialized.result.serverInfo.name, 'writers-hoard'); return session;
}
async function setup() {
  const reservation = net.createServer(); await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); }); port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); process.env.WH_AIBRIDGE_PORT = String(port);
  const common = { bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, logLevel: 'warning' }, bridgeFile = path.join(directory, 'bridge.cjs');
  await build({ ...common, stdin: { contents: "export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';", resolveDir: root }, external: ['electron'], outfile: bridgeFile });
  await build({ ...common, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], outfile: adapterFile });
  bridge = require(bridgeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true });
  keys = [await bridge.bridgeKeys.create('Local App Native A'), await bridge.bridgeKeys.create('Local App Native B')]; for (const key of keys) assert.equal(key.ok, true); assert(keys[0].key.id !== keys[1].key.id && keys[0].token !== keys[1].token, 'Two distinct real keys required');
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, event.sender.mainFrame); replies.push({ id: payload.id, ok: payload.ok, code: payload.code }); bridge.resolveBridgeReply(payload); });
}
async function drive(){
 let fixture;for(let i=0;i<600&&!fixture;i++){const state=await win.webContents.executeJavaScript('({ready:window.__sdkNativeReady??null,result:window.__result??null})');if(state.result?.ok===false)throw Error(state.result.error);fixture=state.ready;if(!fixture)await sleep(30);}assert(fixture,'Native app renderer readiness');save('fixture.json',fixture);
 const renderer=(name,arg)=>win.webContents.executeJavaScript(`window.${name}(${arg===undefined?'':JSON.stringify(arg)})`),snapshot=()=>renderer('__sdkNativeSnapshot'),status=()=>renderer('__sdkNativeStatus');
 await bridge.startAiBridge({version:'private-local-app-native',hasWindow:()=>true});serverStarted=true;
 const a=await adapter(keys[0].token,'A'),b=await adapter(keys[1].token,'B'),APP='tests.sdk-host-app',WORLD='tests.sdk-world-app';
 const names=['wh_local_app_list','wh_local_app_describe','wh_local_app_set_route','wh_local_app_export'];
 const schemas=new Map(),expectedSchemas={
  wh_local_app_list:{properties:['projectId','eraId'],required:[]},
  wh_local_app_describe:{properties:['projectId','eraId','appId','instanceId'],required:['appId']},
  wh_local_app_set_route:{properties:['projectId','eraId','appId','instanceId','hostId','path','replace'],required:['appId','instanceId','hostId','path']},
  wh_local_app_export:{properties:['projectId','eraId','appId','instanceId','preset','locale','options'],required:['appId','instanceId','preset']},
 };
 for(const session of[a,b]){const listed=await session.rpc('tools/list',{});assert(!listed.error);for(const name of names){const rows=listed.result.tools.filter(tool=>tool.name===name);assert.equal(rows.length,1);assert.equal(rows[0].annotations.readOnlyHint,name!=='wh_local_app_set_route');const schema=rows[0].inputSchema,expected=expectedSchemas[name];assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);assert.deepEqual(Object.keys(schema.properties).sort(),[...expected.properties].sort());assert.deepEqual([...(schema.required??[])].sort(),[...expected.required].sort());if(schemas.has(name))assert.deepEqual(schema,schemas.get(name),'Two stdio keys expose different app schemas');else schemas.set(name,schema);if(name==='wh_local_app_set_route')assert.equal(schema.properties.path.type,'string');if(name==='wh_local_app_export'){assert.deepEqual(schema.properties.preset.enum,['instance-documents','world-wiki']);assert.deepEqual(schema.properties.locale.enum,['en','es']);assert.equal(schema.properties.options.properties.includeImages.type,'boolean');assert.equal(schema.properties.options.properties.includeMedia.type,'boolean');}save('manifest-'+session.report().label+'-'+name+'.json',rows[0]);}}
 async function call(session,name,args,{expected=true,unchanged=true}={}){
  const before=unchanged?await snapshot():undefined,prior=replies.length,response=await session.rpc('tools/call',{name,arguments:args});toolCalls++;assert(!response.error,JSON.stringify(response.error));assert.equal(replies.length-prior,1,'Every scoped app/Source call must cross exactly one real Native IPC');
  const outcome={isError:response.result.isError===true,value:JSON.parse(response.result.content[0].text)};assert.equal(outcome.isError,!expected,JSON.stringify(outcome).slice(0,500));if(unchanged)assert.equal(await snapshot(),before,'Readonly/viewport call changed business data');
  const value=outcome.value;if(typeof value?.html==='string'){const bytes=Buffer.byteLength(value.html),digest=crypto.createHash('sha256').update(value.html).digest('hex');transcript.push({key:session.report().label,name,args,result:{...value,html:undefined,bytes,sha256:digest}});}else transcript.push({key:session.report().label,name,args,outcome});return value;
 }
 const scope={projectId:fixture.projectId,appId:APP,instanceId:fixture.A},other={...scope,instanceId:fixture.B},canonical='children/'+encodeURIComponent('own/α%2F');
 for(const session of[a,b]){const listed=await call(session,'wh_local_app_list',{projectId:fixture.projectId});assert(listed.apps.some(row=>row.id===APP&&row.enabled&&row.instances.some(item=>item.id===fixture.A)));const detail=await call(session,'wh_local_app_describe',scope);assert.equal(detail.descriptor.publishPreset,'instance-documents');assert.equal(detail.hosts.length,1);assert.equal(detail.hosts[0].scope.projectId,fixture.projectId);}
 const first=await call(a,'wh_local_app_describe',scope),peer=await call(b,'wh_local_app_describe',other),hostId=first.hosts[0].hostId,peerId=peer.hosts[0].hostId;
 const moved=await call(a,'wh_local_app_set_route',{...scope,hostId,path:canonical});assert(moved.available&&moved.applied&&moved.path===canonical);
 for(let i=0;i<300;i++){const view=await status();if(view.some(row=>row.hostId===hostId&&row.route===canonical))break;if(i===299)throw Error('Native viewport did not reach actual Host');await sleep(10);}const routed=await status();assert(routed.some(row=>row.hostId===peerId&&row.route===''),'Peer viewport was changed by exact host command');
 const wrong=await call(b,'wh_local_app_set_route',{...scope,eraId:'past',hostId,path:'wrong-era'});assert(!wrong.available&&!wrong.applied);
 for(const eraId of[undefined,'past']){
  const args={...scope,...eraId?{eraId}:{},preset:'instance-documents',locale:'en',options:{includeImages:false,includeMedia:false}},one=await call(a,'wh_local_app_export',args),two=await call(b,'wh_local_app_export',args);
  for(const value of[one,two]){assert.equal(value.mime,'text/html');assert(value.filename.endsWith('.html'));assert(value.html.includes('OWN_ADMITTED_FINAL_TAIL_Élodie_李明'));assert(!value.html.includes(fixture.canonicalTitle));assert(value.fingerprint);}
  assert.equal(one.fingerprint,two.fingerprint);if(!eraId)assert(Buffer.byteLength(one.html)>200000,'Complete export must exceed former compile text truncation threshold');fs.writeFileSync(path.join(evidence,(eraId??'base')+'.html'),one.html);
 }
 const broad=await call(a,'wh_local_app_export',{projectId:fixture.projectId,appId:WORLD,instanceId:fixture.world,preset:'world-wiki',locale:'en'});assert(broad.html.includes(fixture.canonicalTitle));await call(b,'wh_local_app_export',{...scope,preset:'world-wiki'},{expected:false});
 await renderer('__sdkNativeMount','past');const stale=await call(a,'wh_local_app_set_route',{...scope,hostId,path:'must-not-queue'});assert(!stale.available&&!stale.applied);const era=await call(b,'wh_local_app_describe',{...scope,eraId:'past'});assert.equal(era.hosts.length,1);assert.equal(era.hosts[0].scope.eraId,'past');
 const eraMoved=await call(b,'wh_local_app_set_route',{...scope,eraId:'past',hostId:era.hosts[0].hostId,path:'named/own'});assert(eraMoved.available&&eraMoved.applied);await renderer('__sdkNativeMount');const returned=await call(a,'wh_local_app_describe',scope);assert.equal(returned.hosts[0].route.path,'');assert.notEqual(returned.hosts[0].hostId,hostId);
 // Existing Source writer and scoped receipt, used directly through the same two keys.
 const sourceScope={projectId:fixture.projectId,namespace:APP,documentId:fixture.A},before=await call(a,'wh_local_tool_read',sourceScope),controlBefore=await renderer('__sdkNativeControlSnapshot');
 const applied=await call(a,'wh_local_tool_state_apply',{...sourceScope,baseline:before,actions:[{type:'set',field:'motto',value:'Own Native committed motto'}]},{unchanged:false});assert(applied.receiptId);const edited=await call(b,'wh_local_tool_read',sourceScope);assert.equal(edited.data.motto,'Own Native committed motto');await call(b,'wh_local_tool_state_undo',{...sourceScope,receiptId:applied.receiptId},{unchanged:false});const restored=await call(a,'wh_local_tool_read',sourceScope);assert.deepEqual(restored.data,before.data);assert.equal(await renderer('__sdkNativeControlSnapshot'),controlBefore,'Source apply/Undo changed sibling/foreign/named scope');
 checks.push({fourTools:true,twoRealKeys:true,twoRealStdio:true,baseAndNamedScope:true,largeHTML:true,completeMIMEAndFilename:true,sameCaptureFingerprint:true,ownedAdmissionWithWorldPositive:true,exactHostAndNoQueue:true,normalSourceApplyUndoAcrossKeys:true});
 cleanupReport=await renderer('__sdkNativeCleanup');rendererCleanup=true;assert(cleanupReport.allOwnIndexedTablesEmpty);assert(cleanupReport.allTablesEmpty);assert.equal(Object.keys(cleanupReport.tableCounts).length,88);assert(Object.values(cleanupReport.tableCounts).every(value=>value===0));await a.close();await b.close();await win.webContents.executeJavaScript('window.__sdkNativeComplete={ok:true};0');
}
(async()=>{
 await app.whenReady();await setup();win=new BrowserWindow({show:false,width:1440,height:1100,useContentSize:true,webPreferences:{preload:preloadFile,contextIsolation:true,sandbox:true,backgroundThrottling:false}});win.removeMenu();bridge.setBridgeWindowResolver(()=>win);
 win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;try{const url=new URL(details.url);allowed=['data:','blob:','about:','devtools:'].includes(url.protocol)||['http:','ws:'].includes(url.protocol)&&url.hostname==='127.0.0.1'&&url.port==='63395';if(!allowed)blocked.push({origin:url.origin,path:url.pathname});}catch{blocked.push({invalid:true});}callback({cancel:!allowed});});
 win.webContents.on('render-process-gone',(_event,details)=>{failure='Renderer gone '+details.reason;void close().finally(()=>app.exit(1));});
 await win.loadURL(new URL('/tests/local-app-host.native.html','http://127.0.0.1:63395').href);
 driver=drive().catch(async error=>{failure=scrub(error.stack||error);await win.webContents.executeJavaScript(`window.__sdkNativeComplete=${JSON.stringify({ok:false,error:failure})};0`).catch(()=>{});});
 const until=Date.now()+240000;while(Date.now()<until){const result=await win.webContents.executeJavaScript('window.__result??null');if(result){await driver;if(!result.ok)throw Error(result.error);if(failure)throw Error(failure);await close();app.exit(process.exitCode?1:0);return;}await sleep(30);}throw Error('Native app overall deadline');
})().catch(async error=>{failure=scrub(error.stack||error);try{await close();}finally{app.exit(1);}});
