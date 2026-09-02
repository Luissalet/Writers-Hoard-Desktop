// ============================================================================
// Real atlas — the map's per-project preferences
// ============================================================================
//
// Where the map was left (centre and zoom) and which layers are on, one row
// per project in the `settings` key/value table, under a prefix declared in
// `PROJECT_SETTING_PREFIXES` so `deleteProject` and the ZIP restore sweep it
// with the project. A fact about the writer's session, not about the book:
// it does not belong in a backup, which is why it is not a table.
//
// The tile toggle is here rather than in a global setting on purpose: it is
// the one thing on this map that reaches the network, and a project set in
// an invented town has no business fetching real-world tiles by default.

import { getSetting, PROJECT_SETTING_PREFIXES, updateSetting } from '@/db/operations';
import { clampLatitude, wrapLongitude } from './geo';
import { MAX_ZOOM, MIN_ZOOM, type MapView } from './mapState';

export interface AtlasMapPrefs {
  /** Absent until the map has been moved once; the first view fits the places. */
  view?: MapView;
  /** "Detailed map (internet)": the OSM tile layer. Off by default — no network unless asked. */
  tiles: boolean;
  /** Thin parent→child lines. */
  hierarchy: boolean;
  /**
   * The writer agreed, once, that "find coordinates" may ask OpenStreetMap's
   * Nominatim over the internet. Per project like the tiles, for the same
   * reason: nothing on this map reaches the network unless asked to.
   */
  geocodeConsent: boolean;
}

export const DEFAULT_ATLAS_MAP_PREFS: AtlasMapPrefs = { tiles: false, hierarchy: false, geocodeConsent: false };

function prefsKey(projectId: string): string {
  return `${PROJECT_SETTING_PREFIXES.atlasMap}${projectId}`;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Whatever was stored, or the defaults; a corrupt row is a default row, never an exception. */
export function parseAtlasMapPrefs(raw: string | undefined): AtlasMapPrefs {
  if (!raw) return DEFAULT_ATLAS_MAP_PREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_ATLAS_MAP_PREFS;
    const record = parsed as Record<string, unknown>;
    const view = record.view as Record<string, unknown> | undefined;
    const prefs: AtlasMapPrefs = {
      tiles: record.tiles === true,
      hierarchy: record.hierarchy === true,
      geocodeConsent: record.geocodeConsent === true,
    };
    if (view && finite(view.lon) && finite(view.lat) && finite(view.zoom)) {
      prefs.view = {
        center: { lon: wrapLongitude(view.lon), lat: clampLatitude(view.lat) },
        zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom)),
      };
    }
    return prefs;
  } catch {
    return DEFAULT_ATLAS_MAP_PREFS;
  }
}

export function serializeAtlasMapPrefs(prefs: AtlasMapPrefs): string {
  return JSON.stringify({
    tiles: prefs.tiles,
    hierarchy: prefs.hierarchy,
    geocodeConsent: prefs.geocodeConsent,
    // Rounded: a centre to the nanodegree is noise that changes on every pan.
    view: prefs.view && {
      lon: Number(prefs.view.center.lon.toFixed(5)),
      lat: Number(prefs.view.center.lat.toFixed(5)),
      zoom: Number(prefs.view.zoom.toFixed(3)),
    },
  });
}

export async function loadAtlasMapPrefs(projectId: string): Promise<AtlasMapPrefs> {
  return parseAtlasMapPrefs(await getSetting(prefsKey(projectId)));
}

/**
 * Write some of the preferences, merged atomically over what is stored: the
 * map saves its view and layers from a debounced pan handler while the place
 * editor may have just recorded the geocoding consent, and whichever of the
 * two wrote last must not take the other's field back to its default.
 *
 * A failure is swallowed: the pan handler has nowhere to put an error, and
 * the next move writes again anyway.
 */
export async function saveAtlasMapPrefs(projectId: string, patch: Partial<AtlasMapPrefs>): Promise<void> {
  try {
    await updateSetting(prefsKey(projectId), (current) => serializeAtlasMapPrefs({ ...parseAtlasMapPrefs(current), ...patch }));
  } catch {
    // Superseded by the next save.
  }
}
