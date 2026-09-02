// ============================================================================
// Real atlas — the map's view state, as pure functions
// ============================================================================
//
// A view is a centre and a fractional zoom; everything the component does
// with pointer events reduces to one of these transitions. Kept out of the
// component so the tests can drive them without a DOM, and so the rules
// (zoom limits, the world's edges) live in one place.

import {
  clampLatitude, nearestLongitude, project, unproject, worldSize, wrapLongitude,
  type LonLat, type PixelBounds, type Point,
} from './geo';

export interface MapView {
  center: LonLat;
  /** Fractional: 1 is the whole world, 18 a street. */
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 1;
/** OSM serves up to 19; the vector base is meaningless well before that. */
export const MAX_ZOOM = 18;

/** The whole world, centred a little north because that is where most of the land is. */
export const WORLD_VIEW: MapView = { center: { lon: 10, lat: 25 }, zoom: 1 };

/** The inhabited world, for fitting a map with no places yet: Antarctica and the Arctic ice are not worth the pixels. */
export const WORLD_EXTENT: readonly LonLat[] = [{ lon: -168, lat: 72 }, { lon: 178, lat: -56 }];

export function clampView(view: MapView): MapView {
  return {
    center: { lon: wrapLongitude(view.center.lon), lat: clampLatitude(view.center.lat) },
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom)),
  };
}

/** World pixels of the container's top-left corner at the view's zoom. */
export function viewOrigin(view: MapView, size: Size): Point {
  const c = project(view.center.lon, view.center.lat, view.zoom);
  return { x: c.x - size.width / 2, y: c.y - size.height / 2 };
}

/** The container's rectangle in world pixels at the view's zoom. */
export function viewBounds(view: MapView, size: Size): PixelBounds {
  const o = viewOrigin(view, size);
  return { x0: o.x, y0: o.y, x1: o.x + size.width, y1: o.y + size.height };
}

/**
 * A longitude/latitude → pixel inside the container, using whichever copy of
 * the point is nearest the view's centre: a place on the far side of the
 * antimeridian lands just across it, not a whole world away.
 */
export function toScreen(view: MapView, size: Size, lonLat: LonLat): Point {
  const o = viewOrigin(view, size);
  const p = project(nearestLongitude(lonLat.lon, view.center.lon), lonLat.lat, view.zoom);
  return { x: p.x - o.x, y: p.y - o.y };
}

/**
 * A pixel inside the container → longitude/latitude. The latitude is clamped
 * to the projection's cut, so a point dragged past the top edge is a point on
 * the top edge and not an 88° that no longer projects where it was dropped.
 */
export function fromScreen(view: MapView, size: Size, point: Point): LonLat {
  const o = viewOrigin(view, size);
  const ll = unproject(o.x + point.x, o.y + point.y, view.zoom);
  return { lon: wrapLongitude(ll.lon), lat: clampLatitude(ll.lat) };
}

/** Whether a container pixel lies on the world at all — above or below the poles there is nothing to drop a pin on. */
export function isOnWorld(view: MapView, size: Size, point: Point): boolean {
  const o = viewOrigin(view, size);
  const y = o.y + point.y;
  return y >= 0 && y <= worldSize(view.zoom);
}

/** Drag the map by a pixel delta: the world moves WITH the pointer. */
export function panBy(view: MapView, dx: number, dy: number): MapView {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return view;
  const c = project(view.center.lon, view.center.lat, view.zoom);
  const next = unproject(c.x - dx, c.y - dy, view.zoom);
  return clampView({ center: next, zoom: view.zoom });
}

/**
 * Change zoom by `delta` keeping the place under `cursor` where it is — the
 * wheel zooms towards the pointer, not towards the centre.
 */
export function zoomAt(view: MapView, size: Size, cursor: Point, delta: number): MapView {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom + delta));
  if (zoom === view.zoom) return view;
  const anchor = fromScreen(view, size, cursor);
  // With the new zoom, put the anchor back under the cursor: the centre is the
  // anchor shifted by the cursor's offset from the middle, at the new scale.
  const a = project(anchor.lon, anchor.lat, zoom);
  const center = unproject(a.x - (cursor.x - size.width / 2), a.y - (cursor.y - size.height / 2), zoom);
  return clampView({ center, zoom });
}

/** Zoom by `delta` around the container's centre (the +/− buttons, double click). */
export function zoomBy(view: MapView, delta: number): MapView {
  return clampView({ center: view.center, zoom: view.zoom + delta });
}

/**
 * The view that shows every point with `padding` pixels to spare, capped at
 * `maxZoom` so one point (or two neighbours) does not land on a single
 * street. No points → the world.
 */
export function fitBounds(points: readonly LonLat[], size: Size, padding = 48, maxZoom = 12): MapView {
  if (!points.length || size.width <= 0 || size.height <= 0) return WORLD_VIEW;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, clampLatitude(p.lat));
    maxLat = Math.max(maxLat, clampLatitude(p.lat));
  }
  const { minLon, maxLon } = longitudeSpan(points);
  // Extent in world pixels at zoom 0, then the zoom at which it fills the
  // padded container: each zoom level doubles it. `project` is linear in
  // longitude, so an unwrapped maxLon past 180° is simply further right.
  const nw = project(minLon, maxLat, 0);
  const se = project(maxLon, minLat, 0);
  const width = Math.max(se.x - nw.x, 1e-9);
  const height = Math.max(se.y - nw.y, 1e-9);
  const usable = { w: Math.max(size.width - 2 * padding, 1), h: Math.max(size.height - 2 * padding, 1) };
  const zoom = Math.min(maxZoom, Math.log2(Math.min(usable.w / width, usable.h / height)));
  const mid = unproject((nw.x + se.x) / 2, (nw.y + se.y) / 2, 0);
  return clampView({ center: mid, zoom });
}

/**
 * The narrowest run of longitude that holds every point, as an unwrapped
 * [minLon, maxLon] (maxLon may exceed 180°). Suva and Apia are 10° apart
 * across the antimeridian and 350° apart around the other way; the naive
 * min/max picks the 350°. The run is the complement of the widest gap between
 * neighbouring longitudes once they are sorted round the circle.
 */
export function longitudeSpan(points: readonly LonLat[]): { minLon: number; maxLon: number } {
  const lons = points.map((p) => wrapLongitude(p.lon)).sort((a, b) => a - b);
  if (lons.length === 1) return { minLon: lons[0], maxLon: lons[0] };
  let widestGap = lons[0] + 360 - lons[lons.length - 1];
  let start = 0;
  for (let i = 1; i < lons.length; i += 1) {
    const gap = lons[i] - lons[i - 1];
    if (gap > widestGap) {
      widestGap = gap;
      start = i;
    }
  }
  const minLon = lons[start];
  return { minLon, maxLon: minLon + (360 - widestGap) };
}
