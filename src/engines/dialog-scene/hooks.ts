import { useState, useEffect, useCallback } from 'react';
import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Scene, DialogBlock, SceneCast } from './types';

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

// useSceneCast — kept manual: non-standard CRUD (addMember/removeMember, no editMember)
export function useSceneCast(sceneId: string) {
  const [cast, setCast] = useState<SceneCast[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!sceneId) return;
    setLoading(true);
    const data = await ops.getSceneCast(sceneId);
    setCast(data);
    setLoading(false);
  }, [sceneId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addMember = useCallback(
    async (member: SceneCast) => {
      await ops.addCastMember(member);
      await refresh();
    },
    [refresh],
  );

  const removeMember = useCallback(
    async (id: string) => {
      await ops.removeCastMember(id);
      await refresh();
    },
    [refresh],
  );

  const updateMember = useCallback(
    async (id: string, changes: Partial<SceneCast>) => {
      await ops.updateCastMember(id, changes);
      await refresh();
    },
    [refresh],
  );

  return { cast, loading, addMember, removeMember, updateMember, refresh };
}
