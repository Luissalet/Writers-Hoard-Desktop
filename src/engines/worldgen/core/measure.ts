// ============================================
// World Generator — The ruler
// ============================================
// "How far is it from here to there?" is the question a writer asks a map most
// often, and until now the world could only answer it between two TOWNS,
// through the journey planner. The ruler answers it between any two points the
// reader clicks: along the great circle of the planet, with the east-west seam
// folded, with a bearing, and with the time the crow-flies distance would take
// at each pace the planner knows.
//
// Pure arithmetic, no DOM: the map draws the polyline and prints the readout;
// this file only knows where the points are and what the planet is shaped like.
// That is what makes it measurable in a test — a quarter of a turn along the
// equator has to be a quarter of `EARTH_KM`, and antipodes half of it, whatever
// the map does with the answer.

import { EARTH_KM } from './camera';

/** A point in world cells, fractional, as every gesture in the 2D reports it. */
export interface CellPoint { x: number; y: number }

export interface LonLatDeg { lon: number; lat: number }

/**
 * The planet the on-screen instruments already assume.
 *
 * The scale bar, the locator and the viewport all measure the world as one
 * `EARTH_KM` around; `travel.ts` rounds the radius to 6371 km, which is one
 * part in a thousand from this. The ruler sits next to the scale bar and must
 * agree with it to the last digit, so it takes the circumference's radius.
 */
export const PLANET_RADIUS_KM = EARTH_KM / (2 * Math.PI);

const DEG = Math.PI / 180;

/**
 * Cell → longitude/latitude in degrees, with the graticule's convention: the
 * prime meridian runs down the MIDDLE of the sheet (u = 0.5) and the equator
 * across its middle (v = 0.5). Same equations as the grid `Map2D` draws, so a
 * point reported as 30° N sits on the 30° parallel of that grid.
 */
export function cellToLonLat(p: CellPoint, width: number, height: number): LonLatDeg {
  return {
    lon: (p.x / width) * 360 - 180,
    lat: 90 - (p.y / height) * 180,
  };
}

/**
 * Great-circle distance between two cells, in kilometres.
 *
 * Haversine rather than the arc-cosine form: `acos` loses every digit for
 * points a few cells apart, which is exactly the range a ruler at street zoom
 * measures. The seam needs no special case — the trigonometry of a longitude
 * difference of 359° is the trigonometry of 1°.
 */
export function cellDistanceKm(
  a: CellPoint, b: CellPoint, width: number, height: number, radiusKm = PLANET_RADIUS_KM,
): number {
  const p = cellToLonLat(a, width, height);
  const q = cellToLonLat(b, width, height);
  const dLat = (q.lat - p.lat) * DEG;
  const dLon = (q.lon - p.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(p.lat * DEG) * Math.cos(q.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north in [0, 360). */
export function cellBearingDeg(a: CellPoint, b: CellPoint, width: number, height: number): number {
  const p = cellToLonLat(a, width, height);
  const q = cellToLonLat(b, width, height);
  const phi1 = p.lat * DEG, phi2 = q.lat * DEG;
  const dLon = (q.lon - p.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/**
 * The sixteen-point compass, spelled with the reader's letters.
 *
 * `cardinals` is the four letters in N, E, S, W order — "NESW" in English,
 * "NESO" in Spanish, where west is *oeste*. The catalogue supplies them; this
 * function only arranges them.
 */
export function compassPoint(bearing: number, cardinals = 'NESW'): string {
  const [n, e, s, w] = [cardinals[0] ?? 'N', cardinals[1] ?? 'E', cardinals[2] ?? 'S', cardinals[3] ?? 'W'];
  const points = [
    n, n + n + e, n + e, e + n + e, e, e + s + e, s + e, s + s + e,
    s, s + s + w, s + w, w + s + w, w, w + n + w, n + w, n + n + w,
  ];
  return points[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * "41,3° N · 17,6° E": the readout's coordinate line.
 *
 * One decimal of a degree is ~11 km, which is the resolution a world of 2048
 * cells has (≈20 km a cell) — more digits would be reporting noise as fact.
 * `decimal` is the catalogue's separator, so the Spanish reader gets a comma.
 */
export function formatLatLon(ll: LonLatDeg, cardinals = 'NESW', decimal = '.'): string {
  const one = (v: number) => Math.abs(v).toFixed(1).replace('.', decimal);
  const ns = ll.lat >= 0 ? (cardinals[0] ?? 'N') : (cardinals[2] ?? 'S');
  const ew = ll.lon >= 0 ? (cardinals[1] ?? 'E') : (cardinals[3] ?? 'W');
  return `${one(ll.lat)}° ${ns} · ${one(ll.lon)}° ${ew}`;
}

export interface RulerLeg {
  from: CellPoint;
  to: CellPoint;
  km: number;
  /** Initial bearing of the leg, degrees from north. */
  bearing: number;
}

export interface RulerReading {
  legs: RulerLeg[];
  totalKm: number;
}

/** Every leg of the polyline and the sum, once per change — never per frame. */
export function measurePolyline(points: CellPoint[], width: number, height: number): RulerReading {
  const legs: RulerLeg[] = [];
  let totalKm = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i];
    const km = cellDistanceKm(from, to, width, height);
    totalKm += km;
    legs.push({ from, to, km, bearing: cellBearingDeg(from, to, width, height) });
  }
  return { legs, totalKm };
}

/**
 * The shortest x-offset from `a` to `b` on a sheet that wraps east-west, in
 * cells. What the map draws a leg with: a line from x = 1 to x = W − 1 goes two
 * cells WEST across the seam, not the whole world east. Returned as the
 * displacement to ADD to `a.x`, so `a.x + dx` may fall outside [0, W) — that is
 * the point, the map's copies take care of the rest.
 */
export function wrappedDx(a: CellPoint, b: CellPoint, width: number): number {
  let dx = b.x - a.x;
  while (dx > width / 2) dx -= width;
  while (dx < -width / 2) dx += width;
  return dx;
}
