// ============================================
// World Generator — Glacial carving
// ============================================
// Fjords are not noise. Every fjord coast on Earth — Norway, Chile, Greenland,
// British Columbia, South Island — was cut by ice, and they all share the same
// signature: troughs far deeper than any river could cut, drowned below sea
// level, with flat U-shaped cross sections, hanging side valleys, and a fringe
// of rock islands where the ice scoured the coast bare.
//
// A river cannot do this. Fluvial erosion stops at sea level, because water needs
// a gradient to flow. Ice does not: a glacier flows under its own weight and will
// happily overdeepen its bed hundreds of metres below the sea. That single
// difference is why this needs its own pass rather than a tweak to the erosion
// coefficients.
//
// The model:
//   1. an ice mask from a GLACIAL-MAXIMUM temperature (several degrees colder
//      than the present day — fjords were carved during ice ages, not now)
//   2. ice flux by accumulation down the surface gradient, restricted to the
//      mask, so flux concentrates where valleys funnel ice toward the sea
//   3. abrasion ∝ flux × slope, allowed to cut below sea level
//   4. lateral widening of the cut, which is what turns a V into a U
//   5. cirques at the accumulation heads

import type { WorldParams } from './types';
import { SphereNoise } from './noise';

export interface GlacialResult {
  /** Ice thickness proxy 0–1 at the glacial maximum, for the glaciers view. */
  ice: Float32Array;
  /** Metres of rock removed (positive = lowered), for diagnostics. */
  carved: Float32Array;
  /** Number of cells that ended up below sea level because of ice. */
  drowned: number;
}

/**
 * Carve `elevation` in place. Returns the ice field and the carve depths.
 *
 * `params.glaciation` scales everything: 0 leaves the terrain untouched, 1 gives
 * a heavily glaciated world with fjords well into the mid-latitudes.
 */
