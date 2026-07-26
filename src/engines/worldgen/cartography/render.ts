// ============================================
// Cartography — Map renderer
// ============================================
// Draws a WorldData as a hand-drawn fantasy map. Two stages:
//
//   1. one raster pass  — paper grain, sea depth ramp, concentric coast rings,
//                         land tone, biome washes, relief shading, snow
//   2. vector ink       — coastline, lakes, rivers, relief and forest symbols,
//                         roads, settlements, labels, furniture
//
// Doing stage 1 as a single pixel loop rather than a stack of canvas
// operations is what keeps a 4096px export in the low seconds instead of the
// low minutes, and it is the only way to get the coast rings to respect real
// geodesic distance instead of a blurred alpha mask.

import { riverKey } from '../core/edits';
import { Biome, type WorldData } from '../core/types';
import { createRng, type Rng } from '../core/rng';
import { blur, distanceTo, labelLandmasses, localRelief, ridgeMask, scatterByScore, traceRidgeChains } from './fields';
import { chaikin, marchingSquares, resample, simplify, wobble, type Contour, type Pt } from './contours';
import { renderPaper } from './paper';
import { drawBroadleaf, drawCactus, drawConifer, drawDune, drawMarsh, drawMountain, drawPalm, type Ctx } from './symbols';
import type { CartoTheme } from './theme';
import { drawOverlay } from './overlay';
import { drawFurniture } from './furniture';
import type { HumanGeography } from '../core/settlements';

export interface CartoView {
  /** Top-left of the source rect in world cells. */
  x: number;
  y: number;
  /** Size of the source rect in world cells. */
  w: number;
  h: number;
}

export interface CartoLayers {
  relief: boolean;
  forests: boolean;
  rivers: boolean;
  coastRings: boolean;
  shading: boolean;
  biomeTint: boolean;
  labels: boolean;
  settlements: boolean;
  roads: boolean;
  borders: boolean;
  graticule: boolean;
  frame: boolean;
  compass: boolean;
  scaleBar: boolean;
}

export const DEFAULT_LAYERS: CartoLayers = {
  relief: true,
  forests: true,
  rivers: true,
  coastRings: true,
  shading: true,
  biomeTint: true,
  labels: true,
  settlements: true,
  roads: true,
  borders: false,
  graticule: false,
  frame: true,
  compass: true,
  scaleBar: true,
};

export interface CartoOptions {
  theme: CartoTheme;
  /** Output size in pixels. */
  width: number;
  height: number;
  /** Source rect; defaults to the whole world. */
  view?: CartoView;
  layers?: Partial<CartoLayers>;
  /** Multiplies symbol counts. 1 = balanced, 1.6 = dense, 0.6 = sparse. */
  density?: number;
  /** How much of the land earns relief symbols. 1 = top 30% hills / top 10%
   *  mountains; 0.5 halves both bands, 2 doubles them. */
  reliefAmount?: number;
  /** Extra seed salt so a redraw can be reshuffled deliberately. */
  seed?: string;
  /** Human geography (settlements, roads, realms, named features). Omit to
   *  render an uninhabited world. */
  geography?: HumanGeography;
  /** Title shown in the cartouche. */
  title?: string;
  subtitle?: string;
  /** Scales all lettering. */
  typeScale?: number;
  /** Creates an offscreen drawing surface (needed for the paper composite).
   *  Defaults to OffscreenCanvas / document.createElement in the browser. */
  createSurface?: (w: number, h: number) => { ctx: Ctx; canvas: unknown };
  /**
   * Draws the raster base and returns something `drawImage` accepts, replacing
   * the CPU pixel loop.
   *
   * This is the seam the GPU path goes through. Keeping it as an injected
   * function rather than an import means the renderer stays a pure function of
   * its inputs, still runs under node in the harness, and falls back to the CPU
   * automatically wherever WebGL is missing.
   */
  drawBase?: (w: number, h: number, view: CartoView) => CanvasImageSource | null;
  /**
   * Collects symbol placements instead of drawing them, so a GPU pass can issue
   * all of them in one instanced call. When present, the canvas2D symbol drawing
   * is skipped entirely and `drawSymbols` composites the result.
   */
  emitSymbol?: (s: EmittedSymbol) => void;
  drawSymbols?: (w: number, h: number) => CanvasImageSource | null;
}

// ---------------------------------------------------------------------------
// Derived-field cache
// ---------------------------------------------------------------------------

export interface CartoFields {
  land: Uint8Array;
  /** Distance in cells from every sea cell to the nearest land cell. */
  seaDist: Float32Array;
  /** Distance in cells from every land cell to the nearest sea cell. */
  landDist: Float32Array;
  relief: Float32Array;
  ridges: Uint8Array;
  landmass: Int32Array;
  /** Relief value at a given quantile of LAND cells. The mountain/hill split
   *  has to be relative: an absolute threshold either buries a rugged world in
   *  symbols or leaves a gentle one bare. */
  reliefQuantile: (q: number) => number;
}

// Every cache below is keyed on the world object AND its revision. Keying on the
// object alone meant that painting a stroke left the old coastline, the old biome
// washes and the old symbol layout in place — the edit was in the data and
// invisible on the map.
const FIELD_CACHE = new WeakMap<WorldData, { rev: number; fields: CartoFields }>();

