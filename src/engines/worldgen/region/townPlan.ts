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
import type { HumanGeography, Settlement } from '../core/settlements';
import type { Ctx } from '../cartography/symbols';
import { generateCity, type CityPlan, type Patch } from '../city/generate';
import { cityParamsFor } from '../cartography/texture';

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

type PlanCache = Map<number, CityPlan | null>;
const CACHES = new WeakMap<WorldData, PlanCache>();

function planFor(world: WorldData, s: Settlement): CityPlan | null {
  let cache = CACHES.get(world);
  if (!cache) { cache = new Map(); CACHES.set(world, cache); }
  const hit = cache.get(s.id);
  if (hit !== undefined) return hit;
  let plan: CityPlan | null = null;
  try {
    plan = generateCity(cityParamsFor(world, s));
  } catch {
    plan = null; // a plan that will not build must not take the tile with it
  }
  cache.set(s.id, plan);
  return plan;
}

/** Ground radius of a town's plan, in metres — used to decide whether it can
 *  possibly reach a tile before paying to build it. */
export function planRadiusMetres(size: number): number {
  // Mirrors the generator's nominal radius (10 + n·2.5 units) with room for the
  // lobes and the outskirts ring.
  return (10 + Math.max(4, Math.round(size)) * 2.5) * 1.9 * METRES_PER_CITY_UNIT;
}

const WARD_FILL: Record<string, string> = {
  market: 'rgba(214,205,182,0.95)',
  cathedral: 'rgba(208,201,186,0.95)',
  castle: 'rgba(176,168,152,0.95)',
  park: 'rgba(112,140,88,0.9)',
  patriciate: 'rgba(196,186,166,0.92)',
  administration: 'rgba(194,185,168,0.92)',
  military: 'rgba(184,174,158,0.92)',
  slum: 'rgba(172,161,142,0.9)',
  farm: 'rgba(178,166,124,0.45)',
  outskirts: 'rgba(170,162,140,0.4)',
};
const WARD_DEFAULT = 'rgba(190,180,160,0.92)';

/**
 * Roofs, in four tones.
 *
 * One flat brown turned every block into a solid mass of mud — which is what a
 * densely built town does become if every house is the same colour and there is
 * no ground showing between them. Real roofs vary: fired tile, weathered tile,
 * thatch, slate. The tone is picked from the building's own position so it
 * never changes between tiles or levels.
 */
const ROOFS = ['#a4633f', '#8d5c42', '#b0764a', '#7d6a57'];

function roofTone(x: number, y: number): string {
  let h = (Math.imul(Math.round(x * 8) | 0, 0x9e3779b1)
    ^ Math.imul(Math.round(y * 8) | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ROOFS[(h >>> 3) % ROOFS.length];
}

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
    let dx = s.x - view.originWorldX;
    while (dx > W / 2) dx -= W;
    while (dx < -W / 2) dx += W;
    const cx = dx * cellPx;
    const cy = (s.y - view.originWorldY) * cellPx;
    const size = s.rank === 'capital' ? 34 : s.rank === 'city' ? 22 : s.rank === 'town' ? 13 : 7;
    const reach = (planRadiusMetres(size) / view.metresPerPx);
    if (cx + reach < 0 || cy + reach < 0 || cx - reach > view.widthPx || cy - reach > view.heightPx) {
      continue;
    }
    const plan = planFor(world, s);
    if (!plan) continue;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(unitPx, unitPx);
    // Line widths are set in city units from here on, so they are ground
    // widths and scale with the level exactly like everything else on the tile.
    const hair = Math.max(0.35, 0.5 / unitPx);

    const path = (poly: { x: number; y: number }[]) => {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
    };

    // 1. The ground each ward stands on, so the town reads as a shape before
    //    any single building does.
    for (const q of plan.patches as Patch[]) {
      if (!q.withinCity && q.ward !== 'farm') continue;
      if (q.shape.length < 3) continue;
      path(q.shape);
      ctx.fillStyle = WARD_FILL[q.ward] ?? WARD_DEFAULT;
      ctx.fill();
    }

    // 2. Streets: the gaps between the blocks. Drawn as the block outlines in
    //    the street colour, which is what a street IS at this scale.
    ctx.strokeStyle = 'rgba(212,200,172,0.9)';
    ctx.lineWidth = Math.max(hair, 1.6);
    ctx.lineJoin = 'round';
    for (const q of plan.patches as Patch[]) {
      if (!q.withinCity || q.shape.length < 3) continue;
      path(q.shape);
      ctx.stroke();
    }
    for (const st of plan.mainStreets) {
      if (st.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(st[0].x, st[0].y);
      for (let i = 1; i < st.length; i++) ctx.lineTo(st[i].x, st[i].y);
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }

    // 3. Roofs. Each in its own tone, so a block reads as a hundred houses
    //    rather than as one brown polygon — and only once a house is big
    //    enough to be a mark at all.
    if (unitPx > 1.6) {
      for (const q of plan.patches as Patch[]) {
        if (!q.withinCity && q.ward !== 'farm') continue;
        for (const b of q.buildings) {
          if (b.length < 3) continue;
          path(b);
          ctx.fillStyle = roofTone(b[0].x, b[0].y);
          ctx.fill();
        }
      }
    } else if (unitPx > 0.5) {
      // Too fine to draw one by one: a single wash per block at the density the
      // buildings actually have, which is what the eye reads anyway.
      for (const q of plan.patches as Patch[]) {
        if (!q.withinCity || q.shape.length < 3 || !q.buildings.length) continue;
        path(q.shape);
        ctx.fillStyle = 'rgba(150,102,74,0.55)';
        ctx.fill();
      }
    }

    // 4. Wall, gates, towers — the thing that makes a town read as a town from
    //    the air even when the streets are too fine to see.
    if (plan.wall && plan.wall.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(plan.wall[0].x, plan.wall[0].y);
      for (let i = 1; i < plan.wall.length; i++) ctx.lineTo(plan.wall[i].x, plan.wall[i].y);
      if (plan.wallClosed) ctx.closePath();
      ctx.strokeStyle = 'rgba(74,66,56,0.95)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(74,66,56,0.95)';
      for (const tw of plan.towers) {
        ctx.beginPath();
        ctx.arc(tw.x, tw.y, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Bridges and quays last: they sit over the water the tile already drew.
    ctx.fillStyle = 'rgba(150,138,118,0.95)';
    for (const poly of [...plan.bridges, ...plan.quays, ...plan.piers]) {
      if (poly.length < 3) continue;
      path(poly);
      ctx.fill();
    }
    ctx.restore();
    drawn++;
  }
  return drawn;
}
