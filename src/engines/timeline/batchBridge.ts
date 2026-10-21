import { applyTimelineBatch, timelineBatchTargets, undoTimelineBatch, type TimelineBatchTarget } from './eventBatch';
import { optString, requireString, resolveProjectForEngine, type ToolArgs } from '@/services/aiBridge/tools/shared';
const scope = (args: ToolArgs) => ({ projectId: requireString(args, 'projectId'), eraId: optString(args, 'eraId') });
export const TIMELINE_BATCH_HANDLERS = {
  wh_timeline_batch_preview: async (args: ToolArgs) => ({ targets: await timelineBatchTargets(scope(args)) }),
  wh_timeline_batch_apply: async (args: ToolArgs) => {
    const target = { projectId: await resolveProjectForEngine(args, 'timeline'), eraId: optString(args, 'eraId') };
    if (!Array.isArray(args.eventIds) || args.eventIds.some(id => typeof id !== 'string') || !Array.isArray(args.expectedTargets) || args.expectedTargets.some(item => !item || typeof item !== 'object' || typeof item.timelineId !== 'string' || typeof item.version !== 'string')) throw Error('timeline_batch_invalid_selection');
    if (args.kind !== 'shift' && args.kind !== 'remove') throw Error('timeline_batch_invalid_action');
    return applyTimelineBatch(target, args.eventIds as string[], args.kind === 'shift' ? { kind: 'shift', days: args.days as number } : { kind: 'remove' }, args.expectedTargets as TimelineBatchTarget[]);
  },
  // Undo restores an already applied session receipt, also when its engine is off.
  wh_timeline_batch_undo: (args: ToolArgs) => undoTimelineBatch(scope(args), requireString(args, 'receiptId')),
};
