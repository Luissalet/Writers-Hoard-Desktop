// Real stdio MCP -> HTTP -> executor -> product preload/IPC -> CPU model -> IndexedDB.
// All rows/profile are synthetic. Model caches are explicit existing local directories.
const { app, BrowserWindow, ipcMain } = require('electron');
const { build } = require('esbuild');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { createInterface } = require('node:readline');
const assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'work/local-classifiers-transport');
const directory = path.join(output, 'run-' + Date.now()); fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', path.join(directory, 'profile'));
let bridge, child, win, entity, visual;
const trace = [], receipt = { directory, trace, checks: [] };
async function main() {
  const [entityCache, visualCache, pageFile] = process.argv.slice(2); for (const value of [entityCache, visualCache, pageFile]) assert(path.isAbsolute(value), 'Pass entity cache, visual cache and page fixture absolute paths');
  const mapFile = path.join(root, '.impeccable/review/maps-depth/continents-wonder-country-cpu.png');
  receipt.fixtures = [mapFile, pageFile].map(file => ({ file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); process.env.WH_AIBRIDGE_PORT = String(port);
  const shared = { bundle: true, logLevel: 'warning', alias: { '@': path.join(root, 'src') } };
  const nativeFile = path.join(directory, 'native.cjs'), adapter = path.join(directory, 'mcp.cjs'), preload = path.join(directory, 'preload.cjs');
  await build({ ...shared, stdin: { contents: `export * from './electron/aibridge/server';export * from './electron/aibridge/state';export * from './electron/aibridge/rpc';`, resolveDir: root }, platform: 'node', format: 'cjs', external: ['electron'], outfile: nativeFile });
  await build({ ...shared, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], platform: 'node', format: 'cjs', outfile: adapter });
  await build({ ...shared, entryPoints: [path.join(root, 'electron/preload.ts')], platform: 'node', format: 'cjs', external: ['electron'], outfile: preload });
  await build({ ...shared, entryPoints: [path.join(root, 'tests/local-classifiers-transport.renderer.ts')], platform: 'browser', format: 'iife', outfile: path.join(directory, 'renderer.js'), jsx: 'automatic', loader: { '.css': 'empty' }, banner: { js: 'const __qaEmptyGlob=()=>({});' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob': '__qaEmptyGlob', 'import.meta.url': '"file:///classifier-transport.js"' } });
  for (const family of ['entityDetection', 'visualSearch']) {
    const target = path.join(directory, family); fs.mkdirSync(target);
    for (const name of ['ipc', 'runtime', 'worker']) await build({ ...shared, entryPoints: [path.join(root, `electron/${family}/${name}.ts`)], platform: 'node', format: 'cjs', external: ['electron', '@huggingface/transformers'], outfile: path.join(target, `${name}.cjs`) });
    fs.writeFileSync(path.join(target, 'blocked-worker.cjs'), `globalThis.fetch=()=>{throw Error('NETWORK_BLOCKED')};require('./worker.cjs');`);
  }
  // Worker modules resolve their physical dependencies through this worktree.
  const { EntityDetectionRuntime } = require(path.join(directory, 'entityDetection/runtime.cjs'));
  const { VisualSearchRuntime } = require(path.join(directory, 'visualSearch/runtime.cjs'));
  entity = new EntityDetectionRuntime(entityCache, path.join(directory, 'entityDetection/blocked-worker.cjs'));
  visual = new VisualSearchRuntime(visualCache, path.join(directory, 'visualSearch/blocked-worker.cjs'));
  const owner = event => assert.equal(event.sender, win.webContents, 'Only isolated main renderer');
  ipcMain.on('forge:memory', event => { event.returnValue = require('node:os').totalmem(); });
  require(path.join(directory, 'entityDetection/ipc.cjs')).registerEntityDetectionIpc({ handle(channel, handler) { ipcMain.handle(channel, (event, ...args) => { owner(event); return handler(event, ...args); }); } }, entity);
  require(path.join(directory, 'visualSearch/ipc.cjs')).registerVisualSearchIpc(owner, visual);
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>');
  await app.whenReady(); bridge = require(nativeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true }); const token = await bridge.getBridgeToken();
  ipcMain.handle('aibridge:reply', (event, payload) => { owner(event); bridge.resolveBridgeReply(payload); });
  win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error('RENDERER ' + details.message); });
  bridge.setBridgeWindowResolver(() => win);
  await win.loadFile(path.join(directory, 'index.html'));
  await win.webContents.executeJavaScript(`window.__classifierFixtures=${JSON.stringify([mapFile, pageFile].map(file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64')))};0`);
  const deadline = Date.now() + 30000;
  while (!await win.webContents.executeJavaScript('window.__classifiersReady===true')) { const failure = await win.webContents.executeJavaScript('window.__classifiersFailure??null'); if (failure) throw Error(failure); if (Date.now() > deadline) throw Error('Fixture did not start'); await new Promise(resolve => setTimeout(resolve, 30)); }
  await bridge.startAiBridge({ version: 'synthetic-classifier-qa', hasWindow: () => true }); const url = `http://127.0.0.1:${port}`, headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  child = spawn(process.execPath, [adapter], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: token, WH_BRIDGE_URL: url } });
  const lines = createInterface({ input: child.stdout }), pending = new Map(); let sequence = 0, stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  lines.on('line', line => { const reply = JSON.parse(line), job = pending.get(reply.id); if (job) { clearTimeout(job.timer); pending.delete(reply.id); job.resolve(reply); } });
  const rpc = (method, params) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`MCP ${method} timeout: ${stderr.slice(-400)}`)); }, 120000); pending.set(id, { resolve, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const invoke = async (name, args = {}, failure = false) => { const reply = await rpc('tools/call', { name, arguments: args }); assert(!reply.error, JSON.stringify(reply)); const body = JSON.parse(reply.result.content.find(item => item.type === 'text').text); trace.push({ name, args, failure: reply.result.isError, result: body }); assert.equal(!!reply.result.isError, failure, `${name}: ${JSON.stringify(body)}`); return body; };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-local-classifiers', version: '1' } });
  const tools = (await rpc('tools/list', {})).result.tools;
  const required = ['wh_entity_detection_status', 'wh_entity_detection_prepare', 'wh_entity_preferences', 'wh_entity_preferences_save', 'wh_entity_detect', 'wh_entity_candidate_create', 'wh_visual_search_status', 'wh_visual_search_prepare', 'wh_visual_search_images'];
  assert(required.every(name => tools.some(tool => tool.name === name))); receipt.catalog = required;
  const projectId = 'classifier-world', eraId = 'classifier-era', scope = { projectId, eraId }, text = 'María García viajó a San Sebastián para visitar la Universidad de Salamanca.';
  const original = await win.webContents.executeJavaScript('window.__classifierSnapshot()');
  await invoke('wh_entity_detection_status'); assert.equal((await invoke('wh_entity_detection_prepare')).state, 'ready');
  const initialPrefs = await invoke('wh_entity_preferences', scope); assert.equal(initialPrefs.scope, 'shared-project');
  const saved = await invoke('wh_entity_preferences_save', { ...scope, expectedRevision: initialPrefs.preferences.revision, detectNewEntities: true, autoLinkMentions: false, animateNewLinks: true });
  await invoke('wh_entity_preferences_save', { projectId, expectedRevision: initialPrefs.preferences.revision, autoLinkMentions: true }, true);
  assert.deepEqual((await invoke('wh_entity_preferences', { projectId })).preferences, saved.preferences);
  const detected = await invoke('wh_entity_detect', { projectId, text }); assert(!detected.candidates.some(item => item.text === 'María García'), 'Ambiguous known alias must be excluded');
  assert(detected.candidates.every(span => text.slice(span.from, span.to) === span.text));
  const place = detected.candidates.find(item => item.text === 'San Sebastián'), org = detected.candidates.find(item => item.text === 'Universidad de Salamanca'); assert(place && org);
  const baseCreated = await invoke('wh_entity_candidate_create', { projectId, text, candidate: place, type: 'location' });
  const eraCreated = await invoke('wh_entity_candidate_create', { ...scope, text, candidate: org, type: 'faction' });
  await invoke('wh_entity_candidate_create', { ...scope, text, candidate: org, type: 'faction' }, true);
  await invoke('wh_entity_candidate_create', { projectId, text: 'edited', candidate: org, type: 'faction' }, true);
  assert(!(await invoke('wh_entity_detect', { ...scope, text })).candidates.some(item => item.text === org.text || item.text === place.text));
  assert((await invoke('wh_entity_detect', { projectId, text })).candidates.some(item => item.text === org.text), 'Era creation must not write Base');
  const after = await win.webContents.executeJavaScript('window.__classifierSnapshot()'); assert.deepEqual(after.prose, original.prose); assert.equal(after.base.length, original.base.length + 1); assert(!after.base.some(item => item.id === eraCreated.id));
  assert(after.base.find(item => item.id === baseCreated.id).content === '' && Object.keys(after.base.find(item => item.id === baseCreated.id).fields).length === 0);
  receipt.checks.push('Six entity tools via stdio MCP, real CPU with fetch blocked; CAS/shared preferences, ambiguous aliases, exact spans, duplicate/stale-source refusal, Base/era isolation and untouched authored prose');
  const audit = await (await fetch(url + '/api/audit?limit=100', { headers })).json(); receipt.auditBeforeUndo = audit.entries;
  for (const created of [baseCreated, eraCreated]) {
    const row = audit.entries.find(item => item.index === created._undo.audit_index); assert.equal(row.tool, 'wh_entity_candidate_create'); assert.equal(row.kind, 'create'); assert.equal(row.client, 'mcp-stdio'); assert.equal(row.entityId, created.id);
    const undo = await (await fetch(url + '/api/undo', { method: 'POST', headers, body: JSON.stringify({ index: created._undo.audit_index }) })).json();
    trace.push({ undo: created._undo.audit_index, result: undo }); assert(undo.ok, `AUDIT_UNDO_FAILURE ${JSON.stringify(undo)}`);
  }
  const undone = await win.webContents.executeJavaScript('window.__classifierSnapshot()'); assert.equal(undone.base.length, original.base.length); assert(undone.eraCards.every(item => !item)); assert.deepEqual(undone.prose, original.prose);
  receipt.checks.push('Native audit rows and HTTP audit Undo reverse Base and era creations without changing source prose');
  if (process.env.WH_CLASSIFIER_ENTITY_ONLY === '1') return;
  await invoke('wh_visual_search_status'); assert.equal((await invoke('wh_visual_search_prepare')).state, 'ready');
  for (const [query, expected] of [['un mapa de montañas y costas', 'opaque-image-A'], ['a page of a book with text', 'opaque-image-B']]) {
    const ranked = await invoke('wh_visual_search_images', { projectId, query }); assert.equal(ranked.matches[0].id, expected); assert.equal(ranked.matches.length, 2); assert.equal(ranked.failed.length, 0); assert(!ranked.matches.some(item => item.id === 'foreign-image'));
  }
  assert.equal((await invoke('wh_visual_search_images', { projectId, query: 'a map', collectionId: 'collection-B' })).matches.length, 1);
  const bytes = await win.webContents.executeJavaScript('window.__visualBytes()'); receipt.visualBytes = bytes; assert(bytes.a.cached && bytes.b.cached && bytes.a.hash !== bytes.b.hash); assert(bytes.foreignRejected); assert(bytes.metadata.every(item => item.notes === '' && item.tags.length === 0 && !item.derivedInRow));
  const replaced = await invoke('wh_visual_search_images', { projectId, query: 'a map' }); assert(Math.abs(replaced.matches[0].score - replaced.matches[1].score) < 1e-8, 'Replacing pixels invalidates old cached identity');
  receipt.checks.push('Three visual tools via stdio MCP and real CPU model: Spanish/English pixel ranking, project/collection scope, foreign exclusion, image-byte cache hits/invalidation, no invented authored metadata');
  child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); child = null; lines.close();
}
main().then(async () => { receipt.ok = true; console.log(receipt.checks.map(check => 'PASS ' + check).join('\n')); }).catch(error => { receipt.ok = false; receipt.error = error.stack || String(error); console.error(receipt.error); process.exitCode = 1; }).finally(async () => { fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.log('RECEIPT ' + path.join(directory, 'receipt.json')); child?.kill(); bridge?.stopAiBridge(); await entity?.close(); await visual?.close(); if (win && !win.isDestroyed()) win.destroy(); app.exit(receipt.ok ? 0 : 1); });
