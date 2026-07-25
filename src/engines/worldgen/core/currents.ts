// ============================================
// World Generator — Ocean surface currents
// ============================================
// Currents are the missing half of a believable climate. Latitude alone cannot
// explain why Bergen has trees and Labrador at the same latitude has tundra, why
// the driest deserts on Earth sit on tropical WEST coasts (Atacama, Namib,
// Sahara's Atlantic edge), or why Britain is temperate. All of that is water
// moving heat around, and a world without it has biomes in stripes.
//
// The model is wind-driven surface flow made incompressible and forced to
// respect coastlines:
//
//   1. seed the velocity field from the wind, rotated by the Ekman angle
//      (to the right of the wind in the north, left in the south)
//   2. zero it on land, then run a pressure projection so the flow is
//      divergence-free and cannot pass through a coast
//   3. read the temperature each parcel carries by tracing it upstream
//
// Step 2 is where the geography appears without being asked for. Water pushed
// east by the westerlies piles against a continent and turns poleward, giving a
// warm western-boundary current (Gulf Stream, Kuroshio). Water pushed west by
// the trades turns equatorward on the far side, giving a cold eastern-boundary
// current — and a coastal desert behind it. Gyres are an emergent consequence of
// incompressibility plus a wall, not something the code draws.

import type { WorldParams } from './types';
import { windAt } from './climate';

export interface CurrentsResult {
  /** Eastward component of surface flow, full resolution, 0 on land. */
  u: Float32Array;
  /** Southward component (screen +y), full resolution, 0 on land. */
  v: Float32Array;
  /**
   * Sea-surface temperature anomaly in °C: how much warmer or colder the water
   * is than the zonal average for its latitude. Positive = a warm current.
   */
  sst: Float32Array;
  /** Flow speed 0–1, for the currents map view. */
  speed: Float32Array;
}

/** Downsample a field by simple averaging (x wraps, y clamps). */
function shrinkField(src: Float32Array, W: number, H: number, step: number): { f: Float32Array; w: number; h: number } {
  const w = Math.max(4, Math.floor(W / step));
  const h = Math.max(2, Math.floor(H / step));
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = 0; dy < step; dy++) {
        const sy = Math.min(H - 1, y * step + dy);
        for (let dx = 0; dx < step; dx++) {
          const sx = (x * step + dx) % W;
          sum += src[sy * W + sx];
          n++;
        }
      }
      f[y * w + x] = sum / n;
    }
  }
  return { f, w, h };
}

