// ============================================
// World Generator — Map Rendering (RGBA buffers)
// ============================================
// Pure pixel work: view-mode renderers produce RGBA buffers from WorldData.
// Shared hillshading (NW sun) + hypsometric tinting give the atlas look.
// Rivers render into their own transparent layer so the UI can toggle them
// without re-rendering the base, and so the 3D view can bake a composite.

import { Biome, type ViewMode, type WorldData } from './types';
import { riverKey } from './edits';

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

export const BIOME_COLORS: Record<number, [number, number, number]> = {
  32: [143, 168, 126],   // Karst
  33: [127, 174, 92],   // Bamboo
  34: [185, 182, 166],   // FogDesert
  35: [168, 154, 99],   // ThornScrub
  36: [138, 127, 102],   // Moor
  37: [176, 166, 142],   // Puna
  38: [74, 67, 64],   // Volcanic
  39: [141, 135, 129],   // AshPlain
  40: [155, 138, 118],   // PetrifiedForest
  41: [123, 106, 148],   // FungalForest
  42: [195, 211, 220],   // CrystalFlats
  43: [95, 143, 131],   // GlowMarsh
  [Biome.Ocean]: hex('#2e6f8e'),
  [Biome.Lake]: hex('#4589a8'),
  [Biome.IceCap]: hex('#e9eef3'),
  [Biome.Tundra]: hex('#a7a98c'),
  [Biome.BorealForest]: hex('#43634d'),
  [Biome.TemperateForest]: hex('#4d7a4e'),
  [Biome.TemperateRainforest]: hex('#39694b'),
  [Biome.Grassland]: hex('#9cad68'),
  [Biome.Shrubland]: hex('#aca873'),
  [Biome.Savanna]: hex('#c0b06a'),
  [Biome.TropicalForest]: hex('#418550'),
  [Biome.TropicalRainforest]: hex('#2b7343'),
  [Biome.Desert]: hex('#d5bf90'),
  [Biome.ColdDesert]: hex('#b9ac89'),
  [Biome.Alpine]: hex('#938b7b'),
  [Biome.Glacier]: hex('#dde7ec'),
  [Biome.Beach]: hex('#dbcda3'),
  [Biome.SaltFlat]: hex('#ded8c5'),
  [Biome.Mangrove]: hex('#3d6b52'),
  [Biome.SaltMarsh]: hex('#7f8f6b'),
  [Biome.Marsh]: hex('#6d8a63'),
  [Biome.PeatBog]: hex('#78806a'),
  [Biome.Steppe]: hex('#bdb87a'),
  [Biome.Chaparral]: hex('#b0a86e'),
  [Biome.MonsoonForest]: hex('#5b9153'),
  [Biome.CloudForest]: hex('#4f7f63'),
  [Biome.MontaneForest]: hex('#3f6650'),
  [Biome.AlpineMeadow]: hex('#8fa073'),
  [Biome.Erg]: hex('#e2c98f'),
  [Biome.Reg]: hex('#c4ac83'),
  [Biome.Badlands]: hex('#b08a66'),
  [Biome.RiparianForest]: hex('#5f8f57'),
};

// Ocean depth gradient stops (depth in km → color).
const OCEAN_STOPS: [number, [number, number, number]][] = [
  [0.0, hex('#4a90ad')],
  [0.12, hex('#3d7fa0')],
  [0.5, hex('#2c6285')],
  [1.2, hex('#1f4a6b')],
  [2.2, hex('#173a57')],
  [3.4, hex('#102b42')],
];

function oceanColor(depth: number): [number, number, number] {
  if (depth <= OCEAN_STOPS[0][0]) return OCEAN_STOPS[0][1];
  for (let s = 1; s < OCEAN_STOPS.length; s++) {
    if (depth <= OCEAN_STOPS[s][0]) {
      const [d0, c0] = OCEAN_STOPS[s - 1];
      const [d1, c1] = OCEAN_STOPS[s];
      const t = (depth - d0) / (d1 - d0);
      return [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t,
      ];
    }
  }
  return OCEAN_STOPS[OCEAN_STOPS.length - 1][1];
}

