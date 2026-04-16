import { makeTableOps, reorderItems, makeCascadeDeleteOp } from '@/engines/_shared';
import type { VideoPlan, VideoSegment } from './types';

// ===== Video Plans =====
const planOps = makeTableOps<VideoPlan>({
  tableName: 'videoPlans',
  scopeField: 'projectId',
});

export const getVideoPlans = planOps.getAll;
export const getVideoPlan = planOps.getOne;
export const createVideoPlan = planOps.create;
export const updateVideoPlan = planOps.update;

// deleteVideoPlan cascades to segments
export const deleteVideoPlan = makeCascadeDeleteOp({
  tableName: 'videoPlans',
  cascades: [{ table: 'videoSegments', foreignKey: 'videoPlanId' }],
});

// ===== Video Segments =====
const segmentOps = makeTableOps<VideoSegment>({
  tableName: 'videoSegments',
  scopeField: 'videoPlanId',
  sortFn: (a, b) => a.order - b.order,
});

export const getSegments = segmentOps.getAll;
export const getSegment = segmentOps.getOne;
export const createSegment = segmentOps.create;
export const updateSegment = segmentOps.update;
export const deleteSegment = segmentOps.delete;

export async function reorderSegments(videoPlanId: string, orderedIds: string[]): Promise<void> {
  await reorderItems('videoSegments', 'videoPlanId', videoPlanId, orderedIds);
}
