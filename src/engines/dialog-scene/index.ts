import { lazy } from 'react';
import { MessageSquare } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, readBackupJson } from '@/engines/_shared';
import { db } from '@/db';
const DialogSceneEngine = lazy(() => import('./components/DialogSceneEngine'));

const dialogSceneEngine: EngineDefinition = {
  id: 'dialog-scene',
  name: 'Dialog / Scenes',
  description: 'Create scenes with character dialog and stage directions',
  icon: MessageSquare,
  category: 'creative',
  tables: {
    scenes: 'id, projectId, order',
    dialogBlocks: 'id, sceneId, projectId, order',
    sceneCasts: 'id, sceneId',
  },
  component: DialogSceneEngine,
};

registerEngine(dialogSceneEngine);

registerEntityResolver({
  engineId: 'dialog-scene',
  entityTypes: ['dialog-scene', 'scene', 'dialog-block'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'dialog-block') {
      const block = await db.dialogBlocks.get(entityId);
      if (!block) return null;
      const scene = await db.scenes.get(block.sceneId);
      return {
        id: block.id,
        type: 'dialog-block',
        engineId: 'dialog-scene',
        projectId: block.projectId,
        title: block.characterName || block.type,
        subtitle: scene?.title,
      };
    }
    const scene = await db.scenes.get(entityId);
    if (!scene) return null;
    return {
      id: scene.id,
      type: entityType,
      engineId: 'dialog-scene',
      projectId: scene.projectId,
      title: scene.title,
      subtitle: scene.setting,
    };
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    // Acotar antes de filtrar (contrato en `_shared/entityResolverRegistry.ts`).
    const base = projectId
      ? db.scenes.where('projectId').equals(projectId)
      : db.scenes.toCollection();
    const rows = await base.filter(s => s.title.toLowerCase().includes(q)).toArray();
    return rows.map(s => ({
      id: s.id,
      type: 'scene',
      engineId: 'dialog-scene',
      projectId: s.projectId,
      title: s.title,
      subtitle: s.setting,
    }));
  },
});

// sceneCasts has no projectId — it's keyed by sceneId. We skip it in the
// simple strategy and dump manually via export hook below.
registerBackupStrategy({
  engineId: 'dialog-scene',
  tables: ['scenes', 'dialogBlocks', 'sceneCasts'],
  async exportProject({ zip, projectId, projectDir }) {
    const scenes = await db.scenes.where('projectId').equals(projectId).toArray();
    if (scenes.length) zip.file(`${projectDir}/dialog-scene/scenes.json`, JSON.stringify(scenes, null, 2));

    const blocks = await db.dialogBlocks.where('projectId').equals(projectId).toArray();
    if (blocks.length) zip.file(`${projectDir}/dialog-scene/dialogBlocks.json`, JSON.stringify(blocks, null, 2));

    // sceneCasts are scoped by sceneId — pull them via the project's scenes.
    const sceneIds = scenes.map(s => s.id);
    if (sceneIds.length) {
      const casts = await db.sceneCasts.where('sceneId').anyOf(sceneIds).toArray();
      if (casts.length) zip.file(`${projectDir}/dialog-scene/sceneCasts.json`, JSON.stringify(casts, null, 2));
    }
  },
  async inspectImport({ zip, projectDir }) {
    return Promise.all([
      ['scenes', 'scenes'],
      ['dialogBlocks', 'dialogBlocks'],
      ['sceneCasts', 'sceneCasts'],
    ].map(async ([file, table]) => {
      const path = `${projectDir}/dialog-scene/${file}.json`;
      const rows = await readBackupJson<unknown>(zip, path);
      if (rows !== null && !Array.isArray(rows)) {
        throw new Error(`Expected "${path}" to contain a JSON array.`);
      }
      return { table, path, rows: rows ?? [] };
    }));
  },
  async importProject({ zip, projectDir }) {
    const scenes = await readBackupJson<unknown[]>(zip, `${projectDir}/dialog-scene/scenes.json`);
    if (scenes?.length) await db.scenes.bulkPut(scenes as never[]);

    const blocks = await readBackupJson<unknown[]>(zip, `${projectDir}/dialog-scene/dialogBlocks.json`);
    if (blocks?.length) await db.dialogBlocks.bulkPut(blocks as never[]);

    const casts = await readBackupJson<unknown[]>(zip, `${projectDir}/dialog-scene/sceneCasts.json`);
    if (casts?.length) await db.sceneCasts.bulkPut(casts as never[]);
  },
});

export { dialogSceneEngine };
