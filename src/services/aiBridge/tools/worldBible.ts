import { buildWorldBible, exportWorldBible, loadBibleData, type BibleSelection } from '@/services/worldBible';
import { BridgeError, resolveProjectId, type ToolArgs } from './shared';
function selection(args: ToolArgs): BibleSelection {
  if (args.locale !== undefined && args.locale !== 'es' && args.locale !== 'en') throw new BridgeError('bad-args', 'Invalid locale');
  if (args.includeSecrets !== undefined && typeof args.includeSecrets !== 'boolean') throw new BridgeError('bad-args', 'Invalid includeSecrets');
  return { sections: args.sections, entryIds: args.entryIds, timelineIds: args.timelineIds, mapIds: args.mapIds, relationshipIds: args.relationshipIds, includeSecrets: args.includeSecrets, locale: args.locale } as BibleSelection;
}
export async function whBuildWorldBible(args: ToolArgs) {
  const projectId = resolveProjectId(args);
  return buildWorldBible(await loadBibleData(projectId), selection(args));
}
export async function whExportWorldBible(args: ToolArgs) {
  if (args.format !== 'html' && args.format !== 'pdf') throw new BridgeError('bad-args', 'format must be html or pdf');
  return exportWorldBible(resolveProjectId(args), selection(args), args.format);
}
