// ============================================================================
// Undo journal — one place that knows what the writer just did and can take it back
// ============================================================================
//
// Several features already undo themselves (documents restored from the
// archive, imports, duplicates, history restore). What was missing is the
// writer-facing half: a short list of the last reversible things done in this
// window, a "Deshacer" button on the toast that announces them, and the same
// refusal everywhere when the world moved on.
//
// RULES
//  • An entry only exists when the operation left a receipt that can be
//    checked: an archive row (restoring refuses when the document or one of
//    its links changed since) or a revision (the Library refuses a stale one).
//  • Undo never forces. If the receipt no longer matches, the entry is dropped
//    and the writer is told "No se pudo deshacer: cambió desde entonces".
//    Any other failure keeps the entry so it can be retried, and an undo that
//    restored only some of its parts says "Se restauraron N de M".
//  • The journal is memory only. It belongs to this window's session; the
//    durable record is the archive itself, and it stays in the Archive tool.

import { db } from '@/db';
import { toast } from '@/components/common/toast';
import { t } from '@/i18n/useTranslation';
import { ArchiveRestoreConflict, restoreArchivedDocument } from '@/services/documentArchive/store';

/** Thrown by an inverse that found its receipt no longer matches. */
export class UndoStaleError extends Error {
  constructor(message = 'It changed since.') { super(message); this.name = 'UndoStaleError'; }
}

/** Thrown by an inverse that already put some of its parts back before one of them failed. */
export class UndoPartialError extends Error {
  readonly done: number;
  readonly total: number;
  readonly causeError: unknown;
  constructor(done: number, total: number, causeError: unknown) { super('Only part of it was undone.'); this.name = 'UndoPartialError'; this.done = done; this.total = total; this.causeError = causeError; }
}

export type UndoKind = 'archive' | 'rename' | 'asset' | 'appearance';
export interface UndoEntry {
  id: number;
  projectId: string;
  kind: UndoKind;
  /** Plain words for the toast and the "undo last" button. */
  label: string;
  at: number;
}
export type UndoOutcome = 'undone' | 'stale' | 'failed' | 'gone' | 'partial';

interface Stored extends UndoEntry { undo: () => Promise<void>; running?: boolean }

const LIMIT = 20;
let nextId = 1;
let entries: Stored[] = [];
let snapshot: readonly UndoEntry[] = [];
const listeners = new Set<() => void>();

function publish() {
  snapshot = entries.map(({ id, projectId, kind, label, at }) => ({ id, projectId, kind, label, at }));
  for (const listener of listeners) listener();
}
export const subscribeUndoJournal = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getUndoJournal = (): readonly UndoEntry[] => snapshot;
export const lastUndoable = (projectId: string): UndoEntry | undefined => [...snapshot].reverse().find(entry => entry.projectId === projectId);
/** For tests and for leaving a project: forget everything. */
export function clearUndoJournal() { entries = []; publish(); }

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

/**
 * Take one entry back. The outcome is also announced, so callers need not.
 * The entry stays in the journal while it runs and after any failure that left
 * something to retry; it leaves only when it is undone, or when its receipt is
 * stale and nothing was restored (it can never match again).
 */
export async function undoEntry(id: number): Promise<UndoOutcome> {
  const entry = entries.find(item => item.id === id);
  if (!entry || entry.running) return 'gone';
  entry.running = true;
  try {
    await entry.undo();
  } catch (error) {
    entry.running = false;
    if (error instanceof UndoPartialError) {
      toast.error(fill(t('undo.partial'), { done: String(error.done), total: String(error.total) }));
      return 'partial';
    }
    const stale = error instanceof UndoStaleError || error instanceof ArchiveRestoreConflict;
    if (stale) { entries = entries.filter(item => item.id !== id); publish(); }
    toast.error(t(stale ? 'undo.stale' : 'undo.failed'));
    return stale ? 'stale' : 'failed';
  }
  entries = entries.filter(item => item.id !== id);
  publish();
  toast.success(fill(t('undo.done'), { label: entry.label }));
  return 'undone';
}

export async function undoLast(projectId: string): Promise<UndoOutcome> {
  const last = lastUndoable(projectId);
  return last ? undoEntry(last.id) : 'gone';
}

/** Add a reversible operation. With `notice`, a toast announces it with a Deshacer button. */
export function recordUndoable(input: { projectId: string; kind: UndoKind; label: string; undo: () => Promise<void>; notice?: string }): UndoEntry {
  const entry: Stored = { id: nextId++, projectId: input.projectId, kind: input.kind, label: input.label, at: Date.now(), undo: input.undo };
  entries = [...entries, entry].slice(-LIMIT);
  publish();
  if (input.notice) toast.withAction('success', input.notice, { label: t('undo.action'), onAction: () => { void undoEntry(entry.id); } });
  return entry;
}

/**
 * Journal documents that were just sent to the archive. The receipt is the
 * archive row each delete path wrote (`archiveWithMutation`); kinds that keep
 * no archive row are not journalled, because there would be nothing to check.
 * Returns how many documents can be undone.
 */
export async function recordArchiveUndo(input: { projectId: string; sourceIds: readonly string[]; since: number; title: string }): Promise<number> {
  const wanted = new Set(input.sourceIds);
  if (!wanted.size) return 0;
  const rows = await db.documentArchives.where('sourceId').anyOf([...wanted]).filter(row => row.projectId === input.projectId && row.archivedAt >= input.since).toArray();
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) { const seen = latest.get(row.sourceId); if (!seen || row.archivedAt >= seen.archivedAt) latest.set(row.sourceId, row); }
  const receipts = [...latest.values()].sort((a, b) => a.archivedAt - b.archivedAt);
  if (!receipts.length) return 0;
  const label = receipts.length === 1 ? receipts[0].title || input.title : fill(t('undo.archivedMany'), { count: String(receipts.length) });
  const remaining = [...receipts];
  recordUndoable({
    projectId: input.projectId, kind: 'archive', label,
    notice: fill(t(receipts.length === 1 ? 'undo.archivedOne' : 'undo.archivedMany'), { title: label, count: String(receipts.length) }),
    // Oldest first: a later restore can need the earlier one back. Each restore
    // checks its own receipt; a refusal stops here and nothing is forced.
    // A failure after some were restored is reported as "N of M" and the rest stays retryable.
    undo: async () => {
      while (remaining.length) {
        try { await restoreArchivedDocument(input.projectId, remaining[0].id); }
        catch (error) { const done = receipts.length - remaining.length; if (done > 0) throw new UndoPartialError(done, receipts.length, error); throw error; }
        remaining.shift();
      }
    },
  });
  return receipts.length;
}
