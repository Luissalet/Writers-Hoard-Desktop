// ============================================
// Regional canon — SATELLITE ink
// ============================================
// The 2D view is not a paper map and must not be inked like one. It is the
// ground seen from above: what the reader edits on, and what has to look like
// somewhere real at every scale between a continent and a field.
//
// This is the painter for one rectangle of the global canon lattice. It reads
// the same RegionData the pliego reads — elevation, water, flow, slope,
// wetness, biome, COVER, and the stream/track/hedge vectors — and paints it
// photographically instead of cartographically:
//
//   · colour from ground COVER (wood, coppice, heath, arable, scree…) blended
//     toward the world BIOME tint, so a wood in Karelia is not a wood in Java
//     and, more importantly, so the tone agrees with the whole-world atlas
//     raster at the level where one hands over to the other;
//   · relief shaded per PIXEL from the canon surface plus, past ~40 m/px,
//     invented micro-relief — the sub-canon amplification, deterministic on
//     the world lattice, so it is the same hillside from every tile and every
//     level that shows it;
//   · sub-cell coastlines and cover boundaries: the cover field is sampled
//     through a warp so a heath does not end on a 153 m grid line, and the
//     shoreline is an interpolated contour, not a staircase of cells;
//   · at close range, individual things — tree crowns with their own shadows,
//     scrub, furrows, rock fracture, hedges, buildings — because past about
//     20 m/px an unstamped ground reads as blurred paint no matter how good
//     the shading is.
//
// EVERY stochastic choice is keyed to the GLOBAL canon lattice through the
// same cell hash the pliego tiles use, so two display tiles that share a
// hillside ink it identically and a level change moves no tree.
//
// Pure data + an injected 2D context: the worker feeds an OffscreenCanvas, the
// harness feeds @napi-rs. The shipping path is the tested path.

import type { Ctx } from '../cartography/symbols';
import { BIOME_COLORS } from '../core/render';
import { Cover, type RegionData } from './types';

/** Sun direction, identical to the atlas raster's hillshade so relief reads the
 *  same on both sides of the hand-over level. */
export const LX = -0.55, LY = -0.55, LZ = 0.63;

/**
 * Sub-cell hash lattice, in cells per canon cell.
 *
 * Ground granulation has to sit on a lattice of its OWN, fixed in world terms.
 * Hashing on `floor(gridCoord × pixelsPerCell)` — the obvious thing — makes the
 * lattice depend on the zoom level and, worse, restarts it at every tile
 * origin, so the grain shimmers when you zoom and steps at every join. 256
 * sub-cells per canon cell is ~0,6 m, which is the floor of the pyramid.
 */
const SUB = 256;

export interface SatelliteInk {
  /** World-scoped ink seed — the SAME string for every tile of a world. */
  seed: string;
  /** Global canon cell of grid (0,0), margin INCLUDED, x pre-wrap. */
  gx0: number;
  gy0: number;
  /** Canon cells around the world; x hashes wrap here so the seam agrees. */
  wrapX: number;
}

export interface SatelliteOptions {
  width: number;
  height: number;
  /** Output pixels per canon cell. Sets every level-of-detail decision. */
  pxPerCell: number;
  ink: SatelliteInk;
  /** Draw ways. Off at the levels where a lane would be sub-pixel. */
  tracks?: boolean;
  /** Draw enclosure boundaries. */
  hedges?: boolean;
  /** Draw building footprints at inhabited places. */
  buildings?: boolean;
  /** 0–1 multiplier on stamp counts (trees, scrub). 1 = as designed. */
  density?: number;
  /**
   * Leave the world settlements' roofs alone — their real town PLAN is being
   * drawn over this tile, and a scatter of invented roofs underneath a real
   * street layout is just noise with the same colour.
   */
  skipTownRoofs?: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic draws on the global lattice
// ---------------------------------------------------------------------------

/**
 * Position-keyed uniform draws in [0,1): slot k at GLOBAL lattice cell (x, y).
 *
 * Absolute coordinates, deliberately. An earlier version folded the window's
 * origin into the hash and let callers pass window-local coordinates, which is
 * correct only while the lattice step is exactly one cell: as soon as a noise
 * octave scales the coordinate by anything else,
 *
 *     gx0 + floor(x · f)   ≠   floor((gx0 + x) · f)
 *
 * and every window quietly gets its own terrain. Measured before the fix: two
 * windows over the same ground disagreed on 66 % of the shared pixels, by up
 * to 130 levels — which is exactly the visible seam between two tiles. The
 * caller now computes the global coordinate and this hashes it, so there is
 * one lattice for the world and no window can have its own.
 */
export function makeLatticeHash(seed: string): (x: number, y: number, k: number) => number {
  let salt = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    salt ^= seed.charCodeAt(i);
    salt = Math.imul(salt, 16777619);
  }
  return (x: number, y: number, k: number): number => {
    let h = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77)
      ^ Math.imul(k | 0, 0xc2b2ae3d) ^ salt) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
}

type Hash = (x: number, y: number, k: number) => number;

const smoothStep = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise in [0,1) at GLOBAL coordinates, `freq` cycles per lattice cell.
 *
 * `wrapX` is the lattice's circumference: x folds into it BEFORE scaling, so
 * the field is continuous everywhere except within one lattice cell of the
 * antimeridian — the same bounded residue the pliego's tile ink carries.
 */
function valueNoise(
  hash: Hash, x: number, y: number, freq: number, k: number, wrapX: number,
): number {
  const xw = ((x % wrapX) + wrapX) % wrapX;
  const fx = xw * freq, fy = y * freq;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smoothStep(fx - x0), ty = smoothStep(fy - y0);
  const n00 = hash(x0, y0, k), n10 = hash(x0 + 1, y0, k);
  const n01 = hash(x0, y0 + 1, k), n11 = hash(x0 + 1, y0 + 1, k);
  return (n00 * (1 - tx) + n10 * tx) * (1 - ty) + (n01 * (1 - tx) + n11 * tx) * ty;
}

