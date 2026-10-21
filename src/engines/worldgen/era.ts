import { db } from '@/db';
import type { EntityLink } from '@/types/projectTools';
import type { WorldEraScope } from '@/services/worldEras/types';
import { scopedTableOps } from '@/services/worldEras/tableOps';
import { generatedWorldOps, worldWaypointOps } from './operations';
/** Runtime/cache identity only; persisted document and reference IDs stay logical. */
export function worldRuntimeKey(worldId: string, eraId?: string): string { return eraId ? JSON.stringify([worldId, eraId]) : worldId; }
export function worldgenScopeOperations(scope?: WorldEraScope) {
  return {
    worlds: scopedTableOps(scope, 'generatedWorlds', 'projectId', generatedWorldOps),
    waypoints: scopedTableOps(scope, 'worldWaypoints', 'worldId', worldWaypointOps),
  };
}

/** Era-local manuscript links live inside the world recipe, retaining logical targets. */
export async function listWorldLinks(scope: WorldEraScope, worldId: string): Promise<EntityLink[]> {
  if (scope.eraId) {
    const world = await worldgenScopeOperations(scope).worlds.getOne(worldId);
    if (!world) return [];
    if (world.manuscriptLinks) return world.manuscriptLinks;
  }
  return db.entityLinks.where('sourceEntityId').startsWith(`${worldId}::`).filter(row => row.projectId === scope.projectId).toArray();
}
export async function saveWorldLink(scope: WorldEraScope, worldId: string, link: EntityLink): Promise<void> {
  if (!scope.eraId) { await db.entityLinks.add(link); return; }
  await db.transaction('rw', db.tables, async () => {
    const links = await listWorldLinks(scope, worldId);
    if (links.some(row => row.id === link.id)) throw new Error('Link identity conflict');
    await worldgenScopeOperations(scope).worlds.update(worldId, { manuscriptLinks: [...links, link] });
  });
}
export async function deleteWorldLink(scope: WorldEraScope, worldId: string, id: string): Promise<void> {
  if (!scope.eraId) { await db.entityLinks.delete(id); return; }
  await db.transaction('rw', db.tables, async () => {
    const links = await listWorldLinks(scope, worldId);
    await worldgenScopeOperations(scope).worlds.update(worldId, { manuscriptLinks: links.filter(row => row.id !== id) });
  });
}
