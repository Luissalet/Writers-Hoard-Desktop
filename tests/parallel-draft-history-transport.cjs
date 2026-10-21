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
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-draft-history-transport-'));
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
  await build({ ...shared, entryPoints: [path.join(root, 'tests/parallel-draft-history-transport.renderer.ts')], platform: 'browser', format: 'iife', jsx: 'automatic', outfile: path.join(directory, 'renderer.js'), loader: { '.css': 'empty' }, banner: { js: 'const __qaEmptyGlob = () => ({});' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.glob': '__qaEmptyGlob', 'import.meta.url': '"file:///transport-test.js"' } });
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

  const projectId='draft-history-native', writingId='native-chapter', scope={projectId,writingId};
  const fails=async(name,args)=>{const reply=await rpc('tools/call',{name,arguments:args});assert(reply.result.isError,`Expected refusal ${name}`);};
  const undo=async(index)=>(await(await fetch(url+'/api/undo',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({index})})).json());
  const original=(await call('wh_get_writing_document',{projectId,id:writingId})).html;
  const a=await call('wh_parallel_draft_create',{...scope,name:'Quiet arrival',expectedVersion:1}),b=await call('wh_parallel_draft_create',{...scope,name:'Storm arrival',expectedVersion:1});
  assert.equal((await call('wh_parallel_draft_list',scope)).length,2);
  let A=await call('wh_parallel_draft_get',{...scope,draftId:a.id}),B=await call('wh_parallel_draft_get',{...scope,draftId:b.id});
  let saved=await call('wh_parallel_draft_save',{...scope,draftId:a.id,expectedVersion:A.version,content:'Only the alternative changed.'});
  await fails('wh_parallel_draft_save',{...scope,draftId:a.id,expectedVersion:A.version,content:'Stale losing text.'});
  A=await call('wh_parallel_draft_get',{...scope,draftId:a.id});
  const history=await call('wh_parallel_draft_history',{...scope,draftId:a.id});assert(history.every(row=>!('content'in row)));
  const prior=history.find(row=>row.reason==='auto');assert((await call('wh_parallel_draft_history_read',{...scope,draftId:a.id,historyId:prior.id})).content.includes('Canonical fixture.'));
  await fails('wh_parallel_draft_history_read',{...scope,draftId:b.id,historyId:prior.id});
  const restored=await call('wh_parallel_draft_history_restore',{...scope,draftId:a.id,historyId:prior.id,expectedVersion:A.version});assert((await call('wh_parallel_draft_get',{...scope,draftId:a.id})).content.includes('Canonical fixture.'));
  const audit=await(await fetch(url+'/api/audit',{headers:{Authorization:`Bearer ${token}`}})).json();assert(audit.entries.find(row=>row.index===restored._undo.audit_index).before.__parallelDraft);
  assert((await undo(restored._undo.audit_index)).ok);assert(!(await undo(restored._undo.audit_index)).ok);
  A=await call('wh_parallel_draft_get',{...scope,draftId:a.id});assert(A.content.includes('Only the alternative changed.'));
  assert.equal((await call('wh_parallel_draft_get',{...scope,draftId:b.id})).content,B.content);assert.equal((await call('wh_get_writing_document',{projectId,id:writingId})).html,original);
  const edition=await call('wh_published_edition_publish',{projectId,chapterIds:[writingId],chapterDraftIds:{[writingId]:a.id},title:'Native alternative edition',locale:'en',expectedRevision:0});
  const frozen=await call('wh_published_edition_read',{projectId,editionId:edition.editionId,includeHtml:true});assert.equal(frozen.chapters[0].sourceDraftId,a.id);assert(frozen.reader.html.includes('Only the alternative changed.')&&!frozen.reader.html.includes('Canonical fixture.'));
  const eraId=(await call('wh_world_era_save',{projectId,expectedRevision:null,era:{name:'Past draft',description:''}})).era.id;
  let past=await call('wh_parallel_draft_get',{...scope,eraId,draftId:a.id});
  const eraSaved=await call('wh_parallel_draft_save',{...scope,eraId,draftId:a.id,expectedVersion:past.version,content:'Past alternative only.'});
  assert((await undo(eraSaved._undo.audit_index)).ok);assert.equal((await call('wh_parallel_draft_get',{...scope,eraId,draftId:a.id})).content,A.content);assert.equal((await call('wh_parallel_draft_get',{...scope,draftId:a.id})).content,A.content);
  const disposable=await call('wh_parallel_draft_create',{...scope,eraId,name:'Disposable era alternative',expectedVersion:1});assert((await undo(disposable._undo.audit_index)).ok);await fails('wh_parallel_draft_get',{...scope,eraId,draftId:disposable.id});
  assert.equal((await call('wh_get_writing_document',{projectId,id:writingId})).html,original);assert.equal((await call('wh_published_edition_read',{projectId,editionId:edition.editionId,includeHtml:true})).reader.html,frozen.reader.html);
  console.log('PASS native stdio→HTTP→executor→IPC seven draft tools, metadata history/body, CAS/refusal, exact-draft restore, real /audit→Undo Base/era/create/replay and frozen alternative publication without promotion');
  console.log('DRAFT_TRANSPORT_QA '+directory);
  child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));child=null;lines.close();bridge.stopAiBridge();win.destroy();app.exit(0);

}
main().catch(error => { console.error(error.stack || String(error)); child?.kill(); bridge?.stopAiBridge(); if (win && !win.isDestroyed()) win.destroy(); app.exit(1); });
