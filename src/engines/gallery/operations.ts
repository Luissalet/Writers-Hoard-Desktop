import { db } from '@/db';
import { makeTableOps } from '@/engines/_shared';
import type { InspirationImage, ImageCollection } from '@/types';

export const imageCollectionOps = makeTableOps<ImageCollection>({
  tableName: 'imageCollections',
  scopeField: 'projectId',
});

export const inspirationImageOps = makeTableOps<InspirationImage>({
  tableName: 'inspirationImages',
  scopeField: 'projectId',
});

/**
 * Deleting an album keeps its images — they are the irreplaceable part — but
 * unfiles them, in one transaction. An image left pointing at a gone album
 * belongs to no folder the backup writes, so it has to be unlinked here rather
 * than by whichever view happened to ask for the delete.
 */
export async function deleteImageCollection(id: string): Promise<void> {
  await db.transaction('rw', [db.imageCollections, db.inspirationImages], async () => {
    await db.inspirationImages
      .where('collectionId')
      .equals(id)
      .modify((image) => { delete image.collectionId; });
    await db.imageCollections.delete(id);
  });
}
