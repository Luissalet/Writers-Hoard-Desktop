import { makeTableOps, reorderItems, makeCascadeDeleteOp } from '@/engines/_shared';
import type { CharacterArc, ArcBeat } from './types';

// ===== Character Arcs =====
const arcOps = makeTableOps<CharacterArc>({
  tableName: 'characterArcs',
  scopeField: 'projectId',
  sortFn: (a, b) => b.updatedAt - a.updatedAt,
});

export const getArcs = arcOps.getAll;
export const getArc = arcOps.getOne;
export const createArc = arcOps.create;
export const updateArc = arcOps.update;

// deleteArc cascades to arcBeats
export const deleteArc = makeCascadeDeleteOp({
  tableName: 'characterArcs',
  cascades: [{ table: 'arcBeats', foreignKey: 'arcId' }],
});

// ===== Arc Beats =====
const beatOps = makeTableOps<ArcBeat>({
  tableName: 'arcBeats',
  scopeField: 'arcId',
  sortFn: (a, b) => a.order - b.order,
});

export const getBeats = beatOps.getAll;
export const getBeat = beatOps.getOne;
export const createBeat = beatOps.create;
export const updateBeat = beatOps.update;
export const deleteBeat = beatOps.delete;

export async function reorderBeats(arcId: string, orderedIds: string[]): Promise<void> {
  await reorderItems('arcBeats', 'arcId', arcId, orderedIds);
}
