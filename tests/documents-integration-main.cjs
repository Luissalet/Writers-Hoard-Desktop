const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const root = path.resolve(__dirname, '..');
const evidence = process.env.WRITER_DOCUMENT_QA_DIR || path.join(root, 'native', 'target', 'integration-qa');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(evidence, 'profile'));
process.env.WH_AIBRIDGE_PORT = '63007';
process.env.HOARD_EVENTS = '0';
const assert = (value, message) => { if (!value) throw new Error(message); };

async function main() {
  await app.whenReady();
  const bundle = path.join(evidence, 'native-http.cjs');
  await esbuild.build({ stdin: { contents: `export {startAiBridge,stopAiBridge} from './electron/aibridge/server'; export {setBridgeConfig,getBridgeToken} from './electron/aibridge/state'; export {configureDocumentEngine,stopDocumentEngine} from './electron/documents/nativeDocumentService';`, resolveDir: root }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, external: ['electron'], logLevel: 'warning' });
  const native = require(bundle);
  native.configureDocumentEngine({ appPath: root, executablePath: path.join(root, 'native', 'bin', 'writer-document-engine.exe') });
  await native.setBridgeConfig({ enabled: true, writesEnabled: true });
  await native.startAiBridge({ version: 'qa-owned-document', hasWindow: () => false });
  const token = await native.getBridgeToken();
  const httpCall = async (tool, args = {}) => {
    const response = await fetch('http://127.0.0.1:63007/api/call', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args }) });
    const outcome = await response.json();
    assert(outcome.ok, `HTTP ${tool}: ${outcome.error}`);
    return outcome.result;
  };
  const receipts = [];
  let adapter;
  try {
    const catalogue = await httpCall('wh_document_commands', { query: 'format.bold' });
    assert(catalogue.commands.some(command => command.id === 'format.bold'), 'Command lookup missing');
    const opened = await httpCall('wh_document_import', { html: '<p style="text-align:center"><strong>Árbol 👩‍🚀</strong> y café.</p><table><tr><td><p>Uno</p></td><td><p>Dos</p></td></tr></table>' });
    const sessionId = opened.sessionId;
    assert(typeof sessionId === 'string', 'Native session id missing');
    const text = await httpCall('wh_document_text', { sessionId });
    assert(text.text.includes('Árbol 👩‍🚀') && text.text.includes('Uno'), 'HTTP lost Unicode/table text');
    const archive = await httpCall('wh_document_export_bytes', { sessionId, format: 'writer.json' });
    const parsed = JSON.parse(Buffer.from(archive.dataBase64, 'base64').toString('utf8'));
    assert(parsed.format === 'writers-document' && parsed.assets && parsed.passthrough, 'Archive incomplete');
    const docx = await httpCall('wh_document_export_bytes', { sessionId, format: 'docx' });
    assert(Buffer.from(docx.dataBase64, 'base64').subarray(0, 2).toString() === 'PK', 'DOCX invalid ZIP');
    const pdf = await httpCall('wh_document_pdf', { sessionId });
    assert(Buffer.from(pdf.dataBase64, 'base64').subarray(0, 4).toString() === '%PDF', 'PDF missing');
    fs.writeFileSync(path.join(evidence, 'native-document.docx'), Buffer.from(docx.dataBase64, 'base64'));
    fs.writeFileSync(path.join(evidence, 'native-document.pdf'), Buffer.from(pdf.dataBase64, 'base64'));
    receipts.push('Product HTTP -> common executor -> own Rust: catalogue, Unicode/table document, complete archive, DOCX and PDF');

    const adapterPath = path.join(evidence, 'mcpStdio.cjs');
    await esbuild.build({ entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], outfile: adapterPath, bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, logLevel: 'warning' });
    adapter = spawn(process.env.WRITER_NODE_EXECUTABLE || 'node', [adapterPath], { env: { ...process.env, WH_BRIDGE_URL: 'http://127.0.0.1:63007', WH_BRIDGE_TOKEN: token, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map();
    let next = 0;
    readline.createInterface({ input: adapter.stdout }).on('line', line => {
      const reply = JSON.parse(line); const entry = pending.get(reply.id);
      if (entry) { pending.delete(reply.id); clearTimeout(entry.timer); entry.resolve(reply); }
    });
    adapter.stderr.on('data', () => {});
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP response timed out')); }, 120000);
      pending.set(id, { resolve, timer }); adapter.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa-documents', version: '1' } });
    assert(init.result?.serverInfo?.name === 'writers-hoard', 'Wrong MCP server');
    const tools = await rpc('tools/list', {});
    assert(tools.result.tools.some(tool => tool.name === 'wh_document_render'), 'MCP native tools missing');
    const read = await rpc('tools/call', { name: 'wh_document_text', arguments: { sessionId } });
    assert(!read.result.isError && JSON.parse(read.result.content.find(item => item.type === 'text').text).text.includes('Árbol 👩‍🚀'), 'MCP text failed');
    const render = await rpc('tools/call', { name: 'wh_document_render', arguments: { sessionId, page: 1 } });
    assert(!render.result.isError && render.result.content.some(item => item.type === 'image' && item.mimeType === 'image/png'), 'MCP page did not return a vision image');
    const image = render.result.content.find(item => item.type === 'image');
    assert(!render.result.content.find(item => item.type === 'text').text.includes(image.data.slice(0, 80)), 'Base64 duplicated into MCP text');
    fs.writeFileSync(path.join(evidence, 'native-document.png'), Buffer.from(image.data, 'base64'));
    receipts.push('Real stdio MCP -> product HTTP -> own Rust session: tool discovery, Unicode text, PNG vision without duplicate base64');
    await httpCall('wh_document_close', { sessionId });
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ ok: true, receipts, binarySha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'native/bin/writer-document-engine.exe'))).digest('hex') }, null, 2));
    receipts.forEach(receipt => console.log('PASS ' + receipt));
  } finally {
    if (adapter) adapter.kill();
    native.stopAiBridge(); await native.stopDocumentEngine();
  }
  app.exit(0);
}
main().catch(error => { console.error(error.stack || error); app.exit(1); });
