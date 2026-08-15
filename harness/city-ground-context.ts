// ============================================================================
// CONTRACT: the city and the atlas describe the same piece of ground
// ============================================================================
// A settlement flag is not enough. This bank checks actual generated worlds:
// river axes meet the atlas anchor, wide rivers move the urban core onto dry
// ground, buildings stay out of the channel, coastal plans retain their real
// shore, and bridge decks are the only city structures restored above water.

import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { applyEdits } from '../src/engines/worldgen/core/edits';
import { getGeography, cityParamsFor } from '../src/engines/worldgen/cartography/texture';
import { DEFAULT_CITY, generateCity, type CityPlan } from '../src/engines/worldgen/city/generate';
import { centroid, type Poly, type V } from '../src/engines/worldgen/city/geometry';
import { cityInk, drawCityWaterfrontStructures } from '../src/engines/worldgen/city/render';
import { cityPlanFor } from '../src/engines/worldgen/region/townPlan';

let failed = false;
let checks = 0;
function check(ok: unknown, label: string, detail = ''): void {
  checks++;
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failed = true;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function pointSegmentDistance(p: V, a: V, b: V): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function lineDistance(p: V, line: V[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) best = Math.min(best, pointSegmentDistance(p, line[i], line[i + 1]));
  return best;
}

function trace(ctx: CanvasRenderingContext2D, poly: Poly): void {
  if (!poly.length) return;
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function bridgeSurvivesWater(plan: CityPlan): boolean {
  const bridge = plan.bridges[0];
  if (!bridge || !plan.waters?.water.length) return true;
  const canvas = createCanvas(512, 512);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.translate(256 - plan.center.x * 2, 256 - plan.center.y * 2);
  ctx.scale(2, 2);
  ctx.fillStyle = '#168ed1';
  for (const water of plan.waters.water) {
    ctx.beginPath(); trace(ctx, water); ctx.fill();
  }
  drawCityWaterfrontStructures(ctx, plan, { ink: cityInk(), unit: 0.5, lod: 3 });
  const c = centroid(bridge);
  const x = Math.round(256 + (c.x - plan.center.x) * 2);
  const y = Math.round(256 + (c.y - plan.center.y) * 2);
  const px = ctx.getImageData(x, y, 1, 1).data;
  return !(px[0] === 22 && px[1] === 142 && px[2] === 209);
}

const world = getWorld({ seed: 'city-ground-context', width: 256 });
applyEdits(world, [{ kind: 'placesEverywhere', enabled: true }]);
const geography = getGeography(world, 'full');
const riverSettlements = geography.settlements.filter((s) => s.river);
const portSettlements = geography.settlements.filter((s) => s.port);

console.log(`mundo: ${geography.settlements.length} poblaciones; ${riverSettlements.length} fluviales; ${portSettlements.length} puertos`);
check(riverSettlements.length > 0, 'el mundo de prueba contiene ciudades fluviales');
check(portSettlements.length > 0, 'el mundo de prueba contiene puertos');

let bankPlans = 0;
let crossingPlans = 0;
for (const settlement of riverSettlements.slice(0, 20)) {
  const params = cityParamsFor(world, settlement, geography);
  const course = params.riverCourse;
  // A riverine catchment may contain only sub-map streams. In that case the
  // city must not invent a named river from a neighbouring world cell.
  if (!course) {
    check(!params.river, `${settlement.name}: no se inventa un cauce remoto`);
    continue;
  }
  check(params.river, `${settlement.name}: el cauce medido activa la ciudad fluvial`);
  if (!course) continue;
  const anchorDistance = lineDistance({ x: 0, y: 0 }, course.line);
  check(anchorDistance <= 1e-3, `${settlement.name}: cauce y ancla del atlas coinciden`, `${anchorDistance.toFixed(2)} u`);
  const plan = generateCity(params);
  const origin = params.urbanCenter ?? { x: 0, y: 0 };
  // At an estuary the plan trims the authoritative course where it reaches
  // the sea; use that visible inland run for road/building assertions.
  const visibleRiver = plan.waters?.river?.line ?? course.line;

  if (params.riverMode === 'bank') {
    bankPlans++;
    const dryDistance = lineDistance(origin, course.line);
    check(dryDistance >= course.width * 0.5, `${settlement.name}: el casco se funda fuera del canal`, `${dryDistance.toFixed(1)} / ${(course.width * 0.5).toFixed(1)} u`);
  } else {
    crossingPlans++;
    check(plan.bridges.length > 0, `${settlement.name}: una ciudad de cruce materializa al menos un puente`);
  }

  let wetBuildings = 0;
  for (const patch of plan.patches) for (const building of patch.buildings) {
    if (building.shape.some((v) => lineDistance(v, visibleRiver) < course.width * 0.48)) wetBuildings++;
  }
  check(wetBuildings === 0, `${settlement.name}: ningún edificio ocupa el cauce`, `${wetBuildings} edificios`);
  const wetRoadPoints = params.riverMode === 'bank'
    ? plan.roads.flat().filter((v) => lineDistance(v, visibleRiver) < course.width * 0.48).length
    : 0;
  check(wetRoadPoints === 0, `${settlement.name}: ningún camino sin puente atraviesa el agua`, `${wetRoadPoints} puntos`);
  const wetWallPoints = params.riverMode === 'bank'
    ? (plan.wall ?? []).filter((v) => lineDistance(v, visibleRiver) < course.width * 0.45).length
    : 0;
  check(wetWallPoints === 0, `${settlement.name}: la muralla pertenece a la orilla habitada`, `${wetWallPoints} puntos`);
  check(bridgeSurvivesWater(plan), `${settlement.name}: los puentes se restauran por encima del agua`);
}
check(bankPlans > 0, 'la muestra contiene ciudades de una sola orilla');

// A Duug-like major city: 160 m river, roads arriving from both banks. This
// proves the complementary branch even if the small random world above happens
// to contain only villages on wide rivers.
const crossing = generateCity({
  ...DEFAULT_CITY,
  seed: 'city-ground-context::crossing',
  name: 'Cruce',
  size: 34,
  river: true,
  riverMode: 'crossing',
  riverDir: { x: 1, y: 0 },
  riverCourse: { line: [{ x: -180, y: 0 }, { x: 180, y: 0 }], width: 40 },
  roadBearings: [Math.PI / 2, -Math.PI / 2, 0],
});
check(crossing.bridges.length > 0, 'una ciudad mayor que ocupa ambas orillas materializa un puente');
check(bridgeSurvivesWater(crossing), 'el puente del cruce queda por encima del agua');

const sharedSettlement = geography.settlements.find((s) => cityParamsFor(world, s, geography).riverCourse)
  ?? geography.settlements[0];
const tilePlanA = cityPlanFor(world, geography, sharedSettlement);
const tilePlanB = cityPlanFor(world, geography, sharedSettlement);
const modalPlan = generateCity(cityParamsFor(world, sharedSettlement, geography));
check(tilePlanA === tilePlanB, 'la tesela reutiliza una única instancia del plano');
check(JSON.stringify(tilePlanA) === JSON.stringify(modalPlan), 'mapa y modal generan exactamente la misma ciudad');
const geographyCopy = { ...geography };
const tilePlanFresh = cityPlanFor(world, geographyCopy, sharedSettlement);
check(tilePlanFresh !== tilePlanA, 'la caché se invalida al cambiar la geografía');
check(JSON.stringify(tilePlanFresh) === JSON.stringify(tilePlanA), 'invalidar la caché no cambia un terreno equivalente');

for (const settlement of portSettlements.slice(0, 12)) {
  const params = cityParamsFor(world, settlement, geography);
  check(!!params.shoreLine && params.shoreLine.length >= 2, `${settlement.name}: el puerto recibe una costa medida`);
  if (!params.coast) continue;
  const plan = generateCity(params);
  check(!!plan.waters?.shore.length, `${settlement.name}: el plano conserva el litoral`);
  let wetBuildings = 0;
  if (plan.coast) {
    for (const patch of plan.patches) for (const building of patch.buildings) {
      if (building.shape.some((v) => (v.x - plan.coast!.p.x) * plan.coast!.n.x + (v.y - plan.coast!.p.y) * plan.coast!.n.y > 1e-5)) wetBuildings++;
    }
  }
  check(wetBuildings === 0, `${settlement.name}: ningún edificio invade el mar`, `${wetBuildings} edificios`);
}

console.log(`\n${checks} comprobaciones; orilla=${bankPlans}; cruce=${crossingPlans}`);
if (failed) process.exitCode = 1;
