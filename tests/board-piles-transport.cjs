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
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-board-pile-transport-'));
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
  await build({ ...shared, entryPoints: [path.join(root, 'tests/board-piles-transport.renderer.ts')], platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(directory, 'renderer.js'), loader: { '.css': 'empty' }, banner: { js: 'const __qaEmptyGlob = () => ({});' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob': '__qaEmptyGlob', 'import.meta.url': '"file:///transport-test.js"' } });
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
  const boardId='transport-pile-board';
  const shape=async(title,x)=>{const reply=await call('wh_board_canvas_action',{projectId,boardId,action:'shape',shape:'rectangle',title,x,y:100});return reply.addedOrUpdated[0];};
  const a=await shape('First',100),b=await shape('Second',400),before=await call('wh_board_canvas_get',{projectId,boardId});
  const pile=(await call('wh_board_canvas_action',{projectId,boardId,action:'pile',pileAction:'create',nodeIds:[a,b],title:'Native pile',expectedVersion:before.version})).addedOrUpdated[0];
  let view=await call('wh_board_canvas_get',{projectId,boardId});assert.deepEqual(view.visibleNodeIds,[pile]);assert.equal(view.nodes.find(row=>row.id===pile).memberNodeIds.length,2);
  const stale=await rpc('tools/call',{name:'wh_board_canvas_action',arguments:{projectId,boardId,action:'pile',pileAction:'expand',nodeId:pile,expectedVersion:before.version}});assert(stale.result.isError);
  await call('wh_board_canvas_action',{projectId,boardId,action:'pile',pileAction:'expand',nodeId:pile});view=await call('wh_board_canvas_get',{projectId,boardId});assert(view.visibleNodeIds.includes(a));assert.equal(view.nodes.find(row=>row.id===a).position.x,100);
  await call('wh_board_canvas_action',{projectId,boardId,action:'pile',pileAction:'collapse',nodeId:pile});await call('wh_board_canvas_action',{projectId,boardId,action:'pile',pileAction:'move',nodeId:pile,x:200,y:300});view=await call('wh_board_canvas_get',{projectId,boardId});assert.notEqual(view.nodes.find(row=>row.id===a).position.x,100);
  const duplicate=await call('wh_board_canvas_action',{projectId,boardId,action:'pile',pileAction:'duplicate',nodeId:pile});assert.equal(duplicate.addedOrUpdated.length,3);view=await call('wh_board_canvas_get',{projectId,boardId});const copy=view.nodes.find(row=>row.kind==='frame'&&row.id!==pile);assert(copy.memberNodeIds.every(id=>duplicate.addedOrUpdated.includes(id)));
  const eraId=(await call('wh_world_era_save',{projectId,expectedRevision:null,era:{name:'Past canvas',description:''}})).era.id;
  await call('wh_board_canvas_action',{projectId,eraId,boardId,action:'pile',pileAction:'delete',nodeId:pile});assert(!(await call('wh_board_canvas_get',{projectId,eraId,boardId})).nodes.some(row=>row.id===a));assert((await call('wh_board_canvas_get',{projectId,boardId})).nodes.some(row=>row.id===a));
  await call('wh_board_canvas_action',{projectId,boardId,action:'pile',pileAction:'delete',nodeId:copy.id});assert.equal((await call('wh_board_canvas_get',{projectId,boardId})).nodes.length,3);
  const undo=async(index)=>await(await fetch(`${url}/api/undo`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({index})})).json();
  const edit=await call('wh_board_canvas_action',{projectId,boardId,action:'shape',shape:'star',title:'Undo this star',x:500,y:500});
  const audit=await(await fetch(`${url}/api/audit`,{headers:{Authorization:`Bearer ${token}`}})).json(),entry=audit.entries.find(row=>row.index===edit._undo.audit_index);assert.equal(entry.before.__boardCanvasReceipt,edit.receiptId);assert.deepEqual(Object.keys(entry.before),['__boardCanvasReceipt']);
  assert((await undo(edit._undo.audit_index)).ok);assert(!(await call('wh_board_canvas_get',{projectId,boardId})).nodes.some(row=>row.id===edit.addedOrUpdated[0]));assert(!(await undo(edit._undo.audit_index)).ok);
  const beforeEra=await call('wh_board_canvas_get',{projectId,boardId}),eraEdit=await call('wh_board_canvas_action',{projectId,eraId,boardId,action:'shape',shape:'star',title:'Era Undo star',x:500,y:500});assert((await undo(eraEdit._undo.audit_index)).ok);assert(!(await call('wh_board_canvas_get',{projectId,eraId,boardId})).nodes.some(row=>row.id===eraEdit.addedOrUpdated[0]));assert.equal((await call('wh_board_canvas_get',{projectId,boardId})).version,beforeEra.version);
  const old=await call('wh_board_canvas_action',{projectId,boardId,action:'shape',shape:'star',title:'Prior action',x:500,y:500}),later=await call('wh_board_canvas_action',{projectId,boardId,action:'shape',shape:'star',title:'Later winner',x:600,y:500});assert(!(await undo(old._undo.audit_index)).ok);assert((await call('wh_board_canvas_get',{projectId,boardId})).nodes.some(row=>row.id===later.addedOrUpdated[0]));
  await call('wh_board_canvas_undo',{projectId,receiptId:later.receiptId});assert(!(await call('wh_board_canvas_get',{projectId,boardId})).nodes.some(row=>row.id===later.addedOrUpdated[0]));
  console.log('PASS native stdio→HTTP→executor→IPC canvas pile six actions, CAS, readonly visibility, Base/era and /audit→Undo opaque receipts, one-use, explicit tool and newer-edit refusal');
  child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));child=null;lines.close();bridge.stopAiBridge();win.destroy();app.exit(0);

}
main().catch(error => { console.error(error.stack || String(error)); child?.kill(); bridge?.stopAiBridge(); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); });
