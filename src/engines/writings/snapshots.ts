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
//   • Never pruned. Every restore point the author made is kept.

import { db } from '@/db/index';
import { generateId } from '@/utils/idGenerator';
import { countWords } from '@/utils/text';
import type { Writing } from '@/types';
import type { SnapshotReason, WritingSnapshot } from './snapshotTypes';

/**
 * No cap. Version history is the author's own work, and a local-first app on
 * the author's own disk has no business deciding that the 26th restore point
 * is the one that stops mattering. A snapshot is a few kB of HTML; a thousand
 * of them cost less than one of the reference photos on a board.
 */

export async function listSnapshots(writingId: string): Promise<WritingSnapshot[]> {
  const rows = await db.writingSnapshots.where('writingId').equals(writingId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

async function latestSnapshot(writingId: string): Promise<WritingSnapshot | undefined> {
  return (await listSnapshots(writingId))[0];
}

/**
 * Take a snapshot of the given writing state. Deduplicates: no-op when the
 * content is identical to the most recent snapshot (auto only). Never throws.
 */
export async function takeSnapshot(
  writing: Pick<Writing, 'id' | 'projectId' | 'title' | 'content'>,
  reason: SnapshotReason,
): Promise<void> {
  try {
    if (!writing.content?.trim() && reason === 'auto') return; // nothing to protect
    if (reason === 'auto') {
      const latest = await latestSnapshot(writing.id);
      if (latest && latest.content === writing.content) return;
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
  } catch (err) {
    console.error('[snapshots] failed to snapshot writing', err);
  }
}

/**
 * Restore a snapshot into its writing. The current state is snapshotted
 * first (`pre-restore`) so the operation is reversible. Returns the restored
 * title/content so the caller can refresh its editor state.
 */
export async function restoreSnapshot(
  snapshotId: string,
): Promise<{ title: string; content: string; wordCount: number } | null> {
  const snap = await db.writingSnapshots.get(snapshotId);
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
