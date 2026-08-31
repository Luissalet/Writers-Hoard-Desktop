import { db } from '@/db';
import { makeTableOps } from '@/engines/_shared';
import type { AtlasDivergence, AtlasPlace } from './types';

export const atlasPlaceOps = makeTableOps<AtlasPlace>({
  tableName: 'atlasPlaces',
  scopeField: 'projectId',
  sortFn: (a, b) => a.name.localeCompare(b.name, 'es'),
});

export const atlasDivergenceOps = makeTableOps<AtlasDivergence>({
  tableName: 'atlasDivergences',
  scopeField: 'projectId',
  sortFn: (a, b) => b.updatedAt - a.updatedAt,
});

/**
 * Deleting a place keeps its divergences — a departure from reality is a
 * fact about the book, not about the row — but unanchors them, and lifts any
 * child place to the top level. Nothing else points at a place by id.
 */
export async function deleteAtlasPlace(id: string): Promise<void> {
  await db.transaction('rw', [db.atlasPlaces, db.atlasDivergences], async () => {
    await db.atlasDivergences.where('placeId').equals(id).modify((row) => { delete row.placeId; });
    await db.atlasPlaces.where('parentId').equals(id).modify((row) => { delete row.parentId; });
    await db.atlasPlaces.delete(id);
  });
}
