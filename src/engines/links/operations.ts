import { makeTableOps } from '@/engines/_shared';
import type { ExternalLink } from '@/types';

export const externalLinkOps = makeTableOps<ExternalLink>({
  tableName: 'externalLinks',
  scopeField: 'projectId',
});
