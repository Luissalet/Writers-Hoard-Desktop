// Actual HTTP/socket failure regression, never dispatching an operation.
// Optional packaged executable/adapter paths exercise the final shipped bytes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.WH_MCP_HTTP_QA || await mkdtemp(path.join(os.tmpdir(), 'writer-http-'));
await mkdir(base, { recursive: true });
const executable = process.env.WH_MCP_HTTP_NODE || process.execPath;
let adapter = process.env.WH_MCP_HTTP_ADAPTER;
if (!adapter) {
  adapter = path.join(base, 'mcp.cjs');
  const { build } = createRequire(import.meta.url)('esbuild');
  await build({ bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning', alias: { '@': path.join(root, 'src') }, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], outfile: adapter });
}
const timeoutHook = path.join(base, 'short-timeout.cjs');
await writeFile(timeoutHook, "const h=require('node:http'),original=h.request;h.request=function(options,...args){return original.call(this,{...options,timeout:40},...args)};\n");

async function call(port, name, legacy, shortenTimeout = false) {
  const child = spawn(executable, [...(shortenTimeout ? ['--require', timeoutHook] : []), adapter, ...(legacy ? ['--publishing-module', 'kafka'] : [])], {
    cwd: base, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WH_BRIDGE_TOKEN: 'synthetic-http949', WH_BRIDGE_URL: `http://127.0.0.1:${port}` },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  let timer;
  try {
    const reply = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('MCP response timed out: ' + stderr)), 5000);
      child.once('error', reject);
      lines.on('line', line => {
        const value = JSON.parse(line);
        if (value.id === 1) resolve(value);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { title: 'Synthetic only, never applied', date: '2030-01-01', kind: 'other' } } }) + '\n');
    });
    assert.equal(reply.result.isError, true);
    return JSON.parse(reply.result.content[0].text);
  } finally {
    clearTimeout(timer);
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end();
    await exited;
    lines.close();
  }
}

const results = [];
for (const legacy of [true, false]) {
  for (const mode of ['reset', 'partial-response', 'invalid-json', 'timeout', 'read-reset']) {
    const requests = [];
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requests.push({ route: req.url, body: JSON.parse(body) });
        if (mode === 'reset' || mode === 'read-reset') req.socket.destroy();
        else if (mode === 'partial-response') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '10000' });
          res.flushHeaders();
          res.write('{"ok":true,"result":');
          setTimeout(() => req.socket.destroy(), 20);
        } else if (mode === 'invalid-json') res.end('not valid JSON');
        // timeout deliberately leaves the real socket without a response.
      });
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const readOnly = mode === 'read-reset';
      const result = await call(server.address().port, readOnly ? 'docs_list' : 'deadline_add', legacy, mode === 'timeout');
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(requests.length, 1, 'No automatic replay');
      assert.equal(result.code, readOnly ? 'transport-error' : 'outcome_unknown');
      assert.equal(result.outcome_unknown, !readOnly);
      if (!readOnly) assert.equal(result.reconcile_action, 'read_current_state_before_retry');
      assert.equal(requests[0].body[legacy ? 'name' : 'tool'], readOnly ? 'docs_list' : 'deadline_add');
      results.push({ legacy, mode, requests: requests.length, result });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  }
  const reserve = http.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const refused = await call(port, 'deadline_add', legacy);
  assert.equal(refused.code, 'app-closed');
  assert.notEqual(refused.outcome_unknown, true);
  results.push({ legacy, mode: 'connection-refused', result: refused });
}
const receipt = { status: 'PASS', adapter, executable, synthetic_only: true, native_operations: 0, cases: results };
await writeFile(path.join(base, 'http-receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: 'PASS', cases: results.length, evidence: base }, null, 2));
