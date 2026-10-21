import type { HumanGeography } from '../core/settlements';

/** A cell a realm actually holds, and how much ground it holds in all. */
interface RealmAnchor {
  x: number;
  y: number;
  /** Cells claimed, which is what decides whether the name fits on screen. */
  cells: number;
}

/**
 * Where each realm's name goes, worked out ONCE per geography.
 *
 * Finding it costs two passes over the whole grid — two million lookups on a
 * 2048-wide world — which is affordable once and ruinous on every frame of a
 * pan. Keyed on `realmOf`, exactly like the border extraction in
 * `cartography/realmOverlay`: that array is what changes when the political map
 * changes, and a geography rebuilt after a stroke brings a new one.
 */
const REALM_ANCHORS = new WeakMap<Int32Array, Array<RealmAnchor | null>>();

export function realmAnchors(W: number, H: number, geo: HumanGeography): Array<RealmAnchor | null> {
  const cached = REALM_ANCHORS.get(geo.realmOf);
  if (cached) return cached;
  const of = geo.realmOf;
  const n = geo.realms.length;
  // Longitude is averaged as an ANGLE. A realm that straddles the antimeridian
  // has columns near 0 and near W, and the plain mean of those puts its capital
  // on the far side of the planet.
  const cosCol = new Float64Array(W), sinCol = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    const a = (x / W) * Math.PI * 2;
    cosCol[x] = Math.cos(a); sinCol[x] = Math.sin(a);
  }
  const cos = new Float64Array(n), sin = new Float64Array(n);
  const sumY = new Float64Array(n), count = new Float64Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = of[y * W + x];
      if (r < 0 || r >= n) continue;
      cos[r] += cosCol[x]; sin[r] += sinCol[x];
      sumY[r] += y; count[r]++;
    }
  }
  const cx = new Float64Array(n), cy = new Float64Array(n);
  for (let r = 0; r < n; r++) {
    cx[r] = ((Math.atan2(sin[r], cos[r]) / (Math.PI * 2)) * W % W + W) % W;
    cy[r] = count[r] ? sumY[r] / count[r] : 0;
  }
  // Second pass: the nearest cell the realm actually HOLDS. A centroid falls in
  // open sea whenever the country curls round a bay and inside the neighbour
  // whenever it is two halves either side of one — and a name lettered over
  // someone else's ground is worse than no name at all.
  const best = new Float64Array(n).fill(Infinity);
  const out: Array<RealmAnchor | null> = new Array(n).fill(null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = of[y * W + x];
      if (r < 0 || r >= n) continue;
      let dx = x - cx[r];
      while (dx > W / 2) dx -= W;
      while (dx < -W / 2) dx += W;
      const dy = y - cy[r];
      const d2 = dx * dx + dy * dy;
      if (d2 >= best[r]) continue;
      best[r] = d2;
      out[r] = { x, y, cells: 0 };
    }
  }
  for (let r = 0; r < n; r++) {
    const a = out[r];
    if (a) a.cells = count[r];
  }
  REALM_ANCHORS.set(geo.realmOf, out);
  return out;
}
