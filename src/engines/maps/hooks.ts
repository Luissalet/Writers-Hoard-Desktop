import { db } from '@/db';
import { makeEntityHook, makeTableOps, makeCascadeDeleteOp, deleteEntityAnnotations } from '@/engines/_shared';
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
 *
 * The margin notes anchored on the map are pure link, so they go too.
 */
const deleteWorldMapRow = makeCascadeDeleteOp({
  tableName: 'worldMaps',
  cascades: [{ table: 'mapPins', foreignKey: 'mapId' }],
});

async function deleteWorldMap(id: string): Promise<void> {
  await db.transaction(
    'rw',
    ['worldMaps', 'mapPins', 'annotations', 'annotationReferences'],
    async () => {
      await deleteEntityAnnotations('maps', id);
      await deleteWorldMapRow(id);
    },
  );
}

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
