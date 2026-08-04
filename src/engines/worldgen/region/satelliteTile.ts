// ============================================
// Satellite display tiles — the whole ladder
// ============================================
// One slippy pyramid from the whole planet down to a roof, in two regimes with
// a single hand-over:
//
//   z2 … z9    the WORLD raster (≈20 km per cell), sampled per screen pixel
//              with per-pixel relief, and its rivers drawn as real polylines
//              instead of one stamped cell each.
//   z10 … z18  the CANON countryside (≈153 m per cell) — the same ground the
//              3D close-up and the pliego read — inked photographically, with
//              sub-canon amplification carrying the last five levels down to
//              about 0,6 m per pixel.
//
// The hand-over is at the level where one canon cell is one output pixel, so
// neither regime is ever magnified past its own truth. Above it the world
// raster is the sharper source; below it the canon is.
//
// Pure data + an injected 2D context, like every other tile path here: the
// worker feeds an OffscreenCanvas, the harness feeds @napi-rs.

import type { WorldData } from '../core/types';
import type { WorldEdit } from '../core/edits';
import type { HumanGeography } from '../core/settlements';
import type { Ctx } from '../cartography/symbols';
import { renderAtlasWindow, BIOME_COLORS } from '../core/render';
import { riverKey } from '../core/edits';
import { generateCanonTile, canonTileKey } from './generate';
import { canonRefinement, type TileId } from './tiles';
import { canonWindowCover, composeCanonWindow, type CanonWindowSpec } from './composeWindow';
import {
  renderSatellite, oceanRgb, makeLatticeHash, latticeFbm, LX, LY, LZ,
} from './satelliteInk';
import {
  buildElevation, extractPatch, kmPerWorldCell, patchBilinear,
  type RegionGeometry,
} from './terrain';
import { DEFAULT_REGION_PARAMS, type RegionData } from './types';
import { drawTownPlans, PLAN_MAX_METRES_PER_PX } from './townPlan';
import type { CanonCache, TilePlace } from './deepTile';
import {
  TILE_PX, tileCountX, tileView, wrapTileX, type TileKey,
} from '../cartography/tiles';

/**
 * First level drawn from canon ground.
 *
 * The binding constraint is not cost per tile but CANON SUPERTILES PER SCREEN:
 * a supertile is 156 km of ground and the expensive thing in the engine. At z10
 * a screenful needs two to four of them; at z9, about six; at z8, two dozen —
 * which is why the ladder hands over here and not earlier, even though the
 * canon would happily draw z8.
 */
export const SAT_DEEP_Z = 9;

/**
 * Floor of the satellite pyramid.
 *
 * z18 is where one 256-px tile covers exactly ONE canon cell, which is the
 * last level whose tiles still land on lattice boundaries — the invariant the
 * whole scheme rests on. It works out at ~0,6 m per pixel: a roof is twenty
 * pixels across, which is the deepest Google Maps goes over a town.
 */
export const MAX_SAT_TILE_Z = 18;

/** Canon cells under one display tile at this level. Exact on every
 *  power-of-two world by construction; the guard below rejects the rest. */
export function canonCellsPerTile(world: WorldData, z: number): number {
  return (world.width * canonRefinement(world)) / tileCountX(z);
}

/** Output pixels per canon cell at a display level. */
export function satPxPerCanonCell(world: WorldData, z: number): number {
  return TILE_PX / canonCellsPerTile(world, z);
}

/** Deep satellite rendering needs the canon lattice to divide the display grid
 *  exactly — true for every power-of-two world up to the floor. */
export function satelliteDeepSupported(world: WorldData, z: number): boolean {
  if (z < SAT_DEEP_Z || z > MAX_SAT_TILE_Z) return false;
  return Number.isInteger(canonCellsPerTile(world, z));
}

/** The exact canon-lattice window under a display tile, with enough reach for
 *  the widest thing that can hang over the edge (a town's roofs, ~4 cells). */
export function satelliteTileSpec(world: WorldData, key: TileKey): CanonWindowSpec {
  const cells = Math.round(canonCellsPerTile(world, key.z));
  return {
    gx0: wrapTileX(key.z, key.tx) * cells,
    gy0: key.ty * cells,
    cw: cells,
    ch: cells,
    margin: 16,
  };
}

