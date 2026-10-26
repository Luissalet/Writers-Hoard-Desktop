// Two actual MCP stdio keys -> private normal Mainbridge HTTP -> Native executor -> IPC -> real Vite renderer.
// Read-only plans: no Undo endpoint, synthetic tool response, worker rewrite or product adapter.
const { app, BrowserWindow, ipcMain } = require('electron'), { build } = require('esbuild');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process'), { createInterface } = require('node:readline'), { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-directions-native-'));
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
  const result = { ok: !failure && errors.length === 0, toolCalls, rpcCalls, ipcReplies: replies.length, sessions: sessions.map(session => session.report()), checks, unauthorizedStatus, serverStarted, serverClosed, privateProfile: directory, errors, failure: failure && scrub(failure), rendererTransport: 'existing Vite (WH_TEST_BASE_URL or localhost63395); actual renderer dispatch and reader/planner', printedTokens: false };
  save('RESULT.json', result); save('mcp-transcript.json', transcript); save('ipc-replies.json', replies);
  console.log('DIRECTIONS_NATIVE_EVIDENCE ' + evidence); console.log('DIRECTIONS_NATIVE_RESULT ' + JSON.stringify(result)); assert.equal(errors.length, 0, errors.join('\n'));
}
async function adapter(token, label) {
  const child = spawn(process.execPath, [adapterFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: token, WH_BRIDGE_TOKEN_FILE: '', WH_BRIDGE_URL: `http://127.0.0.1:${port}`, WH_BRIDGE_GROUPS: '', WH_PUBLISHING_MODULE: '', WH_MCP_NO_AUTOSTART: '0', HOARD_EVENTS: '0' } });
  const waiting = new Map(); let sequence = 0, stderr = '', ended = false, actualExit = null;
  const exit = new Promise(resolve => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', error => resolve({ error: scrub(error) })); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { try { const value = JSON.parse(line), pending = waiting.get(value.id); assert(pending, 'Unexpected stdio reply'); clearTimeout(pending.timer); waiting.delete(value.id); pending.resolve(value); } catch (error) { failure = scrub(error); for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(error); } waiting.clear(); } });
  child.once('close', () => { for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(Error('Directions stdio closed before reply')); } waiting.clear(); });
  const session = {
    rpc: (method, params) => new Promise((resolve, reject) => { rpcCalls++; const id = ++sequence, timer = setTimeout(() => { waiting.delete(id); reject(Error('Directions RPC deadline')); }, 30000); waiting.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }),
    close: async () => { if (ended) return; ended = true; child.stdin.end(); try { actualExit = await bounded(exit, 5000, 'Directions stdio EOF deadline'); } catch (error) { child.kill(); actualExit = await bounded(exit, 3000, 'Directions stdio termination deadline'); throw error; } finally { lines.close(); fs.writeFileSync(path.join(evidence, label + '.stderr.log'), scrub(stderr)); } assert.deepEqual(actualExit, { code: 0, signal: null }); },
    report: () => ({ label, exit: actualExit, pending: waiting.size, stderrBytes: Buffer.byteLength(stderr) }),
  };
  sessions.push(session); const initialized = await session.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'world-directions-native', version: '1' } }); assert(!initialized.error); assert.equal(initialized.result.serverInfo.name, 'writers-hoard'); return session;
}
async function setup() {
  const reservation = net.createServer(); await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); }); port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); process.env.WH_AIBRIDGE_PORT = String(port);
  const common = { bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, logLevel: 'warning' }, bridgeFile = path.join(directory, 'bridge.cjs');
  await build({ ...common, stdin: { contents: "export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';", resolveDir: root }, external: ['electron'], outfile: bridgeFile });
  await build({ ...common, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], outfile: adapterFile });
  bridge = require(bridgeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: false });
  keys = [await bridge.bridgeKeys.create('Directions Native A'), await bridge.bridgeKeys.create('Directions Native B')]; for (const key of keys) assert.equal(key.ok, true); assert(keys[0].key.id !== keys[1].key.id && keys[0].token !== keys[1].token, 'Two distinct real keys required');
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, event.sender.mainFrame); replies.push({ id: payload.id, ok: payload.ok, code: payload.code }); bridge.resolveBridgeReply(payload); });
}
async function drive() {
  const renderer = (name, args) => win.webContents.executeJavaScript(`window.${name}(${args === undefined ? '' : JSON.stringify(args)})`);
  let fixture; const deadline = Date.now() + 150000;
  while (!fixture) { const state = await win.webContents.executeJavaScript('({ready:window.__directionsNativeReady??null,result:window.__result??null})'); if (state.result?.ok === false) throw Error(state.result.error); fixture = state.ready; if (!fixture) { if (Date.now() > deadline) throw Error('Prepared normal Directions renderer did not become ready'); await sleep(40); } }
  save('fixture.json', fixture); assert.notDeepEqual(fixture.sourceTorre, fixture.resolvedTorre, 'Fixture must distinguish source from resolved landmark position');
  const snapshot = () => renderer('__directionsNativeSnapshot'), baseline = await snapshot(), cacheBefore = await renderer('__directionsNativeCache'); save('before.json', baseline); save('cache-before.json', cacheBefore);
  const auditBefore = await bridge.readAudit(200);
  await bridge.startAiBridge({ version: 'private-world-directions-native', hasWindow: () => true }); serverStarted = true;
  const a = await adapter(keys[0].token, 'A'), b = await adapter(keys[1].token, 'B');
  for (const session of [a, b]) { const listed = await session.rpc('tools/list', {}); assert(!listed.error); const plans = listed.result.tools.filter(tool => tool.name === 'wh_plan_journey'); assert.equal(plans.length, 1); assert.equal(plans[0].annotations.readOnlyHint, true); assert.equal(plans[0].inputSchema.properties.stops.minItems, 2); save('manifest-' + session.report().label + '.json', plans[0]); }
  async function call(session, args) {
    const prior = replies.length, response = await session.rpc('tools/call', { name: 'wh_plan_journey', arguments: args }); toolCalls++; assert(!response.error); assert.equal(replies.length - prior, 1, 'Plan must cross actual Native executor IPC exactly once'); assert.equal(response.result.content.length, 1); assert.equal(response.result.content[0].type, 'text');
    const outcome = { isError: response.result.isError === true, value: JSON.parse(response.result.content[0].text) }; transcript.push({ key: session.report().label, name: 'wh_plan_journey', args, outcome, ipcReplies: replies.length - prior }); assert.deepEqual(await snapshot(), baseline, 'Read-only plan or rejection mutated business documents/variants/history/links/journal'); return outcome;
  }
  const cases = [
    { selectedEnd: 'from', mode: 'horse', season: 'winter', setOffHour: 9 },
    { selectedEnd: 'to', mode: 'foot', season: 'summer', setOffHour: 7 },
    { eraId: fixture.eraId, selectedEnd: 'from', mode: 'horse', season: 'autumn', setOffHour: 5 },
    { eraId: fixture.eraId, selectedEnd: 'to', mode: 'foot', season: 'spring', setOffHour: 11 },
  ];
  for (const plan of cases) {
    const expected = await renderer('__directionsNativeExpected', plan), order = plan.selectedEnd === 'from' ? [fixture.torreKey, fixture.faroKey] : [fixture.faroKey, fixture.torreKey];
    const args = { projectId: fixture.projectId, eraId: plan.eraId, worldId: fixture.worldId, stops: order.map(place => ({ place })), mode: plan.mode, season: plan.season, setOffHour: plan.setOffHour, locale: 'en' };
    let first;
    for (const session of [a, b]) {
      const outcome = await call(session, args); assert.equal(outcome.isError, false, JSON.stringify(outcome.value)); const value = outcome.value; assert(!value.pending && !value.impossible, 'Prepared actual plan must finish');
      for (const key of ['stops', 'mode', 'season', 'pace', 'km', 'directKm', 'hours', 'days', 'hoursPerDay']) assert.deepEqual(value[key], expected[key], 'Actual planner differs at ' + key);
      assert.equal(value.clock.setsOff, expected.setOff); assert.deepEqual(value.path[0], expected.first); assert.deepEqual(value.path.at(-1), expected.last); assert(!Object.hasOwn(value, '_undo') && !Object.hasOwn(value, '__audit'), 'Read-only plan gained a write receipt');
      if (first) assert.deepEqual(value, first, 'Two authenticated keys observed different plan'); else first = value;
    }
    checks.push({ scope: plan.eraId ?? 'Base', selectedEnd: plan.selectedEnd, stops: expected.stops, mode: plan.mode, season: plan.season, setOffHour: plan.setOffHour, pace: expected.pace, twoKeysMatchPlanner: true });
  }
  const validArgs = { projectId: fixture.projectId, worldId: fixture.worldId, stops: [{ place: fixture.torreKey }, { place: fixture.faroKey }] };
  for (const [session, args] of [[a, { ...validArgs, projectId: fixture.controlId }], [b, { ...validArgs, stops: [{ place: fixture.torreKey }, { place: 'landmark:missing' }] }]]) { const rejected = await call(session, args); assert.equal(rejected.isError, true, 'Foreign project or missing place accepted'); }
  const prior = replies.length, denied = await fetch(`http://127.0.0.1:${port}/api/call`, { method: 'POST', headers: { Authorization: 'Bearer deliberately-invalid-native-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'wh_plan_journey', args: validArgs }), signal: AbortSignal.timeout(10000) }); unauthorizedStatus = denied.status; assert.equal(unauthorizedStatus, 401); assert.equal(replies.length, prior, 'Unauthorized HTTP reached renderer'); assert.deepEqual(await snapshot(), baseline);
  const usedKeys = await bridge.bridgeKeys.list();
  for (const key of keys) { const used = usedKeys.find(row => row.id === key.key.id); assert(used && typeof used.lastUsedAt === 'number', 'Real key usage missing'); }
  save('key-usage.json', usedKeys.filter(row => keys.some(key => key.key.id === row.id)).map(({ id, label, lastUsedAt }) => ({ id, label, lastUsedAt })));
  assert.deepEqual(await bridge.readAudit(200), auditBefore, 'Read-only planner unexpectedly appended a write audit');
  const cacheAfter = await renderer('__directionsNativeCache');
  const stableCache = rows => rows.map(({ savedAt, ...row }) => row).sort((x, y) => x.worldId.localeCompare(y.worldId)); assert.deepEqual(stableCache(cacheAfter), stableCache(cacheBefore), 'Plan changed generated snapshot content'); save('cache-after.json', cacheAfter);
  save('after.json', await snapshot()); checks.push({ readonlyBusinessData: true, snapshotContent: 'exact; incumbent reader may touch savedAt cache timestamp', invalidScopeAndPlaceRejected: true, unauthorizedHttpNoIpc: true, writeAuditUnchanged: true });
  const cleanup = await renderer('__directionsNativeCleanup'); assert.deepEqual(cleanup, { projects: 0, worlds: 0, variants: 0, history: 0, links: 0, ownedSnapshots: 0, journalEntries: 0 }); save('cleanup.json', cleanup);
  await a.close(); await b.close(); await close(); await win.webContents.executeJavaScript('window.__directionsNativeComplete={ok:true};0');
}
(async () => {
  await app.whenReady(); await setup();
  win = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { preload: preloadFile, contextIsolation: true, sandbox: true, backgroundThrottling: false } }); win.removeMenu(); bridge.setBridgeWindowResolver(() => win);
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error(scrub(details.message)); });
  win.webContents.on('render-process-gone', (_event, details) => { failure = 'Directions renderer gone ' + details.reason; void close().finally(() => app.exit(1)); });
  const baseURL = process.env.WH_TEST_BASE_URL || 'http://127.0.0.1:63395';
  await win.loadURL(new URL('/tests/world-place-directions.native.html', baseURL).href);
  driver = drive().catch(async error => { failure = scrub(error.stack || error); console.error(failure); await win.webContents.executeJavaScript(`window.__directionsNativeComplete=${JSON.stringify({ ok: false, error: failure })};0`).catch(() => {}); });
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) { const result = await win.webContents.executeJavaScript('window.__result??null'); if (result) { await driver; if (!result.ok) throw Error(result.error); if (failure) throw Error(failure); for (const test of result.tests) console.log('PASS ' + test); await close(); win.destroy(); app.exit(0); return; } await sleep(40); }
  throw Error('Native Directions completion deadline');
})().catch(async error => { failure = scrub(error.stack || error); console.error(failure); try { await close(); } finally { if (win && !win.isDestroyed()) win.destroy(); app.exit(1); } });
