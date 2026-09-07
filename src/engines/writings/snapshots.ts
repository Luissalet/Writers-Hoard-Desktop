// ============================================
// Writing snapshots — automatic version history with restore
// ============================================
//
// Snapshot policy (cheap, useful, no churn):
//   • AUTO on opening a writing in the editor — one restore point per
//     editing session, taken of the content as it was BEFORE the session.
//     Skipped if identical to the latest snapshot.
//   • MANUAL from the history panel ("Save version now").
//   • PRE-RESTORE before restoring an old version, so restores are undoable.
//     Skipped, like AUTO, if identical to the latest snapshot.
//   • Never pruned. Every restore point the author made is kept.
//
// Because nothing is ever pruned, reading this table is the one thing that has
// to stay cheap: `listSnapshotMeta` is what lists and counts, and only
// `readSnapshot`/`restoreSnapshot` ever pull a body.

import { db } from '@/db/index';
import { generateId } from '@/utils/idGenerator';
import { countWords } from '@/utils/text';
import type { Writing } from '@/types';
import type { SnapshotReason, WritingSnapshot, WritingSnapshotMeta } from './snapshotTypes';

// No cap. Version history is the author's own work, and a local-first app on
// the author's own disk has no business deciding that the 26th restore point
// is the one that stops mattering. A snapshot is a few kB of HTML; a thousand
// of them cost less than one of the reference photos on a board.
//
// That policy is exactly why nothing here may list the history by reading it.
// "Never pruned" means the row count only ever grows, so every query that
// answers a metadata question — how many, when, why, which is the newest — has
// to answer it without the bodies, or the cost of opening the editor grows with
// the number of times the chapter has been opened before.

/**
 * The chapter's version history, newest first, WITHOUT the prose.
 *
 * `toArray()` on this table hands back one whole manuscript per restore point
 * and keeps them all alive at once: three hundred versions of a 4 000-word
 * chapter is something like twenty megabytes of HTML, structured-cloned out of
 * IndexedDB and then parked in a React state array — to render a list of dates.
 *
 * A cursor is the idiom this codebase already uses against the two tables that
 * carry big columns (`proofreader.ts` for codex avatars and manuscript bodies,
 * `recentChanges.ts` for this very table): rows are streamed one at a time and
 * projected down inside the callback, so a body is reachable only until that
 * callback returns and the array that survives holds none of them. Peak cost
 * becomes one chapter instead of the whole history, and what the caller keeps
 * is a couple of hundred bytes per version.
 *
 * The fields are named out one by one rather than spread-and-deleted so the
 * projection is checked by the compiler: adding a second heavy column to
 * `WritingSnapshot` later cannot silently start leaking it into this list.
 */
