import { makeTableOps } from '@/engines/_shared';
import type { CodexEntry } from '@/types';

export const codexEntryOps = makeTableOps<CodexEntry>({
  tableName: 'codexEntries',
  scopeField: 'projectId',
});
