import Dexie, { type Transaction } from 'dexie';
import { db } from '@/db';
import { announceEraChange, readWorldDocument, resetEraDocument, saveEraDocument } from '@/services/worldEras/store';
import { WorldEraConflict, type EraDocumentRead, type WorldEraScope } from '@/services/worldEras/types';
import { modelAnimationNames, type ModelAsset } from './portable';
import { animationPresentationRows, changeAnimationPresentation, type AnimationPresentation, type AnimationPresentationAction } from './animationPresentation';

interface Receipt {
  scope: WorldEraScope; modelId: string; beforePresent: boolean; before?: AnimationPresentation;
  provenance: EraDocumentRead['provenance']; afterVersion: string; claimed?: Transaction;
}
const receipts = new Map<string, Receipt>();
const outer = (transaction: Transaction): Transaction => transaction.parent ? outer(transaction.parent) : transaction;
const asset = (read: EraDocumentRead) => read.document.root as unknown as ModelAsset;
function inventory(scope: WorldEraScope, modelId: string, read: EraDocumentRead) {
  const model = asset(read);
  return { ...scope, modelId, version: read.version, ...animationPresentationRows(modelAnimationNames(model), model.animationPresentation) };
}
export async function readModelAnimationPresentation(scope: WorldEraScope, modelId: string) {
  const read = await readWorldDocument(scope, 'model-viewer', modelId);
  if (!read) throw Error('model_animation_missing');
  return inventory(scope, modelId, read);
}
async function write(scope: WorldEraScope, read: EraDocumentRead, presentation: AnimationPresentation | undefined, present = presentation !== undefined) {
  const next = { ...read.document.root };
  if (present) next.animationPresentation = presentation; else delete next.animationPresentation;
  if (scope.eraId) await saveEraDocument(scope, 'model-viewer', { ...read.document, root: next }, read.version);
  else {
    const project = await db.projects.get(scope.projectId);
    if (!project) throw Error('model_animation_missing');
    await db.projects.update(scope.projectId, {
      modelAssets: (project.modelAssets ?? []).map(model => model.id === next.id ? next as unknown as ModelAsset : model),
      updatedAt: Math.max(Date.now(), project.updatedAt + 1),
    });
    announceEraChange(scope.projectId, true);
  }
}

export async function editModelAnimationPresentation(scope: WorldEraScope, modelId: string, change: AnimationPresentationAction, expectedVersion: string, committed?: (result: ModelAnimationResult) => void): Promise<ModelAnimationResult> {
  return db.transaction('rw', db.tables, async transaction => {
    const before = await readWorldDocument(scope, 'model-viewer', modelId);
    if (!before) throw Error('model_animation_missing');
    if (before.version !== expectedVersion) throw new WorldEraConflict();
    const model = asset(before), next = changeAnimationPresentation(modelAnimationNames(model), model.animationPresentation, change);
    if (next === model.animationPresentation) return inventory(scope, modelId, before);
    await write(scope, before, next);
    const after = (await readWorldDocument(scope, 'model-viewer', modelId))!, receiptId = crypto.randomUUID(), owner = outer(transaction);
    receipts.set(receiptId, { scope: { ...scope }, modelId, beforePresent: Object.hasOwn(model, 'animationPresentation'), before: model.animationPresentation === undefined ? undefined : structuredClone(model.animationPresentation), provenance: before.provenance, afterVersion: after.version });
    owner.on('abort', () => { receipts.delete(receiptId); });
    const result = { ...inventory(scope, modelId, after), receiptId };
    if (committed) owner.on('complete', () => Dexie.ignoreTransaction(() => committed(result)));
    return result;
  });
}
export type ModelAnimationResult = Awaited<ReturnType<typeof readModelAnimationPresentation>> & { receiptId?: string };

export async function undoModelAnimationPresentation(scope: WorldEraScope, receiptId: string): Promise<string> {
  const receipt = receipts.get(receiptId);
  if (!receipt || receipt.scope.projectId !== scope.projectId || receipt.scope.eraId !== scope.eraId) throw Error('model_animation_receipt_missing');
  await db.transaction('rw', db.tables, async transaction => {
    if (receipts.get(receiptId) !== receipt || receipt.claimed) throw Error('model_animation_receipt_missing');
    const owner = outer(transaction); receipt.claimed = owner;
    owner.on('complete', () => { receipts.delete(receiptId); });
    owner.on('abort', () => { if (receipts.get(receiptId) === receipt) receipt.claimed = undefined; });
    const current = await readWorldDocument(scope, 'model-viewer', receipt.modelId);
    if (!current || current.version !== receipt.afterVersion) throw new WorldEraConflict();
    if (scope.eraId && receipt.provenance === 'base') await resetEraDocument(scope, 'model-viewer', receipt.modelId, current.variantRevision!);
    else await write(scope, current, receipt.before === undefined ? undefined : structuredClone(receipt.before), receipt.beforePresent);
  });
  return receipt.modelId;
}
