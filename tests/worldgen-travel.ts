import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import type { HumanGeography } from '@/engines/worldgen/core/settlements';
import { planRoute } from '@/engines/worldgen/core/travel';
import { applyEdits, type WorldEdit } from '@/engines/worldgen/core/edits';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function near(actual: number, expected: number, message: string) {
  assert(Math.abs(actual - expected) < 1e-7 * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
}
function world(width = 32): WorldData {
  const n = width * width / 2;
  return {
    width, height: width / 2, params: { ...DEFAULT_PARAMS, width }, revision: 0,
    elevation: new Float32Array(n).fill(0.1), biome: new Uint8Array(n).fill(Biome.Grassland),
    temperature: new Float32Array(n).fill(18), precipitation: new Float32Array(n).fill(500),
    flow: new Float32Array(n), lake: new Uint8Array(n), ice: new Float32Array(n),
    currentU: new Float32Array(n), currentV: new Float32Array(n), currentSpeed: new Float32Array(n), sst: new Float32Array(n),
    plateId: new Uint8Array(n), boundary: new Float32Array(n), rivers: [], landmarks: [], plateInfo: [],
  };
}
function geography(w: WorldData): HumanGeography {
  return { depth: 'full', settlements: [], roads: [], realms: [], realmOf: new Int32Array(w.width * w.height).fill(-1), features: [], ruins: [], landforms: [], languages: { languages: [] }, languageOf: {} } as unknown as HumanGeography;
}
// Independent spherical metric used by the reference solver, in cell centres.
function distance(w: WorldData, a: number, b: number, radius: number): number {
  const latA = Math.PI / 2 - (Math.floor(a / w.width) + 0.5) * Math.PI / w.height;
  const latB = Math.PI / 2 - (Math.floor(b / w.width) + 0.5) * Math.PI / w.height;
  const dl = ((a % w.width) - (b % w.width)) * 2 * Math.PI / w.width;
  const h = Math.sin((latA - latB) / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dl / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Brute-force Dijkstra oracle on small ocean grids: no heuristic or production heap. */
function shipOracle(w: WorldData, start: number, goal: number, radius: number): number {
  const n = w.width * w.height;
  const costs = new Float64Array(n).fill(Infinity), done = new Uint8Array(n);
  costs[start] = 0;
  for (let count = 0; count < n; count++) {
    let from = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (from < 0 || costs[i] < costs[from])) from = i;
    if (from < 0 || !Number.isFinite(costs[from])) break;
    if (from === goal) return costs[from];
    done[from] = 1;
    const x = from % w.width, y = Math.floor(from / w.width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || y + dy < 0 || y + dy >= w.height) continue;
      const to = (y + dy) * w.width + (x + dx + w.width) % w.width;
      if (w.biome[to] !== Biome.Ocean || w.ice[to] * 0.65 > 0.55) continue;
      const aid = Math.max(0.62, Math.min(1.5, 1 + (w.currentU[to] * dx + w.currentV[to] * dy) / Math.hypot(dx, dy) * 0.42));
      const hours = distance(w, from, to, radius) * (1 + w.ice[to] * 0.65 * 1.6) / (8 * aid);
      costs[to] = Math.min(costs[to], costs[from] + hours);
    }
  }
  return Infinity;
}

export async function testWorldgenTravel(): Promise<string[]> {
  const lakeWorld = world(), lakeGeo = geography(lakeWorld), W = lakeWorld.width;
  for (let x = 0; x < W; x++) {
    const cell = 8 * W + x;
    lakeWorld.biome[cell] = Biome.Lake; lakeWorld.lake[cell] = 1;
  }
  for (const mode of ['foot', 'horse', 'cart'] as const) {
    assert(planRoute(lakeWorld, lakeGeo, { x: 10, y: 7 }, { x: 10, y: 9 }, { mode, season: 'summer', planetRadiusKm: 20 }).impossible, `${mode} crossed an unbridged lake`);
    assert(planRoute(lakeWorld, lakeGeo, { x: 10, y: 8 }, { x: 10, y: 7 }, { mode, season: 'summer', planetRadiusKm: 20 }).impossible, `${mode} escaped a lake start by treating it as land`);
  }
  const lakeBoat = planRoute(lakeWorld, lakeGeo, { x: 10, y: 8 }, { x: 14, y: 8 }, { mode: 'boat', season: 'summer', planetRadiusKm: 20 });
  assert(!lakeBoat.impossible && lakeBoat.cells.every(cell => lakeWorld.lake[cell]), 'Boat could not follow actual lake water');
  near(lakeBoat.hours, lakeBoat.km / 5.5, 'Flat lake travel incorrectly received an upstream penalty');
  assert(planRoute(lakeWorld, lakeGeo, { x: 10, y: 8 }, { x: 14, y: 8 }, { mode: 'ship', season: 'summer' }).impossible, 'Ocean ship was allowed across an inland lake');
  lakeWorld.temperature.fill(-5);
  assert(planRoute(lakeWorld, lakeGeo, { x: 10, y: 8 }, { x: 14, y: 8 }, { mode: 'boat', season: 'winter' }).impossible, 'Boat traversed frozen lake water');
  lakeWorld.temperature.fill(20);
  for (let x = 0; x < W; x++) lakeWorld.biome[8 * W + x] = Biome.SaltFlat;
  assert(!planRoute(lakeWorld, lakeGeo, { x: 10, y: 7 }, { x: 10, y: 9 }, { mode: 'foot', season: 'summer', planetRadiusKm: 20 }).impossible, 'A dry salt flat was confused with open lake water');
  assert(planRoute(lakeWorld, lakeGeo, { x: 10, y: 8 }, { x: 14, y: 8 }, { mode: 'boat', season: 'summer' }).impossible, 'Boat crossed a dry salt basin');

  const river = world(), riverGeo = geography(river);
  for (let x = 10; x <= 14; x++) { river.flow[5 * W + x] = 0.9; river.elevation[5 * W + x] = 0.1 - x * 0.001; }
  const downstream = planRoute(river, riverGeo, { x: 10, y: 5 }, { x: 14, y: 5 }, { mode: 'boat', season: 'summer', planetRadiusKm: 20 });
  const upstream = planRoute(river, riverGeo, { x: 14, y: 5 }, { x: 10, y: 5 }, { mode: 'boat', season: 'summer', planetRadiusKm: 20 });
  assert(!downstream.impossible && !upstream.impossible && downstream.hours < upstream.hours && downstream.cells.every(cell => river.flow[cell] > 0.62), 'River navigation left its channel or lost upstream/downstream direction');

  const painted = world(), paintedGeo = geography(painted);
  const customRiver: WorldEdit = { kind: 'river', pts: [{ x: 10, y: 5 }, { x: 14, y: 5 }], width: 1 };
  applyEdits(painted, [customRiver]);
  const routePainted = () => planRoute(painted, paintedGeo, { x: 10, y: 5 }, { x: 14, y: 5 }, { mode: 'boat', season: 'summer', planetRadiusKm: 20 });
  assert(!routePainted().impossible && painted.flow.every(value => value === 0), 'Authored river was ignored because the generated flow raster was unchanged');
  applyEdits(painted, [customRiver, { kind: 'eraseRivers', x: 12, y: 5, radius: 1 }]);
  assert(routePainted().impossible, 'River navigation cache retained an erased authored river');
  applyEdits(painted, [customRiver]);
  assert(!routePainted().impossible, 'Restoring a painted river did not invalidate navigation');

  const coast = world(), coastGeo = geography(coast);
  for (let i = 8 * W; i < coast.biome.length; i++) { coast.biome[i] = Biome.Ocean; coast.elevation[i] = -1; }
  const from = { x: 10, y: 7 }, to = { x: 14, y: 7 };
  for (const mode of ['boat', 'ship'] as const) {
    const route = planRoute(coast, coastGeo, from, to, { mode, season: 'summer', planetRadiusKm: 20 });
    assert(!route.impossible && route.cells.slice(1, -1).every(cell => coast.biome[cell] === Biome.Ocean), `${mode} used dry coastline instead of embarking at its endpoints`);
    near(route.legs.reduce((sum, leg) => sum + leg.hours, 0), route.hours, `${mode} port access totals are inconsistent`);
    assert(planRoute(coast, coastGeo, { x: 10, y: 5 }, to, { mode, season: 'summer' }).impossible, `${mode} sailed from a dry inland endpoint`);
  }
  const walking = planRoute(coast, coastGeo, from, to, { mode: 'foot', season: 'summer', planetRadiusKm: 20 });
  assert(!walking.impossible && walking.cells.every(cell => coast.biome[cell] !== Biome.Ocean), 'Walking along the coast stopped working or crossed seawater');
  assert(planRoute(coast, coastGeo, { x: 10, y: 12 }, { x: 14, y: 12 }, { mode: 'boat', season: 'summer' }).impossible, 'Small boat took an open-ocean route');

  const land = world(), landGeo = geography(land), radius = 100;
  const seam = planRoute(land, landGeo, { x: W - 1, y: 3 }, { x: 0, y: 4 }, { mode: 'foot', season: 'summer', planetRadiusKm: radius });
  assert(seam.cells.length === 2, 'A seam-adjacent diagonal took an unnecessary detour');
  near(seam.km, distance(land, 3 * W + W - 1, 4 * W, radius), 'Seam diagonal distance lost its diagonal/latitude component');
  near(seam.hours, seam.legs.reduce((sum, leg) => sum + leg.hours, 0), 'Summary hours disagree with the routed hours');
  const via = planRoute(land, landGeo, { x: 4, y: 7 }, { x: 12, y: 7 }, { mode: 'foot', season: 'summer', planetRadiusKm: radius, via: [{ x: 8, y: 3 }] });
  near(via.directKm, distance(land, 7 * W + 4, 7 * W + 12, radius), 'Via journey inflated the straight-line endpoint distance');
  const invalidDay = planRoute(land, landGeo, { x: 4, y: 7 }, { x: 5, y: 7 }, { mode: 'foot', season: 'summer', hoursPerDay: 0, planetRadiusKm: radius });
  assert(Number.isFinite(invalidDay.days) && invalidDay.stages.length < 400, 'Invalid daily hours broke stage generation');

  const ocean = world(16), oceanGeo = geography(ocean);
  ocean.biome.fill(Biome.Ocean); ocean.elevation.fill(-1);
  for (let scenario = 0; scenario < 12; scenario++) {
    for (let i = 0; i < ocean.biome.length; i++) {
      ocean.currentU[i] = Math.sin(i * 2.31 + scenario) * 1.5;
      ocean.currentV[i] = Math.cos(i * 0.87 - scenario) * 1.5;
      ocean.ice[i] = (i * 7 + scenario * 13) % 11 / 30;
    }
    const start = (scenario % 3) * ocean.width + scenario % ocean.width;
    const goal = ((scenario + 1) % 6) * ocean.width + (scenario * 5 + 9) % ocean.width;
    const route = planRoute(ocean, oceanGeo, { x: start % ocean.width, y: Math.floor(start / ocean.width) }, { x: goal % ocean.width, y: Math.floor(goal / ocean.width) }, { mode: 'ship', season: 'summer', planetRadiusKm: radius });
    near(route.hours, shipOracle(ocean, start, goal, radius), `A* was not optimal with polar distances and favourable currents (scenario ${scenario})`);
    near(route.hours, route.legs.reduce((sum, leg) => sum + leg.hours, 0), 'Ocean route leg times do not sum to journey time');
    near(route.km, route.cells.slice(1).reduce((sum, cell, i) => sum + distance(ocean, route.cells[i], cell, radius), 0), 'Ocean distance is inconsistent with spherical path geometry');
  }
  return ['Worldgen travel: land routes cannot cross lakes; boats use real waterways and ships use sea', 'Worldgen travel: authored river navigation follows painting, erasure and restoration without recomputing hydrology', 'Worldgen travel: coastal settlements embark only at endpoints; land and ocean access remain distinct', 'Worldgen travel: spherical distances, antimeridian summaries, via direct distance and daily stages agree', 'Worldgen travel: least-time A* matches an independent Dijkstra oracle under polar currents'];
}
