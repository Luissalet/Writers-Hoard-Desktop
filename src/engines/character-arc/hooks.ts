import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { CharacterArc, ArcBeat } from './types';

export const useCharacterArcs = makeEntityHook<CharacterArc>({
  fetchFn: ops.getArcs,
  createFn: ops.createArc,
  updateFn: ops.updateArc,
  deleteFn: ops.deleteArc,
});

export const useArcBeats = makeEntityHook<ArcBeat>({
  fetchFn: ops.getBeats,
  createFn: ops.createBeat,
  updateFn: ops.updateBeat,
  deleteFn: ops.deleteBeat,
  reorderFn: ops.reorderBeats,
});
