import { makeReadOnlyHook } from '@/engines/_shared';
import { computeUsage } from './operations';
import type { PovAuditReport } from './types';

/**
 * The audit "report" is a single computed value per project, but we reuse the
 * read-only collection hook by wrapping the report in a single-element array.
 * Consumers extract `items[0]` and treat it as the active report.
 *
 * This keeps the hook contract uniform with every other engine — no special
 * single-value hook surface to learn.
 */
export const useUsageReport = makeReadOnlyHook<PovAuditReport>({
  fetchFn: async (projectId: string) => [await computeUsage(projectId)],
});
