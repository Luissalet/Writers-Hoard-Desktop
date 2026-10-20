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

function journalKey(projectId: string, writingId: string, owner?: string): string {
  return `${KEY_PREFIX}:${projectId}:${writingId}${owner ? `:pane:${encodeURIComponent(owner)}` : ''}`;
}

const activeOwners = new Map<string, number>();
/** A live sibling's crash copy must never be adopted by another pane. */
export function registerWritingRecoveryOwner(projectId: string, writingId: string, owner?: string): () => void {
  const key = journalKey(projectId, writingId, owner); activeOwners.set(key, (activeOwners.get(key) ?? 0) + 1);
  let released = false;
  return () => { if (released) return; released = true; const count = (activeOwners.get(key) ?? 1) - 1; if (count) activeOwners.set(key, count); else activeOwners.delete(key); };
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
  owner?: string,
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
    storage.setItem(journalKey(projectId, writingId, owner), JSON.stringify(draft));
  } catch (err) {
    // Quota/security failures must never interrupt typing or saving.
    console.warn('[writings] recovery journal unavailable', err);
  }
}

export function clearWritingRecoveryDraft(projectId: string, writingId: string, owner?: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(journalKey(projectId, writingId, owner));
  } catch {
    // Best effort only.
  }
}

/**
 * What one journal entry means for the row it claims to belong to.
 *
 *  • `none`      — nothing to recover: no journal, an unreadable one, or one
 *                  that already matches the row (residue from a crash after the
 *                  DB commit but before cleanup).
 *  • `draft`     — real unsaved work, and the row is still exactly where the
 *                  editing session left it. Safe to reopen as the writer's text.
 *  • `conflict`  — real unsaved work, but the row has been REWRITTEN since the
 *                  draft was made. Applying it would be a silent revert.
 *
 * The third case is the one the journal was blind to. `baseContent`/`baseTitle`
 * have always been written — they are the last state this session saw confirmed
 * in Dexie — and never read, so a draft was reopened purely on "it differs from
 * the row". But a row differs for two opposite reasons: because the draft is
 * newer than it, or because something else moved it on afterwards — the copilot
 * through the AI bridge, a project-wide find and replace, a backup import, a
 * second window. Recovering blind in that second case autosaves the older text
 * over the newer one within the debounce, and the newer text is gone from the
 * book with nothing on screen to say it ever happened.
 */
export type WritingRecoveryOutcome =
  | { kind: 'none' }
  | { kind: 'draft'; draft: WritingRecoveryDraft }
  | { kind: 'conflict'; draft: WritingRecoveryDraft };

const NOTHING_TO_RECOVER: WritingRecoveryOutcome = { kind: 'none' };

/**
 * Classify the journal entry for a writing without deciding anything for the
 * caller: a conflicted draft is handed back intact, because the text in it is
 * the writer's and only the writer can say which version of the chapter wins.
 */
export function inspectWritingRecoveryDraft(
  writing: Pick<Writing, 'id' | 'projectId' | 'title' | 'content'>,
  owner?: string,
): WritingRecoveryOutcome {
  const storage = getStorage();
  if (!storage) return NOTHING_TO_RECOVER;
  const ownKey = journalKey(writing.projectId, writing.id, owner), prefix = `${journalKey(writing.projectId, writing.id)}:pane:`;
  const candidates: Array<{ key: string; raw: string; updatedAt: number }> = [];
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (!key) continue;
      const belongs = key === journalKey(writing.projectId, writing.id) || key.startsWith(prefix);
      if (key !== ownKey && (!belongs || activeOwners.has(key))) continue;
      const raw = storage.getItem(key); if (!raw) continue;
      try { const parsed = JSON.parse(raw); candidates.push({ key, raw, updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0 }); } catch { storage.removeItem(key); }
    }
  } catch { return NOTHING_TO_RECOVER; }
  candidates.sort((left, right) => left.key === ownKey ? -1 : right.key === ownKey ? 1 : right.updatedAt - left.updatedAt);
  for (const { key, raw } of candidates) try {
    const draft = JSON.parse(raw) as Partial<WritingRecoveryDraft>;
    if (key !== ownKey && (draft.projectId !== writing.projectId || draft.writingId !== writing.id)) continue;
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
      continue;
    }
    if (draft.title === writing.title && draft.content === writing.content) {
      storage.removeItem(key);
      continue;
    }
    // The baseline check, in the order that matters: the equality above already
    // took the "crashed just after the write landed" case, so anything reaching
    // here whose baseline no longer matches the row was based on a version of
    // the chapter that no longer exists.
    // Claim an inactive old pane's copy under the new stable session key. A
    // quota failure leaves the old copy in place rather than deleting it.
    if (key !== ownKey) { try { storage.setItem(ownKey, raw); storage.removeItem(key); } catch { /* Keep the original crash copy. */ } }
    if (draft.baseContent !== writing.content || draft.baseTitle !== writing.title) {
      return { kind: 'conflict', draft: draft as WritingRecoveryDraft };
    }
    return { kind: 'draft', draft: draft as WritingRecoveryDraft };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Best effort only.
    }
  }
  return NOTHING_TO_RECOVER;
}

/**
 * The unconfirmed draft for a writing when it can be reopened as the writer's
 * text with no question attached — that is, `inspectWritingRecoveryDraft`'s
 * `draft` case and nothing else.
 *
 * A conflicted draft answers `null` here on purpose. Every caller of this
 * function loads what it returns straight into an editor, and there is no
 * return value that could carry "load this, but ask first"; a caller that has
 * to be able to ask asks `inspectWritingRecoveryDraft` instead.
 */
export function readWritingRecoveryDraft(
  writing: Pick<Writing, 'id' | 'projectId' | 'title' | 'content'>,
): WritingRecoveryDraft | null {
  const outcome = inspectWritingRecoveryDraft(writing);
  return outcome.kind === 'draft' ? outcome.draft : null;
}
