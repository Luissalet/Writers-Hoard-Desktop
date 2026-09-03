// ============================================
// Name appearances — which named things a text mentions
// ============================================
//
// The one scan behind every "appears in" the app shows: the Codex asks which
// chapters name a character, the real atlas which chapters name a place, and
// the proofreader which characters vanish from the manuscript. All of them
// look for a short list of names in a long text, and all of them pay the same
// bill: ONE tokenisation of the text, with the names indexed by their first
// token, so a chapter costs `O(words)` map lookups however many names there
// are — never a regex per (chapter x name).
//
// Two things are folded away on both sides so the match reads the way a
// Spanish writer expects: case, and accents (`Malaga` finds «Málaga» and the
// other way round). Whole tokens only: «Toledo» is not found in «Toledano».
// Plurals are the caller's choice — a place may be «los Toledos», a
// character is rarely pluralised — and apply to the name's last token.

/** Split on everything that is not a letter, a digit or an in-word apostrophe. */
const WORD_BOUNDARY = /[^\p{L}\p{N}'’]+/u;
/** Quote marks that survived the split because they share a glyph with O'Brien. */
const EDGE_APOSTROPHES = /^['’]+|['’]+$/g;
/** `NFD` splits «á» into «a» plus a combining mark; this range is every such mark. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Lower case without accents: the form every comparison here is made in. */
export function foldNameText(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

/** The folded words of a text, in order, quotes stripped from their edges. */
export function tokenizeNameText(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of foldNameText(text).split(WORD_BOUNDARY)) {
    // «‘Marta’, she said» must still yield `marta`, while `o'brien` stays whole.
    const token = raw.replace(EDGE_APOSTROPHES, '');
    if (token) tokens.push(token);
  }
  return tokens;
}

/** A name to look for, already tokenised, and the id it stands for. */
export interface NameCandidate {
  entryId: string;
  tokens: string[];
}

/** The candidates grouped by first token: what `findNameAppearances` reads. */
export type NameIndex = ReadonlyMap<string, NameCandidate[]>;

export function indexNameCandidates(candidates: readonly NameCandidate[]): Map<string, NameCandidate[]> {
  const index = new Map<string, NameCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.tokens.length === 0) continue;
    const group = index.get(candidate.tokens[0]);
    if (group) group.push(candidate);
    else index.set(candidate.tokens[0], [candidate]);
  }
  return index;
}

export interface NameMatchOptions {
  /** Also accept the Spanish/English plural of the name's last token (`-s`, `-es`). */
  plurals?: boolean;
}

/** Does the haystack token stand for the name token — itself, or its plural when asked? */
function tokenMatches(found: string | undefined, wanted: string, plurals: boolean): boolean {
  if (found === undefined) return false;
  if (found === wanted) return true;
  if (!plurals) return false;
  return found === `${wanted}s` || found === `${wanted}es`;
}

/**
 * The ids of every candidate the text names, from one pass over it. The
 * candidates must have been tokenised with `tokenizeNameText` (or the
 * equivalent fold), and indexed with `indexNameCandidates`.
 */
export function findNameAppearances(
  text: string,
  index: NameIndex,
  options: NameMatchOptions = {},
): Set<string> {
  if (index.size === 0) return new Set();
  return findNameAppearancesInTokens(tokenizeNameText(text), index, options);
}

/**
 * The same scan over a text already tokenised with `tokenizeNameText`. For a
 * caller that asks the same chapters about different names — the atlas, as
 * the writer types a place's name — the tokenisation is the expensive half
 * and can be done once and kept; the lookups are all that is left to pay.
 */
export function findNameAppearancesInTokens(
  haystack: readonly string[],
  index: NameIndex,
  options: NameMatchOptions = {},
): Set<string> {
  const found = new Set<string>();
  if (index.size === 0) return found;
  const plurals = options.plurals === true;
  for (let at = 0; at < haystack.length; at += 1) {
    const word = haystack[at];
    // A one-word name in the plural has no first-token entry under its
    // singular: look the stem up as well before giving up on the word.
    const groups = [index.get(word)];
    if (plurals) {
      if (word.endsWith('es')) groups.push(index.get(word.slice(0, -2)));
      if (word.endsWith('s')) groups.push(index.get(word.slice(0, -1)));
    }
    for (const group of groups) {
      if (!group) continue;
      for (const candidate of group) {
        if (found.has(candidate.entryId)) continue;
        const last = candidate.tokens.length - 1;
        let matches = true;
        for (let offset = 0; offset <= last; offset += 1) {
          const wanted = candidate.tokens[offset];
          const ok = offset === last
            ? tokenMatches(haystack[at + offset], wanted, plurals)
            : haystack[at + offset] === wanted;
          if (!ok) {
            matches = false;
            break;
          }
        }
        if (matches) found.add(candidate.entryId);
      }
    }
  }
  return found;
}
