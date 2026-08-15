// ============================================
// The town, on the ground
// ============================================
// Up to now a settlement at street range was a scatter of roofs: enough to say
// "people live here", nothing like the place the city generator already knows
// how to draw. That generator produces streets, blocks, individual buildings,
// a curtain wall with its gates and towers, bridges, quays and piers — and all
// of it lived in a modal, in its own abstract coordinates, invisible to the
// map.
//
// This lands it. One city unit is four metres (the generator's own scale), the
// plan's origin is the settlement's ground position, and the plan's axes are
// already the world's because the bearings it was built from — the sea, the
// river, the rising ground — came off the world raster in those same axes. So
// there is no rotation to guess: a town built facing its real river is drawn
// facing its real river.
//
// Plans are cached per world: a town's plan is a pure function of its id and
// the world seed, and one plan serves every tile that shows any part of it.

import type { WorldData } from '../core/types';
import { settlementCellCenter, type HumanGeography, type Settlement } from '../core/settlements';
import type { Ctx } from '../cartography/symbols';
import { generateCity, type CityPlan } from '../city/generate';
import { cityInk, drawCityBody, drawCityWaterfrontStructures, lodFor } from '../city/render';
import { cityParamsFor } from '../cartography/texture';
import { geographyContentKey, worldContentKey } from './contentIdentity';

/** Metres per city unit. The generator's own documented scale: a main street
 *  is 2 units, which it calls ~8 m. */
export const METRES_PER_CITY_UNIT = 4;

/**
 * Coarsest ground resolution at which a town plan is worth drawing.
 *
 * At five metres per pixel a walled town of six hundred metres is a hundred and
 * twenty pixels across: the wall, the blocks and the market square all read,
 * even though a single house does not. That is exactly the range at which a
 * reader wants to see the SHAPE of the town on the map, so the plan starts
 * here and the roof scatter it replaces stops here.
 */
export const PLAN_MAX_METRES_PER_PX = 5;

/**
 * La caché de planos, por CONTENIDO.
 *
 * Estaba comparando `cache.geography !== geography` — identidad de OBJETO, que
 * es justo lo que la arquitectura prohíbe desde `contentIdentity.ts`: la
 * geografía se construye en dos pases y llega decodificada de la instantánea,
 * así que son objetos distintos con el mismo contenido y cada uno tiraba la
 * caché entera. Un mundo de 24 poblaciones vuelve a generar veinticuatro planos
 * de ciudad —lo más caro que hay por tesela— cada vez que el segundo pase
 * aterriza o que un consumidor pasa su propia copia. Con la clave de contenido,
 * dos geografías equivalentes son la misma y el plano se calcula una vez.
 */
interface PlanCache {
  key: string;
  plans: Map<number, CityPlan | null>;
}
const CACHES = new WeakMap<WorldData, PlanCache>();

export function cityPlanFor(world: WorldData, geography: HumanGeography, s: Settlement): CityPlan | null {
  let cache = CACHES.get(world);
  const key = `${worldContentKey(world)}|${geographyContentKey(geography)}`;
  if (!cache || cache.key !== key) {
    cache = { key, plans: new Map() };
    CACHES.set(world, cache);
  }
  const hit = cache.plans.get(s.id);
  if (hit !== undefined) return hit;
  let plan: CityPlan | null = null;
  try {
    // CON la geografía, como el modal. Sin ella `cityParamsFor` no puede
    // construir `roadBearings` y el plano de la tesela salía con 0 rumbos de
    // camino: las puertas caían donde no llega ninguno — y, peor, el MISMO
    // pueblo tenía dos planos distintos según lo miraras en la tesela o en la
    // ficha, porque el generador es determinista sobre sus parámetros y los
    // parámetros eran otros.
    plan = generateCity(cityParamsFor(world, s, geography));
  } catch {
    plan = null; // a plan that will not build must not take the tile with it
  }
  cache.plans.set(s.id, plan);
  return plan;
}

