import { BridgeError, optString, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { WorkspaceAppearanceConflict, getWorkspaceAppearance } from './store';
import { addTheme, appearanceReplaceReceipt, applyThemeValues, deleteTheme, readThemeLibrary, themeDeltaReceipt, WorkspaceThemeError, type ThemeLibrary, type WorkspaceTheme } from './themeLibrary';
import { THEME_PRESETS } from './themePresets';
import type { WorkspaceAppearanceValues } from './types';
const revision = (args: ToolArgs, required: boolean) => {
  if (args.expectedRevision === undefined && !required) return undefined;
  if (!Number.isSafeInteger(args.expectedRevision) || Number(args.expectedRevision) < 0) throw new BridgeError('bad-args', 'expectedRevision must be the non-negative revision from the matching read.');
  return Number(args.expectedRevision);
};
const lookless = (values: WorkspaceAppearanceValues) => { const { backgroundImage, ...rest } = values; return { ...rest, ...(backgroundImage ? { hasBackgroundImage: true } : {}) }; };
const shape = (theme: WorkspaceTheme) => ({ id: theme.id, name: theme.name, createdAt: theme.createdAt, updatedAt: theme.updatedAt, values: lookless(theme.values) });
function failure(error: unknown): never {
  if (error instanceof BridgeError) throw error;
  if (error instanceof WorkspaceThemeError) {
    const text = { name: 'name must be 1 to 60 characters.', name_taken: 'A theme with that name already exists; choose another name.', not_found: 'No such theme; read wh_workspace_theme_list again.', conflict: 'The theme library changed; read wh_workspace_theme_list again.', full: 'The library is full (40 themes, 32 MB).', file: 'The values are not a valid appearance.', image: 'The embedded picture is not a valid PNG, JPEG or WebP up to 8 MB.' }[error.code];
    throw new BridgeError(error.code === 'conflict' ? 'conflict' : error.code === 'not_found' ? 'not-found' : 'bad-args', text);
  }
  if (error instanceof WorkspaceAppearanceConflict) throw new BridgeError('conflict', 'The appearance changed; read wh_workspace_appearance_get again.');
  throw error;
}
async function pick(args: ToolArgs, library: ThemeLibrary): Promise<WorkspaceTheme> {
  const id = optString(args, 'themeId'), found = library.themes.find(theme => theme.id === id);
  if (!found) throw new BridgeError('not-found', 'No such theme; read wh_workspace_theme_list.');
  return found;
}
// Only the theme that was added or removed (its picture bytes wait in the picture stash, keyed by hash): the audit line stays small.
const receipt = async (op: 'added' | 'removed', theme: WorkspaceTheme, after: ThemeLibrary) => ({ __workspaceThemes: await themeDeltaReceipt(op, theme, after.revision) });
export const WORKSPACE_THEME_HANDLERS = {
  async wh_workspace_theme_list() { const library = await readThemeLibrary(); return { revision: library.revision, themes: library.themes.map(shape), presets: THEME_PRESETS.map(preset => ({ id: preset.id, name: preset.en, nameEs: preset.es, values: preset.values })) }; },
  async wh_workspace_theme_save(args: ToolArgs) {
    try {
      const name = optString(args, 'name') ?? '';
      let values: WorkspaceAppearanceValues;
      if (args.values !== undefined) { if (!args.values || typeof args.values !== 'object' || Array.isArray(args.values)) throw new BridgeError('bad-args', 'values must be an object of appearance fields.'); values = args.values as WorkspaceAppearanceValues; }
      else { const read = await getWorkspaceAppearance({ projectId: resolveProjectId(args), eraId: optString(args, 'eraId') }); values = Object.fromEntries(Object.entries(read.effective).filter(([, value]) => value !== null && value !== undefined)); }
      const { library, theme } = await addTheme({ name, values }, revision(args, false));
      return withAudit({ revision: library.revision, theme: shape(theme) }, { entityId: theme.id, kind: 'create', summary: `saved the workspace theme “${theme.name}”`, before: await receipt('added', theme, library) });
    } catch (error) { return failure(error); }
  },
  async wh_workspace_theme_apply(args: ToolArgs) {
    try {
      const library = await readThemeLibrary(), theme = await pick(args, library), scope = { projectId: resolveProjectId(args), eraId: optString(args, 'eraId') };
      const before = await getWorkspaceAppearance(scope), saved = await applyThemeValues(scope, theme.values, revision(args, true)!);
      return withAudit({ projectId: scope.projectId, ...(scope.eraId ? { eraId: scope.eraId } : {}), revision: saved.revision, theme: { id: theme.id, name: theme.name }, applied: Object.keys(theme.values) }, { projectId: scope.projectId, entityId: theme.id, kind: 'update', summary: `applied the workspace theme “${theme.name}” to ${scope.eraId ? 'an era' : 'Base'}`, before: { __workspaceAppearanceReplace: await appearanceReplaceReceipt(scope.eraId, before.own, saved.revision) } });
    } catch (error) { return failure(error); }
  },
  async wh_workspace_theme_delete(args: ToolArgs) {
    try {
      const before = await readThemeLibrary(), found = await pick(args, before), { library } = await deleteTheme(found.id, revision(args, true));
      return withAudit({ revision: library.revision, deleted: { id: found.id, name: found.name } }, { entityId: found.id, kind: 'update', summary: `deleted the workspace theme “${found.name}”`, before: await receipt('removed', found, library) });
    } catch (error) { return failure(error); }
  },
};
