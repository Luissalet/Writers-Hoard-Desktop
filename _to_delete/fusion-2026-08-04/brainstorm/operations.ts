// ============================================
// Brainstorm Engine — Database Operations
// ============================================

import { makeTableOps, makeCascadeDeleteOp } from '@/engines/_shared';
import { db } from '@/db';
import type { BrainstormBoard, BrainstormItem, BrainstormConnection } from './types';

// ===== Brainstorm Boards =====
const boardOps = makeTableOps<BrainstormBoard>({
  tableName: 'brainstormBoards',
  scopeField: 'projectId',
});

export const getBrainstormBoards = boardOps.getAll;
export const getBrainstormBoard = boardOps.getOne;
export const createBrainstormBoard = boardOps.create;
export const updateBrainstormBoard = boardOps.update;

// deleteBrainstormBoard cascades to items and connections
export const deleteBrainstormBoard = makeCascadeDeleteOp({
  tableName: 'brainstormBoards',
  cascades: [
    { table: 'brainstormItems', foreignKey: 'boardId' },
    { table: 'brainstormConnections', foreignKey: 'boardId' },
  ],
});

// ===== Brainstorm Items =====
const itemOps = makeTableOps<BrainstormItem>({
  tableName: 'brainstormItems',
  scopeField: 'boardId',
});

export const getBrainstormItems = itemOps.getAll;
export const getBrainstormItem = itemOps.getOne;
export const createBrainstormItem = itemOps.create;
export const updateBrainstormItem = itemOps.update;

// deleteBrainstormItem cascades to connections referencing this item
export async function deleteBrainstormItem(id: string): Promise<void> {
  await db.transaction('rw', ['brainstormItems', 'brainstormConnections'], async tx => {
    await tx.table('brainstormItems').delete(id);
    await tx.table('brainstormConnections').where('sourceId').equals(id).delete();
    await tx.table('brainstormConnections').where('targetId').equals(id).delete();
  });
}

// ===== Brainstorm Connections (no updatedAt + domain-specific deletes — kept manual) =====

export async function getBrainstormConnections(boardId: string): Promise<BrainstormConnection[]> {
  return db.table('brainstormConnections')
    .where('boardId')
    .equals(boardId)
    .toArray() as Promise<BrainstormConnection[]>;
}

export async function getBrainstormConnection(id: string): Promise<BrainstormConnection | undefined> {
  return db.table('brainstormConnections').get(id) as Promise<BrainstormConnection | undefined>;
}

export async function createBrainstormConnection(connection: BrainstormConnection): Promise<string> {
  return db.table('brainstormConnections').add(connection) as Promise<string>;
}

export async function updateBrainstormConnection(
  id: string,
  changes: Partial<BrainstormConnection>,
): Promise<void> {
  await db.table('brainstormConnections').update(id, changes);
}

export async function deleteBrainstormConnection(id: string): Promise<void> {
  await db.table('brainstormConnections').delete(id);
}

export async function deleteConnectionsBySource(sourceId: string): Promise<void> {
  await db.table('brainstormConnections').where('sourceId').equals(sourceId).delete();
}

export async function deleteConnectionsByTarget(targetId: string): Promise<void> {
  await db.table('brainstormConnections').where('targetId').equals(targetId).delete();
}