export function computeFields(world: WorldData): CartoFields {
  const rev = world.revision ?? 0;
  const cached = FIELD_CACHE.get(world);
  if (cached && cached.rev === rev) return cached.fields;
  const { width: W, height: H, elevation } = world;
  const land = new Uint8Array(W * H);
  const sea = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] > 0) land[i] = 1;
    else sea[i] = 1;
  }
  const seaDist = distanceTo(land, W, H);
  const landDist = distanceTo(sea, W, H);
  // Relief radius is tied to the grid so the mountain/plateau split behaves the
  // same at every resolution.
  const relief = localRelief(elevation, W, H, Math.max(4, Math.round(W / 90)));

  // Sorted sample of land relief for quantile lookups. Sampling every 7th cell
  // keeps this ~O(landCells/7 · log) and the quantiles are indistinguishable
  // from the exact ones at map scale.
  const sample: number[] = [];
  for (let i = 0; i < W * H; i += 7) if (elevation[i] > 0) sample.push(relief[i]);
  sample.sort((a, b) => a - b);
  const reliefQuantile = (q: number) =>
    sample.length ? sample[Math.min(sample.length - 1, Math.max(0, Math.round(q * (sample.length - 1))))] : 0;

  const ridges = ridgeMask(elevation, relief, W, H, Math.max(0.02, reliefQuantile(0.6)));
  const { label } = labelLandmasses(elevation, W, H);
  const fields: CartoFields = { land, seaDist, landDist, relief, ridges, landmass: label, reliefQuantile };
  FIELD_CACHE.set(world, { rev, fields });
  return fields;
}

interface TintField { r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array }
const TINT_CACHE = new WeakMap<WorldData, { rev: number; map: Map<string, TintField> }>();

export function getTintFieldFor(world: WorldData, theme: CartoTheme): TintField {
  return getTintField(world, theme);
}

function getTintField(world: WorldData, theme: CartoTheme): TintField {
  const rev = world.revision ?? 0;
  let entry = TINT_CACHE.get(world);
  if (!entry || entry.rev !== rev) TINT_CACHE.set(world, (entry = { rev, map: new Map() }));
  const perTheme = entry.map;
  const hit = perTheme.get(theme.id);
  if (hit) return hit;

  const { width: W, height: H, biome, elevation } = world;
  const lut = new Map<number, [number, number, number]>();
  for (const [k, v] of Object.entries(theme.land.tints)) if (v) lut.set(Number(k), hexToRgb(v));

  const r = new Float32Array(W * H), g = new Float32Array(W * H);
  const b = new Float32Array(W * H), a = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] <= 0) continue;
    const c = lut.get(biome[i]);
    if (!c) continue;
    r[i] = c[0]; g[i] = c[1]; b[i] = c[2]; a[i] = 1;
  }
  // Premultiply so blurring across a biome edge cannot drag black in from the
  // untinted cells, then un-premultiply on read.
  const R = Math.max(2, Math.round(W / 420));
  const br = blur(r, W, H, R, 2), bg = blur(g, W, H, R, 2), bb = blur(b, W, H, R, 2), ba = blur(a, W, H, R, 2);
  for (let i = 0; i < W * H; i++) {
    const w = ba[i] || 1e-6;
    br[i] /= w; bg[i] /= w; bb[i] /= w;
  }
  const field: TintField = { r: br, g: bg, b: bb, a: ba };
  perTheme.set(theme.id, field);
  return field;
}

/**
 * Paper cache. The sheet depends on the seed, the theme and the output size —
 * NOT on the view. Regenerating it per pan was 76% of every redraw, which is
 * what made panning feel like the renderer had died.
 *
 * A tiny LRU rather than a WeakMap: the key is a string, and two entries is
 * enough to survive a theme toggle without holding several megabytes each.
 */
interface PaperEntry { key: string; px: Uint8ClampedArray }
const PAPER_LRU: PaperEntry[] = [];
const PAPER_LRU_MAX = 3;

function getPaper(seed: string, theme: CartoTheme, W: number, H: number): Uint8ClampedArray {
  const key = `${seed}|${theme.id}|${W}x${H}`;
  const hit = PAPER_LRU.findIndex((e) => e.key === key);
  if (hit >= 0) {
    const [entry] = PAPER_LRU.splice(hit, 1);
    PAPER_LRU.unshift(entry);
    return entry.px;
  }
  const px = renderPaper({ width: W, height: H, seed, theme });
  PAPER_LRU.unshift({ key, px });
  if (PAPER_LRU.length > PAPER_LRU_MAX) PAPER_LRU.length = PAPER_LRU_MAX;
  return px;
}

/**
 * Symbol placement cache.
 *
 * Placement runs a greedy blue-noise rejection over the whole world grid, which
 * costs the same regardless of how much of the world is on screen. It used to
 * also REJECT out-of-view candidates inside that greedy pass — which not only
 * made it impossible to cache, it made the layout depend on where the reader was
 * looking: pan, and the surviving symbols reshuffled. Placement is now global
 * and view-independent, cached per zoom bucket, and the view filter happens at
 * draw time where it belongs.
 */
export interface SymbolPlacement { x: number; y: number; score: number; isHill: boolean }
interface PlacementEntry { key: string; items: SymbolPlacement[] }
const PLACE_CACHE = new WeakMap<WorldData, { rev: number; list: PlacementEntry[] }>();
const PLACE_MAX = 8;

/** Quarter-octave zoom buckets: panning never changes the bucket, and zooming
 *  reuses a placement across a 19% span of scale. Symbol SIZE still tracks the
 *  live scale continuously, so nothing pops. */
function scaleBucket(scale: number): number {
  return Math.pow(2, Math.round(Math.log2(Math.max(1e-3, scale)) * 4) / 4);
}

