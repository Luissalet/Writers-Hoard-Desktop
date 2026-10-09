// ============================================================================
// Beta reading — evaluating comments against a chapter (pure)
// ============================================================================

import { resolveAnchor, type BetaAnchor } from './anchor';
import { commentIdFor, responseIdFor } from './response';
import { blocksToSnapshot, chapterHash, diffText, splitBlocks, type TextDiff } from './text';
import {
  statusOf,
  type BetaCommentRow, type BetaStatus, type ReaderResponse,
} from './types';

export interface ChapterText {
  /** Normalised text of each block, in order. */
  blocks: string[];
  /** Hash of the snapshot built from them. */
  hash: string;
}

/** The chapter text a comment is judged against, from the chapter's sanitised HTML. */
export function chapterTextFromHtml(html: string): ChapterText {
  const blocks = splitBlocks(html);
  return { blocks: blocks.map(block => block.text), hash: chapterHash(blocksToSnapshot(blocks)) };
}

type Evaluation = Pick<BetaCommentRow,
  'anchorState' | 'matchParagraph' | 'matchStart' | 'matchEnd' | 'evaluatedHash'>;

/** Where a comment's quote is in this chapter. A chapter that no longer exists orphans everything. */
export function evaluateComment(anchor: BetaAnchor, chapter: ChapterText | null): Evaluation {
  if (!chapter) {
    return { anchorState: 'orphaned', matchParagraph: null, matchStart: null, matchEnd: null, evaluatedHash: 'missing' };
  }
  if (!anchor.quote.trim()) {
    // A comment on the chapter as a whole has nothing to lose.
    return { anchorState: 'attached', matchParagraph: null, matchStart: null, matchEnd: null, evaluatedHash: chapter.hash };
  }
  const match = resolveAnchor(chapter.blocks, anchor);
  return {
    anchorState: match.state,
    matchParagraph: match.paragraph,
    matchStart: match.start,
    matchEnd: match.end,
    evaluatedHash: chapter.hash,
  };
}

export interface ImportPlan {
  responseId: string;
  /** Rows to insert: comments whose id the project does not hold yet. */
  fresh: BetaCommentRow[];
  /** Ids already present: importing them again changes nothing. */
  duplicateIds: string[];
  /** Every id in the file, in order. */
  allIds: string[];
}

/**
 * Turn a response into comment rows. Pure: the caller says which ids exist and
 * how each chapter reads today, and gets back what to write.
 */
export function planImport(
  projectId: string,
  response: ReaderResponse,
  existingIds: ReadonlySet<string>,
  chapters: ReadonlyMap<string, ChapterText>,
  now: number,
): ImportPlan {
  const responseId = responseIdFor(projectId, response);
  const fresh: BetaCommentRow[] = [];
  const duplicateIds: string[] = [];
  const allIds: string[] = [];
  const seen = new Set<string>();
  for (const comment of response.comments) {
    const id = commentIdFor(projectId, response, comment);
    allIds.push(id);
    if (existingIds.has(id) || seen.has(id)) { duplicateIds.push(id); continue; }
    seen.add(id);
    const anchor: BetaAnchor = {
      quote: comment.quote, prefix: comment.prefix, suffix: comment.suffix, paragraph: comment.paragraph,
    };
    fresh.push({
      id, projectId, responseId,
      packageId: response.packageId,
      packageVersion: response.packageVersion,
      reader: response.reader,
      writingId: comment.chapterId,
      anchor,
      text: comment.text,
      createdAt: Date.parse(comment.createdAt) || 0,
      importedAt: now,
      updatedAt: now,
      ...evaluateComment(anchor, chapters.get(comment.chapterId) ?? null),
      resolved: false,
    });
  }
  return { responseId, fresh, duplicateIds, allIds };
}

export interface ChapterChange {
  changed: boolean;
  /** False when the package row is gone and only a hash is known: there is no text to compare. */
  comparable: boolean;
  diff: TextDiff | null;
}

/** Has the chapter moved on since the package left? A word-level summary when the snapshot is known. */
export function chapterChange(snapshotHash: string, snapshotText: string | null, current: ChapterText | null): ChapterChange {
  if (!current) return { changed: true, comparable: false, diff: null };
  if (current.hash === snapshotHash) return { changed: false, comparable: snapshotText !== null, diff: null };
  if (snapshotText === null) return { changed: true, comparable: false, diff: null };
  return { changed: true, comparable: true, diff: diffText(snapshotText, current.blocks.join('\n')) };
}

export interface StatusCounts {
  attached: number;
  moved: number;
  orphaned: number;
  resolved: number;
}

export function countStatuses(rows: ReadonlyArray<Pick<BetaCommentRow, 'resolved' | 'anchorState'>>): StatusCounts {
  const counts: StatusCounts = { attached: 0, moved: 0, orphaned: 0, resolved: 0 };
  for (const row of rows) counts[statusOf(row) as keyof StatusCounts]++;
  return counts;
}

/** The anchor states of the rows, ignoring whether they are resolved. */
export function countAnchorStates(rows: ReadonlyArray<Pick<BetaCommentRow, 'anchorState'>>): Omit<StatusCounts, 'resolved'> {
  const counts = { attached: 0, moved: 0, orphaned: 0 };
  for (const row of rows) counts[row.anchorState]++;
  return counts;
}

export const COMMENT_STATUSES: readonly BetaStatus[] = ['attached', 'moved', 'orphaned', 'resolved'];
