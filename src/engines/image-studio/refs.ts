// ============================================================================
// Visual references — the store, and the actions that make one accumulate
// ============================================================================
//
// The rows live in `visualRefs`; the pictures they point at live in
// `inspirationImages`, where Gallery already owns them. That split is the
// reason a reference stays cheap: twenty-five curated images of a character
// add twenty-five ids here, not twenty-five megabytes.
//
// Every action below is one click in the composer — pin this seed, make this
// the canonical portrait, add this to the reference set — and each one is the
// difference between a picture the writer liked and a picture the writer can
// use again.

import { db } from '@/db';
import type { InspirationImage } from '@/types';
import type { PromptDialect, VisualRef, VisualRefKind } from '@/types/visualRef';
import { emptyVisualRef } from '@/types/visualRef';
import { generateId } from '@/utils/idGenerator';

export async function listVisualRefs(projectId: string): Promise<VisualRef[]> {
  const rows = await db.visualRefs.where('projectId').equals(projectId).toArray();
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getVisualRef(id: string): Promise<VisualRef | undefined> {
  return db.visualRefs.get(id);
}

export async function createVisualRef(
  projectId: string,
  name: string,
  kind: VisualRefKind = 'character',
  dialect: PromptDialect = 'prose',
  codexEntryId?: string,
): Promise<VisualRef> {
  const row = emptyVisualRef(generateId('vref'), projectId, name.trim(), Date.now(), kind, dialect);
  if (codexEntryId) row.codexEntryId = codexEntryId;
  await db.visualRefs.add(row);
  return row;
}

export async function updateVisualRef(id: string, changes: Partial<VisualRef>): Promise<void> {
  await db.visualRefs.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteVisualRef(id: string): Promise<void> {
  // The Gallery rows this pointed at are NOT deleted: they are the writer's
  // pictures, and they were in the Gallery before any reference named them.
  await db.visualRefs.delete(id);
}

/** The Gallery rows a reference points at, in the order the reference lists them. */
export async function loadRefImages(ref: VisualRef): Promise<InspirationImage[]> {
  const ids = [
    ...ref.referenceImageIds,
    ...(ref.sheetImageIds ?? []),
    ...(ref.controlImageIds ?? []),
    ...(ref.canonicalImageId ? [ref.canonicalImageId] : []),
  ];
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const rows = await db.inspirationImages.bulkGet(unique);
  const byId = new Map(rows.filter((row): row is InspirationImage => Boolean(row)).map((row) => [row.id, row]));
  return unique.map((id) => byId.get(id)).filter((row): row is InspirationImage => Boolean(row));
}

/** One image id, added to a list on the reference without duplicating it. */
async function addTo(
  refId: string,
  field: 'referenceImageIds' | 'sheetImageIds' | 'controlImageIds',
  imageId: string,
): Promise<void> {
  const ref = await db.visualRefs.get(refId);
  if (!ref) return;
  const current = ref[field] ?? [];
  if (current.includes(imageId)) return;
  await updateVisualRef(refId, { [field]: [...current, imageId] } as Partial<VisualRef>);
}

async function removeFrom(
  refId: string,
  field: 'referenceImageIds' | 'sheetImageIds' | 'controlImageIds',
  imageId: string,
): Promise<void> {
  const ref = await db.visualRefs.get(refId);
  if (!ref) return;
  const current = ref[field] ?? [];
  if (!current.includes(imageId)) return;
  const next = current.filter((id) => id !== imageId);
  const changes: Partial<VisualRef> = { [field]: next } as Partial<VisualRef>;
  // A canonical portrait that is no longer in the reference set would still be
  // sent to every edit model: the culling action has to cull it everywhere.
  if (field === 'referenceImageIds' && ref.canonicalImageId === imageId) changes.canonicalImageId = undefined;
  await updateVisualRef(refId, changes);
}

/** The culling action: one click turns a good generation into training data. */
export function addToReferenceSet(refId: string, imageId: string): Promise<void> {
  return addTo(refId, 'referenceImageIds', imageId);
}

export function removeFromReferenceSet(refId: string, imageId: string): Promise<void> {
  return removeFrom(refId, 'referenceImageIds', imageId);
}

export function addSheetImage(refId: string, imageId: string): Promise<void> {
  return addTo(refId, 'sheetImageIds', imageId);
}

/** The pose bank: a picture kept because of how the body is arranged in it. */
export function addControlImage(refId: string, imageId: string): Promise<void> {
  return addTo(refId, 'controlImageIds', imageId);
}

export function removeControlImage(refId: string, imageId: string): Promise<void> {
  return removeFrom(refId, 'controlImageIds', imageId);
}

/** "This is her." Also adds the image to the reference set if it was not in it. */
export async function setCanonicalImage(refId: string, imageId: string): Promise<void> {
  const ref = await db.visualRefs.get(refId);
  if (!ref) return;
  const referenceImageIds = ref.referenceImageIds.includes(imageId)
    ? ref.referenceImageIds
    : [...ref.referenceImageIds, imageId];
  await updateVisualRef(refId, { canonicalImageId: imageId, referenceImageIds });
}

/** Pin the seed that produced her best likeness. */
export function pinHeroSeed(refId: string, seed: number): Promise<void> {
  return updateVisualRef(refId, { heroSeed: seed });
}

export function clearHeroSeed(refId: string): Promise<void> {
  return updateVisualRef(refId, { heroSeed: undefined });
}
