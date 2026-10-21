// Native route for the saved world look: MCP stdio -> HTTP -> executor -> IPC ->
// renderer handlers -> isolated IndexedDB, plus the HTTP undo of the audit line.
const { app, BrowserWindow, ipcMain } = require('electron');
const { build } = require('esbuild');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-look-transport-'));
app.setPath('userData', path.join(directory, 'profile'));
let bridge, child, win;
async function main() {
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); process.env.WH_AIBRIDGE_PORT = String(port);
  const shared = { bundle: true, logLevel: 'warning', alias: { '@': path.join(root, 'src') } };
  const nativeFile = path.join(directory, 'native.cjs');
  await build({ ...shared, stdin: { contents: `export * from './electron/aibridge/server'; export * from './electron/aibridge/state'; export * from './electron/aibridge/rpc';`, resolveDir: root }, platform: 'node', format: 'cjs', external: ['electron'], outfile: nativeFile });
  const adapter = path.join(directory, 'mcp.cjs');
  await build({ ...shared, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], platform: 'node', format: 'cjs', outfile: adapter });
  await build({ ...shared, entryPoints: [path.join(root, 'tests/world-presentation-transport.renderer.ts')], platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(directory, 'renderer.js'), loader: { '.css': 'empty' }, banner: { js: 'const __qaEmptyGlob = () => ({});' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob': '__qaEmptyGlob', 'import.meta.url': '"file:///transport-test.js"' } });
  fs.writeFileSync(path.join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:fn=>{const listener=(_,payload)=>fn(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener)},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});`);
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>');
  await app.whenReady(); bridge = require(nativeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true }); const token = await bridge.getBridgeToken();
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, win.webContents); bridge.resolveBridgeReply(payload); });
  win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  bridge.setBridgeWindowResolver(() => win);
  await win.loadFile(path.join(directory, 'index.html')); const deadline = Date.now() + 30000;
  while (!await win.webContents.executeJavaScript('window.__transportReady === true')) { if (Date.now() > deadline) throw Error('Renderer fixture did not start'); await new Promise(resolve => setTimeout(resolve, 40)); }
  await bridge.startAiBridge({ version: 'synthetic-qa', hasWindow: () => true });
  const url = `http://127.0.0.1:${port}`, auth = { Authorization: `Bearer ${token}` };
  const catalog = await (await fetch(`${url}/api/tools`, { headers: auth })).json();
  const getTool = catalog.tools.find(tool => tool.name === 'wh_get_world_presentation'), setTool = catalog.tools.find(tool => tool.name === 'wh_set_world_presentation');
  assert(getTool && setTool, 'Catalogue lacks the look tools'); assert(JSON.stringify(setTool).includes('eraId'), 'Look tool lacks era scope');
  child = spawn(process.execPath, [adapter], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: token, WH_BRIDGE_URL: url } });
  const lines = createInterface({ input: child.stdout }), pending = new Map(); let sequence = 0, stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  lines.on('line', line => { const reply = JSON.parse(line), item = pending.get(reply.id); if (item) { clearTimeout(item.timer); pending.delete(reply.id); item.resolve(reply); } });
  const rpc = (method, params) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error(`MCP ${method} timed out: ${stderr.slice(-500)}`)); }, 45000); pending.set(id, { resolve, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const raw = async (name, args) => { const reply = await rpc('tools/call', { name, arguments: args }); assert(!reply.error, `${name}: JSON-RPC error`); return { ok: !reply.result.isError, result: JSON.parse(reply.result.content.find(block => block.type === 'text').text) }; };
  const call = async (name, args) => { const reply = await raw(name, args); assert(reply.ok, `${name}: ${JSON.stringify(reply.result)}`); return reply.result; };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-look-test', version: '1' } });
  const listed = await rpc('tools/list', {}); assert(listed.result.tools.some(tool => tool.name === 'wh_set_world_presentation'), 'stdio list lacks wh_set_world_presentation');
  const worldId = 'look-transport-world', projectId = 'look-transport';
  const read = await call('wh_get_world_presentation', { projectId, worldId });
  assert.equal(read.revision, 0); assert.equal(read.effective.theme, 'wonder'); assert.deepEqual(read.saved, {});
  const set = await call('wh_set_world_presentation', { projectId, worldId, theme: 'survey', layers: { roads: false }, expectedRevision: 0 });
  assert.equal(set.revision, 1); assert.equal(set.effective.layers.roads, false);
  const stale = await raw('wh_set_world_presentation', { projectId, worldId, theme: 'antique', expectedRevision: 0 });
  assert(!stale.ok && /changed|revision/i.test(JSON.stringify(stale.result)), `Stale revision passed: ${JSON.stringify(stale.result)}`);
  let row = await win.webContents.executeJavaScript('window.__lookRow()');
  assert.equal(row.presentation.theme, 'survey'); assert.equal(row.revision, 1);
  const audit = await (await fetch(`${url}/api/audit?limit=20`, { headers: auth })).json();
  const entry = audit.entries.find(item => item.index === set._undo?.audit_index);
  assert(entry && entry.before.__worldPresentation, `Audit lacks presentation receipt: ${JSON.stringify(set._undo)}`);
  await win.webContents.executeJavaScript('window.__lookTouch()');
  const undo = await (await fetch(`${url}/api/undo`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ index: set._undo.audit_index }) })).json();
  row = await win.webContents.executeJavaScript('window.__lookRow()');
  assert(undo && row.presentation.theme === undefined && row.presentation.layers?.roads === undefined && row.presentation.skin3D === 'arcilla', `HTTP undo wrong: ${JSON.stringify({ undo, row })}`);
  let rendered; for (let attempt = 0; attempt < 60; attempt++) { rendered = await call('wh_render_world_map', { projectId, worldId, width: 160 }); if (!rendered.pending) break; await new Promise(resolve => setTimeout(resolve, 1000)); }
  assert.equal(rendered.theme, 'wonder', JSON.stringify(rendered).slice(0, 400));
  console.log('PASS Native stdio catalogue lists wh_get/wh_set_world_presentation with era scope');
  console.log('PASS Native set with CAS writes the isolated row; a stale revision is refused without writing');
  console.log('PASS Audit line carries the receipt; HTTP undo restores only this change and keeps a later 3D skin change');
  console.log('PASS Native render after undo uses the restored default look');
  child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); child = null; lines.close(); bridge.stopAiBridge(); win.destroy(); app.exit(0);
}
main().catch(error => { console.error(error.stack || String(error)); child?.kill(); bridge?.stopAiBridge(); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); });