/** Signed fBm in roughly [-1,1] at GLOBAL coordinates. Exported: the shallow
 *  tiles warp their coastline with the same construction on the world lattice. */
export function latticeFbm(
  hash: Hash, x: number, y: number,
  octaves: number, freq0: number, k: number, wrapX: number,
): number {
  let sum = 0, amp = 1, norm = 0, f = freq0;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(hash, x, y, f, k + o * 17, wrapX) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03; // off-integer so octaves never phase-lock into a grid
  }
  return sum / Math.max(1e-6, norm);
}

/**
 * The bridge between this window's grid and the world's lattice.
 *
 * Every stochastic draw in this file goes through here, and nothing else in
 * the file ever sees `ink.gx0`. That is the point: the conversion from a grid
 * coordinate to a world coordinate is subtle enough (it has to happen BEFORE
 * any frequency scaling, and it has to wrap) that having it written once is
 * the only way it stays right.
 */
export interface Lattice {
  /** fBm at grid coordinates, `freq` cycles per canon cell. */
  fbm: (x: number, y: number, octaves: number, freq: number, k: number) => number;
  /** Uniform draw keyed to the canon cell containing a grid coordinate. */
  cell: (x: number, y: number, k: number) => number;
  /** Uniform draw keyed to a block of 2^shift canon cells — for things bigger
   *  than a cell, like the direction a parcel is ploughed. */
  block: (x: number, y: number, shift: number, k: number) => number;
  /** Uniform draw on the sub-cell grain lattice (SUB steps per canon cell). */
  grain: (x: number, y: number, k: number) => number;
}

