import { useState, useEffect, useCallback, useRef } from 'react';
import { onDataChanged } from './dataChanged';

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
  /** Whether this scope has published a successful read, even an empty one. */
  hasLoaded: boolean;
  /**
   * `true` ONLY while the first load for the current scope is in flight.
   * Post-mutation refreshes (add/edit/remove/reorder) do NOT flip this back to
   * `true`, so a view-level `if (loading) return <Spinner/>` never unmounts an
   * open editor/modal mid-edit. See tasks/lessons.md #16/#17.
   */
  loading: boolean;
  /** `true` during any refresh that is NOT the initial load. Purely optional UI. */
  refetching: boolean;
  /** Last load or mutation failure. Cleared by the next successful refresh. */
  error: Error | null;
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
 *
 * Concurrency guarantees:
 *   - A monotonic sequence token discards stale fetch results (an older refresh
 *     resolving after a newer one can never overwrite fresher data).
 *   - A mounted ref prevents setState after unmount.
 *   - `loading` reflects the *initial* load only (keyed by scope), never a
 *     post-mutation refresh — this is the root fix for the "refresh unmounts my
 *     modal" class of bugs that used to require per-view `items.length === 0`
 *     guards.
 */
export function makeEntityHook<T>(options: EntityHookOptions<T>): (scopeId: string) => EntityHookResult<T> {
  const { fetchFn, createFn, updateFn, deleteFn, reorderFn } = options;

  return function useEntities(scopeId: string): EntityHookResult<T> {
    const [items, setItems] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [refetching, setRefetching] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    // Scope for which we have completed a successful load. When it differs from
    // the current scopeId, the next fetch is treated as an initial load.
    const loadedScopeRef = useRef<string | null>(null);
    const requestedScopeRef = useRef<string | null>(null);
    const errorScopeRef = useRef<string | null>(null);
    const currentScopeRef = useRef(scopeId);
    currentScopeRef.current = scopeId;
    const seqRef = useRef(0);
    const mountedRef = useRef(true);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        seqRef.current += 1;
      };
    }, []);

    const refresh = useCallback(async () => {
      // A mutation can finish after navigation. Its captured refresh must not
      // invalidate or publish over the new owner's in-flight read.
      if (!mountedRef.current || currentScopeRef.current !== scopeId) return;
      // Invalidate every older request BEFORE the empty-scope early return.
      // Otherwise A can resolve after A→empty and repopulate a screen that no
      // longer owns A.
      const seq = ++seqRef.current;
      requestedScopeRef.current = scopeId;
      if (!scopeId) {
        setItems([]);
        setLoading(false);
        setRefetching(false);
        setError(null);
        loadedScopeRef.current = null;
        return;
      }
      const isInitialForScope = loadedScopeRef.current !== scopeId;
      if (isInitialForScope) setLoading(true);
      else setRefetching(true);
      setError(null);
      try {
        const data = await fetchFn(scopeId);
        if (seq !== seqRef.current || !mountedRef.current) return; // superseded
        setItems(data);
        setError(null);
        loadedScopeRef.current = scopeId;
      } catch (err) {
        if (seq === seqRef.current && mountedRef.current) {
          console.error('[makeEntityHook] fetch failed', err);
          errorScopeRef.current = scopeId;
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (seq === seqRef.current && mountedRef.current) {
          setLoading(false);
          setRefetching(false);
        }
      }
    }, [scopeId]);

    useEffect(() => {
      refresh();
    }, [refresh]);

    // Writes that go around this hook — the AI bridge, the copilot, an undo —
    // announce themselves on the window (see ./dataChanged.ts); refetch so an
    // open tab shows what a model just made instead of waiting for a remount.
    useEffect(() => onDataChanged(() => { void refresh(); }), [refresh]);

    const addItem = useCallback(
      async (item: T) => {
        try {
          await createFn(item);
          await refresh();
        } catch (reason) {
          if (mountedRef.current && currentScopeRef.current === scopeId) {
            errorScopeRef.current = scopeId;
            setError(reason instanceof Error ? reason : new Error(String(reason)));
          }
          throw reason;
        }
      },
      [refresh, scopeId],
    );

    const editItem = useCallback(
      async (id: string, changes: Partial<T>) => {
        try {
          await updateFn(id, changes);
          await refresh();
        } catch (reason) {
          if (mountedRef.current && currentScopeRef.current === scopeId) {
            errorScopeRef.current = scopeId;
            setError(reason instanceof Error ? reason : new Error(String(reason)));
          }
          throw reason;
        }
      },
      [refresh, scopeId],
    );

    const removeItem = useCallback(
      async (id: string) => {
        try {
          await deleteFn(id);
          await refresh();
        } catch (reason) {
          if (mountedRef.current && currentScopeRef.current === scopeId) {
            errorScopeRef.current = scopeId;
            setError(reason instanceof Error ? reason : new Error(String(reason)));
          }
          throw reason;
        }
      },
      [refresh, scopeId],
    );

    const reorder = useCallback(
      async (orderedIds: string[]) => {
        if (!reorderFn) return;
        try {
          await reorderFn(scopeId, orderedIds);
          await refresh();
        } catch (reason) {
          if (mountedRef.current && currentScopeRef.current === scopeId) {
            errorScopeRef.current = scopeId;
            setError(reason instanceof Error ? reason : new Error(String(reason)));
          }
          throw reason;
        }
      },
      [scopeId, refresh],
    );

    const ownsPublishedItems = Boolean(scopeId) && loadedScopeRef.current === scopeId;
    return {
      // On the render where A changes to B, the effect that starts B has not
      // run yet. Deriving by ownership prevents that one render from labelling
      // A's rows as B's data.
      items: ownsPublishedItems ? items : [],
      hasLoaded: ownsPublishedItems,
      loading: Boolean(scopeId) && requestedScopeRef.current !== scopeId ? true : loading,
      refetching: ownsPublishedItems ? refetching : false,
      error: scopeId && errorScopeRef.current === scopeId ? error : null,
      addItem,
      editItem,
      removeItem,
      refresh,
      reorder,
    };
  };
}
