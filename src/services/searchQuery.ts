// ============================================================================
// Search query grammar — parse once, match many
// ============================================================================
//
// A writer types one line into the command palette and expects it to behave
// like a search engine: quotes bind, a leading dash removes, `field:value`
// narrows, and everything else is an AND of words. This module turns that line
// into a plain object; nothing here touches Dexie, React or the DOM, so the
// grammar can be exercised on its own.
//
// Two rules shape every decision below:
//
//   • It never throws. A palette parses on every keystroke, which means it
//     parses every half-typed state of every query. An unterminated quote is a
//     phrase that runs to the end of the line, not an error.
//   • Nothing is silently dropped. A token that looks like a filter but is not
//     one — `http://x`, `nota:`, `updated:pronto` — stays literal search text.
//     Swallowing it would make the box lie about what it searched for.
//
// Accents are folded on BOTH sides (query and indexed text). This app's
// writers work in Spanish: "cancion" must find "canción", and a search box
// that disagrees is a search box nobody trusts.

import { shiftLocalDateKey, toLocalDateKey } from '@/engines/writing-stats/date';

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const WHITESPACE = /\s/;

/**
 * Punctuation trimmed from the edges of a bare word. `¿Quién?` has to find
 * `quien`. Deliberately absent: `:` and `/`, so `nota:` and `http://x` survive
 * as the literal text the writer typed.
 */
const EDGE_PUNCTUATION = /^[¿¡"'`(){}[\]«»…,.;!?*–—-]+|[¿¡"'`(){}[\]«»…,.;!?*–—-]+$/g;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE_DAYS = /^(\d{1,4})d$/;

/** Field prefixes the grammar understands. Anything else is literal text. */
export const SEARCH_FIELDS = ['engine', 'tag', 'type', 'status', 'is', 'updated'] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];
const FIELDS = new Set<string>(SEARCH_FIELDS);

/** The only `is:` value with a meaning. Anything else stays literal text. */
const IS_UNTAGGED = 'untagged';

export type SearchDateOperator = '>' | '>=' | '<' | '<=';

const INVERTED_OPERATOR: Record<SearchDateOperator, SearchDateOperator> = {
  '>': '<=',
  '>=': '<',
  '<': '>=',
  '<=': '>',
};

/** A day the writer named, resolved against "today" only at match time. */
export type SearchDateAnchor =
  | { kind: 'day'; day: string }
  | { kind: 'today' }
  | { kind: 'daysAgo'; days: number };

export interface SearchDateFilter {
  operator: SearchDateOperator;
  anchor: SearchDateAnchor;
}

export interface SearchFacetFilters {
  engines: string[];
  tags: string[];
  types: string[];
  statuses: string[];
}

export interface ParsedSearchQuery {
  /** Exactly what the writer typed, so the UI can show and store it. */
  raw: string;
  /** Bare words, folded. Every one must appear. */
  terms: string[];
  /** Quoted phrases, folded. Every one must appear contiguously. */
  phrases: string[];
  /** Folded words and phrases whose presence disqualifies a document. */
  exclusions: string[];
  include: SearchFacetFilters;
  exclude: SearchFacetFilters;
  /** true = must have no tags, false = must have tags, null = unset. */
  untagged: boolean | null;
  /** Every `updated:` clause. All must hold, so a range is just two clauses. */
  updated: SearchDateFilter[];
  /**
   * Required needles ordered longest first. The longest word is the most
   * selective one we can name without keeping term statistics, so testing it
   * first is what makes a non-matching document cheap.
   */
  needles: string[];
  isEmpty: boolean;
  hasText: boolean;
  hasEngineFilters: boolean;
  hasTypeFilters: boolean;
  hasTagFilters: boolean;
  hasStatusFilters: boolean;
  hasDateFilters: boolean;
  /** Filters only the content index carries the metadata to answer. */
  hasMetadataFilters: boolean;
  hasFilters: boolean;
  /**
   * The free text alone, folded, in the order it was typed — what a fuzzy
   * title matcher or the action filter should be given instead of the raw line.
   */
  text: string;
  /** Total length of the free text; the short-query floor is measured on this. */
  textLength: number;
}

/** Accent- and case-insensitive form used for every comparison in search. */
export function foldSearchText(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').toLocaleLowerCase();
}

