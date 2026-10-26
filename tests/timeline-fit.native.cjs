// Two actual MCP stdio keys -> private normal Mainbridge HTTP -> Native executor -> IPC -> real Vite renderer.
// Durable metadata writes use registered list/action tools and their own Undo receipts. No synthetic tool response or inference API.
const { app, BrowserWindow, ipcMain } = require('electron'), { build } = require('esbuild');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process'), { createInterface } = require('node:readline');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-timeline-fit-native-'));
app.setPath('userData', path.join(directory, 'profile')); app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.HOARD_EVENTS = '0';
const evidence = path.join(directory, 'evidence'); fs.mkdirSync(evidence, { recursive: true });
const preloadFile = path.join(directory, 'preload.cjs'), adapterFile = path.join(directory, 'stdio.cjs');
// Complete imperative shape for this surface; QuickNote is explicit inert and opens no window.
fs.writeFileSync(preloadFile, "const{contextBridge,ipcRenderer}=require('electron');const api={platform:process.platform};api.quickNote={setContext:()=>{},onCapture:()=>()=>{},onOpenInline:()=>()=>{},ack:()=>{}};api.aiBridge={onRequest:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)};contextBridge.exposeInMainWorld('electronAPI',api);");
let bridge, win, port, keys = [], driver, failure, closing = false, serverStarted = false, serverClosed = false, toolCalls = 0, rpcCalls = 0, unauthorizedStatus;
const sessions = [], replies = [], transcript = [], checks = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scrub = value => { let text = String(value); for (const key of keys) if (key.token) text = text.split(key.token).join('[REDACTED]'); return text; };
const save = (name, value) => fs.writeFileSync(path.join(evidence, name), scrub(JSON.stringify(value, null, 2)) + '\n');
async function bounded(promise, ms, label) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); })]); } finally { clearTimeout(timer); } }
async function close() {
  if (closing) return; closing = true; const errors = [];
  for (const session of sessions) try { await session.close(); } catch (error) { errors.push(scrub(error)); }
  if (bridge) bridge.stopAiBridge();
  if (serverStarted) {
    for (let i = 0; i < 100 && !serverClosed; i++) { serverClosed = await new Promise(resolve => { const socket = net.connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', error => resolve(error.code === 'ECONNREFUSED')); }); if (!serverClosed) await sleep(50); }
    if (!serverClosed) errors.push('Private Mainbridge port remains open');
  }
  ipcMain.removeHandler('aibridge:reply'); if (bridge) bridge.setBridgeWindowResolver(() => null);
  const result = { ok: !failure && errors.length === 0, toolCalls, rpcCalls, ipcReplies: replies.length, sessions: sessions.map(session => session.report()), checks, unauthorizedStatus, serverStarted, serverClosed, privateProfile: directory, errors, failure: failure && scrub(failure), rendererTransport: 'existing Vite63395; real Timeline canvas, normal renderer dispatch and mounted viewport port', printedTokens: false };
  save('RESULT.json', result); save('mcp-transcript.json', transcript); save('ipc-replies.json', replies);
  console.log('TIMELINE_FIT_NATIVE_EVIDENCE ' + evidence); console.log('TIMELINE_FIT_NATIVE_RESULT ' + JSON.stringify(result)); assert.equal(errors.length, 0, errors.join('\n'));
}
async function adapter(token, label) {
  const child = spawn(process.execPath, [adapterFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: token, WH_BRIDGE_TOKEN_FILE: '', WH_BRIDGE_URL: `http://127.0.0.1:${port}`, WH_BRIDGE_GROUPS: '', WH_PUBLISHING_MODULE: '', WH_MCP_NO_AUTOSTART: '0', HOARD_EVENTS: '0' } });
  const waiting = new Map(); let sequence = 0, stderr = '', ended = false, actualExit = null;
  const exit = new Promise(resolve => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', error => resolve({ error: scrub(error) })); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { try { const value = JSON.parse(line), pending = waiting.get(value.id); assert(pending, 'Unexpected stdio reply'); clearTimeout(pending.timer); waiting.delete(value.id); pending.resolve(value); } catch (error) { failure = scrub(error); for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(error); } waiting.clear(); } });
  child.once('close', () => { for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(Error('Timeline Fit stdio closed before reply')); } waiting.clear(); });
  const session = {
    rpc: (method, params) => new Promise((resolve, reject) => { rpcCalls++; const id = ++sequence, timer = setTimeout(() => { waiting.delete(id); reject(Error('Timeline Fit RPC deadline')); }, 30000); waiting.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }),
    close: async () => { if (ended) return; ended = true; child.stdin.end(); try { actualExit = await bounded(exit, 5000, 'Timeline Fit stdio EOF deadline'); } catch (error) { child.kill(); actualExit = await bounded(exit, 3000, 'Timeline Fit stdio termination deadline'); throw error; } finally { lines.close(); fs.writeFileSync(path.join(evidence, label + '.stderr.log'), scrub(stderr)); } assert.deepEqual(actualExit, { code: 0, signal: null }); },
    report: () => ({ label, exit: actualExit, pending: waiting.size, stderrBytes: Buffer.byteLength(stderr) }),
  };
  sessions.push(session); const initialized = await session.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'timeline-fit-native', version: '1' } }); assert(!initialized.error); assert.equal(initialized.result.serverInfo.name, 'writers-hoard'); return session;
}
async function setup() {
  const reservation = net.createServer(); await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); }); port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); process.env.WH_AIBRIDGE_PORT = String(port);
  const common = { bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, logLevel: 'warning' }, bridgeFile = path.join(directory, 'bridge.cjs');
  await build({ ...common, stdin: { contents: "export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';", resolveDir: root }, external: ['electron'], outfile: bridgeFile });
  await build({ ...common, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], outfile: adapterFile });
  bridge = require(bridgeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true });
  keys = [await bridge.bridgeKeys.create('Timeline Fit Native A'), await bridge.bridgeKeys.create('Timeline Fit Native B')]; for (const key of keys) assert.equal(key.ok, true); assert(keys[0].key.id !== keys[1].key.id && keys[0].token !== keys[1].token, 'Two distinct real keys required');
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, event.sender.mainFrame); replies.push({ id: payload.id, ok: payload.ok, code: payload.code }); bridge.resolveBridgeReply(payload); });
}
async function drive(){
 const renderer=(name,args)=>win.webContents.executeJavaScript(`window.${name}(${args===undefined?'':JSON.stringify(args)})`);let fixture;
 for(let i=0;i<1800&&!fixture;i++){const state=await win.webContents.executeJavaScript('({ready:window.__fitNativeReady??null,result:window.__result??null})');if(state.result?.ok===false)throw Error(state.result.error);fixture=state.ready;if(!fixture)await sleep(50);}assert(fixture,'Native Fit renderer readiness');save('fixture.json',fixture);
 const snapshot=()=>renderer('__fitNativeSnapshot'),baseline=await snapshot();save('before.json',baseline);await bridge.startAiBridge({version:'private-timeline-fit-native',hasWindow:()=>true});serverStarted=true;
 const a=await adapter(keys[0].token,'A'),b=await adapter(keys[1].token,'B'),GET='wh_timeline_view_get',FIT='wh_timeline_view_fit';
 for(const session of[a,b]){const listed=await session.rpc('tools/list',{});assert(!listed.error);for(const name of[GET,FIT]){const tools=listed.result.tools.filter(tool=>tool.name===name);assert.equal(tools.length,1);assert.equal(tools[0].annotations.readOnlyHint,name===GET);save('manifest-'+session.report().label+'-'+name+'.json',tools[0]);}}
 async function call(session,name,args){const prior=replies.length,response=await session.rpc('tools/call',{name,arguments:args});toolCalls++;assert(!response.error);assert.equal(replies.length-prior,1,'Each Fit/get must cross actual Native IPC');const outcome={isError:response.result.isError===true,value:JSON.parse(response.result.content[0].text)};transcript.push({key:session.report().label,name,args,outcome,ipcReplies:replies.length-prior});assert.equal(await snapshot(),baseline,'Viewport call changed any business table/field/date');assert.equal(outcome.isError,false,JSON.stringify(outcome));return outcome.value;}
 const get=(session,scope)=>call(session,GET,scope),fit=(session,scope,hostId)=>call(session,FIT,{...scope,hostId});
 const {base,era,foreign}=fixture.scopes,targets={};for(const[name,scope]of Object.entries(fixture.scopes)){const x=await get(a,scope),y=await get(b,scope);assert.deepEqual(x,y);assert.equal(x.targets.length,1);assert.equal(x.targets[0].mode,'manual');targets[name]=x.targets[0];const geometry=await renderer('__fitNativeGeometry',{slot:name});assert(geometry.svgWidth>geometry.canvasWidth,'Positive unfit real canvas');}
 assert.equal((await fit(b,base,targets.foreign.hostId)).available,false,'Foreign host must not be invoked');assert.equal((await fit(a,base,targets.era.hostId)).available,false,'Named era is not Base');
 for(const[name,scope,session]of[['base',base,a],['era',era,b]]){const result=await fit(session,scope,targets[name].hostId);assert(result.available&&result.mode==='fit');const observed=(await get(session===a?b:a,scope)).targets[0];assert.equal(observed.mode,'fit');assert.equal(observed.zoom,result.zoom);const geometry=await renderer('__fitNativeGeometry',{slot:name});assert(geometry.fits&&geometry.scrollLeft===0);save('geometry-'+name+'.json',geometry);}
 assert.equal((await get(a,foreign)).targets[0].mode,'manual','Unrelated viewport changed');
 const pendingBefore=await renderer('__fitNativePending');assert.deepEqual(pendingBefore,{sameNode:true,value:'Unsaved own Native event draft',connected:true});await fit(b,base,targets.base.hostId);assert.deepEqual(await renderer('__fitNativePending'),pendingBefore,'Fit changed or saved pending actual event form');
 await renderer('__fitNativeVisibility',{show:false});assert.deepEqual((await get(a,base)).targets,[]);assert.equal((await fit(b,base,targets.base.hostId)).available,false,'Hidden real host is unavailable');await renderer('__fitNativeVisibility',{show:true});assert.deepEqual(await renderer('__fitNativePending'),pendingBefore);
 const prior=replies.length,response=await fetch(`http://127.0.0.1:${port}/api/call`,{method:'POST',headers:{Authorization:'Bearer invalid-fit-key','Content-Type':'application/json'},body:JSON.stringify({tool:GET,args:base}),signal:AbortSignal.timeout(10000)});unauthorizedStatus=response.status;assert.equal(unauthorizedStatus,401);assert.equal(replies.length,prior);
 const audit=await bridge.readAudit(200),used=await bridge.bridgeKeys.list();for(const key of keys){assert(audit.some(row=>row.tool===FIT&&row.ok&&row.origin==='bridge'&&row.client==='mcp-stdio'&&row.keyLabel===key.key.label));assert.equal(typeof used.find(row=>row.id===key.key.id).lastUsedAt,'number');}save('audit.json',audit);assert.equal(await snapshot(),baseline);save('after.json',await snapshot());checks.push({twoRealKeys:true,actualViewport:true,baseEraExact:true,foreignHiddenUnavailable:true,pendingFormRetained:true,allBusinessBytesExact:true});
 const cleanup=await renderer('__fitNativeCleanup');assert.deepEqual(cleanup,{projects:0,timelines:0,events:0,variants:0,history:0});save('cleanup.json',cleanup);await a.close();await b.close();await close();await win.webContents.executeJavaScript('window.__fitNativeComplete={ok:true};0');
}

