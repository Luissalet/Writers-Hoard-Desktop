import { makeEntityHook, makeTableOps } from '@/engines/_shared';
import type { ExternalLink } from '@/types';

const externalLinkOps = makeTableOps<ExternalLink>({
  tableName: 'externalLinks',
  scopeField: 'projectId',
});

export const useExternalLinks = makeEntityHook<ExternalLink>({
  fetchFn: externalLinkOps.getAll,
  createFn: externalLinkOps.create,
  updateFn: externalLinkOps.update,
  deleteFn: externalLinkOps.delete,
});
