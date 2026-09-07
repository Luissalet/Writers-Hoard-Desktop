import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { recalculateEnvironment, worldRecalculationCheckpoints } from '@/engines/worldgen/core/recalculate';
import { preparePaintReplay } from '@/engines/worldgen/recalculationClient';
import { getGeography, patchCachedGeography } from '@/engines/worldgen/cartography/texture';

// Deliberately separate from the short critical suite: this generates a REAL
// 2048 world and its full human geography. No reduced resolution/erosion and
// no mocked climate. Run separately with the focused Electron runner and its
// optional third argument 120000 (milliseconds).
const MIB = 1024 * 1024;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

async function hash(bytes: ArrayBufferView): Promise<string> {
  const source = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const result = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(result)].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Hash complete data without materializing a second 100 MiB world or JSON arrays. */
async function signature(value: unknown): Promise<unknown> {
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}:${value.byteLength}:${await hash(value)}`;
  if (value instanceof Set) return Promise.all([...value].map(signature));
  if (value instanceof Map) return Promise.all([...value].map(async ([key, field]) => [await signature(key), await signature(field)]));
  if (Array.isArray(value)) return Promise.all(value.map(signature));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    // Sequential hashes cap comparison scratch at a single field, not a world.
    for (const key of Object.keys(value).sort()) {
      if (key !== 'revision') result[key] = await signature((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}
async function worldSignature(world: WorldData): Promise<string> { return JSON.stringify(await signature(world)); }

/** Count unique retained ArrayBuffers, including session and checkpoint state. */
function retainedBytes(...roots: unknown[]): number {
  const objects = new Set<object>(), buffers = new Set<ArrayBufferLike>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || objects.has(value)) return;
    objects.add(value);
    if (ArrayBuffer.isView(value)) { buffers.add(value.buffer); return; }
    if (value instanceof ArrayBuffer) { buffers.add(value); return; }
    if (value instanceof Map) { for (const [key, field] of value) { visit(key); visit(field); } return; }
    if (value instanceof Set || Array.isArray(value)) { for (const field of value) visit(field); return; }
    for (const key of Object.keys(value)) visit((value as Record<string, unknown>)[key]);
  };
  roots.forEach(visit);
  return [...buffers].reduce((size, buffer) => size + buffer.byteLength, 0);
}

export async function testWorldgenLargeLifecycle(): Promise<string[]> {
  const timings: Record<string, number> = {}, memory: { stage: string; retainedMiB: number; jsHeapMiB?: number }[] = [];
  const start = performance.now();
  const setStage = (stage: string) => { (window as unknown as Record<string, unknown>).__largeLifecycleStage = stage; };
  setStage('generating real 2048 world');
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 2048, seed: 'j_zdm1cq' });
  timings.generationMs = performance.now() - start;
  const session = new PaintSession(world);
  const original = await worldSignature(world);
  setStage('building full geography');
  let phase = performance.now();
  const geography = getGeography(world, 'full');
  timings.geographyMs = performance.now() - phase;
  assert(geography.depth === 'full', 'Large fixture silently substituted shallow geography');
  const realmOf = geography.realmOf;
  const recordMemory = (stage: string) => {
    const retained = retainedBytes(world, session, geography, worldRecalculationCheckpoints(world));
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    memory.push({ stage, retainedMiB: Math.round(retained / MIB * 10) / 10, jsHeapMiB: heap ? Math.round(heap / MIB * 10) / 10 : undefined });
    // This is retained typed data, NOT process RSS or transient GC allocation.
    assert(retained < 512 * MIB, `Large edit lifecycle retained ${Math.round(retained / MIB)} MiB of typed data`);
  };
  recordMemory('opened');

  const patch = () => {
    const began = performance.now(), current = patchCachedGeography(world);
    assert(current && current.realmOf === realmOf, 'History discarded/rebuilt the warmed geography or copied unchanged realm ownership');
    timings.maxGeographyPatchMs = Math.max(timings.maxGeographyPatchMs ?? 0, performance.now() - began);
  };
  let pristineRequests = 0;
  const prepare = async (direction: 'undo' | 'redo') => {
    await preparePaintReplay(world, direction === 'undo' ? session.undoEdits : session.redoEdits, {}, () => {
      pristineRequests++;
      return session.pristineWorld;
    });
  };
  const derive = () => {
    const began = performance.now();
    const environment = recalculateEnvironment(world);
    assert(session.pushRecalculation(environment, world.revision ?? 0, true), 'Fresh large-world recalculation was rejected');
    timings.recalculationMs = (timings.recalculationMs ?? 0) + performance.now() - began;
  };

  // Exact crash boundary: the only edit is recalculation, so Undo returns to
  // an empty list and changes painted.sitesPolicy back to undefined.
  setStage('recalculation then empty-history undo/redo');
  derive(); patch();
  const recalculated = await worldSignature(world);
  recordMemory('first recalculation');
  const cycleBytes: number[] = [];
  phase = performance.now();
  for (let cycle = 0; cycle < 3; cycle++) {
    await prepare('undo'); session.undo(); patch();
    assert(await worldSignature(world) === original, `Undo ${cycle + 1} did not restore every original world field`);
    await prepare('redo'); session.redo(); patch();
    assert(await worldSignature(world) === recalculated, `Redo ${cycle + 1} did not restore every recalculated world field`);
    cycleBytes.push(retainedBytes(world, session, geography, worldRecalculationCheckpoints(world)));
    recordMemory(`undo/redo ${cycle + 1}`);
  }
  timings.emptyHistoryCyclesMs = performance.now() - phase;
  assert(cycleBytes.every(bytes => bytes === cycleBytes[0]), 'Repeated undo/redo retained additional typed buffers');

  setStage('terrain edit then recalculation and history');
  await prepare('undo'); session.undo(); patch();
  // Place the stroke on real mid-latitude land, not a contrived flat fixture.
  let cell = -1;
  for (let i = world.width * (world.height >> 2); i < world.width * (world.height * 3 >> 2); i++) {
    if (world.elevation[i] > 0.2 && world.elevation[i] < 2) { cell = i; break; }
  }
  assert(cell >= 0, 'Real seed has no suitable land for the terrain edit');
  session.push({ kind: 'terrain', op: 'raise', stroke: { pts: [{ x: cell % world.width + 0.123456, y: Math.floor(cell / world.width) + 0.765432 }], radius: 10, strength: 0.8, softness: 0.4 } });
  patch();
  const sculpted = await worldSignature(world);
  assert(sculpted !== original, 'Real terrain stroke changed no data');
  derive(); patch();
  const sculptedRecalculated = await worldSignature(world), journal = session.serialize();
  for (let cycle = 0; cycle < 2; cycle++) {
    await prepare('undo'); session.undo(); patch();
    assert(await worldSignature(world) === sculpted, 'Undo after sculpt+recalc lost the exact authored terrain or previous environment');
    await prepare('redo'); session.redo(); patch();
    assert(await worldSignature(world) === sculptedRecalculated, 'Redo after sculpt+recalc changed the derived geography');
    recordMemory(`sculpt undo/redo ${cycle + 1}`);
  }
  session.clear(); patch();
  assert(await worldSignature(world) === original, 'Clear failed to restore the unedited generated world');
  session.load(journal); patch();
  assert(await worldSignature(world) === sculptedRecalculated, 'Reloading the real edit journal changed its terrain/environment');
  assert(pristineRequests === 0, 'Cached or empty history eagerly materialized a pristine world');
  assert(worldRecalculationCheckpoints(world).length <= 2, 'Large-world history escaped the checkpoint bound');
  recordMemory('journal reloaded');
  timings.totalMs = performance.now() - start;
  const report = { seed: world.params.seed, width: world.width, cycles: 5, timings, memory };
  (window as unknown as Record<string, unknown>).__largeLifecycleReport = report;
  setStage('complete');
  return [
    'Real 2048 world: full-grid equality across recalculation, empty-history undo/redo, terrain edits and journal reload',
    'Real 2048 world: cached geography survives history; no eager pristine clone; retained typed buffers remain bounded across five cycles',
    `Large lifecycle telemetry ${JSON.stringify(report)}`,
  ];
}
