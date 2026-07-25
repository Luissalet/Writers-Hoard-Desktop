// ============================================
// Cartography — Derived scalar fields
// ============================================
// Everything the symbol/effect layers need that the physical pipeline does not
// already produce: distance transforms (for the coastal halo), separable blurs,
// local relief (mountains vs plateaus), ridge skeletons, connected landmass
// labelling, and blue-noise point sets.
//
// All of it is pure, deterministic and framework-free.

import type { Rng } from '../core/rng';

/** Signed-distance-ish helper: exact Euclidean distance transform (squared). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  // Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions".
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

/**
 * Exact Euclidean distance (in cells) from every cell to the nearest cell where
 * `mask` is non-zero. Cells inside the mask get 0. O(W*H).
 *
 * `wrapX` handles the equirectangular seam by running the horizontal pass over
 * a tripled row — the world genuinely wraps, and a halo that stops dead at
 * x=0 is the single most obvious "this is a texture" tell.
 */
export function distanceTo(mask: Uint8Array, W: number, H: number, wrapX = true): Float32Array {
  const INF = 1e12;
  const out = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = mask[i] ? 0 : INF;

  const rowN = wrapX ? W * 3 : W;
  const f = new Float64Array(Math.max(rowN, H));
  const d = new Float64Array(Math.max(rowN, H));
  const v = new Int32Array(Math.max(rowN, H));
  const z = new Float64Array(Math.max(rowN, H) + 1);

  // Horizontal pass.
  for (let y = 0; y < H; y++) {
    const o = y * W;
    if (wrapX) {
      for (let x = 0; x < W; x++) {
        const val = out[o + x];
        f[x] = val; f[x + W] = val; f[x + 2 * W] = val;
      }
      edt1d(f, rowN, d, v, z);
      for (let x = 0; x < W; x++) out[o + x] = d[x + W];
    } else {
      for (let x = 0; x < W; x++) f[x] = out[o + x];
      edt1d(f, W, d, v, z);
      for (let x = 0; x < W; x++) out[o + x] = d[x];
    }
  }
  // Vertical pass.
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = out[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }

  const res = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) res[i] = Math.sqrt(out[i]);
  return res;
}

/** Separable box blur repeated `passes` times ≈ Gaussian. Wraps in x. */
export function blur(src: Float32Array, W: number, H: number, radius: number, passes = 2): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(W * H);
  const R = Math.max(1, Math.round(radius));
  const inv = 1 / (2 * R + 1);
  for (let p = 0; p < passes; p++) {
    // horizontal (wrapping)
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += a[o + ((k % W) + W) % W];
      for (let x = 0; x < W; x++) {
        b[o + x] = sum * inv;
        sum += a[o + ((x + R + 1) % W)] - a[o + ((x - R + W * 2) % W)];
      }
    }
    // vertical (clamped)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += b[Math.min(H - 1, Math.max(0, k)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum * inv;
        const add = Math.min(H - 1, y + R + 1);
        const drop = Math.max(0, y - R);
        sum += b[add * W + x] - b[drop * W + x];
      }
    }
  }
  b = a;
  return b;
}

/**
 * Local relief: how far a cell stands above its own neighbourhood. This is the
 * field that separates a genuine mountain from a high plateau — the Tibetan
 * plateau is 5 km up but has near-zero local relief and must NOT get covered
 * in mountain symbols.
 */
export function localRelief(elevation: Float32Array, W: number, H: number, radius: number): Float32Array {
  const base = blur(elevation, W, H, radius, 2);
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = elevation[i] - base[i];
  return out;
}

/**
 * Ridge mask via non-maximum suppression: a cell is on a crest when it is a
 * local maximum along at least one of the four axes. Combined with a relief
 * threshold this gives clean mountain spines to string symbol chains along.
 */