/** Ground radius of a town's plan, in metres — used to decide whether it can
 *  possibly reach a tile before paying to build it. */
export function planRadiusMetres(size: number): number {
  // Mirrors the generator's nominal radius (10 + n·2.5 units) with room for the
  // lobes and the outskirts ring.
  return (10 + Math.max(4, Math.round(size)) * 2.5) * 1.9 * METRES_PER_CITY_UNIT;
}

/**
 * LA PALETA Y EL ORDEN DE DIBUJO SON LOS DEL MODAL.
 *
 * Aquí vivían una tabla `WARD_FILL` propia y cuatro tonos de tejado propios, y
 * la lámina del modal tenía los suyos. Dos paletas para el mismo pueblo
 * significaban que al hacer zoom del mapa a la ficha el sitio CAMBIABA DE
 * IDIOMA — y que arreglar el mercado en un sitio no lo arreglaba en el otro:
 * de hecho este dibujante no pintaba `courts` en absoluto, así que a escala de
 * mapa la plaza del mercado, el claustro y las cuñas del parque no existían.
 *
 * `cityInk()` sin tema devuelve la paleta canónica del pueblo — la misma que
 * el modal tiñe con el suyo — y `drawCityBody` es literalmente el mismo
 * dibujo. Lo único propio de este camino son las tres opciones de abajo, que
 * dicen qué NO repetir porque el tile ya lo trae.
 */
const INK = cityInk();

/**
 * Draw every town whose plan reaches this tile.
 *
 * `originWorldX/Y` is the world-cell coordinate of the tile's top-left pixel
 * and `metresPerPx` its ground resolution; everything else follows.
 */
export function drawTownPlans(
  world: WorldData,
  geography: HumanGeography,
  ctx: Ctx,
  view: {
    originWorldX: number; originWorldY: number;
    widthPx: number; heightPx: number;
    metresPerPx: number; metresPerWorldCell: number;
  },
): number {
  if (view.metresPerPx > PLAN_MAX_METRES_PER_PX) return 0;
  const unitPx = METRES_PER_CITY_UNIT / view.metresPerPx;
  const cellPx = view.metresPerWorldCell / view.metresPerPx;
  const W = world.width;
  let drawn = 0;

  for (const s of geography.settlements) {
    // Where the town centre lands on this tile, taking the nearest wrapped
    // branch so a town by the antimeridian is not drawn a world away.
    // Same cell-centre contract as Map2D, roads and regional habitation. At
    // street zoom a missing +0.5 was thousands of pixels, so the real city was
    // being drawn several kilometres away from its visible name and marker.
    const centre = settlementCellCenter(s);
    let dx = centre.x - view.originWorldX;
    while (dx > W / 2) dx -= W;
    while (dx < -W / 2) dx += W;
    const cx = dx * cellPx;
    const cy = (centre.y - view.originWorldY) * cellPx;
    const size = s.rank === 'capital' ? 34 : s.rank === 'city' ? 22 : s.rank === 'town' ? 13 : 7;
    const reach = (planRadiusMetres(size) * 2.5 / view.metresPerPx);
    if (cx + reach < 0 || cy + reach < 0 || cx - reach > view.widthPx || cy - reach > view.heightPx) {
      continue;
    }
    const plan = cityPlanFor(world, geography, s);
    if (!plan) continue;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(unitPx, unitPx);

    /**
     * EL MISMO CUADRO, MÁS SIMPLE.
     *
     * Los tres niveles de detalle de siempre — cada tejado por encima de 1,6 px
     * por unidad, un lavado por manzana por encima de 0,5, nada por debajo —
     * ahora los decide `lodFor`, que es la misma escala que usa el modal. Lo
     * que cambia respecto a antes es QUÉ se simplifica: cada nivel es el dibujo
     * de la lámina con cosas quitadas, no un dibujo distinto, así que la plaza,
     * los patios, el parque y el agua ya salen aquí también.
     *
     * Las tres exclusiones son las capas que el tile satélite YA trae debajo y
     * que repetir sólo emborrona:
     *   - `fields`: el pase de tinta pinta setos y linderos sobre el mismo suelo.
     *   - `roads`:  la red viaria del mundo entra por su propia capa, y el
     *               camino del plano acaba en el mismo sitio con otro trazo.
     *   - `water`:  el agua del plano es una LECTURA del mundo, no el mundo.
     *               El semiplano de `plan.coast` mide radio·6 — a 5 m/px, casi
     *               tres kilómetros de azul liso — y hasta el litoral modelado
     *               de `plan.waters` sale de un rumbo, no del ráster: medido en
     *               `sat-compare` a z17 (1,8 m/px) las dos orillas discrepan
     *               casi cien metros y se cruzan en mitad del muelle, cada una
     *               de su azul. Aquí el agua la manda el terreno; el plano
     *               manda las casas.
     * El canon ya despeja y cultiva el suelo alrededor de cada asentamiento.
     * Repetir aquí `groundFill`/`wardTints` plantaba encima una silueta beige
     * opaca con perímetro Voronoi. En el mapa sólo entran los objetos urbanos;
     * el terreno que queda entre ellos sigue siendo el terreno real.
     */
    drawCityBody(ctx, plan, {
      ink: INK,
      unit: 1 / unitPx,
      lod: lodFor(unitPx),
      groundFill: false,
      wardTints: false,
      fields: false,
      roads: false,
      water: false,
      blockEdges: true,
    });

    ctx.restore();
    drawn++;
  }
  return drawn;
}

