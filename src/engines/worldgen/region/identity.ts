import { editKey } from '../core/edits';
import { landmarkKey } from '../core/spatialEntities';
import type { LandmarkType } from '../core/types';
import type { RegionGeometry } from './terrain';
import type { PlaceKind, RegionPlace } from './types';
import { regionCellToWorld } from './coordinates';

const EARTH_CIRCUMFERENCE_KM = 2 * Math.PI * 6371;
const LOCAL_KEY_QUANTUM_KM = 1;

export type RegionPlaceDraft = Omit<RegionPlace, 'sourceKey' | 'worldX' | 'worldY'>;

export function worldSettlementSourceKey(x: number, y: number): string {
  return editKey('settlement', x, y);
}

export function worldRuinSourceKey(x: number, y: number): string {
  return editKey('ruin', x, y);
}

export function worldLandmarkSourceKey(type: LandmarkType, x: number, y: number): string {
  return landmarkKey({ type, x, y });
}

/**
 * Identity for habitation placed on the generator's world-anchored 2.6 km lattice.
 * The indices do not depend on sheet origin or render resolution.
 */
export function habitationSourceKey(a: number, b: number): string {
  return `region:habitation:${a},${b}`;
}

/**
 * Best-effort identity for features whose detector currently works on a raster.
 *
 * Coordinates are quantised in physical kilometres rather than sheet cells, so
 * changing the viewport origin or raster resolution does not itself rewrite the
 * identity. Detector-specific lattices should pass an explicit key instead.
 */
export function regionalCoordinateSourceKey(
  kind: string,
  worldX: number,
  worldY: number,
  worldWidth: number,
  discriminator = '',
): string {
  const kmPerWorldCell = EARTH_CIRCUMFERENCE_KM / Math.max(1, worldWidth);
  const qx = Math.round(worldX * kmPerWorldCell / LOCAL_KEY_QUANTUM_KM);
  const qy = Math.round(worldY * kmPerWorldCell / LOCAL_KEY_QUANTUM_KM);
  return `region:${kind}:${discriminator}${qx},${qy}`;
}

export function regionalSourceKeyAt(
  kind: string,
  geometry: RegionGeometry,
  point: { x: number; y: number },
  worldWidth: number,
  discriminator = '',
): string {
  const world = regionCellToWorld(geometry, point, worldWidth);
  return regionalCoordinateSourceKey(kind, world.x, world.y, worldWidth, discriminator);
}

/**
 * Complete a place with canonical world coordinates and a stable source key.
 * RegionData stays entirely derived; callers persist only edits keyed by sourceKey.
 */
export function materializeRegionPlace(
  draft: RegionPlaceDraft,
  geometry: RegionGeometry,
  worldWidth: number,
  explicitSourceKey?: string,
): RegionPlace {
  const world = regionCellToWorld(geometry, draft, worldWidth);
  return {
    ...draft,
    sourceKey: explicitSourceKey ?? regionalCoordinateSourceKey(
      draft.landmark ?? draft.kind, world.x, world.y, worldWidth,
    ),
    worldX: world.x,
    worldY: world.y,
  };
}

export function childRegionSourceKey(parentSourceKey: string, kind: PlaceKind): string {
  return `${parentSourceKey}:${kind}`;
}
