import { MessageSquare } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { db } from '@/db';
import DialogSceneEngine from './components/DialogSceneEngine';

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
    const scene = await db.scenes.get(entityId);
    if (!scene) return null;
    return {
      id: scene.id,
      type: entityType,
      engineId: 'dialog-scene',
      title: scene.title,
      subtitle: scene.setting,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.scenes.filter(s => s.title.toLowerCase().includes(q)).toArray();
    return rows.map(s => ({
      id: s.id,
      type: 'scene',
      engineId: 'dialog-scene',
      title: s.title,
      subtitle: s.setting,
    }));
  },
});

export { dialogSceneEngine };
