import { getSetting, PROJECT_SETTING_PREFIXES, updateSetting } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import { foldSearchText } from '@/services/searchQuery';

export type CommandCenterActionIcon =
  | 'home'
  | 'notes'
  | 'overview'
  | 'health'
  | 'edit'
  | 'publishing'
  | 'engine'
  | 'manage';

export interface CommandCenterProjectContext {
  id: string;
  enabledEngines: string[];
  engineOrder: string[];
}

export interface CommandCenterAction {
  type: 'action';
  id: string;
  key: string;
  labelKey: string;
  detailKey: string;
  keywordsKey: string;
  icon: CommandCenterActionIcon;
  target: string;
  engineId?: string;
}

export interface CommandCenterSearchIdentity {
  type: 'project' | 'entity';
  id: string;
  projectId?: string;
  engineId?: string;
}

function action(
  id: string,
  icon: CommandCenterActionIcon,
  target: string,
  projectId?: string,
): CommandCenterAction {
  return {
    type: 'action',
    id,
    key: `action:${id}${projectId ? `:${projectId}` : ''}`,
    labelKey: `search.commandCenter.action.${id}`,
    detailKey: `search.commandCenter.detail.${id}`,
    keywordsKey: `search.commandCenter.keywords.${id}`,
    icon,
    target,
  };
}

export function getOrderedEnabledEngineIds(
  enabledEngines: string[],
  engineOrder: string[],
): string[] {
  const enabled = [...new Set(enabledEngines)];
  const enabledSet = new Set(enabled);
  const ordered = [...new Set(engineOrder)].filter(engineId => enabledSet.has(engineId));
  const orderedSet = new Set(ordered);
  return [...ordered, ...enabled.filter(engineId => !orderedSet.has(engineId))];
}

export function buildCommandCenterActions(
  project?: CommandCenterProjectContext,
): CommandCenterAction[] {
  const actions = [
    action('home', 'home', '/'),
    action('notes', 'notes', '/notes'),
  ];
  if (!project) return actions;

  const projectBase = `/project/${encodeURIComponent(project.id)}`;
  actions.push(
    action('overview', 'overview', `${projectBase}/overview`, project.id),
    action('review', 'health', `${projectBase}/overview?panel=health`, project.id),
    action('edit', 'edit', `${projectBase}/overview?edit=1`, project.id),
    action('publishing', 'publishing', `${projectBase}/overview?panel=publishing`, project.id),
  );

  for (const engineId of getOrderedEnabledEngineIds(project.enabledEngines, project.engineOrder)) {
    actions.push({
      type: 'action',
      id: `engine:${engineId}`,
      key: `action:engine:${project.id}:${engineId}`,
      labelKey: `engines.${engineId}.name`,
      detailKey: 'search.commandCenter.detail.engine',
      keywordsKey: 'search.commandCenter.keywords.engine',
      icon: 'engine',
      engineId,
      target: `${projectBase}/${encodeURIComponent(engineId)}`,
    });
  }

  actions.push(action('manage', 'manage', `${projectBase}/overview?manage=1`, project.id));
  return actions;
}

function normalize(value: string): string {
  return foldSearchText(value).trim();
}

export function filterCommandCenterActions(
  actions: CommandCenterAction[],
  query: string,
  getSearchText: (action: CommandCenterAction) => string,
): CommandCenterAction[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return actions;
  return actions.filter(item => normalize(getSearchText(item)).includes(normalizedQuery));
}

export function commandCenterSearchKey(result: CommandCenterSearchIdentity): string {
  return result.type === 'project'
    ? `project:${result.id}`
    : `entity:${result.projectId ?? 'unknown'}:${result.engineId ?? 'unknown'}:${result.id}`;
}

export function moveCommandCenterSelection(
  current: number,
  itemCount: number,
  direction: 1 | -1,
): number {
  if (itemCount <= 0) return 0;
  return (current + direction + itemCount) % itemCount;
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------
//
// A writer who works out that `engine:codex tag:secundario -muerto` is the
// query that finds their loose ends should never have to work it out twice.
// These live in the `settings` key/value table rather than a table of their
// own: they are a handful of short strings per project, they are worthless
// without the project they belong to, and a Dexie migration is a heavy price
// for a bookmark.

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  createdAt: number;
}

/**
 * Enough to hold a working set of queries, few enough that they still fit
 * above an empty palette without becoming a list you have to scroll.
 */
export const SAVED_SEARCH_LIMIT = 12;

/** Searches made outside any project (the dashboard) share one bucket. */
const SAVED_SEARCH_GLOBAL = '__global__';

function savedSearchKey(projectId?: string): string {
  return `${PROJECT_SETTING_PREFIXES.savedSearches}${projectId ?? SAVED_SEARCH_GLOBAL}`;
}

/**
 * Read a stored list defensively: this is user-editable persisted JSON, and a
 * malformed value must cost the writer their bookmarks, not their palette.
 */
export function parseSavedSearches(value: string | undefined): SavedSearch[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const searches: SavedSearch[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Partial<SavedSearch>;
    if (typeof row.id !== 'string' || typeof row.query !== 'string') continue;
    if (!row.query.trim()) continue;
    searches.push({
      id: row.id,
      name: typeof row.name === 'string' && row.name.trim() ? row.name : row.query,
      query: row.query,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    });
    if (searches.length >= SAVED_SEARCH_LIMIT) break;
  }
  return searches;
}

export async function getSavedSearches(projectId?: string): Promise<SavedSearch[]> {
  return parseSavedSearches(await getSetting(savedSearchKey(projectId)));
}

/**
 * Rewrite the stored list in ONE transaction.
 *
 * The whole list lives in a single JSON value, so a read-then-write across two
 * awaits loses whichever change was made first: save two queries in quick
 * succession — or save one while another tab deletes one — and the second write
 * puts back the list the first one had already replaced. `mutate` runs inside
 * the transaction and must stay synchronous.
 */
async function updateSavedSearches(
  projectId: string | undefined,
  mutate: (existing: SavedSearch[]) => SavedSearch[],
): Promise<SavedSearch[]> {
  let capped: SavedSearch[] = [];
  await updateSetting(savedSearchKey(projectId), current => {
    capped = mutate(parseSavedSearches(current)).slice(0, SAVED_SEARCH_LIMIT);
    return JSON.stringify(capped);
  });
  return capped;
}

/**
 * Save the current query under a name, newest first. Saving the same query
 * twice renames the existing entry instead of stacking a duplicate.
 */
export async function saveSearch(
  query: string,
  name: string,
  projectId?: string,
): Promise<SavedSearch[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return getSavedSearches(projectId);
  const trimmedName = name.trim() || trimmedQuery;

  return updateSavedSearches(projectId, existing => {
    const saved: SavedSearch = {
      id: existing.find(search => search.query === trimmedQuery)?.id ?? generateId('search'),
      name: trimmedName,
      query: trimmedQuery,
      createdAt: Date.now(),
    };
    return [saved, ...existing.filter(search => search.query !== trimmedQuery)];
  });
}

export async function deleteSavedSearch(
  id: string,
  projectId?: string,
): Promise<SavedSearch[]> {
  return updateSavedSearches(projectId, existing =>
    existing.filter(search => search.id !== id),
  );
}
