import { BridgeError, optString, resolveProjectId, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { getWorkspaceAppearance, resetWorkspaceAppearance, saveWorkspaceAppearance } from './store';
import { normalizeAppearance } from './validation';
const scope = (args: ToolArgs) => ({ projectId: resolveProjectId(args), eraId: optString(args, 'eraId') });
function revision(args: ToolArgs) { if (!Number.isSafeInteger(args.expectedRevision) || Number(args.expectedRevision) < 0) throw new BridgeError('bad-args', 'expectedRevision must be the non-negative revision from get.'); return Number(args.expectedRevision); }
export const WORKSPACE_APPEARANCE_HANDLERS = {
  wh_workspace_appearance_get: (args: ToolArgs) => getWorkspaceAppearance(scope(args)),
  wh_workspace_appearance_save: (args: ToolArgs) => saveWorkspaceAppearance(scope(args), normalizeAppearance(args.patch), revision(args)),
  wh_workspace_appearance_reset: (args: ToolArgs) => resetWorkspaceAppearance(scope(args), revision(args)),
};
