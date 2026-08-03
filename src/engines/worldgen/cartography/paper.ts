// ============================================
// Cartography — Procedural parchment
// ============================================
// The sheet the map is drawn on. Real fantasy maps live or die on this layer:
// a flat beige rectangle reads as a screenshot, while tone variation at three
// distinct scales reads as paper.
//
// Layer split follows the standard parchment recipe:
//   large tone blotches  fBm 3–4 oct @ freq ~2      → the cloudy base
//   mid mottle / stains  fBm 4–5 oct @ freq ~8      → age spots
//   fibre (anisotropic)  fBm 4 oct, x stretched ~8× → the grain direction
//   grain                white noise ±6/255         → the tooth
//   edge burn            noise-perturbed distance   → deckled, not oval
//
// Everything is deterministic from the seed so a map always redraws identically.

import { SphereNoise } from '../core/noise';
import type { CartoTheme } from './theme';

function hexToRgb(c: string): [number, number, number] {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Position-keyed white noise in [-1, 1): the same virtual-sheet pixel gets
 *  the same tooth in every tile that renders it. */
function makeAnchoredGrain(seed: string, ax: number, ay: number): (x: number, y: number) => number {
  let salt = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    salt ^= seed.charCodeAt(i);
    salt = Math.imul(salt, 16777619);
  }
  const ox = ax | 0, oy = ay | 0;
  return (x: number, y: number): number => {
    let h = (Math.imul(ox + x, 0x9e3779b1) ^ Math.imul(oy + y, 0x85ebca77) ^ salt) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  };
}

export interface PaperOptions {
  width: number;
  height: number;
  seed: string;
  theme: CartoTheme;
  /** Scale factor: effects are authored for a ~1200px sheet. */
  scale?: number;
  /**
   * Where this render sits inside a VIRTUAL sheet of `extentX × extentY`
   * output pixels. Display tiles pass their pixel origin and the full level
   * extent, so the blotches and stains continue across tile joins instead of
   * each tile drawing its own private sheet — that mismatch was the visible
   * tonal seam. Anchored renders also skip the vignette: the burn belongs to
   * the edge of a PAGE, and a tile is not a page. Absent = classic behaviour,
   * byte-identical, which keeps every export exactly as it was.
   */
  anchor?: { x: number; y: number; extentX: number; extentY: number };
  /**
   * Resolution divisor for the TONE layers. The blotch/stain/fibre/vignette
   * fields are all smooth, so computing them on a reduced lattice and
   * interpolating is visually free — and it is the difference between a 2-second
   * render and a 200-millisecond one, because those layers are ~45 noise
   * evaluations per pixel. The per-pixel grain stays at full resolution: it is a
   * single hash, and it is the layer the eye reads as paper tooth.
   * Defaults to 3, which is indistinguishable from 1 at any sane sheet size.
   */
  toneStep?: number;
}

/**
 * Render the parchment into an RGBA buffer. Cost is ~10 noise samples per
 * pixel; at 2048×1024 that is ~0.6 s, so callers should cache it (the map view
 * regenerates it only when the seed, theme or size changes).
 */
