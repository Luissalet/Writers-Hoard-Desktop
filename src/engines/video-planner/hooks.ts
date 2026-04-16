import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { VideoPlan, VideoSegment } from './types';

export const useVideoPlans = makeEntityHook<VideoPlan>({
  fetchFn: ops.getVideoPlans,
  createFn: ops.createVideoPlan,
  updateFn: ops.updateVideoPlan,
  deleteFn: ops.deleteVideoPlan,
});

export const useVideoSegments = makeEntityHook<VideoSegment>({
  fetchFn: ops.getSegments,
  createFn: ops.createSegment,
  updateFn: ops.updateSegment,
  deleteFn: ops.deleteSegment,
  reorderFn: ops.reorderSegments,
});
