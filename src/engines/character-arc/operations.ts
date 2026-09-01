import { db } from '@/db';
import { makeTableOps, reorderItems, makeCascadeDeleteOp, deleteEntityAnnotations } from '@/engines/_shared';
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
const deleteArcRow = makeCascadeDeleteOp({
  tableName: 'characterArcs',
  cascades: [{ table: 'arcBeats', foreignKey: 'arcId' }],
});

// ...and to the margin notes anchored on the arc, which are pure link.
export async function deleteArc(id: string): Promise<void> {
  await db.transaction(
    'rw',
    ['characterArcs', 'arcBeats', 'annotations', 'annotationReferences'],
    async () => {
      await deleteEntityAnnotations('character-arc', id);
      await deleteArcRow(id);
    },
  );
}

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
