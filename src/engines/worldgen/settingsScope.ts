import { db } from '@/db';

/**
 * Where a world's own settings (its look, its travel physics) are written.
 *
 * In a world era, writing a field of an inherited world would copy the whole
 * world into that era and detach it from later Base edits. Settings are not
 * history: while the era still inherits the world they are kept on Base and
 * so shared; once the era holds its own copy (or the world exists only in the
 * era) they stay with that copy.
 */
export async function worldSettingsScope(scope: { projectId: string; eraId?: string }, worldId: string): Promise<{ projectId: string; eraId?: string }> {
  if (!scope.eraId) return scope;
  const variant = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId, scope.eraId, 'worldgen', worldId]).first();
  if (variant && !variant.archived) return scope;
  const base = await db.generatedWorlds.get(worldId);
  return base && base.projectId === scope.projectId ? { projectId: scope.projectId } : scope;
}
