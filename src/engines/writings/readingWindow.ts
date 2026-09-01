// ============================================
// Reading mode — what stays mounted, and how tall the rest is
// ============================================
//
// A finished manuscript in this app is 400 pieces of 4 000 words. Putting it
// on screen the obvious way costs 1.6M words of DOM, and putting an editor per
// chapter costs 400 ProseMirror instances — either one turns "read your own
// book" into a minute of frozen renderer.
//
// So reading mode mounts a WINDOW of pieces around the reading position and
// represents everything outside it as two spacer blocks. The scrollbar still
// measures the whole book, the DOM holds at most `MAX_MOUNTED_PIECES`, and the
// window follows the reader.
//
// Heights: a piece that has been on screen is remembered at the height it
// measured, for as long as reading mode stays open. A piece that never has is
// estimated from its word count. The estimate only decides where the scrollbar
// sits before the reader gets there; the measurement replaces it the moment
// the piece mounts, and the view re-anchors on the paragraph being read so the
// correction is never visible.

import type { Writing } from '@/types';
import { countWords } from '@/utils/text';

/** Pieces kept mounted behind and ahead of the one being read. */
export const WINDOW_BEHIND = 1;
export const WINDOW_AHEAD = 2;

/**
 * Ceiling on mounted pieces, whatever the manuscript's length: four chapters,
 * about 16 000 words. Reading forward never needs more — the piece ahead is
 * already mounted before its first line reaches the viewport.
 */
export const MAX_MOUNTED_PIECES = WINDOW_BEHIND + 1 + WINDOW_AHEAD;

export interface PieceWindow {
  /** First mounted index, inclusive. */
  first: number;
  /** Last mounted index, inclusive. `-1` when there is nothing to read. */
  last: number;
}

export interface ReadingPosition {
  /** The piece the top of the viewport is inside. */
  index: number;
  /** How far through that piece, 0…1. */
  fraction: number;
}

/**
 * The window that should be mounted while `index` is being read. Anchored on
 * the piece behind the reader and then filled forward to `MAX_MOUNTED_PIECES`,
 * so the first chapter of a manuscript gets the same four mounted pieces as
 * the middle of one.
 */
export function windowAround(index: number, count: number): PieceWindow {
  if (count <= 0) return { first: 0, last: -1 };
  const centre = Math.min(Math.max(index, 0), count - 1);
  const first = Math.max(0, centre - WINDOW_BEHIND);
  return { first, last: Math.min(count - 1, first + MAX_MOUNTED_PIECES - 1) };
}

export function sameWindow(left: PieceWindow, right: PieceWindow): boolean {
  return left.first === right.first && left.last === right.last;
}

// Chrome around a piece's prose: its title block, the one action it offers,
// the `.ProseMirror` padding and the rule that closes it.
const PIECE_CHROME_PX = 132;
// A line of the `wide` measure at the medium size runs to about a dozen words,
// and `line-height: 1.7` over a 17px body is ~29px.
const WORDS_PER_LINE = 12;
const LINE_PX = 29;
const MIN_BODY_PX = 72;

/** Standing height for a piece that has never been on screen. */
export function estimatePieceHeight(words: number): number {
  const lines = Math.ceil(Math.max(0, words) / WORDS_PER_LINE);
  return PIECE_CHROME_PX + Math.max(MIN_BODY_PX, lines * LINE_PX);
}

/**
 * Words per piece. `wordCount` is the saved figure the autosave maintains and
 * is what every other surface counts with; the HTML is only walked for a piece
 * that has text but no count yet — a Google Doc that was linked before its
 * first sync, in practice.
 */
export function measureWords(pieces: Writing[]): number[] {
  return pieces.map((piece) =>
    piece.wordCount > 0 || !piece.content ? piece.wordCount : countWords(piece.content),
  );
}

/**
 * Running word total before each piece, with the manuscript's total appended,
 * so progress can be stated in words of the whole book rather than in pixels
 * of the viewport.
 */
export function wordPrefixes(words: number[]): number[] {
  const prefixes = new Array<number>(words.length + 1);
  prefixes[0] = 0;
  for (let index = 0; index < words.length; index += 1) {
    prefixes[index + 1] = prefixes[index] + words[index];
  }
  return prefixes;
}

/** Total height of pieces `[from, to)`, measured where known and estimated otherwise. */
export function sumHeights(from: number, to: number, heightOf: (index: number) => number): number {
  let total = 0;
  for (let index = Math.max(0, from); index < to; index += 1) total += heightOf(index);
  return total;
}

/**
 * Which piece the given scroll offset is inside. Walks the same heights the
 * spacers are laid out with, so it answers for unmounted pieces too — dragging
 * the scrollbar across 300 chapters still names the right one.
 */
export function positionAt(
  scrollTop: number,
  count: number,
  heightOf: (index: number) => number,
): ReadingPosition {
  if (count <= 0) return { index: 0, fraction: 0 };
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const height = heightOf(index);
    if (scrollTop < offset + height || index === count - 1) {
      const fraction = height > 0 ? (scrollTop - offset) / height : 0;
      return { index, fraction: Math.min(1, Math.max(0, fraction)) };
    }
    offset += height;
  }
  return { index: count - 1, fraction: 1 };
}

