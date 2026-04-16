// ============================================
// Brainstorm Engine — Registration
// ============================================

import { Lightbulb } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { db } from '@/db';
import BrainstormEngine from './components/BrainstormEngine';

const brainstormEngine: EngineDefinition = {
  id: 'brainstorm',
  name: 'Brainstorm',
  description: 'Freeform canvas to mix ideas from every engine',
  icon: Lightbulb,
  category: 'creative',
  tables: {
    brainstormBoards: 'id, projectId',
    brainstormItems: 'id, boardId, projectId, type',
    brainstormConnections: 'id, boardId, sourceId, targetId',
  },
  component: BrainstormEngine,
};

registerEngine(brainstormEngine);

registerEntityResolver({
  engineId: 'brainstorm',
  entityTypes: ['brainstorm'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const board = await db.brainstormBoards.get(entityId);
    if (!board) return null;
    return {
      id: board.id,
      type: entityType,
      engineId: 'brainstorm',
      title: board.title,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.brainstormBoards.filter(b => b.title.toLowerCase().includes(q)).toArray();
    return rows.map(b => ({
      id: b.id,
      type: 'brainstorm',
      engineId: 'brainstorm',
      title: b.title,
    }));
  },
});

export { brainstormEngine };