export interface SatelliteTileOptions {
  /** Carta-side layer flags, translated here. */
  layers: Record<string, boolean | undefined>;
  density: number;
  edits?: WorldEdit[];
}

export interface SatelliteTileResult {
  /** Canon supertiles generated for this tile (0 = fully warm). */
  generated: number;
  /** Named places whose ground lies INSIDE this tile — the main thread letters
   *  these live, because a label baked into a tile is pinned to the wrong
   *  pixels the moment the view moves. */
  places: TilePlace[];
}

// ---------------------------------------------------------------------------
// Shallow: the world raster
// ---------------------------------------------------------------------------

/**
 * A tile above the hand-over level.
 *
 * The old 2D drew these by magnifying the world raster, which is why every
 * level between a continent and a province was the same twenty-kilometre
 * porridge: one cell of source spread over a hundred pixels of screen. Here
 * the ground is AMPLIFIED instead — `buildElevation` invents sub-cell relief
 * from the same three noise fields the canon countryside is built on, at
 * whatever resolution this level needs.
 *
 * That single choice is what makes the ladder continuous. A coastline at 300 m
 * per pixel has real headlands and coves; a range has spurs and side valleys;
 * and when the reader crosses into the canon at z10 nothing jumps, because
 * both sides are the same fractal over the same world.
 *
 * `unshaded` is `renderBase(world, 'atlas', { shade: false })`. It is only
 * consulted at the top of the pyramid, where amplification has nothing to say
 * and the plain atlas is both correct and free.
 */
