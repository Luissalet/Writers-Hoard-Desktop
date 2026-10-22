import type { CodexEntry, CodexEntryType } from '@/types';

/** Entry types offered when creating from a map, places first. */
export const PICKER_TYPES: CodexEntryType[] = ['location', 'character', 'faction', 'item', 'concept', 'magic', 'custom'];

/** Lower-case, accent-free text so "Ávila" is found by "avila". */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Entries whose title contains every word of the query, titles that start with it first. */
export function matchEntries(entries: CodexEntry[], query: string): CodexEntry[] {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  const hits = entries.filter(entry => { const title = searchKey(entry.title); return words.every(word => title.includes(word)); });
  const first = searchKey(query);
  return hits.sort((a, b) => Number(searchKey(b.title).startsWith(first)) - Number(searchKey(a.title).startsWith(first)) || a.title.localeCompare(b.title));
}
