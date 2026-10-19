import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(os.tmpdir(), 'writer-publishing-qa-'));
process.env.BORGES_EMBED = 'none';
let service, server, child;
try {
  const entry = path.join(directory, 'entry.cjs');
  await build({ stdin: { contents: `export { PublishingService } from './electron/publishing/service'; export { PUBLISHING_TOOLS } from './src/services/aiBridge/manifestPublishing'; export { BRIDGE_TOOLS } from './src/services/aiBridge/manifest'; export { createToolExecutor } from './src/services/aiRuntime/executorCore'; export { nativeWindow } from './src/engines/publishing/navigation';`, resolveDir: root }, outfile: entry, bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, logLevel: 'warning' });
  const { PublishingService, PUBLISHING_TOOLS, createToolExecutor, nativeWindow, BRIDGE_TOOLS } = createRequire(import.meta.url)(entry);
  globalThis.window = Object.assign(new EventTarget(), { location: { hash: '#/publishing', origin: 'http://127.0.0.1:5174' } });
  const libraryWindow = nativeWindow('library');
  let changes = 0;
  libraryWindow.addEventListener('hashchange', () => changes++);
  libraryWindow.location.hash = '#/biblioteca/native-document';
  assert.equal(globalThis.window.location.hash, '#/publishing');
  assert.equal(nativeWindow('links').location.hash, '');
  assert.equal(changes, 1);
  assert.equal(new Set(BRIDGE_TOOLS.map(tool => tool.name)).size, BRIDGE_TOOLS.length, 'No native tool may shadow an existing Writer tool');
  const native = JSON.parse(await readFile(path.join(root, 'publishing/catalog.json'), 'utf8'));
  assert.equal(new Set(PUBLISHING_TOOLS.map(tool => tool.name)).size, PUBLISHING_TOOLS.length);
  for (const tool of native) assert.deepEqual(PUBLISHING_TOOLS.find(item => item.name === tool.name).schema, tool.inputSchema);
  service = new PublishingService({ configFile: path.join(directory, 'modules.json'), dataDir: path.join(directory, 'data'), command: path.join(root, 'publishing/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), args: [path.join(root, 'publishing/worker.py')], cwd: path.join(root, 'publishing') });
  assert.deepEqual((await service.status()).enabled, []);
  assert.equal(service.running, false);
  await service.tool('wh_publishing_modules', {});
  assert.equal(service.running, false);
  const execute = createToolExecutor({ writesEnabled: async () => true, relay: (name, args) => service.tool(name, args), audit: async () => null });
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer private-publishing-qa-token');
      let result;
      if (req.url.startsWith('/api/tools')) result = { tools: PUBLISHING_TOOLS };
      else {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        result = await execute(JSON.parse(Buffer.concat(chunks)), { origin: 'bridge', clientLabel: 'publishing-native-mcp-qa' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) { res.writeHead(500).end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const adapter = path.join(directory, 'mcp.cjs');
  await build({ entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], outfile: adapter, bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, logLevel: 'warning' });
  child = spawn(process.execPath, [adapter], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WH_BRIDGE_TOKEN: 'private-publishing-qa-token', WH_BRIDGE_URL: `http://127.0.0.1:${server.address().port}`, HOARD_EVENTS: '0', BORGES_EMBED: 'none' } });
  let sequence = 0; const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => { const reply = JSON.parse(line); pending.get(reply.id)?.(reply); pending.delete(reply.id); });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timed out: ${method}`)); }, 30000);
    pending.set(id, value => { clearTimeout(timer); if (value.error) reject(new Error(JSON.stringify(value.error))); else resolve(value.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'synthetic-publishing-qa', version: '1' }, capabilities: {} });
  const tools = await rpc('tools/list');
  assert.equal(tools.tools.length, PUBLISHING_TOOLS.length);
  for (const tool of native) assert.deepEqual(tools.tools.find(item => item.name === tool.name).inputSchema, tool.inputSchema);
  for (const tool of native) for (const [key, value] of Object.entries(tool.annotations || {})) assert.equal(tools.tools.find(item => item.name === tool.name).annotations[key], value, `${tool.name}:${key}`);
  const call = async (name, args = {}) => {
    const reply = await rpc('tools/call', { name, arguments: args });
    assert.notEqual(reply.isError, true, JSON.stringify(reply));
    return JSON.parse(reply.content.find(item => item.type === 'text').text);
  };
  const off = await call('wh_publishing_modules');
  assert.equal(off.running, false);
  for (const [module, tool] of [['library', 'library_collections'], ['links', 'list_links'], ['paperwork', 'docs_list'], ['publishing', 'gutenberg_publications']]) {
    await call('wh_publishing_module_set', { module, enabled: true });
    await call(tool);
    await call('wh_publishing_module_set', { module, enabled: false });
    assert.equal(service.running, false);
  }
  await call('wh_publishing_module_set', { module: 'paperwork', enabled: true });
  const settings = await service.request('POST', '/paperwork/api/ui/call', JSON.stringify({ name: 'settings_set', arguments: { values: { 'extract.llm': 'off' } } }), { 'Content-Type': 'application/json' });
  assert.equal(settings.status, 200);
  const bytes = Buffer.alloc(1024 * 1024); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const form = new FormData(); form.append('files', new Blob([bytes], { type: 'text/plain' }), 'synthetic.txt');
  const multipart = new Request('http://127.0.0.1/private', { method: 'POST', body: form });
  const uploaded = await service.request('POST', '/paperwork/api/documents/upload', Buffer.from(await multipart.arrayBuffer()).toString('base64'), Object.fromEntries(multipart.headers), true);
  assert.equal(uploaded.status, 200);
  const upload = JSON.parse(Buffer.from(uploaded.base64, 'base64'));
  const documents = upload.results.flatMap(item => item.documents || []);
  assert.ok(documents.length, JSON.stringify(upload));
  const streamed = await service.stream('GET', `/paperwork/api/documents/${documents[0].id}/file`, { range: 'bytes=17-8192' });
  assert.equal(streamed.status, 200); // Native plain-text originals ignore Range.
  assert.deepEqual(Buffer.from(await streamed.arrayBuffer()), bytes);
  await call('wh_publishing_module_set', { module: 'publishing', enabled: true });
  const ranged = await service.stream('GET', '/publishing/static/icon.png', { range: 'bytes=17-8192' });
  assert.equal(ranged.status, 206);
  const originalIcon = await readFile(path.join(root, 'publishing/editorial/gutenberg_hoard/static/icon.png'));
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), originalIcon.subarray(17, 8193));
  await call('wh_publishing_module_set', { module: 'publishing', enabled: false });
  await call('wh_publishing_module_set', { module: 'paperwork', enabled: false });
  await call('wh_publishing_link_project', { projectId: 'synthetic-project', module: 'publishing', kind: 'publication', object_id: 'native-pub-id', title: 'Private synthetic publication', artifact: { format: 'gutenberg' } });
  const linked = await call('wh_publishing_project_results', { projectId: 'synthetic-project' });
  assert.equal(linked.results[0].object_id, 'native-pub-id');
  console.log(`PASS ${PUBLISHING_TOOLS.length} exact MCP schemas, four native module lifecycles, API/MCP project references, binary multipart/range streaming, scoped navigation and OFF discovery`);
} finally {
  if (child) { const exited = new Promise(resolve => child.once('exit', resolve)); child.stdin.end(); await exited; }
  await service?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await rm(resolved, { recursive: true, force: true });
  else { console.error('Unexpected QA directory; retained.'); process.exitCode = 1; }
}