export function makeLattice(ink: SatelliteInk): Lattice {
  const cells = makeLatticeHash(`${ink.seed}::cells`);
  const fine = makeLatticeHash(`${ink.seed}::grain`);
  const wrapX = ink.wrapX;
  const wrap = (v: number) => ((v % wrapX) + wrapX) % wrapX;
  const gx = (x: number) => wrap(ink.gx0 + x);
  const gy = (y: number) => ink.gy0 + y;
  return {
    fbm: (x, y, octaves, freq, k) => latticeFbm(cells, gx(x), gy(y), octaves, freq, k, wrapX),
    cell: (x, y, k) => cells(Math.floor(gx(x)), Math.floor(gy(y)), k),
    block: (x, y, shift, k) => cells(Math.floor(gx(x)) >> shift, Math.floor(gy(y)) >> shift, k),
    grain: (x, y, k) => fine(Math.floor(gx(x) * SUB), Math.floor(gy(y) * SUB), k),
  };
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

function rgb(c: string): [number, number, number] {
  return [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
}

/**
 * Ground seen from above, not ground drawn on paper.
 *
 * The pliego's washes sit within a few steps of the paper on purpose. These do
 * the opposite: they are the colours the ground actually is, because the eye
 * reads a satellite view by tone and not by symbol. They stay deliberately
 * desaturated all the same — real land photographed from orbit is far greyer
 * than a landcover key, and saturated landcover colours are exactly what makes
 * generated terrain look like a GIS export.
 */
const COVER_RGB: Record<number, [number, number, number]> = {
  [Cover.Sea]: rgb('#2e6f8e'),
  [Cover.Lake]: rgb('#3d7fa0'),
  [Cover.Marsh]: rgb('#5f7355'),
  [Cover.Meadow]: rgb('#7d9159'),
  [Cover.Wood]: rgb('#3f5c39'),
  [Cover.Coppice]: rgb('#4d6a3f'),
  [Cover.Scrub]: rgb('#7a7c55'),
  [Cover.Heath]: rgb('#7d7355'),
  [Cover.Moor]: rgb('#6f6a51'),
  [Cover.Grass]: rgb('#8a9159'),
  [Cover.Pasture]: rgb('#7f9351'),
  [Cover.Arable]: rgb('#a9985e'),
  [Cover.Orchard]: rgb('#61793f'),
  [Cover.Vineyard]: rgb('#7c8450'),
  [Cover.Rock]: rgb('#8b8377'),
  [Cover.Scree]: rgb('#9c948a'),
  [Cover.Snow]: rgb('#eaf0f3'),
  [Cover.Waste]: rgb('#b3a481'),
  [Cover.Dune]: rgb('#c8b189'),
  [Cover.Beach]: rgb('#cfbc95'),
};

/** How far a cover's tone bends toward the world biome tint. Managed ground
 *  keeps its own colour (a wheat field is wheat-coloured in every climate);
 *  wild ground takes the climate's word for it. */
const BIOME_PULL: Record<number, number> = {
  [Cover.Wood]: 0.45,
  [Cover.Coppice]: 0.38,
  [Cover.Scrub]: 0.42,
  [Cover.Heath]: 0.4,
  [Cover.Moor]: 0.4,
  [Cover.Grass]: 0.45,
  [Cover.Meadow]: 0.3,
  [Cover.Marsh]: 0.3,
  [Cover.Pasture]: 0.16,
  [Cover.Arable]: 0.08,
  [Cover.Orchard]: 0.1,
  [Cover.Vineyard]: 0.1,
  [Cover.Rock]: 0.3,
  [Cover.Scree]: 0.3,
  [Cover.Waste]: 0.4,
  [Cover.Dune]: 0.3,
  [Cover.Beach]: 0.2,
  [Cover.Snow]: 0.12,
};

/** Ocean depth ramp — the atlas raster's own stops, so the hand-over level
 *  from world raster to canon tiles does not change the colour of the sea. */
const OCEAN_STOPS: [number, [number, number, number]][] = [
  [0.0, rgb('#4a90ad')],
  [0.12, rgb('#3d7fa0')],
  [0.5, rgb('#2c6285')],
  [1.2, rgb('#1f4a6b')],
  [2.2, rgb('#173a57')],
  [3.4, rgb('#102b42')],
];

export function oceanRgb(depthKm: number): [number, number, number] {
  if (depthKm <= OCEAN_STOPS[0][0]) return OCEAN_STOPS[0][1];
  for (let s = 1; s < OCEAN_STOPS.length; s++) {
    if (depthKm <= OCEAN_STOPS[s][0]) {
      const [d0, c0] = OCEAN_STOPS[s - 1];
      const [d1, c1] = OCEAN_STOPS[s];
      const t = (depthKm - d0) / (d1 - d0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return OCEAN_STOPS[OCEAN_STOPS.length - 1][1];
}

/** Micro-relief amplitude in metres, by cover. Bare and broken ground carries
 *  most of it; worked ground almost none — a ploughed field is flat because
 *  somebody flattened it. */
const RELIEF_BY_COVER: Record<number, number> = {
  [Cover.Rock]: 1, [Cover.Scree]: 0.95, [Cover.Moor]: 0.55, [Cover.Heath]: 0.5,
  [Cover.Scrub]: 0.5, [Cover.Wood]: 0.45, [Cover.Coppice]: 0.4, [Cover.Grass]: 0.4,
  [Cover.Waste]: 0.6, [Cover.Dune]: 0.8, [Cover.Snow]: 0.3, [Cover.Beach]: 0.2,
  [Cover.Meadow]: 0.18, [Cover.Marsh]: 0.12, [Cover.Pasture]: 0.16,
  [Cover.Arable]: 0.07, [Cover.Orchard]: 0.1, [Cover.Vineyard]: 0.12,
};

const isWater = (c: number) => c === Cover.Sea || c === Cover.Lake;

// ---------------------------------------------------------------------------
// The painter
// ---------------------------------------------------------------------------

/**
 * Paint one rectangle of canon ground photographically.
 *
 * The output covers exactly the window's INTERIOR (`region.margin` excluded)
 * at `pxPerCell` output pixels per canon cell. The margin is read from — a
 * crown or a stream on the far side of the edge must reach in — and never
 * drawn from.
 */
export function renderSatellite(region: RegionData, ctx: Ctx, opts: SatelliteOptions): void {
  const { width: OW, height: OH, pxPerCell } = opts;
  const L = makeLattice(opts.ink);
  const m = region.margin;
  const RW = region.width, RH = region.height;
  const metresPerPx = region.metresPerCell / pxPerCell;
  const density = opts.density ?? 1;

  // Detail ladder, and it splits in two on purpose.
  //
  // Relief detail is relative to the CANON CELL: micro-relief and the sampling
  // warp exist to hide the 153 m lattice, so they switch on when the lattice
  // starts to be visible — a question about pixels per cell.
  //
  // Objects are absolute. A tree is about twelve metres across wherever it
  // grows, so whether to draw one is a question about METRES PER PIXEL and
  // nothing else. Sizing stamps in fractions of a cell is how a forest ends up
  // with forty-metre trees at street level and invisible ones a level above.
  const wantMicroRelief = pxPerCell >= 2.5;
  const wantWarp = pxPerCell >= 1.5;
  const wantGroundTexture = pxPerCell >= 8;
  // A crown reads once its radius clears about a pixel: 6 m / 5 m per px.
  const wantCrowns = metresPerPx <= 5.5;
  const wantFurrows = metresPerPx <= 3;

  const gridAt = (px: number, py: number): [number, number] => [
    m + (px + 0.5) / pxPerCell,
    m + (py + 0.5) / pxPerCell,
  ];

  const clampX = (x: number) => Math.min(RW - 1, Math.max(0, x));
  const clampY = (y: number) => Math.min(RH - 1, Math.max(0, y));

  /** Bilinear read of a numeric field at grid coordinates. */
  const sample = (f: Float32Array, gx: number, gy: number): number => {
    const fx = gx - 0.5, fy = gy - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = clampX(x0), xb = clampX(x0 + 1);
    const ya = clampY(y0), yb = clampY(y0 + 1);
    const a = f[ya * RW + xa], b = f[ya * RW + xb];
    const c = f[yb * RW + xa], d = f[yb * RW + xb];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  /** Bilinear read of the "is water" indicator: a sub-cell shoreline instead
   *  of a staircase. 1 = water everywhere around, 0 = dry. */
  const waterAt = (gx: number, gy: number): number => {
    const fx = gx - 0.5, fy = gy - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = clampX(x0), xb = clampX(x0 + 1);
    const ya = clampY(y0), yb = clampY(y0 + 1);
    const w = region.water;
    const a = w[ya * RW + xa] ? 1 : 0, b = w[ya * RW + xb] ? 1 : 0;
    const c = w[yb * RW + xa] ? 1 : 0, d = w[yb * RW + xb] ? 1 : 0;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  const cellIndex = (gx: number, gy: number) =>
    clampY(Math.floor(gy)) * RW + clampX(Math.floor(gx));

  /**
   * Which canon cell a pixel takes its COVER from.
   *
   * Not the nearest one. Nearest-cell sampling is what leaves 153 m squares
   * visible in an arable plain however hard the lookup is warped — a warp with
   * a three-cell wavelength bends the boundary, it does not dissolve it. This
   * picks among the four surrounding cells with probability equal to their
   * bilinear weights, drawn from the pixel-scale grain lattice: the boundary
   * between a wood and a pasture becomes a band of interleaved pixels a
   * hundred metres wide, which is what a real transition looks like from above
   * and what every tree and furrow stamped on top then reinforces.
   *
   * Deterministic on the world lattice like everything else, so the same pixel
   * of ground dissolves the same way from any tile and any level.
   */
  const ditherIndex = (gx: number, gy: number, slot: number): number => {
    const fx = gx - 0.5, fy = gy - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    // The draw is SMOOTH noise, not white noise. White noise interleaves the
    // two covers pixel by pixel, which at a level where a canon cell is sixty
    // pixels across is a band of television static sixty pixels wide. Smooth
    // noise at a few cycles per cell interleaves them in fingers instead —
    // organic at every level, because the finger size follows the cell.
    const px = (L.fbm(gx, gy, 2, 2.6, slot) * 0.5 + 0.5) < tx ? 1 : 0;
    const py = (L.fbm(gx, gy, 2, 2.6, slot + 41) * 0.5 + 0.5) < ty ? 1 : 0;
    return clampY(y0 + py) * RW + clampX(x0 + px);
  };

  // --- pass 1: amplified surface -------------------------------------------
  // One scratch buffer with a one-pixel skirt, so the shading pass takes its
  // slopes from the SAME surface the colour pass sees, at one noise cost
  // instead of three.
  const EW = OW + 2, EH = OH + 2;
  const surface = new Float32Array(EW * EH); // metres above sea level
  for (let py = -1; py <= OH; py++) {
    for (let px = -1; px <= OW; px++) {
      const [gx, gy] = gridAt(px, py);
      let e = sample(region.elevation, gx, gy) * 1000; // km → m
      if (wantMicroRelief) {
        const i = cellIndex(gx, gy);
        const cov = region.cover[i];
        if (!isWater(cov)) {
          // Amplitude scales with the canon cell size, the local slope and how
          // broken the ground is. Half a canon cell of wavelength is where the
          // canon itself stops carrying information.
          const rough = RELIEF_BY_COVER[cov] ?? 0.35;
          const slope = Math.min(1, region.slope[i] * 6);
          const amp = region.metresPerCell * 0.055 * rough * (0.35 + 0.9 * slope);
          e += L.fbm(gx, gy, 4, 1.6, 101) * amp;
        }
      }
      surface[(py + 1) * EW + (px + 1)] = e;
    }
  }

  // --- pass 2: colour -------------------------------------------------------
  const img = ctx.createImageData(OW, OH);
  const out = img.data;
  for (let py = 0; py < OH; py++) {
    for (let px = 0; px < OW; px++) {
      const [ax, ay] = gridAt(px, py);
      // Warp the LOOKUP, not the ground: cover boundaries stop being straight
      // lattice lines without any feature moving.
      let gx = ax, gy = ay;
      if (wantWarp) {
        // Amplitude is a bit over ONE canon cell, in three octaves. Half a cell
        // — the first guess — leaves a 153 m staircase perfectly visible on a
        // lake shore at 38 m/px: the wiggle has to be wider than the step it is
        // hiding. Three octaves so the boundary has coves as well as bays.
        gx += L.fbm(ax, ay, 4, 0.33, 211) * 1.15;
        gy += L.fbm(ax, ay, 4, 0.33, 307) * 1.15;
      }

      const si = (py + 1) * EW + (px + 1);
      const e = surface[si];
      const eL = surface[si - 1], eR = surface[si + 1];
      const eU = surface[si - EW], eD = surface[si + EW];
      const dzdx = (eR - eL) / (2 * metresPerPx);
      const dzdy = (eD - eU) / (2 * metresPerPx);
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const dot = (-dzdx * LX + -dzdy * LY + LZ) / len;
      let shade = 0.62 + 0.55 * Math.max(0, dot);

      const mask = waterAt(gx, gy);
      const o = (py * OW + px) * 4;
      const idx = cellIndex(gx, gy);
      const lake = region.water[idx] === 2;

      // Where the water's edge actually falls.
      //
      // Thresholding the 153 m mask puts the shoreline on lattice lines, which
      // is the staircase this whole exercise exists to kill. Inside the
      // boundary band the AMPLIFIED SURFACE decides instead — sea is wherever
      // the ground is below sea level, at pixel resolution — so the coast
      // wanders the way the relief does. A lake keeps the mask: a lake has a
      // level, not a sign, and its surface is flat by definition.
      let wet: number;
      if (mask <= 0.02) wet = 0;
      else if (mask >= 0.98) wet = 1;
      else if (lake) wet = mask >= 0.5 ? 1 : 0;
      else wet = e <= 0 ? 1 : 0;

      if (wet >= 0.5) {
        // Sea takes the atlas depth ramp; a lake is flat and lighter. Both get
        // only a whisper of shading — water does not have hillsides.
        const depthKm = lake ? 0.03 : Math.max(0, -Math.min(e / 1000, sample(region.elevation, gx, gy)));
        let [r, g, b] = lake ? COVER_RGB[Cover.Lake] : oceanRgb(depthKm);
        // Shallow water over a bright bottom, right at the shore.
        // Shoal only where it IS shoal. A 60 m band made an entire lagoon
        // read as pale blue paint; the shelf that actually looks bright from
        // above is the first ten or fifteen metres.
        const shore = Math.min(1, depthKm / 0.012);
        if (!lake && shore < 1) {
          const t = (1 - shore) * 0.3;
          r += (206 - r) * t; g += (214 - g) * t; b += (196 - b) * t;
        }
        const sh = 0.94 + 0.1 * shade;
        // Fine glitter so a big sea is not a flat fill.
        const gl = wantGroundTexture ? (L.grain(gx, gy, 47) - 0.5) * 6 : 0;
        out[o] = r * sh + gl; out[o + 1] = g * sh + gl; out[o + 2] = b * sh + gl; out[o + 3] = 255;
        continue;
      }

      const cIdxDither = ditherIndex(gx, gy, 601);
      const cov = region.cover[cIdxDither];
      const base = COVER_RGB[cov] ?? COVER_RGB[Cover.Grass];
      let r = base[0], g = base[1], b = base[2];

      // Bend toward the climate's own colour, which is also what keeps this
      // continuous with the whole-world raster at the hand-over level.
      const pull = BIOME_PULL[cov] ?? 0.3;
      if (pull > 0) {
        const bt = BIOME_COLORS[region.biome[cIdxDither]];
        if (bt) {
          r += (bt[0] - r) * pull; g += (bt[1] - g) * pull; b += (bt[2] - b) * pull;
        }
      }

      // Damp ground is darker ground.
      const damp = Math.min(0.14, region.wet[cIdxDither] * 0.2);
      r *= 1 - damp; g *= 1 - damp * 0.85; b *= 1 - damp * 0.5;

      // Mottling: the single cheapest thing that stops flat cover reading as
      // paint. Two scales, both lattice-keyed.
      if (wantGroundTexture) {
        const t = L.fbm(gx, gy, 2, 3.1, 419) * 0.055
          + (L.grain(gx, gy, 53) - 0.5) * 0.05;
        shade *= 1 + t;
      } else {
        shade *= 1 + L.fbm(gx, gy, 2, 1.1, 419) * 0.035;
      }

      // The damp strip a shoreline leaves on the land side. Read from the MASK,
      // not from the resolved edge — this is "near water", a question about the
      // neighbourhood rather than about this pixel.
      if (mask > 0.15) {
        const t = Math.min(1, (mask - 0.15) / 0.3);
        r += (198 - r) * t * 0.42; g += (196 - g) * t * 0.42; b += (176 - b) * t * 0.42;
      }

      out[o] = r * shade; out[o + 1] = g * shade; out[o + 2] = b * shade; out[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // --- pass 3: things ------------------------------------------------------
  ctx.save();
  // Everything below works in OUTPUT pixels with the grid's origin at the
  // interior corner, so a vector in grid cells maps by a single scale.
  const toPx = (v: number) => (v - m) * pxPerCell;

  if (opts.hedges !== false && metresPerPx <= 12) drawHedges(region, ctx, toPx, metresPerPx);
  drawWater(region, ctx, toPx, pxPerCell, metresPerPx);
  if (wantFurrows) drawFields(region, ctx, L, pxPerCell, metresPerPx, m, OW, OH);
  if (wantCrowns) drawCover(region, ctx, L, pxPerCell, metresPerPx, m, OW, OH, density);
  if (opts.tracks !== false && pxPerCell >= 1.5) {
    drawTracks(region, ctx, toPx, pxPerCell, metresPerPx);
  }
  // Hasta 160 m/px, no 2,2: la puerta estrecha era la mitad del hueco en el
  // que un pueblo desaparecía del mapa (z9→z14 sin punto, sin mancha y sin
  // tejados). `drawBuildings` decide solo qué dibujar a cada escala: mancha
  // urbana cuando un tejado aún no mide 1,4 px, tejados cuando ya se leen.
  if (opts.buildings !== false && metresPerPx <= 160) {
    drawBuildings(region, ctx, L, toPx, metresPerPx, opts.skipTownRoofs === true);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/**
 * Streams, drawn from the vector polylines rather than the raster, because a
 * watercourse narrower than a canon cell is still a watercourse and the raster
 * cannot hold it. Width comes from catchment, which is what actually sets a
 * river's width on the ground.
 */
function drawWater(
  region: RegionData, ctx: Ctx, toPx: (v: number) => number,
  pxPerCell: number, metresPerPx: number,
): void {
  if (!region.streams.length) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of region.streams) {
    if (s.pts.length < 2) continue;
    // Regime width in metres from catchment area — the same power law a real
    // channel follows — then to pixels, floored so a brook stays visible.
    const metres = Math.min(900, 1.6 * Math.pow(Math.max(0.5, s.areaKm2), 0.47));
    const w = Math.max(pxPerCell >= 4 ? 1.1 : 0.7, metres / metresPerPx);
    ctx.beginPath();
    ctx.moveTo(toPx(s.pts[0].x), toPx(s.pts[0].y));
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(toPx(s.pts[i].x), toPx(s.pts[i].y));
    // A damp margin first, then the water itself: a channel seen from above is
    // never a hairline of pure blue on dry ground.
    if (w > 1.6) {
      ctx.strokeStyle = 'rgba(84,104,74,0.5)';
      ctx.lineWidth = w * 1.9;
      ctx.stroke();
    }
    ctx.strokeStyle = s.areaKm2 > 40 ? '#3f7f9e' : '#4a86a2';
    ctx.lineWidth = w;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Enclosure
// ---------------------------------------------------------------------------

function drawHedges(
  region: RegionData, ctx: Ctx, toPx: (v: number) => number, metresPerPx: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // A hedge is a bush two or three metres wide seen from above, and it is a
  // SOFT dark green line, not the wireframe a heavy stroke turns it into.
  ctx.strokeStyle = 'rgba(52,68,42,0.42)';
  ctx.lineWidth = Math.max(0.6, 2.5 / metresPerPx);
  for (const h of region.hedges) {
    if (h.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(toPx(h[0].x), toPx(h[0].y));
    for (let i = 1; i < h.length; i++) ctx.lineTo(toPx(h[i].x), toPx(h[i].y));
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(58,52,38,0.38)';
  ctx.lineWidth = Math.max(0.7, 3.5 / metresPerPx);
  for (const d of region.dykes) {
    if (d.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(toPx(d[0].x), toPx(d[0].y));
    for (let i = 1; i < d.length; i++) ctx.lineTo(toPx(d[i].x), toPx(d[i].y));
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Ways
// ---------------------------------------------------------------------------

/** Ways, in METRES of made width. A cart road is about seven metres of beaten
 *  surface, a lane four, a footpath one. Sizing these in fractions of a canon
 *  cell is what turned a lane into a forty-metre tan ribbon at close range. */
const TRACK_STYLE: Record<string, { metres: number; color: string; dash: number[] }> = {
  road: { metres: 7, color: 'rgba(214,196,158,0.92)', dash: [] },
  lane: { metres: 4, color: 'rgba(198,180,146,0.82)', dash: [] },
  path: { metres: 1.2, color: 'rgba(186,170,140,0.72)', dash: [2.4, 2.0] },
};

function drawTracks(
  region: RegionData, ctx: Ctx, toPx: (v: number) => number,
  pxPerCell: number, metresPerPx: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const kind of ['path', 'lane', 'road'] as const) {
    const style = TRACK_STYLE[kind];
    for (const t of region.tracks) {
      if (t.kind !== kind || t.pts.length < 2) continue;
      // Never thinner than a hairline: a road you cannot see is a road that is
      // not there, and at 150 m/px a real road IS thinner than a pixel.
      const w = Math.max(0.75, style.metres / metresPerPx);
      ctx.beginPath();
      ctx.moveTo(toPx(t.pts[0].x), toPx(t.pts[0].y));
      for (let i = 1; i < t.pts.length; i++) ctx.lineTo(toPx(t.pts[i].x), toPx(t.pts[i].y));
      if (w > 2.2) {
        // A worn edge either side, which is what a track looks like from above.
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(92,84,64,0.30)';
        ctx.lineWidth = w * 1.5;
        ctx.stroke();
      }
      // Dash phase rides the composed polyline so a way keeps its rhythm
      // across tile joins. The dash itself is a ground length (~12 m), so the
      // rhythm does not change with the level either.
      if (style.dash.length) {
        const unit = Math.max(1.5, 6 / metresPerPx);
        ctx.setLineDash(style.dash.map((d) => d * unit));
        ctx.lineDashOffset = -(t.dashPhase ?? 0) * pxPerCell;
      } else {
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = style.color;
      ctx.lineWidth = w;
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

// ---------------------------------------------------------------------------
// Worked ground
// ---------------------------------------------------------------------------

/**
 * Worked ground: the parcels themselves, and the rows in them.
 *
 * The first version ploughed by CANON CELL — clip to the cell, stroke rows
 * across it — which put back, in furrows, exactly the 153 m axis-aligned
 * blockiness the dithered cover sampling had just dissolved. Farmland does
 * read as a patchwork of rectangles from above; what it does not do is share
 * one grid and one orientation with every other field in the county.
 *
 * The canon already generates the real thing: `fields`, closed parcel polygons
 * with their own cover and their own shape. So a parcel is the unit — its rows
 * run along its own long axis, and its edges are its own.
 */
function drawFields(
  region: RegionData, ctx: Ctx, L: Lattice, pxPerCell: number, metresPerPx: number,
  m: number, OW: number, OH: number,
): void {
  /** Row spacing on the ground: ridge-and-furrow lands, vine rows, tree rows. */
  const SPACING_M: Record<number, number> = {
    [Cover.Arable]: 7.5, [Cover.Vineyard]: 2.4, [Cover.Orchard]: 6.5,
    [Cover.Pasture]: 0, [Cover.Meadow]: 0,
  };
  const toPx = (v: number) => (v - m) * pxPerCell;
  ctx.save();
  ctx.lineWidth = Math.max(0.5, 0.9 / metresPerPx);
  for (const f of region.fields) {
    if (f.poly.length < 3) continue;
    const spacing = SPACING_M[f.cover];
    if (!spacing) continue;
    const step = spacing / metresPerPx;
    if (step < 2) continue; // rows closer than two pixels are just a tone

    // Bounds in output pixels; skip anything off this tile.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of f.poly) {
      const X = toPx(p.x), Y = toPx(p.y);
      if (X < x0) x0 = X; if (X > x1) x1 = X;
      if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    if (x1 < 0 || y1 < 0 || x0 > OW || y0 > OH) continue;

    // The parcel's own long axis: rows follow the shape, the way a ploughman
    // works the longest run he can.
    let bestLen = 0, angle = 0;
    for (let i = 0; i < f.poly.length; i++) {
      const a = f.poly[i], b = f.poly[(i + 1) % f.poly.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = dx * dx + dy * dy;
      if (len > bestLen) { bestLen = len; angle = Math.atan2(dy, dx); }
    }
    // Strip fields run in bundles along the same axis and are not cross-worked.
    if (!f.strip) angle += (L.cell(f.poly[0].x, f.poly[0].y, 73) - 0.5) * 0.35;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(toPx(f.poly[0].x), toPx(f.poly[0].y));
    for (let i = 1; i < f.poly.length; i++) ctx.lineTo(toPx(f.poly[i].x), toPx(f.poly[i].y));
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = f.cover === Cover.Arable
      ? 'rgba(120,102,62,0.30)'
      : 'rgba(70,86,48,0.38)';
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const R = Math.hypot(x1 - x0, y1 - y0) * 0.6;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    ctx.beginPath();
    for (let k = -Math.ceil(R / step); k <= Math.ceil(R / step); k++) {
      const ox = -sin * k * step, oy = cos * k * step;
      ctx.moveTo(cx + ox - cos * R, cy + oy - sin * R);
      ctx.lineTo(cx + ox + cos * R, cy + oy + sin * R);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Vegetation
// ---------------------------------------------------------------------------

/**
 * Plants, in METRES.
 *
 * `spacing` is the mean distance between individuals on the ground and
 * `radius` the crown radius — both real quantities, so the stand thins and
 * thickens correctly at every level instead of scaling with the lattice.
 * `closure` is how much of the ground the canopy actually covers: a wood is
 * closed, a heath is a scatter.
 */
const CROWNS: Record<number, { spacing: number; radius: number; closure: number; color: string }> = {
  [Cover.Wood]: { spacing: 11, radius: 5.5, closure: 0.92, color: '#33502f' },
  [Cover.Coppice]: { spacing: 8, radius: 3.4, closure: 0.85, color: '#41603a' },
  [Cover.Orchard]: { spacing: 12, radius: 3.6, closure: 0.7, color: '#4d6f3c' },
  [Cover.Vineyard]: { spacing: 9, radius: 1.6, closure: 0.55, color: '#6b7b46' },
  [Cover.Scrub]: { spacing: 14, radius: 1.9, closure: 0.5, color: '#6d7148' },
  [Cover.Heath]: { spacing: 18, radius: 1.4, closure: 0.4, color: '#6f6446' },
  [Cover.Marsh]: { spacing: 20, radius: 1.6, closure: 0.35, color: '#4f6144' },
  [Cover.Moor]: { spacing: 26, radius: 1.2, closure: 0.3, color: '#5f5b44' },
};

/** Broken ground gets fracture flecks rather than plants — boulders and slabs,
 *  also in metres. */
const FLECKS: Record<number, { spacing: number; radius: number; color: string }> = {
  [Cover.Rock]: { spacing: 16, radius: 2.6, color: 'rgba(64,60,54,0.5)' },
  [Cover.Scree]: { spacing: 11, radius: 1.5, color: 'rgba(80,75,68,0.45)' },
  [Cover.Dune]: { spacing: 34, radius: 5.0, color: 'rgba(160,138,102,0.4)' },
  [Cover.Waste]: { spacing: 22, radius: 2.2, color: 'rgba(140,126,96,0.35)' },
};

function drawCover(
  region: RegionData, ctx: Ctx, L: Lattice, pxPerCell: number, metresPerPx: number,
  m: number, OW: number, OH: number, density: number,
): void {
  const RW = region.width;
  const cellM = region.metresPerCell;
  // Read one cell beyond the interior on every side: a crown centred just
  // outside must still cast its half into this tile, exactly as the
  // neighbouring tile draws it.
  const reach = 1;
  const x0 = Math.max(0, Math.floor(m - reach));
  const y0 = Math.max(0, Math.floor(m - reach));
  const x1 = Math.min(region.width, Math.ceil(m + OW / pxPerCell + reach));
  const y1 = Math.min(region.height, Math.ceil(m + OH / pxPerCell + reach));

  // How many stamps this level can carry per cell. The real stand is often
  // denser than this; below the cap the eye reads canopy texture from the
  // mottling pass anyway, and drawing two hundred sub-pixel ellipses per cell
  // buys nothing but milliseconds.
  const cellPx = pxPerCell;
  const budget = Math.max(4, Math.min(240, Math.round((cellPx / 5) * (cellPx / 5))));

  // Cast shadow offset: a crown's shadow falls away from the light, and its
  // length is the crown's own height, which is about twice its radius.
  const shadowUnit = 1.6;

  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) {
      const i = gy * RW + gx;
      const cov = region.cover[i];
      const spec = CROWNS[cov];
      const fleck = FLECKS[cov];
      if ((!spec && !fleck) || region.water[i]) continue;

      const spacing = spec ? spec.spacing : fleck!.spacing;
      const radiusM = spec ? spec.radius : fleck!.radius;
      const rBase = radiusM / metresPerPx;
      if (rBase < 0.42) continue; // sub-pixel: the mottling already says this

      // Individuals this cell actually holds, then what we can afford.
      const real = (cellM / spacing) * (cellM / spacing) * (spec ? spec.closure : 1);
      const count = Math.max(1, Math.min(budget, Math.round(real * density)));

      for (let k = 0; k < count; k++) {
        const jx = L.cell(gx, gy, 1000 + k * 3);
        const jy = L.cell(gx, gy, 1001 + k * 3);
        const draw = L.cell(gx, gy, 1002 + k * 3);
        const cxp = (gx - m + jx) * pxPerCell;
        const cyp = (gy - m + jy) * pxPerCell;
        const rr = rBase * (0.72 + draw * 0.7);
        if (cxp < -rr * 3 || cyp < -rr * 3 || cxp > OW + rr * 3 || cyp > OH + rr * 3) continue;

        if (spec) {
          if (rr > 0.9) {
            ctx.fillStyle = 'rgba(28,36,26,0.30)';
            ctx.beginPath();
            ctx.ellipse(cxp - LX * rr * shadowUnit, cyp - LY * rr * shadowUnit,
              rr * 1.02, rr * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          // Its own colour draw, so a wood is not one stamp repeated.
          const tone = (jx - 0.5) * 26;
          ctx.fillStyle = shiftRgb(spec.color, tone);
          ctx.beginPath();
          ctx.ellipse(cxp, cyp, rr, rr * 0.92, 0, 0, Math.PI * 2);
          ctx.fill();
          if (rr > 2.2) {
            ctx.fillStyle = shiftRgb(spec.color, 34 + tone);
            ctx.beginPath();
            ctx.ellipse(cxp + LX * rr * 0.3, cyp + LY * rr * 0.3, rr * 0.5, rr * 0.44, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          ctx.fillStyle = fleck!.color;
          ctx.beginPath();
          ctx.ellipse(cxp, cyp, rr, rr * 0.7, jy * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

function shiftRgb(hexColor: string, amount: number): string {
  const h = hexColor.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(h.slice(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(h.slice(2, 4), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(h.slice(4, 6), 16) + amount));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ---------------------------------------------------------------------------
// Habitation
// ---------------------------------------------------------------------------

/** Roofs. Not a town plan — that is the city generator's job — but enough that
 *  a hamlet at 10 m/px is a cluster of buildings and not a dot. */
function drawBuildings(
  region: RegionData, ctx: Ctx, L: Lattice, toPx: (v: number) => number,
  metresPerPx: number, skipTowns: boolean,
): void {
  /** Roof count and how far the settlement sprawls, in METRES of radius. A
   *  hamlet is a hundred metres across; a town is most of a kilometre. */
  const spread: Record<string, { n: number; radiusM: number; roofM: number }> = {
    town: { n: 90, radiusM: 620, roofM: 13 },
    village: { n: 30, radiusM: 240, roofM: 11 },
    hamlet: { n: 10, radiusM: 105, roofM: 10 },
    farm: { n: 4, radiusM: 46, roofM: 12 },
    mill: { n: 2, radiusM: 22, roofM: 9 },
    abbey: { n: 7, radiusM: 80, roofM: 15 },
    inn: { n: 2, radiusM: 24, roofM: 11 },
    tower: { n: 1, radiusM: 8, roofM: 7 },
    quarry: { n: 2, radiusM: 70, roofM: 8 },
    mine: { n: 2, radiusM: 55, roofM: 8 },
    ruin: { n: 6, radiusM: 70, roofM: 9 },
  };
  const cellM = region.metresPerCell;
  for (const p of region.places) {
    if (skipTowns && p.kind === 'town') continue;
    const s = spread[p.kind];
    if (!s) continue;
    const roofPx = s.roofM / metresPerPx;
    const spreadCells = s.radiusM / cellM;
    const ruin = p.kind === 'ruin';
    if (roofPx < 1.4) {
      /**
       * LA MANCHA URBANA. Entre que el mapa apaga el punto del mundo (z9) y
       * que un tejado mide 1,4 px (z14) había SEIS niveles en los que un
       * pueblo era sólo su nombre sobre campo raso — «me acerco y desaparece
       * la ciudad» (capturas de Eskuunkald, 2026-08-11). A esas escalas un
       * pueblo real se lee como una MASA parda continua, no como tejados:
       * unos lóbulos solapados y un corazón más denso, con el mismo hash
       * estable por celda que los tejados para que cada tesela pinte la misma
       * mancha. Cuando el tejado ya se lee, la mancha se retira y entran los
       * tejados de abajo; cuando el plano real se dibuja (≤5 m/px), `skipTowns`
       * ya se llevó el pueblo entero de este bucle.
       */
      const stainPx = s.radiusM / metresPerPx;
      if (stainPx < 2.5) continue;
      const hx0 = Math.floor(p.x), hy0 = Math.floor(p.y);
      const blobs = Math.max(4, Math.min(11, Math.round(stainPx * 0.8)));
      ctx.save();
      // α igualada con la mancha del RELLENO del 3D (`townStains`, α0,34):
      // aquélla tuvo que subir de 0,26 porque sobre albedo plano era un borrón
      // tímido, y si la tesela llegara más clara el pueblo se ATENUARÍA justo
      // al ponerse nítido. Mismo número aquí y allí, a la vez o en ninguno.
      ctx.fillStyle = ruin ? '#6d675d' : '#6e5847';
      ctx.globalAlpha = 0.34;
      for (let k = 0; k < blobs; k++) {
        const a = L.cell(hx0, hy0, 3000 + k * 3) * Math.PI * 2;
        const dCells = Math.sqrt(L.cell(hx0, hy0, 3001 + k * 3)) * spreadCells * 0.72;
        const gx = p.x + Math.cos(a) * dCells;
        const gy = p.y + Math.sin(a) * dCells;
        // Tampoco la mancha se mete en el agua: el lóbulo que cae en el lago
        // se descarta, igual que el tejado que este bucle descarta más abajo.
        const wi = Math.min(region.height - 1, Math.max(0, Math.floor(gy))) * region.width
          + Math.min(region.width - 1, Math.max(0, Math.floor(gx)));
        if (region.water[wi]) continue;
        const r = stainPx * (0.26 + L.cell(hx0, hy0, 3002 + k * 3) * 0.3);
        ctx.beginPath();
        ctx.ellipse(toPx(gx), toPx(gy), r, r * 0.78, a, 0, Math.PI * 2);
        ctx.fill();
      }
      // El corazón: el casco denso alrededor del que creció lo demás.
      ctx.globalAlpha = 0.42;
      ctx.beginPath();
      ctx.arc(toPx(p.x), toPx(p.y), stainPx * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    // Hash on the place's own lattice cell, so every tile showing this hamlet
    // puts the same roof in the same field.
    const hx = Math.floor(p.x), hy = Math.floor(p.y);
    for (let k = 0; k < s.n; k++) {
      const a = L.cell(hx, hy, 2000 + k * 5) * Math.PI * 2;
      const d = Math.sqrt(L.cell(hx, hy, 2001 + k * 5)) * spreadCells;
      const gx = p.x + Math.cos(a) * d;
      const gy = p.y + Math.sin(a) * d;
      // Nobody builds in the lake. The scatter reaches a few hundred metres,
      // which is easily far enough to cross a shore the place itself sits back
      // from, and a roof floating on open water is the one thing at this range
      // that reads instantly as broken.
      const wi = Math.min(region.height - 1, Math.max(0, Math.floor(gy))) * region.width
        + Math.min(region.width - 1, Math.max(0, Math.floor(gx)));
      if (region.water[wi]) continue;
      const bx = toPx(gx);
      const by = toPx(gy);
      const w = roofPx * (0.75 + L.cell(hx, hy, 2002 + k * 5) * 0.6);
      const h = w * (0.55 + L.cell(hx, hy, 2003 + k * 5) * 0.5);
      // Roofs face the settlement, roughly, the way real ones face their lane.
      const rot = a + (L.cell(hx, hy, 2004 + k * 5) - 0.5) * 1.1;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(rot);
      ctx.fillStyle = 'rgba(26,30,24,0.34)';
      ctx.fillRect(-w / 2 + w * 0.16, -h / 2 + h * 0.22, w, h);
      ctx.fillStyle = ruin ? '#867f74' : '#7a604f';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
}
