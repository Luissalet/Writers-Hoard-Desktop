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

/** Deleting a world removes its waypoints too. */
export async function deleteWorldCascade(worldId: string): Promise<void> {
  await db.transaction('rw', [db.generatedWorlds, db.worldWaypoints], async () => {
    await db.worldWaypoints.where('worldId').equals(worldId).delete();
    await db.generatedWorlds.delete(worldId);
  });
}
