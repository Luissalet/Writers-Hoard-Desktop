import { useState, useEffect, useCallback } from 'react';

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
  loading: boolean;
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

    // Batched refresh: fetch both collections in parallel
    const refresh = useCallback(async () => {
      if (!scopeId) return;
      setLoading(true);
      const [nodesData, edgesData] = await Promise.all([
        fetchNodesFn(scopeId),
        fetchEdgesFn(scopeId),
      ]);
      setNodes(nodesData);
      setEdges(edgesData);
      setLoading(false);
    }, [scopeId]);

    // Auto-refresh on scopeId change
    useEffect(() => {
      refresh();
    }, [refresh]);

    // --- Node operations ---
    const addNode = useCallback(
      async (node: N) => {
        await createNodeFn(node);
        await refresh();
      },
      [refresh],
    );

    const updateNode = useCallback(
      async (id: string, changes: Partial<N>) => {
        await updateNodeFn(id, changes);
        await refresh();
      },
      [refresh],
    );

    const removeNode = useCallback(
      async (id: string) => {
        await deleteNodeFn(id);
        await refresh();
      },
      [refresh],
    );

    // --- Edge operations ---
    const addEdge = useCallback(
      async (edge: E) => {
        await createEdgeFn(edge);
        await refresh();
      },
      [refresh],
    );

    const updateEdge = useCallback(
      async (id: string, changes: Partial<E>) => {
        await updateEdgeFn(id, changes);
        await refresh();
      },
      [refresh],
    );

    const removeEdge = useCallback(
      async (id: string) => {
        await deleteEdgeFn(id);
        await refresh();
      },
      [refresh],
    );

    return {
      nodes,
      edges,
      loading,
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
