// Two real MCP stdio sessions -> authenticated HTTP -> NativeExecutor -> IPC -> renderer.
// Undo is the existing authenticated POST /api/undo route, never a fabricated audit entry.
const { app, ipcMain } = require('electron'), { build } = require('esbuild');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process'), { createInterface } = require('node:readline');
const harness = require('../scripts/run-codex-properties-ui.cjs'), root = path.resolve(__dirname, '..'), directory = harness.directory;
process.env.HOARD_EVENTS = '0';
const evidence = path.join(root, '_stage/parity-completion-next/tools-writing', 'native-' + Date.now() + '-' + process.pid);
fs.mkdirSync(evidence, { recursive: true });
const preloadFile = path.join(directory, 'table-preload.cjs'), adapterFile = path.join(directory, 'table-stdio.cjs');
// Imperative complete shape; QuickNote is explicitly inert and no QuickNote window is started.
fs.writeFileSync(preloadFile, "const {contextBridge,ipcRenderer}=require('electron');const api={platform:process.platform};api.quickNote={setContext:()=>{},onCapture:()=>()=>{},onOpenInline:()=>()=>{},ack:()=>{}};api.aiBridge={onRequest:callback=>{const listener=(_,payload)=>callback(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener);},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)};contextBridge.exposeInMainWorld('electronAPI',api);");
let bridge, window, port, keys, driver, failure, closing = false, serverStarted = false, tableMounted = false, toolCalls = 0, rpcCalls = 0, undoCalls = 0;
const sessions = [], replies = [], transcript = [], undoTranscript = [], checks = [];
const save = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms, message) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), ms); })]); } finally { clearTimeout(timer); } }
async function close() {
  if (closing) return; closing = true; const errors = [];
  for (const session of sessions) try { await session.close(); } catch (error) { errors.push(String(error)); }
  if (bridge) bridge.stopAiBridge();
  if (serverStarted) await bounded(new Promise((resolve, reject) => { const socket = net.connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); reject(Error('Private table port still open')); }); socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error)); }), 5000, 'Table close deadline').catch(error => errors.push(String(error)));
  ipcMain.removeHandler('aibridge:reply');
  const result = { ok: !failure && errors.length === 0, toolCalls, rpcCalls, authenticatedHttpUndoCalls: undoCalls, ipcReplies: replies.length, sessions: sessions.map(session => session.report()), checks, errors, failure, privateProfile: directory, profileRetained: true, serverStarted, serverClosed: serverStarted && errors.length === 0, actualTableMounted: tableMounted, trustedPointerClaim: false, unrelatedTablesEnumerated: false };
  save('RESULT.json', result); save('mcp-transcript.json', transcript); save('http-undo-transcript.json', undoTranscript); save('ipc-replies.json', replies);
  console.log('TABLE_NATIVE_EVIDENCE ' + evidence); console.log('TABLE_NATIVE_PRIVATE_TEMP ' + directory); console.log('TABLE_NATIVE_RESULT ' + JSON.stringify(result));
  assert.equal(errors.length, 0, errors.join('\n'));
}
async function adapter(token, label) {
  const child = spawn(process.execPath, [adapterFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: token, WH_BRIDGE_TOKEN_FILE: '', WH_BRIDGE_URL: `http://127.0.0.1:${port}`, WH_BRIDGE_GROUPS: '', WH_PUBLISHING_MODULE: '', WH_MCP_NO_AUTOSTART: '0', HOARD_EVENTS: '0' } });
  const waiting = new Map(); let sequence = 0, stderr = '', ended = false, actualExit = null;
  const exit = new Promise(resolve => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', error => resolve({ error: String(error) })); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { try { const value = JSON.parse(line), pending = waiting.get(value.id); assert(pending, 'Unexpected stdio reply'); clearTimeout(pending.timer); waiting.delete(value.id); pending.resolve(value); } catch (error) { failure = String(error); for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(error); } waiting.clear(); } });
  child.once('close', () => { for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(Error('Table stdio closed before reply')); } waiting.clear(); });
  const session = {
    rpc: (method, params) => new Promise((resolve, reject) => { rpcCalls++; const id = ++sequence, timer = setTimeout(() => { waiting.delete(id); reject(Error('Table RPC deadline')); }, 25000); waiting.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }),
    close: async () => { if (ended) return; ended = true; child.stdin.end(); try { actualExit = await bounded(exit, 5000, 'Table stdio EOF deadline'); } catch (error) { child.kill(); actualExit = await bounded(exit, 3000, 'Table stdio termination deadline'); throw error; } finally { lines.close(); fs.writeFileSync(path.join(evidence, label + '.stderr.log'), stderr); } assert.deepEqual(actualExit, { code: 0, signal: null }); },
    report: () => ({ label, exit: actualExit, pending: waiting.size, stderrBytes: Buffer.byteLength(stderr) }),
  };
  sessions.push(session);
  const initialized = await session.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'table-row-order-native', version: '1' } });
  assert(!initialized.error); assert.equal(initialized.result.serverInfo.name, 'writers-hoard'); return session;
}
async function setup() {
  const reservation = net.createServer(); await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); }); port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); process.env.WH_AIBRIDGE_PORT = String(port);
  const common = { bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, logLevel: 'warning' }, bridgeFile = path.join(directory, 'table-bridge.cjs');
  await build({ ...common, stdin: { contents: "export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';", resolveDir: root }, external: ['electron'], outfile: bridgeFile });
  await build({ ...common, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], outfile: adapterFile });
  bridge = require(bridgeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true });
  keys = [await bridge.bridgeKeys.create('Table Native A'), await bridge.bridgeKeys.create('Table Native B')]; for (const key of keys) assert.equal(key.ok, true); assert.notEqual(keys[0].key.id, keys[1].key.id); assert.notEqual(keys[0].token, keys[1].token);
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, event.sender.mainFrame); replies.push({ id: payload.id, ok: payload.ok, code: payload.code }); bridge.resolveBridgeReply(payload); });
}
async function drive(win) {
  const renderer = (name, args) => win.webContents.executeJavaScript(`window.${name}(${args === undefined ? '' : JSON.stringify(args)})`);
  let fixture; const deadline = Date.now() + 45000;
  while (!fixture) { const result = await win.webContents.executeJavaScript('({ready:window.__tableNativeReady??null,result:window.__result??null})'); if (result.result?.ok === false) throw Error(result.result.error); fixture = result.ready; if (!fixture) { if (Date.now() > deadline) throw Error('Actual table renderer did not become ready'); await sleep(40); } }
  save('fixture.json', fixture); assert.equal(fixture.mountedTable, true); tableMounted = true;
  const snapshot = () => renderer('__tableNativeSnapshot'), baseline = await snapshot(); save('before.json', baseline);
  const target = { projectId: fixture.projectId, tableId: fixture.tableId }, era = { ...target, eraId: fixture.eraId }, own = { ...target, eraId: fixture.ownEraId }, GET = 'wh_table_get', EDIT = 'wh_table_edit';
  const pristine = baseline.project.dataTables.find(table => table.id === fixture.tableId);
  function conserve(state) {
    assert.deepEqual(state.control, baseline.control, 'Control project changed'); assert.deepEqual(state.journal, baseline.journal, 'Native transport created a UI journal entry');
    const project = structuredClone(state.project), expected = structuredClone(baseline.project);
    project.updatedAt = expected.updatedAt; project.dataTables = project.dataTables.map(table => table.id === fixture.tableId ? pristine : table);
    assert.deepEqual(project, expected, 'Write changed sibling table or unrelated project metadata');
    const rootTable = state.project.dataTables.find(table => table.id === fixture.tableId);
    assert.deepEqual(rootTable.columns, pristine.columns); assert.equal(rootTable.title, pristine.title);
    for (const original of pristine.rows) assert.deepEqual(rootTable.rows.find(row => row.id === original.id), original, 'Original cell/row identity changed');
    for (const added of rootTable.rows.filter(row => !pristine.rows.some(original => original.id === row.id))) assert.deepEqual(added.cells, {}, 'Inserted row gained unsolicited values');
    const permitted = row => row.projectId === fixture.projectId && row.kind === 'tables' && row.entityId === fixture.tableId && [fixture.eraId, fixture.ownEraId].includes(row.eraId);
    assert.deepEqual(state.variants.filter(row => !permitted(row)), baseline.variants.filter(row => !permitted(row)), 'Unrelated era variant changed');
    for (const row of baseline.history) assert.deepEqual(state.history.find(item => item.id === row.id), row, 'Existing history mutated');
    for (const row of state.history.filter(item => !baseline.history.some(previous => previous.id === item.id))) { assert.equal(row.projectId, fixture.projectId); assert.equal(row.kind, 'tables'); assert.equal(row.entityId, fixture.tableId); }
  }
  async function checkpoint(label) { const state = await snapshot(); conserve(state); save(label + '.json', state); return state; }
  await bridge.startAiBridge({ version: 'private-table-row-order-native', hasWindow: () => true }); serverStarted = true;
  const a = await adapter(keys[0].token, 'A'), b = await adapter(keys[1].token, 'B');
  async function call(session, name, args, relayed = true) { const prior = replies.length, response = await session.rpc('tools/call', { name, arguments: args }); toolCalls++; assert(!response.error); assert.equal(replies.length - prior, relayed ? 1 : 0, 'Native executor IPC boundary changed'); assert.equal(response.result.content.length, 1); assert.equal(response.result.content[0].type, 'text'); const outcome = { isError: response.result.isError === true, value: JSON.parse(response.result.content[0].text) }; transcript.push({ key: session.report().label, name, args, outcome, ipcReplies: replies.length - prior }); return outcome; }
  async function ok(session, name, args) { const outcome = await call(session, name, args); assert.equal(outcome.isError, false, JSON.stringify(outcome.value)); return outcome.value; }
  const read = (session, scope = target) => ok(session, GET, scope);
  async function action(session, scope, change) { const before = await read(session, scope), result = await ok(session, EDIT, { ...scope, expectedVersion: before.version, ...change }); await checkpoint('after-action-' + toolCalls); return result; }
  const index = value => { assert.equal(typeof value.receiptId, 'string'); assert(value.receiptId); assert.equal(value._undo.app_id, 'writer'); assert(Number.isSafeInteger(value._undo.audit_index)); return value._undo.audit_index; };
  async function undo(key, value, relayed = true) { const before = await snapshot(), prior = replies.length, auditIndex = typeof value === 'number' ? value : index(value), response = await fetch(`http://127.0.0.1:${port}/api/undo`, { method: 'POST', headers: { Authorization: 'Bearer ' + key.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ index: auditIndex }), signal: AbortSignal.timeout(25000) }), result = await response.json(); undoCalls++; assert.equal(replies.length - prior, relayed ? 1 : 0, 'HTTP Undo IPC boundary changed'); undoTranscript.push({ key: key.key.label, auditIndex, status: response.status, result, ipcReplies: replies.length - prior }); if (!result.ok) assert.deepEqual(await snapshot(), before, 'Rejected Undo mutated data'); else await checkpoint('after-http-undo-' + undoCalls); return result; }
  const ids = value => value.table.rows.map(row => row.id).join();
  for (const session of [a, b]) { const listed = await session.rpc('tools/list', {}); assert(!listed.error); const tools = listed.result.tools.filter(tool => tool.name === EDIT); assert.equal(tools.length, 1); assert.equal(tools[0].annotations.readOnlyHint, false); assert(tools[0].inputSchema.properties.action.enum.includes('move-row')); }
  const initial = await read(a), initialB = await read(b); assert.equal(initial.version, initialB.version); assert.equal(ids(initial), 'Alfa,Bravo,Charlie'); assert(!Object.hasOwn(initial, '__audit')); assert.deepEqual(await snapshot(), baseline, 'Readonly getter mutated fixture');
  const moved = await action(a, target, { action: 'move-row', rowId: 'Charlie', beforeRowId: 'Alfa' }); index(moved); assert.equal(ids(await read(b)), 'Charlie,Alfa,Bravo');
  const staleBefore = await snapshot(), stale = await call(b, EDIT, { ...target, expectedVersion: initialB.version, action: 'move-row', rowId: 'Bravo' }); assert.equal(stale.isError, true); assert.deepEqual(await snapshot(), staleBefore);
  const noOpBefore = await snapshot(), noOp = await action(b, target, { action: 'move-row', rowId: 'Charlie', beforeRowId: 'Alfa' }); assert(!noOp.receiptId); assert.equal(noOp.version, moved.version); assert.deepEqual(await snapshot(), noOpBefore);
  const inserted = await action(b, target, { action: 'insert-row', beforeRowId: 'Bravo' }); index(inserted); assert.equal((await read(a)).table.rows.length, 4); assert.deepEqual(inserted.row.cells, {});
  assert.equal((await undo(keys[1], inserted)).ok, true); assert.equal(ids(await read(a)), 'Charlie,Alfa,Bravo');
  const replay = await undo(keys[0], inserted, false); assert.equal(replay.ok, false); assert.equal(replay.code, 'already-undone');
  assert.equal((await undo(keys[0], moved)).ok, true); assert.equal(ids(await read(b)), 'Alfa,Bravo,Charlie');
  checks.push({ label: 'two authenticated keys, registered schema/get/edit, no-op/stale and normal HTTP Undo/replay', passed: true });
  const baseBeforeEra = await read(a), inherited = await read(a, era); assert.equal(inherited.version, baseBeforeEra.version);
  const eraEdit = await action(a, era, { action: 'move-row', rowId: 'Charlie', beforeRowId: 'Alfa' }); assert.equal(ids(await read(b, era)), 'Charlie,Alfa,Bravo'); assert.equal(ids(await read(a)), 'Alfa,Bravo,Charlie');
  assert.equal((await undo(keys[1], eraEdit)).ok, true); assert.equal((await renderer('__tableNativeRead', { eraId: fixture.eraId })).provenance, 'base');
  const ownBefore = await renderer('__tableNativeRead', { eraId: fixture.ownEraId }), ownEdit = await action(b, own, { action: 'insert-row', beforeRowId: 'Bravo' });
  assert.equal((await undo(keys[0], ownEdit)).ok, true); const ownAfter = await renderer('__tableNativeRead', { eraId: fixture.ownEraId }); assert.equal(ownAfter.provenance, 'variant'); assert.deepEqual(ownAfter.document, ownBefore.document);
  checks.push({ label: 'Base/era isolation, first override returns to inheritance, own variant preserved', passed: true });
  const invalidBefore = await snapshot(), current = await read(a);
  for (const change of [{ rowId: 'missing', beforeRowId: 'Alfa' }, { rowId: 'Alfa', beforeRowId: 'foreign' }]) { const rejected = await call(a, EDIT, { ...target, expectedVersion: current.version, action: 'move-row', ...change }); assert.equal(rejected.isError, true); assert.deepEqual(await snapshot(), invalidBefore); }
  const blocked = await call(b, EDIT, { projectId: fixture.controlId, tableId: fixture.tableId, expectedVersion: current.version, action: 'move-row', rowId: 'Alfa' }); assert.equal(blocked.isError, true); assert.deepEqual(await snapshot(), invalidBefore);
  const abort = await renderer('__tableNativeAbortProbe'); assert.deepEqual(abort, { parentAbortConserved: true, newReceiptUnavailable: true, undoAbortRetry: true, transportClaim: 'renderer domain probe, not stdio/HTTP transaction' }); checks.push({ label: 'separate real renderer root abort / receipt invalidation / Undo abort-retry', ...abort });
  const audit = await bridge.readAudit(200);
  for (const key of keys) { assert(audit.some(row => row.tool === EDIT && row.ok && row.origin === 'bridge' && row.client === 'mcp-stdio' && row.keyLabel === key.key.label), 'Missing authenticated edit for ' + key.key.label); assert(audit.some(row => row.tool === '__undo' && row.ok && row.keyLabel === key.key.label), 'Missing authenticated HTTP Undo for ' + key.key.label); const used = (await bridge.bridgeKeys.list()).find(item => item.id === key.key.id); assert.equal(typeof used.lastUsedAt, 'number'); }
  for (const row of audit.filter(row => row.tool === EDIT && row.before !== undefined)) { assert.deepEqual(Object.keys(row.before), ['__tableRowReceipt']); assert.equal(typeof row.before.__tableRowReceipt, 'string'); assert(JSON.stringify(row.before).length < 512); }
  save('audit.json', audit); await checkpoint('final-before-cleanup');
  const cleanup = await renderer('__tableNativeCleanup'); assert.deepEqual(cleanup, { projects: 0, variants: 0 }); save('cleanup.json', cleanup);
  await a.close(); await b.close(); await close(); await win.webContents.executeJavaScript('window.__tableNativeComplete={ok:true};0');
}
process.argv[2] = 'tests/table-row-order.native.renderer.ts'; process.argv[3] = 'testTableRowOrderNative';
harness.main({ preloadFile, setup, window: async win => { window = win; bridge.setBridgeWindowResolver(() => win); win.webContents.once('did-finish-load', () => { driver = drive(win).catch(async error => { failure = error.stack || String(error); console.error(failure); await win.webContents.executeJavaScript(`window.__tableNativeComplete=${JSON.stringify({ ok: false, error: failure })};0`).catch(() => {}); }); }); }, close: async () => { await driver; if (failure) throw Error(failure); await close(); } }).catch(async error => { failure = error.stack || String(error); console.error(failure); try { await close(); } finally { app.exit(1); } });
