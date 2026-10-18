import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { configureFiction, fictionService, FictionService } from '../electron/fiction/service';
import { BRIDGE_TOOLS } from '../src/services/aiBridge/manifest';
import { FICTION_TOOLS } from '../src/services/aiBridge/manifestFiction';
import { getBridgeToken, setBridgeConfig } from '../electron/aibridge/state';
import { startAiBridge, stopAiBridge } from '../electron/aibridge/server';
import { familyCall } from '../electron/familyCall';

export async function runFictionIntegration(root: string, directory: string, port: number, packaged = false) {
  const story = path.join(root, 'story');
  const configFile = path.join(directory, 'fiction', 'modules.json');
  const dataDir = path.join(directory, 'worlds');
  configureFiction({ configFile, dataDir, cwd: story,
    command: packaged ? path.join(story, 'runtime', 'writer-fiction-worker', 'writer-fiction-worker.exe') : path.join(story, '.venv', 'Scripts', 'python.exe'),
    args: packaged ? [] : [path.join(story, 'worker.py')],
  });
  const engine = fictionService();
  assert.deepEqual((await engine.status()).enabled, []);
  assert.equal((await engine.status()).running, false);
  await assert.rejects(fs.stat(dataDir));
  const blocked = path.join(directory, 'blocked-control-directory');
  await fs.writeFile(blocked, 'synthetic file, not a directory');
  const failedControl = new FictionService({ configFile: path.join(blocked, 'modules.json'), dataDir,
    cwd: story, command: 'not-started', args: [] });
  await assert.rejects(failedControl.setModule('fiction', true));
  assert.deepEqual((await failedControl.status()).enabled, []);
  assert.equal((await failedControl.status()).running, false);
  assert.equal(FICTION_TOOLS.length, 21);
  assert.equal(new Set(BRIDGE_TOOLS.map(tool => tool.name)).size, BRIDGE_TOOLS.length);
  assert.equal((await engine.tool('story_worlds', {})).ok, false);
  await assert.rejects(fs.stat(dataDir));
  await setBridgeConfig({ enabled: true, writesEnabled: true });
  await startAiBridge({ version: 'fiction-synthetic-test', hasWindow: () => false });
  const token = await getBridgeToken();
  const url = `http://127.0.0.1:${port}`;
  const apiCall = async (tool: string, args: Record<string, unknown> = {}) => {
    const response = await fetch(`${url}/api/agent/call`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, arguments: args }) });
    const body = await response.json();
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  };
  const request = async (method: string, apiPath: string, body?: unknown) => {
    const reply = await engine.request(method, apiPath, body === undefined ? '' : JSON.stringify(body));
    const result = JSON.parse(Buffer.from(reply.base64, 'base64').toString('utf8'));
    assert.ok(reply.status < 400, JSON.stringify(result));
    return result;
  };
  const mcp = spawn(process.env.WRITER_TEST_NODE || 'node', [path.join(root, 'dist-electron/aibridge/mcpStdio.cjs')], {
    windowsHide: true, env: { ...process.env, WH_BRIDGE_URL: url, WH_BRIDGE_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let sequence = 0;
  createInterface({ input: mcp.stdout }).on('line', line => {
    const message = JSON.parse(line);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const rpc = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const reply = await rpc('tools/call', { name, arguments: args });
    assert.equal(reply.isError ?? false, false, JSON.stringify(reply));
    const text = reply.content.find((block: { type: string }) => block.type === 'text')?.text;
    return JSON.parse(text);
  };
  try {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'writer-fiction-test', version: '1' } });
    const catalog = await rpc('tools/list');
    assert.equal(catalog.tools.length, BRIDGE_TOOLS.length);
    for (const tool of FICTION_TOOLS) assert.ok(catalog.tools.some((item: { name: string }) => item.name === tool.name));
    assert.equal((await engine.status()).running, false);
    await apiCall('wh_story_module_set', { module: 'fiction', enabled: true });
    assert.equal((await engine.status()).running, false);
    await Promise.all([engine.setModule('narration', true), engine.setModule('voice', true), engine.setModule('illustrations', true)]);
    assert.deepEqual(new Set((await engine.status()).enabled), new Set(['fiction', 'narration', 'voice', 'illustrations']));
    await Promise.all([engine.setModule('narration', false), engine.setModule('voice', false), engine.setModule('illustrations', false)]);
    assert.deepEqual((await engine.status()).enabled, ['fiction']);
    assert.equal((await engine.status()).running, false);
    const world = await call('story_world_create', { name: 'Synthetic harbour', genre: 'fantasy', language: 'es' });
    const worldId = world.id;
    assert.ok(worldId);
    const actualRest = await fetch(`${url}/api/fiction/worlds`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(actualRest.status, 200);
    assert.equal((await actualRest.json()).length, 1);
    const identity = await request('GET', '/api/writer-identity');
    assert.ok(identity.data_space_id);
    const nativeCatalog = await request('GET', '/api/agent/tools');
    assert.deepEqual(nativeCatalog.tools.map((tool: { name: string }) => tool.name).sort(), FICTION_TOOLS.filter(tool => !tool.name.startsWith('wh_story_')).map(tool => tool.name).sort());
    assert.equal((await call('story_worlds')).worlds.length, 1);
    const place = await call('entity_upsert', { world: worldId, kind: 'location', name: 'Faro' });
    const person = await call('entity_upsert', { world: worldId, kind: 'character', name: 'Inés', summary: 'Capitana sintética', secrets: 'Secreto de prueba' });
    assert.equal((await call('entity_get', { world: worldId, ref: person.ref })).secrets, undefined);
    assert.equal((await call('world_search', { world: worldId, query: 'Ines' })).entities.length, 1);
    const session = await call('session_start', { world: worldId, title: 'Primera noche' });
    await call('session_rename', { world: worldId, session: session.id, title: 'El faro' });
    const turn = await call('story_append', { world: worldId, text: 'Inés encendió el faro.', role: 'narration', delta: { scene: { location: place.ref, present: [person.ref] } } });
    assert.ok(turn.turn_id);
    assert.ok((await call('world_context', { world: worldId })).brief.includes('Inés'));
    assert.equal(typeof (await call('dice_roll', { world: worldId, expression: '2d6+1', reason: 'Synthetic check' })).total, 'number');
    const thread = await request('POST', `/api/worlds/${worldId}/threads`, { title: 'La luz' });
    await call('thread_update', { world: worldId, thread: thread.id, note: 'Encendida' });
    const clock = await request('POST', `/api/worlds/${worldId}/clocks`, { name: 'Marea', segments: 4 });
    assert.equal((await call('clock_tick', { world: worldId, clock: clock.id, ticks: 2 })).filled, 2);
    const table = await request('POST', `/api/worlds/${worldId}/tables`, { name: 'Viento', entries: [{ text: 'Brisa', weight: 1 }] });
    assert.equal((await call('table_roll', { world: worldId, table: table.id })).text, 'Brisa');
    assert.notEqual((await call('world_check', { world: worldId, statement: 'Inés está en el faro.' })).llm_judge, 'used');
    assert.ok((await call('session_export', { world: worldId, session: session.id })).text.includes('Inés'));
    const exported = await call('world_export', { world_id: worldId });
    assert.equal(exported.schema, 'hoard.world/1');
    const imported = await call('world_import', { data: exported });
    assert.ok(imported.world);
    const worldCount = (await call('story_worlds')).worlds.length;
    const localExchange = await familyCall({ app: 'scheherazade', tool: 'world_export', args: { world_id: worldId } });
    assert.equal(localExchange.ok, true);
    const blocked = await engine.tool('scene_narrate', { session_id: session.id, turn: turn.turn_id });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error || '', /voice is OFF/);
    await apiCall('wh_story_module_set', { module: 'voice', enabled: true });
    const voice = await call('scene_narrate', { session_id: session.id, turn: turn.turn_id });
    assert.ok(voice.bytes > 0);
    const audio = await engine.request('GET', voice.audio_url);
    assert.equal(audio.status, 200);
    await apiCall('wh_story_module_set', { module: 'narration', enabled: true });
    const narration = await request('POST', `/api/worlds/${worldId}/narrate`, { world: worldId, action_text: 'Esperar', budget_chars: 3000 });
    assert.ok(narration.narration.includes('sintética'));
    await apiCall('wh_story_module_set', { module: 'narration', enabled: false });
    await call('story_append', { world: worldId, text: 'Turno deshecho.' });
    assert.ok((await call('story_undo', { world: worldId })).undone_turn_id);
    const pid = (await engine.status()).pid;
    await apiCall('wh_story_module_set', { module: 'fiction', enabled: false });
    assert.equal((await engine.status()).running, false);
    assert.throws(() => process.kill(pid!, 0));
    const saved = JSON.parse(await fs.readFile(configFile, 'utf8'));
    assert.ok(!saved.enabled.includes('fiction'));
    assert.ok((await fs.stat(path.join(dataDir, 'scheherazade.db'))).size > 0);
    // Restarting uses the same in-place database; the explicit switch starts no process.
    await engine.setModule('fiction', true);
    assert.equal((await engine.status()).running, false);
    assert.equal((await call('story_worlds')).worlds.length, worldCount);
    assert.equal((await request('GET', '/api/writer-identity')).data_space_id, identity.data_space_id);
    await engine.setModule('voice', false);
    await engine.setModule('fiction', false);
    stopAiBridge();
    const offlineCatalog = await rpc('tools/list');
    assert.equal(offlineCatalog.tools.length, BRIDGE_TOOLS.length);
    assert.equal((await engine.status()).running, false);
    return { catalog: BRIDGE_TOOLS.length, nativeTools: 19, controls: 2, allPassed: true,
      checks: ['all OFF/no data access', 'actual Writer API and MCP stdio', 'all 19 native tool paths', 'native REST CRUD', 'optional voice/model through synthetic hub', 'internal world exchange', 'in-place restart', 'OFF joins worker process'] };
  } finally {
    mcp.stdin.end();
    await engine.close();
    stopAiBridge();
  }
}
