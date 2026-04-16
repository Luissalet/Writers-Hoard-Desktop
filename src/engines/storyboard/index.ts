// ============================================
// Storyboard Engine — Registration
// ============================================

import { LayoutGrid } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { db } from '@/db';
import StoryboardEngine from './StoryboardEngine';

const storyboardEngine: EngineDefinition = {
  id: 'storyboard',
  name: 'Storyboard',
  description: 'Visual panel sequences for planning scenes and shots',
  icon: LayoutGrid,
  category: 'planning',
  tables: {
    storyboards: 'id, projectId',
    storyboardPanels: 'id, storyboardId, projectId, order',
    storyboardConnectors: 'id, storyboardId, fromPanelId, toPanelId',
  },
  component: StoryboardEngine,
};

registerEngine(storyboardEngine);

registerEntityResolver({
  engineId: 'storyboard',
  entityTypes: ['storyboard', 'panel'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const board = await db.storyboards.get(entityId);
    if (!board) return null;
    return {
      id: board.id,
      type: entityType,
      engineId: 'storyboard',
      title: board.title,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.storyboards.filter(b => b.title.toLowerCase().includes(q)).toArray();
    return rows.map(b => ({
      id: b.id,
      type: 'storyboard',
      engineId: 'storyboard',
      title: b.title,
    }));
  },
});

export { storyboardEngine };
