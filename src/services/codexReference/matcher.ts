// ============================================================================
// Codex reference matcher — which codex entries a chapter mentions
// ============================================================================
//
// Pure functions, no DOM, no Dexie: the Writings side panel, the AI bridge and
// the node logic test all run this same code. Matching is by title and aliases,
// case- and accent-insensitive, on whole words, longest name first so "Ana
// Ruiz" is not also counted as a mention of "Ana". No model is involved, and a
// match only says the NAME occurs in the text: it is not presence, point of
// view or any claim about the scene.

export interface MatchableEntry {
  id: string;
  title: string;
  fields?: Record<string, string>;
}

export interface ReferenceMatch {
  entryId: string;
  /** The name or alias that matched most often, as the entry spells it. */
  matchedAlias: string;
  /** How many times any of the entry's names occurs. */
  count: number;
}

const ALIAS_KEY_RE = /^(alias|aliases|aka|apodo|apodos|sobrenombre|sobrenombres|nickname|nicknames|otros nombres|also known as|other names)$/i;
const MIN_NAME_LENGTH = 2;

/** Lowercase, accents stripped, so "Álvaro" and "alvaro" compare equal. */
export function normalizeForMatch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The entry's title plus any aliases kept in its fields, without repeats. */
export function entryNames(entry: MatchableEntry): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const name = raw.trim();
    const key = normalizeForMatch(name);
    if (name.length < MIN_NAME_LENGTH || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  add(entry.title ?? '');
  for (const [key, value] of Object.entries(entry.fields ?? {})) {
    if (!ALIAS_KEY_RE.test(key.trim()) || typeof value !== 'string') continue;
    for (const part of value.split(/[,;|\n]/)) add(part);
  }
  return names;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Candidate {
  entryId: string;
  name: string;
  normalized: string;
}

/**
 * Find the entries whose names occur in `text`. Longer names claim their span
 * first; a shorter name inside a claimed span is not counted. Results are
 * sorted by count (desc), then by the order of the input.
 */
export function findMentions(text: string, entries: readonly MatchableEntry[]): ReferenceMatch[] {
  const haystack = normalizeForMatch(text);
  if (!haystack.trim() || entries.length === 0) return [];

  const candidates: Candidate[] = [];
  for (const entry of entries) {
    for (const name of entryNames(entry)) {
      const normalized = normalizeForMatch(name).replace(/\s+/g, ' ');
      if (normalized.length >= MIN_NAME_LENGTH) candidates.push({ entryId: entry.id, name, normalized });
    }
  }
  candidates.sort((a, b) => b.normalized.length - a.normalized.length);

  const claimed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) => claimed.some(([s, e]) => start < e && end > s);

  const perEntry = new Map<string, { count: number; byName: Map<string, number> }>();
  for (const candidate of candidates) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(candidate.normalized).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}_])`,
      'gu',
    );
    for (const hit of haystack.matchAll(pattern)) {
      const start = hit.index ?? 0;
      const end = start + hit[0].length;
      if (overlaps(start, end)) continue;
      claimed.push([start, end]);
      const slot = perEntry.get(candidate.entryId) ?? { count: 0, byName: new Map<string, number>() };
      slot.count += 1;
      slot.byName.set(candidate.name, (slot.byName.get(candidate.name) ?? 0) + 1);
      perEntry.set(candidate.entryId, slot);
    }
  }

  const order = new Map(entries.map((entry, index) => [entry.id, index]));
  return [...perEntry.entries()]
    .map(([entryId, slot]) => ({
      entryId,
      count: slot.count,
      matchedAlias: [...slot.byName.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.count - a.count || (order.get(a.entryId) ?? 0) - (order.get(b.entryId) ?? 0));
}

/** Entries matching a free-text query on name, alias, tags, fields or body. */
export function searchEntries<T extends MatchableEntry & { tags?: string[]; content?: string }>(
  query: string,
  entries: readonly T[],
  limit = 30,
): T[] {
  const needle = normalizeForMatch(query).trim();
  if (!needle) return [];
  const scored: Array<{ entry: T; score: number }> = [];
  for (const entry of entries) {
    const names = entryNames(entry).map(normalizeForMatch);
    let score = 0;
    if (names.some((name) => name === needle)) score = 100;
    else if (names.some((name) => name.startsWith(needle))) score = 80;
    else if (names.some((name) => name.includes(needle))) score = 60;
    else if ((entry.tags ?? []).some((tag) => normalizeForMatch(tag).includes(needle))) score = 40;
    else if (Object.values(entry.fields ?? {}).some((v) => typeof v === 'string' && normalizeForMatch(v).includes(needle))) score = 25;
    else if (entry.content && normalizeForMatch(entry.content.replace(/<[^>]*>/g, ' ')).includes(needle)) score = 10;
    if (score > 0) scored.push({ entry, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.entry);
}

/** Plain text of a body, one paragraph per element. */
export function bodyParagraphs(html: string | undefined): string[] {
  return (html ?? '')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, '\u0001')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .split('\u0001')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** A short plain-text summary: the first lines of the body, else the first field. */
export function entrySummary(entry: { fields?: Record<string, string>; content?: string }, max = 160): string {
  const body = bodyParagraphs(entry.content).join(' ');
  const firstField = Object.entries(entry.fields ?? {}).find(
    ([key, value]) => !ALIAS_KEY_RE.test(key.trim()) && typeof value === 'string' && value.trim(),
  );
  const text = body || (firstField ? firstField[1].trim() : '');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
