import { makeEntityHook, makeReadOnlyHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Scene, DialogBlock, SceneCast } from './types';
import type { OutlineBeat } from '@/engines/outline/types';

export const useScenes = makeEntityHook<Scene>({
  fetchFn: ops.getScenes,
  createFn: ops.createScene,
  updateFn: ops.updateScene,
  deleteFn: ops.deleteScene,
  reorderFn: ops.reorderScenes,
});

export const useDialogBlocks = makeEntityHook<DialogBlock>({
  fetchFn: ops.getDialogBlocks,
  createFn: ops.createDialogBlock,
  updateFn: ops.updateDialogBlock,
  deleteFn: ops.deleteDialogBlock,
  reorderFn: ops.reorderDialogBlocks,
});

// Scene cast fits the entity factory exactly (fetch/create/update/delete
// keyed by sceneId). The old hand-rolled version flipped `loading` on every
// refresh, left it stuck `true` for an empty sceneId, and had no
// stale-response/unmount guards — all fixed by the factory. The wrapper
// preserves the original property names for the call sites.
const useSceneCastBase = makeEntityHook<SceneCast>({
  fetchFn: ops.getSceneCast,
  createFn: ops.addCastMember,
  updateFn: ops.updateCastMember,
  deleteFn: ops.removeCastMember,
});

export function useSceneCast(sceneId: string) {
  const {
    items: cast,
    loading,
    addItem: addMember,
    editItem: updateMember,
    removeItem: removeMember,
    refresh,
  } = useSceneCastBase(sceneId);
  return { cast, loading, addMember, removeMember, updateMember, refresh };
}

/** Outline beats linked to a specific scene (read-only, race-guarded). */
const useLinkedBeatsBase = makeReadOnlyHook<OutlineBeat>({
  fetchFn: ops.getLinkedBeats,
});

export function useLinkedBeats(sceneId: string): OutlineBeat[] {
  return useLinkedBeatsBase(sceneId).items;
}
