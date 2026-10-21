// Full native route: MCP stdio -> HTTP -> executor -> IPC -> renderer tools -> IndexedDB.
// The profile, token, listener, data and child adapter are all isolated and temporary.
const { app, BrowserWindow, ipcMain } = require('electron');
const { build } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-history-transport-'));
app.setPath('userData', path.join(directory, 'profile'));
let bridge, child, win;
async function main() {
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); process.env.WH_AIBRIDGE_PORT = String(port);
  const shared = { bundle: true, logLevel: 'warning', alias: { '@': path.join(root, 'src') } };
  const nativeFile = path.join(directory, 'native.cjs');
  await build({ ...shared, stdin: { contents: `export * from './electron/aibridge/server'; export * from './electron/aibridge/state'; export * from './electron/aibridge/rpc'; export { DEFAULT_PARAMS } from './src/engines/worldgen/core/types'; export { defaultWorldCalendar } from './src/engines/timeline/worldCalendar';`, resolveDir: root }, platform: 'node', format: 'cjs', external: ['electron'], outfile: nativeFile });
  const adapter = path.join(directory, 'mcp.cjs');
  await build({ ...shared, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], platform: 'node', format: 'cjs', outfile: adapter });
  await build({ ...shared, entryPoints: [path.join(root, 'tests/document-history-transport.renderer.ts')], platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(directory, 'renderer.js'), loader: { '.css': 'empty' }, banner: { js: 'const __qaEmptyGlob = () => ({});' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob': '__qaEmptyGlob', 'import.meta.url': '"file:///transport-test.js"' } });
  fs.writeFileSync(path.join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:fn=>{const listener=(_,payload)=>fn(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener)},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});`);
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>');
  await app.whenReady(); bridge = require(nativeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true }); const token = await bridge.getBridgeToken();
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, win.webContents); bridge.resolveBridgeReply(payload); });
  win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  bridge.setBridgeWindowResolver(() => win);
  await win.loadFile(path.join(directory, 'index.html')); const deadline = Date.now() + 30000;
  while (!await win.webContents.executeJavaScript('window.__transportReady === true')) { if (Date.now() > deadline) throw Error('Renderer fixture did not start'); await new Promise(resolve => setTimeout(resolve, 40)); }
  await bridge.startAiBridge({ version: 'synthetic-qa', hasWindow: () => true });
  const url = `http://127.0.0.1:${port}`;
  const catalog = await (await fetch(`${url}/api/tools`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert(catalog.tools.some(tool => tool.name === 'wh_model_import') && catalog.tools.some(tool => tool.name === 'wh_sheet_coc_action') && catalog.tools.some(tool => tool.name === 'wh_radar_set_value'));
  child = spawn(process.execPath, [adapter], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: token, WH_BRIDGE_URL: url } });
  const lines = createInterface({ input: child.stdout }), pending = new Map(); let sequence = 0, stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  lines.on('line', line => { const reply = JSON.parse(line), item = pending.get(reply.id); if (item) { clearTimeout(item.timer); pending.delete(reply.id); item.resolve(reply); } });
  const rpc = (method, params) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error(`MCP ${method} timed out: ${stderr.slice(-500)}`)); }, 45000); pending.set(id, { resolve, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (name, args) => { const reply = await rpc('tools/call', { name, arguments: args }); assert(!reply.error, `${name}: JSON-RPC error`); const content = JSON.parse(reply.result.content.find(block => block.type === 'text').text); assert(!reply.result.isError, `${name}: ${JSON.stringify(content)}`); return content; };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-authoring-test', version: '1' } });
  const projectId = 'transport-world';
  const card=await call('wh_create_codex_entry',{projectId,title:'Before native edit',type:'location'}),scope={projectId,kind:'codex',entityId:card.id};
  let listed=await call('wh_document_history_list',scope);assert.equal(listed.versions.length,0);
  await call('wh_update_codex_entry',{projectId,id:card.id,title:'After native edit'});
  listed=await call('wh_document_history_list',scope);assert.equal(listed.versions.length,1);assert.equal(listed.versions[0].document,undefined);
  assert((await call('wh_document_history_list',{projectId})).documents.some(row=>row.entityId===card.id));
  const selected=await call('wh_document_history_get',{...scope,historyId:listed.versions[0].id});assert.equal(selected.document.root.title,'Before native edit');
  const retained=await call('wh_document_history_save',{...scope,expectedVersion:listed.current.version});assert.equal(retained.reason,'manual');
  let restored=await call('wh_document_history_restore',{...scope,historyId:selected.id,expectedVersion:listed.current.version});assert.equal((await call('wh_get_codex_entry',{projectId,id:card.id})).title,'Before native edit');
  await call('wh_document_history_undo',restored.undo);assert.equal((await call('wh_get_codex_entry',{projectId,id:card.id})).title,'After native edit');
  const stale=await rpc('tools/call',{name:'wh_document_history_restore',arguments:{...scope,historyId:selected.id,expectedVersion:listed.current.version}});assert(stale.result.isError,'Stale restore overwrote later present');
  await win.webContents.executeJavaScript(`__historyDelete(${JSON.stringify(card.id)})`);restored=await call('wh_document_history_restore',{...scope,historyId:selected.id,expectedVersion:null});assert.equal(restored.undo.historyId,null);await call('wh_document_history_undo',restored.undo);assert.equal((await call('wh_document_history_list',scope)).current,null);
  const template=await call('wh_save_codex_template',{projectId,expectedRevision:null,template:{name:'Cargo history',category:'custom',fields:{crates:'3',total:''},content:'',propertyDefinitions:[{id:'crates',key:'crates',label:'Crates',kind:'number'},{id:'total',key:'total',label:'Total',kind:'number',formula:'=@[Crates]*7'}]}});
  const cargo=await call('wh_create_codex_entry',{projectId,title:'Cargo history',templateId:template.template.id}),cargoScope={projectId,kind:'codex',entityId:cargo.id};await call('wh_update_codex_entry',{projectId,id:cargo.id,fields:{crates:'4'}});const beforeRetirement=(await call('wh_document_history_list',cargoScope)).versions[0];await call('wh_delete_codex_template',{projectId,templateId:template.template.id,expectedRevision:template.template.revision});await call('wh_document_history_restore',{...cargoScope,historyId:beforeRetirement.id,expectedVersion:(await call('wh_document_history_list',cargoScope)).current.version});assert.equal((await call('wh_get_codex_entry',{projectId,id:cargo.id})).fields.total,'21');await call('wh_update_codex_entry',{projectId,id:cargo.id,fields:{crates:'5'}});assert.equal((await call('wh_get_codex_entry',{projectId,id:cargo.id})).fields.total,'35');
  const audit=await(await fetch(url+'/api/audit',{headers:{Authorization:`Bearer ${token}`}})).json();assert(audit.entries.some(entry=>entry.tool==='wh_document_history_restore'&&entry.ok));
  console.log('PASS native stdio→HTTP→executor→IPC history discovery/metadata-only list/get/manualsave/CAS restore/Undo, null restore of deleted doc preserved newer present and live formulas after retiring its type');
  child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));child=null;lines.close();bridge.stopAiBridge();win.destroy();app.exit(0);

}
main().catch(error => { console.error(error.stack || String(error)); child?.kill(); bridge?.stopAiBridge(); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); });
