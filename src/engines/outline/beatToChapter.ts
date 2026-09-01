// ============================================
// Outline — turning a beat into the chapter that writes it
// ============================================
//
// The one transition the whole outline exists for, and until now the app made
// the writer do it by hand: leave the spine, open the manuscript, create a
// chapter, name it after the beat they still had in their head, come back to
// the outline, open the beat editor, and find that chapter in a dropdown. Six
// screens for "now write this one".
//
// The proofreader made the gap impossible to ignore — its two outline checks
// both end with "link them on the narrative spine", and the spine had no verb.
//
// Two rules shape what this writes:
//
//   THE BEAT IS NOT CONSUMED. A beat keeps its title, its description, its word
//   target and its position; the chapter is a new row that points back at it.
//   The writer can still rewrite the beat, and deleting the chapter later leaves
//   the beat exactly as `deleteWritingRestorable` leaves it — unlinked, not
//   gone.
//
//   THE DESCRIPTION IS A NOTE, NOT PROSE. What a beat says is a plan, in the
//   writer's shorthand, and dropping it into the manuscript as the chapter's
//   first paragraph would put words in the book that the writer did not write.
//   It goes into the SYNOPSIS field, which is where this app already keeps "what
//   this chapter is supposed to do" and which no export ever prints as prose.

import { db } from '@/db';
import { touchProject } from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import type { Writing } from '@/types';
import type { OutlineBeat } from './types';

/** Longest chapter title minted from a beat. Matches the manuscript importer. */
const MAX_TITLE_LENGTH = 120;

/** Longest synopsis carried over from a beat description. */
const MAX_SYNOPSIS_LENGTH = 2000;

export interface BeatChapterResult {
  writingId: string;
  title: string;
  chapter: number;
}

/**
 * Whether this beat still needs a chapter written for it.
 *
 * A link only counts when its target exists: a beat pointing at a chapter the
 * writer deleted is not written, it is broken, and offering to write it is
 * exactly the right repair. Same predicate the proofreader's
 * `findBeatsWithoutScene` uses, for the same reason — the two must never
 * disagree about what "linked" means.
 */
export function beatNeedsChapter(beat: OutlineBeat, writingIds: ReadonlySet<string>): boolean {
  return !(beat.linkedWritingId && writingIds.has(beat.linkedWritingId));
}

/**
 * The title the chapter gets. A beat with no title of its own would otherwise
 * mint an untitled row that is invisible in the manuscript list, so it falls
 * back to the first line of its description and then to a plain position.
 */
export function chapterTitleFromBeat(beat: OutlineBeat, position: number): string {
  const given = beat.title.trim();
  if (given) return given.slice(0, MAX_TITLE_LENGTH);
  const firstLine = (beat.description ?? '').split('\n').find(line => line.trim())?.trim() ?? '';
  return firstLine.slice(0, 60).trim() || String(position);
}

/**
 * Create the chapter this beat describes, link the beat to it, and say which
 * row to open.
 *
 * Both writes are in ONE transaction: a chapter created without its link is
 * worse than no chapter at all — it is a duplicate the writer has to find and
 * delete, on a spine that still says the beat is empty.
 *
 * Idempotent against a double click by construction, not by a busy flag: a beat
 * that already points at a live chapter returns that chapter instead of minting
 * a second one, and the check happens inside the transaction, against committed
 * state, so two clicks racing each other cannot both pass it.
 *
 * Numbering follows the manuscript importer's append-only rule — the new
 * chapter lands after the highest number the project already uses — because a
 * beat written out of order must not renumber work that is already written.
 */
export async function writeChapterForBeat(beat: OutlineBeat): Promise<BeatChapterResult> {
  const now = Date.now();

  const result = await db.transaction('rw', [db.writings, db.outlineBeats], async () => {
    const existing = await db.writings.where('projectId').equals(beat.projectId).toArray();

    if (beat.linkedWritingId) {
      const alreadyThere = existing.find(writing => writing.id === beat.linkedWritingId);
      if (alreadyThere) {
        return {
          writingId: alreadyThere.id,
          title: alreadyThere.title,
          chapter: alreadyThere.chapter ?? 0,
          created: false,
        };
      }
    }

    const chapter = existing.reduce(
      (highest, writing) => Math.max(highest, (writing.chapter ?? 0) + 1),
      1,
    );
    const title = chapterTitleFromBeat(beat, chapter);
    const synopsis = (beat.description ?? '').trim().slice(0, MAX_SYNOPSIS_LENGTH);

    const row: Writing = {
      id: generateId('wrt'),
      projectId: beat.projectId,
      title,
      status: 'draft',
      // Empty on purpose. The page is the writer's to fill; the plan lives in
      // the synopsis beside it.
      content: '',
      wordCount: 0,
      chapter,
      tags: [],
      createdAt: now,
      updatedAt: now,
      ...(synopsis ? { synopsis } : {}),
    };

    await db.writings.add(row);
    await db.outlineBeats.update(beat.id, { linkedWritingId: row.id, updatedAt: now });

    return { writingId: row.id, title, chapter, created: true };
  });

  // Outside the transaction for the same reason `manuscriptPersist` keeps it
  // there: `touchProject` writes to a table this transaction does not hold, and
  // a floating promise into it fails the whole thing.
  if (result.created) void touchProject(beat.projectId);

  return { writingId: result.writingId, title: result.title, chapter: result.chapter };
}