export function ridgeMask(elevation: Float32Array, relief: Float32Array, W: number, H: number, reliefMin: number): Uint8Array {
  const out = new Uint8Array(W * H);
  const at = (x: number, y: number) => elevation[Math.min(H - 1, Math.max(0, y)) * W + ((x % W) + W) % W];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (elevation[i] <= 0 || relief[i] < reliefMin) continue;
      const e = elevation[i];
      if (
        (e >= at(x - 1, y) && e >= at(x + 1, y)) ||
        (e >= at(x, y - 1) && e >= at(x, y + 1)) ||
        (e >= at(x - 1, y - 1) && e >= at(x + 1, y + 1)) ||
        (e >= at(x + 1, y - 1) && e >= at(x - 1, y + 1))
      ) out[i] = 1;
    }
  }
  return out;
}

/**
 * Label connected land regions (4-connected, wrapping in x). Returns the label
 * per cell (0 = water) plus each region's cell count. Symbol placement uses
 * this to enforce Dragons Abound's rule that both feet of a mountain must sit
 * on the SAME landmass — otherwise a symbol bridges a strait and reads as a
 * drawing error.
 */
export function labelLandmasses(elevation: Float32Array, W: number, H: number): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(W * H).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(W * H);
  let next = 0;
  for (let s = 0; s < W * H; s++) {
    if (elevation[s] <= 0 || label[s] >= 0) continue;
    const id = next++;
    let sp = 0;
    stack[sp++] = s;
    label[s] = id;
    let count = 0;
    while (sp > 0) {
      const i = stack[--sp];
      count++;
      const x = i % W, y = (i / W) | 0;
      const nb = [
        y * W + ((x + 1) % W),
        y * W + ((x - 1 + W) % W),
        y > 0 ? i - W : -1,
        y < H - 1 ? i + W : -1,
      ];
      for (const n of nb) {
        if (n < 0 || label[n] >= 0 || elevation[n] <= 0) continue;
        label[n] = id;
        stack[sp++] = n;
      }
    }
    sizes.push(count);
  }
  return { label, sizes };
}

export interface ScatterPoint { x: number; y: number; score: number }

/**
 * Weighted blue-noise scatter. Candidate cells are visited in descending score
 * (Dragons Abound: "walk through the mountains from biggest to smallest, so
 * the tallest get drawn preferentially") and accepted only when no earlier
 * point sits within `radiusAt(score)` — the exclusion-radius density control.
 *
 * A uniform grid keeps the neighbour query O(1) so this stays linear even with
 * a million candidate cells.
 */
export function scatterByScore(
  score: Float32Array,
  W: number,
  H: number,
  opts: {
    minScore: number;
    radiusAt: (score: number, x: number, y: number) => number;
    maxPoints?: number;
    accept?: (x: number, y: number) => boolean;
    jitter?: number;
    rng?: Rng;
  },
): ScatterPoint[] {
  const cands: number[] = [];
  for (let i = 0; i < W * H; i++) if (score[i] >= opts.minScore) cands.push(i);
  cands.sort((a, b) => score[b] - score[a]);

  // Spatial hash sized to the coarsest expected radius.
  const cell = Math.max(2, Math.round(opts.radiusAt(1, 0, 0)));
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  const grid: ScatterPoint[][] = Array.from({ length: gw * gh }, () => []);
  const out: ScatterPoint[] = [];
  const max = opts.maxPoints ?? 20000;
  const jit = opts.jitter ?? 0;

  for (const i of cands) {
    if (out.length >= max) break;
    let x = i % W;
    let y = (i / W) | 0;
    if (jit && opts.rng) {
      x += (opts.rng() - 0.5) * 2 * jit;
      y += (opts.rng() - 0.5) * 2 * jit;
    }
    if (opts.accept && !opts.accept(x, y)) continue;
    const r = opts.radiusAt(score[i], x, y);
    const r2 = r * r;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    const span = Math.ceil(r / cell);
    let blocked = false;
    for (let dy = -span; dy <= span && !blocked; dy++) {
      const yy = gy + dy;
      if (yy < 0 || yy >= gh) continue;
      for (let dx = -span; dx <= span && !blocked; dx++) {
        const xx = ((gx + dx) % gw + gw) % gw; // wrap in x
        for (const p of grid[yy * gw + xx]) {
          let ddx = p.x - x;
          if (ddx > W / 2) ddx -= W;
          if (ddx < -W / 2) ddx += W;
          const ddy = p.y - y;
          if (ddx * ddx + ddy * ddy < r2) { blocked = true; break; }
        }
      }
    }
    if (blocked) continue;
    const pt: ScatterPoint = { x, y, score: score[i] };
    out.push(pt);
    const cx = Math.min(gw - 1, Math.max(0, Math.floor(x / cell)));
    const cy = Math.min(gh - 1, Math.max(0, Math.floor(y / cell)));
    grid[cy * gw + cx].push(pt);
  }
  return out;
}

