// Runs inside the real Electron runtime, not a browser automation framework.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron';

(async () => {
const base = process.env.WH_INSTALL_QA_ROOT;
const root = process.env.WH_INSTALL_WRITER_ROOT;
app.setPath('userData', path.join(base, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'wh-publishing', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
const api = require(path.join(base, 'api.cjs'));
const receipt = { status: 'RUNNING', scope: 'Real Electron sandboxed preload/IPC and wh-publishing protocol callbacks extracted verbatim from production main; actual HTTP bridge, Node MCP adapters and approved frozen publishing worker. This is a native API contract test, not full application GUI/installer interaction.', contracts: [], modules: [], children: [] };
const children = new Set();
let win;
let fixtureError;
const tools = JSON.parse(await readFile(path.join(root, 'publishing/catalog.json'), 'utf8'));

function adapter(module, token, cold = false) {
  const child = spawn(process.env.WH_INSTALL_NODE, [...(cold ? ['--require', path.join(base, 'forbid-network.cjs')] : []), path.join(base, 'mcp.cjs'), '--publishing-module', module], { cwd: base, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_URL: 'http://127.0.0.1:64852', WH_BRIDGE_TOKEN: token, HOARD_AGENT_ID: 'qa-native949', HOARD_AGENT_SESSION: 'qa-session949' } });
  children.add(child);
  receipt.children.push(child.pid);
  const pending = new Map(), notifications = [];
  let sequence = 0;
  createInterface({ input: child.stdout }).on('line', line => {
    const value = JSON.parse(line);
    if (value.method) notifications.push(value);
    else { pending.get(value.id)?.(value); pending.delete(value.id); }
  });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  async function rpc(method, params = {}) {
    const id = ++sequence;
    let timer;
    try {
      return await Promise.race([new Promise(resolve => { pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`MCP ${module} ${method} timed out: ${diagnostics}`)), 90000); })]);
    } finally { clearTimeout(timer); }
  }
  return { rpc, notifications, async close() { if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.stdin.end(); await exited; } children.delete(child); } };
}

function payload(reply) {
  assert.ok(reply.result, JSON.stringify(reply));
  return JSON.parse(reply.result.content.find(item => item.type === 'text').text);
}

