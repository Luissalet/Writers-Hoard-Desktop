import { useEraEntities } from '@/services/worldEras/hooks';
import { archiveWithMutation } from '@/services/documentArchive/store';
import { db } from '@/db';
import { makeTableOps, makeCascadeDeleteOp, deleteEntityAnnotations } from '@/engines/_shared';
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

export async function deleteWorldMap(id: string): Promise<void> {
  return archiveWithMutation('maps', id, () => deleteWorldMapRows(id));
}
async function deleteWorldMapRows(id: string): Promise<void> {
  await db.transaction(
    'rw',
    ['worldMaps', 'mapPins', 'annotations', 'annotationReferences'],
    async () => {
      await deleteEntityAnnotations('maps', id);
      await deleteWorldMapRow(id);
    },
  );
}

const useWorldMapsOptions = {
  fetchFn: worldMapOps.getAll,
  createFn: worldMapOps.create,
  updateFn: worldMapOps.update,
  deleteFn: deleteWorldMap,
};
export function useWorldMaps(scopeId: string) { return useEraEntities<WorldMap>(scopeId, 'worldMaps', 'projectId', useWorldMapsOptions); }

const mapPinOps = makeTableOps<MapPin>({
  tableName: 'mapPins',
  scopeField: 'mapId',
});

const useMapPinsOptions = {
  fetchFn: mapPinOps.getAll,
  createFn: mapPinOps.create,
  updateFn: mapPinOps.update,
  deleteFn: mapPinOps.delete,
};
export function useMapPins(scopeId: string) { return useEraEntities<MapPin>(scopeId, 'mapPins', 'mapId', useMapPinsOptions); }
