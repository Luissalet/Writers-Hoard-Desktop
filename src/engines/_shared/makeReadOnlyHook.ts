// ============================================
// Read-only entity hook factory
// ============================================
//
// Use when an engine needs a hook that scans rows for a project (or any
// scope key) but does not own CRUD on those rows — typically a derived view
// or a "walk-children-of-X" aggregate that doesn't fit `makeEntityHook`.
//
// Examples in the wild:
//   - seeds/useAllPayoffs(projectId)  — gathers every payoff across every seed
//   - pov-audit/useScenesForAudit(projectId) — read-only scene scan
//
// Returns the same `{ items, loading, refresh }` shape every consumer expects.
// Provide `enabled: false` (or omit a scopeId) to short-circuit the fetch.

import { useCallback, useEffect, useState } from 'react';

export interface ReadOnlyHookOptions<T> {
  /** Async function that returns the rows for a given scope id. */
  fetchFn: (scopeId: string) => Promise<T[]>;
}

export interface ReadOnlyHookResult<T> {
  items: T[];
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Factory returning a read-only hook keyed by a scope id (e.g. projectId).
 * No mutation paths — callers that need writes should use `makeEntityHook`
 * with createFn/updateFn/deleteFn, or fall back to the engine's `operations.ts`.
 *
 * The returned hook is safe to call with an empty scopeId — it returns
 * `{ items: [], loading: false }` and skips the fetch.
 */
export function makeReadOnlyHook<T>(
  options: ReadOnlyHookOptions<T>,
): (scopeId: string | undefined) => ReadOnlyHookResult<T> {
  const { fetchFn } = options;

  return function useReadOnly(scopeId: string | undefined): ReadOnlyHookResult<T> {
    const [items, setItems] = useState<T[]>([]);
    const [loading, setLoading] = useState<boolean>(false);

    const refresh = useCallback(async () => {
      if (!scopeId) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const rows = await fetchFn(scopeId);
        setItems(rows);
      } finally {
        setLoading(false);
      }
    }, [scopeId]);

    useEffect(() => {
      refresh();
    }, [refresh]);

    return { items, loading, refresh };
  };
}
