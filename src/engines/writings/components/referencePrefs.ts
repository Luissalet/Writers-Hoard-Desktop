// ============================================================================
// The reference panel's UI state — docked preference, width, temporary consult
// ============================================================================
//
// Two different things share the panel:
//
//   * the DOCKED preference (`open`, `width`): whether the panel sits in the
//     chapter editor's side column, and how wide. Remembered per browser in
//     localStorage and read back from it on every render, so it survives a
//     reload and a second tab sees the same values.
//   * the TEMPORARY CONSULT (`consult`): the panel as an overlay drawer, used
//     wherever the side column does not exist (focus mode, the whole-book
//     editor, a window narrower than the editor's two-column grid). It is
//     never persisted: a consult is a glance, not a layout choice.
//
// The store is module-level so the AI bridge tools set and read exactly what
// the screen shows.
import { useEffect, useMemo, useSyncExternalStore } from 'react';

const PREFS_KEY = 'writers-hoard:reference:panel';
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 560;
export const DEFAULT_WIDTH = 340;

/**
 * The chapter editor lays its side column out from Tailwind's `lg` (1024px)
 * and, in page mode (a 794px sheet beside the column), from 1440px. The panel
 * is docked exactly when that column exists and is a drawer otherwise, so there
 * is no window width where it lands underneath a long chapter.
 */
export const EDITOR_GRID_PX = 1024;
export const EDITOR_PAGE_GRID_PX = 1440;
/** Default for the docked/drawer switch (the fluid, non-page grid). */
export const REFERENCE_NARROW_PX = EDITOR_GRID_PX;
export const referenceDockPx = (pageMode: boolean) => (pageMode ? EDITOR_PAGE_GRID_PX : EDITOR_GRID_PX);

export interface ReferenceUiState {
  /** Docked in the side column (persisted). */
  open: boolean;
  /** Width of the docked column, px (persisted). */
  width: number;
  /** Temporary consult drawer (not persisted). */
  consult: boolean;
}

export interface ReferencePrefs extends ReferenceUiState {
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
  setConsult: (open: boolean) => void;
}

export const clampReferenceWidth = (width: number) =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

// A blocked store only forgets the preference; the page keeps working from memory.
let memoryRaw: string | null = null;
let storageBlocked = false;

function readRaw(): string | null {
  if (!storageBlocked) {
    try {
      return window.localStorage.getItem(PREFS_KEY);
    } catch {
      storageBlocked = true;
    }
  }
  return memoryRaw;
}

function writeRaw(raw: string): void {
  memoryRaw = raw;
  if (storageBlocked) return;
  try {
    window.localStorage.setItem(PREFS_KEY, raw);
  } catch {
    storageBlocked = true;
  }
}

function parse(raw: string | null): { open: boolean; width: number } {
  try {
    const parsed = JSON.parse(raw ?? '{}') as { open?: unknown; width?: unknown };
    return {
      open: parsed.open === true,
      width: typeof parsed.width === 'number' ? clampReferenceWidth(parsed.width) : DEFAULT_WIDTH,
    };
  } catch {
    return { open: false, width: DEFAULT_WIDTH };
  }
}

let consult = false;
let cachedRaw: string | null | undefined;
let snapshot: ReferenceUiState = { open: false, width: DEFAULT_WIDTH, consult: false };
const listeners = new Set<() => void>();

/** The current state; the same object until something changes. */
export function getReferenceUi(): ReferenceUiState {
  const raw = readRaw();
  if (raw !== cachedRaw || snapshot.consult !== consult) {
    cachedRaw = raw;
    snapshot = { ...parse(raw), consult };
  }
  return snapshot;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFS_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setReferenceOpen(open: boolean): ReferenceUiState {
  const { width } = getReferenceUi();
  writeRaw(JSON.stringify({ open, width }));
  emit();
  return getReferenceUi();
}

export function setReferenceWidth(width: number): ReferenceUiState {
  const { open } = getReferenceUi();
  writeRaw(JSON.stringify({ open, width: clampReferenceWidth(width) }));
  emit();
  return getReferenceUi();
}

export function setReferenceConsult(open: boolean): ReferenceUiState {
  if (consult !== open) {
    consult = open;
    emit();
  }
  return getReferenceUi();
}

/** Open/closed, width and temporary consult of the panel; shared with the AI bridge. */
const scopedConsult = new Map<string, boolean>();
const scopedSnapshots = new Map<string, ReferenceUiState>();
const scopedOwners = new Map<string, number>();
function getScopedReferenceUi(scope: string): ReferenceUiState {
  const shared = getReferenceUi(), previous = scopedSnapshots.get(scope), consult = scopedConsult.get(scope) ?? false;
  if (previous && previous.open === shared.open && previous.width === shared.width && previous.consult === consult) return previous;
  const next = { ...shared, consult }; scopedSnapshots.set(scope, next); return next;
}
export function useReferencePrefs(scope?: string): ReferencePrefs {
  const read = useMemo(() => scope ? () => getScopedReferenceUi(scope) : getReferenceUi, [scope]);
  const state = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    if (!scope) return;
    scopedOwners.set(scope, (scopedOwners.get(scope) ?? 0) + 1);
    return () => { const owners = (scopedOwners.get(scope) ?? 1) - 1; if (owners) scopedOwners.set(scope, owners); else { scopedOwners.delete(scope); scopedConsult.delete(scope); scopedSnapshots.delete(scope); } };
  }, [scope]);
  return useMemo(
    () => ({ ...state, setOpen: setReferenceOpen, setWidth: setReferenceWidth, setConsult: scope ? (open: boolean) => { scopedConsult.set(scope, open); emit(); } : setReferenceConsult }),
    [state, scope],
  );
}
