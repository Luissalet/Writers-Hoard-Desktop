import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const folder = await mkdtemp(path.join(os.tmpdir(), 'wh-subscription-unit-'));
const originalPath = process.env.PATH;
await writeFile(path.join(folder, process.platform === 'win32' ? 'claude.exe' : 'claude'), 'mock');
await writeFile(path.join(folder, process.platform === 'win32' ? 'codex.exe' : 'codex'), 'mock');
process.env.PATH = folder;
const children = [];
let response = '', exitCode = 0, hang = false;
globalThis.__subscriptionSpawn = (file, args, options) => {
  if (file === 'taskkill.exe') { for (const child of children) if (String(child.pid) === args[1]) child.kill(); return new EventEmitter(); }
  const child = new EventEmitter(); child.pid = 100 + children.length; child.exitCode = null;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdout.setEncoding = child.stderr.setEncoding = child.stderr.resume = () => {};
  child.stdin.end = () => { if (!hang) queueMicrotask(() => { child.stdout.emit('data', response); child.exitCode = exitCode; child.emit('close', exitCode); }); };
  child.kill = () => { child.exitCode = 1; queueMicrotask(() => child.emit('close', 1)); };
  child.unref = () => {}; child.args = args; child.options = options; children.push(child);
  queueMicrotask(() => child.emit('spawn'));
  return child;
};
try {
  const output = path.join(folder, 'client.cjs');
  await build({ entryPoints: ['electron/ai/subscriptionClient.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.resolve('src') }, plugins: [{ name: 'test-stubs', setup(build) {
    build.onResolve({ filter: /^(electron|node:child_process)$/ }, args => ({ path: args.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path === 'electron' ? 'export const net = {};' : 'export const spawn = (...args) => globalThis.__subscriptionSpawn(...args);', loader: 'js' }));
  } }] });
  const client = createRequire(import.meta.url)(output);
  assert.equal(client.confirmsSubscription('codex-subscription', 0, 'Logged in using ChatGPT'), true);
  assert.equal(client.confirmsSubscription('codex-subscription', 0, 'Logged in using an API key'), false);
  assert.equal(client.confirmsSubscription('claude-subscription', 0, '{"loggedIn":true,"authMethod":"console"}'), false);
  assert.equal(client.confirmsSubscription('claude-subscription', 0, '{"loggedIn":true,"authMethod":"claude.ai"}'), true);
  assert.equal(client.confirmsSubscription('claude-subscription', 1, '{"loggedIn":true,"authMethod":"claude.ai"}'), false);
  const clean = client.subscriptionEnvironment({ PATH: 'test', ANTHROPIC_API_KEY: 'dummy', openai_api_key: 'dummy', CLAUDE_CODE_USE_VERTEX: '1', OPENAI_BASE_URL: 'https://invalid.test' });
  assert.deepEqual(clean, { PATH: 'test' });
  response = '{"loggedIn":true,"authMethod":"console"}';
  await assert.rejects(client.checkSubscription('claude-subscription'), { code: 'unauthorized' });
  response = '{"loggedIn":true,"authMethod":"claude.ai"}';
  await client.checkSubscription('claude-subscription');
  const control = new AbortController(); hang = true;
  const pending = client.checkSubscription('claude-subscription', control.signal);
  setTimeout(() => control.abort(), 30);
  await assert.rejects(pending, { code: 'cancelled' });
  assert.notEqual(children.at(-1).exitCode, null, 'Cancellation must terminate the client');
  const shutdownPending = client.checkSubscription('claude-subscription');
  setTimeout(() => client.shutdownSubscriptionClients(), 30);
  await assert.rejects(shutdownPending, { code: 'unauthorized' });
  assert.notEqual(children.at(-1).exitCode, null, 'Shutdown must terminate standalone probes');
  assert.equal(client.parseClaudeAnswer('{"type":"result","subtype":"success","result":"OK"}'), 'OK');
  assert.throws(() => client.parseClaudeAnswer('{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}\n{"type":"result","subtype":"success","result":"OK"}'), { code: 'bad-response' });
  assert.throws(() => client.parseClaudeAnswer('{"type":"result","subtype":"success","is_error":true,"result":"partial"}'), { code: 'bad-response' });
  if (process.platform === 'win32') {
    assert.equal((await client.subscriptionLogin('claude-subscription')).ok, true);
    const login = children.at(-1);
    const command = Buffer.from(login.args.at(-1), 'base64').toString('utf16le');
    assert.match(command, /claude\.exe/);
    assert.match(command, /forceLoginMethod/);
    assert.match(command, /claudeai/);
    assert.equal(login.options.windowsHide, false);
    assert.equal(login.options.env.ANTHROPIC_API_KEY, undefined);
  }
  console.log('Subscription backend tests passed: authentication, no API fallback, parsing, process cancellation and exact-path login.');
} finally { process.env.PATH = originalPath; delete globalThis.__subscriptionSpawn; await rm(folder, { recursive: true, force: true }); }
