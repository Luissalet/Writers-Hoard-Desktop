// ============================================================================
// Real atlas — geometry on the real planet
// ============================================================================
//
// Pure functions, no DOM: the map component, the bridge tools and the tests
// all share them. Coordinates are WGS84 decimal degrees, as the rows store
// them; screen work happens in Web Mercator "world pixels", the coordinate
// system OSM tiles are cut in, so the optional tile layer and the vector
// basemap agree to the pixel.

export interface LonLat {
  lon: number;
  lat: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Side of one tile, and of the whole world at zoom 0, in pixels. */
export const TILE_SIZE = 256;

/**
 * Web Mercator's poles are at infinity; the projection is cut where a square
 * world ends (the latitude whose Mercator y equals the half-width), which is
 * also where every slippy map stops.
 */
export const MAX_LATITUDE = 85.05112878;

const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;

export function clampLatitude(lat: number): number {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
}

/** Longitude folded into [-180, 180]. */
export function wrapLongitude(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

/**
 * The copy of `lon` (lon ± k·360) nearest to `reference`. Web Mercator is
 * periodic in longitude, so a view centred near the antimeridian must draw
 * Apia (171°W) to the RIGHT of Suva (178°E), not 350° to its left: every
 * screen projection goes through here with the view's centre as reference.
 */
export function nearestLongitude(lon: number, reference: number): number {
  return lon + 360 * Math.round((reference - lon) / 360);
}

/** Pixels across the whole world at this (possibly fractional) zoom. */
export function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** Longitude/latitude → world pixels at `zoom`, origin at the top-left (180°W, 85°N). */
export function project(lon: number, lat: number, zoom: number): Point {
  const size = worldSize(zoom);
  const phi = clampLatitude(lat) * DEG;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
}

/** World pixels at `zoom` → longitude/latitude. The inverse of `project` within the clamp. */
export function unproject(x: number, y: number, zoom: number): LonLat {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * y) / size;
  return {
    lon: (x / size) * 360 - 180,
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
  };
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LonLat, b: LonLat): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from `a` to `b`, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const phi1 = a.lat * DEG;
  const phi2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Travel time — "how long does my character take"
// ---------------------------------------------------------------------------

export type TravelMode = 'walk' | 'horse' | 'carriage' | 'rail19' | 'car' | 'plane';

export const TRAVEL_MODES: readonly TravelMode[] = ['walk', 'horse', 'carriage', 'rail19', 'car', 'plane'];

export interface TravelEstimate {
  mode: TravelMode;
  /** Hours actually spent moving (plus fixed overhead for the plane). */
  hours: number;
  /** Days on the road for the modes that travel in daily stages; absent for the others. */
  days?: number;
}

/**
 * Round figures a novelist can defend, not a routing engine. Distances are
 * great-circle: real roads add a fifth or more, which the writer knows better
 * than we do.
 *
 *   walk      4.5 km/h, 8 h a day  →  36 km a day: a fit adult on decent roads.
 *   horse     40 km a day in stages (5 km/h over 8 h): a sustained pace a horse
 *             survives for weeks — a courier changing mounts does far more.
 *   carriage  60 km a day (7.5 km/h over 8 h): post roads, changing horses.
 *   rail19    40 km/h: a mid-19th-century express, stops included.
 *   car       90 km/h: a modern main road.
 *   plane     800 km/h cruise, plus two hours for the airports at either end.
 *
 * The staged modes report `days = ceil(km / kmPerDay)`; the continuous ones
 * run through the night and report hours only.
 */
const TRAVEL_SPEEDS: Record<TravelMode, { kmh: number; hoursPerDay?: number; overheadHours?: number }> = {
  walk: { kmh: 4.5, hoursPerDay: 8 },
  horse: { kmh: 5, hoursPerDay: 8 },
  carriage: { kmh: 7.5, hoursPerDay: 8 },
  rail19: { kmh: 40 },
  car: { kmh: 90 },
  plane: { kmh: 800, overheadHours: 2 },
};

export function travelEstimates(km: number): TravelEstimate[] {
  const distance = Math.max(0, km);
  return TRAVEL_MODES.map((mode) => {
    const speed = TRAVEL_SPEEDS[mode];
    const moving = distance / speed.kmh;
    // No overhead for a journey of zero length: you do not go to the airport.
    const hours = distance > 0 ? moving + (speed.overheadHours ?? 0) : 0;
    if (speed.hoursPerDay === undefined) return { mode, hours };
    return { mode, hours, days: Math.ceil(distance / (speed.kmh * speed.hoursPerDay)) };
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function numberFormat(locale: string, maximumFractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { maximumFractionDigits });
}

/** "850 m", "5.3 km", "503 km" — the unit is the same in every language the app has. */
export function formatDistance(km: number, locale: string): string {
  if (km < 1) return `${numberFormat(locale, 0).format(Math.round(km * 1000))} m`;
  if (km < 10) return `${numberFormat(locale, 1).format(km)} km`;
  return `${numberFormat(locale, 0).format(km)} km`;
}

/** "35 min", "5 h 20 min", "2 d 4 h": units shared by English and Spanish. */
export function formatDuration(hours: number, locale: string): string {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return minutes ? `${totalHours} h ${minutes} min` : `${totalHours} h`;
  // Past a day the minutes are noise: round to the hour instead of dropping them.
  const roundedHours = Math.round(totalMinutes / 60);
  const days = Math.floor(roundedHours / 24);
  const rest = roundedHours % 24;
  const d = numberFormat(locale, 0).format(days);
  return rest ? `${d} d ${rest} h` : `${d} d`;
}

/**
 * "N", "NE", …: the sixteen-point compass, spelled with the reader's letters.
 *
 * `cardinals` is the four letters in N, E, S, W order — "NESW" in English,
 * "NESO" in Spanish, where west is *oeste* — the same convention as
 * worldgen's `worldgen.measure.cardinals`; the locale supplies them and this
 * only arranges them. The bridge keeps the English default, since its
 * readers are models. A bearing that is not a number (two coincident points)
 * reads as north rather than as "undefined".
 */
export function compassPoint(bearing: number, cardinals = 'NESW'): string {
  const [n, e, s, w] = [cardinals[0] ?? 'N', cardinals[1] ?? 'E', cardinals[2] ?? 'S', cardinals[3] ?? 'W'];
  const points = [
    n, n + n + e, n + e, e + n + e, e, e + s + e, s + e, s + s + e,
    s, s + s + w, s + w, w + s + w, w, w + n + w, n + w, n + n + w,
  ];
  const normalised = Number.isFinite(bearing) ? ((bearing % 360) + 360) % 360 : 0;
  return points[Math.round(normalised / 22.5) % 16];
}

// ---------------------------------------------------------------------------
// Tiles and neighbourhoods
// ---------------------------------------------------------------------------

/** A rectangle in world pixels at some zoom. */
export interface PixelBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TileRange {
  z: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * The tiles of integer zoom `z` that cover `bounds` (world pixels at that
 * same zoom). Rows are clamped to the world — nothing is requested past the
 * poles, and a viewport entirely above or below it covers no tile (yMax <
 * yMin). Columns are NOT clamped: the world repeats east and west, so a
 * column past the antimeridian is a real tile of the other side, and
 * `wrapTileX` says which one.
 */
export function tileRange(bounds: PixelBounds, z: number): TileRange {
  const last = 2 ** z - 1;
  const xMin = Math.floor(bounds.x0 / TILE_SIZE);
  const xMax = Math.ceil(bounds.x1 / TILE_SIZE) - 1;
  const yMin = Math.floor(bounds.y0 / TILE_SIZE);
  const yMax = Math.ceil(bounds.y1 / TILE_SIZE) - 1;
  if (yMax < 0 || yMin > last || xMax < xMin) {
    return { z, xMin: 0, xMax: -1, yMin: 0, yMax: -1 };
  }
  return { z, xMin, xMax, yMin: Math.max(0, yMin), yMax: Math.min(last, yMax) };
}

/** The column a tile index past either edge of the world actually names. */
export function wrapTileX(tx: number, z: number): number {
  const n = 2 ** z;
  return ((tx % n) + n) % n;
}

export interface Located {
  lat?: number;
  lon?: number;
}

export function hasCoordinates<T extends Located>(place: T): place is T & { lat: number; lon: number } {
  return typeof place.lat === 'number' && typeof place.lon === 'number'
    && Number.isFinite(place.lat) && Number.isFinite(place.lon);
}

/** The located places within `radiusKm` of `center`, nearest first, with their distance. */
export function placesWithin<T extends Located>(
  places: readonly T[],
  center: LonLat,
  radiusKm: number,
): { place: T & { lat: number; lon: number }; km: number }[] {
  const hits: { place: T & { lat: number; lon: number }; km: number }[] = [];
  for (const place of places) {
    if (!hasCoordinates(place)) continue;
    const km = haversineKm(center, place);
    if (km <= radiusKm) hits.push({ place, km });
  }
  return hits.sort((a, b) => a.km - b.km);
}
