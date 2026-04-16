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
export const deleteBeat = beatOps.delete;

export async function reorderBeats(outlineId: string, orderedIds: string[]): Promise<void> {
  await reorderItems('outlineBeats', 'outlineId', outlineId, orderedIds);
}
