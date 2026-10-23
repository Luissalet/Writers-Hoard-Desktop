import type { MapAmbience, MapArtwork } from '@/types';

/** Same raster whitelist the wiki export uses for map pictures: no SVG, no remote URL. */
export const isMapRaster = (value: unknown): value is string => typeof value === 'string' && /^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(value);

export const MAP_ARTWORK_LAYERS = ['background', 'mid', 'front'] as const;
export type MapArtworkLayer = (typeof MAP_ARTWORK_LAYERS)[number];
/** Caps keep a self-contained wiki small: one layer, all three layers together, and an ambience track as exported. */
export const MAP_ARTWORK_LIMITS = { layerChars: 8_000_000, totalChars: 16_000_000, ambienceBytes: 12 * 1024 * 1024, ambienceTotalBytes: 24 * 1024 * 1024 } as const;
export const MAP_AMBIENCE_DEFAULT = { volume: 0.5, radius: 15 } as const;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Throws `map_artwork_invalid` / `map_artwork_too_large`; returns the artwork without empty layers. */
export function validateMapArtwork(value: unknown): MapArtwork {
  if (!record(value)) throw Error('map_artwork_invalid');
  const out: MapArtwork = {}; let total = 0;
  for (const key of Object.keys(value)) if (![...MAP_ARTWORK_LAYERS, 'clouds'].includes(key)) throw Error('map_artwork_invalid');
  for (const layer of MAP_ARTWORK_LAYERS) {
    const picture = value[layer];
    if (picture === undefined) continue;
    if (!isMapRaster(picture)) throw Error('map_artwork_invalid');
    if (picture.length > MAP_ARTWORK_LIMITS.layerChars) throw Error('map_artwork_too_large');
    total += picture.length; out[layer] = picture;
  }
  if (total > MAP_ARTWORK_LIMITS.totalChars) throw Error('map_artwork_too_large');
  if (value.clouds !== undefined) { if (typeof value.clouds !== 'boolean') throw Error('map_artwork_invalid'); out.clouds = value.clouds; }
  return out;
}

/** The layers that are safe to inline right now (a stored row from an older or hand-edited backup is checked again at export). */
export function usableMapArtwork(artwork: MapArtwork | undefined): MapArtwork {
  if (!artwork) return {};
  const out: MapArtwork = {}; let total = 0;
  for (const layer of MAP_ARTWORK_LAYERS) {
    const picture = artwork[layer];
    if (!isMapRaster(picture) || picture.length > MAP_ARTWORK_LIMITS.layerChars || total + picture.length > MAP_ARTWORK_LIMITS.totalChars) continue;
    total += picture.length; out[layer] = picture;
  }
  if (artwork.clouds === true) out.clouds = true;
  return out;
}

export const hasMapArtwork = (artwork: MapArtwork | undefined) => !!artwork && MAP_ARTWORK_LAYERS.some(layer => !!artwork[layer]);

/** Ambience from untrusted input: asset id plus a 0-1 volume and, for a pin, a radius of 2-60 percent of the map width. */
export function normalizeMapAmbience(value: unknown, withRadius: boolean): (MapAmbience & { radius?: number }) | undefined {
  if (value === undefined || value === null) return undefined;
  if (!record(value) || typeof value.assetId !== 'string' || !value.assetId.trim() || value.assetId.length > 200) throw Error('map_ambience_invalid');
  for (const key of Object.keys(value)) if (!['assetId', 'volume', 'radius'].includes(key) || (key === 'radius' && !withRadius)) throw Error('map_ambience_invalid');
  const out: MapAmbience & { radius?: number } = { assetId: value.assetId };
  if (value.volume !== undefined) { if (typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) throw Error('map_ambience_invalid'); out.volume = value.volume; }
  if (value.radius !== undefined) { if (typeof value.radius !== 'number' || !Number.isFinite(value.radius) || value.radius < 2 || value.radius > 60) throw Error('map_ambience_invalid'); out.radius = value.radius; }
  return out;
}
