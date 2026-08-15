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
import type { HumanGeography } from '../src/engines/worldgen/core/settlements';
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

  /**
   * Y ADEMÁS LA CIUDAD TIENE QUE TOCAR SU RÍO.
   *
   * «Ningún edificio en el canal» se cumplía de la peor manera posible: cada
   * prueba de «aquí no se construye» era un múltiplo del ANCHO del cauce, así
   * que al pasar el ancho a físico la ciudad se apartaba del agua entera. Medido
   * sobre el mundo de Luis antes de arreglarlo: 78 m de media entre la casa más
   * cercana y su propia orilla, en las 32 ciudades fluviales, y ni un muelle.
   * Un río al que nadie se asoma no explica por qué el pueblo está ahí.
   */
  let closest = Infinity;
  for (const patch of plan.patches) {
    for (const building of patch.buildings) {
      closest = Math.min(closest, lineDistance(centroid(building.shape), visibleRiver) - course.width * 0.5);
    }
  }
  check(closest <= 14, `${settlement.name}: la ciudad se asoma a su río`, `${closest.toFixed(1)} u de la orilla`);

  /**
   * El canal del plano ES el del mapa. `Map2D` repinta encima el vector del
   * mundo con ancho constante; si aquí se dibuja un cauce que se ensancha, el
   * plano asoma por fuera del vector y el borde lee como una orilla falsa.
   */
  const channel = plan.waters?.water?.[plan.waters.water.length - 1];
  if (params.riverMode !== 'bank' && channel && plan.waters?.river) {
    const half = plan.waters.river.width * 0.5;
    const strays = channel.filter((v) => Math.abs(lineDistance(v, plan.waters!.river!.line) - half) > half * 0.12).length;
    check(strays === 0, `${settlement.name}: el canal del plano tiene el ancho del atlas`, `${strays} vértices fuera`);
  }

  /**
   * Una CIUDAD amurallada tiene muralla, y `radius` describe todo el plano.
   *
   * Al recortar la orilla el casco puede partirse: la poda del componente
   * conexo corría sólo con costa y corría ANTES del recorte, así que en Nasdial
   * la ciudadela se despegaba, `outerRing` no cerraba anillo y una ciudad de
   * 16.414 habitantes salía «villa abierta» con radio 25 sobre un plano de 107.
   */
  if (params.walls) {
    check((plan.wall?.length ?? 0) >= 6, `${settlement.name}: una ciudad amurallada conserva su muralla`,
      `${plan.wall?.length ?? 0} vértices`);
    let reach = 0;
    for (const patch of plan.patches) {
      if (!patch.withinCity) continue;
      for (const v of patch.shape) reach = Math.max(reach, Math.hypot(v.x - plan.center.x, v.y - plan.center.y));
    }
    check(plan.radius >= reach * 0.75, `${settlement.name}: el radio declarado cubre el plano`,
      `radio ${plan.radius.toFixed(0)} contra alcance ${reach.toFixed(0)}`);
  }

  /**
   * Y LA DECISIÓN NO DEPENDE DE QUE LA GEOGRAFÍA HAYA LLEGADO.
   *
   * Pesaba `roadBearings`, que sólo existen con geografía humana construida: el
   * mismo pueblo salía de cruce desde la tesela y de orilla desde la ficha
   * según qué pase hubiera terminado. Emplazamiento y modo salen ahora del
   * suelo, que está siempre.
   */
  const roadless = cityParamsFor(world, settlement, { ...geography, roads: [] } as HumanGeography);
  check(roadless.roadBearings?.length === 0, `${settlement.name}: el caso sin caminos es de verdad sin caminos`);
  check(roadless.riverMode === params.riverMode
    && Math.hypot((roadless.urbanCenter?.x ?? 0) - origin.x, (roadless.urbanCenter?.y ?? 0) - origin.y) < 1e-9,
    `${settlement.name}: el emplazamiento no depende de la geografía humana`,
    `${params.riverMode}/${origin.x.toFixed(1)} contra ${roadless.riverMode}/${(roadless.urbanCenter?.x ?? 0).toFixed(1)}`);
}
check(bankPlans > 0, 'la muestra contiene ciudades de una sola orilla');
/**
 * Y QUE EL PLANETA NO SE QUEDE SIN UN SOLO PUENTE.
 *
 * El criterio de cruce comparaba el ancho del río con el TAMAÑO DEL DIBUJO y
 * exigía además caminos por las dos márgenes. Resultado medido sobre el mundo
 * por defecto: 32 ciudades con cauce, 32 en modo orilla, cero puentes en todo
 * el planeta. Un puente es una obra con una luz conocida y se mide en metros.
 *
 * Va sobre el mundo POR DEFECTO y no sobre el de este banco: los dos únicos
 * cauces de aquí miden 625 y 607 m, que son estuarios de verdad y de verdad no
 * se cruzan. Un banco que sólo mira su propio caso cómodo no vio el fallo.
 */
{
  const wide = getWorld();
  const wideGeo = getGeography(wide, 'full');
  const withCourse = wideGeo.settlements
    .map((s) => cityParamsFor(wide, s, wideGeo))
    .filter((q) => q.riverCourse);
  const spanning = withCourse.filter((q) => q.riverMode === 'crossing');
  check(withCourse.length >= 8, 'el mundo por defecto tiene cauces medidos que juzgar',
    `${withCourse.length} ciudades con cauce`);
  check(spanning.length > 0, 'un mundo con ríos tiene ciudades de cruce',
    `${spanning.length} de ${withCourse.length}`);
  const bridges = spanning.reduce((a, q) => a + generateCity(q).bridges.length, 0);
  check(bridges >= spanning.length, 'y cada ciudad de cruce levanta su puente',
    `${bridges} puentes en ${spanning.length} ciudades`);
}

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

