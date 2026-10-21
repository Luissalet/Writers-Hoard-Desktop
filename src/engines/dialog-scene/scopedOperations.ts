import { db } from '@/db';
import type { WorldEraScope } from '@/services/worldEras/types';
import { scopedTableOps } from '@/services/worldEras/tableOps';
import { mutateEraRows } from '@/services/worldEras/store';
import * as base from './operations';
import type { Scene, DialogBlock, SceneCast } from './types';
/** Explicit context shared by native authoring, normal editors and imports. */
export function dialogSceneOperations(scope?: WorldEraScope) {
  if (!scope?.eraId) return base;
  const scenes = scopedTableOps<Scene>(scope, 'scenes', 'projectId', { getAll: base.getScenes, getOne: base.getScene, create: base.createScene, update: base.updateScene, delete: base.deleteScene });
  const blocks = scopedTableOps<DialogBlock>(scope, 'dialogBlocks', 'sceneId', { getAll: base.getDialogBlocks, getOne: id => db.dialogBlocks.get(id), create: base.createDialogBlock, update: base.updateDialogBlock, delete: base.deleteDialogBlock });
  const cast = scopedTableOps<SceneCast>(scope, 'sceneCasts', 'sceneId', { getAll: base.getSceneCast, getOne: id => db.sceneCasts.get(id), create: base.addCastMember, update: base.updateCastMember, delete: base.removeCastMember });
  const getScenes = async (projectId: string) => (await scenes.getAll(projectId)).sort((a, b) => a.order - b.order);
  const getDialogBlocks = async (sceneId: string) => (await blocks.getAll(sceneId)).sort((a, b) => a.order - b.order);
  const autoNumberScenes = async (projectId: string) => {
    let nextNumber = 1;
    const mutations: { table: string; id: string; changes: Record<string, unknown> }[] = [];
    for (const scene of await getScenes(projectId)) {
      if (scene.isLocked) { if (scene.sceneNumber && scene.sceneNumber >= nextNumber) nextNumber = scene.sceneNumber + 1; continue; }
      if (scene.sceneNumber !== nextNumber) mutations.push({ table: 'scenes', id: scene.id, changes: { sceneNumber: nextNumber, updatedAt: Date.now() } });
      nextNumber++;
    }
    if (mutations.length) await mutateEraRows(scope, mutations);
  };
  const reorder = async <T extends { id: string; order: number }>(table: string, rows: T[], ids: string[]) => {
    const order = new Map(ids.map((id, index) => [id, index]));
    await mutateEraRows(scope, rows.filter(row => order.has(row.id) && row.order !== order.get(row.id)).map(row => ({ table, id: row.id, changes: { order: order.get(row.id), updatedAt: Date.now() } })));
  };
  const createScene = async (row: Scene) => db.transaction('rw', db.tables, async () => { const id = await scenes.create(row); await autoNumberScenes(row.projectId); return id; });
  const deleteScene = async (id: string) => db.transaction('rw', db.tables, async () => { await scenes.delete(id); await autoNumberScenes(scope.projectId); });
  const reorderScenes = async (projectId: string, ids: string[]) => db.transaction('rw', db.tables, async () => { await reorder('scenes', await getScenes(projectId), ids); await autoNumberScenes(projectId); });
  return { ...base, getScenes, getScene: scenes.getOne, createScene, updateScene: scenes.update, deleteScene, autoNumberScenes, reorderScenes, getDialogBlocks, createDialogBlock: blocks.create, updateDialogBlock: blocks.update, deleteDialogBlock: blocks.delete, reorderDialogBlocks: async (id: string, ids: string[]) => reorder('dialogBlocks', await getDialogBlocks(id), ids), getSceneCast: cast.getAll, addCastMember: cast.create, updateCastMember: cast.update, removeCastMember: cast.delete };
}
export type ScopedSceneOperations = ReturnType<typeof dialogSceneOperations>;
