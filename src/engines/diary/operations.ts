import { db } from '@/db';
import type { DiaryEntry } from './types';

export async function getEntries(projectId: string): Promise<DiaryEntry[]> {
  const entries = await db.table('diaryEntries').where('projectId').equals(projectId).toArray();
  // Most recent first
  return entries.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
}

export async function getEntry(id: string): Promise<DiaryEntry | undefined> {
  return db.table('diaryEntries').get(id);
}

export async function createEntry(entry: DiaryEntry): Promise<string> {
  return (await db.table('diaryEntries').add(entry)) as string;
}

export async function updateEntry(id: string, changes: Partial<DiaryEntry>): Promise<void> {
  await db.table('diaryEntries').update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteEntry(id: string): Promise<void> {
  await db.table('diaryEntries').delete(id);
}
