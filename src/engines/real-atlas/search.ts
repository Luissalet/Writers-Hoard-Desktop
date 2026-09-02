import { foldForSearch } from '@/engines/worldgen/core/searchText';
import type { AtlasPlace } from './types';

/**
 * Places whose name or an alias contains `query`, accent- and case-insensitive
 * (the same fold as the list's filter and the bridge's search), in the list's
 * alphabetical order, at most `limit` of them. Blank query → nothing: a
 * dropdown of every place is not a search result.
 */
export function matchPlaces(places: readonly AtlasPlace[], query: string, limit: number): AtlasPlace[] {
  const q = foldForSearch(query.trim());
  if (!q) return [];
  const hits: AtlasPlace[] = [];
  for (const place of places) {
    if (foldForSearch(place.name).includes(q) || place.aliases.some((alias) => foldForSearch(alias).includes(q))) {
      hits.push(place);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