export function applyGlaciers(
  params: WorldParams,
  elevation: Float32Array,
  onProgress?: (f: number) => void,
): GlacialResult {
  const W = params.width, H = W >> 1;
  const N = W * H;
  const g = Math.max(0, Math.min(1, params.glaciation));
  const ice = new Float32Array(N);
  const carved = new Float32Array(N);
  if (g <= 0.001) return { ice, carved, drowned: 0 };

  const noise = new SphereNoise(params.seed, 'glacier');
  const ws = params.worldScale;

  // ---- 1. the ice mask at the glacial maximum -----------------------------
  // Colder than the present by an amount that scales with the knob, and with a
  // wandering snowline so ice sheets do not follow a ruler-straight parallel.
  // The Last Glacial Maximum was about 5–6 °C colder than today globally.
  const coolingC = 1.5 + 7.5 * g;
  let iceCells = 0;
  for (let y = 0; y < H; y++) {
    const lat = Math.abs((0.5 - (y + 0.5) / H) * 180);
    const baseT = 29 - 51 * Math.pow(lat / 90, 1.9) + params.temperature - coolingC;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elevation[i];
      // Wandering snowline: ±3.5 °C of regional anomaly.
      const wob = 3.5 * noise.fbm(x / W, y / H, 2.6 * ws, 3);
      // Lapse rate: high ground is glaciated at far lower latitudes, which is
      // what puts alpine troughs in the tropics.
      const t = baseT + wob - 6.5 * Math.max(0, e);
      if (t >= 0) continue;
      // Accumulation grows as it gets colder, saturating: an ice sheet's centre
      // is not more erosive than its margin, it is less (it is frozen to its bed).
      const cold = Math.min(1, -t / 9);
      // Sea cells can hold an ice shelf but do not abrade rock.
      ice[i] = e > 0 ? cold : cold * 0.35;
      if (e > 0) iceCells++;
    }
  }
  onProgress?.(0.15);
  if (iceCells < N * 0.0004) return { ice, carved, drowned: 0 };

  // ---- 2. ice flux ---------------------------------------------------------
  // Steepest-descent accumulation, processed from high to low so every cell's
  // upstream total is final before it is passed on. Same machinery as drainage,
  // different mask and no requirement to stop at the shore.
  const order = new Int32Array(iceCells);
  {
    let k = 0;
    for (let i = 0; i < N; i++) if (ice[i] > 0 && elevation[i] > 0) order[k++] = i;
  }
  const orderArr = Array.from(order.subarray(0, iceCells));
  orderArr.sort((a, b) => elevation[b] - elevation[a]);

  const flux = new Float32Array(N);
  for (const i of orderArr) flux[i] += ice[i];

  const down = new Int32Array(N).fill(-1);
  for (const i of orderArr) {
    const x = i % W, y = (i / W) | 0;
    let best = -1, bestDrop = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = yy * W + ((x + dx + W) % W);
        const drop = (elevation[i] - elevation[j]) / (dx && dy ? 1.414 : 1);
        if (drop > bestDrop) { bestDrop = drop; best = j; }
      }
    }
    down[i] = best;
  }
  for (const i of orderArr) {
    const j = down[i];
    // Ice reaching the sea calves; ice reaching a non-glaciated cell melts.
    if (j >= 0) flux[j] += flux[i];
  }
  onProgress?.(0.45);

  // Normalise flux so the erosion constant means the same thing at any
  // resolution and any ice extent.
  let fluxRef = 1e-6;
  {
    const sample: number[] = [];
    for (let k = 0; k < orderArr.length; k += 5) sample.push(flux[orderArr[k]]);
    sample.sort((a, b) => a - b);
    fluxRef = sample[Math.floor(sample.length * 0.985)] || 1;
  }

  // ---- 3. abrasion ---------------------------------------------------------
  // ė = K · u^m · slope^n, the standard glacial abrasion law with sliding speed
  // standing in for flux. Unlike the fluvial version there is no base level: the
  // trough is free to go below zero, and that is the entire point.
  const maxCut = 3.4 * g;                 // km, before the width factor
  for (const i of orderArr) {
    const x = i % W, y = (i / W) | 0;
    const xr = y * W + ((x + 1) % W), xl = y * W + ((x - 1 + W) % W);
    const yd = Math.min(H - 1, y + 1) * W + x, yu = Math.max(0, y - 1) * W + x;
    const slope = Math.hypot(
      (elevation[xr] - elevation[xl]) * 0.5,
      (elevation[yd] - elevation[yu]) * 0.5,
    );
    // Erosion is concentrated in OUTLET glaciers, not spread over the ice sheet.
    // An ice-sheet interior is frozen to its bed and erodes almost nothing; the
    // work is done by the fast trunks that funnel that whole catchment through a
    // valley. Subtracting a floor from the normalised flux before raising it to a
    // power is what turns a broad, uniform lowering — which just smooths the
    // world and loses the landform — into deep, narrow troughs.
    const u = Math.max(0, Math.min(1.7, flux[i] / fluxRef) - 0.09);
    // Slope still matters, but a trunk glacier on gentle ground overdeepens all
    // the same: that basin IS the fjord.
    const cut = maxCut * Math.pow(u, 1.3) * Math.min(1, 0.5 + slope * 2.0) * ice[i];
    carved[i] = cut;
  }
  onProgress?.(0.65);

  // ---- 4. lateral widening: V becomes U -----------------------------------
  // Blurring the CARVE DEPTH (not the terrain) spreads the trough sideways while
  // keeping its floor flat, which is exactly the difference between a river
  // canyon and a glacial valley. Blurring the terrain instead would just soften
  // everything and lose the trough altogether.
  // Radius kept small on purpose. Widening too far spreads the cut into a broad
  // shallow basin and the trough disappears — the first attempt at this made the
  // whole glaciated zone smoother rather than more dramatic.
  const R = Math.max(1, Math.round((W / 1100) * (1 + g)));
  const wide = boxBlur(carved, W, H, R, 2);
  // The axis keeps its full depth; the walls pull back to meet it.
  for (let i = 0; i < N; i++) carved[i] = Math.max(carved[i], wide[i] * 0.95);

  // ---- 5. cirques ---------------------------------------------------------
  // Ice heads — glaciated cells with almost no ice arriving from upstream — get
  // a scooped bowl with a steep back wall. These are the amphitheatres at the
  // top of every glaciated range.
  for (const i of orderArr) {
    if (flux[i] > fluxRef * 0.04) continue;
    if (ice[i] < 0.55) continue;
    // Only on genuinely steep headwalls, and only sometimes — a bowl at every
    // ice head fills the uplands with identical dimples.
    const x = i % W, y = (i / W) | 0;
    if (noise.sample(x / W + 0.31, y / H + 0.77, 260 * ws) < 0.35) continue;
    const bowl = 0.26 * g * ice[i];
    const rad = Math.max(1, Math.round(W / 1000));
    for (let dy = -rad - 1; dy <= rad + 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -rad - 1; dx <= rad + 1; dx++) {
        // A jittered radius: a perfectly circular bowl becomes a perfectly
        // circular tarn, and nothing on a map reads as artificial faster.
        const ang = Math.atan2(dy, dx);
        const wobR = (rad + 0.5) * (0.72 + 0.5 * (noise.sample(
          Math.cos(ang) * 0.5 + x / W, Math.sin(ang) * 0.5 + y / H, 40) * 0.5 + 0.5));
        const d = Math.hypot(dx, dy) / wobR;
        if (d > 1) continue;
        const j = yy * W + ((x + dx + W) % W);
        carved[j] = Math.max(carved[j], bowl * (1 - d * d));
      }
    }
  }
  onProgress?.(0.85);

  // ---- apply --------------------------------------------------------------
  let drowned = 0;
  for (let i = 0; i < N; i++) {
    if (carved[i] <= 0) continue;
    const before = elevation[i];
    elevation[i] = before - carved[i];
    if (before > 0 && elevation[i] <= 0) drowned++;
  }

  // Isostatic rebound, in the crudest honest form: land that carried a lot of
  // ice sat lower under the weight and rose after it melted. Without this the
  // whole glaciated zone ends up as sea and the map loses its north.
  const load = boxBlur(ice, W, H, Math.max(2, Math.round(W / 260)), 2);
  for (let i = 0; i < N; i++) {
    if (load[i] <= 0.02) continue;
    elevation[i] += 0.13 * g * load[i];
  }
  onProgress?.(1);
  return { ice, carved, drowned };
}

/** Separable box blur, wrapping in x and clamping in y. */
function boxBlur(src: Float32Array, W: number, H: number, radius: number, passes: number): Float32Array {
  const a = Float32Array.from(src);
  const b = new Float32Array(W * H);
  const R = Math.max(1, radius);
  const inv = 1 / (2 * R + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += a[o + ((k % W) + W) % W];
      for (let x = 0; x < W; x++) {
        b[o + x] = sum * inv;
        sum += a[o + ((x + R + 1) % W)] - a[o + ((x - R + 2 * W) % W)];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += b[Math.min(H - 1, Math.max(0, k)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum * inv;
        sum += b[Math.min(H - 1, y + R + 1) * W + x] - b[Math.max(0, y - R) * W + x];
      }
    }
  }
  return a;
}