async function main() {
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: ['http:', 'https:'].includes(url.protocol) && !(url.hostname === '127.0.0.1' && url.port === '64852') });
  });
  api.configurePublishing({ configFile: path.join(base, 'modules.json'), dataDir: path.join(base, 'data'), command: path.join(root, 'publishing/runtime/writer-publishing-worker/writer-publishing-worker.exe'), args: [], cwd: base, nodeCommand: process.execPath });
  const service = api.publishingService();
  const captured = [];
  const original = service.request.bind(service);
  let injectUncertain = false;
  let uncertaintyRequests = 0;
  service.request = async (...args) => {
    captured.push({ path: args[1], headers: args[3], body: args[2], encoded: args[4] });
    if (injectUncertain) {
      uncertaintyRequests++;
      await new Promise(resolve => setTimeout(resolve, 11000));
      throw Object.assign(new Error('Synthetic native write response lost'), { outcome_unknown: true });
    }
    return original(...args);
  };
  assert.deepEqual((await service.status()).enabled, []);
  assert.equal(service.running, false);
  // No HTTP listener is running yet: discovery is entirely static.
  for (const [module, count, selected] of [['borges', 378, ['library', 'links', 'paperwork']], ['library', 15, ['library']], ['links', 46, ['links']], ['kafka', 314, ['paperwork']], ['gutenberg', 19, ['publishing']]]) {
    const peer = adapter(module, 'synthetic-unreachable-token', true);
    try {
      const initialized = await peer.rpc('initialize', { protocolVersion: '2025-06-18' });
      assert.equal(initialized.result.protocolVersion, '2025-06-18');
      const actual = (await peer.rpc('tools/list')).result.tools;
      assert.equal(actual.length, count);
      for (const native of tools.filter(tool => selected.includes(tool.module))) {
        const entry = actual.find(tool => tool.name === (native.native_name || native.name));
        assert.deepEqual(entry.inputSchema, native.inputSchema, native.name);
        if (native.annotations) assert.deepEqual(entry.annotations, native.annotations, native.name);
        if (native['x-timeout-s']) assert.equal(entry['x-timeout-s'], native['x-timeout-s']);
      }
      if (module === 'borges') assert.deepEqual(actual.find(tool => tool.name === 'borges_set_module').inputSchema.properties.module.enum, ['library', 'links', 'paperwork']);
      assert.equal(service.running, false);
      receipt.contracts.push(`cold-${module}-${count}`);
    } finally { await peer.close(); }
  }
  await assert.rejects(readFile(path.join(base, 'cold-io-attempt.txt')), { code: 'ENOENT' });
  receipt.contracts.push('cold-discovery-zero-http-zero-child-process-attempts');
  const file = path.join(base, 'contract.html');
  await writeFile(file, `<!doctype html><title>Native contract fixture</title><script>
  (async()=>{const result=[];try{const api=window.electronAPI.publishing;const before=await api.status();if(before.running)throw Error('Cold preload started worker');
  for(const module of ['library','links','paperwork','publishing']){await api.setModule(module,true,false);const value=await api.request('GET','/'+module+'/api/health');if(value.status!==200)throw Error(module+' health '+value.status);await api.setModule(module,false,false);const off=await api.status();if(off.running)throw Error(module+' worker retained');result.push(module);}
  window.qaNative.report({ok:true,result});}catch(error){window.qaNative.report({ok:false,error:String(error)});}})();</script>`);
  win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(base, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const expected = pathToFileURL(file).href;
  const report = new Promise(resolve => ipcMain.once('qa:report', (event, value) => { assert.equal(event.sender, win.webContents); resolve(value); }));
  ipcMain.on('forge:memory', event => { event.returnValue = 1024 * 1024 * 1024; });
  const assertIpcSender = event => { assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, event.sender.mainFrame); assert.equal(event.senderFrame.url, expected); };
  vm.runInNewContext(await readFile(path.join(base, 'production-registrations.cjs'), 'utf8'), { ipcMain, protocol, publishingService: api.publishingService, assertIpcSender, URL, Headers, Response, console });
  await win.loadFile(file);
  const preload = await report;
  assert.equal(preload.ok, true, JSON.stringify(preload));
  assert.deepEqual(preload.result, ['library', 'links', 'paperwork', 'publishing']);
  receipt.contracts.push('actual-sandboxed-preload-three-production-ipc-callbacks-four-frozen-factories');
  await api.setBridgeConfig({ enabled: true, writesEnabled: true });
  const token = await api.getBridgeToken();
  await api.startAiBridge({ version: 'qa949', hasWindow: () => true });
  for (const [module, count] of [['borges', 378], ['links', 46], ['kafka', 314], ['gutenberg', 19]]) {
    const catalogue = await net.fetch(`http://127.0.0.1:64852/compat/${module}/api/agent/tools`);
    assert.equal(catalogue.status, 200);
    assert.equal((await catalogue.json()).tools.length, count);
    assert.equal((await net.fetch(`http://127.0.0.1:64852/compat/${module}/api/health`)).status, 200);
    assert.equal(service.running, false);
  }
  receipt.contracts.push('http-compat-health-catalogues-all-off-no-worker');
  for (const [module, tool, alias] of [['library', 'library_collections', 'borges'], ['links', 'list_links', 'links'], ['paperwork', 'docs_list', 'kafka'], ['publishing', 'gutenberg_publications', 'gutenberg']]) {
    const peer = adapter(alias, token);
    try {
      const refused = await peer.rpc('tools/call', { name: tool, arguments: {} });
      assert.equal(refused.result.isError, true);
      assert.equal(service.running, false, 'OFF native request must not start frozen worker');
      await service.setModule(module, true);
      const live = await peer.rpc('tools/call', { name: tool, arguments: {}, _meta: { 'hoard/agent': 'qa-meta949', 'hoard/session': 'qa-meta-session949', 'hoard/reason': 'Synthetic identity preservation', 'hoard/caller': 'qa949' } });
      assert.equal(live.result.isError, false, JSON.stringify(live));
      payload(live);
      const forwarded = captured.at(-1);
      assert.equal(forwarded.path, `/${module}/api/agent/call`);
      assert.equal(forwarded.headers['x-agent-id'], 'qa-meta949');
      assert.equal(forwarded.headers['x-agent-session'], 'qa-meta-session949');
      const body = JSON.parse(forwarded.encoded ? Buffer.from(forwarded.body, 'base64').toString() : forwarded.body);
      assert.equal(body.reason, 'Synthetic identity preservation');
      assert.equal(body.caller, 'qa949');
      if (module === 'paperwork') {
        await api.setBridgeConfig({ writesEnabled: false });
        assert.equal((await peer.rpc('tools/call', { name: 'docs_list', arguments: {} })).result.isError, false);
        const before = captured.length;
        assert.equal((await peer.rpc('tools/call', { name: 'deadline_add', arguments: { title: 'Not applied', date: '2030-01-01', kind: 'other' } })).result.isError, true);
        assert.equal(captured.length, before, 'Disabled writes must not reach the native worker');
        await api.setBridgeConfig({ writesEnabled: true });
        receipt.contracts.push('writes-disabled-keeps-native-read-only-tools-no-write-dispatch');
      }
      if (module === 'publishing') {
        const response = await net.fetch('wh-publishing://publishing/static/icon.png', { headers: { Range: 'bytes=17-8192' } });
        assert.equal(response.status, 206);
        assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5174');
        assert.equal(response.headers.get('content-length'), null);
        const icon = await readFile(path.join(root, 'publishing/editorial/gutenberg_hoard/static/icon.png'));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), icon.subarray(17, 8193));
        receipt.contracts.push('actual-electron-wh-publishing-206-range-exact-bytes-cors-stream');
      }
      await service.setModule(module, false);
      assert.equal(service.running, false);
      receipt.modules.push({ module, original_name: tool, native_result: true, worker_closed: true });
    } finally { await peer.close(); }
  }
  const borges = adapter('borges', token);
  try {
    const off = payload(await borges.rpc('tools/call', { name: 'borges_modules' }));
    assert.deepEqual(off.modules.map(item => item.id), ['library', 'links', 'paperwork']);
    assert.equal(service.running, false);
    const search = payload(await borges.rpc('tools/call', { name: 'borges_search_all', arguments: { q: 'synthetic' } }));
    assert.deepEqual(search.sources.map(item => item.status), ['module_disabled', 'module_disabled', 'module_disabled']);
    assert.equal(service.running, false);
    const invalid = await borges.rpc('tools/call', { name: 'borges_set_module', arguments: { module: 'publishing', enabled: true } });
    assert.equal(invalid.result.isError, true);
    assert.equal(service.running, false);
    payload(await borges.rpc('tools/call', { name: 'borges_set_module', arguments: { module: 'links', enabled: true, automatic: false } }));
    assert.equal(service.running, true);
    payload(await borges.rpc('tools/call', { name: 'borges_set_module', arguments: { module: 'links', enabled: false, automatic: false } }));
    assert.equal(service.running, false);
    receipt.contracts.push('borges-three-module-controls-search-off-no-worker-explicit-on-off');
  } finally { await borges.close(); }
  const uncertain = adapter('kafka', token);
  try {
    injectUncertain = true;
    const value = await uncertain.rpc('tools/call', { name: 'deadline_add', arguments: { title: 'Not applied', date: '2030-01-01', kind: 'other' }, _meta: { progressToken: 'qa-progress949' } });
    assert.equal(value.result.isError, true);
    const body = payload(value);
    assert.equal(body.outcome_unknown, true);
    assert.equal(body.reconcile_action, 'read_current_state_before_retry');
    assert.equal(uncertaintyRequests, 1);
    assert.ok(uncertain.notifications.some(item => item.method === 'notifications/progress' && item.params.progressToken === 'qa-progress949'));
    receipt.contracts.push('uncertain-native-write-preserved-no-replay-progress-token');
  } finally { injectUncertain = false; await uncertain.close(); }
  receipt.contracts.push('real-http-bridge-to-frozen-native-headers-context-exact');
  assert.equal(children.size, 0);
  receipt.status = 'PASS';
}

try { await main(); }
catch (error) { receipt.status = 'FAIL'; receipt.error = error.stack || String(error); fixtureError = error; }
finally {
  for (const child of children) { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); }
  try { await api.publishingService().close(); } catch (error) { receipt.cleanup_error = String(error); fixtureError ||= error; }
  receipt.worker_running_after_close = api.publishingService().running;
  api.stopAiBridge();
  await mkdir(base, { recursive: true });
  await writeFile(path.join(base, 'receipt.json'), JSON.stringify(receipt, null, 2));
  if (win && !win.isDestroyed()) win.destroy();
  if (fixtureError) console.error(fixtureError);
  console.log(JSON.stringify({ status: receipt.status, receipt: path.join(base, 'receipt.json') }));
  app.exit(fixtureError || receipt.worker_running_after_close ? 1 : 0);
}
})();
