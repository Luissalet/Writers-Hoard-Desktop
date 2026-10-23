// ============================================================================
// Reference-panel pins — which entries the author pinned, per chapter (or book)
// ============================================================================
//
// Pins are project data: one row per scope in the `referencePins` table, so
// they travel with the backup/export and come back on import. A scope is a
// chapter id, or `book:<projectId>` for the whole-book editor. The table is
// separate from `writings` on purpose: a pin never touches the chapter row, so
// it can neither bump its revision nor collide with the manuscript autosave.
//
// Pins used to live in localStorage (one key per chapter). Those keys are
// moved into the table once, the first time a scope is read or the app scans
// for them, and the key is removed.

import { db } from '@/db';

export interface ReferencePinRow {
  /** Equal to `scopeId`: one row per chapter (or per book). */
  id: string;
  projectId: string;
  scopeId: string;
  entryIds: string[];
  updatedAt: number;
}

const LEGACY_PREFIX = 'writers-hoard:reference:pins:';
const EVENT = 'writers-hoard:reference-pins-changed';

export const bookScopeId = (projectId: string,manuscriptId='main') => `book:${projectId}${manuscriptId==='main'?'':`:manuscript:${manuscriptId}`}`;

function legacyKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(LEGACY_PREFIX)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

function readLegacy(scopeId: string): string[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_PREFIX + scopeId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function dropLegacy(scopeId: string): void {
  try {
    window.localStorage.removeItem(LEGACY_PREFIX + scopeId);
  } catch {
    // A blocked store only keeps the old key around.
  }
}

const union = (...lists: string[][]) => [...new Set(lists.flat())];

/** Move one scope's localStorage pins into the table (once). */
async function adoptLegacy(projectId: string, scopeId: string): Promise<void> {
  const legacy = readLegacy(scopeId);
  if (!legacy.length) {
    dropLegacy(scopeId);
    return;
  }
  await db.transaction('rw', db.referencePins, async () => {
    const existing = await db.referencePins.get(scopeId);
    await db.referencePins.put({
      id: scopeId,
      projectId: existing?.projectId ?? projectId,
      scopeId,
      entryIds: union(existing?.entryIds ?? [], legacy),
      updatedAt: Date.now(),
    });
  });
  dropLegacy(scopeId);
}

/**
 * Move every localStorage pin into the table. Keys whose chapter no longer
 * exists are dropped. Returns how many scopes were moved.
 */
export async function migrateLocalPins(): Promise<number> {
  let moved = 0;
  for (const key of legacyKeys()) {
    const scopeId = key.slice(LEGACY_PREFIX.length);
    const writing = await db.writings.get(scopeId);
    if (!writing) {
      dropLegacy(scopeId);
      continue;
    }
    await adoptLegacy(writing.projectId, scopeId);
    moved += 1;
  }
  if (moved) window.dispatchEvent(new CustomEvent(EVENT, { detail: { writingId: '*' } }));
  return moved;
}

export async function readPins(projectId: string, scopeId: string): Promise<string[]> {
  if (readLegacy(scopeId).length) await adoptLegacy(projectId, scopeId);
  const row = await db.referencePins.get(scopeId);
  return row ? [...row.entryIds] : [];
}

export async function setPinned(
  projectId: string,
  scopeId: string,
  entryId: string,
  pinned: boolean,
): Promise<string[]> {
  // Fold any old key in first, so the write below starts from the full list.
  if (readLegacy(scopeId).length) await adoptLegacy(projectId, scopeId);
  const next = await db.transaction('rw', db.referencePins, async () => {
    const existing = await db.referencePins.get(scopeId);
    const without = (existing?.entryIds ?? []).filter((id) => id !== entryId);
    const entryIds = pinned ? [...without, entryId] : without;
    if (entryIds.length) {
      await db.referencePins.put({ id: scopeId, projectId, scopeId, entryIds, updatedAt: Date.now() });
    } else {
      await db.referencePins.delete(scopeId);
    }
    return entryIds;
  });
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { writingId: scopeId } }));
  return next;
}

/** `scopeId` is '*' after a bulk change such as the localStorage migration. */
export function onPinsChanged(listener: (scopeId: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<{ writingId: string }>).detail.writingId);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
