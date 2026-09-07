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

import { scaleCount } from '@/utils/capacity';
import { riverKey } from '../core/edits';
import { Biome, type WorldData } from '../core/types';
import { createRng, type Rng } from '../core/rng';
import { blur, distanceTo, labelLandmasses, localRelief, ridgeMask, scatterByScore, traceRidgeChains } from './fields';
import { chaikin, marchingSquares, polylineVisible, resample, simplify, wobble, type Contour, type Pt } from './contours';
import { renderPaper } from './paper';
import { drawBroadleaf, drawCactus, drawConifer, drawDune, drawIce, drawMarsh, drawMountain, drawPalm, type Ctx } from './symbols';
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
  /**
   * Display tiles pass their pixel origin inside the level's virtual sheet so
   * the paper tone continues across joins. Absent (every classic render and
   * every export) the paper behaves exactly as it always has.
   */
  paperAnchor?: { x: number; y: number; extentX: number; extentY: number };
  /** Human geography (settlements, roads, realms, named features). Omit to
   *  render an uninhabited world. */
  geography?: HumanGeography;
  /** Title shown in the cartouche. */
  title?: string;
  subtitle?: string;
  /** Puntos cardinales de la rosa, en orden N, E, S, O — ver `furniture.ts`. */
  cardinals?: [string, string, string, string];
  /** Unidad de la barra de escala. */
  distanceUnit?: string;
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
  /**
   * Sombreado del relieve, 0 (a plena luz) … 1 (a contraluz), precalculado por
   * celda.
   *
   * Estaba dentro del bucle de píxeles, tomando la pendiente de los vecinos
   * ENTEROS: a 24× de zoom eso pinta un cuadrado plano por celda y el terreno
   * se leía como una colcha de retales — el defecto más visible de la base.
   * Calculado aquí una vez por mundo (O(W·H), cacheado) se puede muestrear
   * bilinealmente y la colcha desaparece. Además mezcla dos escalas: la ladera
   * fina y la forma grande, que es lo que hace que el relieve se palpe en vez
   * de sólo ensuciar la ladera.
   */
  shade: Float32Array;
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
  const shade = hillshade(elevation, W, H);
  const fields: CartoFields = { land, seaDist, landDist, relief, ridges, landmass: label, shade, reliefQuantile };
  FIELD_CACHE.set(world, { rev, fields });
  return fields;
}

/**
 * Sombreado de dos escalas con el sol al noroeste (la convención cartográfica,
 * y la misma que hornea la vista de atlas).
 *
 * Dos escalas porque una sola miente: la ladera de una celda dice dónde está el
 * barranco pero no dónde está la montaña, y un mapa dibujado necesita las dos
 * — el volumen grande para que el terreno tenga cuerpo y el fino para que la
 * ladera tenga textura. La forma grande sale de la elevación desenfocada a
 * W/128 celdas, que a 1024 son 8 celdas ≈ 280 km: la escala de una sierra.
 */
function hillshade(elevation: Float32Array, W: number, H: number): Float32Array {
  const coarse = blur(elevation, W, H, Math.max(2, Math.round(W / 128)), 2);
  const out = new Float32Array(W * H);
  const wrap = (x: number) => ((x % W) + W) % W;
  const Z = 9, ZC = 26;
  for (let y = 0; y < H; y++) {
    const yd = Math.min(H - 1, y + 1), yu = Math.max(0, y - 1);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (elevation[i] <= 0) continue;
      const xr = wrap(x + 1), xl = wrap(x - 1);
      const fx = (elevation[y * W + xr] - elevation[y * W + xl]) * 0.5;
      const fy = (elevation[yd * W + x] - elevation[yu * W + x]) * 0.5;
      const cx = (coarse[y * W + xr] - coarse[y * W + xl]) * 0.5;
      const cy = (coarse[yd * W + x] - coarse[yu * W + x]) * 0.5;
      const dxz = fx * Z + cx * ZC, dyz = fy * Z + cy * ZC;
      const len = Math.sqrt(dxz * dxz + dyz * dyz + 1);
      const dot = (dxz * 0.55 + dyz * 0.55 + 0.63) / len;
      out[i] = Math.max(0, Math.min(1, 0.5 - dot * 0.5));
    }
  }
  return out;
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
const PAPER_LRU_MAX = scaleCount(3);

