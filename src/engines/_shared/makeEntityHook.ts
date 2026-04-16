import { useState, useEffect, useCallback } from 'react';

export interface EntityHookOptions<T> {
  /** Fetches all items for a given scope ID (projectId, boardId, etc.) */
  fetchFn: (scopeId: string) => Promise<T[]>;
  createFn: (item: T) => Promise<string>;
  updateFn: (id: string, changes: Partial<T>) => Promise<void>;
  deleteFn: (id: string) => Promise<void>;
  /**
   * Optional reorder function. When provided, the returned hook exposes a
   * `reorder(orderedIds: string[]) => Promise<void>` method.
   */
  reorderFn?: (scopeId: string, orderedIds: string[]) => Promise<void>;
}

export interface EntityHookResult<T> {
  items: T[];
  loading: boolean;
  addItem: (item: T) => Promise<void>;
  editItem: (id: string, changes: Partial<T>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Always present; no-op when no reorderFn was provided to makeEntityHook. */
  reorder: (orderedIds: string[]) => Promise<void>;
}

/**
 * Factory that returns a typed CRUD hook from a set of operation functions.
 *
 * The factory runs at module scope; the returned function is the actual hook.
 * This avoids "hooks called inside factories" lint issues.
 *
 * Returned names are generic: `items`, `addItem`, `editItem`, `removeItem`.
 * Callers rename via destructuring aliases:
 *   const { items: entries, addItem: addEntry } = useDiaryEntries(projectId);
 */
export function makeEntityHook<T>(options: EntityHookOptions<T>): (scopeId: string) => EntityHookResult<T> {
  const { fetchFn, createFn, updateFn, deleteFn, reorderFn } = options;

  return function useEntities(scopeId: string): EntityHookResult<T> {
    const [items, setItems] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
      if (!scopeId) return;
      setLoading(true);
      const data = await fetchFn(scopeId);
      setItems(data);
      setLoading(false);
    }, [scopeId]);

    useEffect(() => {
      refresh();
    }, [refresh]);

    const addItem = useCallback(
      async (item: T) => {
        await createFn(item);
        await refresh();
      },
      [refresh],
    );

    const editItem = useCallback(
      async (id: string, changes: Partial<T>) => {
        await updateFn(id, changes);
        await refresh();
      },
      [refresh],
    );

    const removeItem = useCallback(
      async (id: string) => {
        await deleteFn(id);
        await refresh();
      },
      [refresh],
    );

    const reorder = useCallback(
      async (orderedIds: string[]) => {
        if (!reorderFn) return;
        await reorderFn(scopeId, orderedIds);
        await refresh();
      },
      [scopeId, refresh],
    );

    return {
      items,
      loading,
      addItem,
      editItem,
      removeItem,
      refresh,
      reorder,
    };
  };
}
