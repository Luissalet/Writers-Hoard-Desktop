// ============================================================================
// Real atlas — the offline vector basemap
// ============================================================================
//
// Country outlines at 1:110m, produced by `scripts/build-atlas-basemap.mjs`
// from Natural Earth via world-atlas and stored as `data/countries-110m.json`
// (see the script for the format). It is what the map shows with no network
// at all; the OSM tile layer is an opt-in on top.
//
// The JSON is imported dynamically so Vite cuts it into its own lazy chunk:
// the atlas engine's list and editors never pay for it, only the map tab.

import { project, worldSize } from './geo';
import { viewBounds, type MapView, type Size } from './mapState';

/** One ring as stored: flat integers, lon then lat, in 1/scale degrees. */
type StoredRing = number[];

interface StoredCountry {
  name: string;
  polygons: StoredRing[][];
}

export interface BasemapRing {
  /**
   * [lon, lat, lon, lat, …] in degrees, open (no repeated closing point).
   * Longitudes are continuous along the ring and may run past ±180° (Chukotka
   * is at 180..190°E): the build script unwrapped them so a country the
   * antimeridian cuts is one shape, not a band across the map.
   */
  coords: Float64Array;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** The world repeats every 360°: a ring is drawn at each copy that touches the view. */
const COPIES = [-360, 0, 360] as const;

export interface BasemapCountry {
  name: string;
  /** Every ring of every polygon: with a single fill and even-odd rule the holes take care of themselves. */
  rings: BasemapRing[];
}

export interface Basemap {
  countries: BasemapCountry[];
}

function decodeRing(ring: StoredRing, scale: number): BasemapRing {
  const coords = new Float64Array(ring.length);
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const lon = ring[i] / scale;
    const lat = ring[i + 1] / scale;
    coords[i] = lon;
    coords[i + 1] = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { coords, minLon, maxLon, minLat, maxLat };
}

export function decodeBasemap(stored: { scale: number; countries: StoredCountry[] }): Basemap {
  return {
    countries: stored.countries.map((country) => ({
      name: country.name,
      rings: country.polygons.flat().map((ring) => decodeRing(ring, stored.scale)),
    })),
  };
}

let loading: Promise<Basemap> | undefined;

/** The decoded basemap, fetched and decoded once per session. */
export function loadBasemap(): Promise<Basemap> {
  loading ??= import('./data/countries-110m.json').then((module) => decodeBasemap(module.default));
  return loading;
}

/**
 * The SVG path of every country visible in `view`, ready for a `d`
 * attribute, recomputed on every frame of a pan or zoom. Rings whose
 * bounding box misses the viewport are skipped outright — past zoom 5 that
 * leaves a handful of countries — and within a ring, points that land on the
 * pixel already emitted are dropped. The whole world (ten thousand points,
 * 177 paths) builds in about 3 ms; zoomed in it is well under one.
 */
export function basemapPaths(basemap: Basemap, view: MapView, size: Size): { name: string; d: string }[] {
  const bounds = viewBounds(view, size);
  const zoom = view.zoom;
  // The viewport in degrees, for the bbox test. Latitude bounds come from the
  // unprojected corners; longitude is linear in x and NOT wrapped: a view
  // centred on 179°E runs from 170° to 188°, and a ring at 180..190° (or its
  // copy 360° west) is compared against that.
  const west = (bounds.x0 / (256 * 2 ** zoom)) * 360 - 180;
  const east = (bounds.x1 / (256 * 2 ** zoom)) * 360 - 180;
  const out: { name: string; d: string }[] = [];
  for (const country of basemap.countries) {
    let d = '';
    for (const ring of country.rings) {
      // A cheap latitude test through projected y, which is monotonic in latitude.
      const top = project(0, ring.maxLat, zoom).y;
      const bottom = project(0, ring.minLat, zoom).y;
      if (bottom < bounds.y0 || top > bounds.y1) continue;
      for (const offset of COPIES) {
        if (ring.maxLon + offset < west || ring.minLon + offset > east) continue;
        d += ringPath(ring, zoom, bounds.x0, bounds.y0, offset);
      }
    }
    if (d) out.push({ name: country.name, d });
  }
  return out;
}

function ringPath(ring: BasemapRing, zoom: number, ox: number, oy: number, offset: number): string {
  const c = ring.coords;
  let d = '';
  let lastX = NaN;
  let lastY = NaN;
  let emitted = 0;
  for (let i = 0; i < c.length; i += 2) {
    const p = project(c[i] + offset, c[i + 1], zoom);
    const x = Math.round(p.x - ox);
    const y = Math.round(p.y - oy);
    if (emitted && Math.abs(x - lastX) < 1 && Math.abs(y - lastY) < 1) continue;
    d += emitted ? `L${x} ${y}` : `M${x} ${y}`;
    lastX = x;
    lastY = y;
    emitted += 1;
  }
  return emitted >= 3 ? `${d}Z` : '';
}

/** The ring with the largest bounding box: the mainland, where a country's name goes. */
export function largestRing(country: BasemapCountry): BasemapRing | undefined {
  let best: BasemapRing | undefined;
  let bestArea = -1;
  for (const ring of country.rings) {
    const area = (ring.maxLon - ring.minLon) * (ring.maxLat - ring.minLat);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

export interface CountryLabel {
  name: string;
  x: number;
  y: number;
  /** Which copy of the world the label is on: -1, 0 or 1 — with the name, a key that survives a pan. */
  copy: number;
}

/**
 * Where each country's name goes: the middle of its mainland's bounding box,
 * for the countries wide enough on screen to carry one, at whichever copy of
 * the world lands inside the viewport. The box is the unwrapped one, so
 * Russia's label sits in Siberia and not over the North Sea where the middle
 * of [-180°, 180°] used to put it.
 */
export function countryLabels(basemap: Basemap, view: MapView, size: Size, minWidthPx: number): CountryLabel[] {
  const bounds = viewBounds(view, size);
  const pxPerDegree = worldSize(view.zoom) / 360;
  const labels: CountryLabel[] = [];
  for (const country of basemap.countries) {
    const ring = largestRing(country);
    if (!ring) continue;
    if ((ring.maxLon - ring.minLon) * pxPerDegree < minWidthPx) continue;
    const middle = project((ring.minLon + ring.maxLon) / 2, (ring.minLat + ring.maxLat) / 2, view.zoom);
    const y = middle.y - bounds.y0;
    if (y < 0 || y > size.height) continue;
    for (const offset of COPIES) {
      const x = middle.x + offset * pxPerDegree - bounds.x0;
      if (x >= 0 && x <= size.width) labels.push({ name: country.name, x, y, copy: offset / 360 });
    }
  }
  return labels;
}
