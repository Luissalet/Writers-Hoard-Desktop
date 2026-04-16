import { BarChart3 } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { db } from '@/db';
import WritingStatsEngine from './components/WritingStatsEngine';

const writingStatsEngine: EngineDefinition = {
  id: 'writing-stats',
  name: 'Writing Stats',
  description: 'Track word counts, set goals, run sprints, and visualize progress',
  icon: BarChart3,
  category: 'core',
  tables: {
    writingSessions: 'id, projectId, date, type, createdAt',
    writingGoals: 'id, projectId, type, active',
  },
  component: WritingStatsEngine,
};

registerEngine(writingStatsEngine);

registerEntityResolver({
  engineId: 'writing-stats',
  entityTypes: ['writing-stats', 'writing-session'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const session = await db.writingSessions.get(entityId);
    if (!session) return null;
    return {
      id: session.id,
      type: entityType,
      engineId: 'writing-stats',
      title: `${session.date}: ${session.wordCount} words`,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.writingSessions
      .filter(
        (s) =>
          (s.date || '').toLowerCase().includes(q) ||
          (s.notes || '').toLowerCase().includes(q) ||
          (s.type || '').toLowerCase().includes(q)
      )
      .toArray();
    return rows.map((s) => ({
      id: s.id,
      type: 'writing-session',
      engineId: 'writing-stats',
      title: `${s.date}: ${s.wordCount} words`,
    }));
  },
});

export { writingStatsEngine };
