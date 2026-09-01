import { db } from '@/db';

/**
 * Delete every margin annotation anchored on an entity, together with the
 * reference rows that hang off them — the same cascade `deleteAnnotation`
 * performs, resolved through the `[sourceEngineId+sourceEntityId]` index so an
 * engine can clean up after a deleted entity.
 *
 * Call it from inside the caller's own delete transaction; that transaction
 * must already list `annotations` and `annotationReferences`.
 */
export async function deleteEntityAnnotations(
  sourceEngineId: string,
  sourceEntityId: string,
): Promise<void> {
  const annotationIds = await db.annotations
    .where('[sourceEngineId+sourceEntityId]')
    .equals([sourceEngineId, sourceEntityId])
    .primaryKeys();
  if (!annotationIds.length) return;

  await db.annotationReferences
    .where('annotationId')
    .anyOf(annotationIds as string[])
    .delete();
  await db.annotations.bulkDelete(annotationIds as string[]);
}
