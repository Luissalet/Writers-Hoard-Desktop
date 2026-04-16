import { makeTableOps } from '@/engines/_shared';
import { db } from '@/db';
import type { WritingSession, WritingGoal } from './types';

// ============================================================================
// WritingSession operations
// ============================================================================

const sessionOps = makeTableOps<WritingSession>({
  tableName: 'writingSessions',
  scopeField: 'projectId',
  sortFn: (a, b) => b.createdAt - a.createdAt,
});

export const getSessions = sessionOps.getAll;
export const getSession = sessionOps.getOne;
export const createSession = sessionOps.create;
export const updateSession = sessionOps.update;
export const deleteSession = sessionOps.delete;

export async function getSessionsByDateRange(
  projectId: string,
  startDate: string,
  endDate: string
): Promise<WritingSession[]> {
  return db
    .table('writingSessions')
    .where('projectId')
    .equals(projectId)
    .filter((s) => s.date >= startDate && s.date <= endDate)
    .toArray();
}

export async function getTodaySessions(projectId: string): Promise<WritingSession[]> {
  const today = new Date().toISOString().split('T')[0];
  return db
    .table('writingSessions')
    .where('projectId')
    .equals(projectId)
    .filter((s) => s.date === today)
    .toArray();
}

// ============================================================================
// WritingGoal operations
// ============================================================================

const goalOps = makeTableOps<WritingGoal>({
  tableName: 'writingGoals',
  scopeField: 'projectId',
  sortFn: (a, b) => b.updatedAt - a.updatedAt,
});

export const getGoals = goalOps.getAll;
export const getGoal = goalOps.getOne;
export const createGoal = goalOps.create;
export const updateGoal = goalOps.update;
export const deleteGoal = goalOps.delete;

export async function getActiveGoals(projectId: string): Promise<WritingGoal[]> {
  return db
    .table('writingGoals')
    .where('projectId')
    .equals(projectId)
    .filter((g) => g.active)
    .toArray();
}
