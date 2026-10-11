import assert from 'node:assert/strict';
import http from 'node:http';
import { FaustusRelay } from '../electron/ai/faustusRelay';
import { createFaustusFetch } from '../src/services/copilot/faustusTransport';
import { legacyConversationImport } from '../src/services/copilot/faustusHistory';
import type { FaustusFetchEvent, FaustusHostBridge, WriterHoardContext } from '../src/services/copilot/faustusProtocol';

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/stream') {
    assert.equal(req.headers.authorization, 'Bearer secret-in-main');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"text":"España ');
    setTimeout(() => res.end('y dragón"}\n\n'), 25);
  } else if (req.url === '/api/failure') { res.writeHead(503); res.end(JSON.stringify({ error: 'faustus_unavailable' })); }
  else if (req.url === '/api/empty') { res.writeHead(204); res.end(); }
  else {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ body, method: req.method }));
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
try {
  const relay = new FaustusRelay(origin, 'secret-in-main');
  const listeners = new Set<(event: FaustusFetchEvent) => void>();
  const bridge: FaustusHostBridge = {
    getInfo: async () => ({ server: origin, embed_url: '', data_space_id: 'space' }),
    request: (request) => relay.request(request, (event) => { for (const listener of listeners) listener(event); }),
    cancel: async (id) => relay.cancel(id),
    onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const transport = createFaustusFetch(bridge);
  const [stream, failure, post, empty] = await Promise.all([
    transport(`${origin}/api/stream`, { headers: { Authorization: 'Bearer renderer-fake' } }),
    transport(`${origin}/api/failure`),
    transport(`${origin}/api/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"message":"hola"}' }),
    transport(`${origin}/api/empty`),
  ]);
  const reader = stream.body!.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.equal(new TextDecoder().decode(first.value), 'data: {"text":"España ');
  const second = await reader.read();
  assert.equal(new TextDecoder().decode(second.value), 'y dragón"}\n\n');
  assert.equal((await reader.read()).done, true);
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).error, 'faustus_unavailable');
  assert.deepEqual(await post.json(), { body: '{"message":"hola"}', method: 'POST' });
  assert.equal(empty.status, 204);
  assert.equal(empty.body, null);
  assert.equal(listeners.size, 0);
  await assert.rejects(transport('http://other.invalid/api/turn'), /Invalid Faustus API/);
  assert.equal(listeners.size, 0);
  console.log('PASS streaming UTF-8, early chunks, concurrent requests, main-owned token, JSON bodies, errors and empty responses');
  const context: WriterHoardContext = { contract_version: '1.0', origin: { app_id: 'writer', data_space_id: 'space', surface: 'editor' }, project: { external_project_id: 'p', title: 'Novel' }, active_objects: [], view: { mode: 'writings', locale: 'es', enabled_engines: ['writings'] }, attachments: [] };
  const tool = { callId: 'call', tool: 'wh_update_writing', args: { content: 'words' }, risk: 'write', state: 'done' as const, auditIndex: 4 };
  const messages = [{ id: 'm2', projectId: 'p', threadId: 'thread', role: 'tool' as const, status: 'error' as const, content: 'result', createdAt: 2000, toolCall: tool, error: 'error-preserved' }, { id: 'm1', projectId: 'p', threadId: 'thread', role: 'user' as const, status: 'complete' as const, content: 'draft', createdAt: 1000 }];
  const imported = legacyConversationImport(context, { id: 'thread', projectId: 'p', title: 'Previous', policy: 'allow', archived: false, createdAt: 1000, updatedAt: 2000 }, messages);
  assert.equal(imported.messages[0].source_id, 'm1');
  assert.equal(imported.messages[1].created_at, 2);
  assert.equal(imported.messages[1].tool_call_id, 'call');
  assert.deepEqual(imported.messages[1].metadata.writer_tool_call, tool);
  assert.equal(imported.messages[1].metadata.writer_error, 'error-preserved');
  assert.equal(messages[0].id, 'm2');
  console.log('PASS legacy import preserves identities, chronological timestamps, tool undo and failure metadata without changing original rows');
} finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
