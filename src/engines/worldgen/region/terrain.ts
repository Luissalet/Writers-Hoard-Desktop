// ============================================
// Regional sheet — Terrain and water
// ============================================
// Everything below the world's own resolution has to be INVENTED, and the whole
// difficulty is inventing it in a way that (a) agrees exactly with the world map
// where the world map has an opinion, and (b) agrees with the neighbouring
// window where it doesn't.
//
// Both fall out of one rule: every synthesised value is a function of WORLD
// coordinates, never of sheet coordinates. The detail noise is the same
// spherical noise the planet is built from, sampled at a frequency the world
// grid could not resolve; slide the window one metre east and the ground does
// not move, it just gets re-sampled.

import { SphereNoise } from '../core/noise';
import { riverKey } from '../core/edits';
import { resample } from '../cartography/contours';
import type { WorldData } from '../core/types';
import type { RegionParams, RegionStream, RegionWindow } from './types';

const EARTH_KM = 2 * Math.PI * 6371;

/** How wide one world cell is on the ground. */
export function kmPerWorldCell(world: WorldData): number {
  return EARTH_KM / world.width;
}

export interface RegionGeometry {
  /** FULL grid including the working margin. */
  width: number;
  height: number;
  /**
   * Cells of overhang generated outside the sheet on every side.
   *
   * Hydrology has no way to know about a catchment it cannot see: a river
   * entering from off-page arrives with no drainage area behind it, and every
   * cell within a few dozen of the edge drains to the border instead of to
   * wherever it really goes. Generating wider than the sheet and cropping puts
   * that whole class of error outside the paper.
   */
  margin: number;
  metresPerCell: number;
  originX: number;
  originY: number;
  worldPerCellX: number;
  worldPerCellY: number;
}

/** The part of the grid that is actually the sheet. */
export function visibleRect(g: RegionGeometry): { x0: number; y0: number; w: number; h: number } {
  return { x0: g.margin, y0: g.margin, w: g.width - g.margin * 2, h: g.height - g.margin * 2 };
}

/**
 * Resolve a window into a grid.
 *
 * The sheet's RESOLUTION is fixed and its SPAN is what varies, rather than the
 * other way round: that keeps the cost of a sheet constant no matter how far
 * out the reader pulls, which is the difference between a zoom that feels like
 * a map and a zoom that feels like a progress bar.
 */
export function regionGeometry(
  world: WorldData,
  win: RegionWindow,
  params: RegionParams,
): RegionGeometry {
  const W = Math.max(64, Math.round(params.res));
  const H = Math.max(64, Math.round(W / Math.max(0.4, params.aspect)));
  const kmCell = kmPerWorldCell(world);
  const spanCells = win.spanKm / kmCell;
  const per = spanCells / W;
  const margin = Math.min(64, Math.max(12, Math.round(W * 0.055)));

  // The origin is SNAPPED to the cell pitch, and that one line is what makes
  // panning trustworthy.
  //
  // Without it the sheet's grid slides continuously under the world: every cell
  // samples a slightly different point, so the elevation changes, so the D8
  // network changes, so the streams move, so the site scores move, so the
  // villages move and get renamed. Measured, a pan of 27 km kept 45 of 69
  // village names. Snapping makes the grid a subset of one global lattice per
  // zoom level, so an overlapping window re-samples the SAME points and gets the
  // same country — the sheet slides, the ground does not.
  const snap = (v: number) => Math.round(v / per) * per;
  return {
    width: W + margin * 2,
    height: H + margin * 2,
    margin,
    metresPerCell: (win.spanKm * 1000) / W,
    originX: snap(win.cx - spanCells / 2 - margin * per),
    originY: snap(win.cy - (per * H) / 2 - margin * per),
    worldPerCellX: per,
    worldPerCellY: per,
  };
}

// ---------------------------------------------------------------------------
// World patch — the window's footprint, with padding, copied out once
// ---------------------------------------------------------------------------

export interface WorldPatch {
  x0: number;
  y0: number;
  w: number;
  h: number;
  elev: Float32Array;
  biome: Uint8Array;
  temp: Float32Array;
  prec: Float32Array;
  lake: Uint8Array;
  ice: Float32Array;
  flow: Float32Array;
}

const PAD = 3;

export function extractPatch(world: WorldData, g: RegionGeometry): WorldPatch {
  const x0 = Math.floor(g.originX) - PAD;
  const y0 = Math.floor(g.originY) - PAD;
  const w = Math.ceil(g.width * g.worldPerCellX) + PAD * 2 + 2;
  const h = Math.ceil(g.height * g.worldPerCellY) + PAD * 2 + 2;
  const n = w * h;
  const p: WorldPatch = {
    x0, y0, w, h,
    elev: new Float32Array(n), biome: new Uint8Array(n), temp: new Float32Array(n),
    prec: new Float32Array(n), lake: new Uint8Array(n), ice: new Float32Array(n),
    flow: new Float32Array(n),
  };
  const WW = world.width, WH = world.height;
  for (let j = 0; j < h; j++) {
    const wy = Math.min(WH - 1, Math.max(0, y0 + j));
    for (let i = 0; i < w; i++) {
      const wx = (((x0 + i) % WW) + WW) % WW;
      const s = wy * WW + wx;
      const d = j * w + i;
      p.elev[d] = world.elevation[s];
      p.biome[d] = world.biome[s];
      p.temp[d] = world.temperature[s];
      p.prec[d] = world.precipitation[s];
      p.lake[d] = world.lake[s];
      p.ice[d] = world.ice[s];
      p.flow[d] = world.flow[s];
    }
  }
  return p;
}

