import { makeTableOps } from '@/engines/_shared';
import type { DiaryEntry } from './types';

const ops = makeTableOps<DiaryEntry>({
  tableName: 'diaryEntries',
  scopeField: 'projectId',
  sortFn: (a, b) => b.entryDate.localeCompare(a.entryDate),
});

export const getEntries = ops.getAll;
export const getEntry = ops.getOne;
export const createEntry = ops.create;
export const updateEntry = ops.update;
export const deleteEntry = ops.delete;
