// ============================================
// World Generator — Map Projections (2D)
// ============================================
// Forward: normalized map coords (u east 0..1, v south 0..1) → normalized
// output-canvas coords (X right 0..1, Y down 0..1). Inverse goes back (null
// when the point falls outside the projection's shape). Pixel reprojection
// uses a cached nearest-neighbour index map, so re-projecting any layer
// (base, rivers) is a single fast gather.

export type Projection = 'equirect' | 'mercator' | 'robinson' | 'mollweide' | 'azimuthal';

export const PROJECTION_IDS: Projection[] = ['equirect', 'mercator', 'robinson', 'mollweide', 'azimuthal'];

export interface ProjectionSpec {
  /** Output canvas size for a given source (equirect) width. */
  outputSize: (srcW: number) => { w: number; h: number };
  /** East-west wrap-around drawing makes sense (cylindrical only). */
  wraps: boolean;
  forward: (u: number, v: number) => [number, number];
  inverse: (X: number, Y: number) => [number, number] | null;
}

const PI = Math.PI;
const TAU = 2 * PI;

// ---- Mercator ---------------------------------------------------------------
const MERC_LAT_MAX = (82 * PI) / 180;
const MERC_Y_MAX = Math.log(Math.tan(PI / 4 + MERC_LAT_MAX / 2));

// ---- Robinson (classic interpolation tables, 5° steps 0..90) ---------------
const ROB_X = [
  1.0000, 0.9986, 0.9954, 0.9900, 0.9822, 0.9730, 0.9600, 0.9427, 0.9216,
  0.8962, 0.8679, 0.8350, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322,
];
const ROB_Y = [
  0.0000, 0.0620, 0.1240, 0.1860, 0.2480, 0.3100, 0.3720, 0.4340, 0.4958,
  0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0000,
];
const ROB_XMAX = 0.8487 * PI; // x at equator, λ=π
const ROB_YMAX = 1.3523;

function robTables(absLatDeg: number): { X: number; Y: number } {
  const t = Math.min(89.999, absLatDeg) / 5;
  const i = Math.floor(t);
  const f = t - i;
  return {
    X: ROB_X[i] + (ROB_X[i + 1] - ROB_X[i]) * f,
    Y: ROB_Y[i] + (ROB_Y[i + 1] - ROB_Y[i]) * f,
  };
}

/** Latitude (deg) whose Robinson Y-table value equals `Yt` (0..1). */
function robLatFromY(Yt: number): number {
  for (let i = 0; i < ROB_Y.length - 1; i++) {
    if (Yt <= ROB_Y[i + 1]) {
      const f = (Yt - ROB_Y[i]) / (ROB_Y[i + 1] - ROB_Y[i] || 1e-9);
      return 5 * (i + f);
    }
  }
  return 90;
}

// ---- Mollweide --------------------------------------------------------------
const SQRT2 = Math.SQRT2;

function mollTheta(phi: number): number {
  // Solve 2θ + sin 2θ = π sin φ (Newton).
  if (Math.abs(phi) >= PI / 2 - 1e-9) return Math.sign(phi) * (PI / 2);
  let theta = phi;
  for (let it = 0; it < 8; it++) {
    const denom = 2 + 2 * Math.cos(2 * theta);
    if (Math.abs(denom) < 1e-9) break;
    theta -= (2 * theta + Math.sin(2 * theta) - PI * Math.sin(phi)) / denom;
  }
  return theta;
}

// ---- Specs -------------------------------------------------------------------