function cachedPlacement(
  world: WorldData,
  key: string,
  compute: (bucketScale: number) => SymbolPlacement[],
  scale: number,
): SymbolPlacement[] {
  const rev = world.revision ?? 0;
  let entry = PLACE_CACHE.get(world);
  if (!entry || entry.rev !== rev) PLACE_CACHE.set(world, (entry = { rev, list: [] }));
  const list = entry.list;
  const bs = scaleBucket(scale);
  const full = `${key}|${bs.toFixed(4)}`;
  const hit = list.findIndex((e) => e.key === full);
  if (hit >= 0) {
    const [entry] = list.splice(hit, 1);
    list.unshift(entry);
    return entry.items;
  }
  const items = compute(bs);
  list.unshift({ key: full, items });
  if (list.length > PLACE_MAX) list.length = PLACE_MAX;
  return items;
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function hexToRgb(c: string): [number, number, number] {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbCss(r: number, g: number, b: number): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** A symbol placement in OUTPUT PIXELS, anchored at its feet. */
export interface EmittedSymbol {
  kind: 'mountain' | 'hill' | 'conifer' | 'broadleaf' | 'palm' | 'cactus' | 'dune' | 'marsh';
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0–1 selector for the pre-rendered variant. */
  variant: number;
  snow: number;
}

export interface CartoResult {
  /** Screen transform actually used, for callers that need to place overlays. */
  view: CartoView;
  scale: number;
  symbolCount: number;
}

export function renderCartography(world: WorldData, ctx: Ctx, opts: CartoOptions): CartoResult {
  const theme = opts.theme;
  const L: CartoLayers = { ...DEFAULT_LAYERS, ...(opts.layers ?? {}) };
  const view: CartoView = opts.view ?? { x: 0, y: 0, w: world.width, h: world.height };
  const OW = opts.width, OH = opts.height;
  const scale = OW / view.w;
  const density = opts.density ?? 1;
  const reliefAmount = opts.reliefAmount ?? 1;
  const seed = `${world.params.seed}::carto::${opts.seed ?? ''}`;
  const fields = computeFields(world);

  const toScreenX = (wx: number) => (wx - view.x) * scale;
  const toScreenY = (wy: number) => (wy - view.y) * scale;

  // ---- stage 1: the raster base ------------------------------------------
  const gpu = opts.drawBase?.(OW, OH, view) ?? null;
  if (gpu) {
    ctx.drawImage(gpu as unknown as CanvasImageSource, 0, 0, OW, OH);
  } else {
    const base = renderBaseRaster(world, fields, opts, view, scale, L);
    const img = ctx.createImageData(OW, OH);
    img.data.set(base);
    ctx.putImageData(img, 0, 0);
  }

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ---- stage 2: ink -------------------------------------------------------
  const rng = createRng(seed, 'ink');

  // Coastline. Extract in world space so the seam and sub-cell accuracy are
  // both handled, then project.
  const coast = extractCoastlines(world, view);
  drawCoastlines(ctx, coast, theme, rng, scale, world.width, view, toScreenX, toScreenY);

  if (L.rivers) drawRivers(ctx, world, theme, view, scale, toScreenX, toScreenY);
  drawLakes(ctx, world, theme, view, rng, scale, toScreenX, toScreenY);

  let symbolCount = 0;
  const emit = opts.emitSymbol;
  if (L.forests) symbolCount += drawForests(ctx, world, fields, theme, view, scale, density, seed, toScreenX, toScreenY, emit);
  if (L.relief) symbolCount += drawRelief(ctx, world, fields, theme, view, scale, density, reliefAmount, seed, toScreenX, toScreenY, emit);
  if (emit && opts.drawSymbols) {
    // Composited HERE, between the ink and the culture layer, which is exactly
    // where the canvas2D symbols used to land in the painter's order.
    const layer = opts.drawSymbols(OW, OH);
    if (layer) ctx.drawImage(layer as unknown as CanvasImageSource, 0, 0, OW, OH);
  }

  // ---- stage 3: culture layer, lettering and furniture --------------------
  if (opts.geography) {
    drawOverlay(ctx, world, opts.geography, {
      theme,
      view,
      scale,
      width: OW,
      height: OH,
      worldWidth: world.width,
      layers: { roads: L.roads, borders: L.borders, settlements: L.settlements, labels: L.labels },
      typeScale: opts.typeScale,
    });
  }

  drawFurniture(
    ctx,
    {
      theme, width: OW, height: OH, view, scale,
      worldWidth: world.width,
      title: opts.title,
      subtitle: opts.subtitle,
      seed,
    },
    { frame: L.frame, compass: L.compass, scaleBar: L.scaleBar, graticule: L.graticule },
  );

  ctx.restore();
  return { view, scale, symbolCount };
}

// ---------------------------------------------------------------------------
// Stage 1 — raster
// ---------------------------------------------------------------------------

function renderBaseRaster(
  world: WorldData,
  fields: CartoFields,
  opts: CartoOptions,
  view: CartoView,
  scale: number,
  L: CartoLayers,
): Uint8ClampedArray {
  const theme = opts.theme;
  const OW = opts.width, OH = opts.height;
  const { width: W, height: H, elevation, temperature, lake } = world;

  const paper = getPaper(`${world.params.seed}::paper`, theme, OW, OH);

  const out = new Uint8ClampedArray(OW * OH * 4);
  const shallow = hexToRgb(theme.ocean.shallow);
  const deep = hexToRgb(theme.ocean.deep);
  const landBase = hexToRgb(theme.land.base);
  const shadeC = hexToRgb(theme.land.shadeColor);
  const snowC = hexToRgb(theme.land.snow);
  const ringC = hexToRgb(theme.ocean.rings.color);
  const paperBase = hexToRgb(theme.paper.base);
  const paperLum = paperBase[0] * 0.3 + paperBase[1] * 0.5 + paperBase[2] * 0.2;

  // Biome tints are sampled per cell, so painting them straight from the biome
  // id gives visible stair-steps at any zoom past 1:1. Rasterise the palette
  // into three float channels, blur them slightly and sample bilinearly — the
  // washes then bleed into each other the way a wet brush does.
  const tint = getTintField(world, theme);

  const ring = theme.ocean.rings;
  const wrapX = (x: number) => ((x % W) + W) % W;

  for (let py = 0; py < OH; py++) {
    const wy = view.y + (py + 0.5) / scale;
    const yc = Math.min(H - 1, Math.max(0, Math.floor(wy)));
    for (let px = 0; px < OW; px++) {
      const wx = view.x + (px + 0.5) / scale;
      const xc = wrapX(Math.floor(wx));
      const ci = yc * W + xc;
      const o = (py * OW + px) * 4;

      // Paper modulation: keeps grain visible under everything.
      const pl = paper[o] * 0.3 + paper[o + 1] * 0.5 + paper[o + 2] * 0.2;
      const mod = pl / (paperLum || 1);

      // One set of bilinear weights, reused for every field sampled at this
      // pixel. Six independent sampleField() calls meant six times the index
      // arithmetic and six times the wrap handling for identical coordinates.
      const fx = wx - 0.5, fy = wy - 0.5;
      const ix = Math.floor(fx);
      const iy0 = Math.min(H - 1, Math.max(0, Math.floor(fy)));
      const tx = fx - ix, ty = fy - iy0;
      const iy1 = Math.min(H - 1, iy0 + 1);
      const ia = wrapX(ix), ib = wrapX(ix + 1);
      const o00 = iy0 * W + ia, o10 = iy0 * W + ib, o01 = iy1 * W + ia, o11 = iy1 * W + ib;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      // Written out rather than wrapped in a helper: a closure allocated per
      // pixel is not something the JIT will optimise away, and measuring showed
      // it doubling the cost of the whole pass.
      const e = elevation[o00] * w00 + elevation[o10] * w10 + elevation[o01] * w01 + elevation[o11] * w11;
      let r: number, g: number, b: number;

      if (e <= 0) {
        // ---- sea ---------------------------------------------------------
        const t = Math.min(1, Math.pow(-e / theme.ocean.deepAt, 0.5)) * 0.82;
        r = shallow[0] + (deep[0] - shallow[0]) * t;
        g = shallow[1] + (deep[1] - shallow[1]) * t;
        b = shallow[2] + (deep[2] - shallow[2]) * t;

        if (L.coastRings && ring.count > 0) {
          // Distance from the coast in OUTPUT pixels, so ring spacing is a
          // constant visual rhythm regardless of zoom.
          const sd = fields.seaDist;
          const dPx = (sd[o00] * w00 + sd[o10] * w10 + sd[o01] * w01 + sd[o11] * w11) * scale;
          for (let k = 0; k < ring.count; k++) {
            const centre = (k + 1) * ring.spacing;
            const dd = Math.abs(dPx - centre);
            if (dd > ring.width) continue;
            const falloff = Math.pow(ring.falloff, k);
            // Cosine profile: no aliased hard edges at any zoom.
            const a = ring.alpha * falloff * (0.5 + 0.5 * Math.cos((dd / ring.width) * Math.PI));
            r += (ringC[0] - r) * a;
            g += (ringC[1] - g) * a;
            b += (ringC[2] - b) * a;
          }
        }
        // Grain shows through the wash, but damped — sea is ink, not bare paper.
        const m = 1 + (mod - 1) * 0.38;
        r *= m; g *= m; b *= m;
      } else {
        // ---- land --------------------------------------------------------
        // Start from the paper itself so the sheet reads through the map.
        r = paper[o]; g = paper[o + 1]; b = paper[o + 2];
        r += (landBase[0] - r) * 0.55;
        g += (landBase[1] - g) * 0.55;
        b += (landBase[2] - b) * 0.55;

        if (L.biomeTint) {
          const ta = tint.a;
          const a = theme.land.tintAlpha * (ta[o00] * w00 + ta[o10] * w10 + ta[o01] * w01 + ta[o11] * w11);
          if (a > 0.002) {
            const tr = tint.r, tg = tint.g, tb = tint.b;
            r += (tr[o00] * w00 + tr[o10] * w10 + tr[o01] * w01 + tr[o11] * w11 - r) * a;
            g += (tg[o00] * w00 + tg[o10] * w10 + tg[o01] * w01 + tg[o11] * w11 - g) * a;
            b += (tb[o00] * w00 + tb[o10] * w10 + tb[o01] * w01 + tb[o11] * w11 - b) * a;
          }
        }

        if (L.shading && theme.land.shading > 0) {
          // Relief shading from the real heightmap, kept gentle: on a drawn map
          // the symbols carry the terrain and the shading only seats them.
          const xr = wrapX(xc + 1), xl = wrapX(xc - 1);
          const yd = Math.min(H - 1, yc + 1), yu = Math.max(0, yc - 1);
          const dzdx = (elevation[yc * W + xr] - elevation[yc * W + xl]) * 0.5;
          const dzdy = (elevation[yd * W + xc] - elevation[yu * W + xc]) * 0.5;
          const Z = 9;
          const len = Math.sqrt(dzdx * dzdx * Z * Z + dzdy * dzdy * Z * Z + 1);
          const dot = (dzdx * Z * 0.55 + dzdy * Z * 0.55 + 0.63) / len;
          const shade = Math.max(0, Math.min(1, 0.5 - dot * 0.5)) * theme.land.shading;
          r += (shadeC[0] - r) * shade;
          g += (shadeC[1] - g) * shade;
          b += (shadeC[2] - b) * shade;
        }

        // Snow above the local snow line.
        const T = temperature[ci];
        const snowT = Math.min(1, Math.max(0, (-T - 5) / 10 + Math.max(0, e - 3) * 0.3));
        if (snowT > 0 && e > 1.6) {
          const s = snowT * snowT * (3 - 2 * snowT) * 0.9;
          r += (snowC[0] - r) * s; g += (snowC[1] - g) * s; b += (snowC[2] - b) * s;
        }

        if (lake[ci]) {
          const lk = hexToRgb(theme.lakes.fill);
          r = lk[0]; g = lk[1]; b = lk[2];
          const m = 1 + (mod - 1) * 0.3;
          r *= m; g *= m; b *= m;
        }
      }

      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage 2 — ink layers
// ---------------------------------------------------------------------------

// Marching squares runs over the whole world grid, so it does not depend on the
// view at all — but it was being re-run on every pan. Same for the lake mask.
const COAST_CACHE = new WeakMap<WorldData, { rev: number; c: Contour[] }>();
const LAKE_CACHE = new WeakMap<WorldData, { rev: number; c: Contour[] }>();

function allCoastlines(world: WorldData): Contour[] {
  const rev = world.revision ?? 0;
  const cached = COAST_CACHE.get(world);
  if (cached && cached.rev === rev) return cached.c;
  const c = marchingSquares(world.elevation, world.width, world.height, 0, true);
  COAST_CACHE.set(world, { rev, c });
  return c;
}

function allLakeShores(world: WorldData): Contour[] {
  const rev = world.revision ?? 0;
  const cached = LAKE_CACHE.get(world);
  if (cached && cached.rev === rev) return cached.c;
  let hit: Contour[];
  {
    const { width: W, height: H, lake } = world;
    let any = false;
    for (let i = 0; i < lake.length; i++) if (lake[i]) { any = true; break; }
    if (!any) hit = [];
    else {
      const f = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) f[i] = lake[i];
      hit = marchingSquares(f, W, H, 0.5, true);
    }
  }
  LAKE_CACHE.set(world, { rev, c: hit });
  return hit;
}

function extractCoastlines(world: WorldData, view: CartoView): Contour[] {
  const contours = allCoastlines(world);
  const pad = Math.max(8, view.w * 0.04);
  return contours.filter((c) => {
    if (c.pts.length < 6) return false;
    // Cheap reject of contours entirely outside the view (accounting for wrap).
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of c.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (maxY < view.y - pad || minY > view.y + view.h + pad) return false;
    return true;
  });
}

function projectContour(
  pts: Pt[],
  W: number,
  view: CartoView,
  toX: (x: number) => number,
  toY: (y: number) => number,
): Pt[] {
  // Choose the wrap offset that puts the contour nearest the view centre.
  const cx = view.x + view.w / 2;
  let sum = 0;
  for (const p of pts) sum += p.x;
  const mean = sum / pts.length;
  let shift = 0;
  while (mean + shift < cx - W / 2) shift += W;
  while (mean + shift > cx + W / 2) shift -= W;
  return pts.map((p) => ({ x: toX(p.x + shift), y: toY(p.y) }));
}

function drawCoastlines(
  ctx: Ctx,
  contours: Contour[],
  theme: CartoTheme,
  rng: Rng,
  scale: number,
  W: number,
  view: CartoView,
  toX: (x: number) => number,
  toY: (y: number) => number,
): void {
  ctx.strokeStyle = theme.coastline.color;
  ctx.lineWidth = theme.coastline.width * Math.max(0.75, Math.min(2.2, scale));
  for (const c of contours) {
    let pts = projectContour(c.pts, W, view, toX, toY);
    pts = simplify(pts, 0.35);
    if (pts.length < 4) continue;
    pts = chaikin(pts, c.closed, 2);
    if (theme.coastline.wobble > 0) pts = wobble(pts, theme.coastline.wobble, rng, c.closed);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (c.closed) ctx.closePath();
    ctx.stroke();
  }
}

function drawRivers(
  ctx: Ctx,
  world: WorldData,
  theme: CartoTheme,
  view: CartoView,
  scale: number,
  toX: (x: number) => number,
  toY: (y: number) => number,
): void {
  const W = world.width;
  ctx.strokeStyle = theme.rivers.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Generated and hand-drawn rivers go through exactly the same ink. A painted
  // watercourse that looked different from a generated one would announce itself
  // on every map it appeared on.
  // And a river the reader erased is gone from both, generated or not.
  const gone = world.painted?.removed;
  const generated = gone?.size
    ? world.rivers.filter((r) => !gone.has(riverKey(r.cells)))
    : world.rivers;
  const all = world.painted?.rivers.length
    ? [...generated, ...world.painted.rivers]
    : generated;
  for (const river of all) {
    const n = river.cells.length;
    if (n < 3) continue;
    const raw: Pt[] = [];
    let prevX = 0;
    for (let k = 0; k < n; k++) {
      const c = river.cells[k];
      let x = c % W;
      const y = (c / W) | 0;
      if (k > 0) {
        // Un-wrap so a river crossing the seam stays continuous.
        if (x - prevX > W / 2) x -= W;
        if (x - prevX < -W / 2) x += W;
      }
      prevX = x;
      raw.push({ x, y });
    }
    // Choose the wrap offset closest to the view.
    const cx = view.x + view.w / 2;
    let mean = 0;
    for (const p of raw) mean += p.x;
    mean /= raw.length;
    let shift = 0;
    while (mean + shift < cx - W / 2) shift += W;
    while (mean + shift > cx + W / 2) shift -= W;

    let pts = raw.map((p) => ({ x: toX(p.x + shift), y: toY(p.y) }));
    pts = simplify(pts, 0.4);
    if (pts.length < 3) continue;
    pts = chaikin(pts, false, 2);

    // Width grows from headwater to mouth; drawn as a few tapered pieces so a
    // big river visibly thickens the way an inked one does.
    const wMax = (theme.rivers.minWidth + theme.rivers.maxWidth * river.flow) * Math.max(0.7, Math.min(2.4, scale));
    const pieces = 6;
    for (let k = 0; k < pieces; k++) {
      const i0 = Math.floor((k * (pts.length - 1)) / pieces);
      const i1 = Math.ceil(((k + 1) * (pts.length - 1)) / pieces);
      if (i1 <= i0) continue;
      const t = (k + 0.5) / pieces;
      ctx.lineWidth = Math.max(0.5, theme.rivers.minWidth * Math.max(0.7, scale) + (wMax - theme.rivers.minWidth) * t);
      ctx.beginPath();
      ctx.moveTo(pts[i0].x, pts[i0].y);
      for (let i = i0 + 1; i <= i1 && i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  }
}

function drawLakes(
  ctx: Ctx,
  world: WorldData,
  theme: CartoTheme,
  view: CartoView,
  rng: Rng,
  scale: number,
  toX: (x: number) => number,
  toY: (y: number) => number,
): void {
  const W = world.width;
  const contours = allLakeShores(world);
  if (!contours.length) return;
  ctx.strokeStyle = theme.lakes.stroke;
  ctx.lineWidth = theme.lakes.width * Math.max(0.7, Math.min(2, scale));
  const cx = view.x + view.w / 2;
  for (const c of contours) {
    if (c.pts.length < 5) continue;
    let mean = 0;
    for (const p of c.pts) mean += p.x;
    mean /= c.pts.length;
    let shift = 0;
    while (mean + shift < cx - W / 2) shift += W;
    while (mean + shift > cx + W / 2) shift -= W;
    let pts = c.pts.map((p) => ({ x: toX(p.x + shift), y: toY(p.y) }));
    pts = chaikin(simplify(pts, 0.3), c.closed, 2);
    if (pts.length < 4) continue;
    pts = wobble(pts, 0.3, rng, c.closed);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
  }
}

// ---- relief symbols -------------------------------------------------------

const FOREST_BIOMES = new Set<number>([
  Biome.BorealForest, Biome.TemperateForest, Biome.TemperateRainforest,
  Biome.TropicalForest, Biome.TropicalRainforest,
]);

/**
 * World-global relief placement. Deliberately independent of the view so it can
 * be cached across pans; the caller clips to the viewport when drawing.
 */
function placeRelief(
  world: WorldData,
  fields: CartoFields,
  theme: CartoTheme,
  bucketScale: number,
  density: number,
  reliefAmount: number,
  seed: string,
): SymbolPlacement[] {
  const { width: W, height: H, elevation } = world;
  const rng = createRng(seed, 'relief');

  // Dual threshold on LOCAL RELIEF, taken as quantiles of the land: above
  // `mtnMin` a cell earns a mountain, above `hillMin` a hill, below that the
  // ground stays open. Absolute height only decides how BIG the symbol is —
  // gating on height instead would carpet every high plateau in peaks.
  const hillMin = fields.reliefQuantile(1 - 0.22 * reliefAmount);
  const mtnMin = fields.reliefQuantile(1 - 0.07 * reliefAmount);
  const span = Math.max(1e-4, mtnMin - hillMin);

  const score = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] <= 0) continue;
    const rel = fields.relief[i];
    if (rel < hillMin) continue;
    // Normalised so 0 = smallest hill, 1 = mountain threshold, >1 = big peaks.
    const t = (rel - hillMin) / span;
    score[i] = t * (fields.ridges[i] ? 1.25 : 1) + Math.max(0, elevation[i]) * 0.05;
  }

  const mSize = symbolSize(theme.mountains.size, bucketScale);
  const hSize = symbolSize(theme.hills.size, bucketScale);

  // Occupancy on a uniform grid. The previous version compared every candidate
  // against every symbol already placed — quadratic, and with a few thousand
  // symbols it was millions of distance checks per redraw.
  const cell = Math.max(2, (mSize * 1.6) / bucketScale);
  const gw = Math.max(1, Math.ceil(W / cell));
  const gh = Math.max(1, Math.ceil(H / cell));
  const grid: SymbolPlacement[][] = Array.from({ length: gw * gh }, () => []);
  const sizeOf = (p: SymbolPlacement) =>
    (p.isHill ? hSize : mSize) * (0.7 + Math.min(1.05, p.score * 0.5));

  // On-screen symbol density is scale-invariant by construction (the exclusion
  // radius is a constant number of SCREEN pixels), so the world-wide count grows
  // with the square of the zoom. A fixed cap would spend the whole budget on the
  // highest peaks worldwide and leave a zoomed-in view almost empty.
  const budget = Math.round(Math.min(220_000, Math.max(14_000, 14_000 * bucketScale * bucketScale)));

  const placed: SymbolPlacement[] = [];
  const push = (p: SymbolPlacement) => {
    placed.push(p);
    const gx = Math.min(gw - 1, Math.max(0, Math.floor(p.x / cell)));
    const gy = Math.min(gh - 1, Math.max(0, Math.floor(p.y / cell)));
    grid[gy * gw + gx].push(p);
  };
  const symWidth = (size: number) => size * 1.5; // ≈ mean silhouette width
  const tooClose = (x: number, y: number, size: number, slack: number) => {
    const r = (symWidth(size) * slack) / bucketScale;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    const span2 = Math.ceil((r * 2) / cell) + 1;
    for (let dy = -span2; dy <= span2; dy++) {
      const yy = gy + dy;
      if (yy < 0 || yy >= gh) continue;
      for (let dx = -span2; dx <= span2; dx++) {
        const xx = ((gx + dx) % gw + gw) % gw;
        for (const o of grid[yy * gw + xx]) {
          let ddx = o.x - x;
          if (ddx > W / 2) ddx -= W;
          if (ddx < -W / 2) ddx += W;
          // Symbols are wide: allow tighter vertical packing than horizontal.
          const ddy = (o.y - y) * 1.35;
          const rr = (r + (symWidth(sizeOf(o)) * slack) / bucketScale) * 0.5;
          if (ddx * ddx + ddy * ddy < rr * rr) return true;
        }
      }
    }
    return false;
  };

  // ---- pass 1: chains along the crests ----------------------------------
  // A mountain range is a line, not a cloud. Trace the crest, walk along it and
  // hang symbols off it; only then scatter fill around what's left.
  const chainRidges = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (fields.ridges[i] && fields.relief[i] >= mtnMin) chainRidges[i] = 1;
  const chains = traceRidgeChains(chainRidges, elevation, W, H, 5);

  for (const chain of chains) {
    // Cell path → world polyline, un-wrapped so it stays continuous.
    const raw: Pt[] = [];
    let prevX = 0;
    for (let k = 0; k < chain.length; k++) {
      let x = chain[k] % W;
      const y = (chain[k] / W) | 0;
      if (k > 0) {
        if (x - prevX > W / 2) x -= W;
        if (x - prevX < -W / 2) x += W;
      }
      prevX = x;
      raw.push({ x, y });
    }
    if (raw.length < 3) continue;
    const smooth = chaikin(simplify(raw, 0.8), false, 2);
    // Spacing in world cells so consecutive symbols overlap by roughly a third.
    const step = Math.max(1.2, (mSize * 1.05) / bucketScale / density);
    const walk = resample(smooth, step, false);
    for (const p of walk) {
      const xi = ((Math.round(p.x) % W) + W) % W;
      const yi = Math.min(H - 1, Math.max(0, Math.round(p.y)));
      if (elevation[yi * W + xi] <= 0) continue;
      const sc = score[yi * W + xi];
      if (sc <= 0) continue;
      const item: SymbolPlacement = { x: ((p.x % W) + W) % W, y: p.y, score: sc, isHill: false };
      if (tooClose(item.x, item.y, sizeOf(item), 0.55)) continue;
      push(item);
    }
  }

  // ---- pass 2: scatter fill ----------------------------------------------
  const pts = scatterByScore(score, W, H, {
    minScore: 0.02,
    radiusAt: (sc) => {
      const size = sc >= 1 ? mSize : hSize;
      return Math.max(1.6, (size * (sc >= 1 ? 1.5 : 1.15)) / bucketScale / density);
    },
    maxPoints: budget,
    accept: (x, y) => {
      // Both feet on land, and on the SAME landmass — a symbol that bridges a
      // strait reads as a mistake.
      const foot = mSize / bucketScale;
      const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
      const lm = fields.landmass[yi * W + ((Math.round(x) % W) + W) % W];
      if (lm < 0) return false;
      for (const dx of [-foot * 0.5, foot * 0.5]) {
        const fx = ((Math.round(x + dx) % W) + W) % W;
        const fi = yi * W + fx;
        if (elevation[fi] <= 0 || fields.landmass[fi] !== lm) return false;
      }
      return true;
    },
    jitter: 0.6,
    rng,
  });

  for (const p of pts) {
    const item: SymbolPlacement = {
      x: ((p.x % W) + W) % W, y: p.y, score: p.score, isHill: p.score < 1,
    };
    if (tooClose(item.x, item.y, sizeOf(item), 0.72)) continue;
    push(item);
  }
  return placed;
}

/** Screen height of a symbol at a given scale. */
function symbolSize(base: number, scale: number): number {
  return base * Math.max(0.55, Math.min(1.9, 0.55 + 0.45 * scale));
}

function drawRelief(
  ctx: Ctx,
  world: WorldData,
  fields: CartoFields,
  theme: CartoTheme,
  view: CartoView,
  scale: number,
  density: number,
  reliefAmount: number,
  seed: string,
  toX: (x: number) => number,
  toY: (y: number) => number,
  emit?: (s: EmittedSymbol) => void,
): number {
  const { width: W, height: H, elevation, temperature } = world;
  const all = cachedPlacement(
    world,
    `relief|${theme.id}|${density}|${reliefAmount}`,
    (bs) => placeRelief(world, fields, theme, bs, density, reliefAmount, seed),
    scale,
  );

  const mSize = symbolSize(theme.mountains.size, scale);
  const hSize = symbolSize(theme.hills.size, scale);
  const pad = (mSize / scale) * 2.2;
  const cx = view.x + view.w / 2;

  // Clip to the viewport HERE, not during placement: the layout must not depend
  // on where the reader is looking.
  const visible: { x: number; wx: number; y: number; size: number; isHill: boolean }[] = [];
  for (const p of all) {
    let x = p.x;
    while (x < cx - W / 2) x += W;
    while (x > cx + W / 2) x -= W;
    if (p.y < view.y - pad || p.y > view.y + view.h + pad) continue;
    if (x < view.x - pad || x > view.x + view.w + pad) continue;
    visible.push({
      x, wx: p.x, y: p.y,
      size: (p.isHill ? hSize : mSize) * (0.7 + Math.min(1.05, p.score * 0.5)),
      isHill: p.isHill,
    });
  }
  // Painter's algorithm: back to front by the symbol's base line.
  visible.sort((a, b) => a.y - b.y);

  const landBase = theme.land.base;
  for (const { x, wx, y, isHill, size } of visible) {
    const sx = toX(x), sy = toY(y);
    const jitterSeed = rngFor(seed, wx, y);
    const h = size * (1 + (jitterSeed() - 0.5) * 2 * theme.mountains.sizeJitter);
    const ratio = isHill ? 1.7 + jitterSeed() * 0.8 : 2.3 + jitterSeed() * 2.2;
    const w = h * ratio * 0.55;

    const xi = ((Math.round(wx) % W) + W) % W;
    const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
    const T = temperature[yi * W + xi];
    const e = elevation[yi * W + xi];
    const snow = Math.min(1, Math.max(0, (-T - 2) / 12 + Math.max(0, e - 2.6) * 0.25));

    if (emit) {
      emit({ kind: isHill ? 'hill' : 'mountain', x: sx, y: sy, w, h, variant: jitterSeed(), snow });
      continue;
    }
    ctx.save();
    ctx.translate(sx, sy);
    drawMountain(ctx, jitterSeed, theme, { h, w, snow, fill: landBase }, isHill);
    ctx.restore();
  }
  return visible.length;
}

/** Position-derived RNG: a symbol keeps its exact shape when the view pans. */
function rngFor(seed: string, x: number, y: number): Rng {
  return createRng(seed, `sym:${Math.round(x * 4)}:${Math.round(y * 4)}`);
}

/** World-global forest/scrub placement, cached per zoom bucket. */
function placeForests(
  world: WorldData,
  fields: CartoFields,
  theme: CartoTheme,
  bucketScale: number,
  density: number,
  seed: string,
): SymbolPlacement[] {
  const { width: W, height: H, biome, elevation, precipitation } = world;
  const rng = createRng(seed, 'forest');
  const score = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] <= 0) continue;
    const b = biome[i];
    if (FOREST_BIOMES.has(b)) score[i] = 0.5 + Math.min(0.5, precipitation[i] / 3000);
    else if (b === Biome.Savanna || b === Biome.Shrubland) score[i] = 0.22;
    else if (b === Biome.Desert) score[i] = 0.12;
  }
  const tSize = theme.forest.size * Math.max(0.5, Math.min(1.8, 0.5 + 0.5 * bucketScale));
  // Keep canopy off the ground the relief symbols already occupy.
  const reliefCap = fields.reliefQuantile(0.8);
  // Same scale-invariance argument as the relief budget.
  const budget = Math.round(Math.min(400_000, Math.max(26_000, 26_000 * bucketScale * bucketScale)));

  const pts = scatterByScore(score, W, H, {
    minScore: 0.1,
    radiusAt: (sc) => Math.max(1.1, (tSize * (sc > 0.4 ? 0.95 : 2.1)) / bucketScale / density),
    maxPoints: budget,
    accept: (x, y) => {
      const xi = ((Math.round(x) % W) + W) % W;
      const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
      // Keep the shoreline legible: no canopy sitting on the coast ink.
      return fields.landDist[yi * W + xi] > 0.9 && fields.relief[yi * W + xi] < reliefCap;
    },
    jitter: 0.8,
    rng,
  });
  return pts.map((p) => ({ x: ((p.x % W) + W) % W, y: p.y, score: p.score, isHill: false }));
}

