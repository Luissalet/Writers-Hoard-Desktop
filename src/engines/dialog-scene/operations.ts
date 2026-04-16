import { makeTableOps, reorderItems, makeCascadeDeleteOp } from '@/engines/_shared';
import { db } from '@/db';
import type { Scene, DialogBlock, SceneCast } from './types';
import type { OutlineBeat } from '@/engines/outline/types';

// ===== Scenes =====
const sceneOps = makeTableOps<Scene>({
  tableName: 'scenes',
  scopeField: 'projectId',
  sortFn: (a, b) => a.order - b.order,
});

export const getScenes = sceneOps.getAll;
export const getScene = sceneOps.getOne;
export const createScene = sceneOps.create;
export const updateScene = sceneOps.update;

// deleteScene cascades to blocks and cast
export const deleteScene = makeCascadeDeleteOp({
  tableName: 'scenes',
  cascades: [
    { table: 'dialogBlocks', foreignKey: 'sceneId' },
    { table: 'sceneCasts', foreignKey: 'sceneId' },
  ],
});

export async function reorderScenes(projectId: string, orderedIds: string[]): Promise<void> {
  await reorderItems('scenes', 'projectId', projectId, orderedIds);
}

/** Auto-number all non-locked scenes. Omitted scenes keep their number but are prefixed visually. */
export async function autoNumberScenes(projectId: string): Promise<void> {
  const scenes = await getScenes(projectId);
  let nextNumber = 1;
  for (const scene of scenes) {
    if (scene.isLocked) {
      // locked scenes keep their number; advance counter past them
      if (scene.sceneNumber && scene.sceneNumber >= nextNumber) {
        nextNumber = scene.sceneNumber + 1;
      }
      continue;
    }
    await updateScene(scene.id, { sceneNumber: nextNumber });
    nextNumber++;
  }
}

// ===== Dialog Blocks =====
const blockOps = makeTableOps<DialogBlock>({
  tableName: 'dialogBlocks',
  scopeField: 'sceneId',
  sortFn: (a, b) => a.order - b.order,
});

export const getDialogBlocks = blockOps.getAll;
export const createDialogBlock = blockOps.create;
export const updateDialogBlock = blockOps.update;
export const deleteDialogBlock = blockOps.delete;

export async function reorderDialogBlocks(sceneId: string, orderedIds: string[]): Promise<void> {
  await reorderItems('dialogBlocks', 'sceneId', sceneId, orderedIds);
}

// ===== Scene Cast (non-standard CRUD — kept manual) =====
export async function getSceneCast(sceneId: string): Promise<SceneCast[]> {
  return db.table('sceneCasts').where('sceneId').equals(sceneId).toArray();
}

export async function addCastMember(cast: SceneCast): Promise<string> {
  return (await db.table('sceneCasts').add(cast)) as string;
}

export async function removeCastMember(id: string): Promise<void> {
  await db.table('sceneCasts').delete(id);
}

export async function updateCastMember(id: string, changes: Partial<SceneCast>): Promise<void> {
  await db.table('sceneCasts').update(id, changes);
}

// ===== Cross-engine queries =====

/** Find all outline beats linked to a specific scene */
export async function getLinkedBeats(sceneId: string): Promise<OutlineBeat[]> {
  return db.table('outlineBeats')
    .filter((beat: OutlineBeat) => beat.linkedSceneId === sceneId)
    .toArray();
}