/** Bilinear sample of a patch field at world coordinates. */
export function patchBilinear(p: WorldPatch, f: Float32Array, wx: number, wy: number): number {
  const fx = wx - p.x0, fy = wy - p.y0;
  const ix = Math.min(p.w - 2, Math.max(0, Math.floor(fx)));
  const iy = Math.min(p.h - 2, Math.max(0, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - ix));
  const ty = Math.min(1, Math.max(0, fy - iy));
  const a = f[iy * p.w + ix], b = f[iy * p.w + ix + 1];
  const c = f[(iy + 1) * p.w + ix], d = f[(iy + 1) * p.w + ix + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Nearest sample of a patch's integer field. */
export function patchNearest(p: WorldPatch, f: Uint8Array, wx: number, wy: number): number {
  const ix = Math.min(p.w - 1, Math.max(0, Math.round(wx - p.x0)));
  const iy = Math.min(p.h - 1, Math.max(0, Math.round(wy - p.y0)));
  return f[iy * p.w + ix];
}

/**
 * A noise field evaluated on a coarse lattice and interpolated.
 *
 * Almost every noise term on a sheet is far smoother than one sheet cell: the
 * biome warp has a fifty-kilometre wavelength and was being evaluated at every
 * one of 273 000 cells, which is 6 million simplex evaluations to describe a
 * field that has about forty independent values across the whole page. On the
 * ground-cover pass alone that was 573 ms — more than a quarter of the cost of
 * a sheet — spent computing, very precisely, a number that barely changes.
 *
 * `step` must be at most half the shortest wavelength in the field, or the
 * interpolation aliases. Everything using this passes a step derived from its
 * own top octave rather than a guess.
 */
export class CoarseField {
  private w: number;
  private h: number;
  private step: number;
  private ox: number;
  private oy: number;
  private v: Float32Array;

  /**
   * `ox`/`oy` place lattice node 0 at that SHEET coordinate, which is normally
   * negative. They exist so the lattice can be anchored to the world rather
   * than to the page — see `latticeOffset`, and read the note there before
   * touching any of this.
   */
  constructor(
    gw: number, gh: number, step: number,
    sample: (x: number, y: number) => number,
    ox = 0, oy = 0,
  ) {
    this.step = Math.max(1, Math.round(step));
    this.ox = ox;
    this.oy = oy;
    this.w = Math.ceil((gw - ox) / this.step) + 2;
    this.h = Math.ceil((gh - oy) / this.step) + 2;
    this.v = new Float32Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        this.v[j * this.w + i] = sample(this.ox + i * this.step, this.oy + j * this.step);
      }
    }
  }

  at(x: number, y: number): number {
    const fx = (x - this.ox) / this.step, fy = (y - this.oy) / this.step;
    const ix = Math.min(this.w - 2, Math.max(0, Math.floor(fx)));
    const iy = Math.min(this.h - 2, Math.max(0, Math.floor(fy)));
    const tx = fx - ix, ty = fy - iy;
    const a = this.v[iy * this.w + ix], b = this.v[iy * this.w + ix + 1];
    const c = this.v[(iy + 1) * this.w + ix], d = this.v[(iy + 1) * this.w + ix + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
}

/**
 * Where to put a coarse lattice so it belongs to the world and not to the page.
 *
 * This is the second half of the snapping story, and leaving it out undid the
 * first half completely. Snapping the origin makes sheet cell *x* sample the
 * same world point in every window — but a lattice indexed from the sheet's own
 * corner puts its nodes at sheet 0, 3, 6…, and those are different world points
 * every time the window moves by anything that is not a multiple of the step.
 * The interpolated field then changes everywhere, so the elevation changes
 * everywhere, and the measurement said 99.98 % of the overlap differed even
 * though the origin was snapped to the cell.
 *
 * Offsetting the lattice so its nodes land on global cell indices divisible by
 * the step fixes it: the nodes are the same world points in every window, and
 * two overlapping sheets interpolate the same field from the same samples.
 */
export function latticeOffset(g: RegionGeometry, step: number): { ox: number; oy: number } {
  const bx = Math.round(g.originX / g.worldPerCellX);
  const by = Math.round(g.originY / g.worldPerCellY);
  const st = Math.max(1, Math.round(step));
  return { ox: -(((bx % st) + st) % st), oy: -(((by % st) + st) % st) };
}

/**
 * fBm split into a coarse part and a fine part.
 *
 * A six-octave fBm whose base wavelength is seven kilometres has its first three
 * octaves at 7, 3.3 and 1.6 km — on a 188-metre grid those are 37, 18 and 8
 * cells across, so evaluating them per cell computes the same number eight times
 * over. They go on a lattice; only the octaves that genuinely vary cell to cell
 * are evaluated per cell.
 *
 * The normalisation is the whole subtlety: the two halves must be summed and
 * divided by the SAME total amplitude the unsplit fBm would have used, or the
 * field changes magnitude when the split point moves — which would make the
 * relief depend on the zoom level, and the sheet would stop being deterministic
 * in the one way that matters.
 */
export class SplitFbm {
  private coarse: CoarseField | null;
  private noise: SphereNoise;
  private freqFine: number;
  private ampFine: number[];
  private norm: number;
  private lac: number;
  private firstFine: number;

  constructor(
    noise: SphereNoise, g: RegionGeometry,
    uv: (x: number, y: number) => { u: number; v: number },
    baseKm: number, octaves: number, lac: number, gain: number,
    cellKm: number, cycPerKm: (km: number) => number,
  ) {
    const gw = g.width, gh = g.height;
    this.noise = noise;
    this.lac = lac;
    const step = 3;
    const smoothEnough = 2.5 * step * cellKm;
    let k = 0;
    while (k < octaves && baseKm / Math.pow(lac, k) >= smoothEnough) k++;
    // Always leave at least one octave per cell, or the field is a blur; never
    // put fewer than two on the lattice, or the split costs more than it saves.
    if (k >= octaves) k = octaves - 1;
    if (k < 2) k = 0;
    this.firstFine = k;

    let norm = 0;
    for (let o = 0; o < octaves; o++) norm += Math.pow(gain, o);
    this.norm = norm;

    const f0 = cycPerKm(baseKm);
    this.freqFine = f0 * Math.pow(lac, k);
    this.ampFine = [];
    for (let o = k; o < octaves; o++) this.ampFine.push(Math.pow(gain, o));

    if (k > 0) {
      const off = latticeOffset(g, step);
      this.coarse = new CoarseField(gw, gh, step, (x, y) => {
        const p = uv(x, y);
        let sum = 0, amp = 1, f = f0;
        for (let o = 0; o < k; o++) {
          sum += amp * noise.sample(p.u, p.v, f);
          amp *= gain;
          f *= lac;
        }
        return sum;
      }, off.ox, off.oy);
    } else this.coarse = null;
  }

  at(x: number, y: number, u: number, v: number): number {
    let sum = this.coarse ? this.coarse.at(x, y) : 0;
    let f = this.freqFine;
    for (let o = 0; o < this.ampFine.length; o++) {
      sum += this.ampFine[o] * this.noise.sample(u, v, f);
      f *= this.lac;
    }
    void this.firstFine;
    return sum / this.norm;
  }
}

function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/**
 * Bicubic sample, clamped to the neighbourhood.
 *
 * Catmull-Rom overshoots badly at a coastline — a 3 km cliff between two world
 * cells becomes a 500 m ridge in the sea and a hollow inland, and the sheet grows
 * a reef and a lagoon that the world map does not have. Clamping to the 4×4
 * extremes keeps the smoothness everywhere it is harmless and removes exactly
 * the case where it isn't.
 */
export function patchBicubic(p: WorldPatch, f: Float32Array, wx: number, wy: number): number {
  const fx = wx - p.x0, fy = wy - p.y0;
  const ix = Math.min(p.w - 3, Math.max(1, Math.floor(fx)));
  const iy = Math.min(p.h - 3, Math.max(1, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - ix));
  const ty = Math.min(1, Math.max(0, fy - iy));
  let lo = Infinity, hi = -Infinity;
  const col = new Float64Array(4);
  for (let j = -1; j <= 2; j++) {
    const row = (iy + j) * p.w;
    const v0 = f[row + ix - 1], v1 = f[row + ix], v2 = f[row + ix + 1], v3 = f[row + ix + 2];
    if (j >= 0 && j <= 1) {
      lo = Math.min(lo, v0, v1, v2, v3);
      hi = Math.max(hi, v0, v1, v2, v3);
    }
    col[j + 1] = catmull(v0, v1, v2, v3, tx);
  }
  // Clamped with a little slack rather than hard. A hard clamp removes the
  // overshoot, but it does it by turning every steep neighbourhood into a
  // PLATEAU pinned at the local extreme — and a plateau either side of sea level
  // makes the shoreline a chain of rectangles, which is what a coast made of
  // world cells looked like before the slack went in.
  const pad = (hi - lo) * 0.18;
  const v = catmull(col[0], col[1], col[2], col[3], ty);
  return Math.min(hi + pad, Math.max(lo - pad, v));
}

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------

export interface TerrainFields {
  elevation: Float32Array;
  water: Uint8Array;
  /** Log-scaled drainage 0–1, for thresholds and costs. */
  flow: Float32Array;
  /** Drainage area in CELLS — the physical quantity, for honest river widths. */
  accum: Float32Array;
  slope: Float32Array;
  wet: Float32Array;
  filled: Float32Array;
  /** Downstream neighbour index, -1 at a sink or outlet. */
  down: Int32Array;
}

/**
 * Synthesise sheet elevation from the world plus invented sub-cell relief.
 *
 * Three noise terms, because three different things are missing at 20 km:
 *  · `fine`    — the general grain of the ground, scaled by how rough the world
 *                already is here. Flat country stays flat; a cordillera gets
 *                spurs and side valleys.
 *  · `ridge`   — ridged multifractal, weighted by slope, so mountains get
 *                CRESTS rather than lumps. Without it, a zoomed-in mountain
 *                range looks like bubble wrap.
 *  · `coast`   — displacement proportional to the local gradient, applied only
 *                near sea level. Proportional to the gradient because that makes
 *                the shoreline move a roughly constant DISTANCE regardless of
 *                how steep the margin is; a fixed height offset would leave a
 *                cliff coast razor-straight and turn a shelf coast into soup.
 */
export function buildElevation(
  world: WorldData,
  g: RegionGeometry,
  patch: WorldPatch,
  params: RegionParams,
): Float32Array {
  const W = g.width, H = g.height;
  const out = new Float32Array(W * H);
  const seed = world.params.seed;
  const fine = new SphereNoise(seed, 'region-fine');
  const ridge = new SphereNoise(seed, 'region-ridge');
  const coast = new SphereNoise(seed, 'region-coast');
  const WW = world.width;

  // Frequencies are PHYSICAL — a wavelength in kilometres, converted to cycles
  // around the planet — not multiples of the world grid.
  //
  // This distinction is the whole difference between a sheet with hills on it
  // and a sheet without. Tying the base octave to the world grid (`W × 1.6`)
  // puts the dominant landform at 24 km, which across a 120 km sheet is four
  // gentle swells and a measured median slope of 1.2 % — a billiard table with
  // a coastline. The characteristic landform of a REGION is a valley a few
  // kilometres wide, and it is that size whether the world grid is 1024 cells
  // or 8192, so it has to be specified in kilometres and nothing else.
  const cyc = (km: number) => EARTH_KM / km;
  const cellKm = g.metresPerCell / 1000;
  // Down to twice the sheet cell — below that the detail is smaller than a pixel
  // and costs a noise evaluation to be invisible.
  const oct = Math.max(3, Math.min(8, Math.round(Math.log2(7000 / (2 * g.metresPerCell))) + 1));

  const uvAt = (x: number, y: number) => {
    const wy = g.originY + (y + 0.5) * g.worldPerCellY;
    const wx = g.originX + (x + 0.5) * g.worldPerCellX;
    return { u: ((wx / WW) % 1 + 1) % 1, v: Math.min(1, Math.max(0, wy / world.height)) };
  };

  const fineF = new SplitFbm(fine, g, uvAt, 7, oct, 2.05, 0.5, cellKm, cyc);
  const coastF = new SplitFbm(coast, g, uvAt, 2.5, Math.max(4, oct - 2), 2.2, 0.55, cellKm, cyc);
  const fRidge = cyc(4.5);
  const ridgeOct = Math.max(3, oct - 1);

  // The WORLD's own elevation and gradient are, at sheet scale, extremely
  // smooth: one world cell is two hundred sheet cells. Bicubic-sampling them per
  // cell — sixteen array reads and five Catmull-Rom evaluations apiece — is the
  // same waste as evaluating a fifty-kilometre noise field per cell.
  const off6 = latticeOffset(g, 6);
  const baseF = new CoarseField(W, H, 6, (x, y) => {
    const wy = g.originY + (y + 0.5) * g.worldPerCellY;
    const wx = g.originX + (x + 0.5) * g.worldPerCellX;
    return patchBicubic(patch, patch.elev, wx, wy);
  }, off6.ox, off6.oy);
  const gradF = new CoarseField(W, H, 6, (x, y) => {
    const wy = g.originY + (y + 0.5) * g.worldPerCellY;
    const wx = g.originX + (x + 0.5) * g.worldPerCellX;
    const e = 0.5;
    const gx = patchBilinear(patch, patch.elev, wx + e, wy) - patchBilinear(patch, patch.elev, wx - e, wy);
    const gy = patchBilinear(patch, patch.elev, wx, wy + e) - patchBilinear(patch, patch.elev, wx, wy - e);
    return Math.hypot(gx, gy);
  }, off6.ox, off6.oy);

  const detail = params.detail;
  const rugged = 0.5 + world.params.ruggedness;
  const coastal = 0.35 + world.params.coastalComplexity * 0.9;

  for (let y = 0; y < H; y++) {
    const wy = g.originY + (y + 0.5) * g.worldPerCellY;
    const v = Math.min(1, Math.max(0, wy / world.height));
    for (let x = 0; x < W; x++) {
      const wx = g.originX + (x + 0.5) * g.worldPerCellX;
      const u = ((wx / WW) % 1 + 1) % 1;

      const base = baseF.at(x, y);
      const grad = gradF.at(x, y);

      // Relief drives how much detail is plausible: you cannot invent a gorge
      // in the middle of a steppe, and you must invent one in a cordillera.
      //
      // The CONSTANT term is the part that took a wrong picture to learn. Scale
      // the invented relief purely by the world's gradient and lowland comes out
      // dead flat — a millpond with five metres of undulation across a hundred
      // kilometres, which is not what flat country is. Real "flat" carries
      // 40–80 m of local relief; it is flat relative to mountains, not relative
      // to a table. Without the floor the whole sheet reads as a swamp, because
      // with no gradient every hollow fills and every hollow is wet.
      const relief = Math.min(1.6, grad * 1.6 + Math.max(0, base) * 0.35);
      const ampFine = (0.075 + relief * 0.42) * detail * rugged;
      const ampRidge = relief * 0.40 * detail * rugged;

      let h = base + ampFine * fineF.at(x, y, u, v);
      // Ridged multifractal cannot be split the way an fBm can: each octave is
      // weighted by the one above it, so the octaves are not independent and a
      // partial sum is not a partial answer. It stays per cell, and it is gated
      // to the ground that can plausibly carry crests.
      if (ampRidge > 0.006) {
        h += ampRidge * (ridge.ridged(u, v, fRidge, ridgeOct, 2.1, 0.55) - 0.42);
      }

      // Coastal crenulation, only where it can move a shoreline.
      const nearSea = Math.exp(-(base * base) / (0.36 * 0.36));
      if (nearSea > 0.01) {
        h += nearSea * Math.max(grad, 0.08) * coastal * 0.34 * coastF.at(x, y, u, v);
      }

      out[y * W + x] = h;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// World rivers become the sheet's trunk streams
// ---------------------------------------------------------------------------

export interface CarvedRiver {
  /** Sheet-space polyline, already clipped with a margin. */
  pts: { x: number; y: number }[];
  flow: number;
  worldIndex: number;
}

/**
 * Cut the world's rivers into the sheet before the hydrology runs.
 *
 * The alternative — running local hydrology and hoping the same valley comes
 * out — does not work and is not even close: the sheet's inflow from off-window
 * is invisible to a local flow accumulation, so the Guadalquivir turns into a
 * brook. Carving a groove and injecting the upstream discharge makes the sheet's
 * trunk river the SAME river the world map draws, in the same valley, at the
 * same width.
 */
export function carveWorldRivers(
  world: WorldData,
  g: RegionGeometry,
  elev: Float32Array,
): CarvedRiver[] {
  const W = g.width, H = g.height;
  const WW = world.width;
  const out: CarvedRiver[] = [];
  const margin = 6;

  // The reader's hand-drawn rivers are rivers, not scars: they carve the same
  // channel, inject the same discharge and carry a trunk identity, exactly like
  // the generated ones — and a generated river the reader deleted stays
  // deleted here, the same rule both 2D renderers already keep.
  const gone = world.painted?.removed ?? new Set<string>();
  const rivers: { cells: ArrayLike<number>; flow: number }[] = [
    ...world.rivers.filter((r) => !gone.has(riverKey(r.cells))),
    ...(world.painted?.rivers ?? []),
  ];

  const toSheet = (wx: number, wy: number) => {
    // Choose the wrapped longitude nearest the window so a sheet straddling the
    // antimeridian does not get a river drawn across the whole page.
    let dx = wx - g.originX;
    while (dx < -WW / 2) dx += WW;
    while (dx > WW / 2) dx -= WW;
    return { x: dx / g.worldPerCellX, y: (wy - g.originY) / g.worldPerCellY };
  };

  // Whether a river touches the sheet is a question about its SEGMENTS, not its
  // vertices. A world river's vertices are one world cell apart — on a 120 km
  // sheet that is two hundred sheet cells — so a river can cross the page from
  // edge to edge without a single vertex landing on it. Testing vertices found
  // trunk rivers on about one sheet in ten, and every other sheet quietly lost
  // its main river and named nothing.
  const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
    const x0 = -margin, y0 = -margin, x1 = W + margin, y1 = H + margin;
    if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1) return false;
    if (Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) return false;
    // Bounding boxes overlap; for a segment this coarse that is close enough,
    // but reject the diagonal-miss case properly.
    const dx = b.x - a.x, dy = b.y - a.y;
    if (a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1) return true;
    if (b.x >= x0 && b.x <= x1 && b.y >= y0 && b.y <= y1) return true;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] as [number, number][]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  };

  for (let ri = 0; ri < rivers.length; ri++) {
    const r = rivers[ri];
    const raw: { x: number; y: number }[] = [];
    for (let k = 0; k < r.cells.length; k++) {
      const c = r.cells[k];
      raw.push(toSheet(c % WW, (c / WW) | 0));
    }
    if (raw.length < 2) continue;
    let inside = false;
    for (let k = 1; k < raw.length && !inside; k++) inside = overlaps(raw[k - 1], raw[k]);
    if (!inside) continue;

    // Keep the run that touches the window, plus one node of overhang at each
    // end so the channel enters and leaves the page instead of starting at it.
    let lo = raw.length, hi = -1;
    for (let k = 1; k < raw.length; k++) {
      if (!overlaps(raw[k - 1], raw[k])) continue;
      if (k - 1 < lo) lo = k - 1;
      if (k > hi) hi = k;
    }
    if (hi <= lo) continue;
    const seg = raw.slice(Math.max(0, lo - 1), Math.min(raw.length, hi + 2));
    // Resample by ARC LENGTH, not by segments-per-span. Smoothing a world river
    // into a fixed number of points per world cell puts those points hundreds of
    // sheet cells apart when the sheet is small, and since the channel is carved
    // as a disc at each point the result was a string of beads with gaps between
    // them — so the drainage never followed the river, no stream was ever marked
    // as a trunk, and every sheet silently lost its main river and its name.
    const pts = resample(smoothPolyline(seg, 12), 0.75, false);
    if (pts.length < 3) continue;
    out.push({ pts, flow: r.flow, worldIndex: ri });
  }

  // Deepest first, so a tributary carved later does not cut through its trunk.
  out.sort((a, b) => a.flow - b.flow);
  for (const r of out) {
    const depth = 0.012 + 0.055 * r.flow;
    const half = 1.1 + 3.4 * r.flow;
    carveChannel(elev, W, H, r.pts, half, depth);
  }
  return out;
}

/** Catmull-Rom resample of a coarse polyline into `per` points per segment. */
export function smoothPolyline(pts: { x: number; y: number }[], per: number): { x: number; y: number }[] {
  if (pts.length < 2) return pts.slice();
  const n = Math.max(1, Math.min(24, Math.round(per)));
  const at = (i: number) => pts[Math.min(pts.length - 1, Math.max(0, i))];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < n; s++) {
      const t = s / n;
      out.push({
        x: catmull(p0.x, p1.x, p2.x, p3.x, t),
        y: catmull(p0.y, p1.y, p2.y, p3.y, t),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function carveChannel(
  elev: Float32Array, W: number, H: number,
  pts: { x: number; y: number }[], half: number, depth: number,
): void {
  const r = Math.ceil(half) + 1;
  // The cut is accumulated as a MAXIMUM into a scratch buffer and applied once.
  // Subtracting it in place, disc by disc, compounds every overlap: the points
  // are three quarters of a cell apart and each disc is four cells across, so
  // every cell got cut about ten times and a forty-metre channel came out as a
  // two-hundred-and-eighty-metre canyon that swallowed the whole valley.
  const cut = new Map<number, number>();
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const cx = Math.round(p.x), cy = Math.round(p.y);
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= W) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d >= half) continue;
        // A V of bank either side of a flat bed reads as a valley from above;
        // a cylinder gouge reads as a trench.
        const t = d / (half + 1e-6);
        const c = depth * (1 - t * t);
        const i = y * W + x;
        const prev = cut.get(i);
        if (prev === undefined || c > prev) cut.set(i, c);
      }
    }
  }
  for (const [i, c] of cut) elev[i] -= c;
}

