import { db } from '@/db';
import { makeTableOps, reorderItems, makeCascadeDeleteOp } from '@/engines/_shared';
import type { Outline, OutlineBeat } from './types';

// ===== Outlines =====
const outlineOps = makeTableOps<Outline>({
  tableName: 'outlines',
  scopeField: 'projectId',
});

export const getOutlines = outlineOps.getAll;
export const getOutline = outlineOps.getOne;
export const createOutline = outlineOps.create;
export const updateOutline = outlineOps.update;

// deleteOutline cascades to outlineBeats
export const deleteOutline = makeCascadeDeleteOp({
  tableName: 'outlines',
  cascades: [{ table: 'outlineBeats', foreignKey: 'outlineId' }],
});

// ===== Outline Beats =====
const beatOps = makeTableOps<OutlineBeat>({
  tableName: 'outlineBeats',
  scopeField: 'outlineId',
  sortFn: (a, b) => a.order - b.order,
});

export const getBeats = beatOps.getAll;
export const getBeat = beatOps.getOne;
export const createBeat = beatOps.create;
export const updateBeat = beatOps.update;

/**
 * Delete a beat, re-parenting its children onto the deleted beat's own parent.
 *
 * The plain `beatOps.delete` used to leave children with a `parentId` pointing
 * at a row that no longer existed. `BeatList` only renders beats reachable from
 * the top level (`!b.parentId`) downwards, so those children vanished from the
 * UI permanently while still occupying the table — a mis-click on an act
 * silently swallowed every chapter under it. Re-parenting keeps the tree
 * connected: deleting a beat costs exactly that beat.
 */
export async function deleteBeat(id: string): Promise<void> {
  await db.transaction('rw', db.outlineBeats, async () => {
    const beat = await db.outlineBeats.get(id);
    if (!beat) return;
    const children = await db.outlineBeats.where('parentId').equals(id).toArray();
    if (children.length > 0) {
      const now = Date.now();
      await db.outlineBeats.bulkPut(
        children.map((child) => ({ ...child, parentId: beat.parentId, updatedAt: now })),
      );
    }
    await db.outlineBeats.delete(id);
  });
}

/** Every beat in a project, across all its outlines — for cross-engine pickers. */
export async function getAllProjectBeats(projectId: string): Promise<OutlineBeat[]> {
  const rows = await db.outlineBeats.where('projectId').equals(projectId).toArray();
  return rows.sort((a, b) => a.order - b.order);
}

/**
 * Beat count per outline for the whole project, so the outline cards can show
 * their own totals. The dashboard used to count the *active* outline's beats
 * for every card, which meant every inactive outline read "0 beats".
 */
export async function getBeatCountsByOutline(projectId: string): Promise<Record<string, number>> {
  const rows = await db.outlineBeats.where('projectId').equals(projectId).toArray();
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.outlineId] = (counts[row.outlineId] ?? 0) + 1;
  return counts;
}

export async function reorderBeats(outlineId: string, orderedIds: string[]): Promise<void> {
  await reorderItems('outlineBeats', 'outlineId', outlineId, orderedIds);
}