/** Bilinear sample of a field with x-wrap and y-clamp. */
export function sampleField(f: Float32Array, W: number, H: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.min(H - 1, Math.max(0, Math.floor(y)));
  const tx = x - x0, ty = y - y0;
  const y1 = Math.min(H - 1, y0 + 1);
  const xa = ((x0 % W) + W) % W, xb = ((x0 + 1) % W + W) % W;
  const a = f[y0 * W + xa], b = f[y0 * W + xb], c = f[y1 * W + xa], d = f[y1 * W + xb];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Trace crest lines out of a ridge mask. Starting from the highest unvisited
 * ridge cell, walk greedily to the highest unvisited ridge neighbour, in both
 * directions — the result follows an actual watershed divide rather than a
 * best-fit line through a blob, which is what makes a range read as a range
 * instead of a row of stamps.
 *
 * Returns paths as cell-index arrays, longest first.
 */
export function traceRidgeChains(
  ridges: Uint8Array,
  elevation: Float32Array,
  W: number,
  H: number,
  minLength = 6,
): number[][] {
  const visited = new Uint8Array(W * H);
  const seeds: number[] = [];
  for (let i = 0; i < W * H; i++) if (ridges[i]) seeds.push(i);
  seeds.sort((a, b) => elevation[b] - elevation[a]);

  const nbrs = (i: number): number[] => {
    const x = i % W, y = (i / W) | 0;
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        out.push(yy * W + ((x + dx + W) % W));
      }
    }
    return out;
  };

  const chains: number[][] = [];
  for (const s of seeds) {
    if (visited[s]) continue;
    visited[s] = 1;
    const halves: number[][] = [];
    for (let dir = 0; dir < 2; dir++) {
      const path: number[] = [];
      let cur = s;
      let px = 0, py = 0; // previous step direction, to resist doubling back
      for (let step = 0; step < 4096; step++) {
        let best = -1, bestScore = -Infinity;
        for (const n of nbrs(cur)) {
          if (visited[n] || !ridges[n]) continue;
          const nx = ((n % W) - (cur % W) + W + W / 2) % W - W / 2;
          const ny = ((n / W) | 0) - ((cur / W) | 0);
          // On the first step of the second half, prefer the opposite heading.
          const align = px || py ? (nx * px + ny * py) / (Math.hypot(nx, ny) * Math.hypot(px, py) || 1) : 0;
          const score = elevation[n] + align * 0.35;
          if (score > bestScore) { bestScore = score; best = n; }
        }
        if (best < 0) break;
        px = ((best % W) - (cur % W) + W + W / 2) % W - W / 2;
        py = ((best / W) | 0) - ((cur / W) | 0);
        visited[best] = 1;
        path.push(best);
        cur = best;
      }
      halves.push(path);
    }
    const chain = [...halves[0].reverse(), s, ...halves[1]];
    if (chain.length >= minLength) chains.push(chain);
  }
  chains.sort((a, b) => b.length - a.length);
  return chains;
}
