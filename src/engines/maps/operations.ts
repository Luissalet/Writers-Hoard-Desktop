import { makeTableOps } from '@/engines/_shared';
import type { WorldMap, MapPin } from '@/types';

export const worldMapOps = makeTableOps<WorldMap>({
  tableName: 'worldMaps',
  scopeField: 'projectId',
});

export const mapPinOps = makeTableOps<MapPin>({
  tableName: 'mapPins',
  scopeField: 'mapId',
});
