// ============================================
// World Generator — a single landmass of a chosen size
// ============================================
// The planet is still a planet (climate runs by latitude, rivers by the ground),
// but its land is one island, country or continent of about the size asked for,
// with the sea all round it. The relief comes from the plates: the land is laid
// where the tectonic field has the most ground standing up, so a small island
// gets real mountains instead of a smooth bump.

import { SphereNoise } from './noise';
import { createRng } from './rng';
import { LANDMASS_KM, type WorldData, type WorldParams } from './types';

export { LANDMASS_KM };

/** Equatorial circumference of every generated planet, in km. */
const EARTH_KM = 40075;
/** km per degree of latitude. */
const KM_PER_DEG = EARTH_KM / 360;
/** The land keeps clear of the poles and of the date line by these margins. */
const MAX_LAT = 76;
const U_MARGIN = 0.03;

export function clampLandmassKm(km: unknown): number {
  const n = typeof km === 'number' && Number.isFinite(km) ? km : LANDMASS_KM.default;
  return Math.round(Math.min(LANDMASS_KM.max, Math.max(LANDMASS_KM.min, n)));
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Reshape tectonic terrain into one landmass with the sea round it.
 *
 * `elevation` is the assembled tectonic terrain (km, sea level 0) and `uplift`
 * the plates' uplift; both are rewritten in place. Deterministic for the seed.
 * The size is the long way across; the coast wanders round it, so the land
 * measures roughly that, give or take a tenth.
 */
export function shapeLandmass(elevation: Float32Array, uplift: Float32Array, W: number, H: number, params: WorldParams): void {
  const spanKm = clampLandmassKm(params.landmassKm);
  const kmCell = EARTH_KM / W;
  const rng = createRng(params.seed, 'landmass');
  // A large land lies east-west, along the latitudes, where the planet has room for it.
  const turn = rng();
  const theta = spanKm > 3000 ? (turn - 0.5) * 0.5 : turn * Math.PI;
  const aspect = Math.sqrt(1 + rng() * 0.7);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const wiggle = 0.22 + 0.36 * params.coastalComplexity;
  // The circle is a little smaller than half the size: the shape is drawn out along
  // one axis and its coast wanders past the circle.
  let R = spanKm / 2 / (aspect * 1.05);

  // How far the land reaches north-south (km) and east-west (km) from its centre.
  const reach = (r: number) => {
    const A = r * aspect * (1 + wiggle * 0.8), B = (r / aspect) * (1 + wiggle * 0.8);
    return {
      ns: Math.hypot(A * sinT, B * cosT),
      ew: Math.hypot(A * cosT, B * sinT),
    };
  };
  const fits = (latDeg: number, u: number, r: number) => {
    const { ns, ew } = reach(r);
    const latReach = ns / KM_PER_DEG;
    if (latDeg + latReach > MAX_LAT || latDeg - latReach < -MAX_LAT) return false;
    // East-west room at the land's most poleward row.
    const far = Math.min(85, Math.abs(latDeg) + latReach) * Math.PI / 180;
    const du = ew / (EARTH_KM * Math.max(0.05, Math.cos(far)));
    return u - du >= U_MARGIN && u + du <= 1 - U_MARGIN;
  };

  // Where to lay it: of a dozen spots in the temperate band that leave the land clear
  // of the poles and the date line, the one where the plates raise the most ground
  // inside its outline. Always the same draws, whatever fits.
  const rows = (latDeg: number) => (0.5 - latDeg / 180) * H;
  const spots: { lat: number; u: number }[] = [];
  for (let k = 0; k < 12; k++) spots.push({ lat: 24 + rng() * 26, u: 0.2 + rng() * 0.6 });
  // A land too big for the band shrinks until it fits at 35°N in the middle of the map.
  while (!spots.some((s) => fits(s.lat, s.u, R)) && !fits(35, 0.5, R) && R > 50) R *= 0.95;
  const candidates = spots.filter((s) => fits(s.lat, s.u, R));
  if (!candidates.length) candidates.push({ lat: 35, u: 0.5 });
  let cx = W / 2, cy = rows(35), best = -Infinity;
  for (const { lat, u } of candidates) {
    const x = u * W, y = rows(lat);
    const kx = kmCell * Math.cos(lat * Math.PI / 180);
    // The same 9 × 9 points of the land's own outline in km, whatever the resolution.
    let score = 0;
    for (let gy = -4; gy <= 4; gy++) for (let gx = -4; gx <= 4; gx++) {
      if (gx * gx + gy * gy > 16) continue;
      const xr = (gx / 4) * R * aspect, yr = (gy / 4) * (R / aspect);
      const dxKm = xr * cosT - yr * sinT, dyKm = xr * sinT + yr * cosT;
      const yy = Math.min(H - 1, Math.max(0, Math.round(y + dyKm / kmCell)));
      const xx = ((Math.round(x + dxKm / kx) % W) + W) % W;
      score += Math.max(0, elevation[yy * W + xx]);
    }
    if (score > best) { best = score; cx = x; cy = y; }
  }

  const coast = new SphereNoise(params.seed, 'landmass-coast');
  const hills = new SphereNoise(params.seed, 'landmass-hills');
  // Coast features about half the land's radius across, and finer ones on top.
  const freq = EARTH_KM / (R * 0.9);
  const deepest = -0.04 - 3.5;
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    const kx = kmCell * Math.max(0.05, Math.cos(lat));
    const dyKm = (y - cy) * kmCell;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let dx = x - cx;
      dx -= Math.round(dx / W) * W;
      const dxKm = dx * kx;
      // Far out to sea, where the floor has long reached its depth: nothing to compute.
      if (Math.abs(dyKm) > R * aspect * 3 || Math.abs(dxKm) > R * aspect * 3) {
        elevation[i] = deepest;
        uplift[i] = 0;
        continue;
      }
      const xr = dxKm * cosT + dyKm * sinT, yr = -dxKm * sinT + dyKm * cosT;
      const d = Math.hypot(xr / aspect, yr * aspect) / R;
      const u = (x + 0.5) / W, v = (y + 0.5) / H;
      const c = 1 - d + wiggle * coast.fbm(u, v, freq, 5);
      if (c > 0) {
        const s = smooth(0, 0.22, c);
        const relief = 0.05 + 0.22 * Math.max(0, hills.fbm(u, v, freq * 2.2, 4) + 0.35);
        elevation[i] = 0.008 + s * (relief + 0.95 * Math.max(0, elevation[i]));
        uplift[i] *= s;
      } else {
        elevation[i] = -0.04 - 3.5 * smooth(0, 0.6, -c);
        uplift[i] = 0;
      }
    }
  }
}