/**
 * LA PUERTA DE AGUA: donde el lienzo cruza el canal no se levanta piedra.
 *
 * Se dibujaba la muralla entera: once vértices de cuarenta y uno plantados en
 * mitad del río. El anillo sigue completo en el modelo —puertas, avenidas y
 * radio se calculan sobre él—; lo que cambia es que el dibujante se salta el
 * tramo mojado y planta una torre en la última piedra seca de cada orilla.
 */
{
  const wet = crossing.fort?.wet ?? [];
  const ring = crossing.fort?.line ?? [];
  const inChannel = ring.filter((v) => Math.abs(v.y) < 20).length;
  check(wet.length === ring.length && wet.filter(Boolean).length > 0,
    'una ciudad de cruce marca el tramo de muralla que va sobre el agua',
    `${wet.filter(Boolean).length} de ${ring.length}`);
  check(inChannel === 0 || wet.filter(Boolean).length >= inChannel,
    'y no se queda ningún vértice de fábrica dentro del canal sin marcar',
    `${inChannel} en el canal, ${wet.filter(Boolean).length} marcados`);
  const banks = ring.filter((v, i) => !wet[i] && (wet[(i - 1 + ring.length) % ring.length] || wet[(i + 1) % ring.length]));
  const towered = banks.filter((v) => (crossing.fort?.towers ?? []).some((t) => Math.hypot(t.at.x - v.x, t.at.y - v.y) < 3)).length;
  check(banks.length > 0 && towered === banks.length,
    'con torre en cada orilla, que es donde iba la cadena',
    `${towered} de ${banks.length}`);
}

/**
 * UN INTERRUPTOR CAMBIA UNA COSA.
 *
 * Todo el plano salía de un solo hilo de números en orden de llamada, así que
 * apagar «Río» en la ficha movía el FOSO en 61 de 120 planos. Por geometría el
 * agua sólo puede QUITAR perímetro donde cavar; que lo añadiera era la prueba
 * de que el interruptor estaba barajando el hilo entero.
 */
{
  const N = 120;
  let adds = 0, forced = 0, removed = 0, sameBody = 0;
  for (let k = 0; k < N; k++) {
    const seedBase = { ...DEFAULT_CITY, seed: `contract-moat-${k}`, size: 18 + (k % 22), walls: true };
    const dry = generateCity({ ...seedBase, river: false });
    const wetTown = generateCity({ ...seedBase, river: true });
    if (!dry.fort?.moat && wetTown.fort?.moat) adds++;
    if (k < 12) {
      const on = generateCity({ ...seedBase, moat: true });
      const off = generateCity({ ...seedBase, moat: false });
      if (on.fort?.moat && !off.fort?.moat) forced++;
      const body = (c: CityPlan) => `${c.patches.length}:${c.patches.reduce((a, q) => a + q.buildings.length, 0)}:${c.streets.length}`;
      if (body(on) === body(off)) sameBody++;
      if (!generateCity({ ...seedBase, cathedral: false }).patches.some((q) => q.ward === 'cathedral')) removed++;
    }
  }
  check(adds === 0, 'poner un río nunca AÑADE un foso: el agua sólo quita orilla donde cavar', `${adds} de ${N}`);
  check(forced === 12, 'el foso es suyo: se fuerza y se quita a voluntad', `${forced} de 12`);
  check(sameBody === 12, 'y cavarlo no mueve ni una manzana, ni una casa, ni una calle', `${sameBody} de 12`);
  check(removed === 12, 'la catedral también es una decisión del pueblo, no del sitio', `${removed} de 12`);
}
check(bridgeSurvivesWater(crossing), 'el puente del cruce queda por encima del agua');

const sharedSettlement = geography.settlements.find((s) => cityParamsFor(world, s, geography).riverCourse)
  ?? geography.settlements[0];
const tilePlanA = cityPlanFor(world, geography, sharedSettlement);
const tilePlanB = cityPlanFor(world, geography, sharedSettlement);
const modalPlan = generateCity(cityParamsFor(world, sharedSettlement, geography));
check(tilePlanA === tilePlanB, 'la tesela reutiliza una única instancia del plano');
check(JSON.stringify(tilePlanA) === JSON.stringify(modalPlan), 'mapa y modal generan exactamente la misma ciudad');
// La caché va por CONTENIDO (regla #1 de la arquitectura), no por identidad de
// objeto: la geografía se construye en dos pases y además llega decodificada de
// la instantánea, así que el mismo terreno es OTRO objeto muchas veces al día.
// Antes eso tiraba los 24 planos de ciudad del mundo — lo más caro por tesela —
// cada vez. El contrato son las dos caras: mismo terreno, mismo plano; otro
// terreno, plano nuevo.
const geographyCopy = { ...geography };
const tilePlanCopy = cityPlanFor(world, geographyCopy, sharedSettlement);
check(tilePlanCopy === tilePlanA, 'una geografía equivalente REUTILIZA el plano, no lo recalcula');
const geographyMoved = {
  ...geography,
  settlements: geography.settlements.map((s) => (s.id === sharedSettlement.id ? { ...s, x: s.x + 3 } : s)),
};
const tilePlanMoved = cityPlanFor(world, geographyMoved, sharedSettlement);
check(tilePlanMoved !== tilePlanA, 'una geografía DISTINTA invalida la caché');
check(cityPlanFor(world, geography, sharedSettlement) !== tilePlanMoved,
  'volver a la geografía original vuelve a construir su propio plano');

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