const HIGHLAND = hex('#e6dfcd');
const SNOW = hex('#eff3f5');

/** Hillshade factor per cell (NW sun, vertical exaggeration). */
function hillshade(world: WorldData, i: number, x: number, y: number): number {
  const { width: W, height: H, elevation } = world;
  const xr = x + 1 < W ? i + 1 : i + 1 - W;
  const xl = x > 0 ? i - 1 : i - 1 + W;
  const yd = y + 1 < H ? i + W : i;
  const yu = y > 0 ? i - W : i;
  const Z = 11; // vertical exaggeration for shading
  const dzdx = (elevation[xr] - elevation[xl]) * 0.5 * Z;
  const dzdy = (elevation[yd] - elevation[yu]) * 0.5 * Z;
  // Light from the north-west, fairly high sun.
  const lx = -0.55, ly = -0.55, lz = 0.63;
  const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
  const dot = (-dzdx * lx + -dzdy * ly + lz) / len;
  return 0.62 + 0.55 * Math.max(0, dot);
}

function put(px: Uint8ClampedArray, i: number, r: number, g: number, b: number, a = 255): void {
  const o = i * 4;
  px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
}

export interface RenderOptions {
  /** Bake NW-sun hillshading into the pixels (default true). The 3D view
   *  turns this off — its real-time lights do the shading instead. */
  shade?: boolean;
}

/** Base map render for a view mode (no rivers, no overlays). */
export function renderBase(world: WorldData, mode: ViewMode, options?: RenderOptions): Uint8ClampedArray<ArrayBuffer> {
  const { width: W, height: H } = world;
  const px = new Uint8ClampedArray(W * H * 4);
  switch (mode) {
    case 'atlas': renderAtlas(world, px, options?.shade !== false); break;
    case 'elevation': renderElevation(world, px); break;
    case 'temperature': renderTemperature(world, px); break;
    case 'precipitation': renderPrecipitation(world, px); break;
    case 'plates': renderPlates(world, px); break;
    case 'flow': renderFlow(world, px); break;
    case 'currents': renderCurrents(world, px); break;
    case 'glaciers': renderGlaciers(world, px); break;
  }
  return px;
}

/** Unshaded atlas colour of ONE cell — the single source both the whole-world
 *  raster and the live dirty-cell updater draw from. */
export function atlasCellColor(world: WorldData, i: number): [number, number, number] {
  const { elevation, biome, temperature } = world;
  const e = elevation[i];
  if (e <= 0) return oceanColor(-e);
  const bio = biome[i];
  let [r, g, b] = BIOME_COLORS[bio] ?? BIOME_COLORS[Biome.Grassland];
  if (bio !== Biome.Lake && bio !== Biome.SaltFlat) {
    // Hypsometric lightening toward pale rock with altitude.
    const t = Math.min(1, Math.pow(Math.max(0, e) / 4.2, 1.25)) * 0.62;
    r += (HIGHLAND[0] - r) * t;
    g += (HIGHLAND[1] - g) * t;
    b += (HIGHLAND[2] - b) * t;
    // Snow above the local snowline — gradual, only on real highlands.
    const snowT = Math.min(1, Math.max(0, (-temperature[i] - 6) / 9 + Math.max(0, e - 3.1) * 0.3));
    if (snowT > 0 && e > 1.9) {
      const sT = snowT * snowT * (3 - 2 * snowT);
      r += (SNOW[0] - r) * sT;
      g += (SNOW[1] - g) * sT;
      b += (SNOW[2] - b) * sT;
    }
  }
  return [r, g, b];
}

