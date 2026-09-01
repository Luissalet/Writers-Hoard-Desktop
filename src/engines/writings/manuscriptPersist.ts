// ============================================
// Manuscript import — the single write
// ============================================
//
// The readers and the splitter never touch Dexie; this is the only place an
// imported manuscript becomes rows, and it is the counterpart of
// `dialog-scene/importPersist.ts`.
//
// Three guarantees, in the order they matter:
//
//   CREATE ONLY.  Every row is a freshly minted id written with `bulkAdd`,
//   which is `add` semantics for a whole array: a key that already exists is a
//   ConstraintError, not an overwrite. There is no `put`, no `update`, no
//   merge path anywhere in this file. An import cannot damage a writing that
//   already exists, whatever the chapter is called or numbered.
//
//   ONE TRANSACTION.  Forty chapters land together or not at all. A failure
//   half-way through leaves the project exactly as it was, which is the only
//   reason it is safe to offer this to someone whose novel is not backed up.
//
//   SANITISED.  Every chapter's html passes `sanitizeRichHtml` — the app's own
//   gate for foreign markup — before it is stored, and it happens HERE rather
//   than in the readers so that no future caller can find a way around it.
//
// Why this does not call `createWriting` from `operations.ts`: that function
// ends with `void touchProject(...)`, which writes to `db.projects`. Inside a
// transaction scoped to `db.writings` that write throws
// TableNotInTransactionError from a floating promise, and Dexie fails the
// whole transaction because of it — the import would abort at the first
// chapter. So the two things `createWriting` does are done here in the right
// order instead: the same add, then the same project touch once the rows are
// committed, so word counts, the dashboard's sort key and every list hook
// behave exactly as they do for a chapter typed by hand.

import { db } from '@/db';
import { touchProject } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import { countWords } from '@/utils/text';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import type { Writing } from '@/types';
import {
  ManuscriptImportError,
  chapterToHtml,
  yieldToUi,
  type ManuscriptBlock,
  type ManuscriptProgressFn,
} from './manuscriptImport';

/** What the preview hands over: a title the writer has seen, and its blocks. */
export interface ManuscriptChapterInput {
  title: string;
  blocks: ManuscriptBlock[];
}

export interface ManuscriptImportResult {
  chapterCount: number;
  wordCount: number;
}

/** Chapters sanitised between two yields. Each is a DOMPurify pass. */
const CHAPTERS_PER_SLICE = 4;

/** Longest title stored. A whole opening paragraph is not a chapter name. */
const MAX_TITLE_LENGTH = 120;

/**
 * The preview always sends a title; this is the floor under a blanked-out
 * rename box — the chapter's own opening words, and failing that its position.
 * A row with no title at all would be invisible in the list.
 */
function titleFor(chapter: ManuscriptChapterInput, position: number): string {
  const given = chapter.title.trim();
  if (given) return given.slice(0, MAX_TITLE_LENGTH);
  const opening = chapter.blocks.find((block) => block.text.trim())?.text.trim() ?? '';
  return opening.slice(0, 60).trim() || String(position);
}

/**
 * Create one writing per chapter, numbered in order, as drafts.
 *
 * Chapter numbers continue after the highest the project already uses, so an
 * import lands AFTER existing work in manuscript order instead of colliding
 * with it — the same append-only rule the screenplay importer follows for
 * scene order.
 */
export async function importManuscript(
  projectId: string,
  chapters: ManuscriptChapterInput[],
  onProgress?: ManuscriptProgressFn,
): Promise<ManuscriptImportResult> {
  if (chapters.length === 0) throw new ManuscriptImportError('no-chapters');

  const now = Date.now();
  const rows: Writing[] = [];
  let wordCount = 0;

  // Sanitising is the expensive half of this function (one DOMPurify pass per
  // chapter over its whole text), so it happens out here, in slices that yield
  // — not inside the transaction, where a long pause risks the idle timeout
  // Dexie applies to an open transaction.
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const content = sanitizeRichHtml(chapterToHtml(chapter.blocks));
    // Counted from the html that will actually be stored, so the number in the
    // list is the number the editor recomputes on the first keystroke.
    const words = countWords(content);
    wordCount += words;
    rows.push({
      id: generateId('wrt'),
      projectId,
      title: titleFor(chapter, index + 1),
      status: 'draft',
      content,
      wordCount: words,
      // Stamped inside the transaction, where the highest existing number is
      // read from committed state rather than from a stale snapshot.
      chapter: undefined,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    if ((index + 1) % CHAPTERS_PER_SLICE === 0) {
      onProgress?.({ phase: 'writing', ratio: (index + 1) / (chapters.length + 1) });
      await yieldToUi();
    }
  }

  await db.transaction('rw', db.writings, async () => {
    // The same read `getWritings` does on every visit to the list, for the one
    // number that cannot be computed anywhere else: where this book's numbering
    // has to start so it disturbs nothing.
    const existing = await db.writings.where('projectId').equals(projectId).toArray();
    const firstChapter = existing.reduce(
      (highest, writing) => Math.max(highest, (writing.chapter ?? 0) + 1),
      1,
    );
    rows.forEach((row, index) => {
      row.chapter = firstChapter + index;
    });
    // `bulkAdd`, never `bulkPut`: this is the create-only guarantee.
    await db.writings.bulkAdd(rows);
  });

  // Outside the transaction, exactly as `createWriting` does it: the dashboard
  // sorts projects by their own `updatedAt`, which importing a novel should
  // certainly move.
  void touchProject(projectId);

  onProgress?.({ phase: 'writing', ratio: 1 });
  return { chapterCount: rows.length, wordCount };
}
