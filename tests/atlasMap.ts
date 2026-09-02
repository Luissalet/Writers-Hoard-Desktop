// ============================================================================
// Critical tests — real atlas map
// ============================================================================
//
// Pure geometry (Web Mercator, distances, travel times, tiles), the map's
// view-state transitions, the offline basemap and the per-project map
// preferences. No React: the component is a thin shell over these, and what
// it adds (pointer capture, a ResizeObserver) is not what breaks silently.

import {
  bearingDeg,
  compassPoint,
  formatDistance,
  formatDuration,
  haversineKm,
  MAX_LATITUDE,
  placesWithin,
  project,
  tileRange,
  travelEstimates,
  TRAVEL_MODES,
  unproject,
  worldSize,
  wrapTileX,
} from '@/engines/real-atlas/geo';
import {
  fitBounds,
  fromScreen,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  toScreen,
  WORLD_VIEW,
  zoomAt,
  zoomBy,
} from '@/engines/real-atlas/mapState';
import { basemapPaths, largestRing, loadBasemap } from '@/engines/real-atlas/basemap';
import { DEFAULT_ATLAS_MAP_PREFS, parseAtlasMapPrefs, serializeAtlasMapPrefs } from '@/engines/real-atlas/mapPrefs';
import { matchPlaces } from '@/engines/real-atlas/search';
import { findPlaceAppearances, toAppearanceWriting, type AppearanceWriting } from '@/engines/real-atlas/appearances';
import { parseNominatimResults } from '@/engines/real-atlas/geocode';
import { MAX_ROUTE_NAME_LENGTH, MAX_ROUTES, parseAtlasRoutes } from '@/engines/real-atlas/routes';
import { t } from '@/i18n/useTranslation';
import type { AtlasPlace } from '@/engines/real-atlas/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function near(actual: number, expected: number, tolerance: number, what: string): void {
  assert(Math.abs(actual - expected) <= tolerance, `${what}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

const LISBOA = { lon: -9.1393, lat: 38.7223 };
const MADRID = { lon: -3.7038, lat: 40.4168 };

export function testAtlasGeoProjection(): void {
  // The world is a square of 256·2^zoom pixels with (180°W, 85°N) at the origin.
  const nw = project(-180, MAX_LATITUDE, 0);
  const se = project(180, -MAX_LATITUDE, 0);
  near(nw.x, 0, 1e-6, 'north-west corner x');
  near(nw.y, 0, 1e-6, 'north-west corner y');
  near(se.x, 256, 1e-6, 'south-east corner x');
  near(se.y, 256, 1e-6, 'south-east corner y');
  const origin = project(0, 0, 3);
  near(origin.x, worldSize(3) / 2, 1e-9, 'the equator/meridian crossing at zoom 3');
  near(origin.y, worldSize(3) / 2, 1e-9, 'the equator/meridian crossing at zoom 3');

  // Round trips, including a fractional zoom, survive to well under a metre.
  for (const zoom of [0, 1, 4.5, 12, 18]) {
    for (const point of [LISBOA, MADRID, { lon: 151.2, lat: -33.87 }, { lon: -179.9, lat: 80 }, { lon: 0, lat: 0 }]) {
      const p = project(point.lon, point.lat, zoom);
      const back = unproject(p.x, p.y, zoom);
      near(back.lon, point.lon, 1e-7, `lon round trip at zoom ${zoom}`);
      near(back.lat, point.lat, 1e-7, `lat round trip at zoom ${zoom}`);
    }
  }
  // Beyond the cut the projection clamps instead of running off to infinity.
  const pole = project(0, 90, 2);
  assert(Number.isFinite(pole.y) && Math.abs(pole.y) < 1e-6, 'the pole should clamp to the top edge');
  const south = project(0, -90, 2);
  near(south.y, worldSize(2), 1e-6, 'the south pole should clamp to the bottom edge');
}

export function testAtlasGeoDistance(): void {
  const km = haversineKm(LISBOA, MADRID);
  near(km, 503, 5, 'Lisboa–Madrid');
  near(haversineKm(MADRID, LISBOA), km, 1e-9, 'distance is symmetric');
  assert(haversineKm(LISBOA, LISBOA) === 0, 'a place is 0 km from itself');
  // Half the planet: antipodes are πR apart.
  near(haversineKm({ lon: 0, lat: 0 }, { lon: 180, lat: 0 }), 20015, 5, 'antipodes');

  const bearing = bearingDeg(LISBOA, MADRID);
  assert(bearing > 55 && bearing < 80, `Madrid lies east-north-east of Lisboa, got ${bearing}°`);
  assert(compassPoint(bearing) === 'ENE', `compass point for ${bearing}° should be ENE`);
  near(bearingDeg({ lon: 0, lat: 0 }, { lon: 0, lat: 10 }), 0, 1e-9, 'due north');
  near(bearingDeg({ lon: 0, lat: 0 }, { lon: 10, lat: 0 }), 90, 1e-9, 'due east');
  near(bearingDeg({ lon: 0, lat: 10 }, { lon: 0, lat: 0 }), 180, 1e-9, 'due south');
  assert(compassPoint(359) === 'N' && compassPoint(225) === 'SW', 'compass points wrap');
}

export function testAtlasGeoTravel(): void {
  const distances = [0, 1, 10, 100, 502, 1000, 5000, 20000];
  const tables = distances.map((km) => travelEstimates(km));
  for (const table of tables) {
    assert(table.length === TRAVEL_MODES.length, 'every mode is estimated');
    assert(table.every((row, i) => row.mode === TRAVEL_MODES[i]), 'modes come in the documented order');
  }
  // Longer journeys never take less time, in any mode, in hours or in days.
  for (let i = 1; i < tables.length; i += 1) {
    for (let m = 0; m < TRAVEL_MODES.length; m += 1) {
      const before = tables[i - 1][m];
      const after = tables[i][m];
      assert(after.hours >= before.hours, `${after.mode}: ${distances[i]} km took less than ${distances[i - 1]} km`);
      assert((after.days ?? 0) >= (before.days ?? 0), `${after.mode}: days went down with distance`);
    }
  }
  // At zero nobody goes anywhere — not even to the airport.
  assert(tables[0].every((row) => row.hours === 0 && (row.days === undefined || row.days === 0)), 'zero km should cost nothing');
  const at502 = Object.fromEntries(tables[4].map((row) => [row.mode, row]));
  near(at502.walk.hours, 502 / 4.5, 1e-9, 'walking hours');
  assert(at502.walk.days === Math.ceil(502 / 36), 'walking days are ceil(km / 36)');
  assert(at502.horse.days === Math.ceil(502 / 40), 'riding days are ceil(km / 40)');
  assert(at502.carriage.days === Math.ceil(502 / 60), 'carriage days are ceil(km / 60)');
  assert(at502.rail19.days === undefined && at502.car.days === undefined && at502.plane.days === undefined, 'continuous modes report no stages');
  near(at502.plane.hours, 502 / 800 + 2, 1e-9, 'the plane adds two hours of airports');
  assert(at502.car.hours < at502.rail19.hours && at502.rail19.hours < at502.carriage.hours, 'the modes order as expected');
}

export function testAtlasGeoFormat(): void {
  assert(formatDistance(0.85, 'en') === '850 m', `metres: ${formatDistance(0.85, 'en')}`);
  assert(formatDistance(5.34, 'es') === '5,3 km', `one decimal under 10 km, Spanish comma: ${formatDistance(5.34, 'es')}`);
  assert(formatDistance(502.6, 'en') === '503 km', `rounded above 10 km: ${formatDistance(502.6, 'en')}`);
  assert(formatDuration(0.5, 'en') === '30 min', `minutes: ${formatDuration(0.5, 'en')}`);
  assert(formatDuration(5.33, 'en') === '5 h 20 min', `hours and minutes: ${formatDuration(5.33, 'en')}`);
  assert(formatDuration(7, 'en') === '7 h', `whole hours: ${formatDuration(7, 'en')}`);
  assert(formatDuration(111.7, 'en') === '4 d 16 h', `days and hours: ${formatDuration(111.7, 'en')}`);
  assert(formatDuration(48, 'en') === '2 d', `whole days: ${formatDuration(48, 'en')}`);
}

export function testAtlasGeoTiles(): void {
  // The world repeats east-west but not north-south, and the range says so:
  // COLUMNS are left unclamped, because `wrapTileX` turns a column past either
  // edge into the one it really names (that is what makes a view sitting on
  // the antimeridian whole instead of half empty); ROWS are clamped, because
  // there is nothing above the pole to ask for.
  const whole = tileRange({ x0: -100, y0: -50, x1: 600, y1: 700 }, 1);
  assert(whole.yMin === 0 && whole.yMax === 1, `rows should clamp to the world, got ${JSON.stringify(whole)}`);
  assert(whole.xMin === -1 && whole.xMax === 2, `columns should be left for wrapTileX, got ${JSON.stringify(whole)}`);
  assert(
    wrapTileX(whole.xMin, 1) === 1 && wrapTileX(whole.xMax, 1) === 0,
    'the overhanging columns should wrap onto the world',
  );
  // A viewport wholly past the antimeridian is not empty: it is the world's
  // next copy, and its columns wrap back onto the first.
  const beyond = tileRange({ x0: 600, y0: 0, x1: 900, y1: 100 }, 1);
  assert(beyond.xMin === 2 && beyond.xMax === 3, `the second copy should name columns 2..3, got ${JSON.stringify(beyond)}`);
  assert(wrapTileX(beyond.xMin, 1) === 0 && wrapTileX(beyond.xMax, 1) === 1, 'the second copy should wrap onto the first');
  // Off the top or bottom of the world there is genuinely nothing to fetch.
  const aboveThePole = tileRange({ x0: 0, y0: -800, x1: 256, y1: -600 }, 1);
  assert(aboveThePole.yMax < aboveThePole.yMin, 'a viewport above the pole should cover no tile');
  // A 300px window starting 100px in at zoom 3: tiles 0 and 1 horizontally.
  const inner = tileRange({ x0: 100, y0: 300, x1: 400, y1: 500 }, 3);
  assert(inner.xMin === 0 && inner.xMax === 1 && inner.yMin === 1 && inner.yMax === 1, `expected x 0..1, y 1..1, got ${JSON.stringify(inner)}`);
  // Exactly on a tile boundary the next tile is not requested.
  const edge = tileRange({ x0: 0, y0: 0, x1: 256, y1: 256 }, 4);
  assert(edge.xMax === 0 && edge.yMax === 0, 'a viewport ending on a tile edge should not fetch the neighbour');
}

export function testAtlasMapState(): void {
  const size = { width: 800, height: 600 };

  // fitBounds: three points all inside the padded viewport, at the largest zoom that manages it.
  const points = [LISBOA, MADRID, { lon: 2.1734, lat: 41.3851 }];
  const fitted = fitBounds(points, size, 48, 12);
  for (const p of points) {
    const s = toScreen(fitted, size, p);
    assert(s.x >= 47 && s.x <= size.width - 47 && s.y >= 47 && s.y <= size.height - 47, `fitBounds left a point outside the padding: ${JSON.stringify(s)}`);
  }
  const tighter = fitBounds(points, size, 48, 12);
  assert(Math.abs(tighter.zoom - fitted.zoom) < 1e-9, 'fitBounds is deterministic');
  const spread = points.map((p) => toScreen(fitted, size, p));
  const width = Math.max(...spread.map((s) => s.x)) - Math.min(...spread.map((s) => s.x));
  const height = Math.max(...spread.map((s) => s.y)) - Math.min(...spread.map((s) => s.y));
  assert(Math.max(width / (size.width - 96), height / (size.height - 96)) > 0.99, 'fitBounds should use the padded viewport fully on one axis');
  assert(fitBounds([], size).zoom === WORLD_VIEW.zoom, 'no points → the world');
  assert(fitBounds([LISBOA], size).zoom === 12, 'one point → the cap, not infinity');

  // zoomAt keeps what is under the cursor under the cursor.
  const view = { center: { lon: -5, lat: 40 }, zoom: 5 };
  const cursor = { x: 130, y: 470 };
  const under = fromScreen(view, size, cursor);
  const zoomed = zoomAt(view, size, cursor, 1.5);
  near(zoomed.zoom, 6.5, 1e-9, 'zoomAt applies the delta');
  const after = toScreen(zoomed, size, under);
  near(after.x, cursor.x, 1e-6, 'zoomAt drifted the anchor in x');
  near(after.y, cursor.y, 1e-6, 'zoomAt drifted the anchor in y');
  assert(zoomAt(view, size, cursor, 100).zoom === MAX_ZOOM, 'zoom clamps at the top');
  assert(zoomBy(view, -100).zoom === MIN_ZOOM, 'zoom clamps at the bottom');
  assert(zoomAt(view, size, cursor, 0) === view, 'a zero delta returns the same view');

  // panBy moves the world with the pointer: dragging 100px right shows 100px more of the west.
  const panned = panBy(view, 100, -40);
  const before = toScreen(view, size, LISBOA);
  const moved = toScreen(panned, size, LISBOA);
  near(moved.x - before.x, 100, 1e-6, 'panBy x');
  near(moved.y - before.y, -40, 1e-6, 'panBy y');
  // Off the antimeridian the centre wraps rather than leaving the map.
  const wrapped = panBy({ center: { lon: 179.9, lat: 0 }, zoom: 2 }, -worldSize(2) / 4, 0);
  assert(wrapped.center.lon < 0 && wrapped.center.lon > -180, `centre should wrap past 180°, got ${wrapped.center.lon}`);
}

export async function testAtlasBasemap(): Promise<void> {
  const basemap = await loadBasemap();
  assert(basemap.countries.length >= 170, `expected the 177 countries of Natural Earth 110m, got ${basemap.countries.length}`);
  const names = new Set(basemap.countries.map((c) => c.name));
  for (const expected of ['Spain', 'Portugal', 'France', 'Antarctica', 'South Africa']) {
    assert(names.has(expected), `basemap lost ${expected}`);
  }
  assert(names.size === basemap.countries.length, 'country names must be unique: they key the SVG paths');
  let rings = 0;
  for (const country of basemap.countries) {
    assert(country.rings.length > 0, `${country.name} has no ring`);
    for (const ring of country.rings) {
      rings += 1;
      assert(ring.coords.length >= 6, `${country.name} has a ring with fewer than 3 points`);
      // Longitudes are UNWRAPPED, on purpose: a country the antimeridian cuts
      // (Russia, Fiji, New Zealand) is one continuous shape running past ±180
      // rather than a band smeared across the map, and `basemapPaths` draws
      // the ±360 copies. So the invariant is not "inside ±180" — it is that no
      // ring stepped the seam (a jump over 180° between neighbouring points)
      // and that no ring is wider than the world.
      assert(ring.minLat >= -90 && ring.maxLat <= 90, `${country.name} has a latitude off the planet`);
      assert(
        ring.minLon >= -360 && ring.maxLon <= 360 && ring.maxLon - ring.minLon <= 360,
        `${country.name} has a ring wider than the world: ${ring.minLon}..${ring.maxLon}`,
      );
      for (let i = 2; i < ring.coords.length; i += 2) {
        assert(
          Math.abs(ring.coords[i] - ring.coords[i - 2]) <= 180,
          `${country.name} steps the antimeridian: the build script should have unwrapped it`,
        );
      }
      assert(ring.minLon <= ring.maxLon && ring.minLat <= ring.maxLat, `${country.name} has an inverted bounding box`);
    }
  }
  assert(rings >= 250, `expected a few hundred rings (285 at 1:110m), got ${rings}`);
  // Lesotho is a hole in South Africa: the even-odd fill needs that inner ring kept.
  const za = basemap.countries.find((c) => c.name === 'South Africa');
  assert(za && za.rings.length >= 2, 'South Africa should carry the Lesotho hole as a second ring');
  const spain = basemap.countries.find((c) => c.name === 'Spain');
  const mainland = spain && largestRing(spain);
  assert(mainland && mainland.minLon < -9 && mainland.maxLon > 3 && mainland.minLat > 35 && mainland.maxLat < 44, 'Spain is not where Spain is');
  assert(mainland.coords.length >= 40, 'Spain’s outline should have a few dozen points at 1:110m');

  // Paths: the whole world draws almost every country; a window on Iberia draws a handful.
  const size = { width: 1024, height: 640 };
  const world = basemapPaths(basemap, WORLD_VIEW, size);
  assert(world.length >= 150, `the world view should draw most countries, drew ${world.length}`);
  for (const path of world) {
    assert(path.d.startsWith('M') && path.d.endsWith('Z'), `${path.name}: path should open with M and close with Z`);
    assert(!path.d.includes('NaN'), `${path.name}: NaN in path`);
  }
  const iberia = basemapPaths(basemap, { center: { lon: -4, lat: 40 }, zoom: 6 }, size);
  assert(iberia.length >= 2 && iberia.length <= 12, `a window on Iberia should draw a few countries, drew ${iberia.length}`);
  assert(iberia.some((p) => p.name === 'Spain') && iberia.some((p) => p.name === 'Portugal'), 'Iberia without Spain and Portugal');
  assert(!iberia.some((p) => p.name === 'Australia'), 'Australia is not visible from Iberia');
  // Simplification: points on the same pixel are dropped. The 1:110m data is
  // coarse (about 120 km between points), so even a 256px world keeps most
  // of them; what matters is that the skip works and never eats a ring.
  const dataPoints = basemap.countries.reduce((sum, c) => sum + c.rings.reduce((s, r) => s + r.coords.length / 2, 0), 0);
  const thumbnail = basemapPaths(basemap, { center: { lon: 0, lat: 20 }, zoom: 0 }, { width: 256, height: 256 });
  const thumbnailPoints = thumbnail.reduce((sum, p) => sum + (p.d.match(/[ML]/g)?.length ?? 0), 0);
  assert(thumbnailPoints < dataPoints * 0.8, `a 256px world should drop a fair share of points (${thumbnailPoints} of ${dataPoints})`);
  assert(thumbnail.length >= 150, `the thumbnail should still draw most countries, drew ${thumbnail.length}`);
  // The world view (zoom 1) puts the whole world in 512px and the viewport is
  // 1024px wide, so it genuinely shows the world TWICE — every country is
  // drawn in two copies, and counting its points twice is right, not a leak.
  // What must hold is the bound the copy mechanism gives: at most one drawing
  // per copy (there are three: -360, 0, +360), and never a ring dropped.
  const worldPoints = world.reduce((sum, p) => sum + (p.d.match(/[ML]/g)?.length ?? 0), 0);
  assert(
    worldPoints > dataPoints && worldPoints <= dataPoints * 3,
    `a viewport two worlds wide should draw about two copies (${worldPoints} of ${dataPoints})`,
  );
}

export function testAtlasMapPrefs(): void {
  assert(parseAtlasMapPrefs(undefined) === DEFAULT_ATLAS_MAP_PREFS, 'no row → defaults');
  assert(parseAtlasMapPrefs('not json').tiles === false, 'garbage → defaults, not a throw');
  assert(parseAtlasMapPrefs('{"tiles":"yes"}').tiles === false, 'a non-boolean tiles flag is off');
  const stored = serializeAtlasMapPrefs({ tiles: true, hierarchy: false, geocodeConsent: false, view: { center: { lon: -3.70381234, lat: 40.4168 }, zoom: 7.123456 } });
  const back = parseAtlasMapPrefs(stored);
  assert(back.tiles === true && back.hierarchy === false, 'flags round-trip');
  assert(back.view && Math.abs(back.view.center.lon + 3.70381) < 1e-9 && back.view.zoom === 7.123, 'the view rounds and round-trips');
  const clamped = parseAtlasMapPrefs('{"view":{"lon":400,"lat":95,"zoom":40}}');
  assert(clamped.view && clamped.view.center.lon === 40 && clamped.view.center.lat === MAX_LATITUDE && clamped.view.zoom === MAX_ZOOM, 'a stored view is wrapped and clamped');
  assert(parseAtlasMapPrefs('{"view":{"lon":1}}').view === undefined, 'a partial view is dropped');
}

function place(id: string, name: string, extra: Partial<AtlasPlace> = {}): AtlasPlace {
  return {
    id, projectId: 'p', name, kind: 'city', aliases: [], description: '', realNotes: '', sources: [],
    fictional: false, tags: [], createdAt: 0, updatedAt: 0, ...extra,
  };
}

export function testAtlasPlacesWithin(): void {
  const places = [
    place('lis', 'Lisboa', { ...LISBOA }),
    place('mad', 'Madrid', { ...MADRID }),
    place('ros', 'Rossio'),
    place('bcn', 'Barcelona', { lon: 2.1734, lat: 41.3851 }),
  ];
  const hits = placesWithin(places, MADRID, 600);
  assert(hits.map((h) => h.place.id).join(',') === 'mad,lis,bcn', `nearest first, unplaced skipped: ${hits.map((h) => h.place.id).join(',')}`);
  assert(hits[0].km === 0, 'the centre itself is at 0 km');
  near(hits[1].km, 503, 5, 'Lisboa from Madrid');
  assert(placesWithin(places, MADRID, 100).length === 1, 'only Madrid within 100 km of Madrid');

  const found = matchPlaces(places, 'lisboa', 8);
  assert(found.length === 1 && found[0].id === 'lis', 'case-insensitive name search');
  assert(matchPlaces([place('x', 'Olisipo', { aliases: ['Lisboa'] })], 'LISBÓA', 8).length === 1, 'accent- and case-insensitive alias search');
  assert(matchPlaces(places, '  ', 8).length === 0, 'a blank query matches nothing');
  assert(matchPlaces(places, 'a', 2).length === 2, 'the limit caps the results');
}

/** The stored routes blob is bounded on the way in: count, name length and id length. */
export function testAtlasRoutesParseBounds(): void {
  const blob = (routes: unknown[]) => JSON.stringify({ routes });
  const many = parseAtlasRoutes(blob(Array.from({ length: 600 }, (_, i) => ({ id: `r${i}`, name: 'n', placeIds: ['a', 'b'] }))));
  assert(many.length === MAX_ROUTES && MAX_ROUTES === 500, `600 stored routes should be cut to ${MAX_ROUTES}, got ${many.length}`);
  assert(many[0].id === 'r0' && many[many.length - 1].id === 'r499', 'the first routes are the ones kept');
  const longName = parseAtlasRoutes(blob([{ id: 'r', name: 'y'.repeat(1_000_000), placeIds: ['a', 'b'] }]));
  assert(longName.length === 1 && longName[0].name.length === MAX_ROUTE_NAME_LENGTH && MAX_ROUTE_NAME_LENGTH === 200, `a megabyte of name should be cut to ${MAX_ROUTE_NAME_LENGTH} characters, got ${longName[0]?.name.length}`);
  const longId = parseAtlasRoutes(blob([{ id: 'x'.repeat(100_000), name: 'n', placeIds: ['a', 'b'] }, { id: 'ok', name: 'n', placeIds: ['a', 'b'] }]));
  assert(longId.length === 1 && longId[0].id === 'ok', `a route with a 100 kB id should be dropped, got ${JSON.stringify(longId.map((r) => r.id.length))}`);
}

/** Nominatim's coordinates are decimal strings; what `Number()` would also accept is refused. */
export function testAtlasGeocodeParsing(): void {
  const hits = (lat: unknown, lon: unknown) => parseNominatimResults([{ lat, lon, display_name: 'X' }]);
  assert(hits('', '').length === 0, `an empty coordinate must not become Null Island: ${JSON.stringify(hits('', ''))}`);
  assert(hits(' ', ' ').length === 0, `a blank coordinate must not become Null Island: ${JSON.stringify(hits(' ', ' '))}`);
  assert(hits('0x10', '1').length === 0, `a hex coordinate must not be read as 16: ${JSON.stringify(hits('0x10', '1'))}`);
  assert(hits('1e1', '1').length === 0, 'an exponent is not what Nominatim writes');
  const good = hits(' 40.4168 ', '-3.70381234');
  assert(good.length === 1 && good[0].lat === 40.4168 && good[0].lon === -3.70381, `a plain decimal (trimmed, rounded to 5 places) is a hit: ${JSON.stringify(good)}`);
  assert(hits(40.4, -3.7).length === 1 && hits(NaN, 1).length === 0, 'numbers pass when finite');
  const long = parseNominatimResults([{ lat: 1, lon: 2, display_name: 'a'.repeat(10_000), type: 'b'.repeat(5_000), address: { country: 'c'.repeat(5_000) } }]);
  assert(long.length === 1 && long[0].name.length === 300 && long[0].kind.length === 300 && long[0].country?.length === 300, `name, kind and country are cut to 300 characters: ${JSON.stringify(long.map((h) => [h.name.length, h.kind.length, h.country?.length]))}`);
}

function waitFor(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) resolve();
      else if (Date.now() > deadline) reject(new Error(`timed out waiting for ${what}`));
      else window.setTimeout(tick, 25);
    };
    tick();
  });
}

/**
 * The component itself, mounted in the harness's real DOM: the vector base
 * draws, pins appear where the places are, nothing reaches the network with
 * the tile layer off, and the view survives a remount through the settings
 * row. Pointer capture cannot be driven by synthetic events, so dragging is
 * covered by the pure transitions above, not here.
 */
export async function testAtlasMapMounts(): Promise<void> {
  const [{ createRoot }, { createElement }, { default: AtlasMap }, { getSetting }] = await Promise.all([
    import('react-dom/client'),
    import('react'),
    import('@/engines/real-atlas/components/AtlasMap'),
    import('@/db/operations'),
  ]);
  const projectId = `atlas-map-test-${Date.now()}`;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;';
  document.body.appendChild(host);
  const places = [place('lis', 'Lisboa', { ...LISBOA }), place('mad', 'Madrid', { ...MADRID, parentId: 'lis' }), place('ros', 'Rossio')];
  const selected: (string | null)[] = [];
  const props = {
    projectId, places, divergences: [], selectedPlaceId: null, onSelect: (id: string | null) => { selected.push(id); },
    onEdit: () => {}, onCreateAt: () => {}, onMove: async () => {}, pickRequest: null, onPick: () => {}, focusRequest: null,
  };
  const root = createRoot(host);
  try {
    root.render(createElement(AtlasMap, props));
    await waitFor(() => host.querySelectorAll('button[aria-label="Lisboa"]').length === 1, 'the Lisboa pin');
    assert(host.querySelectorAll('button[aria-label="Madrid"]').length === 1, 'Madrid should have a pin');
    assert(host.querySelectorAll('button[aria-label="Rossio"]').length === 0, 'a place without coordinates has no pin');
    // Fitted on Iberia: a handful of countries drawn, not the world.
    const countries = () => host.querySelectorAll('[data-layer="basemap"] path').length;
    await waitFor(() => countries() >= 2, 'the vector basemap');
    assert(countries() <= 20, `an Iberian view should draw a few countries, drew ${countries()}`);
    assert(host.querySelectorAll('img').length === 0, 'with the tile layer off nothing may be requested');
    // The first view fits the places: both pins inside the container, Madrid east of Lisboa.
    const rect = host.getBoundingClientRect();
    const at = (name: string) => {
      const r = host.querySelector(`button[aria-label="${name}"]`)!.getBoundingClientRect();
      return { x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top };
    };
    const lis = at('Lisboa');
    const mad = at('Madrid');
    assert(lis.x > 0 && lis.x < 800 && lis.y > 0 && lis.y < 600 && mad.x > 0 && mad.x < 800, 'fitBounds should put both pins inside the map');
    assert(mad.x > lis.x && mad.y < lis.y, `Madrid should sit north-east of Lisboa on screen: Lisboa ${JSON.stringify(lis)}, Madrid ${JSON.stringify(mad)}`);
    // The "without coordinates" menu exists (its label is a translated count,
    // which the harness has no locale for) and lists Rossio when opened.
    const unplaced = host.querySelector('button[aria-expanded]') as HTMLButtonElement | null;
    assert(unplaced, 'a place without coordinates should show the unplaced menu');
    assert(!host.textContent?.includes('Rossio'), 'Rossio should not be on the map before the menu opens');
    unplaced.click();
    await waitFor(() => host.textContent?.includes('Rossio') ?? false, 'the unplaced list');
    // The view is persisted per project once the debounce elapses.
    let stored: string | undefined;
    await waitFor(() => { void getSetting(`realAtlas.map.${projectId}`).then((v) => { stored = v; }); return stored !== undefined; }, 'the persisted view', 4000);
    const parsed = JSON.parse(stored!) as { view?: { zoom: number; lon: number; lat: number }; tiles: boolean };
    assert(parsed.tiles === false && parsed.view && parsed.view.zoom > 1 && parsed.view.lon < 0, `the stored view should be the fitted one, got ${stored}`);
    // Remount: the map comes back where it was, not refitted from scratch.
    root.unmount();
    const again = createRoot(host);
    again.render(createElement(AtlasMap, props));
    await waitFor(() => host.querySelectorAll('button[aria-label="Lisboa"]').length === 1, 'the Lisboa pin after remount');
    const lisAgain = at('Lisboa');
    near(lisAgain.x, lis.x, 2, 'Lisboa should be where it was after a remount');
    again.unmount();
  } finally {
    host.remove();
  }
}

/**
 * The keyboard while a route is being built. The container's shortcuts are
 * the canvas's own: Enter on a button of the routes panel is that button's
 * click and must not finish the route from underneath it; Escape takes the
 * stops back one at a time and only leaves the mode once none is left.
 */
export async function testAtlasMapRouteKeys(): Promise<void> {
  const [{ createRoot }, { createElement }, { default: AtlasMap }] = await Promise.all([
    import('react-dom/client'),
    import('react'),
    import('@/engines/real-atlas/components/AtlasMap'),
  ]);
  const projectId = `atlas-route-keys-${Date.now()}`;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;';
  document.body.appendChild(host);
  const places = [place('lis', 'Lisboa', { ...LISBOA }), place('mad', 'Madrid', { ...MADRID })];
  const props = {
    projectId, places, divergences: [], selectedPlaceId: null, onSelect: () => {},
    onEdit: () => {}, onCreateAt: () => {}, onMove: async () => {}, pickRequest: null, onPick: () => {}, focusRequest: null,
  };
  const root = createRoot(host);
  const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  const buttonWithText = (scope: Element, text: string) =>
    [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === text) ?? null;
  const panel = () => host.querySelector(`aside[aria-label="${t('realAtlas.routes.title')}"]`);
  /** Stops clicked so far, or -1 when no route is being built (the legs list of a finished route sits inside <details>). */
  const stops = () => panel()?.querySelector('div > ol')?.querySelectorAll('li').length ?? -1;
  try {
    root.render(createElement(AtlasMap, props));
    await waitFor(() => host.querySelectorAll('button[aria-label="Madrid"]').length === 1, 'the pins');
    const map = host.querySelector('[role="application"]') as HTMLElement;
    (host.querySelector(`button[aria-label="${t('realAtlas.routes.title')}"]`) as HTMLButtonElement).click();
    await waitFor(() => panel() !== null, 'the routes panel');
    buttonWithText(panel()!, t('realAtlas.routes.new'))!.click();
    await waitFor(() => stops() === 0, 'route mode');
    // A keyboard click on a pin (detail 0) adds it as a stop — one per
    // render, since the handler reads the stops from its render's closure.
    const addStop = async (name: string, expected: number) => {
      (host.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement).click();
      await waitFor(() => stops() === expected, `${expected} stop(s)`);
    };
    await addStop('Lisboa', 1);
    await addStop('Madrid', 2);

    // Enter on the panel's "finish" button reaches the container by bubbling
    // and must be ignored there: the route is still being built.
    const finish = buttonWithText(panel()!, t('realAtlas.routes.finish'))!;
    assert(key(finish, 'Enter'), 'Enter on a child button should not be preventDefault-ed by the map');
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    assert(stops() === 2 && buttonWithText(panel()!, t('realAtlas.routes.finish')) !== null, 'Enter on a button of the panel finished the route from under it');

    // Escape on the canvas: one stop back at a time, then out of the mode.
    key(map, 'Escape');
    await waitFor(() => stops() === 1, 'one stop after Escape');
    key(map, 'Escape');
    await waitFor(() => stops() === 0, 'no stops after a second Escape');
    key(map, 'Escape');
    await waitFor(() => buttonWithText(panel()!, t('realAtlas.routes.new')) !== null, 'route mode left after the third Escape');

    // And Enter on the canvas itself does finish a route.
    buttonWithText(panel()!, t('realAtlas.routes.new'))!.click();
    await waitFor(() => stops() === 0, 'route mode again');
    await addStop('Lisboa', 1);
    await addStop('Madrid', 2);
    assert(!key(map, 'Enter'), 'Enter on the canvas should be consumed');
    await waitFor(() => panel()!.querySelectorAll('ul > li').length === 1 && buttonWithText(panel()!, t('realAtlas.routes.new')) !== null, 'the finished route in the list');
  } finally {
    root.unmount();
    host.remove();
  }
}

// ---------------------------------------------------------------------------
// "Appears in": the chapters that name a place, by name or alias
// ---------------------------------------------------------------------------
export function testAtlasPlaceAppearances(): void {
  const chapter = (id: string, chapter: number, content: string): AppearanceWriting =>
    toAppearanceWriting({ id, title: `Chapter ${chapter}`, chapter, updatedAt: chapter, content });
  const writings = [
    chapter('w3', 3, '<p>Nothing happens in Sevilla.</p>'),
    chapter('w1', 1, '<p>They rode into <em>Toletum</em> at dusk.</p>'),
    chapter('w2', 2, '<p>A toledano sword, but never the city itself.</p>'),
    chapter('w4', 4, '<p>Far from Malaga, and from the two Toledos of the map.</p>'),
  ];

  // Name and alias, whole words only, in manuscript order.
  const toledo = findPlaceAppearances(['Toledo', 'Toletum'], writings);
  assert(
    toledo.map((row) => row.writingId).join(',') === 'w1,w4',
    `Toledo/Toletum should be found in chapters 1 (alias) and 4 (plural), got ${JSON.stringify(toledo)}`,
  );
  assert(toledo[0].chapter === 1 && toledo[0].title === 'Chapter 1', 'each appearance carries the chapter number and title');

  // Accents fold both ways.
  assert(findPlaceAppearances(['Málaga'], writings).map((row) => row.writingId).join(',') === 'w4', '«Málaga» finds «Malaga»');
  assert(
    findPlaceAppearances(['Malaga'], [chapter('w5', 5, '<p>Llegaron a Málaga.</p>')]).length === 1,
    '«Malaga» finds «Málaga»',
  );

  // Nothing, and names too short to mean anything.
  assert(findPlaceAppearances(['Lisboa'], writings).length === 0, 'a place nobody names appears nowhere');
  assert(findPlaceAppearances(['Ur'], [chapter('w6', 6, '<p>Ur was old.</p>')]).length === 0, 'a two-letter name is not searched for');
  assert(findPlaceAppearances([], writings).length === 0, 'no names, no appearances');
}
