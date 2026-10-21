import { useMemo } from 'react';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { dialogSceneOperations } from './scopedOperations';
import { makeEntityHook, makeReadOnlyHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Scene, DialogBlock, SceneCast } from './types';
import type { OutlineBeat } from '@/engines/outline/types';

export function useSceneOperations() { const scope = useWorldEraScope(); return useMemo(() => dialogSceneOperations(scope), [scope]); }
export function useScenes(projectId: string) {
  const scope = useWorldEraScope(projectId), operations = useMemo(() => dialogSceneOperations(scope), [scope]);
  const hook = useMemo(() => makeEntityHook<Scene>({ fetchFn: operations.getScenes, createFn: operations.createScene, updateFn: operations.updateScene, deleteFn: operations.deleteScene, reorderFn: operations.reorderScenes }), [operations]);
  return hook(projectId);
}
export function useDialogBlocks(sceneId: string) {
  const operations = useSceneOperations();
  const hook = useMemo(() => makeEntityHook<DialogBlock>({ fetchFn: operations.getDialogBlocks, createFn: operations.createDialogBlock, updateFn: operations.updateDialogBlock, deleteFn: operations.deleteDialogBlock, reorderFn: operations.reorderDialogBlocks }), [operations]);
  return hook(sceneId);
}
export function useSceneCast(sceneId: string) {
  const operations = useSceneOperations();
  const hook = useMemo(() => makeEntityHook<SceneCast>({ fetchFn: operations.getSceneCast, createFn: operations.addCastMember, updateFn: operations.updateCastMember, deleteFn: operations.removeCastMember }), [operations]);
  const { items: cast, loading, addItem: addMember, editItem: updateMember, removeItem: removeMember, refresh } = hook(sceneId);
  return { cast, loading, addMember, removeMember, updateMember, refresh };
}

/** Outline beats linked to a specific scene (read-only, race-guarded). */
const useLinkedBeatsBase = makeReadOnlyHook<OutlineBeat>({
  fetchFn: ops.getLinkedBeats,
});

export function useLinkedBeats(sceneId: string): OutlineBeat[] {
  return useLinkedBeatsBase(sceneId).items;
}
