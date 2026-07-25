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

import { Biome, type BiomeId, type WorldData } from '../core/types';
import { createRng, type Rng } from '../core/rng';
import { blur, distanceTo, labelLandmasses, localRelief, ridgeMask, sampleField, scatterByScore, traceRidgeChains } from './fields';
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

const FIELD_CACHE = new WeakMap<WorldData, CartoFields>();

export function computeFields(world: WorldData): CartoFields {
  const cached = FIELD_CACHE.get(world);
  if (cached) return cached;
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
  FIELD_CACHE.set(world, fields);
  return fields;
}

interface TintField { r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array }
const TINT_CACHE = new WeakMap<WorldData, Map<string, TintField>>();

function getTintField(world: WorldData, theme: CartoTheme): TintField {
  let perTheme = TINT_CACHE.get(world);
  if (!perTheme) TINT_CACHE.set(world, (perTheme = new Map()));
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
  const base = renderBaseRaster(world, fields, opts, view, scale, L);
  const img = ctx.createImageData(OW, OH);
  img.data.set(base);
  ctx.putImageData(img, 0, 0);

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
  if (L.forests) symbolCount += drawForests(ctx, world, fields, theme, view, scale, density, seed, toScreenX, toScreenY);
  if (L.relief) symbolCount += drawRelief(ctx, world, fields, theme, view, scale, density, reliefAmount, seed, toScreenX, toScreenY);

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
  const { width: W, height: H, elevation, biome, temperature, lake } = world;

  const paper = renderPaper({
    width: OW, height: OH,
    seed: `${world.params.seed}::paper`,
    theme,
  });

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

      const e = sampleField(elevation, W, H, wx - 0.5, wy - 0.5);
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
          const dPx = sampleField(fields.seaDist, W, H, wx - 0.5, wy - 0.5) * scale;
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
          const a = theme.land.tintAlpha * sampleField(tint.a, W, H, wx - 0.5, wy - 0.5);
          if (a > 0.002) {
            r += (sampleField(tint.r, W, H, wx - 0.5, wy - 0.5) - r) * a;
            g += (sampleField(tint.g, W, H, wx - 0.5, wy - 0.5) - g) * a;
            b += (sampleField(tint.b, W, H, wx - 0.5, wy - 0.5) - b) * a;
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

function extractCoastlines(world: WorldData, view: CartoView): Contour[] {
  // Work on the full grid: contours must close correctly across the seam.
  const contours = marchingSquares(world.elevation, world.width, world.height, 0, true);
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
  for (const river of world.rivers) {
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
  const { width: W, height: H, lake } = world;
  let any = false;
  for (let i = 0; i < lake.length; i++) if (lake[i]) { any = true; break; }
  if (!any) return;
  const f = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) f[i] = lake[i];
  const contours = marchingSquares(f, W, H, 0.5, true);
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
): number {
  const { width: W, height: H, elevation, temperature } = world;
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

  // Screen size of a typical peak, and the world-space exclusion radius that
  // produces it. Overlap is deliberate — a little is what makes a range read as
  // a range rather than a row of stamps.
  const mSize = theme.mountains.size * Math.max(0.55, Math.min(1.9, 0.55 + 0.45 * scale));
  const hSize = theme.hills.size * Math.max(0.55, Math.min(1.9, 0.55 + 0.45 * scale));

  const pad = (mSize / scale) * 2;
  const inView = (x: number, y: number) =>
    y > view.y - pad && y < view.y + view.h + pad &&
    ((x > view.x - pad && x < view.x + view.w + pad) ||
      (x + W > view.x - pad && x + W < view.x + view.w + pad) ||
      (x - W > view.x - pad && x - W < view.x + view.w + pad));

  // ---- pass 1: chains along the crests ----------------------------------
  // A mountain range is a line, not a cloud. Trace the crest, walk along it and
  // hang symbols off it; only then scatter fill around what's left.
  const chainRidges = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (fields.ridges[i] && fields.relief[i] >= mtnMin) chainRidges[i] = 1;
  const chains = traceRidgeChains(chainRidges, elevation, W, H, 5);

  interface Placed { x: number; y: number; size: number; isHill: boolean }
  const placed: Placed[] = [];
  const occupied: Placed[] = [];

  const symWidth = (size: number) => size * 1.5; // ≈ mean silhouette width
  const tooClose = (x: number, y: number, size: number, slack: number) => {
    const r = (symWidth(size) * slack) / scale;
    for (const o of occupied) {
      let dx = o.x - x;
      if (dx > W / 2) dx -= W;
      if (dx < -W / 2) dx += W;
      const dy = (o.y - y) * 1.35; // symbols are wide: allow tighter vertical packing
      const rr = (r + (symWidth(o.size) * slack) / scale) * 0.5;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  };

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
    const step = Math.max(1.2, (mSize * 1.05) / scale / density);
    const walk = resample(smooth, step, false);
    for (const p of walk) {
      const xi = ((Math.round(p.x) % W) + W) % W;
      const yi = Math.min(H - 1, Math.max(0, Math.round(p.y)));
      if (elevation[yi * W + xi] <= 0) continue;
      if (!inView(p.x, p.y)) continue;
      const sc = score[yi * W + xi];
      if (sc <= 0) continue;
      const size = mSize * (0.72 + Math.min(1.05, sc * 0.5));
      if (tooClose(p.x, p.y, size, 0.55)) continue;
      const item = { x: p.x, y: p.y, size, isHill: false };
      placed.push(item);
      occupied.push(item);
    }
  }

  // ---- pass 2: scatter fill ----------------------------------------------
  const pts = scatterByScore(score, W, H, {
    minScore: 0.02,
    radiusAt: (s) => {
      const size = s >= 1 ? mSize : hSize;
      return Math.max(1.6, (size * (s >= 1 ? 1.5 : 1.15)) / scale / density);
    },
    maxPoints: 14000,
    accept: (x, y) => {
      if (!inView(x, y)) return false;
      // Both feet on land, and on the SAME landmass — a symbol that bridges a
      // strait reads as a mistake.
      const foot = mSize / scale;
      const xi = Math.round(x), yi = Math.min(H - 1, Math.max(0, Math.round(y)));
      const lm = fields.landmass[yi * W + ((xi % W) + W) % W];
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
    const isHill = p.score < 1;
    const size = (isHill ? hSize : mSize) * (0.7 + Math.min(1.05, p.score * 0.5));
    if (tooClose(p.x, p.y, size, 0.72)) continue;
    const item = { x: p.x, y: p.y, size, isHill };
    placed.push(item);
    occupied.push(item);
  }

  // Painter's algorithm: back to front by the symbol's base line.
  placed.sort((a, b) => a.y - b.y);

  const landBase = theme.land.base;
  for (const { x: wx0, y: wy0, isHill, size } of placed) {
    const p = { x: wx0, y: wy0 };
    // World x may need a wrap shift to land in view.
    let x = p.x;
    const cx = view.x + view.w / 2;
    while (x < cx - W / 2) x += W;
    while (x > cx + W / 2) x -= W;
    const sx = toX(x), sy = toY(p.y);

    const jitterSeed = rngFor(seed, p.x, p.y);
    const h = size * (1 + (jitterSeed() - 0.5) * 2 * theme.mountains.sizeJitter);
    const ratio = isHill ? 1.7 + jitterSeed() * 0.8 : 2.3 + jitterSeed() * 2.2;
    const w = h * ratio * 0.55;

    const xi = ((Math.round(p.x) % W) + W) % W;
    const yi = Math.min(H - 1, Math.max(0, Math.round(p.y)));
    const T = temperature[yi * W + xi];
    const e = elevation[yi * W + xi];
    const snow = Math.min(1, Math.max(0, (-T - 2) / 12 + Math.max(0, e - 2.6) * 0.25));

    ctx.save();
    ctx.translate(sx, sy);
    drawMountain(ctx, jitterSeed, theme, { h, w, snow, fill: landBase }, isHill);
    ctx.restore();
  }
  return placed.length;
}

/** Position-derived RNG: a symbol keeps its exact shape when the view pans. */
function rngFor(seed: string, x: number, y: number): Rng {
  return createRng(seed, `sym:${Math.round(x * 4)}:${Math.round(y * 4)}`);
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
): number {
  const { width: W, height: H, biome, elevation, precipitation, temperature } = world;
  const rng = createRng(seed, 'forest');
  const score = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] <= 0) continue;
    const b = biome[i];
    if (FOREST_BIOMES.has(b)) score[i] = 0.5 + Math.min(0.5, precipitation[i] / 3000);
    else if (b === Biome.Savanna || b === Biome.Shrubland) score[i] = 0.22;
    else if (b === Biome.Desert) score[i] = 0.12;
  }

  const tSize = theme.forest.size * Math.max(0.5, Math.min(1.8, 0.5 + 0.5 * scale));
  // Keep canopy off the ground the relief symbols already occupy.
  const reliefCap = fields.reliefQuantile(0.8);
  const pad = tSize / scale * 2;
  const inView = (x: number, y: number) =>
    y > view.y - pad && y < view.y + view.h + pad &&
    ((x > view.x - pad && x < view.x + view.w + pad) ||
      (x + W > view.x - pad && x + W < view.x + view.w + pad) ||
      (x - W > view.x - pad && x - W < view.x + view.w + pad));

  const pts = scatterByScore(score, W, H, {
    minScore: 0.1,
    radiusAt: (s) => Math.max(1.1, (tSize * (s > 0.4 ? 0.95 : 2.1)) / scale / density),
    maxPoints: 26000,
    accept: (x, y) => {
      if (!inView(x, y)) return false;
      const xi = ((Math.round(x) % W) + W) % W;
      const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
      // Keep the shoreline legible: no canopy sitting on the coast ink.
      return fields.landDist[yi * W + xi] > 0.9 && fields.relief[yi * W + xi] < reliefCap;
    },
    jitter: 0.8,
    rng,
  });

  const placed = pts.map((p) => p).sort((a, b) => a.y - b.y);
  const cx = view.x + view.w / 2;
  for (const p of placed) {
    let x = p.x;
    while (x < cx - W / 2) x += W;
    while (x > cx + W / 2) x -= W;
    const xi = ((Math.round(p.x) % W) + W) % W;
    const yi = Math.min(H - 1, Math.max(0, Math.round(p.y)));
    const b = biome[yi * W + xi];
    const T = temperature[yi * W + xi];
    const r = rngFor(seed, p.x, p.y);
    const h = tSize * (1 + (r() - 0.5) * 2 * theme.forest.sizeJitter);
    // Marsh: wet, nearly flat, close to standing water or a river mouth.
    const wetland = world.precipitation[yi * W + xi] > 1100
      && fields.relief[yi * W + xi] < fields.reliefQuantile(0.25)
      && world.elevation[yi * W + xi] < 0.35;

    ctx.save();
    ctx.translate(toX(x), toY(p.y));
    if (b === Biome.Desert) {
      if (r() < 0.45) drawCactus(ctx, r, theme, h * 0.8);
      else drawDune(ctx, r, theme, h * 1.7);
    } else if (b === Biome.SaltFlat || b === Biome.ColdDesert) {
      drawDune(ctx, r, theme, h * 1.6);
    } else if (b === Biome.TropicalRainforest || b === Biome.TropicalForest) {
      if (r() < 0.32) drawPalm(ctx, r, theme, h * 1.1);
      else drawBroadleaf(ctx, r, theme, h);
    } else if (b === Biome.BorealForest || T < 4) {
      drawConifer(ctx, r, theme, h * 1.15);
    } else if (b === Biome.Savanna || b === Biome.Shrubland) {
      drawBroadleaf(ctx, r, theme, h * 0.75);
    } else if (wetland && r() < 0.55) {
      // Low, flat, wet ground gets the standard marsh tuft instead of canopy.
      drawMarsh(ctx, r, theme, h * 1.3);
    } else {
      if (r() < 0.4) drawConifer(ctx, r, theme, h * 1.1);
      else drawBroadleaf(ctx, r, theme, h);
    }
    ctx.restore();
  }
  return placed.length;
}

export { rgbCss, resample };