function renderAtlas(world: WorldData, px: Uint8ClampedArray, shade: boolean): void {
  const { width: W, height: H, elevation, biome } = world;
  for (let y = 0; y < H; y++) {
    const yW = y * W;
    for (let x = 0; x < W; x++) {
      const i = yW + x;
      const [r, g, b] = atlasCellColor(world, i);
      const sh = !shade ? 1
        : elevation[i] <= 0 ? 0.92 + 0.08 * hillshade(world, i, x, y)
          : biome[i] === Biome.Lake ? 1 : hillshade(world, i, x, y);
      put(px, i, r * sh, g * sh, b * sh);
    }
  }
}

/**
 * Refresh the unshaded atlas colours of a dirty rectangle IN PLACE (x wraps,
 * y clamps). This is what makes live sculpting affordable on the satellite:
 * a brush move dirties a few hundred cells, not a million.
 */
export function updateAtlasCells(
  world: WorldData,
  unshaded: Uint8ClampedArray,
  x0: number, y0: number, x1: number, y1: number,
): void {
  const { width: W, height: H } = world;
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H - 1, Math.ceil(y1));
  const xa = Math.floor(x0), xb = Math.ceil(x1);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const xi = ((x % W) + W) % W;
      const i = y * W + xi;
      const [r, g, b] = atlasCellColor(world, i);
      const o = i * 4;
      unshaded[o] = r; unshaded[o + 1] = g; unshaded[o + 2] = b; unshaded[o + 3] = 255;
    }
  }
}

const ELEV_STOPS: [number, [number, number, number]][] = [
  [0.0, hex('#5e8b58')],
  [0.4, hex('#8aa15e')],
  [0.9, hex('#c4b070')],
  [1.6, hex('#a67f56')],
  [2.4, hex('#8b6d5c')],
  [3.2, hex('#9b948e')],
  [4.2, hex('#f0f2f3')],
];

function rampColor(v: number, stops: [number, [number, number, number]][]): [number, number, number] {
  if (v <= stops[0][0]) return stops[0][1];
  for (let s = 1; s < stops.length; s++) {
    if (v <= stops[s][0]) {
      const [v0, c0] = stops[s - 1];
      const [v1, c1] = stops[s];
      const t = (v - v0) / (v1 - v0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
}

function renderElevation(world: WorldData, px: Uint8ClampedArray): void {
  const { width: W, height: H, elevation } = world;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elevation[i];
      if (e <= 0) {
        const [r, g, b] = oceanColor(-e);
        put(px, i, r, g, b);
      } else {
        const [r, g, b] = rampColor(e, ELEV_STOPS);
        const sh = hillshade(world, i, x, y);
        put(px, i, r * sh, g * sh, b * sh);
      }
    }
  }
}

const TEMP_STOPS: [number, [number, number, number]][] = [
  [-30, hex('#274a76')],
  [-12, hex('#5d8fc0')],
  [0, hex('#a9c8d8')],
  [10, hex('#e3ddc0')],
  [20, hex('#dda75c')],
  [30, hex('#b6432f')],
];

function renderTemperature(world: WorldData, px: Uint8ClampedArray): void {
  const { width: W, height: H, elevation, temperature } = world;
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = rampColor(temperature[i], TEMP_STOPS);
    const dim = elevation[i] <= 0 ? 0.72 : 1;
    put(px, i, r * dim, g * dim, b * dim);
  }
}

const RAIN_STOPS: [number, [number, number, number]][] = [
  [0, hex('#d9c493')],
  [350, hex('#c2bd7d')],
  [800, hex('#8fb56f')],
  [1500, hex('#4f9d89')],
  [2300, hex('#3576a5')],
  [3300, hex('#274f86')],
];

function renderPrecipitation(world: WorldData, px: Uint8ClampedArray): void {
  const { width: W, height: H, elevation, precipitation } = world;
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = rampColor(precipitation[i], RAIN_STOPS);
    const dim = elevation[i] <= 0 ? 0.62 : 1;
    put(px, i, r * dim, g * dim, b * dim);
  }
}