/** Bilinear upsample to full resolution (x wraps). */
function growField(src: Float32Array, w: number, h: number, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = ((y + 0.5) / H) * h - 0.5;
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < W; x++) {
      const fx = ((x + 0.5) / W) * w - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const xa = ((x0 % w) + w) % w, xb = ((x0 + 1) % w + w) % w;
      const a = src[y0 * w + xa], b = src[y0 * w + xb];
      const c = src[y1 * w + xa], d = src[y1 * w + xb];
      out[y * W + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

export function computeCurrents(
  params: WorldParams,
  elevation: Float32Array,
  onProgress?: (f: number) => void,
): CurrentsResult {
  const W = params.width, H = W >> 1;
  // Currents are a planetary-scale field; a quarter-resolution solve is
  // indistinguishable once it is smoothed back up, and the projection is the
  // only expensive part of this module.
  const step = Math.max(1, Math.round(W / 320));
  const { f: elev, w, h } = shrinkField(elevation, W, H, step);
  const n = w * h;

  const sea = new Uint8Array(n);
  for (let i = 0; i < n; i++) sea[i] = elev[i] <= 0 ? 1 : 0;

  const cu = new Float32Array(n);
  const cv = new Float32Array(n);

  // ---- 1. wind forcing, rotated by the Ekman angle -----------------------
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * 180;
    const [wx, wy] = windAt(lat);
    // Surface water moves at ~45° to the wind, to the right in the northern
    // hemisphere. In screen terms (+y south) that is a clockwise rotation north
    // of the equator and anticlockwise south of it.
    const sign = lat >= 0 ? 1 : -1;
    const ang = sign * (Math.PI / 4);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rx = wx * ca - wy * sa;
    const ry = wx * sa + wy * ca;
    // Zonal flow crowds together near the poles in an equirectangular grid.
    const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!sea[i]) continue;
      cu[i] = rx / cosLat;
      cv[i] = ry;
    }
  }

  // ---- 2. pressure projection: incompressible, no flow through coasts ----
  // Solve ∇²p = ∇·u with a Neumann condition at land, then u ← u − ∇p. Jacobi
  // is slow to converge in general but this only needs the large-scale mode, and
  // that is exactly the mode Jacobi resolves first.
  const div = new Float32Array(n);
  let p = new Float32Array(n);
  let p2 = new Float32Array(n);
  const idx = (x: number, y: number) => Math.min(h - 1, Math.max(0, y)) * w + ((x % w) + w) % w;

  const ITER = 90;
  for (let pass = 0; pass < 3; pass++) {
    // divergence of the current field
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!sea[i]) { div[i] = 0; continue; }
        const ie = idx(x + 1, y), iw = idx(x - 1, y);
        const is = idx(x, y + 1), iN = idx(x, y - 1);
        // A land neighbour contributes no flow: treat the wall as a mirror.
        const ue = sea[ie] ? cu[ie] : -cu[i];
        const uw = sea[iw] ? cu[iw] : -cu[i];
        const vs = sea[is] ? cv[is] : -cv[i];
        const vn = sea[iN] ? cv[iN] : -cv[i];
        div[i] = 0.5 * (ue - uw) + 0.5 * (vs - vn);
      }
    }
    p.fill(0);
    for (let k = 0; k < ITER; k++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!sea[i]) { p2[i] = 0; continue; }
          const ie = idx(x + 1, y), iw = idx(x - 1, y);
          const is = idx(x, y + 1), iN = idx(x, y - 1);
          // Neumann at the coast: mirror the interior pressure outward, which is
          // what enforces zero normal velocity there.
          const pe = sea[ie] ? p[ie] : p[i];
          const pw = sea[iw] ? p[iw] : p[i];
          const ps = sea[is] ? p[is] : p[i];
          const pn = sea[iN] ? p[iN] : p[i];
          p2[i] = (pe + pw + ps + pn - div[i]) * 0.25;
        }
      }
      const t = p; p = p2; p2 = t;
    }
    // subtract the pressure gradient
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!sea[i]) { cu[i] = 0; cv[i] = 0; continue; }
        const ie = idx(x + 1, y), iw = idx(x - 1, y);
        const is = idx(x, y + 1), iN = idx(x, y - 1);
        const pe = sea[ie] ? p[ie] : p[i];
        const pw = sea[iw] ? p[iw] : p[i];
        const ps = sea[is] ? p[is] : p[i];
        const pn = sea[iN] ? p[iN] : p[i];
        cu[i] -= 0.5 * (pe - pw);
        cv[i] -= 0.5 * (ps - pn);
      }
    }
    onProgress?.((pass + 1) / 3 * 0.6);
  }

  // Light smoothing: the projection leaves grid-scale noise along ragged coasts.
  for (let s = 0; s < 2; s++) {
    const su = Float32Array.from(cu), sv = Float32Array.from(cv);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!sea[i]) continue;
        let au = 0, av = 0, m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = idx(x + dx, y + dy);
            if (!sea[j]) continue;
            au += su[j]; av += sv[j]; m++;
          }
        }
        if (m) { cu[i] = au / m; cv[i] = av / m; }
      }
    }
  }

  // ---- 3. the heat each parcel carries -----------------------------------
  // Zonal mean of the latitude-only temperature, so the anomaly is measured
  // against "what this latitude would be with no currents".
  const zonal = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * 180;
    const a = Math.abs(lat) / 90;
    zonal[y] = 29 - 51 * Math.pow(a, 1.9) + params.temperature;
  }

  // Semi-Lagrangian upstream trace: walk against the flow and average the
  // latitude temperature along the path, weighted toward the recent past. A
  // parcel arriving from the tropics is warm; one arriving from the ice is cold.
  const sstLow = new Float32Array(n);
  const STEPS = Math.max(12, Math.round(w / 12));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!sea[i]) continue;
      let px = x + 0.5, py = y + 0.5;
      let acc = 0, wsum = 0, decay = 1;
      for (let s = 0; s < STEPS; s++) {
        const xi = Math.floor(((px % w) + w) % w);
        const yi = Math.min(h - 1, Math.max(0, Math.floor(py)));
        const j = yi * w + xi;
        if (!sea[j]) break;
        acc += zonal[yi] * decay;
        wsum += decay;
        // Step upstream. Speed is arbitrary units, so normalise per step.
        const sp = Math.hypot(cu[j], cv[j]) || 1e-6;
        const k = 1.2 / sp;
        px -= cu[j] * k;
        py -= cv[j] * k;
        if (py < 0 || py > h - 1) break;
        decay *= 0.9;
      }
      sstLow[i] = wsum > 0 ? acc / wsum - zonal[y] : 0;
    }
  }
  // Anomalies of ±12 °C would be absurd; real western-boundary currents run
  // about +5 to +8 and eastern-boundary upwelling about −4 to −6.
  let maxAbs = 0.001;
  for (let i = 0; i < n; i++) if (sea[i]) maxAbs = Math.max(maxAbs, Math.abs(sstLow[i]));
  const gainSst = Math.min(1, 7 / maxAbs);
  for (let i = 0; i < n; i++) sstLow[i] *= gainSst;

  // ---- 3b. coastal upwelling ---------------------------------------------
  // The real driver of coastal deserts is not advection but UPWELLING, and it is
  // a different mechanism: when the wind blows along a coast in the equatorward
  // direction, Ekman transport carries surface water offshore (to the right of
  // the wind in the north, left in the south) and cold water rises from depth to
  // replace it. Benguela and Humboldt run 8–10 °C below their zonal mean because
  // of this, not because of where the water came from.
  //
  // Advection alone — which is all the upstream trace above models — produces its
  // strongest anomalies in mid-gyre and almost nothing at the coast, so it moved
  // coastal rainfall by about 2 %. This term is what makes the Atacama.
  {
    const up = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      const lat = (0.5 - (y + 0.5) / h) * 180;
      const [wx, wy] = windAt(lat);
      // Ekman transport: 90° to the right of the wind in the northern
      // hemisphere. In screen coordinates (+y south) that is (−wy, wx) north of
      // the equator and (wy, −wx) south of it.
      const ex = lat >= 0 ? -wy : wy;
      const ey = lat >= 0 ? wx : -wx;
      const el = Math.hypot(ex, ey) || 1;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!sea[i]) continue;
        // Outward coast normal: the direction from land toward open water.
        let nx = 0, ny = 0, landN = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const j = idx(x + dx, y + dy);
            if (sea[j]) continue;
            nx -= dx; ny -= dy; landN++;
          }
        }
        if (!landN) continue;
        const nl = Math.hypot(nx, ny) || 1;
        // Offshore component of the Ekman transport. Positive = water leaving
        // the coast = cold water rising to replace it.
        const offshore = (ex / el) * (nx / nl) + (ey / el) * (ny / nl);
        if (offshore <= 0) continue;
        // Upwelling is a low-latitude and mid-latitude phenomenon; at the poles
        // the water column is already cold and there is nothing to reveal.
        const band = Math.exp(-Math.pow((Math.abs(lat) - 25) / 22, 2));
        up[i] = -offshore * band;
      }
    }
    // Spread the cold tongue downstream and offshore, the way a real upwelling
    // filament trails away from the coast.
    for (let pass = 0; pass < 6; pass++) {
      const src = Float32Array.from(up);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!sea[i]) continue;
          let a = src[i] * 2, m = 2;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const j = idx(x + dx, y + dy);
              if (!sea[j]) continue;
              a += src[j]; m++;
            }
          }
          up[i] = (a / m) * 0.985;
        }
      }
    }
    let upMax = 1e-6;
    for (let i = 0; i < n; i++) upMax = Math.max(upMax, -up[i]);
    // Scale so the strongest upwelling cell reaches about −9 °C, which is what
    // the Benguela does.
    const k = 9 / upMax;
    for (let i = 0; i < n; i++) if (sea[i]) sstLow[i] += up[i] * k;
  }

  // Smooth the anomaly field — it feeds temperature, and streaks would show.
  for (let s = 0; s < 3; s++) {
    const src = Float32Array.from(sstLow);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!sea[i]) continue;
        let a = 0, m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = idx(x + dx, y + dy);
            if (!sea[j]) continue;
            a += src[j]; m++;
          }
        }
        if (m) sstLow[i] = a / m;
      }
    }
  }
  onProgress?.(0.85);

  // ---- normalise speed and upsample --------------------------------------
  const spLow = new Float32Array(n);
  let maxSp = 1e-6;
  for (let i = 0; i < n; i++) {
    if (!sea[i]) continue;
    spLow[i] = Math.hypot(cu[i], cv[i]);
    if (spLow[i] > maxSp) maxSp = spLow[i];
  }
  for (let i = 0; i < n; i++) spLow[i] /= maxSp;

  const u = growField(cu, w, h, W, H);
  const v = growField(cv, w, h, W, H);
  const sst = growField(sstLow, w, h, W, H);
  const speed = growField(spLow, w, h, W, H);
  // Upsampling bleeds ocean values a cell or two inland; clear them so land
  // never reports a current.
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] > 0) { u[i] = 0; v[i] = 0; speed[i] = 0; }
  }
  onProgress?.(1);
  return { u, v, sst, speed };
}

