// ============================================
// Board Engine — Database Operations
// ============================================
//
// The canvas writes through a batching queue (see `useBoardGraph`), so this
// layer exposes bulk puts alongside the single-row CRUD. Dragging thirty
// selected cards must cost one transaction, not thirty.

import { db } from '@/db';
import { makeCascadeDeleteOp, makeTableOps } from '@/engines/_shared';
import { planDeletion } from './graph/mutations';
import type { Board, BoardEdge, BoardLayer, BoardNode, BoardView } from './types';

// ===== Boards =====

const boardOps = makeTableOps<Board>({
  tableName: 'boards',
  scopeField: 'projectId',
  sortFn: (a, b) => a.createdAt - b.createdAt,
});

export const getBoards = boardOps.getAll;
export const getBoard = boardOps.getOne;
export const createBoard = boardOps.create;
export const updateBoard = boardOps.update;

export const deleteBoard = makeCascadeDeleteOp({
  tableName: 'boards',
  cascades: [
    { table: 'boardNodes', foreignKey: 'boardId' },
    { table: 'boardEdges', foreignKey: 'boardId' },
    { table: 'boardLayers', foreignKey: 'boardId' },
    { table: 'boardViews', foreignKey: 'boardId' },
  ],
});

// ===== Nodes =====

const nodeOps = makeTableOps<BoardNode>({ tableName: 'boardNodes', scopeField: 'boardId' });

export const getBoardNodes = nodeOps.getAll;
export const getBoardNode = nodeOps.getOne;
export const createBoardNode = nodeOps.create;
export const updateBoardNode = nodeOps.update;

/**
 * Deleting a node takes every relation it participated in with it, including
 * hyper-edges that would be left with an empty side and the meta-edges that
 * annotated those. Leaving a dangling relation behind was the single most
 * common integrity issue in the old engines.
 *
 * The canvas does not go through here — it owns the whole board in memory and
 * runs `planDeletion` itself so undo can restore the exact same set. This is
 * the entry point for callers outside the canvas.
 */
export async function deleteBoardNode(id: string): Promise<void> {
  await deleteBoardNodes([id]);
}

export async function deleteBoardNodes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction('rw', [db.boardNodes, db.boardEdges], async () => {
    const rows = (await db.boardNodes.bulkGet(ids)).filter((row): row is BoardNode => Boolean(row));
    const boardIds = Array.from(new Set(rows.map((node) => node.boardId)));
    if (boardIds.length === 0) return;
    const [nodes, edges] = await Promise.all([
      db.boardNodes.where('boardId').anyOf(boardIds).toArray(),
      db.boardEdges.where('boardId').anyOf(boardIds).toArray(),
    ]);
    const plan = planDeletion(nodes, edges, ids);
    if (plan.removedEdgeIds.length) await db.boardEdges.bulkDelete(plan.removedEdgeIds);
    if (plan.rewrittenEdges.length) await db.boardEdges.bulkPut(plan.rewrittenEdges);
    await db.boardNodes.bulkDelete(plan.removedNodeIds);
  });
}

export async function putBoardNodes(nodes: BoardNode[]): Promise<void> {
  if (nodes.length === 0) return;
  await db.boardNodes.bulkPut(nodes);
}

/** Raw delete with no cascade — used by the canvas, which plans its own. */
export async function rawDeleteBoardNodes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.boardNodes.bulkDelete(ids);
}

// ===== Edges =====

export async function getBoardEdges(boardId: string): Promise<BoardEdge[]> {
  return db.boardEdges.where('boardId').equals(boardId).toArray();
}

export async function getBoardEdge(id: string): Promise<BoardEdge | undefined> {
  return db.boardEdges.get(id);
}

export async function createBoardEdge(edge: BoardEdge): Promise<string> {
  return db.boardEdges.add(edge);
}

export async function updateBoardEdge(id: string, changes: Partial<BoardEdge>): Promise<void> {
  await db.boardEdges.update(id, { ...changes, updatedAt: Date.now() });
}

/** Removes edges and anything anchored on them, transitively. */
export async function deleteBoardEdges(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction('rw', [db.boardEdges], async () => {
    const rows = (await db.boardEdges.bulkGet(ids)).filter((row): row is BoardEdge => Boolean(row));
    const boardIds = Array.from(new Set(rows.map((edge) => edge.boardId)));
    if (boardIds.length === 0) return;
    const all = await db.boardEdges.where('boardId').anyOf(boardIds).toArray();
    const plan = planDeletion([], all, [], ids);
    await db.boardEdges.bulkDelete(plan.removedEdgeIds);
  });
}

export async function deleteBoardEdge(id: string): Promise<void> {
  await deleteBoardEdges([id]);
}

export async function putBoardEdges(edges: BoardEdge[]): Promise<void> {
  if (edges.length === 0) return;
  await db.boardEdges.bulkPut(edges);
}

/** Raw delete with no cascade — used by the canvas, which plans its own. */
export async function rawDeleteBoardEdges(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.boardEdges.bulkDelete(ids);
}

// ===== Layers =====

const layerOps = makeTableOps<BoardLayer>({
  tableName: 'boardLayers',
  scopeField: 'boardId',
  sortFn: (a, b) => a.order - b.order,
});

export const getBoardLayers = layerOps.getAll;
export const createBoardLayer = layerOps.create;
export const updateBoardLayer = layerOps.update;

/** Deleting a layer never deletes content — its elements return to no layer. */
export async function deleteBoardLayer(id: string): Promise<void> {
  await db.transaction('rw', [db.boardLayers, db.boardNodes, db.boardEdges], async () => {
    const layer = await db.boardLayers.get(id);
    if (!layer) return;
    await db.boardNodes
      .where('boardId')
      .equals(layer.boardId)
      .modify((node) => {
        if (node.layerId === id) node.layerId = undefined;
      });
    await db.boardEdges
      .where('boardId')
      .equals(layer.boardId)
      .modify((edge) => {
        if (edge.layerId === id) edge.layerId = undefined;
      });
    await db.boardLayers.delete(id);
  });
}

// ===== Views =====

const viewOps = makeTableOps<BoardView>({
  tableName: 'boardViews',
  scopeField: 'boardId',
  sortFn: (a, b) => a.order - b.order,
});

export const getBoardViews = viewOps.getAll;
export const createBoardView = viewOps.create;
export const updateBoardView = viewOps.update;
export const deleteBoardView = viewOps.delete;
