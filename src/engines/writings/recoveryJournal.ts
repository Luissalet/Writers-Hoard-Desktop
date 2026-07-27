// ============================================
// Writings recovery journal
// ============================================
//
// IndexedDB is authoritative. This small localStorage journal only protects
// the gap between an editor change and a confirmed Dexie write (including a
// hard renderer crash where React cleanup never gets a chance to run).

import type { Writing } from '@/types';

const JOURNAL_VERSION = 1;
const KEY_PREFIX = 'writers-hoard:writing-recovery';

export interface WritingRecoveryDraft {
  version: typeof JOURNAL_VERSION;
  projectId: string;
  writingId: string;
  title: string;
  content: string;
  baseTitle: string;
  baseContent: string;
  updatedAt: number;
}

function journalKey(projectId: string, writingId: string): string {
  return `${KEY_PREFIX}:${projectId}:${writingId}`;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Best-effort synchronous write so unload/crash windows stay as small as possible. */
export function writeWritingRecoveryDraft(
  projectId: string,
  writingId: string,
  title: string,
  content: string,
  baseTitle: string,
  baseContent: string,
): void {
  const storage = getStorage();
  if (!storage) return;
  const draft: WritingRecoveryDraft = {
    version: JOURNAL_VERSION,
    projectId,
    writingId,
    title,
    content,
    baseTitle,
    baseContent,
    updatedAt: Date.now(),
  };
  try {
    storage.setItem(journalKey(projectId, writingId), JSON.stringify(draft));
  } catch (err) {
    // Quota/security failures must never interrupt typing or saving.
    console.warn('[writings] recovery journal unavailable', err);
  }
}

export function clearWritingRecoveryDraft(projectId: string, writingId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(journalKey(projectId, writingId));
  } catch {
    // Best effort only.
  }
}

/**
 * Return an unconfirmed local draft when it differs from IndexedDB.
 *
 * A journal that exactly matches the persisted row is residue from a crash
 * after the DB commit but before cleanup, so it is safe to discard.
 */
export function readWritingRecoveryDraft(
  writing: Pick<Writing, 'id' | 'projectId' | 'title' | 'content'>,
): WritingRecoveryDraft | null {
  const storage = getStorage();
  if (!storage) return null;
  const key = journalKey(writing.projectId, writing.id);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<WritingRecoveryDraft>;
    if (
      draft.version !== JOURNAL_VERSION ||
      draft.projectId !== writing.projectId ||
      draft.writingId !== writing.id ||
      typeof draft.title !== 'string' ||
      typeof draft.content !== 'string' ||
      typeof draft.baseTitle !== 'string' ||
      typeof draft.baseContent !== 'string' ||
      typeof draft.updatedAt !== 'number'
    ) {
      storage.removeItem(key);
      return null;
    }
    if (draft.title === writing.title && draft.content === writing.content) {
      storage.removeItem(key);
      return null;
    }
    return draft as WritingRecoveryDraft;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Best effort only.
    }
    return null;
  }
}
