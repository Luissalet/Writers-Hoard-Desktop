import { makeEntityHook, makeTableOps } from '@/engines/_shared';
import type { CodexEntry } from '@/types';

const codexEntryOps = makeTableOps<CodexEntry>({
  tableName: 'codexEntries',
  scopeField: 'projectId',
});

export const useCodexEntries = makeEntityHook<CodexEntry>({
  fetchFn: codexEntryOps.getAll,
  createFn: codexEntryOps.create,
  updateFn: codexEntryOps.update,
  deleteFn: codexEntryOps.delete,
});
