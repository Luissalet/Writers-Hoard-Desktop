// ============================================
// Annotations — CRUD operations
// ============================================
//
// Two tables, two cursor-styled op sets. `deleteAnnotation` cascades to the
// reference row (1 reference per annotation in v1 so cascade is trivial).

import { db } from '@/db';
import { makeTableOps } from '@/engines/_shared';
import { getAnchorAdapter, resolveTextRangeAnchor } from '@/engines/_shared/anchoring';
import { AnnotationConflict, type Annotation, type AnnotationReference } from './types';
import { annotationEntity, annotationInScope, validateAnnotationMentions, validateAnnotationSource } from './scope';
import { announceEraChange } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';

// ===== Annotations =========================================================

const annotationOps = makeTableOps<Annotation>({
  tableName: 'annotations',
  scopeField: 'projectId',
  sortFn: (a, b) => a.position - b.position || a.createdAt - b.createdAt,
});

export async function getAnnotation(id:string,scope?:WorldEraScope):Promise<Annotation|undefined>{const row=await annotationOps.getOne(id);return row&&annotationInScope(row,scope)?row:undefined;}
export async function updateAnnotation(id:string,changes:Partial<Annotation>,expectedRevision?:number,scope?:WorldEraScope):Promise<void>{
 await db.transaction('rw',db.annotations,async()=>{const current=await getAnnotation(id,scope);if(!current)return;if(expectedRevision!==undefined&&(current.revision??0)!==expectedRevision)throw new AnnotationConflict();const {id:_id,projectId:_project,eraId:_era,replies:_replies,resolvedAt:_resolved,revision:_revision,...allowed}=changes;void _id;void _project;void _era;void _replies;void _resolved;void _revision;await db.annotations.update(id,{...allowed,revision:(current.revision??0)+1,updatedAt:Math.max(Date.now(),current.updatedAt+1)});});
}
export async function getAnnotationsForProject(projectId:string,eraId?:string):Promise<Annotation[]>{return(await annotationOps.getAll(projectId)).filter(row=>annotationInScope(row,{projectId,eraId}));}
export async function createAnnotation(item:Annotation,reference?:AnnotationReference):Promise<string>{
 await db.transaction('rw',db.tables,async()=>{await validateAnnotationSource(item);const scope={projectId:item.projectId,eraId:item.eraId};item={...item,revision:item.revision??0,mentions:await validateAnnotationMentions(scope,item.mentions)};if(reference){if(reference.annotationId!==item.id||!await annotationEntity(scope,reference.targetEngineId,reference.targetEntityId))throw Error('annotation_reference_invalid');await db.annotationReferences.add(reference);}await db.annotations.add(item);});announceEraChange(item.projectId);return item.id;
}
/** Legacy callers retain their cascade; scoped thread UI uses a CAS/Undo receipt. */
export async function deleteAnnotation(id:string,scope?:WorldEraScope):Promise<void>{await db.transaction('rw',db.annotations,db.annotationReferences,async()=>{if(!await getAnnotation(id,scope))return;await db.annotationReferences.where('annotationId').equals(id).delete();await db.annotations.delete(id);});}

/**
 * All annotations attached to a specific entity, ordered by position
 * (vertical stacking order in the margin panel).
 */
export async function getAnnotationsForEntity(
  sourceEngineId: string,
  sourceEntityId: string,
  scope?: WorldEraScope,
): Promise<Annotation[]> {
  const rows = await db.annotations
    .where('[sourceEngineId+sourceEntityId]')
    .equals([sourceEngineId, sourceEntityId])
    .toArray();
  return rows.filter(row=>annotationInScope(row,scope)).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

/** Mark an annotation as orphaned (e.g. after a failed reanchor). */
export async function markOrphaned(id: string, orphaned: boolean, scope?:WorldEraScope): Promise<void> {
  if(!await getAnnotation(id,scope))return;
  await db.annotations.update(id, { isOrphaned: orphaned, updatedAt: Date.now() });
}

/** Relocate a text-range anchor after fuzzy match succeeds. */
export async function updateAnchor(
  id: string,
  start: number,
  end: number,
  scope?:WorldEraScope,
): Promise<void> {
  const existing = await getAnnotation(id,scope);
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
  scope?:WorldEraScope,
): Promise<ReanchorSummary> {
  const summary: ReanchorSummary = { moved: 0, orphaned: 0, recovered: 0 };

  const adapter = getAnchorAdapter(engineId);
  if (!adapter?.supportsTextRange || !adapter.getEntityText) return summary;

  const rows = await getAnnotationsForEntity(engineId, entityId, scope);
  const textRanged = rows.filter((a) => a.anchor.type === 'text_range');
  if (textRanged.length === 0) return summary;

  const bodyText = scope ? (await annotationEntity(scope,engineId,entityId))?.text : await adapter.getEntityText(entityId);
  // A null body means "couldn't read it", not "the text is gone" — flagging
  // every note as orphaned because a fetch failed would be worse than leaving
  // them alone.
  if (bodyText === null || bodyText === undefined) return summary;

  for (const annotation of textRanged) {
    const resolution = resolveTextRangeAnchor(annotation.anchor, bodyText);

    if (!resolution.ok) {
      if (!annotation.isOrphaned) {
        await markOrphaned(annotation.id, true, scope);
        summary.orphaned += 1;
      }
      continue;
    }

    const { start, end } = resolution.anchor;
    const drifted = annotation.anchor.start !== start || annotation.anchor.end !== end;
    if (drifted) {
      await updateAnchor(annotation.id, start, end, scope);
      summary.moved += 1;
    } else if (annotation.isOrphaned) {
      await markOrphaned(annotation.id, false, scope);
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
  scope?:WorldEraScope,
): Promise<Array<{ annotation: Annotation; reference?: AnnotationReference }>> {
  const refs = await db.annotationReferences
    .where('[targetEngineId+targetEntityId]')
    .equals([targetEngineId, targetEntityId])
    .toArray();
  const annotationIds = refs.map(r => r.annotationId);
  const annotations = await db.annotations.bulkGet(annotationIds);
  const pairs: Array<{ annotation: Annotation; reference?: AnnotationReference }> = [];
  for (let i = 0; i < refs.length; i++) {
    const ann = annotations[i];
    if (ann && annotationInScope(ann,scope)) pairs.push({ annotation: ann, reference: refs[i] });
  }
  const mentionSources=scope?await getAnnotationsForProject(scope.projectId,scope.eraId):(await db.annotations.toArray()).filter(row=>annotationInScope(row));
  for(const annotation of mentionSources)if(!pairs.some(pair=>pair.annotation.id===annotation.id)&&[...annotation.mentions??[],...(annotation.replies??[]).flatMap(reply=>reply.mentions??[])].some(mention=>mention.engineId===targetEngineId&&mention.entityId===targetEntityId))pairs.push({annotation});
  return pairs;
}

/** Count of annotations the user still needs to reanchor, project-wide. */
export async function countOrphansForProject(projectId: string,eraId?:string): Promise<number> {
  return db.annotations
    .where('projectId').equals(projectId)
    .and(a => a.isOrphaned === true && annotationInScope(a,{projectId,eraId}))
    .count();
}
