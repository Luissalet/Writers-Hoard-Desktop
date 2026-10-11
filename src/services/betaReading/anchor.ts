// ============================================================================
// Beta reading — re-attaching a reader's quote to the chapter as it is today
// ============================================================================
//
// A reader comments on the chapter as it was when the package left. By the
// time the response comes back the writer has usually kept writing. The anchor
// a comment carries is therefore a quote with a little context, never an
// offset, and it is resolved against the CURRENT blocks:
//
//   attached  the quote is still there verbatim (several copies: the one whose
//             surroundings and paragraph agree best wins);
//   moved     the quote is not there verbatim but a close variant is (a word
//             changed, a phrase was reworded) — found by similarity, with the
//             context breaking ties;
//   orphaned  nothing close enough: the comment is kept, shown apart, and the
//             writer decides what it was about.
//
// Pure: no DOM, no Dexie.

import { normalizeText } from './text';

/** Characters of context kept on each side of a quote (inside its own paragraph). */
export const CONTEXT_CHARS = 40;
/** The longest quote a reader may anchor. */
export const MAX_QUOTE_CHARS = 600;
/** Below this length a quote is too small to be searched for by similarity. */
const MIN_FUZZY_QUOTE = 12;
const MIN_SIMILARITY = 0.7;
const MIN_SCORE = 0.7;

export interface BetaAnchor {
  /** The selected text; empty for a comment on the chapter as a whole. */
  quote: string;
  /** Up to CONTEXT_CHARS characters of the same paragraph before the quote. */
  prefix: string;
  /** Up to CONTEXT_CHARS characters of the same paragraph after the quote. */
  suffix: string;
  /** Index of the paragraph (block) that held the quote when the package was made. */
  paragraph: number;
}

export type AnchorState = 'attached' | 'moved' | 'orphaned';

export interface AnchorMatch {
  state: AnchorState;
  /** Paragraph that holds the quote now. */
  paragraph: number | null;
  /** Character range inside that paragraph's text. */
  start: number | null;
  end: number | null;
  /** 1 for a verbatim quote, otherwise the blended similarity. */
  score: number;
}

const ORPHANED: AnchorMatch = { state: 'orphaned', paragraph: null, start: null, end: null, score: 0 };

/** The anchor for `text.slice(start, end)` of block `paragraph`; what the reader page stores. */
export function makeAnchor(blockTexts: readonly string[], paragraph: number, start: number, end: number): BetaAnchor {
  const text = blockTexts[paragraph] ?? '';
  return {
    quote: text.slice(start, Math.min(end, start + MAX_QUOTE_CHARS)),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, end + CONTEXT_CHARS),
    paragraph,
  };
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** 0..1: how well the text around a candidate agrees with the context the reader saw. */
function contextScore(anchor: BetaAnchor, text: string, start: number, end: number): number {
  const before = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const after = text.slice(end, end + CONTEXT_CHARS);
  const side = (wanted: string, actual: string, shared: number): number => {
    if (!wanted && !actual) return 1;
    if (!wanted || !actual) return 0;
    return Math.min(1, shared / wanted.length);
  };
  return (side(anchor.prefix, before, commonSuffix(anchor.prefix, before))
    + side(anchor.suffix, after, commonPrefix(anchor.suffix, after))) / 2;
}

/** Edit distance, two rows. Strings are at most a few hundred characters. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - editDistance(a, b) / longest : 1;
}

const wordKey = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

interface Candidate {
  paragraph: number;
  start: number;
  end: number;
  overlap: number;
}

function fuzzyCandidates(blockTexts: readonly string[], quote: string): Candidate[] {
  const quoteWords = quote.split(' ').map(wordKey).filter(Boolean);
  if (!quoteWords.length) return [];
  const wanted = new Map<string, number>();
  for (const word of quoteWords) wanted.set(word, (wanted.get(word) ?? 0) + 1);
  const count = quoteWords.length;
  const found: Candidate[] = [];
  blockTexts.forEach((text, paragraph) => {
    const tokens = Array.from(text.matchAll(/\S+/g), m => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, key: wordKey(m[0]) }));
    for (let i = 0; i < tokens.length; i++) {
      const left = new Map(wanted);
      let hits = 0;
      for (let length = 1; length <= count + 3 && i + length <= tokens.length; length++) {
        const key = tokens[i + length - 1].key;
        const have = left.get(key) ?? 0;
        if (key && have > 0) { left.set(key, have - 1); hits++; }
        if (length < Math.max(1, count - 3)) continue;
        const overlap = hits / Math.max(length, count);
        if (overlap >= 0.5) found.push({ paragraph, start: tokens[i].start, end: tokens[i + length - 1].end, overlap });
      }
    }
  });
  return found.sort((x, y) => y.overlap - x.overlap).slice(0, 12);
}

/**
 * Where the anchor's quote is in the chapter now. `blockTexts` are the
 * normalised texts of the chapter's blocks, in order.
 */
export function resolveAnchor(blockTexts: readonly string[], anchor: BetaAnchor): AnchorMatch {
  const quote = normalizeText(anchor.quote);
  if (!quote) return ORPHANED;

  // 1. Verbatim: every occurrence, scored by its surroundings and its place.
  let best: AnchorMatch | null = null;
  let bestRank = -1;
  for (let paragraph = 0; paragraph < blockTexts.length; paragraph++) {
    const text = blockTexts[paragraph];
    for (let from = text.indexOf(quote); from !== -1; from = text.indexOf(quote, from + 1)) {
      const to = from + quote.length;
      const rank = contextScore(anchor, text, from, to) * 2 + (paragraph === anchor.paragraph ? 1 : 0)
        - Math.min(0.5, Math.abs(paragraph - anchor.paragraph) / 200);
      if (rank > bestRank) {
        bestRank = rank;
        best = { state: 'attached', paragraph, start: from, end: to, score: 1 };
      }
    }
  }
  if (best) return best;

  // 2. Close variant.
  if (quote.length < MIN_FUZZY_QUOTE) return ORPHANED;
  let top: AnchorMatch | null = null;
  for (const candidate of fuzzyCandidates(blockTexts, quote)) {
    const text = blockTexts[candidate.paragraph];
    const sim = similarity(quote, text.slice(candidate.start, candidate.end));
    if (sim < MIN_SIMILARITY) continue;
    const score = sim * 0.8 + contextScore(anchor, text, candidate.start, candidate.end) * 0.2;
    if (score >= MIN_SCORE && (!top || score > top.score)) {
      top = { state: 'moved', paragraph: candidate.paragraph, start: candidate.start, end: candidate.end, score };
    }
  }
  return top ?? ORPHANED;
}
