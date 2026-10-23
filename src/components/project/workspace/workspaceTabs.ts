// ============================================================================
// Companion tabs — the pure model
// ============================================================================
//
// The companion pane keeps up to four tabs open beside the main view. This
// file is everything about them that needs no React: the shape, the rules for
// pinning / duplicating / closing, the stack of recently closed tabs, the
// Mod+1..9 jump, and where the layout is remembered.
//
// WHERE IT IS REMEMBERED: `localStorage`, one key per project, and not an
// optional field on `Project`. The layout is a view of THIS window on THIS
// device (which tools are open beside the draft), not a fact about the world:
// a `Project` field would travel in JSON/ZIP backups, clones and world eras,
// would need a revision to stay safe against two windows, and would put a
// writer's open panes into somebody else's copy of the project. Storage that
// is empty, blocked or corrupt simply gives the old behaviour: no tabs.

import type { WorkspaceRoute } from './routes';
import { paneEngineId, workspaceRouteKey } from './routes';
import { tabsStorageKey } from '@/services/workspaceTabsKey';

export interface PaneTab {
  id: string;
  engineId: string;
  history: WorkspaceRoute[];
  index: number;
  /** Title the open document reported; never persisted over the document itself. */
  documentTitle?: string;
  /** The writer's own name for the tab. The document keeps its title. */
  label?: string;
  pinned?: boolean;
}

/** What a closed tab remembers so it can come back where it was. */
export interface ClosedTab {
  engineId: string;
  history: WorkspaceRoute[];
  index: number;
  documentTitle?: string;
  label?: string;
  pinned?: boolean;
}

export interface TabsState {
  tabs: PaneTab[];
  activeId: string;
  /** Most recently closed first, at most CLOSED_LIMIT. */
  closed: ClosedTab[];
}

export const TAB_LIMIT = 4;
export const CLOSED_LIMIT = 10;
export const LABEL_MAX = 60;
export const emptyTabsState = (): TabsState => ({ tabs: [], activeId: '', closed: [] });

export const routeOf = (tab: Pick<PaneTab, 'history' | 'index'>): WorkspaceRoute => tab.history[tab.index];
export const newTabId = () => `companion:${crypto.randomUUID()}`;

/** Pinned tabs first, otherwise the order they were opened in. */
export function pinnedFirst(tabs: readonly PaneTab[]): PaneTab[] {
  return [...tabs.filter(tab => tab.pinned), ...tabs.filter(tab => !tab.pinned)];
}

export function cleanLabel(value: string): string | undefined {
  const label = value.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  return label || undefined;
}

export function renameTab(tabs: readonly PaneTab[], id: string, label: string): PaneTab[] {
  const next = cleanLabel(label);
  return tabs.map(tab => tab.id === id ? { ...tab, label: next } : tab);
}

export function togglePin(tabs: readonly PaneTab[], id: string): PaneTab[] {
  return pinnedFirst(tabs.map(tab => tab.id === id ? { ...tab, pinned: tab.pinned ? undefined : true } : tab));
}

/** A copy right after its source (after the pinned ones), with its own history. Null at the limit. */
export function duplicateTab(tabs: readonly PaneTab[], id: string, copyId: string): PaneTab[] | null {
  const source = tabs.find(tab => tab.id === id);
  if (!source || tabs.length >= TAB_LIMIT) return null;
  const copy: PaneTab = { ...source, id: copyId, history: [...source.history], pinned: undefined };
  const at = tabs.indexOf(source) + 1;
  return pinnedFirst([...tabs.slice(0, at), copy, ...tabs.slice(at)]);
}

/** Which tabs "close others" removes: every unpinned tab but this one. */
export const idsToCloseOthers = (tabs: readonly PaneTab[], id: string) => tabs.filter(tab => tab.id !== id && !tab.pinned).map(tab => tab.id);
/** Which tabs "close to the right" removes: the unpinned ones after this one. */
export function idsToCloseRight(tabs: readonly PaneTab[], id: string): string[] {
  const at = tabs.findIndex(tab => tab.id === id);
  return at < 0 ? [] : tabs.slice(at + 1).filter(tab => !tab.pinned).map(tab => tab.id);
}

/** Remove tabs, remembering them (the last one closed on top) and choosing what to show next. */
export function closeTabs(state: TabsState, ids: readonly string[], preferred?: string): TabsState {
  const doomed = new Set(ids);
  const removed = state.tabs.filter(tab => doomed.has(tab.id));
  if (!removed.length) return state;
  const tabs = state.tabs.filter(tab => !doomed.has(tab.id));
  const remembered: ClosedTab[] = removed.map(({ engineId, history, index, documentTitle, label, pinned }) => ({ engineId, history, index, documentTitle, label, pinned }));
  const closed = [...remembered.reverse(), ...state.closed].slice(0, CLOSED_LIMIT);
  let activeId = state.activeId;
  if (doomed.has(activeId) || !tabs.some(tab => tab.id === activeId)) {
    // The neighbour that took its place: the next tab, else the one before.
    const at = state.tabs.findIndex(tab => tab.id === state.activeId);
    const after = state.tabs.slice(Math.max(at, 0)).find(tab => !doomed.has(tab.id));
    const before = [...state.tabs.slice(0, Math.max(at, 0))].reverse().find(tab => !doomed.has(tab.id));
    activeId = (preferred && tabs.some(tab => tab.id === preferred) ? preferred : (after ?? before)?.id) ?? '';
  }
  return { tabs, activeId, closed };
}

