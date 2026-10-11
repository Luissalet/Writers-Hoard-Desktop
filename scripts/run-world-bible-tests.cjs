// Synthetic native bridge/MCP and artifact QA. Never opens the user's profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-bible-qa-'));
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('use-angle', 'swiftshader');
function assert(value, note) { if (!value) throw new Error(note); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { return new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); }); }); }
async function main() {
  process.env.WH_AIBRIDGE_PORT = String(await freePort());
  await esbuild.build({ stdin: { contents: `export * from './electron/aibridge/server'; export * from './electron/aibridge/state'; export * from './electron/aibridge/rpc';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], alias: { '@': path.join(root, 'src') }, outfile: path.join(directory, 'native.cjs') });
  await esbuild.build({ entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, outfile: path.join(directory, 'mcp.cjs') });
  await esbuild.build({ stdin: { contents: `import { testWorldBible, BIBLE_FIXTURE_ID } from './tests/world-bible.browser'; import { runBridgeTool } from './src/services/aiBridge/dispatch'; window.qaCall = runBridgeTool; testWorldBible().then(tests => window.qaResult = {tests, projectId:BIBLE_FIXTURE_ID}).catch(error => window.qaResult = {error:error.stack});`, resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"/"}', 'import.meta.url': '"file:///world-bible-qa.js"' }, outfile: path.join(directory, 'renderer.js') });
  fs.writeFileSync(path.join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{isDesktop:true,exporter:{scriptToPdf:(html,name)=>ipcRenderer.invoke('qa:pdf',html,name)},aiBridge:{onRequest:callback=>ipcRenderer.on('aibridge:request',(_event,payload)=>callback(payload)),reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});`);
  fs.writeFileSync(path.join(directory, 'test.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script>globalThis.IS_REACT_ACT_ENVIRONMENT=true</script><script src="renderer.js"></script>');
  await app.whenReady();
  const native = require(path.join(directory, 'native.cjs'));
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(directory, 'preload.cjs'), sandbox: true, contextIsolation: true } });
  native.setBridgeWindowResolver(() => win);
  ipcMain.handle('aibridge:reply', (_event, payload) => native.resolveBridgeReply(payload));
  let pdfMode = 'save';
  ipcMain.handle('qa:pdf', async (_event, html, filename) => {
    if (pdfMode === 'cancel') return { ok: false, canceled: true };
    if (pdfMode === 'fail') return { ok: false, error: 'synthetic write failure' };
    assert(path.basename(filename) === filename && filename.endsWith('.pdf'), 'safe synthetic artifact filename');
    const htmlFile = path.join(directory, 'pdf-source.html');
    fs.writeFileSync(htmlFile, html);
    const print = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
    try {
      await print.loadFile(htmlFile);
      const bytes = await print.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      assert(bytes.subarray(0, 5).toString() === '%PDF-', 'actual PDF bytes');
      fs.writeFileSync(path.join(directory, filename), bytes);
      return { ok: true, filePath: path.join(directory, filename) };
    } finally { print.destroy(); }
  });
  await win.loadFile(path.join(directory, 'test.html'));
  let result;
  for (let attempt = 0; attempt < 300; attempt++) { result = await win.webContents.executeJavaScript('window.qaResult'); if (result) break; await pause(100); }
  assert(result && !result.error, result?.error ?? 'renderer timed out');
  result.tests.forEach(test => console.log(`PASS ${test}`));
  await native.setBridgeConfig({ enabled: true, writesEnabled: true });
  const token = await native.getBridgeToken();
  await native.startAiBridge({ version: 'world-bible-qa', hasWindow: () => true });
  const child = spawn(process.execPath, [path.join(directory, 'mcp.cjs')], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_URL: native.AI_BRIDGE_URL, WH_BRIDGE_TOKEN: token, WH_BRIDGE_GROUPS: 'story' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, buffer = '';
  const pending = new Map();
  child.stdout.on('data', bytes => { buffer += bytes; let line; while ((line = buffer.indexOf('\n')) >= 0) { const message = JSON.parse(buffer.slice(0, line)); buffer = buffer.slice(line + 1); pending.get(message.id)?.(message); pending.delete(message.id); } });
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timed out: ${method}`)); }, 30000);
    pending.set(id, reply => { clearTimeout(timer); resolve(reply); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    assert((await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'world-bible-qa', version: '1' } })).result, 'MCP initialized');
    const catalogue = (await rpc('tools/list', {})).result.tools;
    assert(catalogue.some(tool => tool.name === 'wh_build_world_bible') && catalogue.some(tool => tool.name === 'wh_export_world_bible'), 'live MCP catalogue includes both tools');
    const build = await rpc('tools/call', { name: 'wh_build_world_bible', arguments: { projectId: result.projectId, entryIds: ['ana', 'faro'], locale: 'es' } });
    const artifact = JSON.parse(build.result.content.find(block => block.type === 'text').text);
    assert(!build.result.isError && artifact.html.includes('Ana Ruiz') && artifact.counts.codex === 2, 'MCP receives real project selection');
    fs.writeFileSync(path.join(directory, 'world-bible.html'), artifact.html);
    const bad = await rpc('tools/call', { name: 'wh_build_world_bible', arguments: { projectId: result.projectId, entryIds: ['foreign'] } });
    assert(bad.result.isError, 'MCP foreign ID fails closed');
    const pdf = await rpc('tools/call', { name: 'wh_export_world_bible', arguments: { projectId: result.projectId, entryIds: ['ana', 'faro'], format: 'pdf', locale: 'es' } });
    const saved = JSON.parse(pdf.result.content.find(block => block.type === 'text').text);
    assert(!pdf.result.isError && saved.ok && fs.existsSync(path.join(directory, saved.filename)), 'MCP export traverses renderer and native PDF printer');
    pdfMode = 'cancel';
    const canceled = await rpc('tools/call', { name: 'wh_export_world_bible', arguments: { projectId: result.projectId, format: 'pdf' } });
    const canceledResult = JSON.parse(canceled.result.content.find(block => block.type === 'text').text);
    assert(canceledResult.ok === false && canceledResult.canceled, 'native cancellation remains explicit');
    pdfMode = 'fail';
    const failed = await rpc('tools/call', { name: 'wh_export_world_bible', arguments: { projectId: result.projectId, format: 'pdf' } });
    const failedResult = JSON.parse(failed.result.content.find(block => block.type === 'text').text);
    assert(failedResult.ok === false && failedResult.error === 'synthetic write failure', 'native export error remains explicit');
    await native.setBridgeConfig({ writesEnabled: false });
    const denied = await rpc('tools/call', { name: 'wh_export_world_bible', arguments: { projectId: result.projectId, format: 'pdf' } });
    assert(denied.result.isError, 'read-only configuration denies artifact export');
    const read = await rpc('tools/call', { name: 'wh_build_world_bible', arguments: { projectId: result.projectId } });
    assert(!read.result.isError, 'read-only configuration allows compilation');
    console.log('PASS real stdio MCP catalogue, scoped compilation, PDF export, cancellation, errors and write permission');
    console.log(`ARTIFACTS ${directory}`);
  } finally { child.kill(); native.stopAiBridge(); win.destroy(); }
  app.exit(0);
}
main().catch(error => { console.error(error); app.exit(1); });
