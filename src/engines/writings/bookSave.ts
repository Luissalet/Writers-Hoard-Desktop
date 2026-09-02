// ============================================
// Saving the book — one diff, one pass over the rows
// ============================================
//
// The book editor autosaves the whole document, and this is the whole of
// what that means: cut the document into sections (`bookDocument.ts`), diff
// them against the rows this session last saw, and write only what moved.
// Pure-async on purpose — it takes sections and a baseline and returns the
// next baseline — so the policy can be tested against a real Dexie without
// mounting an editor, and so `BookEditor.tsx` is left with only what a view
// can do: run it on a timer, stamp new ids on headings, and say what happened.
//
// The rules, in the order they are applied:
//
//   • An UPDATE is a guarded write (`updateWritingAtVersion` against the
//     baseline's version). A row that moved underneath the book is refused
//     and reported, never overwritten; the session marks it contested and
//     asks the writer.
//   • A CREATE is a new row for a heading that has none: the writer pressed
//     "Chapter" (or typed `# `), or wrote prose above the first heading. One
//     exception: a heading that carries the id of a row THIS pass or a recent
//     one deleted by a confirmed merge — Ctrl+Z after the merge brings the
//     heading back with its id — restores that row, history and margin notes
//     included, and writes the section into it as an update. Without that,
//     undoing a merge made a second row with the same title and prose.
//   • A MISSING row — in the baseline, no heading in the document — is deleted
//     ONLY when the writer confirmed the merge that removed its heading. Any
//     other missing row is refused back to the caller, which puts the heading
//     back. Nothing is ever deleted on the strength of a diff alone, and no
//     deletion happens in a pass that also had a conflict: the prose the
//     merge moved has to be confirmed on disk before the row that held it goes.
//   • After anything structural — a row created or deleted, a chapter moved —
//     the range is renumbered along the document's order, `firstChapter`
//     onwards, with the same guarded write. When the range GROWS into numbers
//     held by chapters outside it (a partial range with a chapter added), the
//     chapters outside are moved up first, highest number first, so no two
//     rows ever share a number; a chapter outside that moved underneath the
//     book stops the growth — nothing is created and the numbers are
//     reported as collisions.

import { db } from '@/db';
import type { Writing } from '@/types';
import { countWords } from '@/utils/text';
import { generateId } from '@/utils/idGenerator';
import { diffBookSections, type BookSection } from './bookDocument';
import {
  createWriting,
  deleteWritingRestorable,
  expectDeletedWriting,
  getWritings,
  restoreDeletedWriting,
  takeLastDeletedWriting,
  updateWritingAtVersion,
  WritingConflictError,
  WritingGoneError,
  type DeletedWritingBundle,
} from './operations';

/** A row as this book session last saw it confirmed on disk. */
export interface BookBaselineEntry {
  title: string;
  /** Canonical prose (see `canonicalHtml`), without the heading. */
  html: string;
  /**
   * The prose as the row holds it on disk: `html` once this session has
   * written the row, the row's own bytes before that (an imported chapter is
   * not always in the editor's spelling). The recovery journal is filed
   * against this, so a rescued draft is compared with the row it left.
   */
  persisted: string;
  /** The row's version token — what every write is made against. */
  version: number;
  chapter: number;
  wordCount: number;
}

/** Keyed by writing id, in book order. */
export type BookBaseline = Map<string, BookBaselineEntry>;

export type BookConflict =
  /** The row moved under the book; `current` is the text that won. */
  | { writingId: string; kind: 'moved'; current: Writing }
  /** The row is gone — deleted somewhere else while the book was open. */
  | { writingId: string; kind: 'gone' };

export interface SaveBookOptions {
  projectId: string;
  baseline: BookBaseline;
  sections: readonly BookSection[];
  /** Rows the writer agreed to delete by merging their chapter into the one before. */
  confirmedDeletes: ReadonlySet<string>;
  /** Rows waiting on the conflict banner: not written, not renumbered. */
  contested?: ReadonlySet<string>;
  /** Number the first section takes: 1 for the whole book, else the range's first. */
  firstChapter: number;
  /** Numbers held by chapters outside the range, to report a clash. */
  outsideChapters?: ReadonlySet<number>;
  /** Title for a row created from a heading with no text. */
  untitledTitle: string;
}

