// Named workspace themes, kept app-wide (one `settings` row, so full backups carry them).
// A theme is a complete look: applying one REPLACES the scope's own appearance through the
// normal revision-checked save, it never writes the project row itself.
import { getSetting, updateSetting } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import { normalizeAppearance, validateRasterImage } from './validation';
import { saveWorkspaceAppearance } from './store';
import { fatValues, slimValues, type SlimValues } from './pictureStash';
import type { AppearanceRead, AppearanceScope, WorkspaceAppearanceValues } from './types';

export const THEME_LIBRARY_KEY = 'workspaceThemes.library';
export const MAX_THEMES = 40;
export const MAX_THEME_NAME = 60;
/** Whole library, embedded pictures included. Single pictures are already capped at 8 MB. */
export const MAX_LIBRARY_CHARS = 32 * 1024 * 1024;
export const THEME_FILE_KIND = 'writer-workspace-themes';

export interface WorkspaceTheme { id: string; name: string; values: WorkspaceAppearanceValues; createdAt: number; updatedAt: number }
export interface ThemeLibrary { revision: number; themes: WorkspaceTheme[] }
export interface ThemeLibraryReceipt { before: ThemeLibrary; afterRevision: number }

/** What a library change did, without the rest of the library or any picture bytes (those wait in the picture stash). */
export interface ThemeDeltaReceipt {
  op: 'added' | 'removed';
  theme: { id: string; name: string; createdAt: number; updatedAt: number } & SlimValues;
  afterRevision: number;
}
export interface AppearanceReplaceReceipt { eraId: string | null; previousOwn: Record<string, unknown>; backgroundImageRef?: string; afterRevision: number }

export class WorkspaceThemeError extends Error {
  readonly code: 'name' | 'name_taken' | 'not_found' | 'conflict' | 'full' | 'file' | 'image';
  constructor(code: WorkspaceThemeError['code']) { super(`workspace_theme_${code}`); this.name = 'WorkspaceThemeError'; this.code = code; }
}

export function cleanThemeName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > MAX_THEME_NAME) throw new WorkspaceThemeError('name');
  return name;
}
const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Only the look itself: drops nothing silently, rejects unknown or invalid fields. */
export function themeValues(value: unknown): WorkspaceAppearanceValues {
  try { return normalizeAppearance(value); } catch { throw new WorkspaceThemeError('file'); }
}
async function checkImage(values: WorkspaceAppearanceValues) {
  if (values.backgroundImage) { try { await validateRasterImage(values.backgroundImage); } catch { throw new WorkspaceThemeError('image'); } }
}

/** Tolerant reader: a damaged row or entry is skipped, never thrown at the app. */
export function parseThemeLibrary(raw: string | undefined): ThemeLibrary {
  if (!raw) return { revision: 0, themes: [] };
  try {
    const data = JSON.parse(raw) as { revision?: unknown; themes?: unknown };
    const themes: WorkspaceTheme[] = [];
    for (const item of Array.isArray(data.themes) ? data.themes : []) {
      try {
        const row = item as Partial<WorkspaceTheme>;
        if (typeof row.id !== 'string' || !row.id) continue;
        themes.push({ id: row.id, name: cleanThemeName(row.name), values: normalizeAppearance(row.values ?? {}), createdAt: Number(row.createdAt) || 0, updatedAt: Number(row.updatedAt) || 0 });
      } catch { /* skip the damaged entry */ }
    }
    return { revision: Number.isSafeInteger(data.revision) && Number(data.revision) >= 0 ? Number(data.revision) : 0, themes };
  } catch { return { revision: 0, themes: [] }; }
}
export async function readThemeLibrary(): Promise<ThemeLibrary> { return parseThemeLibrary(await getSetting(THEME_LIBRARY_KEY)); }

