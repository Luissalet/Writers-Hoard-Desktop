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

export interface PaperOptions {
  width: number;
  height: number;
  seed: string;
  theme: CartoTheme;
  /** Scale factor: effects are authored for a ~1200px sheet. */
  scale?: number;
}

/**
 * Render the parchment into an RGBA buffer. Cost is ~10 noise samples per
 * pixel; at 2048×1024 that is ~0.6 s, so callers should cache it (the map view
 * regenerates it only when the seed, theme or size changes).
 */
export function renderPaper(opts: PaperOptions): Uint8ClampedArray {
  const { width: W, height: H, theme } = opts;
  const s = opts.scale ?? Math.max(W, H) / 1200;
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

  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const i = (y * W + x) * 4;

      // --- large tone field ------------------------------------------------
      const blotch = nBlotch.fbm(u, v, 2.4, 4, 2.05, 0.58) * 0.5 + 0.5;
      // --- mid mottle, multiplied so stains stay dark and sparse ------------
      const m1 = nStain.fbm(u, v, 7.5, 5, 2.1, 0.5) * 0.5 + 0.5;
      const m2 = nStain.fbm(u + 3.1, v + 1.7, 15, 4, 2.1, 0.5) * 0.5 + 0.5;
      const mottle = m1 * m2;
      // --- fibre: fBm sampled with a stretched x so streaks run horizontally -
      const fibre = nFibre.fbm(u * 0.14, v * 3.2, 90, 4, 2.0, 0.6);

      // Compose tone: 0 = grain color, 1 = base color.
      let tone = 0.62 + 0.38 * blotch;
      tone -= bAmt * 0.42 * Math.max(0, 0.55 - mottle) * 2;
      tone += gAmt * 0.1 * fibre;

      let r = grain[0] + (base[0] - grain[0]) * tone;
      let g = grain[1] + (base[1] - grain[1]) * tone;
      let b = grain[2] + (base[2] - grain[2]) * tone;

      // --- stains: thresholded low-frequency noise, warm and translucent ----
      const stainMask = Math.max(0, mottle * 1.9 - 0.95);
      if (stainMask > 0) {
        const t = Math.min(0.5, stainMask) * bAmt;
        r += (stainC[0] - r) * t; g += (stainC[1] - g) * t; b += (stainC[2] - b) * t;
      }

      // --- edge burn: perturb the DISTANCE FIELD, not the colour ------------
      // e.x*e.y*16 is the classic polynomial vignette; two noise bands turn its
      // smooth oval into scalloped, fibre-ragged paper edge.
      if (vAmt > 0) {
        const ex = u * (1 - u), ey = v * (1 - v);
        let d = Math.min(1, ex * ey * 16);
        d += (nEdgeLo.sample(u, v, 5) * 0.5) * 0.3 + (nEdgeHi.sample(u, v, 22) * 0.5) * 0.09;
        const burn = 1 - Math.min(1, Math.max(0, (d - 0.02) / 0.42));
        const k = burn * burn * vAmt;
        r *= 1 - k * 0.55; g *= 1 - k * 0.62; b *= 1 - k * 0.7;
      }

      // --- tooth ------------------------------------------------------------
      const n = rand() * 6.5 * gAmt;
      px[i] = r + n; px[i + 1] = g + n; px[i + 2] = b + n; px[i + 3] = 255;
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
