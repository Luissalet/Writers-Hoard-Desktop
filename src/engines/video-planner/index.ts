import { Video } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { db } from '@/db';
import VideoPlannerEngine from './components/VideoPlannerEngine';

const videoPlannerEngine: EngineDefinition = {
  id: 'video-planner',
  name: 'Video Planner',
  description: 'Plan video segments with script, visuals, and teleprompter',
  icon: Video,
  category: 'planning',
  tables: {
    videoPlans: 'id, projectId',
    videoSegments: 'id, videoPlanId, projectId, order',
  },
  component: VideoPlannerEngine,
};

registerEngine(videoPlannerEngine);

registerEntityResolver({
  engineId: 'video-planner',
  entityTypes: ['video-planner', 'video-segment'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const plan = await db.videoPlans.get(entityId);
    if (!plan) return null;
    return {
      id: plan.id,
      type: entityType,
      engineId: 'video-planner',
      title: plan.title,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.videoPlans.filter(v => v.title.toLowerCase().includes(q)).toArray();
    return rows.map(v => ({
      id: v.id,
      type: 'video-planner',
      engineId: 'video-planner',
      title: v.title,
    }));
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'video-planner',
  tables: ['videoPlans', 'videoSegments'],
}));

export { videoPlannerEngine };
