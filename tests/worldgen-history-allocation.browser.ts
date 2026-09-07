import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { captureEnvironment } from '@/engines/worldgen/core/recalculate';
import { preparePaintReplay } from '@/engines/worldgen/recalculationClient';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** Real 2048 grids, with a worker result fixture: tests history allocation independently of generation cost. */
export async function testWorldgenHistoryAllocation(): Promise<string[]> {
  const width = 2048, height = 1024, n = width * height;
  const world: WorldData = { width, height, params: { ...DEFAULT_PARAMS, width }, revision: 0,
    elevation: new Float32Array(n).fill(0.4), boundary: new Float32Array(n), plateId: new Uint8Array(n),
    temperature: new Float32Array(n).fill(20), precipitation: new Float32Array(n).fill(500),
    biome: new Uint8Array(n).fill(Biome.Grassland), lake: new Uint8Array(n), lakeSurface: new Float32Array(n),
    flow: new Float32Array(n), ice: new Float32Array(n), currentU: new Float32Array(n), currentV: new Float32Array(n),
    currentSpeed: new Float32Array(n), sst: new Float32Array(n), rivers: [], landmarks: [], plateInfo: [] };
  const session = new PaintSession(world);
  const workerResult = captureEnvironment(world);
  workerResult.temperature.fill(-3);
  // A cached biome is authoritative. Re-running classification here would change this sentinel.
  workerResult.biome.fill(Biome.Volcanic);
  const fields = ['temperature', 'precipitation', 'biome', 'lake', 'lakeSurface', 'flow', 'ice', 'currentU', 'currentV', 'currentSpeed', 'sst', 'elevation'] as const;
  const liveBuffers = fields.map(key => world[key]!.buffer);
  const nativeClone = globalThis.structuredClone, nativeSlice = Float32Array.prototype.slice;
  let clonedBytes = 0, slicedBytes = 0, sourceReads = 0;
  const byteSize = (value: unknown): number => {
    const seen = new Set<ArrayBufferLike>();
    const visit = (entry: unknown) => {
      if (ArrayBuffer.isView(entry)) seen.add(entry.buffer);
      else if (entry && typeof entry === 'object') Object.values(entry).forEach(visit);
    };
    visit(value); return [...seen].reduce((sum, buffer) => sum + buffer.byteLength, 0);
  };
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => { clonedBytes += byteSize(value); return nativeClone(value, options); }) as typeof structuredClone;
  Float32Array.prototype.slice = function(start?: number, end?: number) {
    const result = nativeSlice.call(this, start, end); slicedBytes += result.byteLength; return result;
  };
  try {
    assert(session.pushRecalculation(workerResult, 0, true), 'Owned worker result was not adopted');
    for (let cycle = 0; cycle < 8; cycle++) {
      await preparePaintReplay(world, session.undoEdits, {}, () => { sourceReads++; return session.pristineWorld; });
      session.undo();
      assert(world.temperature[n / 2] === 20 && world.biome[n / 2] === Biome.Grassland, 'Undo did not restore baseline fields');
      await preparePaintReplay(world, session.redoEdits, {}, () => { sourceReads++; return session.pristineWorld; });
      session.redo();
      assert(world.temperature[n / 2] === -3 && world.biome[n / 2] === Biome.Volcanic, 'Redo recomputed cached biomes or retained baseline climate');
      assert(fields.every((key, index) => world[key]!.buffer === liveBuffers[index]), 'History allocated replacement grid buffers');
    }
    assert(sourceReads === 0, 'Undo without checkpoint or cached redo eagerly constructed a pristine worker source');
    assert(clonedBytes === 0, `History cloned ${Math.round(clonedBytes / 1024 / 1024)} MiB of environment grids`);
    assert(slicedBytes === world.elevation.byteLength, 'History copied more than the one owned checkpoint elevation snapshot');
    assert(workerResult.temperature[n / 2] === -3 && workerResult.biome[n / 2] === Biome.Volcanic, 'Restoring mutated the owned checkpoint');
    return ['2048 history: eight undo/redo cycles reuse every live grid; zero environment-grid clones and lazy worker source', '2048 checkpoint adoption owns worker result; only one 8 MiB elevation snapshot, no redundant biome derivation'];
  } finally { globalThis.structuredClone = nativeClone; Float32Array.prototype.slice = nativeSlice; }
}