export interface SaveBookResult {
  baseline: BookBaseline;
  /** Rows created this pass, with the section (and heading) each belongs to. */
  created: { index: number; clientId: string | null; writingId: string; chapter: number }[];
  /**
   * Rows a recent merge had deleted and a heading brought back (undo): put
   * back on disk whole and written as updates. The caller's own undo offer
   * for them is spent.
   */
  restored: string[];
  /** Rows deleted this pass, each restorable. */
  deleted: DeletedWritingBundle[];
  /** Rows that lost their heading without a confirmed merge. Still on disk. */
  refusedMissing: string[];
  /**
   * Confirmed merges held back because this pass had a conflict: the prose
   * they moved is not confirmed on disk yet. The confirmation stands, and the
   * next clean pass deletes them.
   */
  deferredDeletes: string[];
  conflicts: BookConflict[];
  /**
   * Chapter numbers the range shares with chapters outside it. Empty after a
   * pass that moved the chapters outside up; the numbers it could not clear
   * when one of them had moved underneath the book.
   */
  collisions: number[];
  /** The numbers held outside the range after this pass — the caller's next `outsideChapters`. */
  outsideChapters: Set<number>;
  /** Whether anything reached the database. */
  wrote: boolean;
}

/**
 * Where the range's new numbering lands on numbers held outside it, and how
 * far those rows have to move up to be clear of it: the first colliding row
 * goes to the number just past the range, and every row above it keeps its
 * distance from it. Null when nothing collides.
 */
function outsideShift(
  firstChapter: number,
  sectionCount: number,
  outsideChapters: Iterable<number>,
): { from: number; by: number; collisions: number[] } | null {
  const lastChapter = firstChapter + sectionCount - 1;
  const collisions = [...outsideChapters]
    .filter((chapter) => chapter >= firstChapter && chapter <= lastChapter)
    .sort((a, b) => a - b);
  if (collisions.length === 0) return null;
  const from = collisions[0];
  return { from, by: lastChapter + 1 - from, collisions };
}

/** A numbered chapter of the project that is not in the book: what the range must not collide with. */
type OutsideRow = Writing & { chapter: number };

/** Hand a refused write to the caller as a conflict; let anything else throw. */
function toConflict(err: unknown, writingId: string): BookConflict {
  if (err instanceof WritingConflictError) return { writingId, kind: 'moved', current: err.current };
  if (err instanceof WritingGoneError) return { writingId, kind: 'gone' };
  throw err;
}