/**
 * Repaint only structures that cross the water. Map2D owns the world-river
 * vector and draws it after terrain tiles; this pass restores bridge decks and
 * piers above that water without lifting roofs or walls above the channel.
 */
export function drawTownWaterfrontStructures(
  world: WorldData,
  geography: HumanGeography,
  ctx: Ctx,
  view: {
    originWorldX: number; originWorldY: number;
    widthPx: number; heightPx: number;
    metresPerPx: number; metresPerWorldCell: number;
  },
): number {
  if (view.metresPerPx > PLAN_MAX_METRES_PER_PX) return 0;
  const unitPx = METRES_PER_CITY_UNIT / view.metresPerPx;
  const cellPx = view.metresPerWorldCell / view.metresPerPx;
  const W = world.width;
  let drawn = 0;
  for (const s of geography.settlements) {
    const centre = settlementCellCenter(s);
    let dx = centre.x - view.originWorldX;
    while (dx > W / 2) dx -= W;
    while (dx < -W / 2) dx += W;
    const cx = dx * cellPx;
    const cy = (centre.y - view.originWorldY) * cellPx;
    const size = s.rank === 'capital' ? 34 : s.rank === 'city' ? 22 : s.rank === 'town' ? 13 : 7;
    const coarseReach = planRadiusMetres(size) * 2.5 / view.metresPerPx;
    if (cx + coarseReach < 0 || cy + coarseReach < 0
      || cx - coarseReach > view.widthPx || cy - coarseReach > view.heightPx) continue;
    const plan = cityPlanFor(world, geography, s);
    if (!plan || (!plan.bridges.length && !plan.piers.length)) continue;
    const exactReach = (Math.hypot(plan.center.x, plan.center.y) + plan.radius * 1.5)
      * METRES_PER_CITY_UNIT / view.metresPerPx;
    if (cx + exactReach < 0 || cy + exactReach < 0
      || cx - exactReach > view.widthPx || cy - exactReach > view.heightPx) continue;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(unitPx, unitPx);
    drawCityWaterfrontStructures(ctx, plan, {
      ink: INK,
      unit: 1 / unitPx,
      lod: lodFor(unitPx),
    });
    ctx.restore();
    drawn++;
  }
  return drawn;
}
