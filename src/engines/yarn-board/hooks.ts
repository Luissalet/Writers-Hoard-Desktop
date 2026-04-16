import { useState, useEffect, useCallback } from 'react';
import type { YarnBoard, YarnNode, YarnEdge } from '@/types';
import * as ops from './operations';

export function useYarnBoards(projectId: string) {
  const [boards, setBoards] = useState<YarnBoard[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const data = await ops.getYarnBoards(projectId);
    setBoards(data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addBoard = useCallback(async (board: YarnBoard) => {
    await ops.createYarnBoard(board);
    await refresh();
  }, [refresh]);

  const removeBoard = useCallback(async (id: string) => {
    await ops.deleteYarnBoard(id);
    await refresh();
  }, [refresh]);

  return { boards, loading, refresh, addBoard, removeBoard };
}

export function useYarnBoardData(boardId: string) {
  const [nodes, setNodes] = useState<YarnNode[]>([]);
  const [edges, setEdges] = useState<YarnEdge[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    const [n, e] = await Promise.all([
      ops.getYarnNodes(boardId),
      ops.getYarnEdges(boardId),
    ]);
    setNodes(n);
    setEdges(e);
    setLoading(false);
  }, [boardId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addNode = useCallback(async (node: YarnNode) => {
    await ops.createYarnNode(node);
    await refresh();
  }, [refresh]);

  const updateNode = useCallback(async (id: string, changes: Partial<YarnNode>) => {
    await ops.updateYarnNode(id, changes);
    await refresh();
  }, [refresh]);

  const removeNode = useCallback(async (id: string) => {
    await ops.deleteYarnNode(id);
    await refresh();
  }, [refresh]);

  const addEdge = useCallback(async (edge: YarnEdge) => {
    await ops.createYarnEdge(edge);
    await refresh();
  }, [refresh]);

  const updateEdge = useCallback(async (id: string, changes: Partial<YarnEdge>) => {
    await ops.updateYarnEdge(id, changes);
    await refresh();
  }, [refresh]);

  const removeEdge = useCallback(async (id: string) => {
    await ops.deleteYarnEdge(id);
    await refresh();
  }, [refresh]);

  return { nodes, edges, loading, refresh, addNode, updateNode, removeNode, addEdge, updateEdge, removeEdge };
}
