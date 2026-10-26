import { db } from '@/db';
import Dexie from 'dexie';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { worldgenScopeOperations, worldRuntimeKey } from './era';
import { worldSettingsScope } from './settingsScope';
import { flushWorldEdits, hasPendingWorldEdits } from './editWriter';
import { isSheet, resolveWorldScale } from './core/geoScale';
import type { GeneratedWorld } from './types';

type Scope = { projectId: string; eraId?: string };
export class WorldScaleError extends Error {
  readonly code: 'bad-value' | 'not-found' | 'conflict';
  constructor(code: 'bad-value' | 'not-found' | 'conflict', message: string) { super(message); this.code = code; }
}
export interface WorldScaleReceipt {
  projectId: string; worldId: string; scope: Scope; recipe: string;
  beforeOverride: number | null; afterOverride: number | null; revision: number; changed: boolean;
}
const recipe = (row: GeneratedWorld) => JSON.stringify(row.params);
async function read(scope: Scope, id: string): Promise<GeneratedWorld> {
  const row = await worldgenScopeOperations(scope).worlds.getOne(id);
  if (!row || row.projectId !== scope.projectId) throw new WorldScaleError('not-found', 'World no longer belongs to this project.');
  return row;
}
export async function getWorldScale(requested: Scope, id: string) {
  return db.transaction('r', db.tables, async () => {
    const scope = await worldSettingsScope(requested, id), row = await read(scope, id);
    return { worldId: id, ...resolveWorldScale(row), scope, requestedScope: requested, sheet: isSheet(row.params) };
  });
}
function validate(row: GeneratedWorld, widthKm: number | null) {
  if (!isSheet(row.params)) throw new WorldScaleError('bad-value', 'Only an existing sheet can be calibrated.');
  const metric = resolveWorldScale({ ...row, mapWidthKm: widthKm ?? undefined });
  if (widthKm !== null && (typeof widthKm !== 'number' || !Number.isFinite(widthKm) || widthKm <= 0)
    || ![metric.widthKm, metric.heightKm, metric.cellKm, metric.widthKm * metric.heightKm].every(value => Number.isFinite(value) && value > 0)) throw new WorldScaleError('bad-value', 'The width, height, cell size and area must be positive finite representable numbers.');
}
async function drain(requested: Scope, id: string) {
  const owner = await worldSettingsScope(requested, id), keys = new Set([worldRuntimeKey(id, requested.eraId), worldRuntimeKey(id, owner.eraId)]);
  for (const key of keys) for (const writer of [key, `regions:${key}`]) if (!await flushWorldEdits(writer)) throw new WorldScaleError('conflict', 'Pending map edits could not be saved.');
  return keys;
}
const busy = (keys: Set<string>) => [...keys].some(key => hasPendingWorldEdits(key) || hasPendingWorldEdits(`regions:${key}`));
export async function saveWorldScale(requested: Scope, id: string, widthKm: number | null, expectedRevision: number): Promise<WorldScaleReceipt> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new WorldScaleError('bad-value', 'Read a valid scale revision before applying.');
  // This writer owns its transaction; do not publish a receipt from an outer transaction that may abort.
  if (Dexie.currentTransaction) throw new WorldScaleError('conflict', 'Apply scale outside a pending database transaction.');
  const initial = await read(requested, id), expectedRecipe = recipe(initial); validate(initial, widthKm);
  for (let attempt = 0; attempt < 8; attempt++) {
    const keys = await drain(requested, id);
    const result = await db.transaction('rw', db.tables, async () => {
      const scope = await worldSettingsScope(requested, id), row = await read(scope, id);
      keys.add(worldRuntimeKey(id, scope.eraId)); if (busy(keys)) return null;
      if (recipe(row) !== expectedRecipe || (row.scaleRevision ?? 0) !== expectedRevision) throw new WorldScaleError('conflict', 'The map recipe or scale changed. Read it again before applying.');
      validate(row, widthKm);
      const beforeOverride = row.mapWidthKm ?? null, changed = beforeOverride !== widthKm;
      const receipt: WorldScaleReceipt = { projectId: requested.projectId, worldId: id, scope, recipe: expectedRecipe, beforeOverride, afterOverride: widthKm, revision: expectedRevision + (changed ? 1 : 0), changed };
      if (changed) await worldgenScopeOperations(scope).worlds.update(id, { mapWidthKm: widthKm ?? undefined, scaleRevision: receipt.revision, updatedAt: Date.now() });
      return receipt;
    });
    if (!result) continue;
    if (result.changed) notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: id, projectId: requested.projectId });
    return result;
  }
  throw new WorldScaleError('conflict', 'Map edits are still being saved. Try again.');
}
export async function revertWorldScale(requested: Scope, id: string, receipt: WorldScaleReceipt) {
  if (receipt.projectId !== requested.projectId || receipt.worldId !== id || receipt.scope.projectId !== requested.projectId) throw new WorldScaleError('conflict', 'Scale receipt belongs to another map.');
  if (Dexie.currentTransaction) throw new WorldScaleError('conflict', 'Undo scale outside a pending database transaction.');
  const keys = await drain(receipt.scope, id);
  const result = await db.transaction('rw', db.tables, async () => {
    const owner = await worldSettingsScope(receipt.scope, id);
    if (owner.eraId !== receipt.scope.eraId) throw new WorldScaleError('conflict', 'The era that owns this scale no longer exists.');
    const row = await read(receipt.scope, id);
    if (busy(keys) || recipe(row) !== receipt.recipe || (row.scaleRevision ?? 0) !== receipt.revision || (row.mapWidthKm ?? null) !== receipt.afterOverride) throw new WorldScaleError('conflict', 'A newer scale or map recipe is preserved.');
    if (!receipt.changed) return { reverted: [], kept: [] };
    await worldgenScopeOperations(receipt.scope).worlds.update(id, { mapWidthKm: receipt.beforeOverride ?? undefined, scaleRevision: receipt.revision + 1, updatedAt: Date.now() });
    return { reverted: ['mapWidthKm'], kept: [] };
  });
  if (result.reverted.length) notifyDataChanged({ source: 'undo', table: 'generatedWorlds', entityId: id, projectId: requested.projectId });
  return result;
}
