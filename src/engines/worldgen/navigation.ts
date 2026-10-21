import { worldgenScopeOperations } from './era';

/** Resolve stored ownership, including imported IDs with no naming convention. */
export async function resolveWorldgenRoute(projectId: string, entityId: string, eraId?: string): Promise<string | null> {
  const { worlds, waypoints } = worldgenScopeOperations({ projectId, eraId });
  const base = `/project/${encodeURIComponent(projectId)}/worldgen`;
  const context = eraId ? `&era=${encodeURIComponent(eraId)}` : '';
  const world = await worlds.getOne(entityId);
  if (world) return world.projectId === projectId ? `${base}?world=${encodeURIComponent(entityId)}${context}` : null;

  const waypoint = await waypoints.getOne(entityId);
  if (waypoint) {
    if (waypoint.projectId !== projectId) return null;
    const owner = await worlds.getOne(waypoint.worldId);
    return owner?.projectId === projectId ? `${base}?waypoint=${encodeURIComponent(entityId)}${context}` : null;
  }

  const split = entityId.indexOf('::');
  if (split > 0) {
    const owner = await worlds.getOne(entityId.slice(0, split));
    return owner?.projectId === projectId ? `${base}?place=${encodeURIComponent(entityId)}${context}` : null;
  }

  const rows = await worlds.getAll(projectId);
  return rows.some((candidate) => candidate.regions?.some((region) => region.id === entityId))
    ? `${base}?region=${encodeURIComponent(entityId)}${context}` : null;
}