/** One atomic read-change-write. `expected` (when given) must equal the stored revision. */
async function change(expected: number | undefined, mutate: (library: ThemeLibrary) => ThemeLibrary): Promise<ThemeLibrary> {
  let saved: ThemeLibrary | undefined;
  await updateSetting(THEME_LIBRARY_KEY, current => {
    const library = parseThemeLibrary(current);
    if (expected !== undefined && expected !== library.revision) throw new WorkspaceThemeError('conflict');
    const next = mutate(library);
    if (next.themes.length > MAX_THEMES) throw new WorkspaceThemeError('full');
    saved = { revision: library.revision + 1, themes: next.themes };
    const text = JSON.stringify(saved);
    if (text.length > MAX_LIBRARY_CHARS) throw new WorkspaceThemeError('full');
    return text;
  });
  return saved!;
}

export interface ThemeInput { name: string; values: WorkspaceAppearanceValues }
/** Adds themes; a name already in use gets " (2)", " (3)"… so imports never overwrite. */
function withNames(library: ThemeLibrary, inputs: readonly ThemeInput[], now: number, mode: 'strict' | 'suffix'): WorkspaceTheme[] {
  const taken = library.themes.map(theme => theme.name), added: WorkspaceTheme[] = [];
  for (const input of inputs) {
    let name = input.name;
    if (taken.some(item => sameName(item, name))) {
      if (mode === 'strict') throw new WorkspaceThemeError('name_taken');
      let n = 2; while (taken.some(item => sameName(item, `${input.name.slice(0, MAX_THEME_NAME - 6)} (${n})`))) n++;
      name = `${input.name.slice(0, MAX_THEME_NAME - 6)} (${n})`;
    }
    taken.push(name);
    added.push({ id: generateId('theme'), name, values: input.values, createdAt: now, updatedAt: now });
  }
  return added;
}

export async function addTheme(input: ThemeInput, expected?: number): Promise<{ library: ThemeLibrary; theme: WorkspaceTheme }> {
  const name = cleanThemeName(input.name), values = themeValues(input.values); await checkImage(values);
  let theme!: WorkspaceTheme;
  const library = await change(expected, current => { [theme] = withNames(current, [{ name, values }], Date.now(), 'strict'); return { ...current, themes: [...current.themes, theme] }; });
  return { library, theme };
}
export async function importThemes(inputs: readonly ThemeInput[]): Promise<{ library: ThemeLibrary; added: WorkspaceTheme[] }> {
  const clean = inputs.map(input => ({ name: cleanThemeName(input.name), values: themeValues(input.values) }));
  for (const input of clean) await checkImage(input.values);
  let added: WorkspaceTheme[] = [];
  const library = await change(undefined, current => { added = withNames(current, clean, Date.now(), 'suffix'); return { ...current, themes: [...current.themes, ...added] }; });
  return { library, added };
}
export async function renameTheme(id: string, name: string, expected?: number): Promise<{ library: ThemeLibrary; theme: WorkspaceTheme }> {
  const next = cleanThemeName(name); let theme!: WorkspaceTheme;
  const library = await change(expected, current => {
    const found = current.themes.find(item => item.id === id); if (!found) throw new WorkspaceThemeError('not_found');
    if (current.themes.some(item => item.id !== id && sameName(item.name, next))) throw new WorkspaceThemeError('name_taken');
    theme = { ...found, name: next, updatedAt: Date.now() };
    return { ...current, themes: current.themes.map(item => item.id === id ? theme : item) };
  });
  return { library, theme };
}
export async function deleteTheme(id: string, expected?: number): Promise<{ library: ThemeLibrary; theme: WorkspaceTheme }> {
  let theme!: WorkspaceTheme;
  const library = await change(expected, current => {
    const found = current.themes.find(item => item.id === id); if (!found) throw new WorkspaceThemeError('not_found');
    theme = found; return { ...current, themes: current.themes.filter(item => item.id !== id) };
  });
  return { library, theme };
}
/** Undo of a library change: only while nobody changed the library since (else conflict, never forced). */
export async function restoreThemeLibrary(receipt: ThemeLibraryReceipt): Promise<ThemeLibrary> {
  return change(receipt.afterRevision, () => ({ revision: 0, themes: receipt.before.themes }));
}