function getPaper(
  seed: string, theme: CartoTheme, W: number, H: number,
  anchor?: { x: number; y: number; extentX: number; extentY: number },
): Uint8ClampedArray {
  const key = `${seed}|${theme.id}|${W}x${H}`
    + (anchor ? `|@${anchor.x},${anchor.y}/${anchor.extentX}x${anchor.extentY}` : '');
  const hit = PAPER_LRU.findIndex((e) => e.key === key);
  if (hit >= 0) {
    const [entry] = PAPER_LRU.splice(hit, 1);
    PAPER_LRU.unshift(entry);
    return entry.px;
  }
  const px = renderPaper({ width: W, height: H, seed, theme, anchor });
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
export interface SymbolPlacement {
  x: number;
  y: number;
  score: number;
  isHill: boolean;
  /**
   * −1…+1: hacia dónde inclina la cumbre, tomado de la tangente de la cresta.
   * Es lo que orienta el símbolo A SU SIERRA en vez de dibujarlo simétrico.
   */
  lean?: number;
  /** 0.7…1.3: ensanche del símbolo. Una cresta transversal se ve de costado
   *  (ancha); una que corre hacia el lector se ve de canto (estrecha). */
  broad?: number;
  /**
   * 0 = nada delante, 1 = tapado. Alimenta la perspectiva aérea del símbolo.
   * Se calcula UNA vez, con la colocación (que es global y cacheada), nunca por
   * cuadro: depender del orden de dibujo lo haría distinto en cada tesela.
   */
  depth?: number;
  /**
   * 0 = en el borde de la masa, 1 = en su corazón. Sólo los árboles: una masa
   * forestal se dibuja MASIVA — copas grandes y apretadas dentro, ejemplares
   * sueltos y pequeños en la orilla. Sin esto el bosque es una trama de sellos
   * del mismo tamaño repartidos por igual, que es lo que delataba el mapa.
   */
  mass?: number;
}
interface PlacementEntry { key: string; items: SymbolPlacement[] }
const PLACE_CACHE = new WeakMap<WorldData, { rev: number; list: PlacementEntry[] }>();
const PLACE_MAX = scaleCount(8);

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
  kind: 'mountain' | 'hill' | 'conifer' | 'broadleaf' | 'palm' | 'cactus' | 'dune' | 'marsh' | 'ice';
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
  // Stochastic ink (coast/lake wobble) is keyed by WORLD position, never by a
  // sequential stream: a stream's state depends on everything drawn before it,
  // so two tiles that admit different contour sets would displace the SAME
  // coast differently and the join would show it. Position-keyed noise also
  // makes ink culling safe — skipping an off-view contour can't shift anyone
  // else's wobble.
  const inkNoise = makeInkNoise(seed, view, scale, world.width);

  // Mar abierto: punteado primero, isóbata de plataforma encima. Los dos van
  // DEBAJO de la costa — la línea de tierra es la que manda en el agua.
  if (L.coastRings) drawSeaStipple(ctx, world, fields, theme, view, scale, OW, OH);
  if (L.coastRings) drawShelf(ctx, world, theme, view, scale, toScreenX, toScreenY);

  // Coastline. Extract in world space so the seam and sub-cell accuracy are
  // both handled, then project.
  const coast = extractCoastlines(world, view, scale);
  drawCoastlines(ctx, coast, theme, inkNoise, scale, world.width, view, toScreenX, toScreenY);

  if (L.shading) drawHachure(ctx, world, fields, theme, view, scale, OW, OH);
  if (L.rivers) drawRivers(ctx, world, theme, view, scale, toScreenX, toScreenY);
  drawLakes(ctx, world, theme, view, inkNoise, scale, toScreenX, toScreenY);

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
      cardinals: opts.cardinals,
      distanceUnit: opts.distanceUnit,
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

  const paper = getPaper(`${world.params.seed}::paper`, theme, OW, OH, opts.paperAnchor);

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
      // SMOOTHSTEP en los pesos, no la fracción cruda. La bilineal pura es C0:
      // su derivada salta en cada borde de celda, y a 24× de zoom eso se ve como
      // una colcha de cuadrados en los lavados de bioma — el defecto más visible
      // de la base rasterizada. t·t·(3−2t) la hace C1 y la colcha desaparece,
      // al coste de dos multiplicaciones por píxel.
      const rx = fx - ix, ry = fy - iy0;
      const tx = rx * rx * (3 - 2 * rx), ty = ry * ry * (3 - 2 * ry);
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
          // Muestreado bilinealmente del campo precalculado — ver `hillshade`.
          const sh = fields.shade;
          const shade = (sh[o00] * w00 + sh[o10] * w10 + sh[o01] * w01 + sh[o11] * w11) * theme.land.shading;
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

/**
 * Position-keyed ink noise in [0,1). Screen points are unprojected back to
 * world cells (the view transform is affine), wrapped, and quantized to 1/64
 * cell before hashing — so the SAME piece of ground hashes the same in every
 * tile of a level, and near enough across levels for crossfades to look calm.
 * Draw order is irrelevant by construction.
 */
function makeInkNoise(
  seed: string,
  view: CartoView,
  scale: number,
  W: number,
): (x: number, y: number) => number {
  let salt = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    salt ^= seed.charCodeAt(i);
    salt = Math.imul(salt, 16777619);
  }
  return (sx: number, sy: number): number => {
    const wx = view.x + sx / scale;
    const wy = view.y + sy / scale;
    const qx = Math.round((((wx % W) + W) % W) * 64) | 0;
    const qy = Math.round(wy * 64) | 0;
    let h = (Math.imul(qx, 0x9e3779b1) ^ Math.imul(qy, 0x85ebca77) ^ salt) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
}

function extractCoastlines(world: WorldData, view: CartoView, scale: number): Contour[] {
  const contours = allCoastlines(world);
  // Wobble/chaikin reach a few output px past the raw bbox; pad in cells.
  const pad = Math.max(2, 8 / scale);
  return contours.filter((c) => c.pts.length >= 6 && polylineVisible(c.pts, view, world.width, pad));
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
  noise: (x: number, y: number) => number,
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
    if (theme.coastline.wobble > 0) pts = wobble(pts, theme.coastline.wobble, noise, c.closed);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (c.closed) ctx.closePath();
    ctx.stroke();
  }
}

