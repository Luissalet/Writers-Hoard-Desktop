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
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-codex-option-list-transport-'));
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
  await build({ ...shared, entryPoints: [path.join(root, 'tests/codex-option-lists-transport.renderer.ts')], platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(directory, 'renderer.js'), loader: { '.css': 'empty' }, banner: { js: 'const __qaEmptyGlob = () => ({});' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob': '__qaEmptyGlob', 'import.meta.url': '"file:///transport-test.js"' } });
  fs.writeFileSync(path.join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{aiBridge:{onRequest:fn=>{const listener=(_,payload)=>fn(payload);ipcRenderer.on('aibridge:request',listener);return()=>ipcRenderer.removeListener('aibridge:request',listener)},reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});`);
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>');
  await app.whenReady(); bridge = require(nativeFile); await bridge.setBridgeConfig({ enabled: true, writesEnabled: true }); const token = await bridge.getBridgeToken();
  ipcMain.handle('aibridge:reply', (event, payload) => { assert.equal(event.sender, win.webContents); bridge.resolveBridgeReply(payload); });
  win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message',details=>{if(details.level==='error')console.error('RENDERER '+details.message);});
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
  let template=(await call('wh_save_codex_template',{projectId,expectedRevision:null,template:{name:'Native occupations',category:'character',fields:{roles:''},content:'Preserved type prose.',propertyDefinitions:[{id:'native-role-id',key:'roles',label:'Roles',kind:'multiselect',presets:['Retired']}]}})).template;
  const card=await call('wh_create_codex_entry',{projectId,title:'Harbor guide',templateId:template.id,fields:{roles:'["Retired"]'},content:'Preserved card prose.'});
  const eraId=(await call('wh_world_era_save',{projectId,expectedRevision:null,era:{name:'Past options',description:''}})).era.id,scope={projectId,eraId};
  let saved=await call('wh_codex_option_list_save',{...scope,expectedRevision:null,list:{name:'Occupations',options:['Guide','Scribe'],optionColors:{Guide:'#25803f',Scribe:'#8e452e'}}}),list=saved.list;assert.equal(saved.libraryScope,'shared-project');assert.equal((await call('wh_codex_option_lists',{projectId})).lists[0].id,list.id);
  let applied=await call('wh_codex_option_list_apply',{...scope,listId:list.id,templateId:template.id,propertyId:'native-role-id',expectedListRevision:list.revision,expectedTemplateRevision:template.revision});assert.equal(applied.libraryScope,'shared-project');assert.equal(applied.template.propertyDefinitions[0].id,'native-role-id');assert.equal(applied.template.propertyDefinitions[0].optionColors.Guide,'#25803f');assert(applied.retainedValues.some(row=>row.entryId===card.id&&row.values.includes('Retired')));assert.equal((await call('wh_get_codex_entry',{projectId,id:card.id})).storedFields.roles,'["Retired"]');
  const stale=await rpc('tools/call',{name:'wh_codex_option_list_apply',arguments:{projectId,listId:list.id,templateId:template.id,propertyId:'native-role-id',expectedListRevision:list.revision,expectedTemplateRevision:template.revision}});assert(stale.result.isError);
  saved=await call('wh_codex_option_list_save',{projectId,expectedRevision:list.revision,list:{...(({id,name,options,optionColors})=>({id,name,options,optionColors}))(list),name:'Renamed occupations',options:['Merchant'],optionColors:{Merchant:'#000000'}}});list=saved.list;
  const rejected=await rpc('tools/call',{name:'wh_codex_option_list_save',arguments:{projectId,expectedRevision:list.revision-1,list:{id:list.id,name:'Stale rename',options:['Other']}}});assert(rejected.result.isError);
  template=(await call('wh_codex_templates',{projectId})).templates.find(item=>item.id===template.id);assert.deepEqual(template.propertyDefinitions[0].presets,['Guide','Scribe']);
  await call('wh_codex_option_list_delete',{...scope,listId:list.id,expectedRevision:list.revision});assert.equal((await call('wh_codex_option_lists',{projectId})).lists.length,0);assert.deepEqual((await call('wh_codex_templates',{projectId})).templates.find(item=>item.id===template.id).propertyDefinitions[0].presets,['Guide','Scribe']);assert.equal((await call('wh_get_codex_entry',{projectId,id:card.id})).storedFields.roles,'["Retired"]');
  const unknownEra=await rpc('tools/call',{name:'wh_codex_option_lists',arguments:{projectId,eraId:'unknown-era'}});assert(unknownEra.result.isError);
  console.log('PASS native stdio→HTTP→executor→IPC reusable colored option lists: shared Base/era scope, list/save/apply/delete, list+template CAS, retained-value warning, and no migration of cards/properties after library edit/delete');
  child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));child=null;lines.close();bridge.stopAiBridge();win.destroy();app.exit(0);

}
main().catch(error => { console.error(error.stack || String(error)); child?.kill(); bridge?.stopAiBridge(); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); });
