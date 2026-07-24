// ============================================
// World Generator — Climate (temperature, winds, rainfall)
// ============================================
// Temperature falls off with latitude and altitude (6.5 °C/km lapse rate).
// Moisture is evaporated over water and advected by three latitudinal wind
// belts per hemisphere (trades / westerlies / polar easterlies). Rain falls
// preferentially with orographic lift and in the ITCZ + mid-latitude storm
// belts; whatever crosses a mountain range has rained out — automatic rain
// shadows and continental-interior deserts. Runs on a half-resolution grid
// (climate is smooth) and bilinearly upsamples.

import { CylinderNoise } from './noise';
import type { WorldParams } from './types';

export interface ClimateResult {
  /** °C at cell (lapse-adjusted). */
  temperature: Float32Array;
  /** mm/year. */
  precipitation: Float32Array;
}

/** Zonal (u) and meridional (v) wind at a latitude, in grid-direction terms.
 *  +x = east, +y = south (screen space). Returns [wx, wy]. */
export function windAt(latDeg: number): [number, number] {
  const a = Math.abs(latDeg);
  const hemi = latDeg >= 0 ? 1 : -1; // 1 = northern
  let wx: number, wy: number;
  if (a < 30) {
    // Trade winds: easterlies blowing toward the equator.
    const t = smooth01(a / 30);
    wx = -(0.6 + 0.4 * t);
    wy = hemi * 0.35 * t; // toward equator (south in N hemisphere = +y)
  } else if (a < 60) {
    // Westerlies: strong eastward, slightly poleward.
    const t = smooth01((a - 30) / 30);
    wx = 0.5 + 0.5 * Math.sin(t * Math.PI);
    wy = -hemi * 0.25 * (1 - t);
  } else {
    // Polar easterlies.
    const t = smooth01((a - 60) / 30);
    wx = -(0.3 + 0.4 * t);
    wy = hemi * 0.15;
  }
  return [wx, wy];
}

