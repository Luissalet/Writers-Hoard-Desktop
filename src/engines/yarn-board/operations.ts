// ============================================
// Yarn Board Engine — Database Operations
// ============================================

import { db } from '@/db';
import type { YarnBoard, YarnNode, YarnEdge } from '@/types';

// ===== Yarn Boards =====

export async function getYarnBoards(projectId: string): Promise<YarnBoard[]> {
  return db.yarnBoards.where('projectId').equals(projectId).toArray();
}

export async function createYarnBoard(board: YarnBoard): Promise<string> {
  return db.yarnBoards.add(board);
}

export async function deleteYarnBoard(id: string): Promise<void> {
  await db.transaction('rw', [db.yarnBoards, db.yarnNodes, db.yarnEdges], async () => {
    await db.yarnBoards.delete(id);
    await db.yarnNodes.where('boardId').equals(id).delete();
    await db.yarnEdges.where('boardId').equals(id).delete();
  });
}

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
