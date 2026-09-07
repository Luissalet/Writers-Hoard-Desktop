import { useState, useEffect, useCallback, useRef } from 'react';
import { onDataChanged } from './dataChanged';

/**
 * Options for makeGraphHook factory.
 * Defines all CRUD operations for a dual-collection graph (nodes + edges).
 */
export interface GraphHookOptions<N, E> {
  fetchNodesFn: (scopeId: string) => Promise<N[]>;
  fetchEdgesFn: (scopeId: string) => Promise<E[]>;
  createNodeFn: (node: N) => Promise<string>;
  updateNodeFn: (id: string, changes: Partial<N>) => Promise<void>;
  deleteNodeFn: (id: string) => Promise<void>;
  createEdgeFn: (edge: E) => Promise<string>;
  updateEdgeFn: (id: string, changes: Partial<E>) => Promise<void>;
  deleteEdgeFn: (id: string) => Promise<void>;
}

/**
 * Return type for graph hooks created by makeGraphHook.
 * Includes state and CRUD methods for both nodes and edges.
 */
export interface GraphHookResult<N, E> {
  nodes: N[];
  edges: E[];
  /** `true` only during the initial load for the current scope. */
  loading: boolean;
  /** `true` during any non-initial refresh. */
  refetching: boolean;
  error: Error | null;
  addNode: (node: N) => Promise<void>;
  updateNode: (id: string, changes: Partial<N>) => Promise<void>;
  removeNode: (id: string) => Promise<void>;
  addEdge: (edge: E) => Promise<void>;
  updateEdge: (id: string, changes: Partial<E>) => Promise<void>;
  removeEdge: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Factory that creates a custom hook for managing graph data (nodes + edges).
 *
 * Key feature: batches node and edge fetches in a single Promise.all() refresh
 * to prevent double re-renders on canvas components.
 *
 * Usage:
 *   const useMyGraphData = makeGraphHook({
 *     fetchNodesFn: ops.getNodes,
 *     fetchEdgesFn: ops.getEdges,
 *     createNodeFn: ops.createNode,
 *     // ... etc
 *   });
 *
 *   const { nodes, edges, addNode, addEdge, refresh } = useMyGraphData(scopeId);
 */
export function makeGraphHook<N, E>(
  options: GraphHookOptions<N, E>,
): (scopeId: string) => GraphHookResult<N, E> {
  const {
    fetchNodesFn,
    fetchEdgesFn,
    createNodeFn,
    updateNodeFn,
    deleteNodeFn,
    createEdgeFn,
    updateEdgeFn,
    deleteEdgeFn,
  } = options;

  return function useGraphData(scopeId: string): GraphHookResult<N, E> {
    const [nodes, setNodes] = useState<N[]>([]);
    const [edges, setEdges] = useState<E[]>([]);
    const [loading, setLoading] = useState(true);
    const [refetching, setRefetching] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const loadedScopeRef = useRef<string | null>(null);
    const seqRef = useRef(0);
    const mountedRef = useRef(true);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        seqRef.current += 1;
      };
    }, []);

    // Batched refresh: fetch both collections in parallel. `loading` reflects the
    // initial load only; post-mutation refreshes set `refetching` so a canvas
    // never blanks to a spinner mid-interaction. Stale results are discarded.
    const refresh = useCallback(async () => {
      const seq = ++seqRef.current;
      if (!scopeId) {
        setNodes([]);
        setEdges([]);
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
        const [nodesData, edgesData] = await Promise.all([
          fetchNodesFn(scopeId),
          fetchEdgesFn(scopeId),
        ]);
        if (seq !== seqRef.current || !mountedRef.current) return; // superseded
        setNodes(nodesData);
        setEdges(edgesData);
        setError(null);
        loadedScopeRef.current = scopeId;
      } catch (err) {
        if (seq === seqRef.current && mountedRef.current) {
          console.error('[makeGraphHook] fetch failed', err);
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (seq === seqRef.current && mountedRef.current) {
          setLoading(false);
          setRefetching(false);
        }
      }
    }, [scopeId]);

    // Auto-refresh on scopeId change
    useEffect(() => {
      refresh();
    }, [refresh]);

    // And on writes that went around this hook (AI bridge, copilot, undo).
    useEffect(() => onDataChanged(() => { void refresh(); }), [refresh]);

    const runMutation = useCallback(async (operation: () => Promise<unknown>) => {
      setError(null);
      try {
        await operation();
        await refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        throw reason;
      }
    }, [refresh]);

    // --- Node operations ---
    const addNode = useCallback(
      async (node: N) => {
        await runMutation(() => createNodeFn(node));
      },
      [runMutation],
    );

    const updateNode = useCallback(
      async (id: string, changes: Partial<N>) => {
        await runMutation(() => updateNodeFn(id, changes));
      },
      [runMutation],
    );

    const removeNode = useCallback(
      async (id: string) => {
        await runMutation(() => deleteNodeFn(id));
      },
      [runMutation],
    );

    // --- Edge operations ---
    const addEdge = useCallback(
      async (edge: E) => {
        await runMutation(() => createEdgeFn(edge));
      },
      [runMutation],
    );

    const updateEdge = useCallback(
      async (id: string, changes: Partial<E>) => {
        await runMutation(() => updateEdgeFn(id, changes));
      },
      [runMutation],
    );

    const removeEdge = useCallback(
      async (id: string) => {
        await runMutation(() => deleteEdgeFn(id));
      },
      [runMutation],
    );

    const ownsPublishedGraph = Boolean(scopeId) && loadedScopeRef.current === scopeId;
    return {
      nodes: ownsPublishedGraph ? nodes : [],
      edges: ownsPublishedGraph ? edges : [],
      loading: Boolean(scopeId) && !ownsPublishedGraph ? true : loading,
      refetching: ownsPublishedGraph ? refetching : false,
      error: ownsPublishedGraph ? error : null,
      addNode,
      updateNode,
      removeNode,
      addEdge,
      updateEdge,
      removeEdge,
      refresh,
    };
  };
}
