// ============================================
// Where a place is on the page
// ============================================
//
// The Codex answers "which chapters name this character"; this is the same
// answer for a place, by its name and every alias («Toledo», «Toletum»),
// through the shared scanner (`_shared/nameAppearances`): whole words, case
// and accents folded, plurals accepted («los Toledos»).
//
// The manuscript is read per project and kept as folded TOKENS, never the
// HTML and never the row: the editor then matches the name being typed
// against those tokens in memory, so a keystroke costs a pass of map lookups
// over the words and no Dexie read, no HTML stripping and no normalisation.
// The tokens live in a module-level cache keyed by writing and `updatedAt`,
// so a chapter is tokenised once per save however many pins are clicked
// (the editor remounts per place) and however many callers ask — the engine
// and the AI bridge share it.

import { db } from '@/db';
import type { Writing } from '@/types';
import { compareManuscriptOrder } from '@/engines/writings/chapterOrder';
import { stripHtml } from '@/utils/text';
import { makeReadOnlyHook } from '@/engines/_shared/makeReadOnlyHook';
import {
  findNameAppearancesInTokens,
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

/** A writing as the scan needs it: its words, and what orders and names it. */
export interface AppearanceWriting {
  id: string;
  title: string;
  chapter?: number;
  updatedAt: number;
  /** The prose without its markup. */
  text: string;
  /** `text` through `tokenizeNameText`, computed once with it. */
  tokens: readonly string[];
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
 * Pure: the engine hands it the project's writings, the bridge hands it the
 * rows it read. Nothing is touched when no name is worth looking for.
 */
export function findPlaceAppearances(
  names: readonly string[],
  writings: readonly AppearanceWriting[],
): PlaceAppearance[] {
  const index = indexNameCandidates(candidatesFor(names));
  if (index.size === 0 || writings.length === 0) return [];
  return [...writings]
    .sort(compareManuscriptOrder)
    .filter((row) => findNameAppearancesInTokens(row.tokens, index, { plurals: true }).size > 0)
    .map((row) => ({ writingId: row.id, title: row.title, chapter: row.chapter }));
}

/** What the scan reads from a row: the manuscript's markup and metadata stay behind. */
export type AppearanceSource = Pick<Writing, 'id' | 'title' | 'chapter' | 'updatedAt' | 'content'>;

/** A row projected down to text and tokens. Uncached: `cachedAppearanceWriting` is the one to call in a loop. */
export function toAppearanceWriting(row: AppearanceSource): AppearanceWriting {
  const text = stripHtml(row.content);
  return { id: row.id, title: row.title, chapter: row.chapter, updatedAt: row.updatedAt, text, tokens: tokenizeNameText(text) };
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/** One project's tokenised chapters, by writing id. */
type ProjectCache = Map<string, AppearanceWriting>;

const cache = new Map<string, ProjectCache>();

/**
 * The tokenised form of a row, reused while its `updatedAt` holds. Every
 * save bumps `updatedAt`, so a stale entry cannot survive an edit; a title
 * or chapter change alone bumps it too, which is why those are not compared.
 */
export function cachedAppearanceWriting(projectId: string, row: AppearanceSource): AppearanceWriting {
  let project = cache.get(projectId);
  if (!project) {
    project = new Map();
    cache.set(projectId, project);
  }
  const hit = project.get(row.id);
  if (hit && hit.updatedAt === row.updatedAt) return hit;
  const fresh = toAppearanceWriting(row);
  project.set(row.id, fresh);
  return fresh;
}

/**
 * The project's manuscript as tokens, streamed so no row's HTML outlives its
 * scan. Rows the cache still has are returned as they are; the project's
 * cache is then trimmed to the rows that exist, so a deleted chapter does not
 * linger.
 */
export async function loadAppearanceWritings(projectId: string): Promise<AppearanceWriting[]> {
  const rows: AppearanceWriting[] = [];
  await db.writings
    .where('projectId')
    .equals(projectId)
    .each((row) => {
      rows.push(cachedAppearanceWriting(projectId, row));
    });
  const project = cache.get(projectId);
  if (project && project.size !== rows.length) {
    const alive = new Set(rows.map((row) => row.id));
    for (const id of [...project.keys()]) if (!alive.has(id)) project.delete(id);
  }
  return rows;
}

/** Forget a project's tokens (tests, and a project being deleted). */
export function clearAppearanceCache(projectId?: string): void {
  if (projectId === undefined) cache.clear();
  else cache.delete(projectId);
}

/**
 * The project's writings as tokens, read once per engine mount and refreshed
 * on writes that go around the editor. Mounted by the engine, not by the
 * place editor: the editor remounts per selected place, and the manuscript
 * does not change because a different pin was clicked.
 */
export const useAppearanceWritings = makeReadOnlyHook<AppearanceWriting>({
  fetchFn: loadAppearanceWritings,
});