function drawForests(
  ctx: Ctx,
  world: WorldData,
  fields: CartoFields,
  theme: CartoTheme,
  view: CartoView,
  scale: number,
  density: number,
  seed: string,
  toX: (x: number) => number,
  toY: (y: number) => number,
  emit?: (s: EmittedSymbol) => void,
): number {
  const { width: W, height: H, biome, temperature } = world;
  const all = cachedPlacement(
    world,
    `forest|${theme.id}|${density}`,
    (bs) => placeForests(world, fields, theme, bs, density, seed),
    scale,
  );

  const tSize = theme.forest.size * Math.max(0.5, Math.min(1.8, 0.5 + 0.5 * scale));
  const pad = (tSize / scale) * 2.2;
  const cx = view.x + view.w / 2;

  const visible: { x: number; wx: number; y: number }[] = [];
  for (const p of all) {
    let x = p.x;
    while (x < cx - W / 2) x += W;
    while (x > cx + W / 2) x -= W;
    if (p.y < view.y - pad || p.y > view.y + view.h + pad) continue;
    if (x < view.x - pad || x > view.x + view.w + pad) continue;
    visible.push({ x, wx: p.x, y: p.y });
  }
  visible.sort((a, b) => a.y - b.y);

  for (const { x, wx, y } of visible) {
    const xi = ((Math.round(wx) % W) + W) % W;
    const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
    const b = biome[yi * W + xi];
    const T = temperature[yi * W + xi];
    const r = rngFor(seed, wx, y);
    const h = tSize * (1 + (r() - 0.5) * 2 * theme.forest.sizeJitter);
    // Marsh: wet, nearly flat, close to standing water or a river mouth.
    const wetland = world.precipitation[yi * W + xi] > 1100
      && fields.relief[yi * W + xi] < fields.reliefQuantile(0.25)
      && world.elevation[yi * W + xi] < 0.35;

    // Which symbol this cell gets, decided once so the CPU and GPU paths cannot
    // disagree about what is standing there.
    let kind: EmittedSymbol['kind'];
    let scale2 = 1;
    if (b === Biome.Desert) {
      if (r() < 0.45) { kind = 'cactus'; scale2 = 0.8; } else { kind = 'dune'; scale2 = 1.7; }
    } else if (b === Biome.SaltFlat || b === Biome.ColdDesert) {
      kind = 'dune'; scale2 = 1.6;
    } else if (b === Biome.TropicalRainforest || b === Biome.TropicalForest) {
      if (r() < 0.32) { kind = 'palm'; scale2 = 1.1; } else kind = 'broadleaf';
    } else if (b === Biome.BorealForest || T < 4) {
      kind = 'conifer'; scale2 = 1.15;
    } else if (b === Biome.Savanna || b === Biome.Shrubland) {
      kind = 'broadleaf'; scale2 = 0.75;
    } else if (wetland && r() < 0.55) {
      // Low, flat, wet ground gets the standard marsh tuft instead of canopy.
      kind = 'marsh'; scale2 = 1.3;
    } else if (r() < 0.4) {
      kind = 'conifer'; scale2 = 1.1;
    } else {
      kind = 'broadleaf';
    }
    const hh = h * scale2;

    if (emit) {
      // A tree's atlas cell is square, so the quad is too; a mountain's carries
      // its own width, which is what gives the range its silhouette.
      emit({ kind, x: toX(x), y: toY(y), w: hh * (kind === 'dune' || kind === 'marsh' ? 1.9 : 1), h: hh, variant: r(), snow: 0 });
      continue;
    }
    ctx.save();
    ctx.translate(toX(x), toY(y));
    switch (kind) {
      case 'cactus': drawCactus(ctx, r, theme, hh); break;
      case 'dune': drawDune(ctx, r, theme, hh); break;
      case 'palm': drawPalm(ctx, r, theme, hh); break;
      case 'conifer': drawConifer(ctx, r, theme, hh); break;
      case 'marsh': drawMarsh(ctx, r, theme, hh); break;
      default: drawBroadleaf(ctx, r, theme, hh); break;
    }
    ctx.restore();
  }
  return visible.length;
}

export { rgbCss, resample };
