import { makeTableOps } from '@/engines/_shared';
import type { DiaryEntry } from './types';

const ops = makeTableOps<DiaryEntry>({
  tableName: 'diaryEntries',
  scopeField: 'projectId',
  // Pinned entries float to the top, as types.ts promises and the pin button
  // implies. The sort used to ignore `pinned` entirely, so pinning an entry
  // changed precisely nothing on screen.
  sortFn: (a, b) =>
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    b.entryDate.localeCompare(a.entryDate),
});

export const getEntries = ops.getAll;
export const getEntry = ops.getOne;
export const createEntry = ops.create;
export const updateEntry = ops.update;
export const deleteEntry = ops.delete;
