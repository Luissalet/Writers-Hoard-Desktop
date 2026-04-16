import { makeEntityHook, makeTableOps } from '@/engines/_shared';
import type { WorldMap, MapPin } from '@/types';

const worldMapOps = makeTableOps<WorldMap>({
  tableName: 'worldMaps',
  scopeField: 'projectId',
});

export const useWorldMaps = makeEntityHook<WorldMap>({
  fetchFn: worldMapOps.getAll,
  createFn: worldMapOps.create,
  updateFn: worldMapOps.update,
  deleteFn: worldMapOps.delete,
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
