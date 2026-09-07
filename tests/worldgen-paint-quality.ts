import { applyEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { classifyBiomes } from '@/engines/worldgen/core/biomes';
import { distanceTo, localRelief } from '@/engines/worldgen/core/fields';
import { DEFAULT_FILTERS } from '@/engines/worldgen/core/generation';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function makeWorld(): WorldData {
  const width = 64, height = 32, n = width * height;
  const elevation = new Float32Array(n).fill(0.4);
  for (let y = 0; y < height; y++) for (let x = 0; x < 12; x++) elevation[y * width + x] = -1;
  return { width, height, params: { ...DEFAULT_PARAMS, width }, revision: 0, elevation,
    biome: new Uint8Array(n), temperature: new Float32Array(n).fill(20), precipitation: new Float32Array(n).fill(100),
    flow: new Float32Array(n), lake: new Uint8Array(n), ice: new Float32Array(n),
    boundary: new Float32Array(n).fill(0.8), sst: new Float32Array(n).fill(-3),
    plateId: new Uint8Array(n), currentU: new Float32Array(n), currentV: new Float32Array(n), currentSpeed: new Float32Array(n),
    rivers: [], landmarks: [], plateInfo: [],
  };
}
function classify(world: WorldData) {
  const sea = Uint8Array.from(world.elevation, elevation => elevation <= 0 ? 1 : 0);
  world.biome = classifyBiomes(world.params, { elevation: world.elevation, temperature: world.temperature, precipitation: world.precipitation, lake: world.lake, flow: world.flow,
    relief: localRelief(world.elevation, world.width, world.height, 3), seaDist: distanceTo(sea, world.width, world.height),
    boundary: world.boundary, sst: world.sst, filters: world.params.filters,
  });
}

export async function testWorldgenPaintQuality(): Promise<string[]> {
  // Re-deriving identical terrain must preserve the same ecological inputs.
  const noHeightChange: WorldEdit = { kind: 'terrain', op: 'raise', stroke: { pts: [{ x: 32, y: 16 }], radius: 32, strength: 0, softness: 0.5 } };
  const w = makeWorld();
  classify(w);
  assert(w.biome.some(b => b === Biome.Volcanic || b === Biome.AshPlain), 'Volcanic test fixture has no substrate-dependent biome');
  assert(w.biome.some(b => b === Biome.FogDesert), 'Cold-current fixture has no fog desert');
  const original = w.biome.slice();
  applyEdits(w, [noHeightChange]);
  assert(w.biome.every((value, cell) => value === original[cell]), 'Terrain reclassification lost current/substrate ecology');

  const filtered = makeWorld();
  filtered.params.filters = { ...DEFAULT_FILTERS, biomes: { [Biome.Volcanic]: false, [Biome.AshPlain]: false, [Biome.FogDesert]: false, [Biome.Desert]: false, [Biome.Reg]: false, [Biome.Erg]: false } };
  classify(filtered);
  const allowedBefore = filtered.biome.slice();
  applyEdits(filtered, [noHeightChange]);
  assert(filtered.biome.every((value, cell) => value === allowedBefore[cell]), 'Painting reintroduced a biome excluded from world generation');

  for (const points of [[{ x: 62, y: 16 }, { x: 1, y: 16 }], [{ x: 1, y: 16 }, { x: 62, y: 16 }], [{ x: 62, y: 15 }, { x: 1, y: 17 }]]) {
    const seam = makeWorld();
    seam.elevation.fill(0.4);
    const edits: WorldEdit[] = [{ kind: 'river', pts: points, width: 1 }, { kind: 'road', pts: points, major: true }];
    const applied = applyEdits(seam, edits);
    const rivers = [...applied.rivers[0].cells], roads = applied.roads[0].cells;
    assert(rivers.length <= 5 && roads.length === rivers.length, 'A short seam stroke wrapped the long way around the planet');
    assert(rivers.every((cell, i) => (cell % 64 >= 62 || cell % 64 <= 1) && roads[i] === cell), 'Road and river disagree on the seam path');
    assert(seam.elevation[16 * 64 + 32] === 0.4 || Math.abs(seam.elevation[16 * 64 + 32] - 0.4) < 1e-7, 'Seam river carved the opposite side of the world');
  }
  return ['Worldgen painting preserves excluded biomes, volcanic substrate and cold-current ecology', 'Worldgen painted rivers and roads cross the antimeridian by the short arc in either direction'];
}