/** A window of the world: its centre and its size on each axis, in uv. */
export interface LandWindow { u: number; v: number; su: number; sv: number }

/**
 * The window of the world the land fills, with a margin of sea: never outside
 * the world. East-west it is the shortest arc holding every land column (a land
 * that crosses the date line gets the whole width). Null when there is no land.
 */
export function landmassWindow(world: Pick<WorldData, 'width' | 'height' | 'elevation'>, margin = 0.18): LandWindow | null {
  const W = world.width, H = world.height;
  const column = new Uint8Array(W);
  let y0 = Infinity, y1 = -Infinity;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (world.elevation[y * W + x] <= 0) continue;
    column[x] = 1;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(y0)) return null;
  // The widest run of empty columns round the circle; the land is the rest.
  let gapStart = 0, gapLen = 0;
  for (let x = 0; x < W; x++) {
    if (column[x]) continue;
    let n = 0;
    while (n < W && !column[(x + n) % W]) n++;
    if (n > gapLen) { gapLen = n; gapStart = x; }
    if (n >= W) break;
    x += n - 1;
  }
  const landCols = W - gapLen;
  const pad = (n: number, total: number) => Math.min(1, ((n * (1 + 2 * margin)) + 2) / total);
  const su = pad(landCols, W), sv = pad(y1 - y0 + 1, H);
  const first = (gapStart + gapLen) % W;
  const v = clampCentre((y0 + y1 + 1) / 2 / H, sv);
  // Across the date line, or as wide as the world: the whole width.
  if (su >= 1 || first + landCols > W) return { u: 0.5, v, su: 1, sv };
  return { u: clampCentre((first + landCols / 2) / W, su), v, su, sv };
}

function clampCentre(c: number, size: number): number {
  return size >= 1 ? 0.5 : Math.min(1 - size / 2, Math.max(size / 2, c));
}