// ---------------------------------------------------------------------------
// Hydrology: priority flood, D8, accumulation
// ---------------------------------------------------------------------------

class Heap {
  private key: Float64Array;
  private val: Int32Array;
  private n = 0;
  constructor(cap: number) {
    this.key = new Float64Array(cap);
    this.val = new Int32Array(cap);
  }
  get size(): number { return this.n; }
  push(k: number, v: number): void {
    if (this.n >= this.key.length) {
      const nk = new Float64Array(this.key.length * 2);
      const nv = new Int32Array(this.val.length * 2);
      nk.set(this.key); nv.set(this.val);
      this.key = nk; this.val = nv;
    }
    let i = this.n++;
    this.key[i] = k; this.val[i] = v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key[p] <= this.key[i]) break;
      const tk = this.key[p]; this.key[p] = this.key[i]; this.key[i] = tk;
      const tv = this.val[p]; this.val[p] = this.val[i]; this.val[i] = tv;
      i = p;
    }
  }
  pop(): number {
    const top = this.val[0];
    this.n--;
    if (this.n > 0) {
      this.key[0] = this.key[this.n];
      this.val[0] = this.val[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.key[l] < this.key[m]) m = l;
        if (r < this.n && this.key[r] < this.key[m]) m = r;
        if (m === i) break;
        const tk = this.key[m]; this.key[m] = this.key[i]; this.key[i] = tk;
        const tv = this.val[m]; this.val[m] = this.val[i]; this.val[i] = tv;
        i = m;
      }
    }
    return top;
  }
}

