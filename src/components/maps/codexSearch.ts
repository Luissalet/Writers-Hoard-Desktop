import type { CodexEntry, CodexEntryType } from '@/types';
import { readAliases } from '@/services/codexReference/aliases';

/** Entry types offered when creating from a map, places first. */
export const PICKER_TYPES: CodexEntryType[] = ['location', 'character', 'faction', 'item', 'concept', 'magic', 'custom'];

/** Lower-case, accent-free text so "Ávila" is found by "avila". */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Every query word belongs to one name; title matches keep priority over aliases. */
export function matchEntries(entries: CodexEntry[], query: string): CodexEntry[] {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  const first = searchKey(query);
  const hits = entries.flatMap(entry => {
    const title = searchKey(entry.title), matches = (name: string) => words.every(word => name.includes(word));
    if (matches(title)) return [{ entry, rank: title.startsWith(first) ? 0 : 1 }];
    const aliases = readAliases(entry.fields).map(searchKey).filter(matches);
    return aliases.length ? [{ entry, rank: aliases.some(name => name.startsWith(first)) ? 2 : 3 }] : [];
  });
  return hits.sort((a, b) => a.rank - b.rank || a.entry.title.localeCompare(b.entry.title)).map(hit => hit.entry);
}