export async function listSnapshotMeta(writingId: string): Promise<WritingSnapshotMeta[]> {
  const rows: WritingSnapshotMeta[] = [];
  await db.writingSnapshots
    .where('writingId')
    .equals(writingId)
    .each(({ id, writingId: owner, projectId, title, wordCount, reason, createdAt }) => {
      rows.push({ id, writingId: owner, projectId, title, wordCount, reason, createdAt });
    });
  // `createdAt` is indexed, but only globally — a range read over it would walk
  // every chapter's history to find one chapter's. Sorting the projection is
  // cheaper and, unlike the old sort, it is sorting metadata rather than prose.
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * One version, prose included, by id.
 *
 * This is the whole of what "I want to read a version" costs: the history panel
 * reads exactly the row the writer clicked, when they click it, instead of
 * reading all of them on open in case they click one.
 */
export async function readSnapshot(snapshotId: string): Promise<WritingSnapshot | undefined> {
  return db.writingSnapshots.get(snapshotId);
}

/**
 * The whole history WITH every body.
 *
 * Kept for the callers that genuinely need the text of every version at once —
 * a backup export, a test reading what a restore filed. Anything that lists,
 * counts, labels or picks wants `listSnapshotMeta`; this one costs the entire
 * past of the chapter and its cost grows every time the chapter is opened.
 */
export async function listSnapshots(writingId: string): Promise<WritingSnapshot[]> {
  const rows = await db.writingSnapshots.where('writingId').equals(writingId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The newest version, body included — the only thing the dedupe check below can
 * compare against.
 *
 * Which one is newest is a metadata question; only the answer needs prose. So
 * this is a projection pass that retains nothing plus a single keyed read,
 * rather than the old `listSnapshots(...)[0]`, which deserialised and RETAINED
 * the chapter's entire past to look at one string on one row of it. On a
 * chapter with three hundred restore points that ran on every editor open.
 */
async function latestSnapshot(writingId: string): Promise<WritingSnapshot | undefined> {
  const [newest] = await listSnapshotMeta(writingId);
  return newest ? db.writingSnapshots.get(newest.id) : undefined;
}

/**
 * Reasons whose byte-identical duplicate is worth nothing, and so is skipped.
 *
 *  • 'auto' is one restore point per editing session. Reopening a chapter you
 *    did not change must not file the same words a second time.
 *  • 'pre-restore' is a machine-taken safety copy whose only job is "the text
 *    this replaced is still somewhere in the history". When it would be
 *    identical to the newest version already on file, that job is already done
 *    by that version and the copy buys a whole manuscript for nothing.
 *    Restoring the same version over and over — a writer confirming again, an
 *    agent retrying `wh_restore_writing_version` after a timeout — replaces
 *    text with text the chapter already holds, and used to file one identical
 *    chapter per attempt with nothing at all bounding the attempts.
 *
 * The other two are deliberately absent, and both would break something:
 *
 *  • 'manual' is a marker the AUTHOR asked for, so an identical one still
 *    means something. It is also load-bearing twice over. `projectReplace`
 *    establishes that a chapter's restore point really landed by diffing this
 *    table's primary keys before and after the call, and aborts the whole
 *    replace when no new key appeared — a deduplicated manual writes no key and
 *    would abort a rewrite that was perfectly fine. And the paths that file
 *    text which exists NOWHERE else — a rescued crash draft, the losing side of
 *    a write conflict — file it under 'manual' precisely because it has to
 *    survive even when an identical copy is already on disk.
 *  • 'pre-ai' is the audit trail saying an external model wrote here.
 *    Suppressing the identical one hides that the write happened at all, which
 *    is the opposite of what the AI bridge promises the writer.
 */
const DEDUPED_REASONS: ReadonlySet<SnapshotReason> = new Set<SnapshotReason>([
  'auto',
  'pre-restore',
]);

export type SnapshotWriteOutcome =
  | { status: 'created'; snapshotId: string }
  | { status: 'already-covered'; snapshotId: string }
  | { status: 'skipped-empty' };

/**
 * Strict snapshot primitive for a caller that is about to replace the only
 * live copy of some prose.
 *
 * Unlike `takeSnapshot`, this function never swallows a database failure. It
 * is safe to call inside a Dexie transaction that includes
 * `writingSnapshots`; the caller can then make the restore point and the
 * destructive write one atomic unit. A deduplicated row still counts as
 * covered because the newest version already contains exactly these words.
 */
export async function ensureSnapshot(
  writing: Pick<Writing, 'id' | 'projectId' | 'title' | 'content'>,
  reason: SnapshotReason,
): Promise<SnapshotWriteOutcome> {
  if (!writing.content?.trim() && reason === 'auto') return { status: 'skipped-empty' };
  if (DEDUPED_REASONS.has(reason)) {
    const latest = await latestSnapshot(writing.id);
    if (latest && latest.content === writing.content) {
      return { status: 'already-covered', snapshotId: latest.id };
    }
  }
  const snapshot: WritingSnapshot = {
    id: generateId('wsnap'),
    writingId: writing.id,
    projectId: writing.projectId,
    title: writing.title,
    content: writing.content,
    wordCount: countWords(writing.content),
    reason,
    createdAt: Date.now(),
  };
  await db.writingSnapshots.add(snapshot);
  return { status: 'created', snapshotId: snapshot.id };
}

/**
 * Take a snapshot of the given writing state. Deduplicates: no-op when the
 * content is identical to the most recent snapshot, for the machine-taken
 * reasons in `DEDUPED_REASONS`. Never throws.
 *
 * Returns the new snapshot's id, or `null` when nothing was written — an empty
 * document, a deduplicated snapshot, or a failed write. Swallowing the
 * failure and returning nothing at all was fine while every caller was only
 * adding a restore point on top of text that stays where it is; it is not fine
 * for a caller that is about to DROP its own last copy of the words (the
 * recovery journal) on the strength of this having worked. `projectReplace`
 * already had to establish the same fact the expensive way, by diffing the
 * chapter's snapshot keys before and after the call.
 */
export async function takeSnapshot(
  writing: Pick<Writing, 'id' | 'projectId' | 'title' | 'content'>,
  reason: SnapshotReason,
): Promise<string | null> {
  try {
    const outcome = await ensureSnapshot(writing, reason);
    return outcome.status === 'created' ? outcome.snapshotId : null;
  } catch (err) {
    console.error('[snapshots] failed to snapshot writing', err);
    return null;
  }
}

/**
 * Restore a snapshot into its writing. The current state is snapshotted
 * first (`pre-restore`) so the operation is reversible. Returns the restored
 * title/content so the caller can refresh its editor state.
 *
 * The `pre-restore` write is skipped when the text it would keep is already
 * byte-identical to the newest version on file. Reversibility is unaffected —
 * the words being replaced are still one click away, in the row that already
 * holds them — and a restore repeated on a chapter that has stopped changing
 * now costs two rows and then nothing, instead of one more whole copy of the
 * manuscript per attempt.
 *
 * The comparison is deliberately against the NEWEST version only. Asking
 * whether this text appears ANYWHERE in the history would mean reading every
 * body on every restore, which is precisely the cost the rest of this file
 * exists to avoid.
 */
export async function restoreSnapshot(
  snapshotId: string,
): Promise<{ title: string; content: string; wordCount: number } | null> {
  const snap = await readSnapshot(snapshotId);
  if (!snap) return null;
  const current = await db.writings.get(snap.writingId);
  if (!current) return null;

  await takeSnapshot(current, 'pre-restore');
  const wordCount = countWords(snap.content);
  await db.writings.update(snap.writingId, {
    title: snap.title,
    content: snap.content,
    wordCount,
    updatedAt: Date.now(),
  });
  return { title: snap.title, content: snap.content, wordCount };
}

export async function deleteSnapshot(snapshotId: string): Promise<void> {
  await db.writingSnapshots.delete(snapshotId);
}

/** Remove all snapshots of a writing (called when the writing is deleted). */
export async function deleteSnapshotsForWriting(writingId: string): Promise<void> {
  await db.writingSnapshots.where('writingId').equals(writingId).delete();
}
