// ============================================
// Brainstorm Engine — React Hooks
// ============================================

import { makeEntityHook, makeGraphHook } from '@/engines/_shared';
import * as ops from './operations';
import type { BrainstormBoard, BrainstormItem, BrainstormConnection } from './types';

export const useBrainstormBoards = makeEntityHook<BrainstormBoard>({
  fetchFn: ops.getBrainstormBoards,
  createFn: ops.createBrainstormBoard,
  updateFn: ops.updateBrainstormBoard,
  deleteFn: ops.deleteBrainstormBoard,
});

// Batches items + connections in a single Promise.all refresh to avoid double re-renders on canvas.
// Uses makeGraphHook factory internally but maps to domain-specific names (items/connections).
const baseUseGraphData = makeGraphHook<BrainstormItem, BrainstormConnection>({
  fetchNodesFn: ops.getBrainstormItems,
  fetchEdgesFn: ops.getBrainstormConnections,
  createNodeFn: ops.createBrainstormItem,
  updateNodeFn: ops.updateBrainstormItem,
  deleteNodeFn: ops.deleteBrainstormItem,
  createEdgeFn: ops.createBrainstormConnection,
  updateEdgeFn: ops.updateBrainstormConnection,
  deleteEdgeFn: ops.deleteBrainstormConnection,
});

export function useBrainstormData(boardId: string) {
  const { nodes, edges, loading, addNode, updateNode, removeNode, addEdge, updateEdge, removeEdge, refresh } = baseUseGraphData(boardId);

  return {
    items: nodes,
    connections: edges,
    loading,
    addItem: addNode,
    updateItem: updateNode,
    removeItem: removeNode,
    addConnection: addEdge,
    updateConnection: updateEdge,
    removeConnection: removeEdge,
    refresh,
  };
}
