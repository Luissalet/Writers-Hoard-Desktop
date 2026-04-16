// ============================================
// Scrapper Engine — React Hooks
// ============================================

import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Snapshot } from './types';

export const useSnapshots = makeEntityHook<Snapshot>({
  fetchFn: ops.getSnapshots,
  createFn: ops.createSnapshot,
  updateFn: ops.updateSnapshot,
  deleteFn: ops.deleteSnapshot,
});
