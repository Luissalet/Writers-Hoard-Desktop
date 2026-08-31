import { db } from '@/db';
import { makeTableOps } from '@/engines/_shared';
import type { GeneratedWorld, WorldWaypoint } from './types';

export const generatedWorldOps = makeTableOps<GeneratedWorld>({
  tableName: 'generatedWorlds',
  scopeField: 'projectId',
  sortFn: (a, b) => a.createdAt - b.createdAt,
});

export const worldWaypointOps = makeTableOps<WorldWaypoint>({
  tableName: 'worldWaypoints',
  scopeField: 'worldId',
  sortFn: (a, b) => a.createdAt - b.createdAt,
});

/**
 * Deleting a world removes its waypoints, the manuscript links hanging on its
 * places (`<worldId>::<placeKey>`, see SpatialEntityInspector) and its forged
 * caches too (canon and rendered tiles, both regenerable from the seed).
 */
export async function deleteWorldCascade(worldId: string): Promise<void> {
  await db.transaction('rw', [
    db.generatedWorlds, db.worldWaypoints, db.worldSnapshots, db.canonTiles, db.renderedTiles,
    db.entityLinks,
  ], async () => {
    await db.worldWaypoints.where('worldId').equals(worldId).delete();
    await db.entityLinks.where('sourceEntityId').startsWith(`${worldId}::`).delete();
    await db.worldSnapshots.delete(worldId);
    await db.canonTiles.where('worldId').equals(worldId).delete();
    await db.renderedTiles.where('worldId').equals(worldId).delete();
    await db.generatedWorlds.delete(worldId);
  });
}
