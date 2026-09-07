import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { applyEdits, deserializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { captureEnvironment, recalculateEnvironment, worldRecalculationCheckpoints, type EnvironmentFields } from '@/engines/worldgen/core/recalculate';
import { preparePaintReplay, requestWorldRecalculation } from '@/engines/worldgen/recalculationClient';
import type { RecalculationRequest } from '@/engines/worldgen/recalculation.worker';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function fixture(): WorldData {
  const width = 64, height = 32, n = width * height;
  const elevation = new Float32Array(n).fill(0.4);
  for (let y = 0; y < height; y++) for (let x = 0; x < 12; x++) elevation[y * width + x] = -1;
  return { width, height, params: { ...DEFAULT_PARAMS, width, drainageVersion: 1, hydrologyVersion: 1 }, revision: 0, elevation,
    biome: new Uint8Array(n).fill(Biome.Grassland), temperature: new Float32Array(n).fill(20), precipitation: new Float32Array(n).fill(100),
    flow: new Float32Array(n), lake: new Uint8Array(n), lakeSurface: new Float32Array(n), ice: new Float32Array(n),
    boundary: new Float32Array(n).fill(0.8), sst: new Float32Array(n).fill(-3),
    plateId: new Uint8Array(n), currentU: new Float32Array(n), currentV: new Float32Array(n), currentSpeed: new Float32Array(n),
    rivers: [], landmarks: [], plateInfo: [] };
}
function sameEnvironment(a: EnvironmentFields, b: EnvironmentFields): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export async function testWorldgenRecalculation(): Promise<string[]> {
  const world = fixture(), session = new PaintSession(world);
  const stroke: WorldEdit = { kind: 'terrain', op: 'raise', stroke: { pts: [{ x: 32.123456, y: 16.765432 }], radius: 8, strength: 0.8, softness: 0.4 } };
  session.pushMany([stroke, { kind: 'river', pts: [{ x: 20, y: 15 }, { x: 29, y: 15 }], width: 1 },
    { kind: 'biome', biome: Biome.Desert, stroke: { pts: [{ x: 32, y: 16 }], radius: 2, strength: 1 } },
    { kind: 'label', x: 34, y: 17, text: 'Authored place' }]);
  const elevationBefore = world.elevation.slice(), environmentBefore = captureEnvironment(world);
  const derived = recalculateEnvironment(world);
  assert(world.elevation.every((value, i) => value === elevationBefore[i]) && sameEnvironment(captureEnvironment(world), environmentBefore), 'Pure recalc mutated live terrain/environment');
  assert(derived.temperature.some((value, i) => value !== environmentBefore.temperature[i]) && derived.precipitation.some((value, i) => value !== environmentBefore.precipitation[i]), 'Recalc retained stale climate');
  assert(session.pushRecalculation(derived, world.revision ?? 0), 'Fresh worker result was rejected');
  const after = captureEnvironment(world);
  assert(world.biome[16 * 64 + 32] === Biome.Desert && world.painted?.labels[0]?.text === 'Authored place' && world.painted.rivers.length === 1, 'Recalc discarded authored biome/labels/rivers');
  assert(world.params.drainageVersion === 1 && world.params.hydrologyVersion === 1, 'Environmental recalculation changed original terrain recipe version');
  assert(world.elevation.every((value, i) => value === elevationBefore[i]), 'Adopting checkpoint applied terrain or carved authored river twice');
  session.undo(); assert(sameEnvironment(captureEnvironment(world), environmentBefore), 'Undo failed to restore full prior environment');
  session.redo(); assert(sameEnvironment(captureEnvironment(world), after), 'Redo failed to restore derived environment');
  const staleRevision = world.revision ?? 0;
  session.push({ kind: 'label', x: 1, y: 1, text: 'Newer intent' });
  assert(!session.pushRecalculation(derived, staleRevision), 'Stale worker result overwrote newer edit');

  // A sentinel supplied by the worker proves subsequent strokes consume the checkpoint,
  // rather than silently re-running an identical expensive deterministic calculation.
  const sentinelWorld = fixture(), sentinelSession = new PaintSession(sentinelWorld);
  const sentinel = captureEnvironment(sentinelWorld); sentinel.temperature[10] = -9999;
  sentinelSession.pushRecalculation(sentinel, 0);
  sentinelSession.push({ kind: 'label', x: 5, y: 5, text: 'Fast stroke' });
  assert(sentinelWorld.temperature[10] === -9999, 'An ordinary stroke reran climate after a checkpoint');
  sentinelSession.undo(); sentinelSession.undo();
  assert(sentinelWorld.temperature[10] === 20, 'Undo retained cached future climate');
  sentinelSession.redo(); assert(sentinelWorld.temperature[10] === -9999, 'Redo reran climate instead of restoring worker checkpoint');

  const layeredWorld = fixture(), layeredSession = new PaintSession(layeredWorld);
  layeredSession.push({ kind: 'biome', biome: Biome.Desert, stroke: { pts: [{ x: 32, y: 16 }], radius: 2, strength: 1 } });
  layeredSession.pushRecalculation(recalculateEnvironment(layeredWorld), layeredWorld.revision ?? 0, true);
  layeredSession.push({ kind: 'biome', biome: Biome.Glacier, stroke: { pts: [{ x: 48, y: 16 }], radius: 2, strength: 1 } });
  layeredSession.push({ kind: 'terrain', op: 'raise', stroke: { pts: [{ x: 40, y: 16 }], radius: 12, strength: 0.4 } });
  assert(layeredWorld.biome[16 * 64 + 32] === Biome.Desert && layeredWorld.biome[16 * 64 + 48] === Biome.Glacier, 'Terrain after checkpoint erased authored biomes from before/after it');
  const layeredReload = fixture();
  new PaintSession(layeredReload, deserializeEdits(layeredSession.serialize()));
  assert(sameEnvironment(captureEnvironment(layeredReload), captureEnvironment(layeredWorld)), 'Skipping redundant checkpoint classification changed replay with later terrain');
  layeredSession.undo(); layeredSession.undo(); layeredSession.redo();
  assert(layeredWorld.biome[16 * 64 + 32] === Biome.Desert && layeredWorld.biome[16 * 64 + 48] === Biome.Glacier, 'Biome history around the checkpoint lost authorship');

  const OriginalWorker = globalThis.Worker;
  let fail = false, jobs = 0, terminated = 0;
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    stopped = false;
    terminate() { this.stopped = true; terminated++; }
    postMessage(value: RecalculationRequest) {
      const request = structuredClone(value); jobs++;
      queueMicrotask(() => {
        if (this.stopped) return;
        if (fail) { this.onmessage?.({ data: { type: 'error', message: 'Injected worker failure' } } as MessageEvent); return; }
        if (request.type === 'derive') this.onmessage?.({ data: { type: 'done', environment: recalculateEnvironment(request.world) } } as MessageEvent);
        else { applyEdits(request.world, request.edits); this.onmessage?.({ data: { type: 'done', checkpoints: worldRecalculationCheckpoints(request.world) } } as MessageEvent); }
      });
    }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    const reopened = fixture(), edits = deserializeEdits(session.serialize());
    await preparePaintReplay(reopened, edits);
    const reopenedSession = new PaintSession(reopened, edits);
    assert(sameEnvironment(captureEnvironment(reopened), captureEnvironment(world)) && reopened.elevation.every((value, i) => value === world.elevation[i]), 'Reopening checkpoint recipe changed derived geography or fractional stroke');
    assert(reopened.painted?.labels.some(label => label.text === 'Newer intent'), 'Replay omitted edits after checkpoint');
    const count = jobs; await preparePaintReplay(reopened, edits);
    assert(jobs === count, 'Prepared replay unnecessarily started a worker');
    const abort = new AbortController(), beforeCancel = captureEnvironment(reopened);
    const cancelled = requestWorldRecalculation(reopened, { signal: abort.signal }); abort.abort();
    let abortSeen = false;
    try { await cancelled; } catch (error) { abortSeen = error instanceof DOMException && error.name === 'AbortError'; }
    assert(abortSeen && sameEnvironment(captureEnvironment(reopened), beforeCancel), 'Cancelled worker changed displayed geography');
    fail = true;
    let errorSeen = false;
    try { await requestWorldRecalculation(reopened); } catch { errorSeen = true; }
    assert(errorSeen && sameEnvironment(captureEnvironment(reopened), beforeCancel) && terminated >= jobs, 'Worker failure leaked a worker or modified current world');
    fail = false;
    for (let i = 0; i < 3; i++) {
      reopenedSession.push({ ...stroke, stroke: { ...stroke.stroke, strength: 0.1 + i * 0.1 } });
      const next = await requestWorldRecalculation(reopened);
      reopenedSession.pushRecalculation(next, reopened.revision ?? 0);
    }
    assert(worldRecalculationCheckpoints(reopened).length <= 2, 'Checkpoint cache grew without a bound');
    const beforeUndoJobs = jobs;
    while (reopenedSession.canUndo) {
      await preparePaintReplay(reopened, reopenedSession.undoEdits, {}, reopenedSession.pristineWorld);
      reopenedSession.undo();
    }
    assert(jobs > beforeUndoJobs && sameEnvironment(captureEnvironment(reopened), captureEnvironment(fixture())), 'Evicted checkpoints could not be restored asynchronously for full undo');
    return ['Recalculation derives climate/hydrology without mutating terrain and preserves authored layers', 'Checkpoint undo/redo restores complete environment; later strokes reuse cached derivation', 'Worker replay reproduces fractional edits; stale results, cancellation and errors preserve current world', 'Two-checkpoint memory bound supports asynchronous preparation of older undo history'];
  } finally { globalThis.Worker = OriginalWorker; }
}