const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Priority-flood depression filling with an ε tilt.
 *
 * The ε matters: a perfectly flat filled basin has no downhill direction, so D8
 * gives every cell in it the same arbitrary neighbour and the lake drains in a
 * spiral. Raising each filled cell an invisible sliver above the one it was
 * reached from gives the basin a consistent, if imaginary, gradient toward its
 * outlet, which is what makes streams cross a filled valley in a straight line
 * instead of a whirlpool.
 */
export function fillDepressions(
  elev: Float32Array, W: number, H: number, seaLevel = 0,
): { filled: Float32Array; order: Int32Array } {
  const n = W * H;
  const filled = new Float32Array(n);
  const done = new Uint8Array(n);
  const heap = new Heap(Math.max(1024, (W + H) * 4));
  // The pop order IS the topological order, ascending by water surface. Taking
  // it here for free replaces a 270 000-element comparison sort per iteration,
  // which is most of the cost of the whole erosion loop.
  const order = new Int32Array(n);
  let on = 0;
  const EPS = 1e-5;

  const seed = (i: number) => {
    if (done[i]) return;
    done[i] = 1;
    filled[i] = elev[i];
    heap.push(elev[i], i);
  };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  for (let i = 0; i < n; i++) if (elev[i] <= seaLevel) seed(i);

  while (heap.size > 0) {
    const i = heap.pop();
    order[on++] = i;
    const x = i % W, y = (i / W) | 0;
    const h = filled[i];
    for (let k = 0; k < 8; k++) {
      const nx = x + DX8[k], ny = y + DY8[k];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = ny * W + nx;
      if (done[j]) continue;
      done[j] = 1;
      filled[j] = Math.max(elev[j], h + EPS);
      heap.push(filled[j], j);
    }
  }
  return { filled, order };
}

