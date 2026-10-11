import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const service = await import(pathToFileURL(process.env.WRITER_DOCUMENT_SERVICE_TEST_MODULE).href);
const { configureDocumentEngine, executeDocumentTool, isNativeDocumentTool, stopDocumentEngine } = service;
const temporary = await mkdtemp(path.join(os.tmpdir(), 'writers-document-fixture-'));
const fixture = path.join(temporary, 'fixture.mjs');
await writeFile(fixture, `
import readline from 'node:readline';
import { writeFileSync } from 'node:fs';
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const {id, action, args} = JSON.parse(line);
  if (args.mode === 'exit') return setTimeout(() => process.exit(7), 20);
  if (args.mode === 'invalid') return process.stdout.write('not-json\\n');
  if (args.mode === 'large') process.stderr.write('ignored diagnostics'.repeat(100000));
  if (args.mode === 'error') return process.stdout.write(JSON.stringify({id,ok:false,error:{code:'NATIVE_TEST_ERROR',message:'No existe sesión ñ'}})+'\\n');
  if (args.mode === 'image') return process.stdout.write(JSON.stringify({id,ok:true,result:{dataBase64:'UE5H',mimeType:'image/png',width:5,height:9}})+'\\n');
  const output = Buffer.from(JSON.stringify({id,ok:true,result:{action,args,pid:process.pid}})+'\\n');
  if (args.mode === 'chunked') {
    let i = 0;
    const write = () => {
      if(i === output.length) return;
      process.stdout.write(output.subarray(i,i+1)); i++;
      setImmediate(write);
    };
    return write();
  }
  setTimeout(() => {
    if(args.marker) writeFileSync(args.marker,'applied');
    process.stdout.write(output);
  }, args.delay ?? 0);
});
`, 'utf8');

beforeEach(async () => {
  await stopDocumentEngine();
  configureDocumentEngine({ executablePath: process.execPath, executableArgs: [fixture] });
});

after(async () => {
  await stopDocumentEngine();
  await rm(temporary, { recursive: true, force: true });
});

test('tool recognition uses only own names and never inherits object properties', async () => {
  assert.equal(isNativeDocumentTool('wh_document_new'), true);
  assert.equal(isNativeDocumentTool('wh_document_open_bytes'), true);
  assert.equal(isNativeDocumentTool('wh_document_export_bytes'), true);
  assert.equal(isNativeDocumentTool('toString'), false);
  assert.equal((await executeDocumentTool('not_a_tool')).code, 'DOCUMENT_TOOL_UNKNOWN');
});

test('a persistent child decodes split UTF8 correctly and maps actions', async () => {
  const original = 'Canción de España — pingüino 🪶 日本語';
  const response = await executeDocumentTool('wh_document_import', { mode: 'chunked', html: original });
  assert.equal(response.ok, true);
  assert.equal(response.result.action, 'document.importHtml');
  assert.equal(response.result.args.html, original);
  const next = await executeDocumentTool('wh_document_text');
  assert.equal(next.result.pid, response.result.pid);
});

test('concurrent requests retain identity when native replies arrive out of order', async () => {
  const results = await Promise.all(Array.from({ length: 15 }, (_, i) =>
    executeDocumentTool('wh_document_inspect', { item: i, delay: (15 - i) * 3 })));
  assert.deepEqual(results.map(result => result.result.args.item), Array.from({ length: 15 }, (_, i) => i));
  assert.equal(new Set(results.map(result => result.result.pid)).size, 1);
});

test('native operation errors preserve their code and UTF8 message', async () => {
  assert.deepEqual(await executeDocumentTool('wh_document_execute', { mode: 'error' }), {
    ok: false, code: 'NATIVE_TEST_ERROR', error: 'No existe sesión ñ',
  });
});

test('native page images reach MCP media while retaining UI bytes and other tools stay unchanged', async () => {
  const rendered = await executeDocumentTool('wh_document_render', { mode: 'image', page: 2 });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.result.dataBase64, 'UE5H');
  assert.deepEqual(rendered.result._media, [{ base64: 'UE5H', mimeType: 'image/png', label: 'Document page 2' }]);
  assert.equal(rendered.result.width, 5);
  const ordinary = await executeDocumentTool('wh_document_inspect', { mode: 'image' });
  assert.deepEqual(ordinary.result, { dataBase64: 'UE5H', mimeType: 'image/png', width: 5, height: 9 });
});

test('draining native diagnostics cannot block its response', async () => {
  const result = await executeDocumentTool('wh_document_inspect', { mode: 'large' }, 3000);
  assert.equal(result.ok, true);
});

test('exit settles every pending request and the next call starts a fresh child', async () => {
  const first = await executeDocumentTool('wh_document_new');
  const [crash, pending] = await Promise.all([
    executeDocumentTool('wh_document_execute', { mode: 'exit' }),
    executeDocumentTool('wh_document_text', { delay: 1000 }),
  ]);
  assert.equal(crash.code, 'DOCUMENT_ENGINE_EXIT');
  assert.equal(pending.code, 'DOCUMENT_ENGINE_EXIT');
  const restarted = await executeDocumentTool('wh_document_new');
  assert.equal(restarted.ok, true);
  assert.notEqual(first.result.pid, restarted.result.pid);
});

