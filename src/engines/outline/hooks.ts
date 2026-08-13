import { makeEntityHook, makeReadOnlyHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Outline, OutlineBeat } from './types';

export const useOutlines = makeEntityHook<Outline>({
  fetchFn: ops.getOutlines,
  createFn: ops.createOutline,
  updateFn: ops.updateOutline,
  deleteFn: ops.deleteOutline,
});

export const useOutlineBeats = makeEntityHook<OutlineBeat>({
  fetchFn: ops.getBeats,
  createFn: ops.createBeat,
  updateFn: ops.updateBeat,
  deleteFn: ops.deleteBeat,
  reorderFn: ops.reorderBeats,
});

/** Read-only: every beat in the project, for cross-engine link pickers. */
export const useAllProjectBeats = makeReadOnlyHook<OutlineBeat>({
  fetchFn: ops.getAllProjectBeats,
});