/** D8 receivers over the filled surface. */
export function flowRouting(filled: Float32Array, W: number, H: number, seaLevel = 0): Int32Array {
  const n = W * H;
  const down = new Int32Array(n).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (filled[i] <= seaLevel) continue;
      let best = -1, bestDrop = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k], ny = y + DY8[k];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) { best = -2; bestDrop = Infinity; continue; }
        const j = ny * W + nx;
        const len = (k & 1) ? Math.SQRT2 : 1;
        const drop = (filled[i] - filled[j]) / len;
        if (drop > bestDrop) { bestDrop = drop; best = j; }
      }
      down[i] = best === -2 ? -1 : best;
    }
  }
  return down;
}

/** `orderAsc` is the priority-flood pop order: ascending by water surface. */
export function accumulate(
  down: Int32Array, orderAsc: Int32Array, n: number, extra?: Float32Array,
): Float32Array {
  const acc = new Float32Array(n);
  for (let i = 0; i < n; i++) acc[i] = 1 + (extra ? extra[i] : 0);
  for (let k = n - 1; k >= 0; k--) {
    const i = orderAsc[k];
    const j = down[i];
    if (j >= 0) acc[j] += acc[i];
  }
  return acc;
}

/**
 * Fluvial incision on the sheet.
 *
 * Without this the sheet is fractal noise with a coastline: hollows everywhere,
 * no valley network, and every hollow fills, so a quarter of the page ends up
 * under water in amoeba-shaped lakes. Noise has no drainage structure because
 * nothing has ever run downhill across it. Erosion is what puts it there — and
 * it is also, on its own, most of the difference between a heightfield and a
 * landscape, because dendritic valleys are the pattern the eye is looking for.
 *
 * The scheme is the implicit stream-power solve (Braun & Willett): with the
 * cells visited from base level upward, each one's new height depends only on
 * its receiver's new height, so a single sweep is exact and unconditionally
 * stable — no timestep small enough to be safe and slow enough to matter.
 *
 *     h' = (h + f·h_recv) / (1 + f)      f = κ·√A / Δx
 *
 * The √A is what separates the valleys from the ridges: a channel draining a
 * hundred square kilometres has f fifty times a hillslope's, so it cuts down
 * while the ground between it and the next channel barely moves. That ratio is
 * the whole reason the result looks like country instead of like noise.
 */
