import { entryNames, type MatchableEntry } from './matcher';
import { foldAlias } from './aliases';

export interface IndexedMention {
  /** Original UTF-16 offsets, suitable for text nodes and editor decorations. */
  from: number;
  to: number;
  entryIds: string[];
  matchedAlias: string;
  /** Shared names are evidence to disambiguate, never a claim about one card. */
  ambiguous: boolean;
}

export interface MentionIndex {
  patternCount: number;
  find: (text: string) => IndexedMention[];
}

interface NormalizedSource { text: string; starts: Uint32Array; ends: Uint32Array }
const WHITESPACE = /\s/u;
const WORD = /[\p{L}\p{N}_]/u;

/** Preserve source offsets when accents decompose, case folds, or whitespace collapses. */
function normalizeSource(source: string): NormalizedSource {
  let starts = new Uint32Array(Math.max(8, source.length));
  let ends = new Uint32Array(starts.length);
  const parts: string[] = [];
  let offset = 0, size = 0, whitespace = false;
  const ensure = (capacity: number) => {
    if (capacity <= starts.length) return;
    const nextStarts = new Uint32Array(Math.max(starts.length * 2, capacity)); nextStarts.set(starts); starts = nextStarts;
    const nextEnds = new Uint32Array(starts.length); nextEnds.set(ends); ends = nextEnds;
  };
  for (const character of source) {
    const end = offset + character.length;
    if (WHITESPACE.test(character)) {
      if (whitespace && size) ends[size - 1] = end;
      else { ensure(size + 1); parts.push(' '); starts[size] = offset; ends[size] = end; size++; }
      whitespace = true;
    } else {
      // Fold the Greek final sigma too, so case folding is independent of word context.
      const folded = foldAlias(character).replace(/ς/g, 'σ');
      if (!folded && size) ends[size - 1] = end;
      ensure(size + folded.length);
      if (folded) { parts.push(folded); for (let index = 0; index < folded.length; index++) { starts[size] = offset; ends[size] = end; size++; } }
      whitespace = false;
    }
    offset = end;
  }
  return { text: parts.join(''), starts, ends };
}

function isWordAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  const code = text.charCodeAt(index);
  const character = code >= 0xdc00 && code <= 0xdfff && index > 0 ? text.slice(index - 1, index + 1) : String.fromCodePoint(text.codePointAt(index)!);
  return WORD.test(character);
}

/**
 * Aho–Corasick: compile names once, scan each text once. Input is plain text;
 * callers retain responsibility for HTML/editor position mapping.
 */
export function createMentionIndex(entries: readonly MatchableEntry[]): MentionIndex {
  const grouped = new Map<string, { name: string; ids: Set<string> }>();
  for (const entry of entries) for (const name of entryNames(entry)) {
    const normalized = normalizeSource(name).text.trim();
    if (normalized.length < 2) continue;
    const pattern = grouped.get(normalized) ?? { name, ids: new Set<string>() };
    pattern.ids.add(entry.id); grouped.set(normalized, pattern);
  }
  const patterns = [...grouped].map(([normalized, value]) => ({ normalized, name: value.name, ids: [...value.ids] }));
  const nodes: Array<{ next: Map<string, number>; fail: number; output: number[] }> = [{ next: new Map(), fail: 0, output: [] }];
  patterns.forEach((pattern, id) => {
    let state = 0;
    // UTF-16 units deliberately match the offsets exposed by DOM/editor APIs.
    for (let index = 0; index < pattern.normalized.length; index++) {
      const character = pattern.normalized[index];
      let next = nodes[state].next.get(character);
      if (next === undefined) { next = nodes.length; nodes[state].next.set(character, next); nodes.push({ next: new Map(), fail: 0, output: [] }); }
      state = next;
    }
    nodes[state].output.push(id);
  });
  const queue = [...nodes[0].next.values()];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const state = queue[cursor];
    for (const [character, next] of nodes[state].next) {
      queue.push(next);
      let failure = nodes[state].fail;
      while (failure && !nodes[failure].next.has(character)) failure = nodes[failure].fail;
      nodes[next].fail = nodes[failure].next.get(character) ?? 0;
      nodes[next].output.push(...nodes[nodes[next].fail].output);
    }
  }
  return {
    patternCount: patterns.length,
    find(source) {
      if (!patterns.length || !source) return [];
      const normalized = normalizeSource(source), text = normalized.text;
      const hits: Array<{ start: number; end: number; patternId: number }> = [];
      let state = 0;
      for (let index = 0; index < text.length; index++) {
        const character = text[index];
        while (state && !nodes[state].next.has(character)) state = nodes[state].fail;
        state = nodes[state].next.get(character) ?? 0;
        for (const patternId of nodes[state].output) {
          const end = index + 1, start = end - patterns[patternId].normalized.length;
          if (!isWordAt(text, start - 1) && !isWordAt(text, end)) hits.push({ start, end, patternId });
        }
      }
      // Match the incumbent matcher's longest-name policy without quadratic
      // repeated regex scans or repeated interval-list searches.
      hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start || a.patternId - b.patternId);
      const occupied = new Uint8Array(text.length), found: IndexedMention[] = [];
      for (const hit of hits) {
        let overlap = false;
        for (let position = hit.start; position < hit.end; position++) if (occupied[position]) { overlap = true; break; }
        if (overlap) continue;
        occupied.fill(1, hit.start, hit.end);
        const pattern = patterns[hit.patternId];
        found.push({ from: normalized.starts[hit.start], to: normalized.ends[hit.end - 1], entryIds: [...pattern.ids], matchedAlias: pattern.name, ambiguous: pattern.ids.length > 1 });
      }
      return found.sort((a, b) => a.from - b.from || a.to - b.to);
    },
  };
}
