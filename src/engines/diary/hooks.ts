import { useState, useEffect, useCallback } from 'react';
import type { DiaryEntry } from './types';
import * as ops from './operations';

export function useDiaryEntries(projectId: string) {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const data = await ops.getEntries(projectId);
    setEntries(data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addEntry = useCallback(
    async (entry: DiaryEntry) => {
      await ops.createEntry(entry);
      await refresh();
    },
    [refresh],
  );

  const editEntry = useCallback(
    async (id: string, changes: Partial<DiaryEntry>) => {
      await ops.updateEntry(id, changes);
      await refresh();
    },
    [refresh],
  );

  const removeEntry = useCallback(
    async (id: string) => {
      await ops.deleteEntry(id);
      await refresh();
    },
    [refresh],
  );

  return { entries, loading, addEntry, editEntry, removeEntry, refresh };
}
