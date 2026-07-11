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
//   - annotations/useAnnotationsForProject(projectId)
//
// Returns the same `{ items, loading, refresh }` shape every consumer expects.
// Provide an empty scopeId to short-circuit the fetch.
//
// 2026-04-23 — Added optional `useDeps` so callers can re-fetch on
// filter/dimension changes (e.g. POV Audit's "include minor characters" toggle
// or Seeds' "only Chekhov's guns" filter). The hook accepts a second argument,
// a value passed through to `fetchFn` alongside the scopeId. Any change to
// that value triggers a refresh; a deep-equality check is not performed —
// consumers should memoize the value if it's an object literal.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ReadOnlyHookOptions<T, Deps = void> {
  /**
   * Async function that returns the rows for a given scope id. If the hook is
   * used with deps, the second argument is the current deps value.
   */
  fetchFn: (scopeId: string, deps: Deps) => Promise<T[]>;
}

export interface ReadOnlyHookResult<T> {
  items: T[];
  /** `true` only during the first load for the current scope/deps. */
  loading: boolean;
  /** `true` during any non-initial refresh. */
  refetching: boolean;
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Overloads — callers that don't pass a deps arg keep the original 1-arg
// signature; callers that do pick up a second positional arg of type Deps.
// ---------------------------------------------------------------------------

export function makeReadOnlyHook<T>(options: {
  fetchFn: (scopeId: string) => Promise<T[]>;
}): (scopeId: string | undefined) => ReadOnlyHookResult<T>;

export function makeReadOnlyHook<T, Deps>(options: {
  fetchFn: (scopeId: string, deps: Deps) => Promise<T[]>;
}): (scopeId: string | undefined, deps: Deps) => ReadOnlyHookResult<T>;

export function makeReadOnlyHook<T, Deps = void>(
  options: ReadOnlyHookOptions<T, Deps>,
) {
  const { fetchFn } = options;

  return function useReadOnly(
    scopeId: string | undefined,
    deps?: Deps,
  ): ReadOnlyHookResult<T> {
    const [items, setItems] = useState<T[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [refetching, setRefetching] = useState<boolean>(false);

    const loadedKeyRef = useRef<string | null>(null);
    const seqRef = useRef(0);
    const mountedRef = useRef(true);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    const refresh = useCallback(async () => {
      if (!scopeId) {
        setItems([]);
        setLoading(false);
        setRefetching(false);
        loadedKeyRef.current = null;
        return;
      }
      const seq = ++seqRef.current;
      // Key on scope only: a deps change refetches but shouldn't blank the view
      // with a full spinner (that would flash a derived dashboard on every filter
      // toggle). Initial spinner fires once per scope.
      const isInitial = loadedKeyRef.current !== scopeId;
      if (isInitial) setLoading(true);
      else setRefetching(true);
      try {
        const rows = await fetchFn(scopeId, deps as Deps);
        if (seq !== seqRef.current || !mountedRef.current) return; // superseded
        setItems(rows);
        loadedKeyRef.current = scopeId;
      } catch (err) {
        if (seq === seqRef.current && mountedRef.current) {
          console.error('[makeReadOnlyHook] fetch failed', err);
        }
      } finally {
        if (seq === seqRef.current && mountedRef.current) {
          setLoading(false);
          setRefetching(false);
        }
      }
      // deps is intentionally part of the dep array — refetch on any change.
    }, [scopeId, deps]);

    useEffect(() => {
      refresh();
    }, [refresh]);

    return { items, loading, refetching, refresh };
  };
}
