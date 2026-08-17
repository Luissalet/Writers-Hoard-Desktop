import { lazy } from 'react';
import { BarChart3 } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { db } from '@/db';
const WritingStatsEngine = lazy(() => import('./components/WritingStatsEngine'));

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
      projectId: session.projectId,
      title: `${session.date}: ${session.wordCount} words`,
    };
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    // Acotar antes de filtrar (contrato en `_shared/entityResolverRegistry.ts`).
    const base = projectId
      ? db.writingSessions.where('projectId').equals(projectId)
      : db.writingSessions.toCollection();
    const rows = await base
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
      projectId: s.projectId,
      title: `${s.date}: ${s.wordCount} words`,
    }));
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'writing-stats',
  tables: ['writingSessions', 'writingGoals'],
}));

export { writingStatsEngine };