function renderPlates(world: WorldData, px: Uint8ClampedArray): void {
  const { width: W, height: H, plateId, elevation, boundary } = world;
  // Deterministic pastel per plate.
  const colors: [number, number, number][] = [];
  for (let p = 0; p < 32; p++) {
    const h = (p * 137.508) % 360;
    colors.push(hslToRgb(h / 360, 0.32, 0.52));
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let [r, g, b] = colors[plateId[i] % 32];
      if (elevation[i] <= 0) { r *= 0.55; g *= 0.55; b *= 0.6; }
      // Boundary highlight (convergence in warm red).
      const xr = x + 1 < W ? i + 1 : i + 1 - W;
      const yd = y + 1 < H ? i + W : i;
      if (plateId[i] !== plateId[xr] || plateId[i] !== plateId[yd]) {
        r = 30; g = 26; b = 32;
      } else if (boundary[i] > 0.15) {
        const t = Math.min(1, boundary[i]);
        r = r + (196 - r) * t; g = g + (70 - g) * t; b = b + (58 - b) * t;
      }
      put(px, i, r, g, b);
    }
  }
}

function renderFlow(world: WorldData, px: Uint8ClampedArray): void {
  const { width: W, height: H, elevation, flow } = world;
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] <= 0) {
      put(px, i, 16, 26, 38);
    } else {
      const f = Math.pow(flow[i], 1.6);
      const r = 34 + f * 96, g = 40 + f * 150, b = 48 + f * 200;
      put(px, i, r, g, b);
    }
  }
}

/**
 * Currents view: sea-surface temperature anomaly as colour (warm currents red,
 * cold blue) with the flow direction drawn as streak texture on top. Land is
 * knocked back to a flat tone so the ocean reads as the subject.
 */
function renderCurrents(world: WorldData, px: Uint8ClampedArray): void {
  const { width: W, height: H, elevation, sst, currentU, currentV, currentSpeed } = world;
  const cold = hex('#2b5d8a'), neutral = hex('#dfe6e6'), warm = hex('#a8352c');
  const land = hex('#cfc6ae');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (elevation[i] > 0) {
        const sh = 0.9 + 0.1 * Math.min(1, elevation[i] / 3);
        put(px, i, land[0] * sh, land[1] * sh, land[2] * sh);
        continue;
      }
      const t = Math.max(-1, Math.min(1, sst[i] / 6));
      const a = t < 0 ? cold : warm;
      const k = Math.abs(t);
      let r = neutral[0] + (a[0] - neutral[0]) * k;
      let g = neutral[1] + (a[1] - neutral[1]) * k;
      let b = neutral[2] + (a[2] - neutral[2]) * k;
      // Streaks: sample a sawtooth along the flow direction so the pattern
      // reads as motion rather than as a heat map with arrows on it.
      const sp = currentSpeed[i];
      if (sp > 0.04) {
        const ang = Math.atan2(currentV[i], currentU[i]);
        const along = x * Math.cos(ang) + y * Math.sin(ang);
        const across = -x * Math.sin(ang) + y * Math.cos(ang);
        const streak = Math.sin(along * 0.55 + Math.sin(across * 0.4) * 1.5);
        const amp = Math.min(1, sp * 1.6) * 26;
        r += streak * amp; g += streak * amp; b += streak * amp;
      }
      put(px, i, r, g, b);
    }
  }
}

