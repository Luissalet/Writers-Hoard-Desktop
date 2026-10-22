// Classic (image) maps: scale, measuring, a pasted key and real places at the
// same scale. Positions are percent of the picture (x from the left, y from
// the top), as for pins and shapes; a map's scale is how many kilometres the
// picture spans from left to right. The picture's own height follows from its
// pixel proportions, so a square drawn on it measures square.
import type { MapPin, MapPoint } from '@/types';

export const MAP_WIDTH_KM_RANGE = { min: 0.01, max: 40000 } as const;

/** Picture height over width, from its pixel size. */
export const pictureAspect = (width: number, height: number): number => (width > 0 && height > 0 ? height / width : 1);

export function validWidthKm(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MAP_WIDTH_KM_RANGE.min && value <= MAP_WIDTH_KM_RANGE.max;
}

/** Kilometres between two points of the picture. */
export function distanceKm(a: MapPoint, b: MapPoint, widthKm: number, aspect: number): number {
  const dx = (b.x - a.x) / 100 * widthKm, dy = (b.y - a.y) / 100 * widthKm * aspect;
  return Math.hypot(dx, dy);
}

/** Length of a line through the points, in kilometres; `closed` adds the way back (a region's outline). */
export function lineLengthKm(points: MapPoint[], widthKm: number, aspect: number, closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceKm(points[i - 1], points[i], widthKm, aspect);
  if (closed && points.length > 2) total += distanceKm(points[points.length - 1], points[0], widthKm, aspect);
  return total;
}

/** Area inside a region's outline, in square kilometres (shoelace). */
export function areaKm2(points: MapPoint[], widthKm: number, aspect: number): number {
  if (points.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twice += (a.x * b.y - b.x * a.y);
  }
  return Math.abs(twice) / 2 / 10000 * widthKm * widthKm * aspect;
}

/** The picture's width in km that makes the line from `a` to `b` measure `km`. */
export function widthFromKnownDistance(a: MapPoint, b: MapPoint, km: number, aspect: number): number {
  const units = Math.hypot(b.x - a.x, (b.y - a.y) * aspect);
  if (!(units > 0) || !(km > 0)) throw new RangeError('known_distance_invalid');
  return km * 100 / units;
}

/** A scale bar of a round length (1, 2 or 5 × 10ⁿ km) about a fifth of the picture wide. */
export function scaleBar(widthKm: number, target = 0.2): { km: number; fraction: number } {
  const want = widthKm * target, power = 10 ** Math.floor(Math.log10(want));
  const km = [1, 2, 5, 10].map(step => step * power).reduce((best, next) => Math.abs(next - want) < Math.abs(best - want) ? next : best);
  return { km, fraction: km / widthKm };
}

/** "850 m", "12 km", "1,250 km" in the reader's language. */
export function formatKm(km: number, locale: string): string {
  if (km < 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(km * 1000)} m`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
}

export function formatKm2(km2: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: km2 < 10 ? 1 : 0 }).format(km2)} km²`;
}

// ---------------------------------------------------------------------------
// A pasted key: "A. The Old Mill", "B) Crossroads Inn", "3 - Watchtower" …
// ---------------------------------------------------------------------------

export interface MapKeyLine { key: string; name: string }

const KEY_LINE = /^\s*\(?([A-Za-z]{1,2}|\d{1,3})\s*[.):\-–—]\s*(.+?)\s*$/;

/** Lines of a map key, split on new lines, " / " or ";". The key is a letter or two, or a number, followed by ".", ")", ":" or a dash. */
export function parseMapKey(text: string): MapKeyLine[] {
  const lines: MapKeyLine[] = [], seen = new Set<string>();
  for (const part of text.split(/\r?\n|\s\/\s|;/)) {
    const match = KEY_LINE.exec(part);
    if (!match) continue;
    const key = match[1].toUpperCase(), name = match[2].replace(/[.\s]+$/, '').trim();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    lines.push({ key, name });
  }
  return lines;
}

/** A pin still named by its letter or number alone ("A", "b.", "(3)"), the way a key refers to it. */
export function pinKey(name: string): string | null {
  const match = /^\s*\(?([A-Za-z]{1,2}|\d{1,3})\)?[.:]?\s*$/.exec(name);
  return match ? match[1].toUpperCase() : null;
}

export interface KeyMatch { pinId: string; key: string; from: string; to: string }

/** Which pins the key names, and which key lines found no pin. */
export function matchMapKey(pins: Pick<MapPin, 'id' | 'name'>[], lines: MapKeyLine[]): { matches: KeyMatch[]; unmatched: MapKeyLine[] } {
  const byKey = new Map<string, Pick<MapPin, 'id' | 'name'>[]>();
  for (const pin of pins) { const key = pinKey(pin.name); if (key) byKey.set(key, [...(byKey.get(key) ?? []), pin]); }
  const matches: KeyMatch[] = [], unmatched: MapKeyLine[] = [];
  for (const line of lines) {
    const found = byKey.get(line.key);
    if (!found?.length) { unmatched.push(line); continue; }
    for (const pin of found) matches.push({ pinId: pin.id, key: line.key, from: pin.name, to: line.name });
  }
  return { matches, unmatched };
}

// ---------------------------------------------------------------------------
// Real places at the map's scale
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180, EARTH_KM = 6371;

/**
 * An outline of [lon, lat] rings laid on the picture at true size with its
 * centre at `center`: each vertex keeps its east/north kilometres from the
 * outline's centre. Returns rings in picture percent and the outline's size.
 */
export function outlineOnPicture(rings: number[][][], center: MapPoint, widthKm: number, aspect: number): { rings: MapPoint[][]; widthKm: number; heightKm: number } {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of rings) for (const [lon, lat] of ring) { minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
  const lon0 = (minLon + maxLon) / 2, lat0 = (minLat + maxLat) / 2;
  const heightKmPicture = widthKm * aspect;
  return {
    rings: rings.map(ring => ring.map(([lon, lat]) => {
      const east = EARTH_KM * (lon - lon0) * DEG * Math.cos(lat * DEG), north = EARTH_KM * (lat - lat0) * DEG;
      return { x: center.x + east / widthKm * 100, y: center.y - north / heightKmPicture * 100 };
    })),
    widthKm: EARTH_KM * (maxLon - minLon) * DEG * Math.cos(lat0 * DEG),
    heightKm: EARTH_KM * (maxLat - minLat) * DEG,
  };
}