test('timeout stops its child before returning and prevents a delayed mutation', async () => {
  const marker = path.join(temporary, 'late-mutation.txt');
  const first = await executeDocumentTool('wh_document_new');
  const mutation = executeDocumentTool('wh_document_execute', { delay: 250, marker }, 30);
  const queued = executeDocumentTool('wh_document_inspect', { delay: 1000 });
  const [timeout, other] = await Promise.all([mutation, queued]);
  assert.equal(timeout.code, 'DOCUMENT_ENGINE_TIMEOUT');
  assert.equal(other.code, 'DOCUMENT_ENGINE_TIMEOUT');
  await assert.rejects(access(marker));
  const next = await executeDocumentTool('wh_document_new');
  assert.notEqual(first.result.pid, next.result.pid);
  await new Promise(resolve => setTimeout(resolve, 300));
  await assert.rejects(access(marker));
});

test('malformed protocol closes sessions and permits restart', async () => {
  const invalid = await executeDocumentTool('wh_document_inspect', { mode: 'invalid' });
  assert.equal(invalid.code, 'DOCUMENT_ENGINE_PROTOCOL');
  assert.equal((await executeDocumentTool('wh_document_commands')).ok, true);
});

test('explicit shutdown settles in-flight work before it finishes', async () => {
  const pending = executeDocumentTool('wh_document_batch', { delay: 1000 });
  await stopDocumentEngine();
  assert.equal((await pending).code, 'DOCUMENT_ENGINE_STOPPED');
});

test('missing executable returns an actionable error and does not retain a broken child', async () => {
  configureDocumentEngine({ executablePath: path.join(temporary, 'absent.exe') });
  assert.equal((await executeDocumentTool('wh_document_commands')).code, 'DOCUMENT_ENGINE_UNAVAILABLE');
  configureDocumentEngine({ executablePath: process.execPath, executableArgs: [fixture] });
  assert.equal((await executeDocumentTool('wh_document_commands')).ok, true);
});

test('packaged resources and QA override resolve without importing Electron', async () => {
  const previous = process.env.WRITER_DOCUMENT_ENGINE_PATH;
  try {
    process.env.WRITER_DOCUMENT_ENGINE_PATH = process.execPath;
    configureDocumentEngine({ isPackaged: true, resourcesPath: temporary, executableArgs: [fixture] });
    assert.equal((await executeDocumentTool('wh_document_commands')).ok, true);
    await stopDocumentEngine();
    delete process.env.WRITER_DOCUMENT_ENGINE_PATH;
    configureDocumentEngine({ isPackaged: true, resourcesPath: temporary });
    const missing = await executeDocumentTool('wh_document_commands');
    assert.equal(missing.code, 'DOCUMENT_ENGINE_UNAVAILABLE');
    assert.match(missing.error, /documents/);
  } finally {
    if (previous === undefined) delete process.env.WRITER_DOCUMENT_ENGINE_PATH;
    else process.env.WRITER_DOCUMENT_ENGINE_PATH = previous;
  }
});

test('invalid timeout and circular arguments fail without starting an engine', async () => {
  assert.equal((await executeDocumentTool('wh_document_new', {}, 0)).code, 'DOCUMENT_TIMEOUT_INVALID');
  const circular = {}; circular.self = circular;
  assert.equal((await executeDocumentTool('wh_document_new', circular)).code, 'DOCUMENT_ARGUMENTS_INVALID');
  configureDocumentEngine({ executablePath: process.execPath, executableArgs: [fixture] });
});

test('real own Rust engine completes native document lifecycle', { skip: !process.env.WRITER_DOCUMENT_ENGINE_TEST_BINARY }, async () => {
  configureDocumentEngine({ executablePath: process.env.WRITER_DOCUMENT_ENGINE_TEST_BINARY });
  const commands = await executeDocumentTool('wh_document_commands');
  assert.equal(commands.ok, true);
  assert.ok(commands.result.commands.length > 0);
  const created = await executeDocumentTool('wh_document_import', { html: '<h1>España</h1><p>Canción del pingüino.</p>' });
  assert.equal(created.ok, true, created.error);
  const sessionId = created.result.sessionId;
  const text = await executeDocumentTool('wh_document_text', { sessionId });
  assert.equal(text.ok, true, text.error);
  assert.match(text.result.text, /Canción del pingüino/);
  const exported = await executeDocumentTool('wh_document_export_bytes', { sessionId, format: 'docx', fileName: 'prueba.docx' });
  assert.equal(exported.ok, true, exported.error);
  assert.equal(Buffer.from(exported.result.dataBase64, 'base64').subarray(0, 2).toString(), 'PK');
  const opened = await executeDocumentTool('wh_document_open_bytes', { dataBase64: exported.result.dataBase64, format: 'docx' });
  assert.equal(opened.ok, true, opened.error);
  const recovered = await executeDocumentTool('wh_document_text', { sessionId: opened.result.sessionId });
  assert.match(recovered.result.text, /Canción del pingüino/);
  const pdf = await executeDocumentTool('wh_document_pdf', { sessionId });
  assert.equal(pdf.ok, true, pdf.error);
  assert.equal(Buffer.from(pdf.result.dataBase64, 'base64').subarray(0, 5).toString(), '%PDF-');
  const image = await executeDocumentTool('wh_document_render', { sessionId, page: 1 });
  assert.equal(image.ok, true, image.error);
  assert.equal(image.result.mimeType, 'image/png');
  assert.deepEqual(image.result._media, [{ base64: image.result.dataBase64, mimeType: 'image/png', label: 'Document page 1' }]);
  const output = path.join(temporary, 'prueba.docx');
  assert.equal((await executeDocumentTool('wh_document_save', { sessionId, path: output })).ok, true);
  assert.equal((await readFile(output)).subarray(0, 2).toString(), 'PK');
  assert.equal((await executeDocumentTool('wh_document_close', { sessionId })).ok, true);
  assert.equal((await executeDocumentTool('wh_document_inspect', { sessionId })).ok, false);
});
