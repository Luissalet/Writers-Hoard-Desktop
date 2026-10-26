// Two actual MCP stdio keys -> private normal Mainbridge HTTP -> Native executor -> IPC -> real Vite renderer.
// Durable metadata writes use registered list/action tools and their own Undo receipts. No synthetic tool response or inference API.
const { app, BrowserWindow, ipcMain } = require('electron'), { build } = require('esbuild');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process'), { createInterface } = require('node:readline');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ner-dismissals-native-'));
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
  const result = { ok: !failure && errors.length === 0, toolCalls, rpcCalls, ipcReplies: replies.length, sessions: sessions.map(session => session.report()), checks, unauthorizedStatus, serverStarted, serverClosed, privateProfile: directory, errors, failure: failure && scrub(failure), rendererTransport: 'existing Vite (WH_TEST_BASE_URL or localhost63395); normal renderer dispatch and durable metadata service', printedTokens: false };
  save('RESULT.json', result); save('mcp-transcript.json', transcript); save('ipc-replies.json', replies);
  console.log('NER_DISMISSALS_NATIVE_EVIDENCE ' + evidence); console.log('NER_DISMISSALS_NATIVE_RESULT ' + JSON.stringify(result)); assert.equal(errors.length, 0, errors.join('\n'));
}
async function adapter(token, label) {
  const child = spawn(process.execPath, [adapterFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: token, WH_BRIDGE_TOKEN_FILE: '', WH_BRIDGE_URL: `http://127.0.0.1:${port}`, WH_BRIDGE_GROUPS: '', WH_PUBLISHING_MODULE: '', WH_MCP_NO_AUTOSTART: '0', HOARD_EVENTS: '0' } });
  const waiting = new Map(); let sequence = 0, stderr = '', ended = false, actualExit = null;
  const exit = new Promise(resolve => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', error => resolve({ error: scrub(error) })); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { try { const value = JSON.parse(line), pending = waiting.get(value.id); assert(pending, 'Unexpected stdio reply'); clearTimeout(pending.timer); waiting.delete(value.id); pending.resolve(value); } catch (error) { failure = scrub(error); for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(error); } waiting.clear(); } });
  child.once('close', () => { for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(Error('NER dismissals stdio closed before reply')); } waiting.clear(); });
  const session = {
    rpc: (method, params) => new Promise((resolve, reject) => { rpcCalls++; const id = ++sequence, timer = setTimeout(() => { waiting.delete(id); reject(Error('NER dismissals RPC deadline')); }, 30000); waiting.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }),
    close: async () => { if (ended) return; ended = true; child.stdin.end(); try { actualExit = await bounded(exit, 5000, 'NER dismissals stdio EOF deadline'); } catch (error) { child.kill(); actualExit = await bounded(exit, 3000, 'NER dismissals stdio termination deadline'); throw error; } finally { lines.close(); fs.writeFileSync(path.join(evidence, label + '.stderr.log'), scrub(stderr)); } assert.deepEqual(actualExit, { code: 0, signal: null }); },
    report: () => ({ label, exit: actualExit, pending: waiting.size, stderrBytes: Buffer.byteLength(stderr) }),
  };
  sessions.push(session); const initialized = await session.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'entity-candidate-dismissals-native', version: '1' } }); assert(!initialized.error); assert.equal(initialized.result.serverInfo.name, 'writers-hoard'); return session;
}
async function setup() {
  const reservation = net.createServer(); await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); }); port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); process.env.WH_AIBRIDGE_PORT = String(port);
  const common = { bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, logLevel: 'warning' }, bridgeFile = path.join(directory, 'bridge.cjs');
  await build({ ...common, stdin: { contents: "export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';", resolveDir: root }, external: ['electron'], outfile: bridgeFile });
  await build({ ...common, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], outfile: adapterFile });
  bridge = require(bridgeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true });
  keys = [await bridge.bridgeKeys.create('NER dismissals Native A'), await bridge.bridgeKeys.create('NER dismissals Native B')]; for (const key of keys) assert.equal(key.ok, true); assert(keys[0].key.id !== keys[1].key.id && keys[0].token !== keys[1].token, 'Two distinct real keys required');
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, event.sender.mainFrame); replies.push({ id: payload.id, ok: payload.ok, code: payload.code }); bridge.resolveBridgeReply(payload); });
}
async function drive() {
  const renderer = (name, args) => win.webContents.executeJavaScript(`window.${name}(${args === undefined ? '' : JSON.stringify(args)})`);
  let fixture; const deadline = Date.now() + 90000;
  while (!fixture) { const state = await win.webContents.executeJavaScript('({ready:window.__nerNativeReady??null,result:window.__result??null})'); if (state.result?.ok === false) throw Error(state.result.error); fixture = state.ready; if (!fixture) { if (Date.now() > deadline) throw Error('Normal NER renderer did not become ready'); await sleep(40); } }
  save('fixture.json',fixture);
  const snapshot=()=>renderer('__nerNativeSnapshot'), baseline=await snapshot();save('before.json',baseline);
  const conserve = async () => { const state=await snapshot();assert.deepEqual(state.business,baseline.business,'Only Project.entityCandidateDismissals may change: all other fields/rows/dates must remain exact');return state; };
  await bridge.startAiBridge({version:'private-ner-dismissals-native',hasWindow:()=>true});serverStarted=true;
  const a=await adapter(keys[0].token,'A'),b=await adapter(keys[1].token,'B'),LIST='wh_entity_candidate_dismissals',ACTION='wh_entity_candidate_dismissal_action';
  for(const session of [a,b]){
    const listed=await session.rpc('tools/list',{});assert(!listed.error);
    for(const name of [LIST,ACTION,'wh_entity_detect']){
      const matches=listed.result.tools.filter(tool=>tool.name===name);assert.equal(matches.length,1);const tool=matches[0];
      assert.equal(tool.annotations.readOnlyHint,name!==ACTION);assert(tool.inputSchema.properties.context,'Missing registered structural context schema');
      if(name==='wh_entity_detect')assert(!tool.inputSchema.required.includes('context'),'Legacy detect must not require context');
      else assert.deepEqual(tool.inputSchema.required,name===LIST?['projectId','context']:['projectId','context','action']);
      save('manifest-'+session.report().label+'-'+name+'.json',tool);
    }
  }
  async function call(session,name,args){
    const prior=replies.length,response=await session.rpc('tools/call',{name,arguments:args});toolCalls++;assert(!response.error);assert.equal(replies.length-prior,1,'Tool must cross actual Native executor IPC exactly once');assert.equal(response.result.content.length,1);assert.equal(response.result.content[0].type,'text');
    const outcome={isError:response.result.isError===true,value:JSON.parse(response.result.content[0].text)};transcript.push({key:session.report().label,name,args,outcome,ipcReplies:replies.length-prior});await conserve();return outcome;
  }
  async function ok(session,name,args){const result=await call(session,name,args);assert.equal(result.isError,false,JSON.stringify(result.value));return result.value;}
  const read=(session,scope)=>ok(session,LIST,scope),span=name=>fixture.candidates.find(row=>row.text===name);
  const dismiss=(session,scope,name,expectedVersion='')=>ok(session,ACTION,{...scope,action:'dismiss',text:fixture.text,candidate:span(name),expectedVersion});
  const restore=(session,scope,key,expectedVersion)=>ok(session,ACTION,{...scope,action:'restore',key,expectedVersion});
  const undo=(session,scope,receiptId)=>ok(session,ACTION,{...scope,action:'undo',receiptId});
  const at=(state,key)=>state.decisions.find(row=>row.key===key);
  const {base,other,era,draft,eraDraft,codex,withoutCodex}=fixture.scopes;
  for(const scope of Object.values(fixture.scopes)){const x=await read(a,scope),y=await read(b,scope);assert.deepEqual(x,y);assert.equal(x.lifetime,'document');assert.equal(x.revision,0);assert.deepEqual(x.decisions,[]);}
  assert.deepEqual(await snapshot(),baseline,'Readonly lists materialized absent metadata');
  const first=await dismiss(a,base,'Nora');assert(first.changed&&first.receiptId);assert(at(await read(b,base),'nora').discarded);
  const beforeNoop=await snapshot(),noop=await dismiss(b,base,'Nora');assert.equal(noop.changed,false);assert(!noop.receiptId);assert.deepEqual(await snapshot(),beforeNoop,'No-op wrote decision metadata');
  const rejected=await call(b,ACTION,{...base,action:'restore',key:'nora',expectedVersion:''});assert(rejected.isError);assert.deepEqual(await snapshot(),beforeNoop,'Stale CAS wrote metadata');
  const rowan=await dismiss(b,base,'Rowan');await undo(b,base,first.receiptId);let current=await read(a,base);assert.deepEqual(current.decisions.map(row=>row.key),['rowan']);
  const beforeReplay=await snapshot();assert((await call(a,ACTION,{...base,action:'undo',receiptId:first.receiptId})).isError);assert.deepEqual(await snapshot(),beforeReplay);await undo(a,base,rowan.receiptId);assert.deepEqual((await read(b,base)).decisions,[]);
  checks.push({twoKeysRegisteredListAction:true,readonlyLegacyAbsence:true,noOpExact:true,staleKeyRejected:true,crossKeyReceiptUndo:true,unrelatedNamePreserved:true,replayRejected:true});
  const second=await dismiss(a,base,'Nora'),v1=at(second,'nora').version;assert.notEqual(v1,at(first,'nora').version);
  const recovered=await restore(b,base,'nora',v1),v2=at(recovered,'nora').version;assert.notEqual(v1,v2);assert.equal(at(recovered,'nora').discarded,false);
  const again=await dismiss(b,base,'Nora',v2),beforeAba=await snapshot();assert((await call(a,ACTION,{...base,action:'undo',receiptId:second.receiptId})).isError);assert.deepEqual(await snapshot(),beforeAba);await undo(a,base,again.receiptId);current=await read(b,base);assert.equal(at(current,'nora').discarded,false);assert.notEqual(at(current,'nora').version,v2);
  checks.push({sameKeyAbaReceiptRejected:true,freshTokensAfterRestoreAndUndo:true,noUniversalAbsentVersionAbaClaim:true});
  for(const [label,scope] of Object.entries({era,draft,eraDraft,codex,withoutCodex})){
    assert.deepEqual((await read(b,scope)).decisions,[]);const prior=await snapshot(),result=await dismiss(a,scope,'Nora');assert(at(await read(b,scope),'nora').discarded);assert.equal(at(await read(a,base),'nora').discarded,false);assert.deepEqual((await read(b,other)).decisions,[]);
    await undo(b,scope,result.receiptId);assert.deepEqual(await snapshot(),prior,'First decision Undo must restore exact scope/field absence');checks.push({scope:label,isolated:true,twoKeys:true,firstUndoExact:true});
  }
  for(const args of [
    {...base,context:{kind:'writings',documentId:fixture.foreignWritingId}},
    {...base,eraId:'missing'},
    {...base,eraId:eraDraft.eraId,context:{kind:'writings',documentId:other.context.documentId,draftId:fixture.eraOnlyDraftId}},
    {...codex,context:{...codex.context,draftId:'invalid-for-codex'}},
  ]){const prior=await snapshot();assert((await call(a,LIST,args)).isError);assert.deepEqual(await snapshot(),prior);}
  for(const candidate of [span('La Guía'),{...span('Rowan'),from:0}]){const prior=await snapshot();assert((await call(b,ACTION,{...base,action:'dismiss',text:fixture.text,candidate,expectedVersion:''})).isError);assert.deepEqual(await snapshot(),prior);}
  // No native detector API or model assets are installed in this private profile.
  // Browser selection is real: missing cache must fail before pipeline creation.
  // Metadata action spans above are explicit inputs, never model output.
  const detectBefore=await snapshot();
  for(const session of [a,b]){const unavailable=await call(session,'wh_entity_detect',{projectId:base.projectId,text:fixture.text});assert(unavailable.isError);assert(JSON.stringify(unavailable.value).includes('entity_model_assets_missing_or_damaged'));}
  assert.deepEqual(await snapshot(),detectBefore);checks.push({foreignScopeDraftAndAliasRejected:true,legacyDetectContextOptional:true,browserDetectMissingAssetsBeforePipeline:true,positiveInferenceClaim:false});
  const probe=await renderer('__nerNativeRootProbe');assert.deepEqual(probe,{awaitedOuterCommit:true,rootAbortExact:true,abortedReceiptUnavailable:true,undoAbortReservationReleased:true,undoRetryExact:true,transportClaim:'separate renderer domain transaction probe, not stdio/HTTP transaction'});await conserve();save('root-transaction-probe.json',probe);
  const prior=replies.length,denied=await fetch(`http://127.0.0.1:${port}/api/call`,{method:'POST',headers:{Authorization:'Bearer deliberately-invalid-native-key','Content-Type':'application/json'},body:JSON.stringify({tool:LIST,args:base}),signal:AbortSignal.timeout(10000)});unauthorizedStatus=denied.status;assert.equal(unauthorizedStatus,401);assert.equal(replies.length,prior,'Unauthorized request reached renderer');await conserve();
  const usedKeys=await bridge.bridgeKeys.list(),audit=await bridge.readAudit(200);
  for(const key of keys){const used=usedKeys.find(row=>row.id===key.key.id);assert(used&&typeof used.lastUsedAt==='number');assert(audit.some(row=>row.tool===ACTION&&row.ok&&row.origin==='bridge'&&row.client==='mcp-stdio'&&row.keyLabel===key.key.label),'Missing actual authenticated action audit');}
  save('key-usage.json',usedKeys.filter(row=>keys.some(key=>key.key.id===row.id)).map(({id,label,lastUsedAt})=>({id,label,lastUsedAt})));save('audit.json',audit);save('after.json',await conserve());
  const cleanup=await renderer('__nerNativeCleanup');assert.deepEqual(cleanup,{projects:0,writings:0,codex:0,drafts:0,variants:0,history:0,links:0});save('cleanup.json',cleanup);
  await a.close();await b.close();await close();await win.webContents.executeJavaScript('window.__nerNativeComplete={ok:true};0');
}

