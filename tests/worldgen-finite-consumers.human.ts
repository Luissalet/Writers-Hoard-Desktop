import assert from 'node:assert/strict';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { Biome, DEFAULT_PARAMS, type WorldData } from '../src/engines/worldgen/core/types';
import { DOMAIN_GRIDS, replayDomain } from '../src/engines/worldgen/core/domainReplay';
import { adoptDomainDocument } from '../src/engines/worldgen/core/domainDocument';
import { domainSourceKey } from '../src/engines/worldgen/core/worldDomain';
import { domainPlaceKey } from '../src/engines/worldgen/core/domainCatalogue';
import { applyEdits, type WorldEdit } from '../src/engines/worldgen/core/edits';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS, type HumanGeography } from '../src/engines/worldgen/core/settlements';

export function run() {
  const source = generateWorld({ ...DEFAULT_PARAMS, width: 64, seed: 'own-independent-finite-human-r1', starter: 'sea', erosion: 0, glaciation: 0 });
  assert.equal(source.width, 64); assert.equal(source.height, 32);
  const bounds = { x: -7, y: 5, width: 64, height: 32 };
  const document = adoptDomainDocument(source, '', { version: 1, sourceKey: domainSourceKey(source.params, ''), entries: [] }, bounds);
  const finiteSource = replayDomain(source, document, 1);
  assert.equal(finiteSource.domain?.topology, 'finite');
  assert.deepEqual(finiteSource.domain?.bounds, bounds);
  const failures: string[] = [], observations: Record<string, unknown> = {};
  const check = (ok: boolean, message: string) => { if (!ok) failures.push(message); };
  function terrain(finite: boolean, seam: boolean): WorldData {
    const world = structuredClone(finite ? finiteSource : source);
    for (const key of DOMAIN_GRIDS) world[key]!.fill(0);
    world.elevation.fill(-1); world.biome.fill(Biome.Ocean);
    world.temperature.fill(15); world.precipitation.fill(800);
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      if (!seam || x <= 1 || x >= 62) { world.elevation[y * world.width + x] = .3; world.biome[y * world.width + x] = Biome.Grassland; }
    }
    world.rivers = []; world.landmarks = []; world.painted = undefined;
    return world;
  }
  function geography(world: WorldData, x1: number, x2: number, move = false) {
    const key = domainPlaceKey(world, 'settlement', x1, 16);
    const edits: WorldEdit[] = [
      { kind: 'placesEverywhere', enabled: false },
      { kind: 'marker', marker: 'settlement', x: x1, y: 16, name: 'Own west', rank: 'capital' },
      { kind: 'marker', marker: 'settlement', x: x2, y: 16, name: 'Own east', rank: 'town' },
      ...(move ? [{ kind: 'move' as const, target: 'settlement' as const, key, x: 18, y: 16 }] : []),
    ];
    applyEdits(world, edits);
    const geo = buildHumanGeography(world, { ...DEFAULT_HUMAN_PARAMS, settlementDensity: 0, realmCount: 1, sites: 'auto' }, 'full', true);
    assert.equal(geo.settlements.length, 2, 'Real authored settlements must survive the fixture');
    const west = geo.settlements.find(s => s.name === 'Own west')!, east = geo.settlements.find(s => s.name === 'Own east')!;
    assert(west && east); assert.equal(geo.realms.length, 1, 'Actual realm growth must be active');
    return { geo, west, east, key };
  }
  const seamSummary = (geo: HumanGeography) => ({ settlements: geo.settlements.map(s => ({ name: s.name, x: s.x, y: s.y, realm: s.realm })), roads: geo.roads.map(r => ({ cells: [...r.cells] })), seamStep: geo.roads.some(r => r.cells.some((cell, i) => i > 0 && Math.abs(cell % 64 - r.cells[i - 1] % 64) > 1)) });
  const legacySeam = geography(terrain(false, true), 0, 63);
  observations.legacySeam = seamSummary(legacySeam.geo);
  assert(legacySeam.west.realm >= 0 && legacySeam.east.realm === legacySeam.west.realm, 'Legacy control must really grow across wrap');
  assert(seamSummary(legacySeam.geo).seamStep, 'Legacy control must really route across wrap');
  const finiteSeam = geography(terrain(true, true), 0, 63);
  observations.finiteSeam = seamSummary(finiteSeam.geo);
  assert(finiteSeam.west.realm >= 0, 'Finite capital must still own its own land');
  check(finiteSeam.east.realm === -1, 'Finite realm must not reach the disconnected east strip through outside');
  check(finiteSeam.geo.roads.length === 0, 'Finite road must not connect islands through the outside seam');

  function endpointSummary(data: ReturnType<typeof geography>, finite: boolean) {
    assert.equal(data.geo.roads.length, 1, 'All-land control must have one actual generated road');
    const road = data.geo.roads[0], ends = [road.cells[0], road.cells.at(-1)!].sort((a, b) => a - b);
    const expected = [data.west.y * 64 + data.west.x, data.east.y * 64 + data.east.x].sort((a, b) => a - b);
    if (finite) assert.deepEqual([road.fromKey, road.toKey].sort(), [data.west.sourceKey, data.east.sourceKey].sort(), 'Actual road must reference the exact authored identities');
    return { ends, expected, west: { x: data.west.x, y: data.west.y, sourceKey: data.west.sourceKey }, roadKeys: [road.fromKey, road.toKey], matches: JSON.stringify(ends) === JSON.stringify(expected) };
  }
  const unmoved = endpointSummary(geography(terrain(true, false), 12, 25), true);
  observations.finiteUnmoved = unmoved;
  assert(unmoved.matches, 'Unmoved finite control must terminate at both visible settlements');
  const legacyMoved = endpointSummary(geography(terrain(false, false), 12, 25, true), false);
  observations.legacyMoved = legacyMoved;
  assert.equal(legacyMoved.west.x, 18); assert(legacyMoved.matches, 'Legacy move must bring the actual route to the new visible location');
  const movedData = geography(terrain(true, false), 12, 25, true), moved = endpointSummary(movedData, true);
  observations.finiteMoved = moved;
  assert.equal(moved.west.x, 18, 'Source-absolute correction must really move the visible settlement');
  assert.equal(moved.west.sourceKey, movedData.key, 'Origin identity must survive the move');
  check(moved.matches, 'Finite source-absolute move must bring the actual route to the visible settlement');
  return { kind: 'Independent actual core consumer, controlled own terrain; Node only', controls: 3, criteria: 3, observations, failures, passed: failures.length === 0 };
}
