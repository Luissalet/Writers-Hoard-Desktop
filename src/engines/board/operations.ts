// ============================================
// Board Engine — Database Operations
// ============================================
//
// The canvas writes through a batching queue (see `useBoardGraph`), so this
// layer exposes bulk puts alongside the single-row CRUD. Dragging thirty
// selected cards must cost one transaction, not thirty.

import { db } from '@/db';
import { deleteEntityAnnotations, makeCascadeDeleteOp, makeTableOps } from '@/engines/_shared';
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

const deleteBoardRow = makeCascadeDeleteOp({
  tableName: 'boards',
  cascades: [
    { table: 'boardNodes', foreignKey: 'boardId' },
    { table: 'boardEdges', foreignKey: 'boardId' },
    { table: 'boardLayers', foreignKey: 'boardId' },
    { table: 'boardViews', foreignKey: 'boardId' },
  ],
});

/**
 * Deleting a board takes its margin notes with it.
 *
 * `BoardEngine` mounts an `AnnotationSurface` with `sourceEngineId: 'board'`,
 * so a board is annotated like any scene or writing — but it was the one
 * annotated engine whose delete never called `deleteEntityAnnotations`, and
 * the cascade above only knew about the board's own tables. The notes and
 * their reference rows stayed in Dexie pointing at a board that no longer
 * existed: invisible, unreachable, and never collected.
 */
export async function deleteBoard(id: string): Promise<void> {
  await db.transaction(
    'rw',
    ['boards', 'boardNodes', 'boardEdges', 'boardLayers', 'boardViews', 'annotations', 'annotationReferences'],
    async () => {
      await deleteEntityAnnotations('board', id);
      await deleteBoardRow(id);
    },
  );
}

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

// ===== Canvas write queue =====

export interface BoardBatch {
  nodePuts: BoardNode[];
  edgePuts: BoardEdge[];
  nodeDeletes: string[];
  edgeDeletes: string[];
}

/**
 * One flush of the canvas queue, as a single transaction. Run as four separate
 * awaits a quota error part-way through left the board half-written — nodes
 * saved without the edges that gave them meaning — and the queue had already
 * been emptied, so nothing would ever go back for the rest.
 */
export async function commitBoardBatch(batch: BoardBatch): Promise<void> {
  await db.transaction('rw', [db.boardNodes, db.boardEdges], async () => {
    // Deletes first: an edge row that references a node being removed must
    // not be re-inserted by a put queued earlier in the same batch.
    if (batch.edgeDeletes.length > 0) await db.boardEdges.bulkDelete(batch.edgeDeletes);
    if (batch.nodeDeletes.length > 0) await db.boardNodes.bulkDelete(batch.nodeDeletes);
    if (batch.nodePuts.length > 0) await db.boardNodes.bulkPut(batch.nodePuts);
    if (batch.edgePuts.length > 0) await db.boardEdges.bulkPut(batch.edgePuts);
  });
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
