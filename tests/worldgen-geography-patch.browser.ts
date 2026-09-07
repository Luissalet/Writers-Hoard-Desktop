import { DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import type { HumanGeography } from '@/engines/worldgen/core/settlements';
import { adoptGeographyBase, geographyIsStale, getGeography, patchCachedGeography, renderCartoCanvas } from '@/engines/worldgen/cartography/texture';
import { cancelActiveGeographyBuild, requestGeographyBase, type GeographyWorkerFactory } from '@/engines/worldgen/cartography/geographyClient';
import { THEME_ANTIQUE } from '@/engines/worldgen/cartography/theme';
import type { GeographyWorkerRequest } from '@/engines/worldgen/geography.worker';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function baseFor(world: WorldData): HumanGeography {
  return { depth: 'full', settlements: [], roads: [], realms: [], realmOf: new Int32Array(world.width * world.height).fill(-1), features: [], ruins: [], landforms: [], languages: {}, languageOf: {} } as unknown as HumanGeography;
}
function workers() {
  const made: Array<ReturnType<GeographyWorkerFactory> & { stopped: number; request?: GeographyWorkerRequest }> = [];
  const factory: GeographyWorkerFactory = () => {
    const worker: typeof made[number] = { onmessage: null, onerror: null, stopped: 0,
      postMessage(request) { this.request = request; }, terminate() { this.stopped++; } };
    made.push(worker); return worker;
  };
  const reply = (index: number, geography: HumanGeography) => {
    const worker = made[index];
    worker.onmessage?.({ data: { type: 'done', requestId: worker.request!.requestId, geography } } as MessageEvent);
  };
  return { made, factory, reply };
}

export async function testGeographyPatchAfterUndo(): Promise<string> {
  // A cold interaction must not even inspect a grid, let alone allocate one.
  assert(patchCachedGeography({} as WorldData) === null, 'Cold edit patch tried to construct geography');
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 128, seed: 'undo-geography', erosion: 0 });
  const session = new PaintSession(world);
  session.push({ kind: 'placesEverywhere', enabled: true });
  const base = baseFor(world);
  adoptGeographyBase(world, base);
  session.undo();
  assert(!world.painted, 'Fixture did not undo to the empty legacy state');
  const patch = patchCachedGeography(world)!;
  assert(patch.realmOf === base.realmOf, 'Undo allocated a replacement geography grid on the interaction path');
  assert(getGeography(world, 'full').realmOf === base.realmOf, 'Equivalent absent/open policy caused a synchronous full rebuild');
  assert(geographyIsStale(world, 'full'), 'Cheap patch incorrectly marked heavy geography fresh');

  // A real policy change still only patches: even an invalidation cannot turn
  // this API into an accidental synchronous builder.
  session.push({ kind: 'placesEverywhere', enabled: false });
  const changed = patchCachedGeography(world)!;
  assert(changed.realmOf === base.realmOf && geographyIsStale(world, 'full'), 'Policy change rebuilt or hid staleness');
  const canvas = renderCartoCanvas(world, { width: 240, height: 120, theme: THEME_ANTIQUE, geography: changed,
    layers: { labels: false, settlements: false, forests: false, relief: false, compass: false, scaleBar: false } });
  assert(canvas.width === 240 && patchCachedGeography(world)!.realmOf === base.realmOf, 'Rendering stale geography rebuilt its source');

  const worker = workers();
  const future = requestGeographyBase(world, 'full', undefined, worker.factory);
  assert(worker.made.length === 1 && geographyIsStale(world), 'Replacement geography did not start in a worker');
  const replacement = baseFor(world); worker.reply(0, replacement);
  adoptGeographyBase(world, await future);
  assert(!geographyIsStale(world) && patchCachedGeography(world)!.realmOf === replacement.realmOf, 'Worker result did not replace the stale base');
  return 'Undo-to-empty and policy changes patch cached geography without new grids; rendering stays cheap and the worker refreshes it later';
}

export async function testGeographyScopedCancellation(): Promise<string> {
  cancelActiveGeographyBuild();
  const world = { width: 64, height: 32, params: { ...DEFAULT_PARAMS, width: 64, seed: 'scoped-geography' }, revision: 1 } as WorldData;
  const w = workers(), one = new AbortController(), two = new AbortController();
  const first = requestGeographyBase(world, 'full', undefined, w.factory, one.signal).catch(e => e);
  const second = requestGeographyBase(world, 'full', undefined, w.factory, two.signal);
  assert(w.made.length === 1, 'Shared geography consumers launched duplicate world copies');
  one.abort();
  assert((await first).name === 'AbortError' && w.made[0].stopped === 0, 'One view cancelled another subscriber’s build');
  const base = baseFor(world); w.reply(0, base);
  assert(await second === base && w.made[0].stopped === 1, 'Shared survivor lost the result');

  world.revision++;
  const old = new AbortController();
  const oldRequest = requestGeographyBase(world, 'full', undefined, w.factory, old.signal).catch(e => e);
  world.revision++;
  const next = new AbortController();
  const nextRequest = requestGeographyBase(world, 'full', undefined, w.factory, next.signal).catch(e => e);
  assert((await oldRequest).name === 'AbortError' && w.made[1].stopped === 1, 'Superseded worker retained its world');
  old.abort();
  assert(w.made[2].stopped === 0, 'Old effect cleanup terminated the new revision’s worker');
  next.abort();
  assert((await nextRequest).name === 'AbortError' && w.made[2].stopped === 1, 'Last consumer abort did not release its worker');
  // A late message after termination cannot poison the result cache.
  w.reply(2, base);
  const retry = requestGeographyBase(world, 'full', undefined, w.factory);
  assert(w.made.length === 4, 'Late cancelled reply populated the live cache');
  w.reply(3, base); await retry;
  return 'Geography cancellation releases obsolete world copies, preserves shared consumers and ignores stale replies/cleanup';
}