// ---- water: shelf break and open-water stipple ----------------------------

const SHELF_CACHE = new WeakMap<WorldData, { rev: number; depth: number; c: Contour[] }>();

/**
 * La isóbata del quiebre de plataforma, trazada como CONTORNO y no como banda
 * de color en el ráster.
 *
 * En el ráster la línea tendría el grosor que le dejara el gradiente de sonda:
 * dos píxeles en un talud y cuarenta en una llanura abisal. Trazada como
 * marching squares tiene el grosor que se le pida en cualquier fondo, y se
 * cachea por mundo como la costa — no depende de la vista.
 */
function drawShelf(
  ctx: Ctx,
  world: WorldData,
  theme: CartoTheme,
  view: CartoView,
  scale: number,
  toX: (x: number) => number,
  toY: (y: number) => number,
): void {
  const sh = theme.ocean.shelf;
  if (!sh.enabled || sh.alpha <= 0.01) return;
  const rev = world.revision ?? 0;
  let hit = SHELF_CACHE.get(world);
  if (!hit || hit.rev !== rev || hit.depth !== sh.depth) {
    const c = marchingSquares(world.elevation, world.width, world.height, -sh.depth, true);
    SHELF_CACHE.set(world, (hit = { rev, depth: sh.depth, c }));
  }
  const W = world.width;
  const pad = Math.max(2, 8 / scale);
  ctx.save();
  ctx.strokeStyle = sh.color;
  ctx.globalAlpha = sh.alpha;
  ctx.lineWidth = sh.width * Math.max(0.6, Math.min(1.8, scale));
  ctx.setLineDash([]);
  for (const c of hit.c) {
    // Cortas no: una isóbata de seis puntos es ruido de sonda, no una plataforma.
    if (c.pts.length < 24) continue;
    if (!polylineVisible(c.pts, view, W, pad)) continue;
    let pts = projectContour(c.pts, W, view, toX, toY);
    pts = chaikin(simplify(pts, 0.6), c.closed, 2);
    if (pts.length < 4) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (c.closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Punteado de mar abierto sobre una retícula anclada en el MUNDO.
 *
 * Anclada en el mundo y con paso derivado sólo de la escala, de modo que dos
 * teselas del mismo nivel puntean exactamente los mismos puntos y el empalme no
 * se ve. El punteado se apaga cerca de la costa (allí ya manda la anilla) y se
 * ralea con la sonda, que es como un grabado dice "aquí ya no hay fondo".
 *
 * Coste: (ancho/paso)·(alto/paso) candidatos — 7 500 en el pliego de 1600×800
 * con paso 13, medidos en 4 ms. Es O(área de salida), no O(rejilla del mundo).
 */
function drawSeaStipple(
  ctx: Ctx,
  world: WorldData,
  fields: CartoFields,
  theme: CartoTheme,
  view: CartoView,
  scale: number,
  OW: number,
  OH: number,
): void {
  const st = theme.ocean.stipple;
  if (!st.enabled || st.alpha <= 0.01) return;
  const { width: W, height: H, elevation } = world;
  const stepW = st.spacing / scale;           // paso en celdas de mundo
  const dot = Math.max(0.6, Math.min(1.9, 0.55 * Math.max(1, Math.min(2.4, scale))));
  // La anilla ocupa los primeros `count·spacing` px de mar; el punteado empieza
  // justo detrás para no ensuciarla.
  const ringPx = theme.ocean.rings.count * theme.ocean.rings.spacing + theme.ocean.rings.width;

  ctx.save();
  ctx.fillStyle = st.color;
  const x0 = Math.floor(view.x / stepW), x1 = Math.ceil((view.x + view.w) / stepW);
  const y0 = Math.floor(view.y / stepW), y1 = Math.ceil((view.y + view.h) / stepW);
  for (let gy = y0; gy <= y1; gy++) {
    const wy = gy * stepW;
    if (wy < 0 || wy >= H) continue;
    const yc = Math.min(H - 1, Math.max(0, Math.round(wy)));
    for (let gx = x0; gx <= x1; gx++) {
      const wx = gx * stepW;
      const xc = ((Math.round(wx) % W) + W) % W;
      const i = yc * W + xc;
      if (elevation[i] > 0) continue;
      const dPx = fields.seaDist[i] * scale;
      if (dPx < ringPx) continue;
      // Jitter y densidad por POSICIÓN: la misma agua se puntea igual en toda
      // tesela que la contenga.
      let hsh = (Math.imul(gx, 0x9e3779b1) ^ Math.imul(gy, 0x85ebca77)) >>> 0;
      hsh = Math.imul(hsh ^ (hsh >>> 15), 0x2c1b3c6d);
      hsh ^= hsh >>> 13;
      const jx = ((hsh & 0xff) / 255 - 0.5) * st.spacing * 0.75;
      const jy = (((hsh >>> 8) & 0xff) / 255 - 0.5) * st.spacing * 0.75;
      const keep = ((hsh >>> 16) & 0xff) / 255;
      // Se ralea hacia el mar abierto: 100 % en el borde de la anilla, 45 % a
      // partir de veinte anchuras de anilla mar adentro.
      const fade = Math.max(0.45, 1 - (dPx - ringPx) / (ringPx * 20 + 1) * 0.55);
      if (keep > fade) continue;
      const sx = (wx - view.x) * scale + jx;
      const sy = (wy - view.y) * scale + jy;
      if (sx < -2 || sy < -2 || sx > OW + 2 || sy > OH + 2) continue;
      ctx.globalAlpha = st.alpha * (0.6 + 0.4 * (((hsh >>> 24) & 0xff) / 255));
      ctx.fillRect(sx, sy, dot, dot);
    }
  }
  ctx.restore();
}

/**
 * Hachura de ladera: trazos cortos en la línea de máxima pendiente sobre el
 * terreno abrupto, DEBAJO de los símbolos de relieve.
 *
 * Es la respuesta al fallo de "montañas flotando sobre un llano liso": el
 * símbolo dice dónde hay una cumbre, la hachura dice que toda la falda que la
 * rodea también sube. Misma retícula anclada al mundo que el punteado, y por la
 * misma razón. Se apaga sola donde el relieve local no llega al cuantil del
 * tema, que en la práctica es el 70–75 % del pliego.
 */
function drawHachure(
  ctx: Ctx,
  world: WorldData,
  fields: CartoFields,
  theme: CartoTheme,
  view: CartoView,
  scale: number,
  OW: number,
  OH: number,
): void {
  const hc = theme.land.hachure;
  if (!hc.enabled || hc.alpha <= 0.01) return;
  const { width: W, height: H, elevation } = world;
  const minRel = fields.reliefQuantile(hc.slope);
  const span = Math.max(1e-4, fields.reliefQuantile(0.995) - minRel);
  const stepW = hc.spacing / scale;
  const len = hc.spacing * 0.9;

  ctx.save();
  ctx.strokeStyle = hc.color;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.45, 0.5 * Math.max(1, Math.min(2.2, scale)));
  const x0 = Math.floor(view.x / stepW), x1 = Math.ceil((view.x + view.w) / stepW);
  const y0 = Math.floor(view.y / stepW), y1 = Math.ceil((view.y + view.h) / stepW);
  for (let gy = y0; gy <= y1; gy++) {
    const wy = gy * stepW;
    if (wy < 1 || wy >= H - 1) continue;
    const yc = Math.min(H - 2, Math.max(1, Math.round(wy)));
    for (let gx = x0; gx <= x1; gx++) {
      const wx = gx * stepW;
      const xc = ((Math.round(wx) % W) + W) % W;
      const i = yc * W + xc;
      if (elevation[i] <= 0) continue;
      const rel = fields.relief[i];
      if (rel < minRel) continue;
      const sx = (wx - view.x) * scale;
      const sy = (wy - view.y) * scale;
      if (sx < -len || sy < -len || sx > OW + len || sy > OH + len) continue;
      // Línea de máxima pendiente. El trazo cae CUESTA ABAJO, que es la
      // convención de la hachura de Lehmann.
      const dx = elevation[yc * W + ((xc + 1) % W)] - elevation[yc * W + ((xc - 1 + W) % W)];
      const dy = elevation[(yc + 1) * W + xc] - elevation[(yc - 1) * W + xc];
      const g = Math.hypot(dx, dy);
      if (g < 1e-5) continue;
      let hsh = (Math.imul(gx, 0x27d4eb2d) ^ Math.imul(gy, 0x165667b1)) >>> 0;
      hsh = Math.imul(hsh ^ (hsh >>> 15), 0x2c1b3c6d);
      hsh ^= hsh >>> 13;
      const jx = ((hsh & 0xff) / 255 - 0.5) * hc.spacing * 0.6;
      const jy = (((hsh >>> 8) & 0xff) / 255 - 0.5) * hc.spacing * 0.6;
      // Cuanto más abrupto, más largo y más opaco el trazo: es la única forma
      // de que una hachura diga PENDIENTE y no sólo "aquí hay algo".
      const t = Math.min(1, (rel - minRel) / span);
      const L = len * (0.45 + 0.75 * t);
      ctx.globalAlpha = hc.alpha * (0.4 + 0.6 * t);
      ctx.beginPath();
      ctx.moveTo(sx + jx, sy + jy);
      ctx.lineTo(sx + jx - (dx / g) * L, sy + jy - (dy / g) * L);
      ctx.stroke();
    }
  }
  ctx.restore();
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
    // A tile shows a handful of rivers; the world holds hundreds. Skip the
    // simplify/smooth/stroke work for any river whose track can't touch the
    // view (same wrap placement as the draw below, so nothing visible drops).
    if (!polylineVisible(raw, view, W, Math.max(2, 8 / scale))) continue;
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
    // Simplifying a straight watercourse correctly leaves its two endpoints.
    // It is still a drawable line, not a missing river.
    if (pts.length < 2) continue;
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
  noise: (x: number, y: number) => number,
  scale: number,
  toX: (x: number) => number,
  toY: (y: number) => number,
): void {
  const W = world.width;
  const contours = allLakeShores(world);
  if (!contours.length) return;
  const lw = theme.lakes.width * Math.max(0.7, Math.min(2, scale));
  const cx = view.x + view.w / 2;
  const pad = Math.max(2, 8 / scale);
  ctx.save();
  for (const c of contours) {
    if (c.pts.length < 5) continue;
    if (!polylineVisible(c.pts, view, W, pad)) continue;
    let mean = 0;
    for (const p of c.pts) mean += p.x;
    mean /= c.pts.length;
    let shift = 0;
    while (mean + shift < cx - W / 2) shift += W;
    while (mean + shift > cx + W / 2) shift -= W;
    let pts = c.pts.map((p) => ({ x: toX(p.x + shift), y: toY(p.y) }));
    pts = chaikin(simplify(pts, 0.3), c.closed, 2);
    if (pts.length < 4) continue;
    pts = wobble(pts, 0.3, noise, c.closed);
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    };
    // PESO DE ORILLA: un trazo ancho y translúcido bajo el filete fino. Un lago
    // con una sola línea de un píxel se lee como un agujero recortado; el doble
    // trazo le da canto, que es lo que distingue una orilla de un contorno.
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = lw * 3.2;
    ctx.strokeStyle = theme.lakes.stroke;
    trace();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = lw;
    trace();
    ctx.stroke();
  }
  ctx.restore();
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
    // Spacing in world cells so consecutive symbols SE TAPAN: a 1.05 anchuras
    // los picos se tocaban sin solaparse y la sierra salía como una fila de
    // tiendas de campaña; a 0.82 cada uno oculta el pie del siguiente, que es
    // lo que da la oclusión del dibujo a mano.
    const step = Math.max(1.1, (mSize * 0.82) / bucketScale / density);
    const walk = resample(smooth, step, false);
    for (let k = 0; k < walk.length; k++) {
      const p = walk[k];
      const xi = ((Math.round(p.x) % W) + W) % W;
      const yi = Math.min(H - 1, Math.max(0, Math.round(p.y)));
      if (elevation[yi * W + xi] <= 0) continue;
      const sc = score[yi * W + xi];
      if (sc <= 0) continue;

      // ---- orientación a la cresta -----------------------------------------
      // La tangente local de la cadena, apuntando CUESTA ARRIBA: la cumbre se
      // inclina hacia el vecino más alto y el símbolo se ensancha cuando la
      // sierra corre de través (se ve de costado) y se estrecha cuando corre
      // hacia el lector (se ve de canto).
      const a = walk[Math.max(0, k - 1)], b = walk[Math.min(walk.length - 1, k + 1)];
      let tx = b.x - a.x, ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      const ea = elevation[Math.min(H - 1, Math.max(0, Math.round(a.y))) * W + ((Math.round(a.x) % W) + W) % W];
      const eb = elevation[Math.min(H - 1, Math.max(0, Math.round(b.y))) * W + ((Math.round(b.x) % W) + W) % W];
      const up = eb >= ea ? 1 : -1;
      const lean = Math.max(-1, Math.min(1, tx * up * 1.3));
      const broad = 0.74 + 0.52 * Math.abs(tx);

      // Desplazamiento PERPENDICULAR a la cresta. Una cadena colocada sobre la
      // línea exacta se lee como una fila de sellos; escalonada media anchura
      // se lee como una sierra con dos filas de cumbres.
      const jig = ((Math.sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453) % 1 + 1) % 1 - 0.5;
      const off = jig * (mSize * 0.9) / bucketScale;
      // Los extremos de la sierra se afinan: nada muere de golpe en el paisaje.
      const tip = Math.min(1, (Math.min(k, walk.length - 1 - k) + 1) / 3);

      const item: SymbolPlacement = {
        x: (((p.x - ty * off) % W) + W) % W,
        y: p.y + tx * off,
        score: sc * (0.58 + 0.42 * tip),
        isHill: false,
        lean, broad,
      };
      if (tooClose(item.x, item.y, sizeOf(item), 0.5)) continue;
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
    // Fuera de cadena la orientación sale del gradiente de altura: la cumbre
    // sigue inclinándose cuesta arriba, sólo que el "arriba" lo dice el terreno
    // en vez de la cresta.
    const xi = ((Math.round(p.x) % W) + W) % W;
    const yi = Math.min(H - 1, Math.max(0, Math.round(p.y)));
    const gx = elevation[yi * W + ((xi + 1) % W)] - elevation[yi * W + ((xi - 1 + W) % W)];
    const item: SymbolPlacement = {
      x: ((p.x % W) + W) % W, y: p.y, score: p.score, isHill: p.score < 1,
      lean: Math.max(-1, Math.min(1, gx * 2.4)),
      broad: 1,
    };
    if (tooClose(item.x, item.y, sizeOf(item), 0.72)) continue;
    push(item);
  }
  markDepth(placed, grid, gw, gh, cell, W, (p) => symWidth(sizeOf(p)) / bucketScale);
  return placed;
}

/**
 * Marca cuántos símbolos tapan a cada uno POR DELANTE (y mayor = más cerca del
 * lector en el orden del pintor). Es el insumo de la perspectiva aérea.
 *
 * Se calcula aquí, dentro de la colocación cacheada, y NO al dibujar: si la
 * profundidad dependiera de la lista visible, dos teselas vecinas darían valores
 * distintos al mismo pico y el empalme se vería. Coste O(n·k) con k ≈ 6 vecinos
 * de rejilla; medido en 2 ms para los 2 900 símbolos del pliego de mundo.
 */
function markDepth(
  items: SymbolPlacement[],
  grid: SymbolPlacement[][],
  gw: number,
  gh: number,
  cell: number,
  W: number,
  radiusOf: (p: SymbolPlacement) => number,
): void {
  for (const p of items) {
    const r = radiusOf(p) * 0.75;
    const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
    const span = Math.ceil(r / cell) + 1;
    let front = 0;
    for (let dy = -span; dy <= span; dy++) {
      const yy = gy + dy;
      if (yy < 0 || yy >= gh) continue;
      for (let dx = -span; dx <= span; dx++) {
        const xx = ((gx + dx) % gw + gw) % gw;
        for (const o of grid[yy * gw + xx]) {
          if (o === p || o.y <= p.y) continue;
          let ddx = o.x - p.x;
          if (ddx > W / 2) ddx -= W;
          if (ddx < -W / 2) ddx += W;
          const ddy = o.y - p.y;
          if (ddx * ddx + ddy * ddy < r * r) front++;
        }
      }
    }
    // /3.5, no /2.2: con el divisor bajo dos vecinos bastaban para lavar el
    // símbolo entero y las cumbres del fondo desaparecían del papel.
    p.depth = Math.min(1, front / 3.5);
  }
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
  // Pad covers the TALLEST possible glyph (score and jitter maxed), so a
  // mountain whose feet sit just past an edge still pokes its peak into the
  // view instead of popping: h <= mSize*1.75*(1+sizeJitter) ~= 2.45*mSize.
  const pad = (mSize / scale) * 2.6;
  const cx = view.x + view.w / 2;

  // Clip to the viewport HERE, not during placement: the layout must not depend
  // on where the reader is looking.
  const visible: { x: number; wx: number; y: number; size: number; isHill: boolean; p: SymbolPlacement }[] = [];
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
      p,
    });
  }
  // Painter's algorithm: back to front by the symbol's base line.
  visible.sort((a, b) => a.y - b.y);

  const landBase = theme.land.base;
  for (const { x, wx, y, isHill, size, p } of visible) {
    const sx = toX(x), sy = toY(y);
    const jitterSeed = rngFor(seed, wx, y);
    const h = size * (1 + (jitterSeed() - 0.5) * 2 * theme.mountains.sizeJitter);
    const ratio = isHill ? 1.7 + jitterSeed() * 0.8 : 2.3 + jitterSeed() * 2.2;
    const w = h * ratio * 0.55 * (p.broad ?? 1);

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
    drawMountain(ctx, jitterSeed, theme, {
      h, w, snow, fill: landBase,
      lean: p.lean ?? 0,
      depth: p.depth ?? 0,
      tone: jitterSeed() * 2 - 1,
      paper: theme.paper.base,
    }, isHill);
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
    // El hielo tenía puntuación cero: los casquetes salían como manchas blancas
    // lisas, el único bioma del mapa sin una sola marca dibujada encima.
    else if (b === Biome.IceCap || b === Biome.Glacier) score[i] = 0.16;
  }
  const tSize = theme.forest.size * Math.max(0.5, Math.min(1.8, 0.5 + 0.5 * bucketScale));
  // Keep canopy off the ground the relief symbols already occupy.
  const reliefCap = fields.reliefQuantile(0.8);
  // Same scale-invariance argument as the relief budget.
  const budget = Math.round(Math.min(400_000, Math.max(26_000, 26_000 * bucketScale * bucketScale)));

  // Distancia al borde de la masa: 1 en las celdas que NO son bosque, luego
  // `distanceTo` devuelve para cada celda de bosque su distancia al claro más
  // cercano. Es un O(W·H) más dentro de una función ya cacheada — el mismo
  // orden que el bucle de puntuación de arriba.
  const edge = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (score[i] <= 0.4) edge[i] = 1;
  const stand = distanceTo(edge, W, H);
  const massAt = (x: number, y: number): number => {
    const xi = ((Math.round(x) % W) + W) % W;
    const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
    return Math.min(1, stand[yi * W + xi] / 5);
  };

  const pts = scatterByScore(score, W, H, {
    minScore: 0.1,
    // El corazón de la masa se aprieta un 30 % respecto a la orilla: es lo que
    // hace que un bosque tenga BORDE en vez de desvanecerse por igual.
    radiusAt: (sc, x, y) =>
      Math.max(1.0, (tSize * (sc > 0.4 ? 0.95 : 2.1) * (1.15 - 0.34 * massAt(x, y))) / bucketScale / density),
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
  return pts.map((p) => ({
    x: ((p.x % W) + W) % W, y: p.y, score: p.score, isHill: false, mass: massAt(p.x, p.y),
  }));
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
  // Same rule as relief: cover the LARGEST stamp (dune kind scales 1.7×), so
  // nothing pops at a view or tile edge.
  const pad = (tSize / scale) * 2.6;
  const cx = view.x + view.w / 2;

  const visible: { x: number; wx: number; y: number; mass: number }[] = [];
  for (const p of all) {
    let x = p.x;
    while (x < cx - W / 2) x += W;
    while (x > cx + W / 2) x -= W;
    if (p.y < view.y - pad || p.y > view.y + view.h + pad) continue;
    if (x < view.x - pad || x > view.x + view.w + pad) continue;
    visible.push({ x, wx: p.x, y: p.y, mass: p.mass ?? 0.5 });
  }
  visible.sort((a, b) => a.y - b.y);

  for (const { x, wx, y, mass } of visible) {
    const xi = ((Math.round(wx) % W) + W) % W;
    const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
    const b = biome[yi * W + xi];
    const T = temperature[yi * W + xi];
    const r = rngFor(seed, wx, y);
    // La copa crece hacia el corazón de la masa: 0.74× en la orilla, 1.1× dentro.
    const h = tSize * (0.74 + 0.36 * mass) * (1 + (r() - 0.5) * 2 * theme.forest.sizeJitter);
    // Marsh: wet, nearly flat, close to standing water or a river mouth.
    const wetland = world.precipitation[yi * W + xi] > 1100
      && fields.relief[yi * W + xi] < fields.reliefQuantile(0.25)
      && world.elevation[yi * W + xi] < 0.35;

    // Which symbol this cell gets, decided once so the CPU and GPU paths cannot
    // disagree about what is standing there.
    let kind: EmittedSymbol['kind'];
    let scale2 = 1;
    if (b === Biome.IceCap || b === Biome.Glacier) {
      kind = 'ice'; scale2 = 2.2;
    } else if (b === Biome.Desert) {
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
      emit({ kind, x: toX(x), y: toY(y), w: hh * (kind === 'dune' || kind === 'marsh' || kind === 'ice' ? 1.9 : 1), h: hh, variant: r(), snow: 0 });
      continue;
    }
    // Dentro de la masa hay bruma: los ejemplares del corazón se lavan hacia el
    // papel y los de la orilla quedan nítidos. Sale de `mass`, que ya está
    // calculado — no cuesta una segunda pasada de oclusión como en el relieve.
    const depth = mass * 0.85;
    ctx.save();
    ctx.translate(toX(x), toY(y));
    switch (kind) {
      case 'cactus': drawCactus(ctx, r, theme, hh); break;
      case 'dune': drawDune(ctx, r, theme, hh); break;
      case 'palm': drawPalm(ctx, r, theme, hh); break;
      case 'conifer': drawConifer(ctx, r, theme, hh, depth); break;
      case 'marsh': drawMarsh(ctx, r, theme, hh); break;
      case 'ice': drawIce(ctx, r, theme, hh); break;
      default: drawBroadleaf(ctx, r, theme, hh, depth); break;
    }
    ctx.restore();
  }
  return visible.length;
}

export { rgbCss, resample };