/** Put the most recently closed tab (or the chosen one in the stack) back. Null when nothing fits. */
export function reopenClosed(state: TabsState, newId: string, at = 0): TabsState | null {
  const entry = state.closed[at];
  if (!entry || state.tabs.length >= TAB_LIMIT) return null;
  const tab: PaneTab = { id: newId, ...entry, history: [...entry.history] };
  return { tabs: pinnedFirst([...state.tabs, tab]), activeId: newId, closed: state.closed.filter((_, index) => index !== at) };
}

/** Mod+1..Mod+9 → the 0-based tab it names, or null when the keystroke is not a jump. */
export function tabJumpIndex(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): number | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null;
  return /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : null;
}

// ---------------------------------------------------------------------------
// Remembering the layout
// ---------------------------------------------------------------------------

export { tabsStorageKey };

const isRoute = (value: unknown): value is WorkspaceRoute => {
  const route = value as WorkspaceRoute | null;
  return !!route && typeof route === 'object' && typeof route.pathname === 'string' && typeof route.search === 'string' && typeof route.hash === 'string';
};
const text = (value: unknown, max = 200) => typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined;
function history(value: unknown, index: unknown): { history: WorkspaceRoute[]; index: number } | null {
  if (!Array.isArray(value) || !value.length || value.length > 100 || !value.every(isRoute)) return null;
  const at = Number.isSafeInteger(index) ? Number(index) : value.length - 1;
  return { history: value.map(({ pathname, search, hash }) => ({ pathname, search, hash })), index: Math.min(Math.max(at, 0), value.length - 1) };
}

/** Whatever is in storage, made safe: only this project's enabled tools, at most four tabs. */
export function parseTabsState(raw: unknown, projectId: string, enabledIds: readonly string[]): TabsState {
  const input = raw as { tabs?: unknown; activeId?: unknown; closed?: unknown } | null;
  if (!input || typeof input !== 'object') return emptyTabsState();
  const usable = (engineId: unknown, past: WorkspaceRoute[], at: number): engineId is string =>
    typeof engineId === 'string' && enabledIds.includes(engineId) && paneEngineId(past[at], projectId, enabledIds) === engineId;
  const tabs: PaneTab[] = [], seen = new Set<string>();
  for (const item of Array.isArray(input.tabs) ? input.tabs : []) {
    const row = item as Record<string, unknown>, h = history(row?.history, row?.index), id = text(row?.id, 100);
    if (!h || !id || seen.has(id) || !id.startsWith('companion:') || !usable(row.engineId, h.history, h.index) || tabs.length >= TAB_LIMIT) continue;
    seen.add(id);
    tabs.push({ id, engineId: row.engineId as string, ...h, documentTitle: text(row.documentTitle), label: typeof row.label === 'string' ? cleanLabel(row.label) : undefined, pinned: row.pinned === true ? true : undefined });
  }
  const closed: ClosedTab[] = [];
  for (const item of Array.isArray(input.closed) ? input.closed : []) {
    const row = item as Record<string, unknown>, h = history(row?.history, row?.index);
    if (!h || !usable(row.engineId, h.history, h.index) || closed.length >= CLOSED_LIMIT) continue;
    closed.push({ engineId: row.engineId as string, ...h, documentTitle: text(row.documentTitle), label: typeof row.label === 'string' ? cleanLabel(row.label) : undefined, pinned: row.pinned === true ? true : undefined });
  }
  const ordered = pinnedFirst(tabs), activeId = typeof input.activeId === 'string' && ordered.some(tab => tab.id === input.activeId) ? input.activeId : ordered[0]?.id ?? '';
  return { tabs: ordered, activeId, closed };
}

export function loadTabsState(projectId: string, enabledIds: readonly string[]): TabsState {
  try {
    const raw = window.localStorage.getItem(tabsStorageKey(projectId));
    return raw ? parseTabsState(JSON.parse(raw), projectId, enabledIds) : emptyTabsState();
  } catch { return emptyTabsState(); }
}

export function saveTabsState(projectId: string, state: TabsState): void {
  try {
    if (!state.tabs.length && !state.closed.length) { window.localStorage.removeItem(tabsStorageKey(projectId)); return; }
    window.localStorage.setItem(tabsStorageKey(projectId), JSON.stringify(state));
  } catch { /* Storage is a convenience: blocked, full or private mode just means no memory. */ }
}

/** The compact, read-only view the bridge returns and the overview prints. */
export interface TabSummary { position: number; id: string; engineId: string; route: string; title: string; label?: string; pinned: boolean; active: boolean }
export function summarizeTabs(state: TabsState): TabSummary[] {
  return state.tabs.map((tab, index) => ({ position: index + 1, id: tab.id, engineId: tab.engineId, route: workspaceRouteKey(routeOf(tab)), title: tab.documentTitle ?? '', label: tab.label, pinned: !!tab.pinned, active: tab.id === state.activeId }));
}