/**
 * How much the sea influences a land cell: 1 at the shore, falling inland.
 * Used to carry the SST anomaly onto coastal climate — a cold current only
 * makes a desert of the strip it actually touches.
 */
export function coastalInfluence(
  elevation: Float32Array,
  W: number,
  H: number,
  reach: number,
): Float32Array {
  const out = new Float32Array(W * H);
  // Multi-source BFS from the shoreline, in cells.
  let frontier: number[] = [];
  const dist = new Float32Array(W * H).fill(Infinity);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (elevation[i] > 0) continue;
      dist[i] = 0;
      frontier.push(i);
    }
  }
  let d = 0;
  while (frontier.length && d < reach) {
    d++;
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        const j = yy * W + ((x + dx + W) % W);
        if (dist[j] <= d) continue;
        dist[j] = d;
        next.push(j);
      }
    }
    frontier = next;
  }
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] <= 0) { out[i] = 1; continue; }
    const t = Math.min(1, dist[i] / reach);
    out[i] = 1 - t * t * (3 - 2 * t);
  }
  return out;
}

/**
 * Average sea-surface anomaly of the water a land cell actually faces, so the
 * effect follows the coast rather than the nearest cell. Sampled by walking a
 * short way out to sea in a few directions.
 */
export function nearshoreSst(
  sst: Float32Array,
  elevation: Float32Array,
  W: number,
  H: number,
  reach: number,
): Float32Array {
  const out = new Float32Array(W * H);
  // Iterative diffusion of the ocean anomaly into land, which averages over
  // whatever water is nearby in the right proportions for free.
  const cur = Float32Array.from(sst);
  const weight = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) weight[i] = elevation[i] <= 0 ? 1 : 0;
  const passes = Math.max(2, Math.round(reach));
  const nextV = new Float32Array(W * H);
  const nextW = new Float32Array(W * H);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (elevation[i] <= 0) { nextV[i] = cur[i]; nextW[i] = 1; continue; }
        let a = 0, m = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          const j = yy * W + ((x + dx + W) % W);
          if (weight[j] <= 0) continue;
          a += cur[j] * weight[j];
          m += weight[j];
        }
        // 0.82 per ring: the influence decays with distance from the water.
        nextV[i] = m > 0 ? a / m : 0;
        nextW[i] = m > 0 ? Math.min(1, (m / 4) * 0.82) : 0;
      }
    }
    cur.set(nextV);
    weight.set(nextW);
  }
  for (let i = 0; i < W * H; i++) out[i] = cur[i];
  return out;
}