function smooth01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function computeClimate(
  params: WorldParams,
  elevation: Float32Array,
  lake: Uint8Array | null,
  onProgress?: (f: number) => void,
): ClimateResult {
  const W = params.width, H = W >> 1;

  // ---- Half-resolution working grid ----
  const w = W >> 1, h = H >> 1;
  const n = w * h;
  const elevHalf = new Float32Array(n);
  const waterHalf = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i0 = (2 * y) * W + 2 * x;
      const e = Math.max(
        Math.max(elevation[i0], elevation[i0 + 1]),
        Math.max(elevation[i0 + W], elevation[i0 + W + 1]),
      );
      const j = y * w + x;
      elevHalf[j] = e;
      const anyWater =
        elevation[i0] <= 0 || elevation[i0 + 1] <= 0 ||
        elevation[i0 + W] <= 0 || elevation[i0 + W + 1] <= 0 ||
        (lake ? (lake[i0] | lake[i0 + 1] | lake[i0 + W] | lake[i0 + W + 1]) : 0) !== 0;
      waterHalf[j] = anyWater ? 1 : 0;
    }
  }

  const varN = new CylinderNoise(params.seed, 'climate');

  // ---- Sea-level temperature by latitude (+ noise wobble) ----
  const tempHalf = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * 180;
    const a = Math.abs(lat) / 90;
    const baseT = 29 - 47 * Math.pow(a, 1.7) + params.temperature;
    const aFrac = Math.abs(lat) / 90;
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      // Broad warm/cold anomalies + finer wobble — pure latitude bands are
      // the fastest way to make every world's biomes look identical.
      // Amplified toward the poles so ice-cap edges meander instead of
      // following one ruler-straight isotherm.
      const wob =
        (5.5 * varN.fbm(x / w, y / h, 2.3, 3) +
          2.0 * varN.fbm(x / w + 0.4, y / h + 0.6, 7, 2)) * (1 + 0.8 * aFrac);
      const e = elevHalf[j];
      tempHalf[j] = baseT + wob - 6.5 * Math.max(0, e);
    }
  }

  // ---- Moisture advection ----
  // humidity: starts saturated over water, then repeatedly advected upwind.
  const hum = new Float32Array(n);
  const rain = new Float32Array(n);
  const evap = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const t = tempHalf[j];
    if (waterHalf[j]) {
      // Warm water evaporates more.
      evap[j] = Math.max(0.15, Math.min(1, 0.45 + t / 38));
      hum[j] = evap[j];
    } else if (t > 0) {
      // Evapotranspiration recycles moisture over warm land — without this,
      // continental interiors turn into wall-to-wall desert. Suppressed in
      // the subtropical high (deserts must stay deserts).
      const lat = Math.abs((0.5 - ((j / w) | 0) / h) * 180);
      const subtropic = Math.exp(-((lat - 23) ** 2) / (2 * 10 * 10));
      evap[j] = Math.min(0.26, 0.08 + t / 110) * (1 - 0.75 * subtropic);
      hum[j] = evap[j] * 0.5;
    }
  }

  // Per-cell wind wobble — without lateral turbulence the row-constant winds
  // leave zebra-striped humidity rows across continents.
  const wobX = new Float32Array(n);
  const wobY = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      const uu = x / w, vv = y / h;
      wobX[j] = 0.55 * varN.fbm(uu, vv, 4, 2);
      wobY[j] = 0.5 * varN.fbm(uu + 0.43, vv + 0.79, 4, 2);
    }
  }

  // Precompute wind per row + rain-belt factor per row.
  const wxRow = new Float32Array(h);
  const wyRow = new Float32Array(h);
  const beltRow = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * 180;
    const [wx, wy] = windAt(lat);
    wxRow[y] = wx; wyRow[y] = wy;
    const a = Math.abs(lat);
    // ITCZ (equatorial max), subtropical high (dry ~25°), storm track (~50°).
    const itcz = Math.exp(-(a * a) / (2 * 12 * 12));
    const storm = Math.exp(-((a - 50) ** 2) / (2 * 14 * 14));
    const subtropic = Math.exp(-((a - 23) ** 2) / (2 * 10 * 10));
    beltRow[y] = 0.32 + 1.0 * itcz + 0.55 * storm - 0.4 * subtropic;
  }

  const SWEEPS = 56;
  const stepLen = 2.2; // in half-res cells
  const next = new Float32Array(n);
  for (let s = 0; s < SWEEPS; s++) {
    for (let y = 0; y < h; y++) {
      const yW = y * w;
      for (let x = 0; x < w; x++) {
        const j = yW + x;
        const wx = (wxRow[y] + wobX[j]) * stepLen;
        const wy = (wyRow[y] + wobY[j]) * stepLen;
        // Sample humidity upwind (semi-Lagrangian, bilinear, x wraps).
        const sx = x - wx;
        let sy = y - wy;
        if (sy < 0) sy = 0; else if (sy > h - 1) sy = h - 1;
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const fx = sx - x0, fy = sy - y0;
        const x0w = ((x0 % w) + w) % w;
        const x1w = (x0w + 1) % w;
        const y1 = Math.min(h - 1, y0 + 1);
        const hUp =
          (hum[y0 * w + x0w] * (1 - fx) + hum[y0 * w + x1w] * fx) * (1 - fy) +
          (hum[y1 * w + x0w] * (1 - fx) + hum[y1 * w + x1w] * fx) * fy;

        // Orographic lift: how much higher is this cell than upwind terrain?
        const eHere = Math.max(0, elevHalf[j]);
        const eUp =
          (Math.max(0, elevHalf[y0 * w + x0w]) * (1 - fx) + Math.max(0, elevHalf[y0 * w + x1w]) * fx) * (1 - fy) +
          (Math.max(0, elevHalf[y1 * w + x0w]) * (1 - fx) + Math.max(0, elevHalf[y1 * w + x1w]) * fx) * fy;
        const lift = Math.max(0, eHere - eUp);

        // Rainout: baseline by latitude belt + strong orographic term +
        // altitude squeeze (cold air holds less).
        let rate = 0.045 * beltRow[y] + lift * 1.7 + eHere * 0.028;
        if (rate > 0.85) rate = 0.85;
        const rained = hUp * rate;
        let m = hUp - rained;
        // Local evaporation feeds moisture back over water & wet land.
        m += evap[j] * 0.5;
        if (waterHalf[j]) m = Math.max(m, evap[j]);
        if (m > 1.15) m = 1.15;
        next[j] = m;
        rain[j] += rained;
      }
    }
    hum.set(next);
    if (onProgress && (s & 7) === 0) onProgress(s / SWEEPS);
  }

  // Continentality: after advection, low residual humidity ≈ far from any
  // ocean. Deep interiors run colder at high latitudes and slightly hotter
  // in the tropics — breaks the "temperature is only latitude" look.
  for (let y = 0; y < h; y++) {
    const a = Math.abs((0.5 - (y + 0.5) / h) * 180);
    const yW = y * w;
    for (let x = 0; x < w; x++) {
      const j = yW + x;
      if (waterHalf[j]) continue;
      const cont = Math.min(1, Math.max(0, 1 - hum[j] * 1.15));
      tempHalf[j] += cont * (a < 20 ? 1.5 : -((a - 20) / 70) * 5);
    }
  }

  // Gentle 3×3 blur (two passes) — removes residual advection streaks.
  {
    const tmp = new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - 1) * w, y1 = y * w, y2 = Math.min(h - 1, y + 1) * w;
        for (let x = 0; x < w; x++) {
          const xl = x > 0 ? x - 1 : w - 1, xr = x + 1 < w ? x + 1 : 0;
          tmp[y1 + x] =
            (rain[y0 + xl] + rain[y0 + x] + rain[y0 + xr] +
             rain[y1 + xl] + rain[y1 + x] * 2 + rain[y1 + xr] +
             rain[y2 + xl] + rain[y2 + x] + rain[y2 + xr]) / 10;
        }
      }
      rain.set(tmp);
    }
  }

  // Normalize rain to mm/year. Use a high percentile as the reference —
  // normalizing by the absolute max (usually one oceanic ITCZ spike) would
  // starve every continent.
  {
    const sample: number[] = [];
    for (let j = 0; j < n; j += 3) sample.push(rain[j]);
    sample.sort((a, b) => a - b);
    const p96 = sample[Math.floor(sample.length * 0.96)] || 1;
    const inv = 1 / p96;
    for (let j = 0; j < n; j++) {
      const norm = Math.pow(Math.min(1.35, rain[j] * inv), 0.85);
      // Regional wet/dry anomalies so rainfall isn't purely zonal either.
      const mult = Math.min(1.45, Math.max(0.6,
        1 + 0.38 * varN.fbm((j % w) / w + 0.77, ((j / w) | 0) / h + 0.31, 2.3, 3)));
      rain[j] = Math.min(3600, 2900 * norm * mult * params.moisture);
    }
  }

  // ---- Upsample to full resolution (bilinear, x wraps) ----
  const temperature = new Float32Array(W * H);
  const precipitation = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1.001, Math.max(0, (y + 0.5) / 2 - 0.5));
    const y0 = Math.floor(sy), fy = sy - y0;
    const y1 = Math.min(h - 1, y0 + 1);
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5) / 2 - 0.5;
      const x0 = Math.floor(sx), fx = sx - x0;
      const x0w = ((x0 % w) + w) % w;
      const x1w = (x0w + 1) % w;
      const i = y * W + x;
      const t =
        (tempHalf[y0 * w + x0w] * (1 - fx) + tempHalf[y0 * w + x1w] * fx) * (1 - fy) +
        (tempHalf[y1 * w + x0w] * (1 - fx) + tempHalf[y1 * w + x1w] * fx) * fy;
      const p =
        (rain[y0 * w + x0w] * (1 - fx) + rain[y0 * w + x1w] * fx) * (1 - fy) +
        (rain[y1 * w + x0w] * (1 - fx) + rain[y1 * w + x1w] * fx) * fy;
      // Re-apply lapse against the *full-res* elevation for crisp peaks.
      const eFull = Math.max(0, elevation[i]);
      const eHalf = Math.max(0, elevHalf[Math.min(h - 1, y >> 1) * w + Math.min(w - 1, x >> 1)]);
      temperature[i] = t - 6.5 * (eFull - eHalf);
      precipitation[i] = p;
    }
  }

  return { temperature, precipitation };
}
