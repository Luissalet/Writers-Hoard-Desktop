// ============================================
// Yarn Board Engine — Database Operations
// ============================================

import { db } from '@/db';
import { makeCascadeDeleteOp } from '@/engines/_shared';
import type { YarnBoard, YarnNode, YarnEdge } from '@/types';

// ===== Yarn Boards =====

export async function getYarnBoards(projectId: string): Promise<YarnBoard[]> {
  return db.yarnBoards.where('projectId').equals(projectId).toArray();
}

export async function createYarnBoard(board: YarnBoard): Promise<string> {
  return db.yarnBoards.add(board);
}

export async function updateYarnBoard(id: string, changes: Partial<YarnBoard>): Promise<void> {
  await db.yarnBoards.update(id, changes);
}

export const deleteYarnBoard = makeCascadeDeleteOp({
  tableName: 'yarnBoards',
  cascades: [
    { table: 'yarnNodes', foreignKey: 'boardId' },
    { table: 'yarnEdges', foreignKey: 'boardId' },
  ],
});

// ===== Yarn Nodes =====

export async function getYarnNodes(boardId: string): Promise<YarnNode[]> {
  return db.yarnNodes.where('boardId').equals(boardId).toArray();
}

export async function createYarnNode(node: YarnNode): Promise<string> {
  return db.yarnNodes.add(node);
}

export async function updateYarnNode(id: string, changes: Partial<YarnNode>): Promise<void> {
  await db.yarnNodes.update(id, changes);
}

export async function deleteYarnNode(id: string): Promise<void> {
  await db.yarnNodes.delete(id);
}

// ===== Yarn Edges =====

export async function getYarnEdges(boardId: string): Promise<YarnEdge[]> {
  return db.yarnEdges.where('boardId').equals(boardId).toArray();
}

export async function createYarnEdge(edge: YarnEdge): Promise<string> {
  return db.yarnEdges.add(edge);
}

export async function updateYarnEdge(id: string, changes: Partial<YarnEdge>): Promise<void> {
  await db.yarnEdges.update(id, changes);
}

export async function deleteYarnEdge(id: string): Promise<void> {
  await db.yarnEdges.delete(id);
}
