import type { CodexEntryType } from './index';
export interface WikiDocumentRef {kind:'entry'|'map';id:string}
export interface WikiSection {id:string;name:string;category?:CodexEntryType|'maps';documents:WikiDocumentRef[];view?:'full'|'cards'|'list';navigationHidden?:boolean;hideDocuments?:boolean}
export interface WikiHome {title?:string;intro?:string;banner?:string;featured?:WikiDocumentRef[];tiles?:Array<{document:WikiDocumentRef;size:'small'|'medium'|'large'}>}
export interface WorldWikiOptions {
  eraId?: string;
  locale?: 'es' | 'en'; types?: CodexEntryType[]; includeMaps?: boolean; includeImages?: boolean;
  excludedEntryIds?: string[]; excludedMapIds?: string[]; excludedFields?: string[];
  theme?: 'parchment' | 'paper' | 'night' | 'forest'; layout?: 'sidebar' | 'journal' | 'terminal' | 'shell';
  colors?: Partial<import('@/services/wikiProfiles/appearance').WikiColors>;
  headingFont?: import('@/services/wikiProfiles/appearance').WikiFont;
  bodyFont?: import('@/services/wikiProfiles/appearance').WikiFont;
  branding?: import('@/services/wikiProfiles/appearance').WikiBranding;
  font?: 'serif' | 'sans'; accent?: string; includeCover?: boolean;
  includeMedia?: boolean;
  grouping?:'type'|'manual';sections?:WikiSection[];home?:WikiHome;
  /** Timelines as articles (events kept out of the wiki never are); a saved view narrows them. */
  includeTimelines?: boolean;
  timelineViewId?: string;
}