/**
 * "Could this text possibly contain the term?" — the cheap gate in front of an
 * expensive matcher.
 *
 * Deliberately a SUPERSET test, never an exact one. Folding removes case and
 * accents, so a `true` here can still be a miss once the real matcher applies
 * case-sensitive, accent-exact or whole-word rules — but a `false` is always a
 * real miss, in every combination of those toggles, because folding can only
 * make two strings more equal, never less. That one-sidedness is what makes it
 * safe to skip a document on `false`.
 *
 * Project-wide replace uses it to decide whether a stored chapter is worth
 * parsing into a DOM at all: over 400 chapters, folding 25 kB of HTML is a
 * rounding error next to building 400 documents nobody matches.
 *
 * `needle` must already be folded — it is folded once per search, not once per
 * document.
 */
export function foldedContains(haystack: string, foldedNeedle: string): boolean {
  if (!foldedNeedle) return false;
  if (!haystack) return false;
  return foldSearchText(haystack).includes(foldedNeedle);
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

interface RawToken {
  /** Token text with the quote characters themselves removed. */
  text: string;
  /** Characters read before the first quote — the only region a field may live in. */
  headLength: number;
  /** The token opened with a quote, so the whole token is a phrase. */
  startsQuoted: boolean;
  quoted: boolean;
  /** Index just past the token. */
  next: number;
}

/**
 * Read one whitespace-delimited token, honouring quotes. An unterminated quote
 * simply consumes the rest of the line.
 */
function readToken(raw: string, start: number): RawToken {
  let text = '';
  let quoted = false;
  let startsQuoted = false;
  let inQuote = false;
  let headLength = -1;
  let index = start;

  for (; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') {
      if (!quoted) {
        quoted = true;
        startsQuoted = index === start;
        headLength = text.length;
      }
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && WHITESPACE.test(char)) break;
    text += char;
  }

  return {
    text,
    headLength: headLength < 0 ? text.length : headLength,
    startsQuoted,
    quoted,
    next: index,
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function parseDateAnchor(value: string): SearchDateAnchor | null {
  const folded = foldSearchText(value.trim());
  if (!folded) return null;

  const iso = ISO_DAY.exec(folded);
  if (iso) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { kind: 'day', day: folded };
  }
  // `hoy` costs one comparison and is the word half of these writers will type.
  if (folded === 'today' || folded === 'hoy') return { kind: 'today' };

  const relative = RELATIVE_DAYS.exec(folded);
  if (relative) return { kind: 'daysAgo', days: Number(relative[1]) };

  return null;
}

/**
 * `updated:>2026-08-01`, `updated:<30d`, `updated:today`. With no operator the
 * clause reads as "on or after", which is what `updated:7d` ("in the last
 * week") and `updated:today` both mean in the writer's head.
 */
function parseDateFilter(value: string, negated: boolean): SearchDateFilter | null {
  let rest = value.trim();
  let operator: SearchDateOperator = '>=';

  if (rest.startsWith('>=') || rest.startsWith('<=')) {
    operator = rest.slice(0, 2) as SearchDateOperator;
    rest = rest.slice(2);
  } else if (rest.startsWith('>') || rest.startsWith('<')) {
    operator = rest.slice(0, 1) as SearchDateOperator;
    rest = rest.slice(1);
  }

  const anchor = parseDateAnchor(rest);
  if (!anchor) return null;
  return { operator: negated ? INVERTED_OPERATOR[operator] : operator, anchor };
}

/** Resolve a named day to a local `YYYY-MM-DD` key. Never crosses through UTC. */
export function resolveSearchDay(anchor: SearchDateAnchor, today: string): string {
  switch (anchor.kind) {
    case 'day':
      return anchor.day;
    case 'today':
      return today;
    case 'daysAgo':
      return shiftLocalDateKey(today, -anchor.days);
  }
}

/**
 * Local-calendar day comparison. `YYYY-MM-DD` sorts lexicographically in
 * chronological order, so no Date objects are built per document.
 */
export function matchesDateFilters(
  filters: readonly SearchDateFilter[],
  day: string,
  today: string,
): boolean {
  if (filters.length === 0) return true;
  // A row with no timestamp (map pins) can satisfy no date clause, in either
  // direction — "before 2026" would otherwise sweep every undated row in.
  if (!day) return false;

  for (const filter of filters) {
    const target = resolveSearchDay(filter.anchor, today);
    switch (filter.operator) {
      case '>':
        if (!(day > target)) return false;
        break;
      case '>=':
        if (!(day >= target)) return false;
        break;
      case '<':
        if (!(day < target)) return false;
        break;
      case '<=':
        if (!(day <= target)) return false;
        break;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface QueryAccumulator {
  terms: string[];
  phrases: string[];
  /** Every required word and phrase in the order it was typed. */
  textParts: string[];
  exclusions: string[];
  include: SearchFacetFilters;
  exclude: SearchFacetFilters;
  untagged: boolean | null;
  updated: SearchDateFilter[];
}

function emptyFacets(): SearchFacetFilters {
  return { engines: [], tags: [], types: [], statuses: [] };
}

function pushUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) values.push(value);
}

function addText(accumulator: QueryAccumulator, text: string, phrase: boolean, negated: boolean): void {
  const folded = phrase
    ? foldSearchText(text).trim()
    : foldSearchText(text).replace(EDGE_PUNCTUATION, '');
  // Bare punctuation ("-", "?") is typing noise, not a term the writer means.
  if (!folded || !LETTER_OR_DIGIT.test(folded)) return;
  if (negated) {
    pushUnique(accumulator.exclusions, folded);
    return;
  }
  if (phrase) pushUnique(accumulator.phrases, folded);
  else pushUnique(accumulator.terms, folded);
  accumulator.textParts.push(folded);
}

/** Returns false when the value makes no sense for the field, so it can fall back to text. */
function addFilter(
  accumulator: QueryAccumulator,
  field: SearchField,
  value: string,
  negated: boolean,
): boolean {
  const bucket = negated ? accumulator.exclude : accumulator.include;
  const folded = foldSearchText(value).trim();

  switch (field) {
    case 'engine':
      pushUnique(bucket.engines, folded);
      return true;
    case 'tag':
      pushUnique(bucket.tags, folded);
      return true;
    case 'type':
      pushUnique(bucket.types, folded);
      return true;
    case 'status':
      pushUnique(bucket.statuses, folded);
      return true;
    case 'is':
      if (folded !== IS_UNTAGGED) return false;
      accumulator.untagged = !negated;
      return true;
    case 'updated': {
      const filter = parseDateFilter(value, negated);
      if (!filter) return false;
      accumulator.updated.push(filter);
      return true;
    }
  }
}

/**
 * Turn a raw query into a structured one. Total order is a single left-to-right
 * scan; malformed input degrades into literal text rather than failing.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const accumulator: QueryAccumulator = {
    terms: [],
    phrases: [],
    textParts: [],
    exclusions: [],
    include: emptyFacets(),
    exclude: emptyFacets(),
    untagged: null,
    updated: [],
  };

  let index = 0;
  while (index < raw.length) {
    if (WHITESPACE.test(raw[index])) {
      index += 1;
      continue;
    }

    // A dash only negates when something follows it; a lone "-" is punctuation.
    let negated = false;
    if (raw[index] === '-' && index + 1 < raw.length && !WHITESPACE.test(raw[index + 1])) {
      negated = true;
      index += 1;
    }

    const token = readToken(raw, index);
    index = token.next;
    if (!token.text) continue;

    if (token.startsQuoted) {
      addText(accumulator, token.text, true, negated);
      continue;
    }

    const colon = token.text.slice(0, token.headLength).indexOf(':');
    if (colon > 0) {
      const field = foldSearchText(token.text.slice(0, colon));
      const value = token.text.slice(colon + 1);
      if (FIELDS.has(field)) {
        // `tag:` with nothing after it is a half-typed filter, not a search for
        // the word "tag:" — ignoring it keeps results steady while typing.
        if (!value.trim()) continue;
        if (addFilter(accumulator, field as SearchField, value, negated)) continue;
      }
    }

    addText(accumulator, token.text, token.quoted, negated);
  }

  const needles = [...accumulator.phrases, ...accumulator.terms]
    .sort((left, right) => right.length - left.length);
  const textLength = needles.reduce((total, needle) => total + needle.length, 0);

  const hasEngineFilters = accumulator.include.engines.length > 0
    || accumulator.exclude.engines.length > 0;
  const hasTypeFilters = accumulator.include.types.length > 0
    || accumulator.exclude.types.length > 0;
  const hasTagFilters = accumulator.include.tags.length > 0
    || accumulator.exclude.tags.length > 0
    || accumulator.untagged !== null;
  const hasStatusFilters = accumulator.include.statuses.length > 0
    || accumulator.exclude.statuses.length > 0;
  const hasDateFilters = accumulator.updated.length > 0;
  const hasMetadataFilters = hasTypeFilters || hasTagFilters || hasStatusFilters || hasDateFilters;
  // Exclusions alone ("-sangre") name no result set worth listing — the palette
  // treats that as still-empty and keeps showing the operator hints.
  const hasText = needles.length > 0;

  return {
    raw,
    terms: accumulator.terms,
    phrases: accumulator.phrases,
    exclusions: accumulator.exclusions,
    include: accumulator.include,
    exclude: accumulator.exclude,
    untagged: accumulator.untagged,
    updated: accumulator.updated,
    needles,
    isEmpty: !hasText && !hasMetadataFilters && !hasEngineFilters,
    hasText,
    hasEngineFilters,
    hasTypeFilters,
    hasTagFilters,
    hasStatusFilters,
    hasDateFilters,
    hasMetadataFilters,
    hasFilters: hasEngineFilters || hasMetadataFilters,
    text: accumulator.textParts.join(' '),
    textLength,
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface QueryTextMatch {
  /** Offset of the match inside the folded haystack. */
  index: number;
  length: number;
}

const WHOLE_DOCUMENT: QueryTextMatch = { index: 0, length: 0 };

/** True when the document carries something the writer asked to exclude. */
export function hasExcludedText(query: ParsedSearchQuery, haystack: string): boolean {
  for (const exclusion of query.exclusions) {
    if (haystack.includes(exclusion)) return true;
  }
  return false;
}

/**
 * Locate the query in a folded haystack, or return null when a needle is
 * missing. The longest needle is looked up first — it is both the most
 * selective test and the most informative place to centre a snippet.
 */
export function findRequiredMatch(
  query: ParsedSearchQuery,
  haystack: string,
): QueryTextMatch | null {
  const needles = query.needles;
  if (needles.length === 0) return WHOLE_DOCUMENT;

  const index = haystack.indexOf(needles[0]);
  if (index < 0) return null;
  for (let position = 1; position < needles.length; position += 1) {
    if (!haystack.includes(needles[position])) return null;
  }
  return { index, length: needles[0].length };
}

/** Facets a document exposes to the filter half of the grammar. */
export interface SearchFacets {
  engineId: string;
  /** Folded tags. */
  tags: readonly string[];
  /** Folded single-valued type (codex kind, note kind, beat level…), or ''. */
  type: string;
  /** Folded single-valued status (draft, planted, confirmed…), or ''. */
  status: string;
  /** Local `YYYY-MM-DD` of the last change, or '' when the row is undated. */
  day: string;
}

export interface ResolvedEngineFilter {
  /** null when the query names no engine to keep. */
  include: Set<string> | null;
  exclude: Set<string>;
}

/** `tag:mag` finds `magia`; a filter you have to spell in full is a filter nobody uses. */
function facetMatches(value: string, token: string): boolean {
  return value === token || (value.length > 0 && value.startsWith(token));
}

function resolveEngineTokens(
  tokens: readonly string[],
  engines: ReadonlyArray<{ id: string; name: string }>,
): Set<string> {
  const ids = new Set<string>();
  for (const token of tokens) {
    let matched = false;
    for (const engine of engines) {
      const id = foldSearchText(engine.id);
      const name = foldSearchText(engine.name);
      if (
        id === token || name === token
        || id.startsWith(token) || name.startsWith(token)
        || name.includes(token)
      ) {
        ids.add(engine.id);
        matched = true;
      }
    }
    // An id we do not know (engine not registered in this context) still has to
    // be usable, or `engine:` would go silent in exactly the case it matters.
    if (!matched) ids.add(token);
  }
  return ids;
}

/**
 * Turn `engine:` tokens into engine ids once per search. Tokens match an id or
 * a localized engine name, whole or by prefix, so `engine:esc` reaches
 * "Escritos" and `engine:writ` reaches "writings".
 */
export function resolveEngineFilter(
  query: ParsedSearchQuery,
  engines: ReadonlyArray<{ id: string; name: string }>,
): ResolvedEngineFilter | null {
  if (!query.hasEngineFilters) return null;
  return {
    include: query.include.engines.length > 0
      ? resolveEngineTokens(query.include.engines, engines)
      : null,
    exclude: resolveEngineTokens(query.exclude.engines, engines),
  };
}

/**
 * Apply the filter half of the grammar. Every test here is O(1) or O(#tags),
 * which is why it runs before any text is scanned.
 */
export function matchesFacets(
  query: ParsedSearchQuery,
  facets: SearchFacets,
  engines: ResolvedEngineFilter | null,
  today: string,
): boolean {
  if (engines) {
    if (engines.include && !engines.include.has(facets.engineId)) return false;
    if (engines.exclude.has(facets.engineId)) return false;
  }

  if (query.untagged === true && facets.tags.length > 0) return false;
  if (query.untagged === false && facets.tags.length === 0) return false;

  for (const token of query.include.tags) {
    if (!facets.tags.some(tag => facetMatches(tag, token))) return false;
  }
  for (const token of query.exclude.tags) {
    if (facets.tags.some(tag => facetMatches(tag, token))) return false;
  }

  if (query.include.types.length > 0
    && !query.include.types.some(token => facetMatches(facets.type, token))) return false;
  if (query.exclude.types.some(token => facetMatches(facets.type, token))) return false;

  if (query.include.statuses.length > 0
    && !query.include.statuses.some(token => facetMatches(facets.status, token))) return false;
  if (query.exclude.statuses.some(token => facetMatches(facets.status, token))) return false;

  return matchesDateFilters(query.updated, facets.day, today);
}

/** Today as a local calendar day — the anchor every relative date resolves against. */
export function searchToday(): string {
  return toLocalDateKey();
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------
//
// Matching answers yes or no; ranking answers which of the four hundred yeses
// the writer meant. Without it the palette hands back whatever order the tables
// happened to iterate in, which on a real manuscript puts chapter three above
// the codex entry that carries the name in its title.
//
// The weights below encode one priority order, and the gaps between them are
// the point: a title beats a body, a whole word beats a fragment of a longer
// word, an early mention beats one on page forty, and — only ever as a
// tiebreaker — a chapter touched this morning beats one untouched since last
// winter. Recency is capped far below the title band deliberately: "I edited
// this recently" must never outrank "this is what the thing is called".

const RANK_TITLE = 400;
const RANK_TITLE_EXACT = 300;
const RANK_TITLE_PREFIX = 150;
const RANK_TITLE_WORD = 80;
const RANK_BODY_WORD = 40;
const RANK_BODY_EARLY = 30;
/** Characters of body that cost one point of "mentioned early" credit. */
const RANK_BODY_SPAN = 400;
const RANK_RECENCY = 60;
/** Past this the row is simply old, and every old row ranks alike. */
const RANK_RECENCY_DAYS = 180;
const DAY_MS = 86_400_000;
/**
 * How many occurrences of a needle are examined before settling for a mid-word
 * one. A chapter can say "part" five hundred times without ever saying "art" on
 * its own, and ranking a match must not turn into a second full scan of it.
 */
const WORD_PROBE_LIMIT = 16;

function isWordBoundary(char: string | undefined): boolean {
  return char === undefined || !LETTER_OR_DIGIT.test(char);
}

/** First occurrence of `needle`, preferring one that stands as a whole word. */
function locateNeedle(text: string, needle: string): { index: number; whole: boolean } | null {
  let index = text.indexOf(needle);
  if (index < 0) return null;
  const first = index;
  for (let probe = 0; index >= 0 && probe < WORD_PROBE_LIMIT; probe += 1) {
    if (isWordBoundary(text[index - 1]) && isWordBoundary(text[index + needle.length])) {
      return { index, whole: true };
    }
    index = text.indexOf(needle, index + 1);
  }
  return { index: first, whole: false };
}

/** What ranking reads off a document. Everything else it takes from the query. */
export interface SearchRankingInput {
  /** Folded `title\nbody` — the same text the needles were matched against. */
  haystack: string;
  /** Where the body starts inside `haystack`. */
  bodyOffset: number;
  /** Last change as epoch ms, or 0 for a row that carries no timestamp. */
  updatedAt: number;
}

/**
 * Recency as a bounded tiebreaker: full credit today, none once it is stale.
 * Left unrounded on purpose — inside the window an hour of difference should
 * still break a tie, and the cap is what keeps it from crossing a text band.
 */
function recencyScore(updatedAt: number, now: number): number {
  if (!updatedAt) return 0;
  const days = (now - updatedAt) / DAY_MS;
  // A stamp from the future is a clock the writer cannot fix; treat it as now
  // rather than letting it score negative and sink below undated rows.
  if (days <= 0) return RANK_RECENCY;
  if (days >= RANK_RECENCY_DAYS) return 0;
  return RANK_RECENCY * (1 - days / RANK_RECENCY_DAYS);
}

/**
 * Score one matched document. This only ever runs on documents that already
 * matched, so it can afford to read the text more closely than the scan that
 * found them — which must stay cheap enough to run over every chapter.
 *
 * A query that is nothing but filters (`is:untagged tag:magia`) has no needle
 * to weigh and scores on recency alone, which is the only ordering such a query
 * implies: the loose ends you touched most recently, first.
 */
export function scoreSearchMatch(
  query: ParsedSearchQuery,
  input: SearchRankingInput,
  now: number,
): number {
  let score = recencyScore(input.updatedAt, now);
  const needles = query.needles;
  if (needles.length === 0) return score;

  const title = input.haystack.slice(0, Math.max(0, input.bodyOffset - 1));
  let inTitle = 0;
  let wholeInTitle = 0;
  for (const needle of needles) {
    const found = locateNeedle(title, needle);
    if (!found) continue;
    inTitle += 1;
    if (found.whole) wholeInTitle += 1;
  }
  // Scored as a fraction, so half a query in the title beats none of it.
  score += Math.round((RANK_TITLE * inTitle) / needles.length);
  score += Math.round((RANK_TITLE_WORD * wholeInTitle) / needles.length);

  // The longest needle carries the query, so it is the one the exact and prefix
  // bands are measured against, and the one the body is read for.
  const primary = needles[0];
  if (title === primary) score += RANK_TITLE_EXACT;
  else if (title.startsWith(primary)) score += RANK_TITLE_PREFIX;

  const inBody = locateNeedle(input.haystack.slice(input.bodyOffset), primary);
  if (inBody) {
    if (inBody.whole) score += RANK_BODY_WORD;
    score += Math.max(0, RANK_BODY_EARLY - Math.floor(inBody.index / RANK_BODY_SPAN));
  }
  return score;
}

/** What a result set must expose for ranking to be able to page it fairly. */
export interface RankedMatch {
  engineId: string;
  score: number;
}

function byScoreDescending(left: RankedMatch, right: RankedMatch): number {
  return right.score - left.score;
}

/**
 * Choose which matches go on the page: best score first, except that every
 * engine which matched at all gets its own best hit in before the loudest
 * engine takes the remaining room.
 *
 * That reservation is not politeness. A protagonist's name in a four-hundred-
 * chapter manuscript fills the whole page with chapters, and then the codex
 * entry, the outline beat and the note that also carry it never appear — not
 * even as a section with a count beside it, because a section the palette has
 * no row for is not drawn at all.
 *
 * Sorting is stable, so matches that score alike stay in the order the scan
 * found them and the same query keeps giving the same answer.
 */
export function selectRankedMatches<T extends RankedMatch>(matches: T[], limit: number): T[] {
  if (limit <= 0) return [];
  const ordered = [...matches].sort(byScoreDescending);
  if (ordered.length <= limit) return ordered;

  const keep = new Set<number>();
  const engines = new Set<string>();
  for (let index = 0; index < ordered.length && keep.size < limit; index += 1) {
    if (engines.has(ordered[index].engineId)) continue;
    engines.add(ordered[index].engineId);
    keep.add(index);
  }
  for (let index = 0; index < ordered.length && keep.size < limit; index += 1) {
    keep.add(index);
  }
  return ordered.filter((_, index) => keep.has(index));
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export interface FieldCompletion {
  text: string;
  caret: number;
}

/**
 * Complete the `field:` the caret sits in, for Tab. Returns null when there is
 * nothing to complete, so the caller can fall back to its own Tab behaviour.
 */
export function completeSearchField(raw: string, caret: number): FieldCompletion | null {
  const position = Math.max(0, Math.min(caret, raw.length));
  let start = position;
  while (start > 0 && !WHITESPACE.test(raw[start - 1])) start -= 1;

  let token = raw.slice(start, position);
  let prefix = '';
  if (token.startsWith('-')) {
    prefix = '-';
    token = token.slice(1);
  }
  if (!token) return null;

  const colon = token.indexOf(':');
  let completion: string | null = null;

  if (colon < 0) {
    const folded = foldSearchText(token);
    const field = SEARCH_FIELDS.find(candidate => candidate.startsWith(folded) && candidate !== folded);
    completion = field ? `${field}:` : null;
  } else if (foldSearchText(token.slice(0, colon)) === 'is') {
    const value = foldSearchText(token.slice(colon + 1));
    completion = value && IS_UNTAGGED.startsWith(value) && value !== IS_UNTAGGED
      ? `is:${IS_UNTAGGED}`
      : null;
  }

  if (!completion) return null;
  const inserted = `${prefix}${completion}`;
  return {
    text: `${raw.slice(0, start)}${inserted}${raw.slice(position)}`,
    caret: start + inserted.length,
  };
}