export function renderSatelliteShallowTile(
  world: WorldData,
  unshaded: Uint8ClampedArray,
  ctx: Ctx,
  key: TileKey,
  opts: { rivers?: boolean } = {},
): void {
  const view = tileView(world, key);
  const metresPerPx = (view.w * kmPerWorldCell(world) * 1000) / TILE_PX;

  // Above ~2,5 km per pixel every invented octave is smaller than a pixel: the
  // world's own field IS the picture, and the plain atlas window is the
  // cheapest correct way to draw it.
  if (metresPerPx > 2500) {
    const buf = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
    renderAtlasWindow(world, unshaded, buf, TILE_PX, TILE_PX, view);
    const img = ctx.createImageData(TILE_PX, TILE_PX);
    img.data.set(buf);
    ctx.putImageData(img, 0, 0);
    if (opts.rivers !== false) drawWorldRivers(world, ctx, view);
    return;
  }

  const perPx = view.w / TILE_PX; // world cells per output pixel
  // Two cells of skirt: all the shading pass needs are its neighbours.
  const SKIRT = 2;
  const g: RegionGeometry = {
    width: TILE_PX + SKIRT * 2,
    height: TILE_PX + SKIRT * 2,
    margin: SKIRT,
    metresPerCell: metresPerPx,
    originX: view.x - SKIRT * perPx,
    originY: view.y - SKIRT * perPx,
    worldPerCellX: perPx,
    worldPerCellY: perPx,
  };
  const patch = extractPatch(world, g);
  const elev = buildElevation(world, g, patch, DEFAULT_REGION_PARAMS);
  const GW = g.width;

  // WHERE THE COAST FALLS.
  //
  // Not by thresholding the amplified surface. `buildElevation` is only half a
  // landscape — the canon runs depression filling, drainage and a flood fill
  // from the ocean afterwards, and THAT is what turns invented relief into a
  // coastline. Thresholded raw it drowns whatever sits near sea level:
  // measured on one coastal plain the world puts at +5 m, 45 % of the tile
  // went under and a single row crossed the waterline 37 times. Low-passing it
  // only traded speckle for leopard spots — the fragmentation was never the
  // right SIZE, it was the wrong idea.
  //
  // So the world's own elevation decides, and the amplification is spent where
  // it cannot lie: DISPLACING the contour (the lookup is warped, so the coast
  // wanders instead of following the 39 km lattice) and shading the relief. A
  // warp moves a shoreline; it cannot invent an island in the middle of a
  // plain, which is exactly the property wanted here.
  //
  // The canon does know better, and says so from z9 down. That is the right
  // place for that knowledge to arrive.
  // World-lattice noise: coordinates here are already absolute world cells, so
  // these hash them directly. `world.width` is the wrap.
  const warp = makeLatticeHash(`${world.params.seed}::coast`);
  const grain = makeLatticeHash(`${world.params.seed}::shallowgrain`);
  // Fine grain on a lattice fixed in WORLD terms — 256 steps per world cell,
  // which lands at about 150 m, the canon's own resolution. Keying it to the
  // level's pixel grid instead would make the grain crawl as you zoom, and
  // folding it through the wrong wrap would tile a visible pattern every few
  // cells.
  const GRAIN_SUB = 256;
  const grainSub = makeLatticeHash(`${world.params.seed}::shallowfine`);
  const wrapW = (v: number) => ((v % world.width) + world.width) % world.width;
  // Coast and biome boundaries share one warp — they have to, or a wood would
  // end in the sea. A third of a WORLD cell, which is about twelve kilometres
  // of wander: enough for headlands and bays at continental scale, small
  // enough that the canon's own coastline lands in the same place.
  const coastWarp = 0.34;

  const img = ctx.createImageData(TILE_PX, TILE_PX);
  const out = img.data;
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gi = (py + SKIRT) * GW + (px + SKIRT);
      const dzdx = (elev[gi + 1] - elev[gi - 1]) * 500 / metresPerPx;
      const dzdy = (elev[gi + GW] - elev[gi - GW]) * 500 / metresPerPx;
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const dot = (-dzdx * LX + -dzdy * LY + LZ) / len;
      let shade = 0.62 + 0.55 * Math.max(0, dot);
      const o = (py * TILE_PX + px) * 4;

      const wx = g.originX + (px + SKIRT + 0.5) * perPx;
      const wy = g.originY + (py + SKIRT + 0.5) * perPx;
      const wxw = wx + latticeFbm(warp, wx, wy, 3, 1.3, 11, world.width) * coastWarp;
      const wyw = wy + latticeFbm(warp, wx, wy, 3, 1.3, 29, world.width) * coastWarp;
      const e = patchBilinear(patch, patch.elev, wxw, wyw);

      if (e <= 0) {
        const [r, gg, b] = oceanRgb(-e);
        const sh = 0.94 + 0.08 * shade;
        out[o] = r * sh; out[o + 1] = gg * sh; out[o + 2] = b * sh; out[o + 3] = 255;
        continue;
      }
      // Same dither as the deep ink: pick among the four surrounding world
      // cells by bilinear weight, so a biome boundary is a grained band and
      // not a 39 km square. Warped first, dithered second — the warp gives
      // the boundary its shape, the dither gives it its edge.
      const biome = ditherBiome(patch, wxw, wyw, warp, world.width);
      const tint = BIOME_COLORS[biome] ?? [116, 120, 105];
      // Ground grain, so a province of one biome is a living surface rather
      // than a flat fill of paint. Two scales: kilometres, and pixels.
      shade *= 1
        + latticeFbm(grain, wx, wy, 3, 2.2, 77, world.width) * 0.06
        + (grainSub(Math.floor(wrapW(wx) * GRAIN_SUB), Math.floor(wy * GRAIN_SUB), 91) - 0.5) * 0.035;
      out[o] = tint[0] * shade;
      out[o + 1] = tint[1] * shade;
      out[o + 2] = tint[2] * shade;
      out[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (opts.rivers !== false) drawWorldRivers(world, ctx, view);
}

/** Bilinear-weighted stochastic pick among the four world cells around a
 *  point. See `ditherIndex` in satelliteInk for why this beats nearest. */
function ditherBiome(
  patch: { x0: number; y0: number; w: number; h: number; biome: Uint8Array },
  wx: number, wy: number,
  hash: (x: number, y: number, k: number) => number,
  wrapX: number,
): number {
  const fx = wx - patch.x0 - 0.5, fy = wy - patch.y0 - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  // Smooth noise, not white — see `ditherIndex` in satelliteInk. Four cycles
  // per world cell puts the interleaving fingers at about ten kilometres,
  // which is a plausible size for one kind of country to give way to another.
  const px = (latticeFbm(hash, wx, wy, 2, 4, 811, wrapX) * 0.5 + 0.5) < tx ? 1 : 0;
  const py = (latticeFbm(hash, wx, wy, 2, 4, 853, wrapX) * 0.5 + 0.5) < ty ? 1 : 0;
  const ix = Math.min(patch.w - 1, Math.max(0, x0 + px));
  const iy = Math.min(patch.h - 1, Math.max(0, y0 + py));
  return patch.biome[iy * patch.w + ix];
}

/**
 * World rivers as polylines.
 *
 * The atlas layer stamps one cell per river cell, which is why a river at any
 * magnification reads as a staircase of twenty-kilometre blocks — the single
 * ugliest thing in the old 2D view. A river is a LINE; drawn as one it stays a
 * river at every level, and it costs less.
 */
export function drawWorldRivers(
  world: WorldData, ctx: Ctx, view: { x: number; y: number; w: number; h: number },
  outPx: number = TILE_PX,
  /** Take the wrapped branch nearest the window. Correct for a tile, WRONG for
   *  a raster that already covers the whole cylinder — there x is where it is,
   *  and re-branching it would push every eastern river off the left edge. */
  wrap = true,
): void {
  const W = world.width;
  const s = outPx / view.w;
  const kmPerPx = (view.w * kmPerWorldCell(world)) / outPx;
  const painted = world.painted?.rivers;
  const gone = world.painted?.removed;
  const generated = gone?.size
    ? world.rivers.filter((r) => !gone.has(riverKey(r.cells)))
    : world.rivers;
  const all = painted?.length ? [...generated, ...painted] : generated;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#4f93b8';
  for (const river of all) {
    const cells = river.cells;
    const n = cells.length;
    if (n < 2) continue;
    // EL ANCHO DE UN RÍO ES UNA ANCHURA EN EL SUELO.
    //
    // Estaba en CELDAS DE MUNDO multiplicadas por la escala de salida, lo cual
    // parece físico y no lo es: la escala depende de cuánto suelo cubre el
    // ráster, así que el mismo río salía de seis píxeles en una textura ancha y
    // de treinta y siete en una estrecha — cuarenta kilómetros de ancho. Y como
    // el 3D cambia de ventana con la distancia de la cámara, el río cambiaba de
    // grosor y de forma al acercarse: «los ríos se desplazan en función de la
    // distancia de la cámara». (Un río de 0,35 celdas en un mundo de 1024 son
    // catorce kilómetros ya de entrada; el error venía de lejos.)
    //
    // Un río grande tiene un par de kilómetros de cauce y un arroyo unos
    // metros. Eso es lo que se dibuja, y donde eso caiga por debajo de un
    // píxel se dibuja un pelo, que es lo único honrado a esa distancia.
    const widthKm = 0.12 + 2.1 * river.flow;
    // UN RÍO NO TIENE CODOS.
    //
    // El cauce viene como una lista de CELDAS DE MUNDO, o sea un vértice cada
    // veinte kilómetros, y unirlos con rectas se ve exactamente como lo que es
    // en cuanto un píxel baja del kilómetro: una polilínea con esquinas, que es
    // el aspecto de «hecho con celdas» que todo lo demás ya no tiene. La curva
    // cuadrática por los puntos medios pasa suave por cada celda sin inventar
    // recorrido: el río sigue estando donde el generador lo puso, y deja de
    // doblar en ángulo.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      let x = c % W;
      const y = (c / W) | 0;
      if (wrap) {
        // Take the branch of the cylinder nearest this tile.
        while (x - view.x > W / 2) x -= W;
        while (x - view.x < -W / 2) x += W;
      }
      xs.push((x + 0.5 - view.x) * s);
      ys.push((y + 0.5 - view.y) * s);
    }
    ctx.beginPath();
    let started = false;
    for (let k = 0; k < n; k++) {
      // Un salto imposible es la costura: se levanta el lápiz.
      if (started && Math.abs(xs[k] - xs[k - 1]) > outPx * 4) started = false;
      if (!started) { ctx.moveTo(xs[k], ys[k]); started = true; continue; }
      const last = k === n - 1 || Math.abs(xs[k + 1] - xs[k]) > outPx * 4;
      if (last) ctx.lineTo(xs[k], ys[k]);
      else ctx.quadraticCurveTo(xs[k], ys[k], (xs[k] + xs[k + 1]) / 2, (ys[k] + ys[k + 1]) / 2);
    }
    // EL SUELO EN PÍXELES, no en metros: un mínimo LEGIBLE.
    //
    // El ancho físico es correcto y por sí solo da un pelo de nueve décimas de
    // píxel en casi todos los niveles — y como el bloque se redibuja más fino
    // al acercarse, ese pelo mide lo mismo en pantalla por mucho que te
    // aproximes: «los ríos se vuelven demasiado finos». Un río que existe se
    // dibuja con grosor suficiente para leerse; a partir de ahí manda la
    // anchura de verdad, y de cerca un río grande sí engorda.
    ctx.lineWidth = Math.max(1.5, widthKm / kmPerPx);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Deep: the canon countryside
// ---------------------------------------------------------------------------

function canonBytes(r: RegionData): number {
  return r.elevation.byteLength + r.water.byteLength + r.flow.byteLength
    + r.slope.byteLength + r.wet.byteLength + r.biome.byteLength
    + r.cover.byteLength + 4096;
}

/**
 * Render one deep satellite tile: generate (or reuse) the canon supertiles
 * under it, compose the exact window, and ink it photographically.
 */
export function renderSatelliteDeepTile(
  world: WorldData,
  geography: HumanGeography,
  cache: CanonCache,
  ctx: Ctx,
  key: TileKey,
  opts: SatelliteTileOptions,
  limits: { cap: number; bytes: number },
): SatelliteTileResult {
  const spec = satelliteTileSpec(world, key);
  const cover = canonWindowCover(world, spec);
  let generated = 0;
  const placed: { id: TileId; data: RegionData }[] = [];
  for (const id of cover) {
    const k = canonTileKey(id);
    let data = cache.map.get(k);
    if (!data) {
      data = generateCanonTile(world, geography, id, { edits: opts.edits });
      generated++;
      cache.map.set(k, data);
      cache.order.push(k);
      cache.bytes += canonBytes(data);
      while ((cache.order.length > limits.cap || cache.bytes > limits.bytes)
        && cache.order.length > 1) {
        const evict = cache.order.shift();
        if (!evict) break;
        const dead = cache.map.get(evict);
        if (dead) cache.bytes -= canonBytes(dead);
        cache.map.delete(evict);
      }
    } else {
      const at = cache.order.indexOf(k);
      if (at >= 0) cache.order.splice(at, 1);
      cache.order.push(k);
    }
    placed.push({ id, data });
  }

  const region = composeCanonWindow(world, placed, spec);
  const m = region.margin;
  const places: TilePlace[] = [];
  for (const p of region.places) {
    if (p.x < m || p.x >= m + spec.cw || p.y < m || p.y >= m + spec.ch) continue;
    if (!p.name) continue;
    places.push({
      worldX: p.worldX, worldY: p.worldY,
      name: p.name, kind: p.kind, importance: p.importance,
    });
  }

  const L = opts.layers;
  const pxPerCell = satPxPerCanonCell(world, key.z);
  renderSatellite(region, ctx, {
    width: TILE_PX,
    height: TILE_PX,
    pxPerCell,
    ink: {
      seed: `${world.params.seed}::sat`,
      gx0: spec.gx0 - spec.margin,
      gy0: spec.gy0 - spec.margin,
      wrapX: world.width * canonRefinement(world),
    },
    tracks: L.roads !== false,
    hedges: L.fields !== false,
    buildings: true,
    density: opts.density,
    skipTownRoofs: (region.metresPerCell / pxPerCell) <= PLAN_MAX_METRES_PER_PX,
  });

  // The towns, drawn as the plans they actually are. Above the plan's ground
  // resolution this does nothing, so every level above street range is
  // unaffected — and the roof scatter in the ink pass covers those.
  drawTownPlans(world, geography, ctx, {
    originWorldX: (spec.gx0) * (1 / canonRefinement(world)),
    originWorldY: (spec.gy0) * (1 / canonRefinement(world)),
    widthPx: TILE_PX,
    heightPx: TILE_PX,
    metresPerPx: region.metresPerCell / pxPerCell,
    metresPerWorldCell: region.metresPerCell * canonRefinement(world),
  });

  return { generated, places };
}
