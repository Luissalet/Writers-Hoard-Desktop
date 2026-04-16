import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { DiaryEntry } from './types';

export const useDiaryEntries = makeEntityHook<DiaryEntry>({
  fetchFn: ops.getEntries,
  createFn: ops.createEntry,
  updateFn: ops.updateEntry,
  deleteFn: ops.deleteEntry,
});