export function erodeSheet(
  elev: Float32Array, W: number, H: number, metresPerCell: number,
  iterations: number, kappa: number,
): void {
  const n = W * H;
  const km2PerCell = Math.pow(metresPerCell / 1000, 2);
  const dxKm = metresPerCell / 1000;
  const scratch = new Float32Array(n);

  for (let it = 0; it < iterations; it++) {
    const { filled, order } = fillDepressions(elev, W, H, 0);
    const down = flowRouting(filled, W, H, 0);
    const acc = accumulate(down, order, n);

    // Base level down to the leaves: `order` is ascending, so a receiver is
    // always resolved before the cells that drain into it.
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const r = down[i];
      if (r < 0 || elev[i] <= 0) continue;
      const len = (Math.abs((i % W) - (r % W)) + Math.abs(((i / W) | 0) - ((r / W) | 0))) === 2
        ? Math.SQRT2 : 1;
      const f = kappa * Math.sqrt(acc[i] * km2PerCell) / (dxKm * len);
      const h = (elev[i] + f * elev[r]) / (1 + f);
      // Incision only. Letting the solve raise a cell turns the ridges into
      // ramps and quietly undoes the world's own relief.
      elev[i] = h < elev[i] ? h : elev[i];
    }

    // Hillslope creep: the interfluves between the new valleys are still noise
    // until something rounds them off, and a rounded interfluve is what makes a
    // valley read as a valley rather than as a crack.
    scratch.set(elev);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (scratch[i] <= 0) continue;
        const lap = (scratch[i - 1] + scratch[i + 1] + scratch[i - W] + scratch[i + W]) * 0.25 - scratch[i];
        elev[i] = scratch[i] + lap * 0.22;
      }
    }
  }
}