/**
 * The offset whose position IS the reader's progress, which is not the offset
 * the scroller sits at.
 *
 * What has been read is what has passed the BOTTOM of the viewport, not the
 * top. Measuring from the top gets two cases wrong, and both of them are
 * visible: a manuscript that fits on one screen can never be scrolled at all,
 * so it reads 0 % however long the reader looks at it; and the last screenful
 * of ANY manuscript is unreachable, because `scrollTop` stops a viewport short
 * of the end — a finished book would sit at 96 %.
 */
export function readOffset(
  scrollTop: number,
  viewportHeight: number,
  contentHeight: number,
): number {
  if (contentHeight <= 0) return 0;
  return Math.min(contentHeight, Math.max(0, scrollTop) + Math.max(0, viewportHeight));
}

/** How far through the whole manuscript the reader is, 0…1, counted in words. */
export function manuscriptProgress(
  position: ReadingPosition,
  prefixes: number[],
  totalWords: number,
): number {
  if (totalWords <= 0) return 0;
  const before = prefixes[position.index] ?? 0;
  const words = (prefixes[position.index + 1] ?? before) - before;
  return Math.min(1, Math.max(0, (before + position.fraction * words) / totalWords));
}

// ============================================
// Where reading stopped — and how to get back to it
// ============================================
//
// A reader that opens at chapter one every time is a reader nobody finishes a
// book in. So the place is remembered per project, and it is remembered as a
// PIECE ID plus a fraction of that piece — never as a scroll offset. Offsets
// are measured against heights that change with the window, the reading face
// and the size setting; a position saved on a wide window would land pages off
// on a narrow one, and the estimates above mean the offset of an unmounted
// piece is not even a fixed number within one session.
//
// The id is also what survives the manuscript being rearranged: an index would
// name whichever chapter has since been moved into that slot, which is the
// failure that makes a bookmark worse than none. An index is stored beside it
// anyway, but only to answer the one question the id cannot — the chapter was
// deleted, and the closest the book still comes to where the reader was is the
// place it used to occupy.

/** The piece identity a resume reads. All of a `Writing` this needs. */
export interface PieceRow {
  id: string;
}

export interface SavedReadingPosition {
  /**
   * The project this position belongs to. Redundant with the settings key it
   * is stored under, and deliberately so: it is what stops a row that outlived
   * its project — a restore onto a reused id, a hand-edited value — from
   * dropping the writer into the middle of a different book.
   */
  projectId: string;
  /** The piece being read. */
  pieceId: string;
  /** How far through that piece, 0…1. */
  fraction: number;
  /** Where that piece sat when this was written. Consulted only if it is gone. */
  index: number;
}

/** Where reading picks up, and whether that is somewhere worth saying so. */
export interface ResumePoint {
  index: number;
  fraction: number;
  /**
   * True when this is a place the reader was left at rather than the front of
   * the book — the only case in which the view should announce that it moved
   * anybody.
   */
  resumed: boolean;
}

function manuscriptStart(): ResumePoint {
  return { index: 0, fraction: 0, resumed: false };
}

/**
 * Turn what was saved into a place that exists in the manuscript as it stands
 * now. Total: every way a stored position can have gone stale resolves to a
 * real index rather than to an exception or to a blank screen.
 */
export function resolveResumePoint(
  saved: SavedReadingPosition | null | undefined,
  pieces: readonly PieceRow[],
  projectId: string,
): ResumePoint {
  if (pieces.length === 0 || !saved) return manuscriptStart();
  // A position that names another project is not stale, it is somebody else's.
  if (saved.projectId !== projectId) return manuscriptStart();

  const found = pieces.findIndex((piece) => piece.id === saved.pieceId);
  if (found >= 0) {
    const fraction = Number.isFinite(saved.fraction)
      ? Math.min(1, Math.max(0, saved.fraction))
      : 0;
    return { index: found, fraction, resumed: found > 0 || fraction > 0 };
  }

  // The piece is gone. Its old place is the nearest the manuscript still comes
  // to where the reader was, so reading resumes at whatever stands there now —
  // clamped, because the book is at least one chapter shorter than it was. The
  // fraction does not survive that: two thirds of the way through a chapter
  // that no longer exists is not two thirds of the way through its neighbour.
  const index = Number.isFinite(saved.index)
    ? Math.min(Math.max(Math.trunc(saved.index), 0), pieces.length - 1)
    : 0;
  return { index, fraction: 0, resumed: index > 0 };
}

/**
 * The stored form, read back defensively. `settings` is a flat table any
 * future code path can write to, and a half-written or hand-edited value must
 * cost the writer a bookmark and never the ability to open the reader.
 */
export function parseReadingPosition(raw: string | undefined): SavedReadingPosition | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { projectId, pieceId, fraction, index } = parsed as Record<string, unknown>;
    if (typeof projectId !== 'string' || !projectId) return null;
    if (typeof pieceId !== 'string' || !pieceId) return null;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null;
    if (typeof index !== 'number' || !Number.isFinite(index)) return null;
    return { projectId, pieceId, fraction, index };
  } catch {
    return null;
  }
}

/**
 * The value written to the settings row, normalised on the way out.
 *
 * Three decimals of a chapter is a line or two of prose; the digits past that
 * are the difference between one animation frame and the next, and keeping
 * them would make two saves of the same reading position compare unequal — the
 * view uses this string to decide whether a write is worth making at all.
 */
export function serializeReadingPosition(position: SavedReadingPosition): string {
  return JSON.stringify({
    projectId: position.projectId,
    pieceId: position.pieceId,
    fraction: Number(Math.min(1, Math.max(0, position.fraction)).toFixed(3)),
    index: Math.max(0, Math.trunc(position.index)),
  });
}
