// ============================================
// Scrapper Engine — Database Operations
// ============================================

import { makeTableOps } from '@/engines/_shared';
import { db } from '@/db';
import type { Snapshot } from './types';

const ops = makeTableOps<Snapshot>({
  tableName: 'snapshots',
  scopeField: 'projectId',
  sortFn: (a, b) => b.createdAt - a.createdAt,
});

export const getSnapshots = ops.getAll;
export const getSnapshot = ops.getOne;
export const createSnapshot = ops.create;
export const deleteSnapshot = ops.delete;

// Snapshot has no updatedAt field — update without timestamp stamping
export async function updateSnapshot(id: string, changes: Partial<Snapshot>): Promise<void> {
  await db.table('snapshots').update(id, changes);
}

export async function searchSnapshots(projectId: string, query: string): Promise<Snapshot[]> {
  const snapshots = (await db.table('snapshots')
    .where('projectId')
    .equals(projectId)
    .toArray()) as Snapshot[];

  const q = query.toLowerCase();
  return snapshots.filter(
    s =>
      s.title.toLowerCase().includes(q) ||
      s.url.toLowerCase().includes(q) ||
      s.notes.toLowerCase().includes(q) ||
      (s.extractedText && s.extractedText.toLowerCase().includes(q)),
  );
}
