// ============================================
// Annotations — CRUD operations
// ============================================
//
// Two tables, two cursor-styled op sets. `deleteAnnotation` cascades to the
// reference row (1 reference per annotation in v1 so cascade is trivial).

import { db } from '@/db';
import { makeTableOps, makeCascadeDeleteOp } from '@/engines/_shared';
import { getAnchorAdapter, resolveTextRangeAnchor } from '@/engines/_shared/anchoring';
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

export interface ReanchorSummary {
  /** Anchors whose offsets were corrected against the current text. */
  moved: number;
  /** Anchors that could not be found and are now flagged in the margin. */
  orphaned: number;
  /** Previously-orphaned anchors whose text reappeared. */
  recovered: number;
}

/**
 * Re-resolve every text-range anchor on an entity against its current text.
 *
 * This is the step that was missing. `resolveTextRangeAnchor` — a full
 * five-stage fuzzy cascade — plus `updateAnchor`, `markOrphaned` and the three
 * engine `getEntityText` implementations were all written and **had no
 * caller**. The consequence was silent and permanent: rewrite a paragraph and
 * every margin note above it kept its old character offsets, so notes drifted
 * onto unrelated sentences, `isOrphaned` never became true, and the orphan
 * badge on the annotations tab read 0 forever.
 *
 * Runs on entity open (see `useAnnotationsForEntity`), which is the moment the
 * text is known and the notes are about to be shown. Cheap: one text fetch,
 * then pure string matching per note. Entity-level anchors are skipped
 * outright, as are engines that don't implement `getEntityText`.
 */
export async function reanchorEntityAnnotations(
  engineId: string,
  entityId: string,
): Promise<ReanchorSummary> {
  const summary: ReanchorSummary = { moved: 0, orphaned: 0, recovered: 0 };

  const adapter = getAnchorAdapter(engineId);
  if (!adapter?.supportsTextRange || !adapter.getEntityText) return summary;

  const rows = await getAnnotationsForEntity(engineId, entityId);
  const textRanged = rows.filter((a) => a.anchor.type === 'text_range');
  if (textRanged.length === 0) return summary;

  const bodyText = await adapter.getEntityText(entityId);
  // A null body means "couldn't read it", not "the text is gone" — flagging
  // every note as orphaned because a fetch failed would be worse than leaving
  // them alone.
  if (bodyText === null || bodyText === undefined) return summary;

  for (const annotation of textRanged) {
    const resolution = resolveTextRangeAnchor(annotation.anchor, bodyText);

    if (!resolution.ok) {
      if (!annotation.isOrphaned) {
        await markOrphaned(annotation.id, true);
        summary.orphaned += 1;
      }
      continue;
    }

    const { start, end } = resolution.anchor;
    const drifted = annotation.anchor.start !== start || annotation.anchor.end !== end;
    if (drifted) {
      await updateAnchor(annotation.id, start, end);
      summary.moved += 1;
    } else if (annotation.isOrphaned) {
      await markOrphaned(annotation.id, false);
      summary.recovered += 1;
    }
  }

  return summary;
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
