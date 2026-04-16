// ============================================
// Writings Engine — Database Operations
// ============================================

import { db } from '@/db';
import type { Writing } from '@/types';

export async function getWritings(projectId: string): Promise<Writing[]> {
  return db.writings.where('projectId').equals(projectId).toArray();
}

export async function getWriting(id: string): Promise<Writing | undefined> {
  return db.writings.get(id);
}

export async function createWriting(writing: Writing): Promise<string> {
  return db.writings.add(writing);
}

export async function updateWriting(id: string, changes: Partial<Writing>): Promise<void> {
  await db.writings.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteWriting(id: string): Promise<void> {
  await db.writings.delete(id);
}