export async function themeDeltaReceipt(op: ThemeDeltaReceipt['op'], theme: WorkspaceTheme, afterRevision: number): Promise<ThemeDeltaReceipt> {
  const slim = await slimValues(theme.values as Record<string, unknown>);
  return { op, afterRevision, theme: { id: theme.id, name: theme.name, createdAt: theme.createdAt, updatedAt: theme.updatedAt, ...slim } };
}
/** Undo of one add or delete: only while nobody changed the library since; a deleted theme's picture must still be in the stash. */
export async function undoThemeDelta(receipt: ThemeDeltaReceipt): Promise<ThemeLibrary> {
  if (receipt.op === 'added') return change(receipt.afterRevision, library => ({ ...library, themes: library.themes.filter(item => item.id !== receipt.theme.id) }));
  const values = themeValues(await fatValues(receipt.theme));
  return change(receipt.afterRevision, library => {
    if (library.themes.some(item => item.id === receipt.theme.id || sameName(item.name, receipt.theme.name))) throw new WorkspaceThemeError('conflict');
    return { ...library, themes: [...library.themes, { id: receipt.theme.id, name: receipt.theme.name, values, createdAt: receipt.theme.createdAt, updatedAt: receipt.theme.updatedAt }] };
  });
}
export async function appearanceReplaceReceipt(eraId: string | undefined, previousOwn: WorkspaceAppearanceValues, afterRevision: number): Promise<AppearanceReplaceReceipt> {
  const { values, backgroundImageRef } = await slimValues(previousOwn as Record<string, unknown>);
  return { eraId: eraId ?? null, previousOwn: values, ...(backgroundImageRef ? { backgroundImageRef } : {}), afterRevision };
}
/** Undo of a theme apply from its slim receipt; refused when the stashed picture is gone or the profile moved on. */
export async function undoAppearanceReplace(projectId: string, receipt: AppearanceReplaceReceipt): Promise<AppearanceRead> {
  const previous = await fatValues({ values: receipt.previousOwn, backgroundImageRef: receipt.backgroundImageRef });
  return restoreAppearanceOwn({ projectId, eraId: receipt.eraId ?? undefined }, previous as WorkspaceAppearanceValues, receipt.afterRevision);
}

/** Replaces the scope's own look with the theme's, through the revision-checked appearance save. */
export function applyThemeValues(scope: AppearanceScope, values: WorkspaceAppearanceValues, expectedRevision: number): Promise<AppearanceRead> {
  return saveWorkspaceAppearance(scope, values, expectedRevision, true);
}

// ---- JSON files ----------------------------------------------------------------------------

export function themesToJson(themes: readonly WorkspaceTheme[]): string {
  return JSON.stringify({ kind: THEME_FILE_KIND, version: 1, themes: themes.map(theme => ({ name: theme.name, values: theme.values })) }, null, 1);
}
/** Throws WorkspaceThemeError('file') for anything that is not a theme file we wrote. */
export async function themesFromJson(text: string): Promise<ThemeInput[]> {
  if (text.length > MAX_LIBRARY_CHARS) throw new WorkspaceThemeError('file');
  let data: unknown; try { data = JSON.parse(text); } catch { throw new WorkspaceThemeError('file'); }
  const file = data as { kind?: unknown; version?: unknown; themes?: unknown };
  if (!file || typeof file !== 'object' || file.kind !== THEME_FILE_KIND || file.version !== 1 || !Array.isArray(file.themes) || file.themes.length === 0 || file.themes.length > MAX_THEMES) throw new WorkspaceThemeError('file');
  const out: ThemeInput[] = [];
  for (const item of file.themes) {
    const row = item as { name?: unknown; values?: unknown };
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => key !== 'name' && key !== 'values')) throw new WorkspaceThemeError('file');
    let name: string; try { name = cleanThemeName(row.name); } catch { throw new WorkspaceThemeError('file'); }
    const values = themeValues(row.values); await checkImage(values); out.push({ name, values });
  }
  return out;
}

/** Undo of an apply: puts the previous own values back, only while the profile is still at the revision the apply wrote. */
export function restoreAppearanceOwn(scope: AppearanceScope, previousOwn: WorkspaceAppearanceValues, afterRevision: number): Promise<AppearanceRead> {
  return saveWorkspaceAppearance(scope, previousOwn, afterRevision, true);
}
