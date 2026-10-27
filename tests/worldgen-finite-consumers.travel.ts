import assert from 'node:assert/strict';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { Biome, DEFAULT_PARAMS, type WorldData } from '../src/engines/worldgen/core/types';
import { DOMAIN_GRIDS, replayDomain } from '../src/engines/worldgen/core/domainReplay';
import { adoptDomainDocument } from '../src/engines/worldgen/core/domainDocument';
import { domainSourceKey } from '../src/engines/worldgen/core/worldDomain';
import { applyEdits } from '../src/engines/worldgen/core/edits';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { planRoute, coordinateDistance, type Route } from '../src/engines/worldgen/core/travel';
import { journeyNormalizedStops, journeyStopsForWorld, type WorldJourney } from '../src/engines/worldgen/journeyTypes';

export function run() {
  const source = generateWorld({ ...DEFAULT_PARAMS, width: 64, seed: 'own-independent-finite-travel-r1', starter: 'sea', erosion: 0, glaciation: 0 });
  const bounds = { x: -7, y: 5, width: 64, height: 32 };
  const document = adoptDomainDocument(source, '', { version: 1, sourceKey: domainSourceKey(source.params, ''), entries: [] }, bounds);
  const finiteSource = replayDomain(source, document, 1);
  assert.equal(finiteSource.domain?.topology, 'finite'); assert.deepEqual(finiteSource.domain?.bounds, bounds);
  assert.equal(source.params.sourceFrame, undefined, 'Fixture must exercise adoption of legacy, not a new framed recipe');
  const failures: string[] = [], observations: Record<string, unknown> = {};
  const check = (ok: boolean, message: string) => { if (!ok) failures.push(message); };
  const close = (a: number, b: number) => Number.isFinite(a) && Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-9);
  const cellKm = 40075 / 64;
  function terrain(finite: boolean, seam = false) {
    const world = structuredClone(finite ? finiteSource : source);
    for (const key of DOMAIN_GRIDS) world[key]!.fill(0);
    world.elevation.fill(-1); world.biome.fill(Biome.Ocean);
    world.temperature.fill(15); world.precipitation.fill(800);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (!seam || x <= 1 || x >= 62) {
      world.elevation[y * 64 + x] = .3; world.biome[y * 64 + x] = Biome.Grassland;
    }
    world.rivers = []; world.landmarks = []; world.painted = undefined;
    applyEdits(world, [{ kind: 'placesEverywhere', enabled: false }]);
    return world;
  }
  function route(world: WorldData, from: { x: number; y: number }, to: { x: number; y: number }) {
    const geo = buildHumanGeography(world, { ...DEFAULT_HUMAN_PARAMS, settlementDensity: 0, realmCount: 0, sites: 'auto' }, 'places', true);
    assert.equal(geo.roads.length, 0); assert.equal(geo.settlements.length, 0);
    const journey: WorldJourney = { id: 'own-travel-r1', name: 'Own retained prose', stops: journeyNormalizedStops([{ ...from, name: 'Own west' }, { ...to, name: 'Own east' }], world), options: { mode: 'foot', season: 'summer' }, recipeKey: 'own-explicit-fixture', createdAt: 1, updatedAt: 2 };
    const captured = JSON.stringify(journey), stops = journeyStopsForWorld(journey, world);
    assert.equal(stops[0].x, from.x); assert.equal(stops[0].y, from.y);
    assert.equal(stops[1].x, to.x); assert.equal(stops[1].y, to.y);
    if (world.domain) assert.deepEqual(journey.stops.map(s => s.cell), [from, to].map(p => ({ x: p.x + bounds.x, y: p.y + bounds.y })));
    const result = planRoute(world, geo, stops[0], stops[1], journey.options);
    assert.equal(JSON.stringify(journey), captured, 'Travel computation must preserve saved source ABS and prose');
    return result;
  }
  const summary = (r: Route) => ({ cells: [...r.cells], km: r.km, directKm: r.directKm, impossible: r.impossible ?? null });
  const bounded = (r: Route) => r.cells.every((c, i) => Number.isInteger(c) && c >= 0 && c < 64 * 32 && (!i || (Math.abs(c % 64 - r.cells[i - 1] % 64) <= 1 && Math.abs(Math.floor(c / 64) - Math.floor(r.cells[i - 1] / 64)) <= 1)));
  const legacy = terrain(false, true), legacySeam = route(legacy, { x: 0, y: 16 }, { x: 63, y: 16 });
  observations.legacySeam = summary(legacySeam);
  assert(!legacySeam.impossible && legacySeam.cells.some((c, i) => i > 0 && Math.abs(c % 64 - legacySeam.cells[i - 1] % 64) > 1), 'Legacy control must route through wrap');
  const finiteSeam = route(terrain(true, true), { x: 0, y: 16 }, { x: 63, y: 16 });
  observations.finiteSeam = summary(finiteSeam);
  check(!!finiteSeam.impossible && finiteSeam.cells.length === 0, 'Finite foot route cannot cross the outside between disconnected edge strips');

  const finite = terrain(true), internal = route(finite, { x: 12, y: 16 }, { x: 14, y: 16 });
  observations.finiteInternal = summary(internal);
  assert(!internal.impossible && internal.cells[0] === 16 * 64 + 12 && internal.cells.at(-1) === 16 * 64 + 14 && bounded(internal), 'Finite ordinary connected-route control must work');
  const far = route(finite, { x: 0, y: 16 }, { x: 63, y: 16 }); observations.finiteFar = summary(far);
  check(!far.impossible && far.cells[0] === 1024 && far.cells.at(-1) === 1087 && bounded(far), 'Finite all-land route must walk internally between its exact saved endpoints');
  check(close(far.km, 63 * cellKm) && close(far.directKm, 63 * cellKm), 'Finite adopted-legacy route and direct distance must use the flat source metric');
  const distances = { horizontal: coordinateDistance(finite, 12, 16, 13, 16, 6371), vertical: coordinateDistance(finite, 12, 16, 12, 17, 6371), far: coordinateDistance(finite, 0, 16, 63, 16, 6371) };
  observations.finiteDistances = distances;
  check(close(distances.horizontal, cellKm) && close(distances.vertical, cellKm) && close(distances.far, 63 * cellKm), 'Finite adopted-legacy coordinateDistance must use isotropic flat cells');
  const legacyAdjacent = coordinateDistance(legacy, 0, 16, 1, 16, 6371), legacyEdge = coordinateDistance(legacy, 0, 16, 63, 16, 6371);
  const lat = (.5 - 16.5 / 32) * Math.PI, sphericalAdjacent = 2 * 6371 * Math.asin(Math.abs(Math.cos(lat) * Math.sin(Math.PI / 64)));
  assert(close(legacyAdjacent, sphericalAdjacent) && close(legacyAdjacent, legacyEdge), 'Legacy distance control must retain spherical haversine and wrap');
  observations.legacyDistances = { legacyAdjacent, legacyEdge, sphericalAdjacent };

  const calibrated = terrain(true); calibrated.mapWidthKm = 640;
  const unchanged = JSON.stringify({ params: calibrated.params, domain: calibrated.domain });
  const calibratedRoute = route(calibrated, { x: 12, y: 16 }, { x: 14, y: 16 });
  const calibratedDistances = { horizontal: coordinateDistance(calibrated, 12, 16, 13, 16, 6371), vertical: coordinateDistance(calibrated, 12, 16, 12, 17, 6371) };
  observations.calibrated = { ...calibratedDistances, route: summary(calibratedRoute) };
  check(close(calibratedDistances.horizontal, 10) && close(calibratedDistances.vertical, 10) && close(calibratedRoute.km, 20), 'Finite calibration must apply to both axes and the real route');
  assert.equal(JSON.stringify({ params: calibrated.params, domain: calibrated.domain }), unchanged, 'Calibration read must preserve source recipe/domain');

  const outside = route(terrain(true), { x: -1, y: 16 }, { x: 12, y: 16 }); observations.outsideABS = summary(outside);
  check(!!outside.impossible && outside.cells.length === 0, 'Outside saved ABS stop cannot alias to an in-bounds opposite-edge route');
  // Legacy wrapping is checked directly through its public route API; the legacy saved-stop reader intentionally clamps legacy normalized data.
  const legacyAll = terrain(false), legacyGeo = buildHumanGeography(legacyAll, { ...DEFAULT_HUMAN_PARAMS, settlementDensity: 0, realmCount: 0, sites: 'auto' }, 'places', true);
  const legacyOutside = planRoute(legacyAll, legacyGeo, { x: -1, y: 16 }, { x: 12, y: 16 }, { mode: 'foot', season: 'summer' });
  assert(!legacyOutside.impossible && legacyOutside.cells[0] === 1087, 'Legacy direct outside coordinate must retain wrapping');
  observations.legacyOutside = summary(legacyOutside);
  return { attribution: 'Independent public Node core consumer with actual ABS saved-stop projection; controlled own terrain', observations, failures, passed: failures.length === 0 };
}
