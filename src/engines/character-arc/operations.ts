import { db } from '@/db';
import { makeTableOps, reorderItems, makeCascadeDeleteOp, deleteEntityAnnotations } from '@/engines/_shared';
import type { CharacterArc, ArcBeat } from './types';
import { ARC_STAGE_CONFIG } from './types';

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

export interface SceneArcBeat {
  beat: ArcBeat;
  arcTitle: string;
  arcColor?: string;
}

/**
 * The arc beats an author placed in one scene, with their arc — what the scene
 * editor shows so the link reads both ways. `linkedSceneId` is not indexed, so
 * narrow by the indexed `projectId` first and filter in memory; a beat whose
 * arc is gone is an orphan nobody can open, so it is left out.
 */
export async function getArcBeatsForScene(projectId: string, sceneId: string): Promise<SceneArcBeat[]> {
  const beats = await db.arcBeats
    .where('projectId')
    .equals(projectId)
    .filter((beat) => beat.linkedSceneId === sceneId)
    .toArray();
  if (beats.length === 0) return [];
  const arcIds = [...new Set(beats.map((beat) => beat.arcId))];
  const arcs = new Map(
    (await db.characterArcs.bulkGet(arcIds))
      .filter((arc): arc is CharacterArc => Boolean(arc))
      .map((arc) => [arc.id, arc]),
  );
  return beats
    .filter((beat) => arcs.has(beat.arcId))
    .map((beat) => ({ beat, arcTitle: arcs.get(beat.arcId)!.title, arcColor: arcs.get(beat.arcId)!.color }))
    // Arc by arc, and inside an arc in the order its editor shows: stage, then position.
    .sort((a, b) =>
      a.arcTitle.localeCompare(b.arcTitle)
      || a.beat.arcId.localeCompare(b.beat.arcId)
      || (ARC_STAGE_CONFIG[a.beat.stage]?.order ?? 0) - (ARC_STAGE_CONFIG[b.beat.stage]?.order ?? 0)
      || a.beat.order - b.beat.order);
}
