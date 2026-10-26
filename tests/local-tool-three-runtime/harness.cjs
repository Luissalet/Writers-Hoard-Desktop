// Dedicated production-Vite QA driver. It is intentionally outside the default critical suite.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),crypto=require('node:crypto'),os=require('node:os');
const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
const here=__dirname,root=path.resolve(here,'../..'),tempRoot=fs.realpathSync(os.tmpdir());
const FORMAT='wh-local-tool-three-runtime-v1',BUILD_PREFIX='wh-local-tool-three-runtime-build-';
const VITE_CHILD_DEADLINE_MS=900000;
const save=(directory,name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2)+'\n');
const stamp=()=>Date.now()+'-'+process.pid,sha=file=>fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function deadline(work,ms,label){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}}
function ownBuild(candidate){const resolved=fs.realpathSync(path.resolve(candidate));assert(path.dirname(resolved)===tempRoot&&path.basename(resolved).startsWith(BUILD_PREFIX),'Build must be an own Three QA temp directory');assert(fs.statSync(resolved).isDirectory());const metadata=JSON.parse(fs.readFileSync(path.join(resolved,'BUILD.json'),'utf8'));assert.equal(metadata.format,FORMAT);assert.equal(metadata.status,'built');assert.equal(metadata.root,root,'Build belongs to a different checkout');return resolved;}
function fresh(){return fs.mkdtempSync(path.join(tempRoot,BUILD_PREFIX));}
async function child(executable,args,options,directory,name,timeoutMs=300000){
 const out=fs.createWriteStream(path.join(directory,name+'.log'),{flags:'wx'});let processChild,exited;
 try{
  processChild=spawn(executable,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],...options});processChild.stdout.pipe(out,{end:false});processChild.stderr.pipe(out,{end:false});
  exited=new Promise((resolve,reject)=>{processChild.once('error',reject);processChild.once('close',(code,signal)=>resolve({code,signal}));});
  const result=await deadline(exited,timeoutMs,name+' child deadline ('+timeoutMs+'ms)');save(directory,name+'-exit.json',result);assert.deepEqual(result,{code:0,signal:null},name+' failed; read '+path.join(directory,name+'.log'));return result;
 }finally{if(processChild&&processChild.exitCode===null&&!processChild.killed){processChild.kill();await deadline(exited,5000,name+' killed child close deadline').catch(()=>{});}processChild?.stdout?.unpipe(out);processChild?.stderr?.unpipe(out);await new Promise(resolve=>out.end(resolve));}
}
async function build(){
 const directory=fresh(),output=path.join(directory,'output');fs.mkdirSync(output);
 const config=path.join(root,'vite.config.ts'),generated=path.join(root,'src/engines/model-viewer/runtime.generated.txt'),configSHA256=sha(config),generatedBefore=sha(generated);
 save(directory,'BUILD.json',{format:FORMAT,status:'running',root,output,viteChildDeadlineMs:VITE_CHILD_DEADLINE_MS,realViteConfig:config,realConfigSHA256:configSHA256,generatedBefore,note:'Real Vite config runs its existing modelReaderRuntimePlugin; no product source is patched by this harness.'});
 try{
  await child(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build','--config',path.join(here,'vite.config.ts')],{env:{...process.env,HOARD_EVENTS:'0',THREE_QA_OUTPUT:output}},directory,'vite',VITE_CHILD_DEADLINE_MS);
  const graph=JSON.parse(fs.readFileSync(path.join(output,'three-build-graph.json'),'utf8'));assert(Array.isArray(graph));
  save(directory,'BUILD.json',{format:FORMAT,status:'built',root,output,viteChildDeadlineMs:VITE_CHILD_DEADLINE_MS,realViteConfig:config,realConfigSHA256:configSHA256,generatedBefore,generatedAfter:sha(generated),chunks:graph.length});
  console.log('THREE_BUILD_ROOT '+directory);return directory;
 }catch(error){save(directory,'BUILD-FAILURE.json',{error:error.stack||String(error),generatedBefore,generatedAfter:sha(generated)});console.error('THREE_BUILD_EVIDENCE '+directory);throw error;}
}
function graphContract(graph){
 assert(Array.isArray(graph));const vendor=graph.filter(row=>row.modules.some(id=>id.includes('/node_modules/three/')));assert.equal(vendor.length,1,'C01: exactly one actual Three chunk');
 for(const fragment of ['/build/three.core.js','/loaders/OBJLoader.js','/loaders/GLTFLoader.js','/loaders/STLLoader.js','/loaders/PLYLoader.js','/loaders/FBXLoader.js'])assert(vendor[0].modules.some(id=>id.endsWith(fragment)),'C01 module missing '+fragment);
 const entry=graph.find(row=>row.entry&&row.facade?.replaceAll('\\','/').endsWith('/local-tool-three-runtime/index.html'));assert(entry,'C01: own real author entry required');
 const byFile=new Map(graph.map(row=>[row.file,row])),eager=new Set();function visit(file){if(eager.has(file))return;eager.add(file);for(const next of byFile.get(file)?.imports??[])visit(next);}visit(entry.file);
 assert(!eager.has(vendor[0].file),'C01: eager runtime import');assert([...eager].every(file=>!byFile.get(file)?.modules.some(id=>id.includes('/model-viewer/runtime.generated.txt'))),'C01: eager serialized Reader runtime');
 return{vendorFile:vendor[0].file,vendorBytes:vendor[0].bytes,entryFile:entry.file,eagerFiles:[...eager]};
}
async function run(candidate){
 assert(process.versions.electron,'Run this phase through the repository electron.cmd or electron.exe');
 const {app,BrowserWindow}=require('electron'),buildRoot=ownBuild(candidate),output=path.join(buildRoot,'output');
 assert(fs.existsSync(path.join(output,'three-build-graph.json')),'Successful own build graph required');
 const directory=path.join(buildRoot,'native-'+stamp());fs.mkdirSync(directory);const profile=path.join(directory,'profile');fs.mkdirSync(profile);
 app.setPath('userData',profile);app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');process.env.HOARD_EVENTS='0';
 const preload=path.join(directory,'preload.cjs');
 // MainLayout mounts QuickNoteHost. This explicit unrelated fixture port performs no capture,
 // writes, relay, telemetry, or auxiliary window launch; focus/Three are not mocked.
 fs.writeFileSync(preload,"require('electron').contextBridge.exposeInMainWorld('electronAPI',{platform:process.platform,quickNote:{setContext:()=>{},onCapture:()=>()=>{},onOpenInline:()=>()=>{},ack:()=>{}}});");
 const requests=[],network=[],consoleLog=[],nativeInputs=[],serverRequests=[],phases=[],errors=[],held=[],sockets=new Set();let win,server,port,baseURL,contract,closed=false,serverClosed=false,resultSaved=false,failure,success,release=false,lastState,currentAwait;
 const driverStarted=Date.now(),driverDeadline=driverStarted+260000,checkpointFile=path.join(directory,'checkpoints.jsonl');
 const checkpoint=(stage,details={})=>{const entry={at:new Date().toISOString(),elapsedMs:Date.now()-driverStarted,pid:process.pid,stage,...details};fs.appendFileSync(checkpointFile,JSON.stringify(entry)+'\n');console.log('THREE_NATIVE_CHECKPOINT '+JSON.stringify(entry));};
 async function step(label,ms,start,trace=true){
  const budget=Math.min(ms,driverDeadline-Date.now());assert(budget>0,'Native driver total260s budget exhausted before '+label);currentAwait={label,budgetMs:budget,startedAt:new Date().toISOString()};
  if(trace)checkpoint('await-start',currentAwait);
  try{const value=await deadline(Promise.resolve().then(start),budget,label+' deadline ('+budget+'ms)');if(trace)checkpoint('await-done',{label});currentAwait=undefined;return value;}
  catch(error){checkpoint('await-failed',{label,error:error.stack||String(error)});throw error;}
 }
 checkpoint('driver-start',{buildRoot,profile,driverTotalDeadlineMs:260000,rendererDeadlineMs:180000});
 // This QA process owns its whole lifetime, including async closed-port verification.
 // Closing its only hidden window must not trigger Electron's implicit successful quit.
 app.on('window-all-closed',()=>checkpoint('qa-window-all-closed',{resultSaved}));
 app.on('before-quit',event=>{if(!resultSaved){event.preventDefault();checkpoint('qa-premature-quit-blocked');}});
 const record=(list,value)=>list.push({at:Date.now(),...value});
 const releaseRuntime=()=>{release=true;for(const item of held.splice(0)){record(serverRequests,{event:'release-runtime',url:item.url,phase:'imports-in-flight'});if(!item.response.destroyed)item.send();}};
 async function close(){
  if(closed)return;closed=true;for(const item of held.splice(0))item.response.destroy();
  checkpoint('cleanup-start',{currentAwait,hasWindow:!!win,hasServer:!!server,port});
  if(win&&!win.isDestroyed()){try{if(win.webContents.debugger.isAttached())win.webContents.debugger.detach();}catch(error){errors.push(String(error));}win.destroy();checkpoint('window-destroyed');}
  if(server){const stopped=new Promise(resolve=>server.close(resolve));for(const socket of sockets)socket.destroy();await deadline(stopped,5000,'Private HTTP close deadline');checkpoint('server-close-resolved',{port});await deadline(new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();reject(Error('Private Three HTTP port still open'));});socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));}),5000,'Closed private port verification deadline');serverClosed=true;checkpoint('server-closed-verified',{port});}
 }
 try{
  const graph=JSON.parse(fs.readFileSync(path.join(output,'three-build-graph.json'),'utf8'));contract=graphContract(graph);save(directory,'graph-contract.json',contract);checkpoint('graph-contract-passed',{vendorFile:contract.vendorFile});
  server=http.createServer((request,response)=>{
   let relative;try{relative=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname).replace(/^\//,'');}catch{response.writeHead(400);response.end();return;}
   const file=path.resolve(output,relative);record(serverRequests,{event:'request',method:request.method,url:request.url,file:relative});
   if(!file.startsWith(output+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
   const send=()=>{response.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Content-Length':fs.statSync(file).size});if(request.method==='HEAD')response.end();else fs.createReadStream(file).pipe(response);};
   // Deterministic in-flight boundary: release the real chunk only when both real native
   // button actions have started all four independent author calls. No module replacement.
   if(relative===contract.vendorFile&&!release){held.push({url:request.url,response,send});record(serverRequests,{event:'hold-runtime',url:request.url});}else send();
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await step('private-http-listen',5000,()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);}));port=server.address().port;baseURL='http://127.0.0.1:'+port;checkpoint('private-http-listening',{baseURL});
  await step('app-when-ready',20000,()=>app.whenReady());checkpoint('window-create-start');win=new BrowserWindow({show:false,useContentSize:true,width:1440,height:1000,minWidth:100,minHeight:100,webPreferences:{preload,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});win.removeMenu();checkpoint('window-created',{webContentsId:win.webContents.id});
  const session=win.webContents.session;await step('session-clear-cache',15000,()=>session.clearCache());await step('session-clear-storage',15000,()=>session.clearStorageData());
  // DevTools needs an initialized renderer target. Blank has no application/SDK/Three
  // code and is completed before installing the cold author-navigation recorders.
  await step('blank-realm-navigation',15000,()=>win.loadURL('about:blank'));
  const blank=await step('blank-realm-proof',5000,()=>win.webContents.executeJavaScript('({url:location.href,scripts:document.scripts.length,resources:performance.getEntriesByType("resource").map(row=>row.name)})'));
  assert.deepEqual(blank,{url:'about:blank',scripts:0,resources:[]});assert.equal(serverRequests.length,0,'No own output may be requested before the cold recorders');save(directory,'blank-realm.json',blank);checkpoint('blank-realm-ready',{ownHttpRequests:serverRequests.length});
  session.webRequest.onBeforeRequest((details,callback)=>{record(requests,{event:'before',url:details.url,resourceType:details.resourceType,method:details.method});const allowed=details.url.startsWith(baseURL+'/')||details.url.startsWith('data:')||details.url.startsWith('blob:');if(!allowed)errors.push('Unexpected external fixture request '+details.url);callback({cancel:!allowed});});
  session.webRequest.onCompleted(details=>record(requests,{event:'completed',url:details.url,statusCode:details.statusCode,fromCache:details.fromCache}));
  session.webRequest.onErrorOccurred(details=>record(requests,{event:'error',url:details.url,error:details.error}));
  win.webContents.on('console-message',details=>record(consoleLog,{level:details.level,sourceId:details.sourceId,line:details.lineNumber,message:details.message}));
  win.webContents.on('render-process-gone',(_event,details)=>errors.push('Renderer exited '+JSON.stringify(details)));
  checkpoint('request-recorders-installed');win.webContents.debugger.attach('1.3');checkpoint('debugger-attached');win.webContents.debugger.on('message',(_event,method,params)=>{if(['Network.requestWillBeSent','Network.responseReceived','Network.requestServedFromCache','Network.loadingFailed'].includes(method))record(network,{method,params});});
  await step('debugger-network-enable',5000,()=>win.webContents.debugger.sendCommand('Network.enable'));await step('debugger-cache-disable',5000,()=>win.webContents.debugger.sendCommand('Network.setCacheDisabled',{cacheDisabled:true}));
  assert.equal(requests.length,0,'Cold recorder must be installed before first navigation');
  const entryRelative='tests/local-tool-three-runtime/index.html';assert(fs.existsSync(path.join(output,entryRelative)),'Expected additive Vite HTML entry absent');
  await step('own-author-navigation',45000,()=>win.loadURL(baseURL+'/'+entryRelative));const end=Math.min(Date.now()+180000,driverDeadline);let lastPhase,nativeBusy=false,polls=0;checkpoint('renderer-poll-start',{rendererBudgetMs:end-Date.now()});
  while(Date.now()<end){
   assert.equal(errors.length,0,errors.join('\n'));polls++;const state=await step('renderer-state-execute-js',10000,()=>win.webContents.executeJavaScript('({result:window.__result??null,native:window.__native??null,phase:window.__threePhase??null,evidence:window.__threeEvidence??null,cleanup:window.__threeCleanup??null,snapshots:window.__threeSnapshots??null,globalErrors:window.__threeGlobalErrors??[]})'),polls===1||polls%200===0);lastState=state;
   if(state.phase&&state.phase!==lastPhase){lastPhase=state.phase;record(phases,{phase:lastPhase});checkpoint('renderer-phase',{phase:lastPhase});if(lastPhase==='cold-mounted')assert.equal(serverRequests.filter(row=>row.event==='request'&&row.file===contract.vendorFile).length,0,'C02: runtime requested before author invocation');}
   // The renderer may publish its in-flight phase before HTTP receives the queued
   // request. Wait for both causal observations; do not release on an elapsed sleep.
   if(state.phase==='imports-in-flight'&&!release&&held.length>0)releaseRuntime();
   if(state.native&&!nativeBusy){
    nativeBusy=true;const input=state.native;assert.equal(input.n,nativeInputs.length+1);assert(Array.isArray(input.events)&&input.events.length===(input.n===1?6:3));record(nativeInputs,{n:input.n,events:input.events});
    for(const event of input.events)win.webContents.sendInputEvent(event);
    await step('native-input-ack-'+input.n,10000,()=>win.webContents.executeJavaScript('window.__native=null;window.__nativeAck='+JSON.stringify(input.n)+';0'));nativeBusy=false;
   }
   assert.deepEqual(state.globalErrors,[],'Unexpected uncaught renderer error');
   if(state.result){assert.equal(state.result.ok,true,state.result.error);assert.equal(nativeInputs.length,2,'Both cold and repeated actual native actions required');assert(state.evidence);assert.deepEqual(state.cleanup,{projects:0,hosts:0,probes:0});
    assert.equal(serverRequests.filter(row=>row.event==='request'&&row.file===contract.vendorFile).length,1,'C03/C04: expected exactly one real HTTP runtime request');
    assert.equal(requests.filter(row=>row.event==='before'&&row.url===baseURL+'/'+contract.vendorFile).length,1);
    const responses=network.filter(row=>row.method==='Network.responseReceived'&&row.params.response.url===baseURL+'/'+contract.vendorFile);assert.equal(responses.length,1);assert(responses[0].params.response.fromDiskCache!==true);assert(!responses[0].params.response.fromServiceWorker);const runtimeRequests=new Set(network.filter(row=>row.method==='Network.requestWillBeSent'&&row.params.request.url===baseURL+'/'+contract.vendorFile).map(row=>row.params.requestId));assert.equal(runtimeRequests.size,1);assert.equal(network.filter(row=>row.method==='Network.requestServedFromCache'&&runtimeRequests.has(row.params.requestId)).length,0,'Cold Three runtime unexpectedly used resource cache');
    assert(state.snapshots?.before&&state.snapshots?.after);assert.deepEqual(state.snapshots.after,state.snapshots.before,'C07 exact retained snapshots');
    success={tests:state.result.tests,evidence:state.evidence,cleanup:state.cleanup};break;
   }
   await pause();
  }
  assert(success,'Source Three native contract deadline');
 }catch(error){failure=error.stack||String(error);checkpoint('driver-failed',{currentAwait,error:failure});console.error(failure);}
 finally{
  try{await close();}catch(error){errors.push(error.stack||String(error));}
  save(directory,'requests.json',requests);save(directory,'devtools-network.json',network);save(directory,'http-requests.json',serverRequests);save(directory,'console.json',consoleLog);save(directory,'native-inputs.json',nativeInputs);save(directory,'phases.json',phases);save(directory,'last-renderer-state.json',lastState??null);if(lastState?.snapshots){save(directory,'before.json',lastState.snapshots.before??null);save(directory,'after.json',lastState.snapshots.after??null);}
  const result={ok:!!success&&!failure&&errors.length===0,failure,errors,contract,success,profile,profileRetained:true,buildRoot,baseURL,serverClosed,serverNeverStarted:port===undefined,hiddenWindow:true,cacheDisabled:true,currentAwait,driverElapsedMs:Date.now()-driverStarted};save(directory,'RESULT.json',result);resultSaved=true;checkpoint('result-saved',{ok:result.ok,serverClosed,serverNeverStarted:result.serverNeverStarted});
  console.log('THREE_NATIVE_EVIDENCE '+directory);console.log('THREE_NATIVE_RESULT '+JSON.stringify(result));app.exit(result.ok?0:1);
 }
}
async function main(){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='build'){await build();return;}
 if(mode==='all'){const directory=await build(),env={...process.env,HOARD_EVENTS:'0'};delete env.ELECTRON_RUN_AS_NODE;await child(path.join(root,'node_modules/electron/dist/electron.exe'),[__filename,'run','--build-root',directory],{env},directory,'electron');const nativeDirectories=fs.readdirSync(directory).filter(name=>name.startsWith('native-'));assert.equal(nativeDirectories.length,1,'Expected one own native result for this fresh build');const resultFile=path.join(directory,nativeDirectories[0],'RESULT.json');assert(fs.existsSync(resultFile),'Electron exit0 without RESULT is not a pass');assert.equal(JSON.parse(fs.readFileSync(resultFile,'utf8')).ok,true,'Electron exit0 requires saved successful RESULT');return;}
 if(mode==='run'&&args[0]==='--build-root'&&args.length===2){await run(args[1]);return;}
 throw Error('Use Node harness.cjs build|all, or electron.cmd harness.cjs run --build-root OWN_BUILD_DIRECTORY');
}
main().catch(error=>{console.error(error.stack||String(error));if(process.versions.electron)require('electron').app.exit(1);else process.exitCode=1;});
