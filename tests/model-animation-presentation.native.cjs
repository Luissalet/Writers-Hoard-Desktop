// Real stdio -> authenticated HTTP -> executor -> IPC -> renderer/DB.
// Undo uses the existing authenticated POST /api/undo route and the returned audit index.
// No mounted Source/UI/CSS/Canvas or WebGL claim.
const { app, BrowserWindow, ipcMain } = require('electron');
const { build } = require('esbuild');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process'), { createInterface } = require('node:readline');
const { viteCssTextPlugin } = require('../scripts/esbuild-vite-css.cjs');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'wh-clips-native-'));
const evidence = path.join(root, '_stage/model-clips-next/native-review', `run-${Date.now()}-${process.pid}`);
fs.mkdirSync(evidence, { recursive: true }); app.setPath('userData', path.join(directory, 'profile')); process.env.HOARD_EVENTS = '0';
let bridge, window, deadline, adapterFile, port, closing = false, failure, fixture, baseline;
let toolCalls = 0, rpcCalls = 0, httpUndoCalls = 0;
const sessions = [], replies = [], transcript = [], httpTranscript = [], rendererErrors = [];
const validatedHistory = new Map();
const save = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms, message) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), ms); })]); } finally { clearTimeout(timer); } }
async function closedPort() {
  await bounded(new Promise((resolve, reject) => { const socket = net.connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); reject(Error('Private bridge port still open')); }); socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error)); }), 5000, 'Private bridge close deadline');
}
async function finish(code) {
  if (closing) return; closing = true; clearTimeout(deadline); const cleanupErrors = [];
  for (const session of sessions) try { await session.close(); } catch (error) { cleanupErrors.push(String(error)); code = 1; }
  let serverClosed = false;
  if (bridge) { bridge.stopAiBridge(); if (port) try { await closedPort(); serverClosed = true; } catch (error) { cleanupErrors.push(String(error)); code = 1; } }
  if (window && !window.isDestroyed()) { const closed = new Promise(resolve => window.once('closed', resolve)); window.destroy(); await closed; }
  ipcMain.removeHandler('aibridge:reply');
  const result = { ok: code === 0, stdioToolCalls: toolCalls, rpcCalls, authenticatedHttpUndoCalls: httpUndoCalls, ipcReplies: replies.length, sessions: sessions.map(session => session.report()), rendererErrors, cleanupErrors, failure, ownPort: port, serverClosed, privateProfile: directory, profileRetained: true, sourceHostMounted: false, computedCssClaim: false, canvasClaim: false, webglClaim: false, hubEventsEnabled: false, tablesCompared: baseline?.tables.length };
  save('RESULT.json', result); save('stdio-transcript.json', transcript); save('http-undo-transcript.json', httpTranscript); save('ipc-replies.json', replies);
  console.log('CLIPS_NATIVE_PRIVATE_TEMP ' + directory); console.log('CLIPS_NATIVE_EVIDENCE ' + evidence); console.log('CLIPS_NATIVE_COUNTS ' + JSON.stringify(result));
  if (!code) console.log('PASS real clips MCP stdio/two authenticated keys/executor/IPC/renderer; normal HTTP audit Undo; CAS, Base/eras, readonly and unchanged binaries/control/88 tables');
  app.exit(code);
}
async function openAdapter(token, label) {
  const child = spawn(process.execPath, [adapterFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: token, WH_BRIDGE_TOKEN_FILE: '', WH_BRIDGE_URL: `http://127.0.0.1:${port}`, WH_BRIDGE_GROUPS: '', WH_PUBLISHING_MODULE: '', WH_MCP_NO_AUTOSTART: '0', HOARD_EVENTS: '0' } });
  const waiting = new Map(); let nextId = 0, stderr = '', closed = false, actualExit = null, sessionRpcCalls = 0;
  const exit = new Promise(resolve => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', error => resolve({ error: String(error) })); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const reader = createInterface({ input: child.stdout });
  reader.on('line', line => { try { const message = JSON.parse(line), pending = waiting.get(message.id); assert(pending, 'Unexpected adapter reply'); clearTimeout(pending.timer); waiting.delete(message.id); pending.resolve(message); } catch (error) { failure = 'Invalid clips stdio protocol ' + String(error); console.error(failure); void finish(1); } });
  child.once('close', () => { for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(Error('Adapter closed before reply')); } waiting.clear(); });
  const session = {
    rpc: (method, params) => new Promise((resolve, reject) => { rpcCalls++; sessionRpcCalls++; const id = ++nextId, timer = setTimeout(() => { waiting.delete(id); reject(Error('Clips RPC deadline')); }, 25000); waiting.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }),
    close: async () => { if (closed) return; closed = true; child.stdin.end(); try { actualExit = await bounded(exit, 5000, 'Adapter EOF deadline'); } catch (error) { child.kill(); actualExit = await bounded(exit, 3000, 'Adapter terminate deadline'); throw error; } finally { reader.close(); fs.writeFileSync(path.join(evidence, label.endsWith('A') ? 'stdio-A.stderr.log' : 'stdio-B.stderr.log'), stderr); } assert.deepEqual(actualExit, { code: 0, signal: null }); },
    report: () => ({ label, exit: actualExit, rpcCalls: sessionRpcCalls, stderrBytes: Buffer.byteLength(stderr), pending: waiting.size }),
  };
  sessions.push(session);
  const response = await session.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'independent-clips-native', version: '1' } });
  assert(!response.error); assert.equal(response.result.serverInfo.name, 'writers-hoard'); return session;
}
const table = (snapshot, name) => { const value = snapshot.tables.find(item => item.name === name); assert(value, 'Missing actual table ' + name); return value.rows; };
const stripPresentation = model => { const value = structuredClone(model); delete value.animationPresentation; return value; };
function validPresentation(value) {
  if (value === undefined) return;
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert(Object.keys(value).every(key => ['order', 'labels'].includes(key)));
  if (value.order !== undefined) assert.deepEqual([...value.order].sort((a, b) => a - b), [0, 1, 2]);
  if (value.labels !== undefined) { assert(value.labels && typeof value.labels === 'object' && !Array.isArray(value.labels)); for (const [index, label] of Object.entries(value.labels)) { assert(['0', '1', '2'].includes(index)); assert.equal(typeof label, 'string'); } }
}
function validateHistory(snapshot, preimage) {
  const rows = table(snapshot, 'documentHistory'), byId = new Map(rows.map(row => [row.id, row]));
  assert.equal(byId.size, rows.length, 'Duplicate history ID');
  for (const [id, row] of validatedHistory) assert.deepEqual(byId.get(id), row, 'Prior history entry changed or disappeared');
  const added = rows.filter(row => !validatedHistory.has(row.id));
  assert.equal(added.length, preimage ? 1 : 0, 'Unexpected history addition count');
  if (!preimage) return;
  const row = added[0];
  assert(Object.keys(row).every(key => ['id', 'projectId', 'kind', 'entityId', 'title', 'createdAt', 'version', 'reason', 'document', 'assetIds', 'codexPropertyDefinitions'].includes(key)), 'Unexpected history field');
  assert.equal(typeof row.id, 'string'); assert(row.id); assert.equal(row.projectId, fixture.projectId); assert.equal(row.kind, 'model-viewer'); assert.equal(row.entityId, fixture.modelId); assert.equal(row.reason, 'edit'); assert.equal(row.version, preimage.version);
  assert.equal(row.codexPropertyDefinitions, undefined);
  assert.equal(row.title, String(preimage.document.root.title ?? preimage.document.root.name ?? preimage.document.root.text ?? fixture.modelId));
  assert(Number.isFinite(row.createdAt) && row.createdAt >= preimage.at && row.createdAt <= Date.now(), 'History timestamp outside mutation');
  const document = structuredClone(row.document), assetId = document.root.__worldEraAssetId;
  assert.equal(typeof assetId, 'string'); assert.deepEqual(row.assetIds, [assetId]);
  const asset = table(snapshot, 'worldEraAssets').find(value => value.id === assetId);
  assert(asset && asset.projectId === fixture.projectId, 'History binary reference is not the existing own asset');
  document.root = { ...document.root, ...asset.payload }; delete document.root.__worldEraAssetId;
  assert.deepEqual(document, preimage.document, 'History did not retain the complete exact preimage and binary');
  validatedHistory.set(row.id, structuredClone(row));
}
function conservation(snapshot, historyPreimage) {
  assert.deepEqual(snapshot.tables.map(value => value.name), baseline.tables.map(value => value.name));
  assert.deepEqual(snapshot.location, baseline.location); assert.deepEqual(snapshot.navigation, baseline.navigation); assert.deepEqual(snapshot.journal, baseline.journal);
  const priorProject = table(baseline, 'projects').find(row => row.id === fixture.projectId), currentProject = table(snapshot, 'projects').find(row => row.id === fixture.projectId);
  assert(currentProject); assert(currentProject.updatedAt >= priorProject.updatedAt);
  const normalizeProject = row => { const copy = structuredClone(row); copy.updatedAt = priorProject.updatedAt; copy.modelAssets = copy.modelAssets.map(model => model.id === fixture.modelId ? stripPresentation(model) : model); return copy; };
  const currentModel = currentProject.modelAssets.find(model => model.id === fixture.modelId), pristine = priorProject.modelAssets.find(model => model.id === fixture.modelId);
  validPresentation(currentModel.animationPresentation); assert.deepEqual(normalizeProject(currentProject), normalizeProject(priorProject), 'Base write changed unrelated model/project fields or original binary');
  assert.deepEqual(table(snapshot, 'projects').filter(row => row.id !== fixture.projectId), table(baseline, 'projects').filter(row => row.id !== fixture.projectId), 'Control project changed');
  // Assets are pre-created through the normal own-variant store before baseline.
  assert.deepEqual(table(snapshot, 'worldEraAssets'), table(baseline, 'worldEraAssets'), 'Immutable binary assets changed');
  const ownVariant = row => row.projectId === fixture.projectId && row.kind === 'model-viewer' && row.entityId === fixture.modelId && ['inherited', 'own'].includes(row.eraId);
  const previousVariants = table(baseline, 'worldEraVariants'), variants = table(snapshot, 'worldEraVariants');
  assert.deepEqual(variants.filter(row => !ownVariant(row)), previousVariants.filter(row => !ownVariant(row)), 'Sibling/control variant changed');
  for (const row of variants.filter(ownVariant)) {
    assert(Object.keys(row).every(key => ['id', 'projectId', 'eraId', 'kind', 'entityId', 'revision', 'updatedAt', 'document', 'history', 'archived', 'hidden'].includes(key)), 'Unexpected mutation in own variant');
    assert.equal(row.hidden, undefined); assert(row.archived === undefined || row.archived === true); assert(Number.isSafeInteger(row.revision) && row.revision >= 1); assert.equal(row.history.length, row.revision - 1);
    const old = previousVariants.find(previous => previous.eraId === row.eraId && ownVariant(previous)); if (old) { assert.equal(row.id, old.id); assert(row.updatedAt >= old.updatedAt); }
    const states = [...row.history, row]; let previousTime = 0;
    for (const [index, state] of states.entries()) {
      assert.equal(state.revision, index + 1); assert.equal(typeof state.updatedAt, 'number'); assert(state.updatedAt >= previousTime); previousTime = state.updatedAt;
      assert.equal(state.hidden, undefined); assert(state.archived === undefined || state.archived === true);
      const document = structuredClone(state.document); assert(document && document.root); assert.deepEqual(document.children, {});
      const assetId = document.root.__worldEraAssetId, asset = table(snapshot, 'worldEraAssets').find(value => value.id === assetId);
      assert(asset && asset.projectId === fixture.projectId, 'Missing normal immutable asset reference');
      const resolved = { ...document.root, ...asset.payload }; delete resolved.__worldEraAssetId;
      validPresentation(resolved.animationPresentation); assert.deepEqual(stripPresentation(resolved), pristine, 'Variant/history changed binary/original or unrelated model metadata');
    }
  }
  validateHistory(snapshot, historyPreimage);
  for (const item of snapshot.tables) if (!['projects', 'worldEraVariants', 'worldEraAssets', 'documentHistory'].includes(item.name)) assert.deepEqual(item.rows, table(baseline, item.name), 'Unrelated table changed: ' + item.name);
}
async function run() {
  deadline = setTimeout(() => { failure = 'Clips Native total deadline'; console.error(failure); void finish(1); }, 240000);
  const reservation = net.createServer(); await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); }); port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); process.env.WH_AIBRIDGE_PORT = String(port);
  const common = { bundle: true, alias: { '@': path.join(root, 'src') }, logLevel: 'warning' }, bridgeFile = path.join(directory, 'bridge.cjs'); adapterFile = path.join(directory, 'stdio.cjs');
  await build({ ...common, stdin: { contents: "export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';", resolveDir: root }, platform: 'node', format: 'cjs', external: ['electron'], outfile: bridgeFile });
  await build({ ...common, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], platform: 'node', format: 'cjs', outfile: adapterFile });
  await build({ ...common, entryPoints: [path.join(root, 'tests/model-animation-presentation.native.renderer.ts')], platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(directory, 'renderer.js'), plugins: [viteCssTextPlugin()], loader: { '.css': 'empty' }, banner: { js: 'const __noInstalledSourceModules = () => ({});' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob': '__noInstalledSourceModules', 'import.meta.url': '"file:///native-clips.js"' } });
  fs.writeFileSync(path.join(directory, 'preload.cjs'), "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});");
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>');
  await app.whenReady(); bridge = require(bridgeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true });
  const keyA = await bridge.bridgeKeys.create('Clips Native A'), keyB = await bridge.bridgeKeys.create('Clips Native B');
  assert.equal(keyA.ok, true); assert.equal(keyB.ok, true); assert.notEqual(keyA.key.id, keyB.key.id); assert.notEqual(keyA.token, keyB.token);
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, window.webContents); replies.push({ id: payload.id, ok: payload.ok, code: payload.code }); bridge.resolveBridgeReply(payload); });
  window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.on('console-message', entry => { if (entry.level === 'error') { rendererErrors.push(entry.message); console.error('RENDERER ' + entry.message); } });
  bridge.setBridgeWindowResolver(() => window); await window.loadFile(path.join(directory, 'index.html'));
  const readyUntil = Date.now() + 45000;
  while (!fixture) { const error = await window.webContents.executeJavaScript('window.__clipsNativeFailure ?? null'); if (error) throw Error(error); fixture = await window.webContents.executeJavaScript('window.__clipsNativeReady ?? null'); if (!fixture) { if (Date.now() > readyUntil) throw Error('Clips renderer not ready'); await sleep(40); } }
  assert.equal(fixture.sourceHostMounted, false); assert.equal(fixture.webglMounted, false); assert.equal(fixture.importBytesExact, true); save('fixture.json', fixture);
  const renderer = (name, args) => window.webContents.executeJavaScript(`window.${name}(${args === undefined ? '' : JSON.stringify(args)})`), snapshot = () => renderer('__clipsNativeSnapshot');
  baseline = await snapshot(); assert.equal(baseline.tables.length, 88, 'Actual table coverage changed; review before adjusting'); save('before.json', baseline);
  for (const row of table(baseline, 'documentHistory')) validatedHistory.set(row.id, structuredClone(row));
  const GET = 'wh_model_animation_get', ACTION = 'wh_model_animation_action', base = { projectId: fixture.projectId, modelId: fixture.modelId }, era = { ...base, eraId: fixture.eraId }, own = { ...base, eraId: fixture.ownEraId };
  await bridge.startAiBridge({ version: 'private-clips-native', hasWindow: () => true });
  async function call(session, name, args, relayed = true) { const prior = replies.length, response = await session.rpc('tools/call', { name, arguments: args }); toolCalls++; assert(!response.error); assert.equal(replies.length - prior, relayed ? 1 : 0, 'Executor/IPC boundary changed'); assert.equal(response.result.content.length, 1); assert.equal(response.result.content[0].type, 'text'); const outcome = { isError: response.result.isError === true, value: JSON.parse(response.result.content[0].text) }; transcript.push({ session: session.report().label, name, args, outcome, ipcReplies: replies.length - prior }); return outcome; }
  async function ok(session, name, args) { const result = await call(session, name, args); assert.equal(result.isError, false, JSON.stringify(result.value)); return result.value; }
  function inventory(value, scope) { assert.equal(value.projectId, scope.projectId); assert.equal(value.modelId, scope.modelId); assert.equal(typeof value.version, 'string'); assert.deepEqual([...value.order].sort((a, b) => a - b), [0, 1, 2]); assert.deepEqual(value.clips.map(clip => clip.index), value.order); for (const clip of value.clips) { assert.equal(clip.name, fixture.clips[clip.index].name); assert.equal(typeof clip.label, 'string'); } assert(!JSON.stringify(value).includes('dataUrl') && !JSON.stringify(value).includes('base64') && !JSON.stringify(value).includes('sourceFiles')); assert(!Object.hasOwn(value, '__audit')); }
  async function read(session, scope) { const value = await ok(session, GET, scope); inventory(value, scope); return value; }
  async function checkpoint(name, historyPreimage) { const value = await snapshot(); conservation(value, historyPreimage); save(name + '.json', value); return value; }
  async function action(session, scope, args) {
    const before = await read(session, scope), preimage = scope.eraId ? undefined : await renderer('__clipsNativeRead', {});
    if (preimage) { assert.equal(preimage.version, before.version); preimage.at = Date.now(); }
    const value = await ok(session, ACTION, { ...scope, expectedVersion: before.version, ...args }); inventory(value, scope);
    await checkpoint('after-action-' + toolCalls, preimage && value.version !== before.version ? preimage : undefined); return value;
  }
  function receipt(value) { assert.equal(typeof value.receiptId, 'string'); assert(value.receiptId); assert.equal(value._undo.app_id, 'writer'); assert(Number.isSafeInteger(value._undo.audit_index)); return value._undo.audit_index; }
  async function undo(token, label, index, relayed = true) {
    const before = await snapshot(), entry = (await bridge.readAudit(500)).find(row => row.index === index), preimage = await renderer('__clipsNativeRead', {});
    preimage.at = Date.now();
    const prior = replies.length, response = await fetch(`http://127.0.0.1:${port}/api/undo`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ index }), signal: AbortSignal.timeout(25000) }), value = await response.json();
    httpUndoCalls++; assert.equal(replies.length - prior, relayed ? 1 : 0, 'Normal HTTP Undo/IPC boundary changed'); httpTranscript.push({ keyLabel: label, index, status: response.status, value, ipcReplies: replies.length - prior });
    if (value.ok) {
      assert(entry && entry.tool === ACTION, 'Undo did not target the recorded presentation write');
      const afterRead = await renderer('__clipsNativeRead', {});
      if (entry.eraId) assert.equal(afterRead.version, preimage.version, 'Era Undo changed Base');
      else assert.notEqual(afterRead.version, preimage.version, 'Successful Base Undo did not change its content');
      await checkpoint('after-http-undo-' + httpUndoCalls, entry.eraId ? undefined : preimage);
    } else assert.deepEqual(await snapshot(), before, 'Rejected HTTP Undo mutated data');
    return value;
  }
  async function undoOk(token, label, value) { const result = await undo(token, label, receipt(value)); assert.equal(result.ok, true, JSON.stringify(result)); return result; }
  async function rejected(session, scope, args, relayed = true) { const before = await snapshot(), value = await call(session, ACTION, { ...scope, ...args }, relayed); assert.equal(value.isError, true, 'Invalid/stale write succeeded'); assert.deepEqual(await snapshot(), before, 'Rejected write mutated data'); return value; }
  const first = await openAdapter(keyA.token, 'Clips Native A'), second = await openAdapter(keyB.token, 'Clips Native B');
  for (const session of [first, second]) { const listed = await session.rpc('tools/list', {}); assert(!listed.error); assert.equal(listed.result.tools.length, 947); for (const [name, readonly] of [[GET, true], [ACTION, false]]) { const matches = listed.result.tools.filter(tool => tool.name === name); assert.equal(matches.length, 1); assert.equal(matches[0].annotations.readOnlyHint, readonly); } }
  assert.equal((await ok(first, 'wh_model_get', base)).model.id, fixture.modelId, 'Existing model getter positive failed');
  const initial = await read(first, base), inherited = await read(first, era), ownInitial = await read(second, own);
  assert.match(initial.version, /^sha256:/); assert.equal(inherited.version, initial.version); assert.match(ownInitial.version, /^variant:\d+$/); assert.deepEqual(initial.order, [0, 1, 2]); assert.deepEqual(initial.clips, fixture.clips);
  const query = await renderer('__clipsNativeQuery', { tool: GET, args: { modelId: fixture.modelId } }); inventory(query, base); assert.deepEqual(query, initial);
  await assert.rejects(() => renderer('__clipsNativeQuery', { tool: ACTION, args: { modelId: fixture.modelId, expectedVersion: initial.version, action: 'rename', index: 0, label: 'Readonly denied' } }), /local_tool_query_is_read_only/);
  assert.deepEqual(await snapshot(), baseline, 'Readonly inventory/query mutated data');
  const renamed = await action(first, base, { action: 'rename', index: 1, label: 'Lift' }); receipt(renamed); assert.equal(renamed.clips.find(clip => clip.index === 1).label, 'Lift');
  const staleB = await read(second, base), moved = await action(first, base, { action: 'move', index: 1, position: 0 }); receipt(moved); assert.deepEqual(moved.order, [1, 0, 2]);
  await rejected(second, base, { expectedVersion: staleB.version, action: 'rename', index: 0, label: 'Stale' });
  const winning = await read(second, base); assert.deepEqual(winning.order, [1, 0, 2]);
  const noOpBefore = await snapshot(), noOp = await action(second, base, { action: 'rename', index: 1, label: 'Lift' }); assert(!noOp.receiptId); assert.equal(noOp.version, winning.version); assert.deepEqual(await snapshot(), noOpBefore, 'No-op changed DB/journal');
  const emptied = await action(second, base, { action: 'rename', index: 1, label: '' }); receipt(emptied); assert.equal(emptied.clips.find(clip => clip.index === 1).label, 'Same name');
  await undoOk(keyB.token, 'Clips Native B', emptied); assert.equal((await read(first, base)).clips.find(clip => clip.index === 1).label, 'Lift');
  const repeatBefore = await snapshot(), repeat = await undo(keyB.token, 'Clips Native B', receipt(emptied), false); assert.equal(repeat.ok, false); assert.equal(repeat.code, 'already-undone'); assert.deepEqual(await snapshot(), repeatBefore);
  const reset = await action(second, base, { action: 'reset' }); receipt(reset); assert.deepEqual(reset.order, [0, 1, 2]); assert.deepEqual(reset.clips, fixture.clips); assert(!Object.hasOwn((await renderer('__clipsNativeRead', {})).document.root, 'animationPresentation'));
  await undoOk(keyA.token, 'Clips Native A', reset); assert.deepEqual((await read(first, base)).order, [1, 0, 2]);
  const rejectedBefore = await snapshot(), staleUndo = await undo(keyA.token, 'Clips Native A', receipt(renamed)); assert.equal(staleUndo.ok, false); assert.deepEqual(await snapshot(), rejectedBefore, 'Stale Undo overwrote winner');
  const current = await read(first, base);
  for (const args of [{ action: 'rename', index: -1, label: 'Invalid' }, { action: 'rename', index: 3, label: 'Invalid' }, { action: 'move', index: 1, position: 3 }, { action: 'reset', index: 0 }, { action: 'rename', index: 1, label: 'Invalid', position: 0 }]) await rejected(first, base, { expectedVersion: current.version, ...args });
  for (const scope of [{ ...base, eraId: 'absent-native-era' }, { ...base, modelId: fixture.controlModelId }]) { const before = await snapshot(), missing = await call(first, GET, scope); assert.equal(missing.isError, true); assert.deepEqual(await snapshot(), before); }
  await bridge.setBridgeConfig({ writesEnabled: false }); const disabledBefore = await snapshot();
  const disabled = await call(first, ACTION, { ...base, expectedVersion: current.version, action: 'reset' }, false); assert.equal(disabled.isError, true); assert.equal(disabled.value.code, 'writes-disabled');
  inventory(await read(second, era), era); const disabledUndo = await undo(keyA.token, 'Clips Native A', receipt(reset), false); assert.equal(disabledUndo.ok, false); assert.equal(disabledUndo.code, 'writes-disabled'); assert.deepEqual(await snapshot(), disabledBefore); await bridge.setBridgeConfig({ writesEnabled: true });
  const eraEdit = await action(first, era, { action: 'rename', index: 2, label: 'Era depth' }); assert.match(eraEdit.version, /^variant:\d+$/); assert.equal((await read(second, base)).clips.find(clip => clip.index === 2).label, 'animation_2');
  await undoOk(keyB.token, 'Clips Native B', eraEdit); assert.equal((await renderer('__clipsNativeRead', { eraId: fixture.eraId })).provenance, 'base');
  const baseAfterInheritance = await action(second, base, { action: 'rename', index: 2, label: 'New Base depth' }); receipt(baseAfterInheritance); assert.equal((await read(first, era)).clips.find(clip => clip.index === 2).label, 'New Base depth');
  assert.equal((await read(second, { ...base, eraId: fixture.siblingEraId })).clips.find(clip => clip.index === 2).label, 'New Base depth');
  const ownBefore = await renderer('__clipsNativeRead', { eraId: fixture.ownEraId }), ownEdit = await action(second, own, { action: 'move', index: 2, position: 0 }); assert.deepEqual(ownEdit.order, [2, 0, 1]);
  await undoOk(keyA.token, 'Clips Native A', ownEdit); const ownAfter = await renderer('__clipsNativeRead', { eraId: fixture.ownEraId }); assert.equal(ownAfter.provenance, 'variant'); assert.deepEqual(ownAfter.document, ownBefore.document);
  const guardBefore = await snapshot(), absentReceipt = await undo(keyB.token, 'Clips Native B', 2147483647, false); assert.equal(absentReceipt.ok, false); assert.deepEqual(await snapshot(), guardBefore);
  const audit = await bridge.readAudit(500);
  for (const label of ['Clips Native A', 'Clips Native B']) { assert(audit.some(row => row.tool === ACTION && row.ok && row.origin === 'bridge' && row.client === 'mcp-stdio' && row.keyLabel === label), 'Missing authenticated stdio write audit ' + label); assert(audit.some(row => row.tool === '__undo' && row.ok && row.keyLabel === label), 'Missing authenticated HTTP Undo audit ' + label); }
  for (const row of audit.filter(row => row.tool === ACTION && row.before !== undefined)) { assert(row.before && typeof row.before === 'object' && !Array.isArray(row.before)); assert.equal(Object.keys(row.before).length, 1); assert.equal(typeof Object.values(row.before)[0], 'string'); assert(JSON.stringify(row.before).length < 512); assert(!JSON.stringify(row.before).includes('base64')); }
  save('audit.json', audit); const keys = await bridge.bridgeKeys.list(), keyUsage = [keyA.key.id, keyB.key.id].map(id => { const key = keys.find(value => value.id === id); assert.equal(typeof key.lastUsedAt, 'number'); return { label: key.label, lastUsedAt: key.lastUsedAt }; }); save('key-usage.json', keyUsage);
  await checkpoint('final-before-cleanup'); save('committed-notices.json', await renderer('__clipsNativeNotices'));
  const cleanup = await renderer('__clipsNativeCleanup'); assert.deepEqual(cleanup, { projects: 0, journal: 0, listeners: 0, initialTablesExact: true }); save('after-cleanup.json', { cleanup, tables: await renderer('__clipsNativeTables') });
  await first.close(); await second.close(); await finish(0);
}
run().catch(error => { failure = error.stack || String(error); console.error(failure); void finish(1); });
