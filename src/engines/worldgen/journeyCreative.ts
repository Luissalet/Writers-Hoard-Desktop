import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { journeyRecipeKey } from './journeyTypes';
import type { GeneratedWorld } from './types';

export interface JourneyCreativeDraft {
  id: string;
  target: 'note' | 'scene';
  title: string;
  text: string;
  location: string;
  context: { stops: string[]; night?: number; u?: number; v?: number; mode: string; season: string; km: number; hours: number };
}

/** One authored decision, its source and engine activation commit together. */
export async function saveJourneyCreativeDraft(world: GeneratedWorld, draft: JourneyCreativeDraft): Promise<{ id: string; engine: 'notes' | 'dialog-scene' }> {
  const title = draft.title.trim(), text = draft.text.trim();
  if (!title || !text || !draft.id) throw new Error('A title and content are required');
  const engine = draft.target === 'note' ? 'notes' : 'dialog-scene';
  const table = draft.target === 'note' ? db.notes : db.scenes;
  const linkId = `journey-source:${draft.id}`;
  await db.transaction('rw', [db.projects, db.generatedWorlds, db.notes, db.scenes, db.entityLinks], async () => {
    const project = await db.projects.get(world.projectId);
    const current = await db.generatedWorlds.get(world.id);
    if (!project || !current || current.projectId !== world.projectId) throw new Error('World is no longer in this project');
    const existing = await table.get(draft.id);
    if (existing) {
      const link = await db.entityLinks.get(linkId);
      if (existing.projectId !== world.projectId || link?.sourceEntityId !== world.id || link.targetEngineId !== engine) throw new Error('Creative draft identity conflict');
      return; // A retried confirmed write must never duplicate or overwrite authored content.
    }
    if (journeyRecipeKey(current) !== journeyRecipeKey(world)) throw new Error('The world changed; reopen the journey before saving');
    const now = Date.now();
    if (draft.target === 'note') {
      await db.notes.add({ id: draft.id, projectId: world.projectId, kind: 'idea', text: `${title}\n\n${text}`, source: world.title, tags: ['worldgen'], pinned: false, createdAt: now, updatedAt: now });
    } else {
      const scenes = await db.scenes.where('projectId').equals(world.projectId).toArray();
      const order = scenes.reduce((max, scene) => Math.max(max, scene.order), -1) + 1;
      const sceneNumber = scenes.reduce((max, scene) => Math.max(max, scene.sceneNumber ?? 0), 0) + 1;
      await db.scenes.add({ id: draft.id, projectId: world.projectId, title, description: text, setting: draft.location, order, sceneNumber, tags: ['worldgen'], createdAt: now, updatedAt: now });
    }
    await db.entityLinks.add({
      id: linkId, projectId: world.projectId, sourceEngineId: 'worldgen', sourceEntityType: 'generated-world', sourceEntityId: world.id, sourceTitle: world.title,
      targetEngineId: engine, targetEntityType: draft.target === 'note' ? 'note' : 'scene', targetEntityId: draft.id, targetTitle: title,
      relation: 'developed-into', provenance: 'manual', notes: JSON.stringify({ version: 1, origin: 'world-journey', recipeKey: journeyRecipeKey(world), ...draft.context }), createdAt: now, updatedAt: now,
    });
    await db.projects.update(project.id, {
      enabledEngines: [...new Set([...project.enabledEngines, engine])],
      engineOrder: [...new Set([...(project.engineOrder ?? project.enabledEngines), engine])], updatedAt: now,
    });
  });
  notifyDataChanged({ source: 'other', projectId: world.projectId, entityId: draft.id });
  return { id: draft.id, engine };
}