/** Glaciers view: ice extent at the glacial maximum over a muted relief. */
function renderGlaciers(world: WorldData, px: Uint8ClampedArray): void {
  const { width: W, height: H, elevation, ice } = world;
  const iceC = hex('#e8f2f8'), deepIce = hex('#a9cfe4');
  const rock = hex('#8d8677'), sea = hex('#33556b');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const isSea = elevation[i] <= 0;
      const base: [number, number, number] = isSea ? sea : rock;
      let r = base[0], g = base[1], b = base[2];
      if (!isSea) {
        const sh = hillshade(world, i, x, y);
        r *= sh; g *= sh; b *= sh;
      }
      const ic = ice[i];
      if (ic > 0.02) {
        const t = Math.min(1, ic);
        const tgt = t > 0.6 ? deepIce : iceC;
        const k = Math.min(0.92, 0.35 + t * 0.6);
        r += (tgt[0] - r) * k; g += (tgt[1] - g) * k; b += (tgt[2] - b) * k;
      }
      put(px, i, r, g, b);
    }
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Transparent layer with rivers stamped as flow-scaled strokes. */
/**
 * The satellite window: one output pixel per SCREEN pixel, sampled bilinearly
 * from the world fields, with the hillshade computed per pixel from the
 * interpolated surface. This is what replaces "magnify the 1-px-per-cell
 * raster 8×" past the zoom where that reads as mush: the coastline lands at
 * sub-cell precision, relief shading stays crisp at any magnification, and
 * the palette is EXACTLY the atlas palette because the colours come from the
 * unshaded atlas raster itself.
 *
 * `unshaded` is `renderBase(world, 'atlas', { shade: false })`, cached by the
 * caller per revision. Land pixels blend the colours of their LAND corners
 * only (weights renormalised), so ocean blue never bleeds uphill; water
 * pixels take the depth ramp directly. A pixel whose nearest corner is a
 * lake keeps the lake's flat shading, like the cell version.
 */
export function renderAtlasWindow(
  world: WorldData,
  unshaded: Uint8ClampedArray,
  out: Uint8ClampedArray,
  outW: number,
  outH: number,
  view: { x: number; y: number; w: number; h: number },
): void {
  const { width: W, height: H, elevation, biome } = world;
  const sx = view.w / outW, sy = view.h / outH;
  const wrapC = (x: number) => ((x % W) + W) % W;
  const clampR = (y: number) => Math.min(H - 1, Math.max(0, y));

  /** Bilinear elevation at world-cell coordinates (centre convention). */
  const eAt = (gx: number, gy: number): number => {
    const fx = gx - 0.5, fy = gy - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = wrapC(x0), xb = wrapC(x0 + 1);
    const ya = clampR(y0), yb = clampR(y0 + 1);
    const e00 = elevation[ya * W + xa], e10 = elevation[ya * W + xb];
    const e01 = elevation[yb * W + xa], e11 = elevation[yb * W + xb];
    return (e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty;
  };

  const Z = 11, lx = -0.55, ly = -0.55, lz = 0.63; // mirror hillshade()

  for (let py = 0; py < outH; py++) {
    const gy = view.y + (py + 0.5) * sy;
    for (let px = 0; px < outW; px++) {
      const gx = view.x + (px + 0.5) * sx;
      const o = (py * outW + px) * 4;

      const e = eAt(gx, gy);
      // Per-pixel shade from the interpolated surface, same physical scale as
      // the cell version (centred difference over two cells).
      const dzdx = (eAt(gx + 1, gy) - eAt(gx - 1, gy)) * 0.5 * Z;
      const dzdy = (eAt(gx, gy + 1) - eAt(gx, gy - 1)) * 0.5 * Z;
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const dot = (-dzdx * lx + -dzdy * ly + lz) / len;
      const shade = 0.62 + 0.55 * Math.max(0, dot);

      if (e <= 0) {
        const [r, g, b] = oceanColor(-e);
        const sh = 0.92 + 0.08 * shade;
        out[o] = r * sh; out[o + 1] = g * sh; out[o + 2] = b * sh; out[o + 3] = 255;
        continue;
      }

      // Corner cells around the sample, for colour blending.
      const fx = gx - 0.5, fy = gy - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const xa = wrapC(x0), xb = wrapC(x0 + 1);
      const ya = clampR(y0), yb = clampR(y0 + 1);
      const idx = [ya * W + xa, ya * W + xb, yb * W + xa, yb * W + xb];
      const wgt = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];

      let r = 0, g = 0, b = 0, wsum = 0;
      for (let k = 0; k < 4; k++) {
        const i = idx[k];
        if (elevation[i] <= 0) continue; // sea colour never bleeds uphill
        const q = i * 4;
        r += unshaded[q] * wgt[k];
        g += unshaded[q + 1] * wgt[k];
        b += unshaded[q + 2] * wgt[k];
        wsum += wgt[k];
      }
      if (wsum <= 0) {
        // Land by interpolation, water at every corner: a hairline case at
        // concave coves — take the nearest corner's colour as the cell
        // version would have shown there.
        const near = idx[wgt.indexOf(Math.max(...wgt))] * 4;
        r = unshaded[near]; g = unshaded[near + 1]; b = unshaded[near + 2];
        wsum = 1;
      }
      // Lakes shade flat, exactly like the cell version.
      const nearest = idx[wgt.indexOf(Math.max(...wgt))];
      const sh = biome[nearest] === Biome.Lake ? 1 : shade;
      out[o] = (r / wsum) * sh;
      out[o + 1] = (g / wsum) * sh;
      out[o + 2] = (b / wsum) * sh;
      out[o + 3] = 255;
    }
  }
}