export function renderPaper(opts: PaperOptions): Uint8ClampedArray {
  const { width: W, height: H, theme, anchor } = opts;
  const s = opts.scale ?? Math.max(anchor ? anchor.extentX : W, anchor ? anchor.extentY : H) / 1200;
  const px = new Uint8ClampedArray(W * H * 4);

  const nBlotch = new SphereNoise(opts.seed, 'paper-blotch');
  const nStain = new SphereNoise(opts.seed, 'paper-stain');
  const nFibre = new SphereNoise(opts.seed, 'paper-fibre');
  const nEdgeLo = new SphereNoise(opts.seed, 'paper-edge-lo');
  const nEdgeHi = new SphereNoise(opts.seed, 'paper-edge-hi');

  const base = hexToRgb(theme.paper.base);
  const grain = hexToRgb(theme.paper.grain);
  const stainC = hexToRgb(theme.paper.stain);

  const gAmt = theme.paper.grainAmount;
  const bAmt = theme.paper.blotchAmount;
  const vAmt = theme.paper.vignette;

  // Cheap deterministic hash for the per-pixel grain — a full noise lookup per
  // pixel for white noise would be pure waste.
  let hash = 0x9e3779b9;
  const rand = () => {
    hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5;
    return ((hash >>> 0) / 4294967296) * 2 - 1;
  };
  // Anchored renders key the tooth by VIRTUAL-SHEET pixel instead: a stream's
  // value depends on how many pixels came before it, so two tiles of the same
  // sheet would disagree everywhere. (The classic path keeps the stream so
  // existing exports stay byte-identical.)
  const grainAt = anchor ? makeAnchoredGrain(opts.seed, anchor.x, anchor.y) : null;

  // ---- pass 1: the smooth tone layers, on a reduced lattice ---------------
  // Anchored renders align the lattice to VIRTUAL-SHEET multiples of `step`
  // (phase shift), so every tile of a level interpolates between the same
  // sample points — a lattice phased per-tile disagrees with its neighbour by
  // an interpolation residue everywhere. phase = 0 when unanchored: the
  // classic arithmetic is untouched.
  const step = Math.max(1, Math.round(opts.toneStep ?? 3));
  const phaseX = anchor ? anchor.x - Math.floor(anchor.x / step) * step : 0;
  const phaseY = anchor ? anchor.y - Math.floor(anchor.y / step) * step : 0;
  const LW = Math.ceil((W + phaseX) / step) + 1;
  const LH = Math.ceil((H + phaseY) / step) + 1;
  const lr = new Float32Array(LW * LH);
  const lg = new Float32Array(LW * LH);
  const lb = new Float32Array(LW * LH);

  for (let ly = 0; ly < LH; ly++) {
    const v = anchor
      ? Math.min(1, (anchor.y - phaseY + ly * step) / anchor.extentY)
      : Math.min(1, (ly * step) / H);
    for (let lx = 0; lx < LW; lx++) {
      const u = anchor
        ? (anchor.x - phaseX + lx * step) / anchor.extentX
        : Math.min(1, (lx * step) / W);

      const blotch = nBlotch.fbm(u, v, 2.4, 4, 2.05, 0.58) * 0.5 + 0.5;
      const m1 = nStain.fbm(u, v, 7.5, 5, 2.1, 0.5) * 0.5 + 0.5;
      const m2 = nStain.fbm(u + 3.1, v + 1.7, 15, 4, 2.1, 0.5) * 0.5 + 0.5;
      const mottle = m1 * m2;
      const fibre = nFibre.fbm(u * 0.14, v * 3.2, 90, 4, 2.0, 0.6);

      let tone = 0.62 + 0.38 * blotch;
      tone -= bAmt * 0.42 * Math.max(0, 0.55 - mottle) * 2;
      tone += gAmt * 0.1 * fibre;

      let r = grain[0] + (base[0] - grain[0]) * tone;
      let g = grain[1] + (base[1] - grain[1]) * tone;
      let b = grain[2] + (base[2] - grain[2]) * tone;

      const stainMask = Math.max(0, mottle * 1.9 - 0.95);
      if (stainMask > 0) {
        const t = Math.min(0.5, stainMask) * bAmt;
        r += (stainC[0] - r) * t; g += (stainC[1] - g) * t; b += (stainC[2] - b) * t;
      }

      if (vAmt > 0 && !anchor) {
        const ex = u * (1 - u), ey = v * (1 - v);
        let d = Math.min(1, ex * ey * 16);
        d += (nEdgeLo.sample(u, v, 5) * 0.5) * 0.3 + (nEdgeHi.sample(u, v, 22) * 0.5) * 0.09;
        const burn = 1 - Math.min(1, Math.max(0, (d - 0.02) / 0.42));
        const k = burn * burn * vAmt;
        r *= 1 - k * 0.55; g *= 1 - k * 0.62; b *= 1 - k * 0.7;
      }

      const li = ly * LW + lx;
      lr[li] = r; lg[li] = g; lb[li] = b;
    }
  }

  // ---- pass 2: bilinear upsample + full-resolution tooth ------------------
  const inv = 1 / step;
  for (let y = 0; y < H; y++) {
    const fy = (y + phaseY) * inv;
    const y0 = fy | 0;
    const ty = fy - y0;
    const row0 = y0 * LW, row1 = Math.min(LH - 1, y0 + 1) * LW;
    for (let x = 0; x < W; x++) {
      const fx = (x + phaseX) * inv;
      const x0 = fx | 0;
      const tx = fx - x0;
      const x1 = Math.min(LW - 1, x0 + 1);
      const a = row0 + x0, b2 = row0 + x1, c = row1 + x0, d2 = row1 + x1;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const n = (grainAt ? grainAt(x, y) : rand()) * 6.5 * gAmt;
      const i = (y * W + x) * 4;
      px[i] = lr[a] * w00 + lr[b2] * w10 + lr[c] * w01 + lr[d2] * w11 + n;
      px[i + 1] = lg[a] * w00 + lg[b2] * w10 + lg[c] * w01 + lg[d2] * w11 + n;
      px[i + 2] = lb[a] * w00 + lb[b2] * w10 + lb[c] * w01 + lb[d2] * w11 + n;
      px[i + 3] = 255;
    }
  }
  // `s` keeps the signature honest for callers that scale effects; the noise
  // frequencies above are already in normalised UV so they are resolution
  // independent by construction.
  void s;
  return px;
}

/**
 * A translucent grain/vignette pass painted OVER the finished map. Unifying the
 * whole drawing under one sheet of paper is what stops the symbol layers from
 * looking like stickers.
 */
export function renderPaperOverlay(opts: PaperOptions): Uint8ClampedArray {
  const { width: W, height: H, theme } = opts;
  const px = new Uint8ClampedArray(W * H * 4);
  const nSpot = new SphereNoise(opts.seed, 'paper-overlay');
  const nEdge = new SphereNoise(opts.seed, 'paper-overlay-edge');
  const dark = hexToRgb(theme.paper.stain);
  let hash = 0x1b873593;
  const rand = () => {
    hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5;
    return ((hash >>> 0) / 4294967296) * 2 - 1;
  };
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const i = (y * W + x) * 4;
      const spot = nSpot.fbm(u, v, 4.5, 4, 2.1, 0.55) * 0.5 + 0.5;
      const ex = u * (1 - u), ey = v * (1 - v);
      let d = Math.min(1, ex * ey * 16);
      d += (nEdge.sample(u, v, 6) * 0.5) * 0.28;
      const burn = 1 - Math.min(1, Math.max(0, (d - 0.01) / 0.4));

      const a = Math.min(1, burn * burn * theme.paper.vignette * 0.85 + Math.max(0, 0.5 - spot) * 0.34);
      const n = rand() * 5;
      px[i] = dark[0] + n; px[i + 1] = dark[1] + n; px[i + 2] = dark[2] + n;
      px[i + 3] = a * 255;
    }
  }
  return px;
}
