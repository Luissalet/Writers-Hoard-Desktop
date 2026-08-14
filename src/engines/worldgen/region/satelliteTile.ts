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

import { Biome, type WorldData } from '../core/types';
import type { WorldEdit } from '../core/edits';
import type { HumanGeography } from '../core/settlements';
import type { Ctx } from '../cartography/symbols';
import { renderAtlasWindow, BIOME_COLORS } from '../core/render';
import { riverKey } from '../core/edits';
import { canonRefinement } from './tiles';
import { canonWindowCover, composeCanonWindow, type CanonWindowSpec } from './composeWindow';
import {
  renderSatellite, oceanRgb, makeLatticeHash, latticeFbm, LX, LY, LZ,
} from './satelliteInk';
import {
  buildElevation, extractPatch, kmPerWorldCell,
  type RegionGeometry,
} from './terrain';
import { createWorldCoastField } from './coastField';
import { worldRiverMinimumPixels, worldRiverWidthMetres } from './riverScale';
import { DEFAULT_REGION_PARAMS, type RegionData } from './types';
import { drawTownPlans, PLAN_MAX_METRES_PER_PX } from './townPlan';
import { canonCoverFor, type CanonCache, type TilePlace } from './deepTile';
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
  /** Install fresh supertiles as their stored (quantised) selves — set by the
   *  worker core whenever the client persists canon. */
  quantizeCanon?: boolean;
}

export interface SatelliteTileResult {
  /** Canon supertiles generated for this tile (0 = fully warm). */
  generated: number;
  /** The freshly generated supertiles, for the worker core to persist. */
  built: { key: string; data: RegionData }[];
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
  const boundary = createWorldCoastField(world, patch);
  const grain = makeLatticeHash(`${world.params.seed}::shallowgrain`);
  // Fine grain on a lattice fixed in WORLD terms — 256 steps per world cell,
  // which lands at about 150 m, the canon's own resolution. Keying it to the
  // level's pixel grid instead would make the grain crawl as you zoom, and
  // folding it through the wrong wrap would tile a visible pattern every few
  // cells.
  const GRAIN_SUB = 256;
  const grainSub = makeLatticeHash(`${world.params.seed}::shallowfine`);
  const wrapW = (v: number) => ((v % world.width) + world.width) % world.width;
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
      const coast = boundary.sample(wx, wy);
      const wxw = coast.x, wyw = coast.y, e = coast.elevation;

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
      const biome = ditherBiome(patch, wxw, wyw, boundary.hash, world.width);
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
  const picked = patch.biome[iy * patch.w + ix];
  if (picked !== Biome.Ocean && picked !== Biome.Lake) return picked;

  // The coast field above has already decided that this pixel is land. A
  // stochastic colour lookup may choose an ocean corner of the world raster,
  // but it must not paint that dry pixel blue — visually that manufactures a
  // second, grid-shifted coastline. Pick the strongest dry corner instead.
  const candidates = [
    { x: x0, y: y0, w: (1 - tx) * (1 - ty) },
    { x: x0 + 1, y: y0, w: tx * (1 - ty) },
    { x: x0, y: y0 + 1, w: (1 - tx) * ty },
    { x: x0 + 1, y: y0 + 1, w: tx * ty },
  ].sort((a, b) => b.w - a.w);
  for (const c of candidates) {
    const cx = Math.min(patch.w - 1, Math.max(0, c.x));
    const cy = Math.min(patch.h - 1, Math.max(0, c.y));
    const biome = patch.biome[cy * patch.w + cx];
    if (biome !== Biome.Ocean && biome !== Biome.Lake) return biome;
  }
  return Biome.Beach;
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

  const metresPerCell = kmPerWorldCell(world) * 1000;
  const outH = view.h * s;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const river of all) {
    const cells = river.cells;
    const n = cells.length;
    if (n < 2) continue;
    const key = riverKey(cells);
    const seed = hashRiverKey(key);
    const runs: RiverGroundPoint[][] = [];
    let run: RiverGroundPoint[] = [];
    let carriedFlow = 0;
    let distanceM = 0;
    let prevRawX = 0;
    let prevGroundX = 0;
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      const rawX = c % W;
      const y = (c / W) | 0;
      const seam = k > 0 && riverCrossesWorldSeam(prevRawX, rawX, W);
      let x = rawX;
      if (wrap && k > 0) {
        while (x - prevGroundX > W / 2) x -= W;
        while (x - prevGroundX < -W / 2) x += W;
      } else if (!wrap && seam) {
        if (run.length >= 2) runs.push(run);
        run = [];
      }
      if (k > 0) {
        let dx = rawX - prevRawX;
        if (dx > W / 2) dx -= W;
        if (dx < -W / 2) dx += W;
        const py = ((cells[k - 1] / W) | 0);
        distanceM += Math.hypot(dx, y - py) * metresPerCell;
      }
      const sampledFlow = world.flow[c] ?? 0;
      if (sampledFlow > 0) carriedFlow = Math.max(carriedFlow, sampledFlow);
      // Hand-painted rivers have no global accumulation raster. Give them the
      // same source→mouth growth instead of painting the mouth width upstream.
      const fallbackFlow = river.flow * (0.35 + 0.65 * (k / Math.max(1, n - 1)));
      run.push({ x: x + 0.5, y: y + 0.5, flow: Math.max(carriedFlow, fallbackFlow), distanceM });
      prevRawX = rawX;
      prevGroundX = x;
    }
    if (run.length >= 2) runs.push(run);

    for (const sourceRun of runs) {
      let shift = 0;
      if (wrap) {
        const middle = (sourceRun[0].x + sourceRun[sourceRun.length - 1].x) * 0.5;
        shift = Math.round((view.x + view.w * 0.5 - middle) / W) * W;
      }
      const shifted = shift === 0
        ? sourceRun
        : sourceRun.map((p) => ({ ...p, x: p.x + shift }));
      const visibleRuns = sampleVisibleRiverRuns(
        shifted, view, s, outPx, outH, kmPerPx,
      );
      for (const sample of visibleRuns) drawRiverSample(ctx, sample, seed);
    }
  }
  ctx.restore();
}