export function renderRivers(world: WorldData): Uint8ClampedArray<ArrayBuffer> {
  const { width: W, height: H } = world;
  const px = new Uint8ClampedArray(W * H * 4);
  const [rr, rg, rb] = hex('#4f93b8');

  const stamp = (i: number, alpha: number) => {
    const o = i * 4;
    const a = Math.min(255, px[o + 3] + alpha);
    px[o] = rr; px[o + 1] = rg; px[o + 2] = rb; px[o + 3] = a;
  };

  // Hand-drawn rivers are rivers.
  //
  // They were carved into the elevation so they show up in drainage and in the
  // biomes along their banks — and then drawn by the carta and by nobody else,
  // because this function only ever looked at `world.rivers`. On the satellite
  // raster, which is now the main view, a painted river was a shaded groove in
  // the ground with no water in it: a scar, not a river.
  const painted = world.painted?.rivers;
  const gone = world.painted?.removed;
  const generated = gone?.size
    ? world.rivers.filter((r) => !gone.has(riverKey(r.cells)))
    : world.rivers;
  const all = painted?.length ? [...generated, ...painted] : generated;
  for (const river of all) {
    const cells = river.cells;
    const n = cells.length;
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      const x = c % W, y = (c / W) | 0;
      // Grow from headwater (thin) to mouth (thick).
      const grow = k / n;
      const wPx = 0.6 + (0.5 + 2.3 * river.flow) * grow;
      stamp(c, 235);
      if (wPx > 1.15) {
        const xr = x + 1 < W ? c + 1 : c + 1 - W;
        stamp(xr, 190);
        if (y + 1 < H) stamp(c + W, 190);
      }
      if (wPx > 1.9) {
        const xl = x > 0 ? c - 1 : c - 1 + W;
        stamp(xl, 160);
        if (y > 0) stamp(c - W, 160);
        if (y + 1 < H) {
          const d = c + W;
          const dr = x + 1 < W ? d + 1 : d + 1 - W;
          stamp(dr, 120);
        }
      }
    }
  }
  return px;
}

/** Composite base + rivers into one buffer (for exports / 3D texture). */
export function renderComposite(world: WorldData, mode: ViewMode, withRivers: boolean, options?: RenderOptions): Uint8ClampedArray<ArrayBuffer> {
  const base = renderBase(world, mode, options);
  if (!withRivers || mode === 'plates' || mode === 'flow' || mode === 'currents' || mode === 'glaciers') return base;
  const rivers = renderRivers(world);
  for (let i = 0; i < base.length; i += 4) {
    const a = rivers[i + 3] / 255;
    if (a > 0) {
      base[i] = base[i] * (1 - a) + rivers[i] * a;
      base[i + 1] = base[i + 1] * (1 - a) + rivers[i + 1] * a;
      base[i + 2] = base[i + 2] * (1 - a) + rivers[i + 2] * a;
    }
  }
  return base;
}
