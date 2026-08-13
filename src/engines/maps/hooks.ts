import { makeEntityHook, makeTableOps, makeCascadeDeleteOp } from '@/engines/_shared';
import type { WorldMap, MapPin } from '@/types';

const worldMapOps = makeTableOps<WorldMap>({
  tableName: 'worldMaps',
  scopeField: 'projectId',
});

/**
 * Deleting a map takes its pins with it. Maps was the only parent-with-children
 * engine still using the plain delete: pins survived their map, kept showing up
 * in project search (the resolver scans `mapPins` directly) and navigated
 * nowhere when clicked.
 */
const deleteWorldMap = makeCascadeDeleteOp({
  tableName: 'worldMaps',
  cascades: [{ table: 'mapPins', foreignKey: 'mapId' }],
});

export const useWorldMaps = makeEntityHook<WorldMap>({
  fetchFn: worldMapOps.getAll,
  createFn: worldMapOps.create,
  updateFn: worldMapOps.update,
  deleteFn: deleteWorldMap,
});

const mapPinOps = makeTableOps<MapPin>({
  tableName: 'mapPins',
  scopeField: 'mapId',
});

export const useMapPins = makeEntityHook<MapPin>({
  fetchFn: mapPinOps.getAll,
  createFn: mapPinOps.create,
  updateFn: mapPinOps.update,
  deleteFn: mapPinOps.delete,
});