/** Build every water-related field in one pass. */
export function buildHydrology(
  world: WorldData,
  g: RegionGeometry,
  patch: WorldPatch,
  elev: Float32Array,
  rivers: CarvedRiver[],
): TerrainFields {
  const W = g.width, H = g.height, n = W * H;

  // Upstream area arriving from outside the window, injected where each world
  // river enters the sheet.
  const extra = new Float32Array(n);
  for (const r of rivers) {
    // Inject where the river ENTERS the sheet, which is the first point that is
    // actually on it — not the clamped first point of the clipped run, which for
    // a river arriving from off-page sits on the border a long way from the
    // channel and pours its catchment down the wrong valley.
    let p = r.pts.find((q) => q.x >= 0 && q.x < W && q.y >= 0 && q.y < H);
    if (!p) p = r.pts[0];
    const x = Math.min(W - 1, Math.max(0, Math.round(p.x)));
    const y = Math.min(H - 1, Math.max(0, Math.round(p.y)));
    // world `flow` is log-scaled 0–1; turn it back into something area-like.
    extra[y * W + x] += Math.pow(10, r.flow * 3.2) * 6;
  }

  const { filled, order } = fillDepressions(elev, W, H, 0);
  const down = flowRouting(filled, W, H, 0);
  const acc = accumulate(down, order, n, extra);

  const water = new Uint8Array(n);
  const slope = new Float32Array(n);
  const wet = new Float32Array(n);
  const flow = new Float32Array(n);
  const mCell = g.metresPerCell;

  // Sea = below zero AND reachable from the sheet border by water. Anything else
  // below zero is a landlocked basin — a Dead Sea, not an inlet.
  const sea = seaMask(elev, W, H);

  let maxAcc = 1;
  for (let i = 0; i < n; i++) if (acc[i] > maxAcc) maxAcc = acc[i];
  const logMax = Math.log(maxAcc + 1);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1);
      const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
      const dzdx = (elev[y * W + xp] - elev[y * W + xm]) * 1000 / ((xp - xm) * mCell);
      const dzdy = (elev[yp * W + x] - elev[ym * W + x]) * 1000 / ((yp - ym) * mCell);
      const s = Math.hypot(dzdx, dzdy);
      slope[i] = s;
      flow[i] = Math.log(acc[i] + 1) / logMax;
      wet[i] = Math.min(1, Math.log(acc[i] + 1) / (0.4 + s * 14) / 9);
      if (sea[i]) water[i] = 1;
    }
  }

  markLakes(world, g, patch, elev, filled, water, W, H);

  return { elevation: elev, water, flow, accum: acc, slope, wet, filled, down };
}

/**
 * Which filled depressions are actually lakes.
 *
 * "Anything the fill raised" is not the answer, and getting it wrong is
 * spectacular: invented relief closes hollows by the thousand, and painting
 * every one of them blue turned a sheet of farmland into Finland — nine per
 * cent of the page under water, in blobs with no character.
 *
 * The physical fact the first attempt was missing is that lakes are not evenly
 * distributed on Earth: they are overwhelmingly a GLACIAL feature. Canada and
 * Finland are perforated with them because ice scoured and dammed the ground
 * twenty thousand years ago; Spain and the Sahel have almost none, because
 * running water has had the whole Holocene to fill in every hollow it found.
 * The world already computes ice thickness at the glacial maximum, so the sheet
 * can simply ask. Outside the ice limit a hollow has to be big and deep before
 * it survives as standing water; inside it, a tarn the size of a farm is
 * exactly what the country looks like.
 */
function markLakes(
  world: WorldData, g: RegionGeometry, patch: WorldPatch,
  elev: Float32Array, filled: Float32Array, water: Uint8Array,
  W: number, H: number,
): void {
  const n = W * H;
  const cand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (water[i] === 0 && elev[i] > 0 && filled[i] - elev[i] > 0.0015) cand[i] = 1;
  }
  const km2PerCell = Math.pow(g.metresPerCell / 1000, 2);
  const worldAt = (i: number) => ({
    wx: g.originX + ((i % W) + 0.5) * g.worldPerCellX,
    wy: g.originY + (((i / W) | 0) + 0.5) * g.worldPerCellY,
  });

  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comp = new Int32Array(n);
  const kept: { cells: Int32Array; area: number; depth: number }[] = [];
  let land = 0;
  for (let i = 0; i < n; i++) if (water[i] === 0) land++;

  for (let s0 = 0; s0 < n; s0++) {
    if (!cand[s0] || seen[s0]) continue;
    let sp = 0, cn = 0;
    stack[sp++] = s0; seen[s0] = 1;
    let maxDepth = 0;
    while (sp > 0) {
      const i = stack[--sp];
      comp[cn++] = i;
      const d = filled[i] - elev[i];
      if (d > maxDepth) maxDepth = d;
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k], ny = y + DY8[k];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const j = ny * W + nx;
        if (cand[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
      }
    }
    const { wx, wy } = worldAt(comp[0]);
    const ice = patchBilinear(patch, patch.ice, wx, wy);
    const wasLake = patchNearest(patch, patch.lake, wx, wy) === 1;
    // Continuous in ice rather than a threshold: the edge of the ice sheet is
    // not a line on the ground, and a hard cut there draws one.
    const gf = Math.min(1, Math.max(0, (ice - 0.08) / 0.45));
    const minKm2 = wasLake ? 0.04 : 2.4 - gf * 1.7;
    const minDepth = wasLake ? 0.002 : 0.026 - gf * 0.014;
    const areaKm2 = cn * km2PerCell;
    if (areaKm2 < minKm2 || maxDepth < minDepth) continue;
    kept.push({ cells: comp.slice(0, cn), area: areaKm2, depth: maxDepth });
  }

  // Hard ceiling on how much of the sheet may be standing water. Even Finland,
  // the most lake-covered country there is, is about a tenth water; a rule that
  // can produce a quarter is a rule that will, and the failure is not subtle.
  // Ranked by DEPTH, not by area: the hollows that noise produces are broad and
  // shallow, so ranking by area keeps exactly the ones that look like spilled
  // paint and drops the small deep ones that look like lakes.
  kept.sort((a, b) => (b.depth * Math.sqrt(b.area)) - (a.depth * Math.sqrt(a.area)));
  const cap = land * 0.05;
  let used = 0;
  for (const k of kept) {
    if (used + k.cells.length > cap && used > 0) continue;
    used += k.cells.length;
    for (let q = 0; q < k.cells.length; q++) water[k.cells[q]] = 2;
  }
  void world;
}

