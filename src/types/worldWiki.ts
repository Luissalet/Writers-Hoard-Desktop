import type { CodexEntryType } from './index';
export interface WorldWikiOptions {
  locale?: 'es' | 'en'; types?: CodexEntryType[]; includeMaps?: boolean; includeImages?: boolean;
  excludedEntryIds?: string[]; excludedMapIds?: string[]; excludedFields?: string[];
  theme?: 'parchment' | 'paper' | 'night' | 'forest'; layout?: 'sidebar' | 'journal';
  font?: 'serif' | 'sans'; accent?: string; includeCover?: boolean;
  includeMedia?: boolean;
}

