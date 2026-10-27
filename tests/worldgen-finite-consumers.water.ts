import assert from 'node:assert/strict';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { Biome, DEFAULT_PARAMS, type WorldData } from '../src/engines/worldgen/core/types';
import { DOMAIN_GRIDS, replayDomain } from '../src/engines/worldgen/core/domainReplay';
import { adoptDomainDocument } from '../src/engines/worldgen/core/domainDocument';
import { domainSourceKey } from '../src/engines/worldgen/core/worldDomain';
import { applyEdits } from '../src/engines/worldgen/core/edits';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { planRoute, riverCellNear, isRiverCell, type Route } from '../src/engines/worldgen/core/travel';
import { journeyNormalizedStops, journeyStopsForWorld, type WorldJourney } from '../src/engines/worldgen/journeyTypes';

export function run() {
  const source = generateWorld({ ...DEFAULT_PARAMS, width: 64, seed: 'own-independent-travel-water-river-r1', starter: 'sea', erosion: 0, glaciation: 0 });
  const bounds = { x: -7, y: 5, width: 64, height: 32 };
  const document = adoptDomainDocument(source, '', { version: 1, sourceKey: domainSourceKey(source.params, ''), entries: [] }, bounds);
  const finiteSource = replayDomain(source, document, 1);
  assert.equal(finiteSource.domain?.topology, 'finite'); assert.deepEqual(finiteSource.domain?.bounds, bounds);
  const failures: string[] = [], observations: Record<string, unknown> = {};
  function terrain(finite: boolean, river: boolean) {
    const world = structuredClone(finite ? finiteSource : source);
    for (const key of DOMAIN_GRIDS) world[key]!.fill(0);
    world.temperature.fill(15); world.precipitation.fill(800);
    world.elevation.fill(river ? .3 : -1); world.biome.fill(river ? Biome.Grassland : Biome.Ocean);
    if (river) { world.flow[16 * 64] = 1; world.flow[16 * 64 + 20] = 1; }
    else for (let y = 0; y < 32; y++) { world.elevation[y * 64] = .3; world.biome[y * 64] = Biome.Grassland; }
    world.rivers = []; world.landmarks = []; world.painted = undefined;
    applyEdits(world, [{ kind: 'placesEverywhere', enabled: false }]);
    return world;
  }
  const legacyRiver = terrain(false, true), finiteRiver = terrain(true, true);
  for (const world of [legacyRiver, finiteRiver]) {
    assert(isRiverCell(world, 16 * 64) && isRiverCell(world, 16 * 64 + 20), 'Controlled flow on land must activate the actual river mask');
    assert.equal(riverCellNear(world, 19.75, 16.5), 16 * 64 + 20, 'Ordinary interior river lookup must work');
  }
  const legacyNear = riverCellNear(legacyRiver, 63.75, 16.5), finiteNear = riverCellNear(finiteRiver, 63.75, 16.5);
  assert.equal(legacyNear, 16 * 64, 'Legacy river lookup must find the nearby wrapped river');
  observations.river = { legacyNear, finiteNear, interior: 16 * 64 + 20, westRiver: 16 * 64 };

  function boat(world: WorldData, x: number) {
    const geo = buildHumanGeography(world, { ...DEFAULT_HUMAN_PARAMS, settlementDensity: 0, realmCount: 0, sites: 'auto' }, 'places', true);
    assert.equal(geo.roads.length, 0); assert.equal(geo.settlements.length, 0);
    const journey: WorldJourney = { id: 'own-boat-coast', name: 'Own retained boat prose', stops: journeyNormalizedStops([{ name: 'Own north', x, y: 16 }, { name: 'Own south', x, y: 17 }], world), options: { mode: 'boat', season: 'summer' }, recipeKey: 'own-explicit-numerical-fixture', createdAt: 1, updatedAt: 2 };
    const literal = JSON.stringify(journey), stops = journeyStopsForWorld(journey, world);
    assert.deepEqual(stops.map(s => ({ x: s.x, y: s.y })), [{ x, y: 16 }, { x, y: 17 }]);
    if (world.domain) assert.deepEqual(journey.stops.map(s => s.cell), [{ x: x - 7, y: 21 }, { x: x - 7, y: 22 }]);
    const result = planRoute(world, geo, stops[0], stops[1], journey.options);
    assert.equal(JSON.stringify(journey), literal, 'Actual boat solver must preserve ABS saved stops/prose');
    return result;
  }
  const summary = (r: Route) => ({ cells: [...r.cells], impossible: r.impossible ?? null, km: r.km });
  const legacyCoast = terrain(false, false), finiteCoast = terrain(true, false);
  const legacyInterior = boat(legacyCoast, 1), finiteInterior = boat(finiteCoast, 1);
  for (const result of [legacyInterior, finiteInterior]) {
    assert(!result.impossible, 'Actual interior coast must permit a boat route');
    assert.equal(result.cells[0], 16 * 64 + 1); assert.equal(result.cells.at(-1), 17 * 64 + 1);
    assert(result.cells.every((c, i) => c >= 0 && c < 64 * 32 && (!i || (Math.abs(c % 64 - result.cells[i - 1] % 64) <= 1 && Math.abs(Math.floor(c / 64) - Math.floor(result.cells[i - 1] / 64)) <= 1))), 'Interior coast route must remain adjacent and bounded');
  }
  const legacyEast = boat(legacyCoast, 63), finiteEast = boat(finiteCoast, 63);
  assert(!legacyEast.impossible && legacyEast.cells.length >= 2, 'Legacy wrapped west coast must make eastern water boat-navigable');
  observations.boat = { legacyInterior: summary(legacyInterior), finiteInterior: summary(finiteInterior), legacyEast: summary(legacyEast), finiteEast: summary(finiteEast) };
  if (finiteNear !== -1) failures.push('Finite river lookup must not find a distant west river through the east outside seam');
  if (!finiteEast.impossible || finiteEast.cells.length !== 0) failures.push('Finite remote eastern Ocean must not become boat-navigable through the west coast seam');
  return { attribution: 'Independent actual riverCellNear/planRoute/ABS consumer; controlled own terrain; Node only', observations, failures, passed: failures.length === 0 };
}
