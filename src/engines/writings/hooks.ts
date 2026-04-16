import { useState, useEffect, useCallback } from 'react';
import type { Writing } from '@/types';
import * as ops from './operations';

export function useWritings(projectId: string) {
  const [writings, setWritings] = useState<Writing[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const data = await ops.getWritings(projectId);
    setWritings(data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addWriting = useCallback(async (writing: Writing) => {
    await ops.createWriting(writing);
    await refresh();
  }, [refresh]);

  const editWriting = useCallback(async (id: string, changes: Partial<Writing>) => {
    await ops.updateWriting(id, changes);
    await refresh();
  }, [refresh]);

  const removeWriting = useCallback(async (id: string) => {
    await ops.deleteWriting(id);
    await refresh();
  }, [refresh]);

  return { writings, loading, refresh, addWriting, editWriting, removeWriting };
}