(async () => {
  await app.whenReady(); await setup();
  win = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { preload: preloadFile, contextIsolation: true, sandbox: true, backgroundThrottling: false } }); win.removeMenu(); bridge.setBridgeWindowResolver(() => win);
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(scrub(details.message)); });
  win.webContents.on('render-process-gone', (_event, details) => { failure = 'NER dismissals renderer gone ' + details.reason; void close().finally(() => app.exit(1)); });
  const baseURL = process.env.WH_TEST_BASE_URL || 'http://127.0.0.1:63395';
  await win.loadURL(new URL('/tests/entity-candidate-dismissals.native.html', baseURL).href);
  driver = drive().catch(async error => { failure = scrub(error.stack || error); console.error(failure); await win.webContents.executeJavaScript(`window.__nerNativeComplete=${JSON.stringify({ ok: false, error: failure })};0`).catch(() => {}); });
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) { const result = await win.webContents.executeJavaScript('window.__result??null'); if (result) { await driver; if (!result.ok) throw Error(result.error); if (failure) throw Error(failure); for (const test of result.tests) console.log('PASS ' + test); await close(); win.destroy(); app.exit(0); return; } await sleep(40); }
  throw Error('Native NER dismissals completion deadline');
})().catch(async error => { failure = scrub(error.stack || error); console.error(failure); try { await close(); } finally { if (win && !win.isDestroyed()) win.destroy(); app.exit(1); } });