(async () => {
  await app.whenReady(); await setup();
  win = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { preload: preloadFile, contextIsolation: true, sandbox: true, backgroundThrottling: false } }); win.removeMenu(); bridge.setBridgeWindowResolver(() => win);
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(scrub(details.message)); });
  win.webContents.on('render-process-gone', (_event, details) => { failure = 'Timeline Fit renderer gone ' + details.reason; void close().finally(() => app.exit(1)); });
  const baseURL = process.env.WH_TEST_BASE_URL || 'http://127.0.0.1:63395';
  await win.loadURL(new URL('/tests/timeline-fit.native.html', baseURL).href);
  driver = drive().catch(async error => { failure = scrub(error.stack || error); console.error(failure); await win.webContents.executeJavaScript(`window.__fitNativeComplete=${JSON.stringify({ ok: false, error: failure })};0`).catch(() => {}); });
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) { const result = await win.webContents.executeJavaScript('window.__result??null'); if (result) { await driver; if (!result.ok) throw Error(result.error); if (failure) throw Error(failure); for (const test of result.tests) console.log('PASS ' + test); await close(); win.destroy(); app.exit(0); return; } await sleep(40); }
  throw Error('Native Timeline Fit completion deadline');
})().catch(async error => { failure = scrub(error.stack || error); console.error(failure); try { await close(); } finally { if (win && !win.isDestroyed()) win.destroy(); app.exit(1); } });
