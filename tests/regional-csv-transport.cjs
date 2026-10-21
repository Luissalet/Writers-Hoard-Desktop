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
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-regional-csv-transport-'));
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
  await build({ ...shared, entryPoints: [path.join(root, 'tests/regional-csv-native.renderer.ts')], platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(directory, 'renderer.js'), loader: { '.css': 'empty' }, banner: { js: 'const __qaEmptyGlob = () => ({});' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob': '__qaEmptyGlob', 'import.meta.url': '"file:///transport-test.js"' } });
  fs.writeFileSync(path.join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:fn=>{const listener=(_,payload)=>fn(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener)},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});`);
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>');
  await app.whenReady(); bridge = require(nativeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true }); const token = await bridge.getBridgeToken();
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, win.webContents); bridge.resolveBridgeReply(payload); });
  win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  bridge.setBridgeWindowResolver(() => win);
  await win.loadFile(path.join(directory, 'index.html')); const deadline = Date.now() + 30000;
  while (!await win.webContents.executeJavaScript('window.__transportReady === true')) { const failure=await win.webContents.executeJavaScript('window.__csvFailure??null');if(failure)throw Error(failure);if (Date.now() > deadline) throw Error('Renderer fixture did not start'); await new Promise(resolve => setTimeout(resolve, 40)); }
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
  for(const result of await win.webContents.executeJavaScript('__csvTests'))console.log('PASS '+result);
  const scope={projectId:'csv-native'},csv='Name;Price;Notes\r\n"Müller; coast";-1,25;"Text, 1,25"\r\n北京;2,50;"Two\nlines"',options={delimiter:'auto',decimal:',',columnKinds:['text','number','text']};
  const fails=async(name,args)=>{const reply=await rpc('tools/call',{name,arguments:args});assert(reply.result.isError,`${name} should fail`);};
  const preview=await call('wh_table_preview_csv',{...scope,csv,...options});assert.equal(preview.delimiter,';');assert.equal(preview.records[0][1],'-1,25');assert.equal((await call('wh_tables_list',scope)).tables.length,0);
  const imported=(await call('wh_table_import_csv',{...scope,csv,title:'Native regional',...options})).table;assert.equal(imported.rows[0].cells[imported.columns[1].id],'-1.25');assert.equal(imported.rows[0].cells[imported.columns[2].id],'Text, 1,25');
  await fails('wh_table_import_csv',{...scope,title:'Malformed',csv:'A;B\n1',delimiter:';'});assert.equal((await call('wh_tables_list',scope)).tables.length,1);
  await fails('wh_table_preview_csv',{...scope,csv:'A,B;C\n1,2;3'});
  const exported=await call('wh_table_export_csv',{...scope,tableId:imported.id,delimiter:';',decimal:',',encoding:'utf-16le'}),bytes=Buffer.from(exported.base64,'base64');assert.equal(bytes[0],255);assert.equal(bytes[1],254);assert(bytes.toString('utf16le').includes('北京'));fs.writeFileSync(path.join(directory,'regional-export.csv'),bytes);
  const again=(await call('wh_table_import_csv',{...scope,base64:exported.base64,title:'UTF16 reimport',...options})).table;assert.equal(again.rows[0].cells[again.columns[1].id],'-1.25');
  const legacy=Buffer.concat([Buffer.from('Name;Price\r\nM','ascii'),Buffer.from([0xfc]),Buffer.from('ller;1,25','ascii')]).toString('base64');await fails('wh_table_preview_csv',{...scope,base64:legacy});assert((await call('wh_table_preview_csv',{...scope,base64:legacy,encoding:'windows-1252'})).records[0][0]==='Müller');
  const era={...scope,eraId:'past'},eraTable=(await call('wh_table_import_csv',{...era,csv,title:'Era regional',...options})).table;assert(!(await call('wh_tables_list',scope)).tables.some(table=>table.id===eraTable.id));assert((await call('wh_tables_list',era)).tables.some(table=>table.id===eraTable.id));
  const edit={...scope,tableId:imported.id,rowId:imported.rows[0].id,columnId:imported.columns[1].id};await call('wh_table_save_cell',{...edit,value:'4.5',expected:'-1.25'});await fails('wh_table_save_cell',{...edit,value:'9',expected:'-1.25'});assert.equal((await call('wh_table_get',{...era,tableId:eraTable.id})).table.rows[0].cells[eraTable.columns[1].id],'-1.25');
  await bridge.setBridgeConfig({writesEnabled:false});await call('wh_table_preview_csv',{...scope,csv});await fails('wh_table_import_csv',{...scope,csv,title:'Write refused'});
  console.log('PASS actual external stdio→HTTP→executor→IPC→renderer regional preview/import/export bytes, malformed no writes, encoding/ambiguity, Base/era isolation and existing CAS');console.log('CSV_QA '+directory);
}
main().then(()=>{child?.kill();bridge?.stopAiBridge();win?.destroy();app.exit(0);}).catch(error=>{console.error(error.stack||error);child?.kill();bridge?.stopAiBridge();win?.destroy();app.exit(1);});