/** Flood fill from the sheet border through sub-zero ground. */
function seaMask(elev: Float32Array, W: number, H: number): Uint8Array {
  const n = W * H;
  const sea = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i: number) => { if (!sea[i] && elev[i] <= 0) { sea[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % W, y = (i / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX8[k], ny = y + DY8[k];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      push(ny * W + nx);
    }
  }
  return sea;
}

// ---------------------------------------------------------------------------
// Stream extraction
// ---------------------------------------------------------------------------

/**
 * Trace the drainage network into polylines.
 *
 * Streams are traced from HEADS downstream rather than by thresholding cells and
 * joining them up, because the head is where a stream visibly begins and the
 * threshold is where it becomes worth drawing — starting from the head and
 * stopping at the threshold gives a network that tapers, which is what a
 * draughtsman draws and what a marching-squares contour of a flow field never
 * does.
 */
export function extractStreams(
  g: RegionGeometry,
  t: TerrainFields,
  rivers: CarvedRiver[],
  params: RegionParams,
): RegionStream[] {
  const W = g.width, H = g.height, n = W * H;
  const { down, flow, accum, water } = t;

  // A stream is worth drawing when it drains a real catchment — an ABSOLUTE
  // area, not a fraction of the biggest one on the sheet. The relative version
  // is what produced four hundred rivers on a sheet of dry hills: the largest
  // catchment there is small, so the threshold collapses and every rill on the
  // page qualifies. Ordnance-Survey practice is roughly 2 km² for a mapped
  // watercourse; the density slider moves that between 1 and 6.
  const km2PerCell = Math.pow(g.metresPerCell / 1000, 2);
  // Scaled by the sheet's own resolution, because that is what map
  // GENERALISATION is: the same country at 1:1 000 000 shows fewer watercourses
  // than at 1:50 000, and not because it has fewer. Holding the threshold fixed
  // in km² gave a wide sheet nine hundred streams and turned the east half of
  // the page into a blue net.
  const gen = Math.pow(g.metresPerCell / 200, 1.25);
  const minKm2 = (5.5 - params.streamDensity * 4) * gen;
  const minCells = Math.max(12, minKm2 / km2PerCell);

  const isStream = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (accum[i] >= minCells && water[i] === 0) isStream[i] = 1;

  const upCount = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!isStream[i]) continue;
    const j = down[i];
    if (j >= 0 && isStream[j] && upCount[j] < 255) upCount[j]++;
  }

  // Which sheet stream carries which world river, so trunks get the right name
  // and the right width. Matched by proximity at the river's mouth-most point.
  const trunkAt = new Int32Array(n).fill(-1);
  rivers.forEach((r, k) => {
    for (const p of r.pts) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
          const i = yy * W + xx;
          if (isStream[i] && trunkAt[i] < 0) trunkAt[i] = k;
        }
      }
    }
  });

  const visited = new Uint8Array(n);
  const out: RegionStream[] = [];
  let id = 0;

  const heads: number[] = [];
  for (let i = 0; i < n; i++) if (isStream[i] && upCount[i] === 0) heads.push(i);
  // Longest first: a trunk claims its cells before its tributaries, so the
  // tributaries stop at the confluence instead of running parallel to it.
  heads.sort((a, b) => flow[b] - flow[a]);

  for (const head of heads) {
    if (visited[head]) continue;
    const pts: { x: number; y: number }[] = [];
    let i = head;
    let trunk = -1;
    let guard = 0;
    let endFlow = flow[head];
    let endArea = accum[head];
    while (i >= 0 && guard++ < n) {
      pts.push({ x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5 });
      endFlow = flow[i];
      endArea = accum[i];
      if (trunkAt[i] >= 0 && trunk < 0) trunk = trunkAt[i];
      const already = visited[i];
      visited[i] = 1;
      // Stop one cell INTO an existing stream so the junction closes visually.
      if (already && pts.length > 1) break;
      const j = down[i];
      if (j < 0) break;
      if (water[j] !== 0) { pts.push({ x: (j % W) + 0.5, y: ((j / W) | 0) + 0.5 }); break; }
      i = j;
    }
    if (pts.length < 4) continue;
    out.push({
      id: id++,
      pts: chaikin(pts, 2),
      flow: endFlow,
      areaKm2: endArea * km2PerCell,
      trunk: trunk >= 0,
    });
  }
  return out;
}

/** Corner-cutting smoothing — turns a staircase of cell centres into a river. */
export function chaikin(pts: { x: number; y: number }[], iters: number): { x: number; y: number }[] {
  let cur = pts;
  for (let it = 0; it < iters; it++) {
    if (cur.length < 3) break;
    const next: { x: number; y: number }[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}
