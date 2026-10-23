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
  /** Palettes saved by the author; they ride on the options so profiles, backups and clones carry them. The export itself never reads them. */
  customPalettes?: import('@/services/wikiProfiles/palettes').WikiCustomPalette[];
  /** Phosphor palette, CRT scanlines, dither, boot line and opening commands; only used by the terminal and shell layouts. */
  terminal?: import('@/services/wikiProfiles/terminal').WikiTerminalOptions;
  font?: 'serif' | 'sans'; accent?: string; includeCover?: boolean;
  includeMedia?: boolean;
  grouping?:'type'|'manual';sections?:WikiSection[];home?:WikiHome;
  /** Timelines as articles (events kept out of the wiki never are); a saved view narrows them. */
  includeTimelines?: boolean;
  timelineViewId?: string;
  /** Publish only the cards the author revealed to the players (and no maps). Absent or false: the rest of the policy decides, as before. */
  onlyRevealed?: boolean;
  /** Draw each picture map's fog of exploration (unexplored places hidden, the trail and party kept). Absent or false: maps are exported whole, as before. */
  exploredFog?: boolean;
  /** Exported maps: pan and zoom with pointer, wheel, keyboard and touch. 'free' lets the map leave the frame; 'contained' keeps it covering the frame. Absent: the map stays a static picture and the export is unchanged. */
  mapNavigation?: 'free' | 'contained';
  /** Draw each map's illustration layers (background, mid, front); they drift gently while the reader pans unless the reader prefers reduced motion. */
  mapArtwork?: boolean;
  /** Drifting cloud overlay on exported maps (CSS only; the reader can hide it). */
  mapClouds?: boolean;
  /** Ambience audio for maps and pins; plays only after the reader presses the map's sound button. */
  mapAmbience?: boolean;
}