export const PROJECTIONS: Record<Projection, ProjectionSpec> = {
  equirect: {
    outputSize: (w) => ({ w, h: w >> 1 }),
    wraps: true,
    forward: (u, v) => [u, v],
    inverse: (X, Y) => (Y < 0 || Y > 1 ? null : [((X % 1) + 1) % 1, Y]),
  },

  mercator: {
    outputSize: (w) => ({ w, h: Math.round((w * (2 * MERC_Y_MAX)) / TAU) }),
    wraps: true,
    forward: (u, v) => {
      let phi = (0.5 - v) * PI;
      if (phi > MERC_LAT_MAX) phi = MERC_LAT_MAX;
      if (phi < -MERC_LAT_MAX) phi = -MERC_LAT_MAX;
      const y = Math.log(Math.tan(PI / 4 + phi / 2));
      return [u, 0.5 - y / (2 * MERC_Y_MAX)];
    },
    inverse: (X, Y) => {
      if (Y < 0 || Y > 1) return null;
      const y = (0.5 - Y) * 2 * MERC_Y_MAX;
      const phi = 2 * Math.atan(Math.exp(y)) - PI / 2;
      return [((X % 1) + 1) % 1, 0.5 - phi / PI];
    },
  },

  robinson: {
    outputSize: (w) => ({ w, h: Math.round((w * ROB_YMAX) / ROB_XMAX) }),
    wraps: false,
    forward: (u, v) => {
      const lam = (u - 0.5) * TAU;
      const phiDeg = (0.5 - v) * 180;
      const { X: Xt, Y: Yt } = robTables(Math.abs(phiDeg));
      const x = 0.8487 * Xt * lam;
      const y = ROB_YMAX * Math.sign(phiDeg) * Yt;
      return [0.5 + x / (2 * ROB_XMAX), 0.5 - y / (2 * ROB_YMAX)];
    },
    inverse: (X, Y) => {
      const yn = (0.5 - Y) * 2 * ROB_YMAX;
      if (Math.abs(yn) > ROB_YMAX) return null;
      const latDeg = robLatFromY(Math.abs(yn) / ROB_YMAX);
      const { X: Xt } = robTables(latDeg);
      const xn = (X - 0.5) * 2 * ROB_XMAX;
      const lam = xn / (0.8487 * Xt);
      if (Math.abs(lam) > PI + 1e-6) return null;
      const phi = Math.sign(yn) * ((latDeg * PI) / 180);
      return [((lam / TAU + 0.5) % 1 + 1) % 1, 0.5 - phi / PI];
    },
  },

  mollweide: {
    outputSize: (w) => ({ w, h: w >> 1 }),
    wraps: false,
    forward: (u, v) => {
      const lam = (u - 0.5) * TAU;
      const phi = (0.5 - v) * PI;
      const theta = mollTheta(phi);
      const x = ((2 * SQRT2) / PI) * lam * Math.cos(theta); // ∈ ±2√2
      const y = SQRT2 * Math.sin(theta);                    // ∈ ±√2
      return [0.5 + x / (4 * SQRT2), 0.5 - y / (2 * SQRT2)];
    },
    inverse: (X, Y) => {
      const y = (0.5 - Y) * 2 * SQRT2;
      const s = y / SQRT2;
      if (s < -1 || s > 1) return null;
      const theta = Math.asin(s);
      const t = (2 * theta + Math.sin(2 * theta)) / PI;
      if (t < -1 || t > 1) return null;
      const phi = Math.asin(t);
      const cosT = Math.cos(theta);
      let lam = 0;
      if (Math.abs(cosT) > 1e-9) {
        const x = (X - 0.5) * 4 * SQRT2;
        lam = (PI * x) / (2 * SQRT2 * cosT);
      }
      if (Math.abs(lam) > PI + 1e-6) return null;
      return [((lam / TAU + 0.5) % 1 + 1) % 1, 0.5 - phi / PI];
    },
  },

  // North pole at the centre, the south rim around the edge — the map the
  // inhabitants of a disc world would actually draw.
  azimuthal: {
    outputSize: (w) => ({ w, h: w }),
    wraps: false,
    forward: (u, v) => {
      const lam = u * TAU;
      const rho = v * 0.5; // radius in normalized output units
      return [0.5 + rho * Math.sin(lam), 0.5 - rho * Math.cos(lam)];
    },
    inverse: (X, Y) => {
      const dx = (X - 0.5) * 2;
      const dy = (0.5 - Y) * 2;
      const rho = Math.hypot(dx, dy);
      if (rho > 1) return null;
      const lam = Math.atan2(dx, dy); // 0 = up
      return [(((lam / TAU) % 1) + 1) % 1, Math.min(1, rho)];
    },
  },
};

// ---- Pixel reprojection -------------------------------------------------------

const indexMapCache = new Map<string, Int32Array>();

/** Nearest-neighbour gather map: output pixel → source pixel index (or -1). */
export function getProjectionIndexMap(projection: Projection, srcW: number, srcH: number): { map: Int32Array; w: number; h: number } {
  const spec = PROJECTIONS[projection];
  const { w, h } = spec.outputSize(srcW);
  const key = `${projection}:${srcW}x${srcH}:${w}x${h}`;
  let map = indexMapCache.get(key);
  if (!map) {
    map = new Int32Array(w * h);
    for (let py = 0; py < h; py++) {
      const Y = (py + 0.5) / h;
      for (let px = 0; px < w; px++) {
        const X = (px + 0.5) / w;
        const uv = spec.inverse(X, Y);
        if (!uv) {
          map[py * w + px] = -1;
          continue;
        }
        const sx = Math.min(srcW - 1, Math.max(0, Math.floor(uv[0] * srcW)));
        const sy = Math.min(srcH - 1, Math.max(0, Math.floor(uv[1] * srcH)));
        map[py * w + px] = sy * srcW + sx;
      }
    }
    indexMapCache.set(key, map);
    // Bound the cache: maps are ~4–26 MB each at high resolutions.
    if (indexMapCache.size > 4) {
      const first = indexMapCache.keys().next().value;
      if (first) indexMapCache.delete(first);
    }
  }
  return { map, w, h };
}

/** Reproject an RGBA buffer through the index map (transparent outside). */
export function reprojectRgba(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  projection: Projection,
): { px: Uint8ClampedArray<ArrayBuffer>; w: number; h: number } {
  const { map, w, h } = getProjectionIndexMap(projection, srcW, srcH);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < map.length; i++) {
    const s = map[i];
    if (s < 0) continue;
    const o = i * 4, so = s * 4;
    out[o] = src[so];
    out[o + 1] = src[so + 1];
    out[o + 2] = src[so + 2];
    out[o + 3] = src[so + 3];
  }
  return { px: out, w, h };
}
