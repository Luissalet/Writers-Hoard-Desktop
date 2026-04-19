// ============================================
// Annotations — CRUD operations
// ============================================
//
// Two tables, two cursor-styled op sets. `deleteAnnotation` cascades to the
// reference row (1 reference per annotation in v1 so cascade is trivial).

import { db } from '@/db';
import { makeTableOps, makeCascadeDeleteOp } from '@/engines/_shared';
import type { Annotation, AnnotationReference } from './types';

// ===== Annotations =========================================================

const annotationOps = makeTableOps<Annotation>({
  tableName: 'annotations',
  scopeField: 'projectId',
  sortFn: (a, b) => a.position - b.position || a.createdAt - b.createdAt,
});

export const getAnnotation = annotationOps.getOne;
export const updateAnnotation = annotationOps.update;
export const getAnnotationsForProject = annotationOps.getAll;

export async function createAnnotation(item: Annotation): Promise<string> {
  return annotationOps.create(item);
}

/** Cascade-delete: also removes the reference row (if any). */
export const deleteAnnotation = makeCascadeDeleteOp({
  tableName: 'annotations',
  cascades: [{ table: 'annotationReferences', foreignKey: 'annotationId' }],
});

/**
 * All annotations attached to a specific entity, ordered by position
 * (vertical stacking order in the margin panel).
 */
export async function getAnnotationsForEntity(
  sourceEngineId: string,
  sourceEntityId: string,
): Promise<Annotation[]> {
  const rows = await db.annotations
    .where('[sourceEngineId+sourceEntityId]')
    .equals([sourceEngineId, sourceEntityId])
    .toArray();
  return rows.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

/** Mark an annotation as orphaned (e.g. after a failed reanchor). */
export async function markOrphaned(id: string, orphaned: boolean): Promise<void> {
  await db.annotations.update(id, { isOrphaned: orphaned, updatedAt: Date.now() });
}

/** Relocate a text-range anchor after fuzzy match succeeds. */
export async function updateAnchor(
  id: string,
  start: number,
  end: number,
): Promise<void> {
  const existing = await db.annotations.get(id);
  if (!existing) return;
  await db.annotations.update(id, {
    anchor: { ...existing.anchor, start, end },
    isOrphaned: false,
    updatedAt: Date.now(),
  });
}

// ===== Annotation References ==============================================

const referenceOps = makeTableOps<AnnotationReference>({
  tableName: 'annotationReferences',
  scopeField: 'annotationId',
});

export const getReference = referenceOps.getOne;
export const createReference = referenceOps.create;
export const deleteReference = referenceOps.delete;

/** Lookup the reference for a given annotation (1:1 in v1). */
export async function getReferenceForAnnotation(
  annotationId: string,
): Promise<AnnotationReference | undefined> {
  const rows = await db.annotationReferences.where('annotationId').equals(annotationId).toArray();
  return rows[0];
}

/**
 * All annotations that *target* a given entity — the reverse direction of
 * `getAnnotationsForEntity`. Powers the `useEntityBacklinks` hook.
 */
export async function getBacklinksForEntity(
  targetEngineId: string,
  targetEntityId: string,
): Promise<Array<{ annotation: Annotation; reference: AnnotationReference }>> {
  const refs = await db.annotationReferences
    .where('[targetEngineId+targetEntityId]')
    .equals([targetEngineId, targetEntityId])
    .toArray();
  if (refs.length === 0) return [];
  const annotationIds = refs.map(r => r.annotationId);
  const annotations = await db.annotations.bulkGet(annotationIds);
  const pairs: Array<{ annotation: Annotation; reference: AnnotationReference }> = [];
  for (let i = 0; i < refs.length; i++) {
    const ann = annotations[i];
    if (ann) pairs.push({ annotation: ann, reference: refs[i] });
  }
  return pairs;
}

/** Count of annotations the user still needs to reanchor, project-wide. */
export async function countOrphansForProject(projectId: string): Promise<number> {
  return db.annotations
    .where('projectId').equals(projectId)
    .and(a => a.isOrphaned === true)
    .count();
}