export async function saveBook(options: SaveBookOptions): Promise<SaveBookResult> {
  const { projectId, baseline, sections, confirmedDeletes, firstChapter, untitledTitle } = options;
  const contested = options.contested ?? new Set<string>();
  const outsideChapters = options.outsideChapters ?? new Set<number>();
  const diff = diffBookSections(baseline, sections);

  const next: BookBaseline = new Map(baseline);
  const result: SaveBookResult = {
    baseline: next,
    created: [],
    restored: [],
    deleted: [],
    refusedMissing: [],
    deferredDeletes: [],
    conflicts: [],
    collisions: [],
    outsideChapters: new Set(outsideChapters),
    wrote: false,
  };

  // ---- updates ----
  for (const update of diff.updates) {
    const entry = next.get(update.writingId);
    if (!entry || contested.has(update.writingId)) continue;
    const wordCount = countWords(update.html);
    const title = update.title.trim() || untitledTitle;
    try {
      const version = await updateWritingAtVersion(
        update.writingId,
        { title, content: update.html, wordCount },
        entry.version,
      );
      // The baseline keeps the heading's own text, not the title the row was
      // given: a heading left empty must not read as a title change on every
      // pass.
      next.set(update.writingId, {
        ...entry,
        title: update.title.trim(),
        html: update.html,
        persisted: update.html,
        wordCount,
        version,
      });
      result.wrote = true;
    } catch (err) {
      result.conflicts.push(toConflict(err, update.writingId));
    }
  }

  // ---- room for the range to grow ----
  // Before anything is created, and against the rows as they are now rather
  // than the numbers the session opened with (a chapter outside may have
  // been renumbered since): the chapters outside whose numbers the new
  // numbering would take are moved up, highest first. One that cannot be
  // moved — it changed under this very pass — means the numbering has
  // nowhere to go, and a row created now would take a number twice.
  const order: (string | null)[] = [...diff.order];
  let canCreate = diff.creates.length > 0;
  if (canCreate) {
    const outside = (await getWritings(projectId)).filter(
      (row): row is OutsideRow => typeof row.chapter === 'number' && !baseline.has(row.id),
    );
    result.outsideChapters = new Set(outside.map((row) => row.chapter));
    const shift = outsideShift(firstChapter, sections.length, result.outsideChapters);
    if (shift) {
      const moving = outside.filter((row) => row.chapter >= shift.from).sort((a, b) => b.chapter - a.chapter);
      try {
        // One transaction: a refusal rolls back the rows already moved, so
        // a failed pass leaves every number exactly as it was.
        await db.transaction('rw', [db.writings], async () => {
          for (const row of moving) {
            await updateWritingAtVersion(row.id, { chapter: row.chapter + shift.by }, row.updatedAt);
          }
        });
        for (const row of moving) result.outsideChapters.delete(row.chapter);
        for (const row of moving) result.outsideChapters.add(row.chapter + shift.by);
        if (moving.length > 0) result.wrote = true;
      } catch (err) {
        if (!(err instanceof WritingConflictError) && !(err instanceof WritingGoneError)) throw err;
        canCreate = false;
        result.collisions.push(...shift.collisions);
      }
    }
  }

  // ---- creates ----
  // The section order after this pass, with the new ids in place.
  for (const create of canCreate ? diff.creates : []) {
    const section = sections[create.index];
    const title = create.title.trim() || untitledTitle;
    const wordCount = countWords(create.html);
    // A provisional number: the renumbering below settles it against the
    // rest of the range in the same pass.
    const chapter = firstChapter + create.index;

    // The heading of a merged chapter, undone: the row it names was deleted
    // by a pass of ours and is still held for the undo offer. Put it back
    // rather than duplicate it, and write the section over it.
    const bundle = section.writingId !== null ? takeLastDeletedWriting(section.writingId) : null;
    if (bundle) {
      const id = bundle.writing.id;
      await restoreDeletedWriting(bundle);
      try {
        const version = await updateWritingAtVersion(
          id,
          { title, content: create.html, wordCount, chapter },
          bundle.writing.updatedAt,
        );
        next.set(id, {
          title: create.title.trim(),
          html: create.html,
          persisted: create.html,
          version,
          chapter,
          wordCount,
        });
        result.wrote = true;
      } catch (err) {
        // Back on disk but not ours to write: it enters the baseline as the
        // row stands, and the caller puts the question to the writer.
        result.conflicts.push(toConflict(err, id));
        next.set(id, {
          title: bundle.writing.title,
          html: bundle.writing.content,
          persisted: bundle.writing.content,
          version: bundle.writing.updatedAt,
          chapter: bundle.writing.chapter ?? chapter,
          wordCount: bundle.writing.wordCount,
        });
      }
      order[create.index] = id;
      result.restored.push(id);
      continue;
    }

    const now = Date.now();
    const id = generateId('wrt');
    await createWriting({
      id,
      projectId,
      title,
      status: 'draft',
      content: create.html,
      wordCount,
      chapter,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    next.set(id, {
      title: create.title.trim(),
      html: create.html,
      persisted: create.html,
      version: now,
      chapter,
      wordCount,
    });
    order[create.index] = id;
    result.created.push({ index: create.index, clientId: create.clientId, writingId: id, chapter });
    result.wrote = true;
  }

  // ---- missing ----
  const deletedIds: string[] = [];
  for (const id of diff.missing) {
    if (!confirmedDeletes.has(id)) {
      result.refusedMissing.push(id);
      continue;
    }
    if (result.conflicts.length > 0) {
      result.deferredDeletes.push(id);
      continue;
    }
    // Armed first, so the bundle waits in the operations module for the
    // heading's return (see the creates above) as well as in the caller's
    // undo bar.
    expectDeletedWriting(id);
    const bundle = await deleteWritingRestorable(id);
    next.delete(id);
    deletedIds.push(id);
    if (bundle) result.deleted.push(bundle);
    result.wrote = true;
  }

  // ---- numbering ----
  const docIds = order.filter((id): id is string => id !== null);
  const docIdSet = new Set(docIds);
  const previousOrder = [...baseline.keys()].filter((id) => docIdSet.has(id));
  const orderChanged =
    previousOrder.length !== docIds.length || previousOrder.some((id, index) => id !== docIds[index]);
  if (result.created.length > 0 || deletedIds.length > 0 || orderChanged) {
    for (let index = 0; index < docIds.length; index++) {
      const id = docIds[index];
      const chapter = firstChapter + index;
      if (result.outsideChapters.has(chapter) && !result.collisions.includes(chapter)) {
        result.collisions.push(chapter);
      }
      const entry = next.get(id);
      if (!entry || entry.chapter === chapter || contested.has(id)) continue;
      try {
        const version = await updateWritingAtVersion(id, { chapter }, entry.version);
        next.set(id, { ...entry, chapter, version });
        result.wrote = true;
      } catch (err) {
        result.conflicts.push(toConflict(err, id));
      }
    }
  }

  // ---- the next baseline, in document order ----
  // Refused rows keep their old place, so the caller's reinsertion and the
  // next diff agree about where they belong.
  const ordered: BookBaseline = new Map();
  const remaining = new Set(next.keys());
  for (const id of docIds) {
    const entry = next.get(id);
    if (entry) ordered.set(id, entry);
    remaining.delete(id);
  }
  if (remaining.size > 0) {
    const baselineOrder = [...baseline.keys()];
    const merged = [...ordered.keys()];
    for (const id of baselineOrder) {
      if (!remaining.has(id)) continue;
      const at = Math.min(baselineOrder.indexOf(id), merged.length);
      merged.splice(at, 0, id);
    }
    const rebuilt: BookBaseline = new Map();
    for (const id of merged) {
      const entry = next.get(id);
      if (entry) rebuilt.set(id, entry);
    }
    result.baseline = rebuilt;
  } else {
    result.baseline = ordered;
  }
  return result;
}
