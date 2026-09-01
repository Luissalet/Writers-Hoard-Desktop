// ============================================
// Manuscript order — the single write
// ============================================
//
// The counterpart of `manuscriptPersist.ts`, for the other half of the import
// story. A plan from `chapterOrder.ts` lands in one transaction, because the
// obvious alternative does not survive a real book: renumbering forty chapters
// through the list's own `onEdit` is forty round trips, each one followed by
// `makeEntityHook`'s full refetch of the table — forty reads of every
// chapter's html to change forty integers, with the list rearranging itself
// after each one. This writes them together and lets the view refresh once.
//
// UPDATE ONLY, and only `chapter`. `db.writings.update` on an id that is no
// longer there writes nothing rather than resurrecting a deleted chapter, and
// a row whose `projectId` has stopped matching is skipped outright — a plan
// computed against a list one render stale can never reach another project's
// book.
//
// `updatedAt` moves, exactly as `updateWriting` and `_shared/reorderItems`
// move it: a chapter's place in the manuscript is part of the chapter. What
// keeps the "changed recently" panel honest is upstream instead — the planners
// return only the rows whose number really changes, so renumbering a
// manuscript that is already 1..n touches nothing at all.

import { db } from '@/db';
import { touchProject } from '@/db/operations';
import type { ChapterAssignment } from './chapterOrder';

/**
 * Apply a plan. Returns how many rows were written, which is not always
 * `assignments.length`: a chapter deleted in another window between the plan
 * and the write is passed over, not recreated.
 */
export async function applyChapterNumbers(
  projectId: string,
  assignments: readonly ChapterAssignment[],
): Promise<number> {
  if (assignments.length === 0) return 0;

  let written = 0;
  await db.transaction('rw', db.writings, async () => {
    const updatedAt = Date.now();
    for (const assignment of assignments) {
      const row = await db.writings.get(assignment.id);
      if (!row || row.projectId !== projectId) continue;
      written += await db.writings.update(assignment.id, {
        chapter: assignment.chapter,
        updatedAt,
      });
    }
  });

  // Outside the transaction, for the reason `manuscriptPersist.ts` sets out at
  // length: `touchProject` writes to `db.projects`, which this transaction
  // does not hold, and a floating write to an untouched table fails the whole
  // thing. Rearranging a book is an edit to it, so the dashboard's sort key
  // should move.
  if (written > 0) void touchProject(projectId);
  return written;
}
