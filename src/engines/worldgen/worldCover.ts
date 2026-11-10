import { db } from '@/db';
import { announceEraChange, assertWorldEra } from '@/services/worldEras/store';
import type { WorldEraScope, WorldEraVariant, WorldEraVariantState } from '@/services/worldEras/types';
import { worldgenScopeOperations } from './era';
import { worldSettingsScope } from './settingsScope';
import type { GeneratedWorld } from './types';

export class WorldCoverError extends Error {
  readonly code: 'bad-value' | 'not-found' | 'conflict';
  constructor(code: 'bad-value' | 'not-found' | 'conflict', message: string) { super(message); this.code = code; }
}

export interface WorldCoverReceipt {
  projectId: string;
  worldId: string;
  requestedScope: WorldEraScope;
  ownerScope: WorldEraScope;
  rootCreatedAt: number;
  ownerToken: string;
  beforeImage: string | null;
  afterImage: string | null;
  revision: number;
  changed: boolean;
}

const scopeOf = (scope: WorldEraScope): WorldEraScope => ({ projectId: scope.projectId, ...(scope.eraId ? { eraId: scope.eraId } : {}) });
const sameScope = (a: WorldEraScope, b: WorldEraScope) => a.projectId === b.projectId && a.eraId === b.eraId;

/** Read visibility before resolving settings ownership, so a hidden world cannot edit Base. */
async function readOwner(requested: WorldEraScope, worldId: string): Promise<{ scope: WorldEraScope; row: GeneratedWorld; ownerToken: string }> {
  try { await assertWorldEra(requested); }
  catch (error) {
    if (error instanceof Error && ['project_missing', 'world_era_missing'].includes(error.message)) throw new WorldCoverError('not-found', 'The project or era no longer exists.');
    throw error;
  }
  const visible = await worldgenScopeOperations(requested).worlds.getOne(worldId);
  if (!visible || visible.projectId !== requested.projectId) throw new WorldCoverError('not-found', 'The map is not visible in this project and era.');
  const scope = scopeOf(await worldSettingsScope(requested, worldId));
  const row = await worldgenScopeOperations(scope).worlds.getOne(worldId);
  if (!row || row.projectId !== requested.projectId) throw new WorldCoverError('not-found', 'The map owner no longer exists.');
  const variant = scope.eraId ? await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId, scope.eraId, 'worldgen', worldId]).first() : undefined;
  if (scope.eraId && (!variant || variant.archived || variant.hidden || !variant.document)) throw new WorldCoverError('conflict', 'The map owner changed. Read it again before saving.');
  return { scope, row, ownerToken: ownerIdentity(scope, row, variant) };
}

/** Existing history records owner replacement without tying cover Undo to unrelated terrain writes. */
function ownerIdentity(scope: WorldEraScope, row: GeneratedWorld, variant?: WorldEraVariant): string {
  let boundary = 0, previous: WorldEraVariantState | undefined;
  for (const state of variant ? [...variant.history ?? [], variant] : []) {
    const before = previous?.document?.root, after = state.document?.root;
    if (previous && (
      !!previous.archived !== !!state.archived || !!previous.hidden !== !!state.hidden ||
      before?.createdAt !== after?.createdAt ||
      Number(after?.coverRevision ?? 0) < Number(before?.coverRevision ?? 0) ||
      Number(after?.coverRevision ?? 0) === Number(before?.coverRevision ?? 0) && (after?.coverImage ?? null) !== (before?.coverImage ?? null)
    )) boundary = state.revision;
    previous = state;
  }
  return JSON.stringify(['world-cover-owner', scope.projectId, scope.eraId ?? null, row.id, row.createdAt, variant?.id ?? null, boundary]);
}

/** Chosen bytes only; reading a cover never opens, generates or flushes terrain. */
export async function getWorldCover(requested: WorldEraScope, worldId: string) {
  return db.transaction('r', db.tables, async () => {
    const { scope, row, ownerToken } = await readOwner(requested, worldId);
    return { worldId, requestedScope: scopeOf(requested), scope, ownerToken, coverImage: row.coverImage ?? null, revision: row.coverRevision ?? 0 };
  });
}

/** Change one field on its current owner, preserving unrelated edits and inherited terrain. */
export async function saveWorldCover(requested: WorldEraScope, worldId: string, image: string | null, expectedRevision: number, expectedOwnerToken: string): Promise<WorldCoverReceipt> {
  if (image !== null && (typeof image !== 'string' || !/^data:image\/[^,]+,.+/is.test(image))) throw new WorldCoverError('bad-value', 'Choose a local image data URL, or null to remove the cover.');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new WorldCoverError('bad-value', 'Read a valid cover revision before saving.');
  if (typeof expectedOwnerToken !== 'string' || !expectedOwnerToken) throw new WorldCoverError('bad-value', 'Read the cover owner token before saving.');
  return db.transaction('rw', db.tables, async () => {
    const { scope, row, ownerToken } = await readOwner(requested, worldId);
    const currentRevision = row.coverRevision ?? 0;
    if (ownerToken !== expectedOwnerToken || currentRevision !== expectedRevision) throw new WorldCoverError('conflict', 'The cover changed. Read it again before saving.');
    const beforeImage = row.coverImage ?? null, changed = beforeImage !== image;
    const receipt: WorldCoverReceipt = { projectId: requested.projectId, worldId, requestedScope: scopeOf(requested), ownerScope: scope, rootCreatedAt: row.createdAt, ownerToken, beforeImage, afterImage: image, revision: currentRevision + (changed ? 1 : 0), changed };
    if (changed) {
      await worldgenScopeOperations(scope).worlds.update(worldId, { coverImage: image ?? undefined, coverRevision: receipt.revision, updatedAt: Date.now() });
      announceEraChange(requested.projectId);
    }
    return receipt;
  });
}

/** Restore only this still-current cover on the recorded owner, never a whole map. */
export async function revertWorldCover(requested: WorldEraScope, worldId: string, receipt: WorldCoverReceipt): Promise<{ reverted: string[]; kept: string[] }> {
  if (receipt.projectId !== requested.projectId || receipt.worldId !== worldId || receipt.ownerScope.projectId !== requested.projectId) throw new WorldCoverError('conflict', 'The cover receipt belongs to another map.');
  return db.transaction('rw', db.tables, async () => {
    let owner: Awaited<ReturnType<typeof readOwner>>;
    try { owner = await readOwner(receipt.ownerScope, worldId); }
    catch (error) {
      if (error instanceof WorldCoverError) throw new WorldCoverError('conflict', 'The recorded map owner is no longer available.');
      throw error;
    }
    if (!sameScope(owner.scope, receipt.ownerScope) || owner.row.createdAt !== receipt.rootCreatedAt || owner.ownerToken !== receipt.ownerToken) throw new WorldCoverError('conflict', 'The recorded map owner changed; its current content is preserved.');
    if ((owner.row.coverRevision ?? 0) !== receipt.revision || (owner.row.coverImage ?? null) !== receipt.afterImage) throw new WorldCoverError('conflict', 'A newer cover is preserved.');
    if (!receipt.changed) return { reverted: [], kept: [] };
    await worldgenScopeOperations(receipt.ownerScope).worlds.update(worldId, { coverImage: receipt.beforeImage ?? undefined, coverRevision: (owner.row.coverRevision ?? 0) + 1, updatedAt: Date.now() });
    announceEraChange(requested.projectId);
    return { reverted: ['coverImage'], kept: [] };
  });
}
