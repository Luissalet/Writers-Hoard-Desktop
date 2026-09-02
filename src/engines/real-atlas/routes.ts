// ============================================================================
// Real atlas — itineraries: an ordered list of the project's places
// ============================================================================
//
// A route is a name and the ids of two or more places, in the order a
// character travels them; the map draws it as a polyline with arrows and the
// panel totals its legs. Routes live as one JSON blob per project in the
// `settings` table under `PROJECT_SETTING_PREFIXES.atlasRoutes`, not as a
// Dexie table: a table would mean a schema version, a backup strategy, a
// conformance entry and a deletion cascade for a list that is rarely longer
// than a hand. The project's backup carries them anyway — the engine's
// strategy writes the blob to `real-atlas/routes.json` (see index.ts) — and
// `deleteProject` sweeps the key with the other project settings.
//
// Legs are great-circle; a place that has lost its coordinates (or was
// deleted) is skipped and reported in `missing`, so a route never pretends
// to a distance it cannot compute.

import { getSetting, PROJECT_SETTING_PREFIXES, setSetting } from '@/db/operations';
import { bearingDeg, hasCoordinates, haversineKm, TRAVEL_MODES, travelEstimates, type LonLat, type TravelEstimate, type TravelMode } from './geo';
import type { AtlasPlace } from './types';

export interface AtlasRoute {
  id: string;
  name: string;
  /** Two or more place ids, in travelling order. The same place may recur (there and back). */
  placeIds: string[];
  /** The means of travel the writer had in mind, if they said. */
  mode?: TravelMode;
}

export interface RouteLeg {
  fromId: string;
  toId: string;
  km: number;
  bearingDeg: number;
}

export interface RouteTotals {
  km: number;
  legs: RouteLeg[];
  /** Ids in the route that could not be measured: unknown, or without coordinates. */
  missing: string[];
  estimates: TravelEstimate[];
}

/** Places on a route may repeat, so `MAX_ROUTE_STOPS` bounds the drawing, not the writer's imagination. */
export const MAX_ROUTE_STOPS = 200;
/** Bounds on the stored blob, so a corrupt or hostile one cannot pin the map under a million polylines. */
export const MAX_ROUTES = 500;
export const MAX_ROUTE_NAME_LENGTH = 200;
const MAX_ROUTE_ID_LENGTH = 64;

function routesKey(projectId: string): string {
  return `${PROJECT_SETTING_PREFIXES.atlasRoutes}${projectId}`;
}

function isMode(value: unknown): value is TravelMode {
  return typeof value === 'string' && (TRAVEL_MODES as readonly string[]).includes(value);
}

/** Whatever was stored, or nothing; a corrupt blob is an empty list, never an exception, and a malformed route is dropped. */
export function parseAtlasRoutes(raw: string | undefined): AtlasRoute[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = parsed && typeof parsed === 'object' ? (parsed as { routes?: unknown }).routes : undefined;
    if (!Array.isArray(list)) return [];
    const routes: AtlasRoute[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      if (routes.length >= MAX_ROUTES) break;
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (typeof record.id !== 'string' || !record.id || record.id.length > MAX_ROUTE_ID_LENGTH || seen.has(record.id)) continue;
      if (!Array.isArray(record.placeIds)) continue;
      const placeIds = record.placeIds.filter((id): id is string => typeof id === 'string' && Boolean(id)).slice(0, MAX_ROUTE_STOPS);
      if (placeIds.length < 2) continue;
      seen.add(record.id);
      routes.push({
        id: record.id,
        name: typeof record.name === 'string' ? record.name.slice(0, MAX_ROUTE_NAME_LENGTH) : '',
        placeIds,
        ...(isMode(record.mode) ? { mode: record.mode } : {}),
      });
    }
    return routes;
  } catch {
    return [];
  }
}

export function serializeAtlasRoutes(routes: readonly AtlasRoute[]): string {
  return JSON.stringify({ routes });
}

export async function loadAtlasRoutes(projectId: string): Promise<AtlasRoute[]> {
  return parseAtlasRoutes(await getSetting(routesKey(projectId)));
}

/** The whole list, replaced: routes are edited one at a time from one screen, so read-modify-write races do not arise. */
export async function saveAtlasRoutes(projectId: string, routes: readonly AtlasRoute[]): Promise<void> {
  await setSetting(routesKey(projectId), serializeAtlasRoutes(routes));
}

/** The settings row the blob lives in, for the bridge's audit line. */
export function atlasRoutesSettingId(projectId: string): string {
  return `set_${routesKey(projectId)}`;
}

/**
 * Distance and travel time along the route. Legs run between consecutive
 * stops that both have coordinates; a stop without them breaks the chain
 * there (the leg into it and out of it are both lost) rather than being
 * silently skipped over, which would report a shorter journey than the
 * writer described.
 */
export function routeTotals(route: Pick<AtlasRoute, 'placeIds'>, places: readonly AtlasPlace[]): RouteTotals {
  const byId = new Map(places.map((place) => [place.id, place]));
  const legs: RouteLeg[] = [];
  const missing: string[] = [];
  let previous: (LonLat & { id: string }) | null = null;
  for (const id of route.placeIds) {
    const place = byId.get(id);
    if (!place || !hasCoordinates(place)) {
      if (!missing.includes(id)) missing.push(id);
      previous = null;
      continue;
    }
    const here = { id, lon: place.lon, lat: place.lat };
    if (previous) {
      legs.push({ fromId: previous.id, toId: id, km: haversineKm(previous, here), bearingDeg: bearingDeg(previous, here) });
    }
    previous = here;
  }
  const km = legs.reduce((sum, leg) => sum + leg.km, 0);
  return { km, legs, missing, estimates: travelEstimates(km) };
}

/** The route's stops that can be drawn, in order, for the polyline and for fitting the view. */
export function routePoints(route: Pick<AtlasRoute, 'placeIds'>, byId: ReadonlyMap<string, AtlasPlace>): (LonLat & { id: string })[] {
  const points: (LonLat & { id: string })[] = [];
  for (const id of route.placeIds) {
    const place = byId.get(id);
    if (place && hasCoordinates(place)) points.push({ id, lon: place.lon, lat: place.lat });
  }
  return points;
}
