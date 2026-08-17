import { lazy } from 'react';
import { Video } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { db } from '@/db';
const VideoPlannerEngine = lazy(() => import('./components/VideoPlannerEngine'));

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
    if (entityType === 'video-segment') {
      const segment = await db.videoSegments.get(entityId);
      if (!segment) return null;
      const plan = await db.videoPlans.get(segment.videoPlanId);
      return {
        id: segment.id,
        type: 'video-segment',
        engineId: 'video-planner',
        projectId: segment.projectId,
        title: segment.title,
        subtitle: plan?.title,
        thumbnail: segment.visualImageData,
      };
    }
    const plan = await db.videoPlans.get(entityId);
    if (!plan) return null;
    return {
      id: plan.id,
      type: entityType,
      engineId: 'video-planner',
      projectId: plan.projectId,
      title: plan.title,
    };
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    // Acotar antes de filtrar (contrato en `_shared/entityResolverRegistry.ts`).
    const base = projectId
      ? db.videoPlans.where('projectId').equals(projectId)
      : db.videoPlans.toCollection();
    const rows = await base.filter(v => v.title.toLowerCase().includes(q)).toArray();
    return rows.map(v => ({
      id: v.id,
      type: 'video-planner',
      engineId: 'video-planner',
      projectId: v.projectId,
      title: v.title,
    }));
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'video-planner',
  tables: ['videoPlans', 'videoSegments'],
}));

export { videoPlannerEngine };
