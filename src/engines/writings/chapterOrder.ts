// ============================================
// Manuscript order — moving and renumbering chapters
// ============================================
//
// `Writing.chapter` is the only order this app's manuscript has: the list
// sorts by it, reading mode walks it, and Compile and the publishing studio
// export in it. It is also a number the writer typed, so nothing in this file
// invents one it does not have to. Two things happen here and nowhere else:
//
//   MOVING a chapter past its neighbour, which redeals the numbers the
//   manuscript ALREADY holds along the new order. A book numbered 1, 2, 5, 9
//   comes out of a move still numbered 1, 2, 5, 9 — a writer who left room at
//   3 and 4 left it on purpose — so a single move reads as the exchange of two
//   numbers it looks like, and not as a renumbering nobody asked for.
//
//   RENUMBERING the whole manuscript 1..n. This is the tidy-up an import
//   leaves behind: `manuscriptPersist.ts` appends its chapters after the
//   highest number the project already used, so a forty-chapter novel imported
//   into six scratch drafts arrives as chapters 7..46. It is never automatic.
//   1, 5, 10 can be act numbering the writer chose, and a book is not a thing
//   to renumber behind its author's back — the view asks first.
//
// Why not `_shared/reorderItems.ts`: that stamps a 0-based `order` over every
// row of a scope from the ids the caller listed. `chapter` is 1-based, shown
// to the reader on the page, and OPTIONAL — the ideas and stubs that carry no
// number are not chapter zero, and this module leaves every one of them alone.
//
// Everything here is pure and total. An id the manuscript does not number, a
// move off either end and an empty project all produce no changes rather than
// an exception, and a manuscript already numbered 1..n produces none either —
// which is what makes the confirmation's promise that nothing else changes
// true, and what keeps a renumber out of the "changed recently" panel.

/** The manuscript-order fields of a `Writing`. All this module reads. */
export interface ChapterRow {
  id: string;
  chapter?: number;
}

/** A row that also carries what the full list comparator needs. */
export interface ManuscriptRow extends ChapterRow {
  updatedAt: number;
}

/** One row's new number. Only rows that actually change get one. */
export interface ChapterAssignment {
  id: string;
  chapter: number;
}

/** Up the manuscript, towards chapter one, or down it. */
export type ChapterDirection = -1 | 1;

/**
 * Manuscript order: numbered writings first by chapter ascending, then the
 * unnumbered ones by most recently touched, `id` breaking every remaining tie.
 *
 * An earlier comparator returned `b.updatedAt - a.updatedAt` whenever either
 * side lacked a chapter, which is not a total order once numbered and
 * unnumbered rows are mixed: `sort` saw contradictory answers depending on
 * which pairs it happened to compare, so the list reshuffled itself while the
 * author typed. Ties among numbered rows fall through to `id` — never to
 * `updatedAt`, which every autosave changes.
 *
 * It lives here rather than in the list that renders it because the reorder
 * arrows have to agree with it exactly: an arrow computed from one order and
 * shown against another is an arrow that appears to do nothing.
 */
export function compareManuscriptOrder(a: ManuscriptRow, b: ManuscriptRow): number {
  const aChapter = a.chapter;
  const bChapter = b.chapter;
  if (aChapter !== undefined && bChapter !== undefined) {
    if (aChapter !== bChapter) return aChapter - bChapter;
  } else if (aChapter !== undefined) {
    return -1;
  } else if (bChapter !== undefined) {
    return 1;
  } else if (a.updatedAt !== b.updatedAt) {
    return b.updatedAt - a.updatedAt;
  }
  return a.id.localeCompare(b.id);
}

/**
 * The numbered rows, in the order the manuscript reads them — the same order
 * `compareManuscriptOrder` puts them in, since chapter order is settled before
 * that comparator ever reaches `updatedAt`.
 *
 * A copy: the caller's array is never sorted in place.
 */
export function numberedInOrder<T extends ChapterRow>(
  rows: readonly T[],
): (T & { chapter: number })[] {
  return rows
    .filter((row): row is T & { chapter: number } => row.chapter !== undefined)
    .sort((left, right) => left.chapter - right.chapter || left.id.localeCompare(right.id));
}

/**
 * Deal the numbers the manuscript already holds along a new order: position i
 * takes the i-th smallest of them. Nothing is invented, the last chapter keeps
 * the highest number, and the gaps a writer left stay where they were left.
 *
 * The `previous + 1` floor is the one number this function does invent, and it
 * is there because duplicates happen — two chapters both numbered 7 would be
 * dealt 7 and 7 again, the tie would fall back to `id`, and the arrow the
 * writer just pressed would have moved nothing while staying enabled forever.
 * That is the bug the timeline's lane reorder was rewritten to fix. Forcing
 * each number past the one before it makes the move take, and costs a
 * manuscript without duplicates nothing at all.
 */
function dealAlong(ordered: readonly (ChapterRow & { chapter: number })[]): ChapterAssignment[] {
  const pool = ordered.map((row) => row.chapter).sort((left, right) => left - right);
  const changes: ChapterAssignment[] = [];
  let previous: number | null = null;
  ordered.forEach((row, index) => {
    const chapter = previous === null ? pool[index] : Math.max(pool[index], previous + 1);
    previous = chapter;
    if (row.chapter !== chapter) changes.push({ id: row.id, chapter });
  });
  return changes;
}

/**
 * Move one chapter a single place up or down the manuscript, and report the
 * numbers that puts it there. Nothing outside the numbered rows is touched.
 *
 * Total: a writing with no chapter number, an id belonging to another project,
 * and a move off either end of the book all return no changes rather than
 * throwing — the arrows are disabled at the ends, and this is what makes them
 * safe to press anyway.
 */
export function moveChapter<T extends ChapterRow>(
  rows: readonly T[],
  id: string,
  direction: ChapterDirection,
): ChapterAssignment[] {
  const ordered = numberedInOrder(rows);
  const from = ordered.findIndex((row) => row.id === id);
  if (from < 0) return [];
  const to = from + direction;
  if (to < 0 || to >= ordered.length) return [];
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  return dealAlong(ordered);
}

/**
 * The manuscript numbered 1..n in the order it reads right now.
 *
 * Idempotent by construction: run it on its own result and every row already
 * holds the number it would be given, so the plan comes back empty. That is
 * what lets the view disable the action when it would do nothing, and what
 * keeps a second press from stamping a fresh `updatedAt` on forty chapters
 * whose numbers did not move.
 */
export function renumberChapters<T extends ChapterRow>(rows: readonly T[]): ChapterAssignment[] {
  const changes: ChapterAssignment[] = [];
  numberedInOrder(rows).forEach((row, index) => {
    const chapter = index + 1;
    if (row.chapter !== chapter) changes.push({ id: row.id, chapter });
  });
  return changes;
}
