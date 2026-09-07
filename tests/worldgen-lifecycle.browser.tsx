import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { createWorldEditWriter } from '@/engines/worldgen/editWriter';
import { applyWorldPreset, matchesWorldPreset, WORLD_PRESETS } from '@/engines/worldgen/core/presets';
import { DEFAULT_PARAMS, packWorld, type WorldData } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { getCachedWorld, paramsKey, useWorldGeneration } from '@/engines/worldgen/useWorldGeneration';
import { loadSnapshot } from '@/engines/worldgen/snapshots';
import { resolveWorldgenRoute } from '@/engines/worldgen/navigation';
import { flushPendingWrites, getPendingWritesSnapshot, retryFailedWrites } from '@/services/pendingWrites';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function testWorldgenLifecycle(): Promise<string[]> {
  const passed: string[] = [];
  const navigationProject = `worldgen-navigation-${Date.now()}`;
  const legacyWorldId = `${navigationProject}-imported map`;
  const misleadingWaypointId = `region-world-${navigationProject}`;
  await db.generatedWorlds.add({ id: legacyWorldId, projectId: navigationProject, title: 'Imported world', params: DEFAULT_PARAMS, createdAt: 1, updatedAt: 1 });
  await db.worldWaypoints.add({ id: misleadingWaypointId, projectId: navigationProject, worldId: legacyWorldId, name: 'Harbour', color: '#c4973b', u: 0.5, v: 0.5, createdAt: 1, updatedAt: 1 });
  try {
    const route = `/project/${encodeURIComponent(navigationProject)}/worldgen`;
    assert(await resolveWorldgenRoute(navigationProject, legacyWorldId) === `${route}?world=${encodeURIComponent(legacyWorldId)}`, 'an imported world must navigate to world, never waypoint');
    assert(await resolveWorldgenRoute(navigationProject, misleadingWaypointId) === `${route}?waypoint=${encodeURIComponent(misleadingWaypointId)}`, 'waypoint navigation must use its stored type, not its prefix');
    assert(await resolveWorldgenRoute('another-project', legacyWorldId) === null, 'world navigation must stay inside the requested project');
    assert(await resolveWorldgenRoute('another-project', misleadingWaypointId) === null, 'waypoint navigation must stay inside the requested project');
    assert(await resolveWorldgenRoute(navigationProject, 'deleted-entity') === null, 'stale world links must not navigate to a fabricated waypoint');
    passed.push('Worldgen: imported world and waypoint links resolve by stored type and project ownership');
  } finally {
    await db.worldWaypoints.delete(misleadingWaypointId);
    await db.generatedWorlds.delete(legacyWorldId);
  }
  const desert = WORLD_PRESETS.find((preset) => preset.id === 'desertWorld')!;
  const continents = WORLD_PRESETS.find((preset) => preset.id === 'continents')!;
  const base = { ...DEFAULT_PARAMS, seed: 'writer-recipe', width: 1024, landmarks: false };
  const switched = applyWorldPreset(applyWorldPreset(base, desert), continents);
  assert(switched.riverDensity === DEFAULT_PARAMS.riverDensity, 'desert rivers must not leak into continents');
  assert(switched.seed === base.seed && switched.width === base.width && !switched.landmarks, 'presets preserve seed, resolution and landmark preference');
  assert(matchesWorldPreset(switched, continents), 'selected preset must describe all terrain settings');
  assert(!matchesWorldPreset({ ...switched, riverDensity: 0.1 }, continents), 'custom changes must clear the selected preset');
  passed.push('Worldgen: presets reset the landscape without changing seed, detail or landmark preference');

  const saved: string[] = [];
  const writer = createWorldEditWriter('lifecycle-strokes', (value) => { saved.push(value); }, 60_000);
  writer.schedule('first stroke');
  writer.schedule('last stroke before leaving');
  const closed = await flushPendingWrites(1000);
  assert(closed.ok && saved.join('|') === 'last stroke before leaving', 'close must flush the latest buffered stroke');
  passed.push('Worldgen: closing before the debounce saves the latest brush edit');

  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const ordered: string[] = [];
  const slowWriter = createWorldEditWriter('lifecycle-slow', async (value) => {
    if (value === 'old') await blocked;
    ordered.push(value);
  }, 60_000);
  slowWriter.schedule('old');
  const saving = slowWriter.flush();
  slowWriter.schedule('new');
  release();
  assert(await saving, 'serialized writes finish');
  assert(ordered.join('|') === 'old|new', 'an older slow write must never overwrite the newest stroke');

  let failing = true;
  const retryWriter = createWorldEditWriter('lifecycle-retry', () => {
    if (failing) throw new Error('disk unavailable');
  }, 60_000);
  retryWriter.schedule('keep me');
  assert(!await retryWriter.flush(), 'failed write is reported');
  assert(getPendingWritesSnapshot().failed > 0, 'failed stroke remains visible');
  failing = false;
  await retryFailedWrites();
  assert(getPendingWritesSnapshot().failed === 0 && getPendingWritesSnapshot().dirty === 0, 'retry must persist and clear the buffered stroke');
  passed.push('Worldgen: brush writes are ordered and storage failures remain retryable');

  const nativeWorker = globalThis.Worker;
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    constructor() { workers.push(this); }
    postMessage() { /* Replies are controlled by the test. */ }
    terminate() { this.terminated = true; }
    finish(data: WorldData) {
      this.onmessage?.({ data: { type: 'done', world: structuredClone(packWorld(data).transfer) } } as MessageEvent);
    }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const worldId = `lifecycle-world-${Date.now()}`;
  let selectedWorldId = worldId;
  const params = { ...DEFAULT_PARAMS, width: 64, seed: worldId };
  const fixture = generateWorld(params);
  let generation!: ReturnType<typeof useWorldGeneration>;
  let onComplete: (world: WorldData) => void | Promise<void> = () => {};
  function Harness() {
    generation = useWorldGeneration(selectedWorldId, onComplete);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { generation.generate(params, { fresh: true }); });
    const first = workers[workers.length - 1];
    await act(async () => { generation.cancel(); });
    assert(first.terminated && !generation.gen.running, 'cancel terminates the worker and returns to idle');
    await act(async () => { first.finish(fixture); });
    assert(generation.world === null, 'cancelled worker cannot install a late world');

    await act(async () => { generation.generate(params, { fresh: true }); });
    await act(async () => { workers[workers.length - 1].finish(fixture); });
    assert(generation.world, 'completed generation installs the world');
    const originalHeight = generation.world.elevation[0];
    generation.world.elevation[0] = 15;
    generation.world.biome[0] = 12;
    // The production snapshot is intentionally deferred by 2.5 seconds.
    const deadline = Date.now() + 7000;
    let snapshot: WorldData | null = null;
    while (!snapshot && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      snapshot = await loadSnapshot(worldId, paramsKey(params));
    }
    assert(snapshot && Math.abs(snapshot.elevation[0] - originalHeight) < 0.002, 'delayed snapshot must contain pristine terrain, not the already-painted view');
    assert(snapshot.biome[0] === fixture.biome[0], 'delayed snapshot preserves the pristine biome');
    const workerCount = workers.length;
    await act(async () => { generation.generate(params, { fresh: true }); });
    assert(workers.length === workerCount + 1 && generation.gen.running, 'explicit regenerate must create a fresh world even for unchanged parameters');
    await act(async () => { generation.generate(params); });
    assert(workers[workers.length - 1].terminated && !generation.gen.running, 'cache hit must terminate any superseded worker');
    passed.push('Worldgen: cancelled replies are ignored, regeneration bypasses cache, cache hits stop old workers');
    passed.push('Worldgen: deferred snapshots preserve generated terrain before paint replay');

    const oldWorld = generation.world;
    const nextParams = { ...params, seed: `${worldId}-next` };
    const nextFixture = { ...fixture, params: nextParams };
    let rejectCommit!: (error: Error) => void;
    onComplete = () => new Promise<void>((_resolve, reject) => { rejectCommit = reject; });
    await act(async () => { root.render(<Harness />); generation.generate(nextParams, { fresh: true }); });
    await act(async () => { workers[workers.length - 1].finish(nextFixture); });
    assert(generation.gen.committing && generation.world === oldWorld, 'terrain remains unchanged while its recipe commits');
    await act(async () => { generation.cancel(); });
    assert(generation.gen.committing, 'cancel cannot interrupt a recipe commit');
    assert(getCachedWorld(worldId, nextParams) === null, 'uncommitted terrain must not enter the session cache');
    await act(async () => { rejectCommit(new Error('recipe commit failed')); });
    assert(generation.gen.error === 'recipe commit failed' && generation.world === oldWorld, 'a failed recipe commit preserves the previous world and exposes the error');
    onComplete = async () => {};
    await act(async () => { root.render(<Harness />); generation.generate(nextParams, { fresh: true }); });
    await act(async () => { workers[workers.length - 1].finish(nextFixture); });
    assert(generation.world?.params.seed === nextParams.seed && !generation.gen.running, 'retry adopts terrain only after a successful recipe commit');
    // Let the newly adopted snapshot finish before the isolated fixture cleanup.
    const retryDeadline = Date.now() + 7000;
    while (!(await loadSnapshot(worldId, paramsKey(nextParams))) && Date.now() < retryDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
    passed.push('Worldgen: recipe commits are awaited, failures preserve the old world, and successful retries publish afterward');
    for (const suffix of ['a', 'b', 'c']) {
      selectedWorldId = `${worldId}-cache-${suffix}`;
      await act(async () => { root.render(<Harness />); });
      await act(async () => { generation.generate(params, { fresh: true }); });
      await act(async () => { workers[workers.length - 1].finish(fixture); });
    }
    assert(getCachedWorld(`${worldId}-cache-a`, params), 'Oldest cached world should be accessible before eviction');
    selectedWorldId = `${worldId}-cache-d`;
    await act(async () => { root.render(<Harness />); });
    await act(async () => { generation.generate(params, { fresh: true }); });
    await act(async () => { workers[workers.length - 1].finish(fixture); });
    assert(getCachedWorld(`${worldId}-cache-b`, params) === null, 'Cache access must promote a world and evict the actual least recently used entry');
    assert(getCachedWorld(`${worldId}-cache-a`, params) && getCachedWorld(`${worldId}-cache-d`, params), 'Cache eviction must retain the accessed and current worlds');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    passed.push('Worldgen: session cache hits promote entries before least-recently-used eviction');
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    globalThis.Worker = nativeWorker;
    await db.worldSnapshots.delete(worldId);
    await db.worldSnapshots.bulkDelete(['a', 'b', 'c', 'd'].map((suffix) => `${worldId}-cache-${suffix}`));
  }
  return passed;
}
