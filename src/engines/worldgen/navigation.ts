import { db } from '@/db';

/** Resolve stored ownership, including imported IDs with no naming convention. */
export async function resolveWorldgenRoute(projectId: string, entityId: string): Promise<string | null> {
  const base = `/project/${encodeURIComponent(projectId)}/worldgen`;
  const world = await db.generatedWorlds.get(entityId);
  if (world) return world.projectId === projectId ? `${base}?world=${encodeURIComponent(entityId)}` : null;

  const waypoint = await db.worldWaypoints.get(entityId);
  if (waypoint) {
    if (waypoint.projectId !== projectId) return null;
    const owner = await db.generatedWorlds.get(waypoint.worldId);
    return owner?.projectId === projectId ? `${base}?waypoint=${encodeURIComponent(entityId)}` : null;
  }

  const split = entityId.indexOf('::');
  if (split > 0) {
    const owner = await db.generatedWorlds.get(entityId.slice(0, split));
    return owner?.projectId === projectId ? `${base}?place=${encodeURIComponent(entityId)}` : null;
  }

  const worlds = await db.generatedWorlds.where('projectId').equals(projectId).toArray();
  return worlds.some((candidate) => candidate.regions?.some((region) => region.id === entityId))
    ? `${base}?region=${encodeURIComponent(entityId)}` : null;
}