interface RiverGroundPoint { x: number; y: number; flow: number; distanceM: number }
interface RiverScreenPoint extends RiverGroundPoint {
  sx: number; sy: number; nx: number; ny: number; halfPx: number;
}

/** A discontinuity is a fact of source longitude, never of viewport pixels. */
export function riverCrossesWorldSeam(a: number, b: number, worldWidth: number): boolean {
  return Math.abs(a - b) > worldWidth / 2;
}

function hashRiverKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stable ground-space bank modulation. It is independent of pixels and zoom. */
export function riverBankFactor(distanceM: number, seed: number, side: -1 | 1): number {
  const p = ((seed >>> (side > 0 ? 0 : 11)) & 2047) / 2047 * Math.PI * 2;
  const broad = Math.sin(distanceM / 620 + p) * 0.13;
  const fine = Math.sin(distanceM / 175 + p * 1.73 + side * 0.9) * 0.065;
  return 1 + broad + fine;
}

function catmullPoint(
  p0: RiverGroundPoint, p1: RiverGroundPoint, p2: RiverGroundPoint, p3: RiverGroundPoint, t: number,
): { x: number; y: number } {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t
      + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
      + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t
      + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
      + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function sampleVisibleRiverRuns(
  pts: RiverGroundPoint[], view: { x: number; y: number; w: number; h: number },
  scale: number, outW: number, outH: number, kmPerPx: number,
): RiverScreenPoint[][] {
  const runs: RiverScreenPoint[][] = [];
  let current: RiverScreenPoint[] = [];
  const spacingM = Math.max(80, kmPerPx * 1000 * 1.8);
  const flush = () => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const pad = worldRiverWidthMetres(Math.max(a.flow, b.flow)) / (kmPerPx * 1000) + 4;
    const ax = (a.x - view.x) * scale, ay = (a.y - view.y) * scale;
    const bx = (b.x - view.x) * scale, by = (b.y - view.y) * scale;
    if (Math.max(ax, bx) < -pad || Math.min(ax, bx) > outW + pad
      || Math.max(ay, by) < -pad || Math.min(ay, by) > outH + pad) {
      flush();
      continue;
    }
    const p0 = pts[Math.max(0, i - 1)], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const segmentM = Math.max(1, b.distanceM - a.distanceM);
    const steps = Math.max(2, Math.min(256, Math.ceil(segmentM / spacingM)));
    for (let q = 0; q < steps; q++) {
      if (current.length && q === 0) continue;
      const t = q / steps;
      const p = catmullPoint(p0, a, b, p3, t);
      const before = catmullPoint(p0, a, b, p3, Math.max(0, t - 0.01));
      const after = catmullPoint(p0, a, b, p3, Math.min(1, t + 0.01));
      const dx = after.x - before.x, dy = after.y - before.y;
      const len = Math.hypot(dx, dy) || 1;
      const flow = a.flow + (b.flow - a.flow) * t;
      current.push({
        x: p.x, y: p.y, flow,
        distanceM: a.distanceM + segmentM * t,
        sx: (p.x - view.x) * scale,
        sy: (p.y - view.y) * scale,
        nx: -dy / len, ny: dx / len,
        halfPx: worldRiverWidthMetres(flow) / (kmPerPx * 1000) * 0.5,
      });
    }
    if (i === pts.length - 2) {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      current.push({
        ...b, sx: (b.x - view.x) * scale, sy: (b.y - view.y) * scale,
        nx: -dy / len, ny: dx / len,
        halfPx: worldRiverWidthMetres(b.flow) / (kmPerPx * 1000) * 0.5,
      });
    }
  }
  flush();
  return runs;
}

function drawRiverSample(ctx: Ctx, pts: RiverScreenPoint[], seed: number): void {
  let maxFlow = 0, maxPhysicalPx = 0;
  for (const p of pts) {
    maxFlow = Math.max(maxFlow, p.flow);
    maxPhysicalPx = Math.max(maxPhysicalPx, p.halfPx * 2);
  }
  // At overview scale the bank polygon is sub-pixel. A class-dependent
  // cartographic hairline keeps hierarchy without inflating physical width.
  if (maxPhysicalPx < 4) {
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
    ctx.strokeStyle = '#4f93b8';
    ctx.lineWidth = Math.max(maxPhysicalPx, worldRiverMinimumPixels(maxFlow));
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const r = p.halfPx * riverBankFactor(p.distanceM, seed, 1);
    const x = p.sx + p.nx * r, y = p.sy + p.ny * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    const r = p.halfPx * riverBankFactor(p.distanceM, seed, -1);
    ctx.lineTo(p.sx - p.nx * r, p.sy - p.ny * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#4f93b8';
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Deep: the canon countryside
// ---------------------------------------------------------------------------

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
  const built: { key: string; data: RegionData }[] = [];
  const placed = canonCoverFor(world, geography, cache, cover, opts.edits, limits, built, opts.quantizeCanon);

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
    worldTrunks: L.rivers !== false,
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

  return { generated: built.length, built, places };
}
