import { makeEntityHook, makeGraphHook } from '@/engines/_shared';
import type { YarnBoard, YarnNode, YarnEdge } from '@/types';
import * as ops from './operations';

export const useYarnBoards = makeEntityHook<YarnBoard>({
  fetchFn: ops.getYarnBoards,
  createFn: ops.createYarnBoard,
  updateFn: ops.updateYarnBoard,
  deleteFn: ops.deleteYarnBoard,
});

// Batches nodes + edges in a single Promise.all refresh to avoid double re-renders on canvas.
// Uses makeGraphHook factory internally with domain-specific naming.
const baseUseGraphData = makeGraphHook<YarnNode, YarnEdge>({
  fetchNodesFn: ops.getYarnNodes,
  fetchEdgesFn: ops.getYarnEdges,
  createNodeFn: ops.createYarnNode,
  updateNodeFn: ops.updateYarnNode,
  deleteNodeFn: ops.deleteYarnNode,
  createEdgeFn: ops.createYarnEdge,
  updateEdgeFn: ops.updateYarnEdge,
  deleteEdgeFn: ops.deleteYarnEdge,
});

export function useYarnBoardData(boardId: string) {
  const { nodes, edges, loading, addNode, updateNode, removeNode, addEdge, updateEdge, removeEdge, refresh } = baseUseGraphData(boardId);

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
}
