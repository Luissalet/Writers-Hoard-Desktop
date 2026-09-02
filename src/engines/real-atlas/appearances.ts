// ============================================
// Where a place is on the page
// ============================================
//
// The Codex answers "which chapters name this character"; this is the same
// answer for a place, by its name and every alias («Toledo», «Toletum»),
// through the shared scanner (`_shared/nameAppearances`): whole words, case
// and accents folded, plurals accepted («los Toledos»).
//
// The manuscript is read once per project and kept as folded plain text
// (never the HTML, never the row): the editor then matches the name being
// typed against those strings in memory, so a keystroke costs a scan of the
// text and no Dexie read at all.

import { db } from '@/db';
import { compareManuscriptOrder } from '@/engines/writings/chapterOrder';
import { stripHtml } from '@/utils/text';
import { makeReadOnlyHook } from '@/engines/_shared/makeReadOnlyHook';
import {
  findNameAppearances,
  indexNameCandidates,
  tokenizeNameText,
  type NameCandidate,
} from '@/engines/_shared/nameAppearances';

/** One chapter a place is named in, in manuscript order. */
export interface PlaceAppearance {
  writingId: string;
  title: string;
  chapter?: number;
}

/** A writing as the scan needs it: its text, and what orders and names it. */
export interface AppearanceWriting {
  id: string;
  title: string;
  chapter?: number;
  updatedAt: number;
  /** The prose without its markup. */
  text: string;
}

/** A name shorter than this says nothing about where a place is: «Ur» is in every «ursa». */
export const MIN_APPEARANCE_NAME_LENGTH = 3;

/** The names worth looking for: trimmed, long enough, tokenised, one candidate each. */
function candidatesFor(names: readonly string[]): NameCandidate[] {
  const candidates: NameCandidate[] = [];
  const seen = new Set<string>();
  names.forEach((name, index) => {
    const trimmed = name.trim();
    if (trimmed.length < MIN_APPEARANCE_NAME_LENGTH) return;
    const tokens = tokenizeNameText(trimmed);
    if (tokens.length === 0) return;
    const key = tokens.join(' ');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ entryId: String(index), tokens });
  });
  return candidates;
}

/**
 * The writings that name the place — by any of `names` — in manuscript order.
 * Pure: the hook below hands it the project's writings, the bridge hands it
 * the rows it read.
 */
export function findPlaceAppearances(
  names: readonly string[],
  writings: readonly AppearanceWriting[],
): PlaceAppearance[] {
  const index = indexNameCandidates(candidatesFor(names));
  if (index.size === 0) return [];
  return [...writings]
    .sort(compareManuscriptOrder)
    .filter((row) => findNameAppearances(row.text, index, { plurals: true }).size > 0)
    .map((row) => ({ writingId: row.id, title: row.title, chapter: row.chapter }));
}

/** A row projected down to what the scan reads: the manuscript's markup and metadata stay behind. */
export function toAppearanceWriting(row: {
  id: string;
  title: string;
  chapter?: number;
  updatedAt: number;
  content: string;
}): AppearanceWriting {
  return { id: row.id, title: row.title, chapter: row.chapter, updatedAt: row.updatedAt, text: stripHtml(row.content) };
}

/** The project's writings as plain text, read once and refreshed on writes that go around the editor. */
export const useAppearanceWritings = makeReadOnlyHook<AppearanceWriting>({
  fetchFn: async (projectId) => {
    const rows: AppearanceWriting[] = [];
    await db.writings
      .where('projectId')
      .equals(projectId)
      .each((row) => {
        rows.push(toAppearanceWriting(row));
      });
    return rows;
  },
});
