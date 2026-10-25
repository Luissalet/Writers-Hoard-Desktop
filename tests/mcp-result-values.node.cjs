const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const esbuild = require('esbuild');

// Mock only the HTTP boundary; compile and spawn the unmodified production adapter.
const cases = [
  { name: 'null', body: { ok: true, result: null }, expected: null },
  { name: 'false', body: { ok: true, result: false }, expected: false },
  { name: 'zero', body: { ok: true, result: 0 }, expected: 0 },
  { name: 'empty-string', body: { ok: true, result: '' }, expected: '' },
  { name: 'object', body: { ok: true, result: {} }, expected: {} },
  { name: 'array', body: { ok: true, result: [] }, expected: [] },
  // JSON omits an undefined result property: this is the existing fallback contract.
  { name: 'undefined-fallback', body: { ok: true, result: undefined }, expected: {} },
  { name: 'object-audit', body: { ok: true, result: { value: 'kept' }, auditIndex: 17 }, expected: { value: 'kept', _undo: { app_id: 'writer', audit_index: 17 } } },
  { name: 'null-audit', body: { ok: true, result: null, auditIndex: 18 }, expected: null },
];

async function main() {
  const started = process.hrtime.bigint();
  const root = path.resolve(__dirname, '..');
  const artifactRoot = path.join(root, '_stage/sdk-icons-next/transport-review');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const runtime = fs.mkdtempSync(path.join(artifactRoot, 'runtime-'));
  const adapter = path.join(root, 'electron/aibridge/mcpStdio.ts');
  const compiled = path.join(runtime, 'mcpStdio.cjs');
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const adapterBefore = sha(adapter);
  let child;
  let exitPromise;
  let stderr = '';
  let stdoutBuffer = '';
  const pending = new Map();
  const received = [];
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/api/call');
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      assert.equal(request.tool, 'wh_local_tool_icons');
      assert.equal(request.client, 'mcp-stdio');
      const fixture = cases.find(item => item.name === request.args.case);
      assert.ok(fixture, 'known HTTP fixture');
      received.push(fixture.name);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fixture.body));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    for (const item of pending.values()) item.reject(Error('180000ms transport deadline'));
    child?.kill();
    server.closeAllConnections();
    server.close();
  }, 180000);
  const outcomes = [];
  try {
    await esbuild.build({ entryPoints: [adapter], bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.join(root, 'src') }, logLevel: 'warning', outfile: compiled });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    child = spawn(process.execPath, [compiled], { cwd: root, windowsHide: true, env: { ...process.env, WH_BRIDGE_URL: `http://127.0.0.1:${server.address().port}`, WH_BRIDGE_TOKEN: token, WH_MCP_NO_AUTOSTART: '0', WH_PUBLISHING_MODULE: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    exitPromise = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk;
      let newline;
      while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newline); stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const reply = JSON.parse(line);
          const waiting = pending.get(reply.id);
          if (!waiting) throw Error('unexpected JSON-RPC reply id');
          pending.delete(reply.id);
          waiting.resolve(reply);
        } catch (error) { for (const item of pending.values()) item.reject(error); pending.clear(); }
      }
    });
    child.once('exit', () => { for (const item of pending.values()) item.reject(Error('adapter exited before reply')); pending.clear(); });
    let nextId = 1;
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => { if (error) { pending.delete(id); reject(error); } });
    });
    const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
    assert.equal(init.result.serverInfo.name, 'writers-hoard');
    for (const fixture of cases) {
      const reply = await rpc('tools/call', { name: 'wh_local_tool_icons', arguments: { case: fixture.name } });
      try {
        assert.equal(reply.jsonrpc, '2.0');
        assert.equal(reply.error, undefined);
        assert.equal(reply.result.isError, false);
        assert.equal(reply.result.content.length, 1);
        assert.equal(reply.result.content[0].type, 'text');
        const actual = JSON.parse(reply.result.content[0].text);
        assert.deepStrictEqual(actual, fixture.expected);
        outcomes.push({ case: fixture.name, pass: true, actual });
        console.log(`PASS ${fixture.name}: ${JSON.stringify(actual)}`);
      } catch (error) {
        outcomes.push({ case: fixture.name, pass: false, expected: fixture.expected, reply, error: error.message });
        console.log(`FAIL ${fixture.name}: ${error.message}`);
      }
    }
    assert.deepStrictEqual(received, cases.map(item => item.name));
    child.stdin.end();
    const exit = await exitPromise;
    assert.deepStrictEqual(exit, { code: 0, signal: null }, 'actual adapter exit after EOF');
    assert.equal(stderr, '', 'adapter stderr');
    assert.equal(stdoutBuffer, '', 'no partial protocol line');
    assert.equal(sha(adapter), adapterBefore, 'source adapter unchanged by test');
    assert.equal(timedOut, false);
    console.log(JSON.stringify({ adapterSha256: adapterBefore, compiledSha256: sha(compiled), testSha256: sha(__filename), cases: outcomes, adapterExit: exit, seconds: Number(process.hrtime.bigint() - started) / 1e9, boundary: 'mock ephemeral authenticated HTTP; production compiled stdio adapter; no Electron/IPC/DB' }));
    assert.equal(outcomes.filter(item => !item.pass).length, 0, 'all literal MCP result values must survive transport');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.stdin.end(); child.kill(); }
    if (exitPromise) await exitPromise;
    await new Promise(resolve => server.close(resolve));
    clearTimeout(deadline);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
