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
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-table-calculation-transport-'));
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
  await build({ ...shared, entryPoints: [path.join(root, 'tests/world-authoring-transport.renderer.ts')], platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(directory, 'renderer.js'), loader: { '.css': 'empty' }, banner: { js: 'const __qaEmptyGlob = () => ({});' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob': '__qaEmptyGlob', 'import.meta.url': '"file:///transport-test.js"' } });
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
  await call('wh_enable_engine',{projectId,engineId:'tables'});
  let template=(await call('wh_save_codex_template',{projectId,expectedRevision:null,template:{name:'Native sale',category:'item',fields:{price:''},content:'',propertyDefinitions:[{id:'native-price-id',key:'price',label:'Price',kind:'number'}]}})).template;
  const salt=await call('wh_create_codex_entry',{projectId,type:'item',title:'Salt',templateId:template.id,fields:{price:'10'}}),oil=await call('wh_create_codex_entry',{projectId,type:'item',title:'Oil',templateId:template.id,fields:{price:'30'}});await call('wh_create_codex_entry',{projectId,type:'item',title:'Other same category',fields:{price:'1000'}});
  const view=(await call('wh_table_create_type_view',{projectId,title:'Native type view',templateId:template.id})).table;let read=await call('wh_table_get',{projectId,tableId:view.id});assert.equal(read.table.rows.length,2);
  const promoted=await call('wh_table_save_calculation',{projectId,tableId:view.id,name:'Double',formula:'=@[Price]*2',resultType:'whole',expectedVersion:read.version,expectedTemplateRevision:template.revision});assert(promoted.promoted);
  let card=await call('wh_get_codex_entry',{projectId,id:salt.id});assert.equal(card.fields[promoted.column.field],'20');assert(!Object.hasOwn(card.storedFields,promoted.column.field));
  const stale=await rpc('tools/call',{name:'wh_table_save_calculation',arguments:{projectId,tableId:view.id,name:'Stale',formula:'=@[Price]*3',resultType:'decimal',expectedVersion:read.version,expectedTemplateRevision:template.revision}});assert(stale.result.isError);
  template=(await call('wh_codex_templates',{projectId})).templates.find(item=>item.id===template.id);assert(!template.propertyDefinitions.some(item=>item.label==='Stale'));
  read=await call('wh_table_get',{projectId,tableId:view.id});const share=await call('wh_table_save_calculation',{projectId,tableId:view.id,name:'Share',formula:'=@[Price]/SUM(Price)',resultType:'percent',expectedVersion:read.version});assert(!share.promoted);
  read=await call('wh_table_get',{projectId,tableId:view.id});assert.equal(read.table.rows.find(item=>item.id===salt.id).cells[share.column.id],'0.25');assert.equal(read.displayRows.find(item=>item.id===salt.id).cells[share.column.id],'25%');assert((await call('wh_table_export_csv',{projectId,tableId:view.id})).csv.includes('25%'));
  const rate=await call('wh_table_save_calculation',{projectId,tableId:view.id,name:'Rate',formula:'=@[Price]/100',resultType:'percent',expectedVersion:read.version,expectedTemplateRevision:template.revision});card=await call('wh_get_codex_entry',{projectId,id:salt.id});assert.equal(card.fields[rate.column.field],'0.1');assert.equal(card.properties[rate.column.field].displayValue,'10%');
  template=(await call('wh_codex_templates',{projectId})).templates.find(item=>item.id===template.id);template=await call('wh_save_codex_template',{projectId,template,expectedRevision:template.revision});assert(template.template.propertyDefinitions.some(item=>item.resultType==='percent'));
  read=await call('wh_table_get',{projectId,tableId:view.id});const price=read.table.columns.find(item=>item.propertyId==='native-price-id');await call('wh_table_remove_column',{projectId,tableId:view.id,columnId:price.id,expectedVersion:read.version});read=await call('wh_table_get',{projectId,tableId:view.id});assert.equal(read.table.rows.find(item=>item.id===salt.id).cells[share.column.id],'#REF!');assert.equal((await call('wh_get_codex_entry',{projectId,id:salt.id})).fields[promoted.column.field],'20');
  const eraId=(await call('wh_world_era_save',{projectId,expectedRevision:null,era:{name:'Past tables',description:''}})).era.id,scope={projectId,eraId};const eraView=(await call('wh_table_create_type_view',{...scope,title:'Era view',templateId:view.codexTemplateId})).table;assert((await call('wh_tables_list',{projectId})).tables.every(item=>item.id!==eraView.id));assert((await call('wh_tables_list',scope)).tables.some(item=>item.id===eraView.id));
  console.log('PASS native stdio→HTTP→executor→IPC table calculations: concrete type view, promoted closed-card values, local aggregate/raw/display/CSV, stale CAS atomicity, result-format template roundtrip, remove-column refs and Base/era isolation');
  child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));child=null;lines.close();bridge.stopAiBridge();win.destroy();app.exit(0);

}
main().catch(error => { console.error(error.stack || String(error)); child?.kill(); bridge?.stopAiBridge(); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); });
