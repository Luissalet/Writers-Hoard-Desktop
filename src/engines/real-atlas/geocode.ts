// ============================================================================
// Real atlas — "find coordinates": geocoding through OpenStreetMap's Nominatim
// ============================================================================
//
// The one other thing on the atlas that reaches the internet, and like the
// tile layer it is opt-in per project (`AtlasMapPrefs.geocodeConsent`). The
// request itself is made by the main process (`electron/atlasGeocode.ts`):
// Nominatim's usage policy asks for an identifying User-Agent and at most one
// request a second, neither of which a renderer can promise — the browser
// owns the header, and two editors could ask at once. Main queues and
// throttles; this side only parses what comes back, so the parsing can be
// tested without a network. This file is also imported by the preload for
// its types, so it must not touch `window`.

export interface GeocodeHit {
  /** Nominatim's display name: "Rossio, Santa Maria Maior, Lisboa, Portugal". */
  name: string;
  lat: number;
  lon: number;
  /** "city", "suburb", "peak"… — Nominatim's `type`, or its `class` when the type says nothing. */
  kind: string;
  country?: string;
}

/** What `window.electronAPI.atlas.geocode` resolves with. */
export type GeocodeResponse =
  | { ok: true; results: unknown }
  | { ok: false; code: 'bad-query' | 'network' | 'timeout' | 'http'; error: string };

export const GEOCODE_MAX_RESULTS = 5;
export const GEOCODE_MAX_QUERY_LENGTH = 200;

/** Nominatim writes coordinates as decimal strings; nothing else is one. */
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
/** A display name is a line, not a document: what the picker shows is cut here, and so is what could be saved as a country. */
const MAX_TEXT_LENGTH = 300;

/**
 * A number, or a string holding a plain decimal. `Number()` is not enough:
 * it reads `''` and `' '` as 0 (a place on Null Island) and `'0x10'` as 16,
 * none of which a geocoder ever meant.
 */
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return DECIMAL_RE.test(text) ? Number(text) : undefined;
}

function boundedText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LENGTH) : '';
}

/**
 * Nominatim's `format=jsonv2` array → the hits the picker shows. Anything
 * malformed is dropped rather than shown with NaN coordinates; the list is
 * capped, since the editor only ever asked for five.
 */
export function parseNominatimResults(body: unknown): GeocodeHit[] {
  if (!Array.isArray(body)) return [];
  const hits: GeocodeHit[] = [];
  for (const item of body) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const lat = finiteNumber(record.lat);
    const lon = finiteNumber(record.lon);
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const name = boundedText(record.display_name);
    if (!name) continue;
    const type = boundedText(record.type);
    const cls = boundedText(record.class);
    const address = record.address && typeof record.address === 'object' ? (record.address as Record<string, unknown>) : undefined;
    const country = boundedText(address?.country) || undefined;
    hits.push({
      name,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      kind: type && type !== 'yes' ? type : cls,
      ...(country ? { country } : {}),
    });
    if (hits.length >= GEOCODE_MAX_RESULTS) break;
  }
  return hits;
}
