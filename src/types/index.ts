// ============================================
// Writer's Hoard — Core Data Types
// ============================================
import type { CreativePossibility } from '@/components/project/creative-lab/types';
import type { EditorialProfile } from './editorial';
import type { WritingWorkflow } from './writingWorkflow';
import type { WorldCalendar, WorldDate } from '@/engines/timeline/worldCalendar';

// Project Mode (determines which engines are visible by default)
export type ProjectMode = 'essentials' | 'novelist' | 'realist' | 'biographer' | 'reporter' | 'playwright' | 'content-creator' | 'custom';

// Project (Bubble)
/** How footnote references are marked in the prose: 1 2 3, * † ‡, i ii iii, a b c. */
export type FootnoteMarkerStyle = 'numbers' | 'symbols' | 'roman' | 'letters';
/**
 * Where the exports print the notes: after each chapter (the page's foot in
 * page mode, a "Notes" section per chapter elsewhere), numbered from 1 in
 * every chapter — or once, at the end of the book, grouped by chapter and
 * numbered continuously so a note "47" can be found.
 */
export type FootnotePlacement = 'chapter' | 'book';

export interface Project {
  id: string;
  title: string;
  mode: ProjectMode;                    // Writer type / engine preset
  type: 'saga' | 'standalone' | 'collection' | 'idea';
  color: string;
  icon?: string; // Lucide icon name (e.g. 'BookOpen', 'Feather')
  coverImage?: string; // base64 data URL
  description: string;
  parentId?: string; // For books within a saga
  children?: string[]; // IDs of sub-projects
  status: 'draft' | 'in-progress' | 'completed';
  enabledEngines: string[];             // Active engine IDs for this project
  engineOrder: string[];                // Tab ordering (user-customizable)
  /** Footnote marker style for the whole manuscript; absent means numbers. */
  footnoteStyle?: FootnoteMarkerStyle;
  /** Footnotes per chapter or endnotes at the end of the book; absent means per chapter. */
  footnotePlacement?: FootnotePlacement;
  /** Unpromoted ideas, alternatives and their provenance belong to the project archive. */
  creativePossibilities?: CreativePossibility[];
  editorialProfile?: EditorialProfile;
  writingWorkflows?: WritingWorkflow[];
  /**
   * The story world's own calendar (months, week, eras, moons, holidays,
   * leap rule). Books of a saga without one use their saga's.
   */
  worldCalendar?: WorldCalendar;
  /** Local language dictionaries; included in the project's portable backup. */
  dictionaries?: import('@/engines/dictionary/types').WorldDictionary[];
  /** Self-contained local GLB references, portable with the project backup. */
  modelAssets?: Array<{ id: string; name: string; dataUrl: string; size: number; createdAt: number }>;
  /** Independent authored relation trees and variants; canonical genealogy remains separate. */
  relationTrees?: import('@/engines/genealogy/relationTrees').RelationTreeDocument[];
  /** Offline RPG sheets with local checks and portable roll history. */
  characterSheets?: import('@/engines/character-sheets/types').CharacterSheet[];
  /** Independent local charts; no renderer or database code in this type leaf. */
  radarCharts?: import('@/engines/radar/types').RadarChartDocument[];
  codexTemplates?: import('@/engines/codex/templateTypes').CodexTemplate[];
  /** Typed records and formula sheets, kept with portable project metadata. */
  dataTables?: import('@/engines/tables/types').WorldTable[];
  wikiOptions?: import('./worldWiki').WorldWikiOptions;
  readerPresentation?: import('@/engines/writings/readerPresentationTypes').ReaderPresentation;
  /** Manual positions in the derived local Codex graph; card content remains canonical. */
  codexGraphLayout?: import('@/engines/codex/worldGraph/types').CodexGraphLayout;
  /** Mixed document library: organizational references; source records stay canonical. */
  workspaceFolders?: import('@/components/project/workspace/library/types').WorkspaceFolder[];
  workspacePlacements?: import('@/components/project/workspace/library/types').WorkspacePlacement[];
  workspaceRevision?: number;
  /** Trusted source-extension JSON, scoped by developer namespace; no executable content. */
  localToolStates?: import('@/engines/local/stateTypes').LocalToolStates;
  createdAt: number;
  updatedAt: number;
}

/**
 * Receipt left on a record that came from another family app (a story world
 * from Scheherazade's Hoard). Local edits never change it: comparing
 * `localHash` with the record as it is now is how a re-import knows the writer
 * has edited it since, and leaves it alone.
 */
export interface FamilySource {
  app: 'scheherazade';
  /** The record's ref at the source, e.g. `hoard://scheherazade/entity/e_1`. */
  ref: string;
  /** Other refs the source listed for the same record (its `same_as`). */
  sameAs?: string[];
  /** The source's `revision` of the record when it was last imported. */
  revision: string;
  /** Hash of what this record exchanges, right after that import. */
  localHash: string;
  /** The world it came from: `hoard://scheherazade/world/<id>`. */
  worldRef: string;
  importedAt: number;
}

// Codex Entry (Wiki)
export type CodexEntryType = 'character' | 'location' | 'item' | 'faction' | 'concept' | 'magic' | 'custom';

export interface CodexEntry {
  id: string;
  projectId: string;
  type: CodexEntryType;
  /** A reusable author-defined type/template within the broad category. */
  templateId?: string;
  /** Named properties that refer to other Codex entries by stable id. */
  referenceFields?: Record<string, string[]>;
  title: string;
  avatar?: string; // base64 data URL (cropped for display)
  avatarOriginal?: string; // base64 — original uncropped source
  fields: Record<string, string>;
  content: string; // HTML from TipTap
  tags: string[];
  relations: Relation[];
  /**
   * Only meaningful on `character` entries. A person is private unless the
   * author says otherwise: enrichment never runs on a private person, the
   * investigation report marks them, and their names never leave the app in a
   * library query. Missing means false.
   */
  publicFigure?: boolean;
  /** Wikidata item this entry was matched to by an enrichment run, e.g. "Q42". */
  wikidataQid?: string;
  /** Present when this entry was imported from a story world (wh_world_from_scheherazade). */
  familySource?: FamilySource;
  createdAt: number;
  updatedAt: number;
}

// Relation between entities
export interface Relation {
  targetId: string;
  targetTitle: string;
  type: string; // 'ally', 'enemy', 'family', 'located_in', etc.
  description?: string;
}

// Timeline
export interface Timeline {
  id: string;
  projectId: string;
  title: string;
  color: string;             // Lane color in swim-lane view
  description?: string;      // Phase / era description
  /** Absent timelines retain the project's or saga's calendar. */
  worldCalendar?: import('@/engines/timeline/worldCalendar').WorldCalendar;
  /** Visible absolute years, inclusive; events outside remain stored. */
  yearRange?: { start: number; end: number };
  displayPrecision?: 'year' | 'day' | 'hour';
  /** Present on the timeline an imported story world's events were filed in. */
  familySource?: FamilySource;
  createdAt: number;
  updatedAt: number;
}

/** 'text' free-form, 'calendar' real ISO dates, 'world' the project's own calendar. */
export type DateMode = 'text' | 'calendar' | 'world';
export type TimelineEventType = 'point' | 'range' | 'milestone';

export interface TimelineEvent {
  id: string;
  projectId: string;
  timelineId: string;
  title: string;
  description: string;
  date: string; // Fictional date as free text, or display string for calendar dates
  dateMode: DateMode; // 'text' for free-form, 'calendar' for real dates
  realDate?: string; // ISO date string (YYYY-MM-DD) when dateMode === 'calendar'
  realDateEnd?: string; // Optional end date for date ranges
  /** Date in the project's world calendar when dateMode === 'world' (may be partial). */
  worldDate?: WorldDate;
  /** Optional end of a world-calendar range. */
  worldDateEnd?: WorldDate;
  eventType: TimelineEventType; // 'point' = dot, 'range' = bar, 'milestone' = diamond
  order: number;
  lane: string;
  color: string;
  linkedEntryId?: string;
  /** All linked Codex cards. linkedEntryId remains the primary legacy link. */
  linkedEntryIds?: string[];
  /** Embedded local raster image and a named icon from the timeline palette. */
  image?: string;
  icon?: 'calendar' | 'flag' | 'star' | 'swords' | 'crown' | 'heart' | 'book' | 'sun' | 'moon' | 'ship' | 'mountain';
  /** Local clock HH:mm, independent of timezone; world hours may exceed 23. */
  time?: string;
  endTime?: string;
  /** Present when this event was imported from a story world. */
  familySource?: FamilySource;
  createdAt: number;
  updatedAt: number;
}

// Timeline Connection — links between events (time travel jumps, causal links, etc.)
export type TimelineConnectionStyle = 'solid' | 'dashed' | 'dotted';

export interface TimelineConnection {
  id: string;
  projectId: string;
  timelineId: string;         // Parent timeline (for scoping; connections can cross timelines)
  sourceEventId: string;
  targetEventId: string;
  label?: string;             // e.g. "DeLorean trip", "Time portal"
  color: string;
  style: TimelineConnectionStyle;
  createdAt: number;
}

// Maps
export interface MapPoint { x: number; y: number }

/** Coordinates are percentages of the source image, independent of zoom. */
export interface MapFeature {
  id: string;
  kind: 'region' | 'path' | 'label';
  name: string;
  description?: string;
  points: MapPoint[];
  color: string;
  opacity?: number;
  linkedEntryId?: string;
  layerId?: string;
}

export interface MapNamedLayer { id: string; name: string; visible: boolean }

/** Named historical states remain separate from the editable current map. */
export interface MapVersion {
  id: string;
  name: string;
  date: string;
  description?: string;
  createdAt: number;
  backgroundImage?: string;
  features: MapFeature[];
  pins: MapPin[];
  layers?: MapNamedLayer[];
  layerVisibility?: MapLayerVisibility;
  source?: 'uploaded' | 'gallery' | 'worldgen';
  sourceWorldId?: string;
  sourceRevision?: number;
}

export interface MapLayerVisibility {
  pins: boolean;
  region: boolean;
  path: boolean;
  label: boolean;
}

export interface WorldMap {
  id: string;
  projectId: string;
  title: string;
  backgroundImage?: string; // base64
  /** Local vector annotations travel with the map in archives and backups. */
  features?: MapFeature[];
  layerVisibility?: MapLayerVisibility;
  layers?: MapNamedLayer[];
  versions?: MapVersion[];
  /** Uploaded/Gallery maps remain standalone; Worldgen maps retain provenance. */
  source?: 'uploaded' | 'gallery' | 'worldgen';
  sourceWorldId?: string;
  sourceRevision?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MapPin {
  id: string;
  projectId: string;
  mapId: string;
  name: string;
  icon: 'city' | 'mountain' | 'forest' | 'castle' | 'port' | 'ruins' | 'temple' | 'village' | 'cave' | 'custom';
  color?: string;
  position: { x: number; y: number };
  linkedEntryId?: string;
  layerId?: string;
  /** Present when this pin mirrors a Worldgen waypoint. */
  sourceWaypointId?: string;
  description?: string;
}

// Gallery
export interface ImageCollection {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
}

export interface InspirationImage {
  id: string;
  projectId: string;
  collectionId?: string;
  imageData: string; // base64 (cropped for display)
  imageDataOriginal?: string; // base64 — original uncropped source
  thumbnailData?: string; // compressed base64
  tags: string[];
  notes: string;
  linkedEntryId?: string; // deprecated, use linkedEntryIds
  linkedEntryIds?: string[]; // IDs of codex entries linked to this image
  createdAt: number;
  /** Absent means uploaded by hand; 'generated' rows come from the image studio. */
  source?: 'uploaded' | 'generated';
  /** Provenance of a generated image: enough to regenerate or credit it. */
  generation?: ImageGenerationInfo;
}

/**
 * Everything needed to make this picture again.
 *
 * The rule for this record: if a field changes the image and is not here, then
 * "Iterate" and "Compare recipes" are guessing, and a guess presented as
 * provenance is worse than a blank. Every field added after the first version
 * is optional, so rows written before it still read.
 */
export interface ImageGenerationInfo {
  prompt: string;
  negativePrompt?: string;
  connectionId: string;
  modelId: string;
  seed?: number;
  width: number;
  height: number;
  quality?: string;
  steps?: number;
  createdAt: number;
  /** Text guidance (`cfg_scale`). Without it the same seed gives another picture. */
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  /**
   * The LoRAs as a list. They used to ride inside the prompt as a
   * `<lora:name:weight>` string, which no query could read and no second run
   * could reproduce exactly.
   */
  loras?: { name: string; weight: number; fileName?: string }[];
  /** SHA-256 of the weights file, so a renamed or re-quantised model is caught. */
  modelSha256?: string;
  /** Which runtime made it — `local-sd`, `openai`, an Automatic1111, … */
  backend?: string;
  /** Version string of that runtime, when it has one (the sd.cpp release tag). */
  runtimeVersion?: string;
  /** Gallery ids of the images that conditioned this one, in the order sent. */
  refImageIds?: string[];
  /** Gallery id of the img2img seed image, and how far the model was let move. */
  initImageId?: string;
  strength?: number;
  /** Gallery id of the inpainting mask. */
  maskImageId?: string;
  /** Gallery id of the ControlNet hint, the ControlNet used, and its weight. */
  controlImageId?: string;
  controlNetModel?: string;
  controlStrength?: number;
  /** The second pass, when there was one. */
  hiresUpscaler?: string;
  hiresScale?: number;
  /**
   * The A1111 `parameters` line the runtime embedded in the PNG, verbatim.
   * The fields above are the queryable form; this is the escape hatch for
   * everything a future runtime records that this shape has no room for.
   */
  parameters?: string;
  /**
   * Row id in `imageRecipes`, and the hash of the settings it holds.
   *
   * The fields above stay because they are what a list view queries and what a
   * row written before recipes existed still has; the recipe is the complete
   * account, including the resolved prompt, the asset digests and the pass
   * chain. The hash is duplicated here so "every image made from this recipe"
   * is one index lookup rather than a join.
   */
  recipeId?: string;
  recipeHash?: string;
}

// Writings
export type WritingStatus = 'idea' | 'draft' | 'finished';

export interface StorySessionSource {
  app: 'scheherazade';
  worldId: string;
  sessionId: string;
  sourceRef?: string;
  sourceRevision?: string;
  sourceHash: string;
  importedContentHash: string;
  importedAt: number;
}

export interface Writing {
  id: string;
  projectId: string;
  title: string;
  status: WritingStatus;
  content: string; // HTML from TipTap
  synopsis?: string;
  wordCount: number;
  chapter?: number;
  tags: string[];
  /** When the chapter happens in the project's world calendar (absent = undated). */
  worldDate?: WorldDate;
  /** Optional end of a world-calendar span. */
  worldDateEnd?: WorldDate;
  createdAt: number;
  updatedAt: number;
  /** Origin receipt for an imported session. Local edits never change this receipt. */
  storySessionSource?: StorySessionSource;
  // Google Docs integration
  googleDocId?: string;
  googleDocUrl?: string;
  googleDocName?: string;
  lastSyncedAt?: number;
  syncDirection?: 'pull' | 'push' | 'manual';
  isGoogleDoc?: boolean;
}

// AI Types
export interface AiConfig {
  baseUrl: string;
  model: string;
  enabled: boolean;
  /** 'proxy' = CLIProxyAPI (Claude, Max quota); 'local' = embedded Ollama. */
  provider: 'proxy' | 'local';
  /** Ollama tag used when provider === 'local', e.g. 'qwen3.5:9b'. */
  localModel: string;
}

export interface ExtractedCharacter {
  nombre: string;
  descripcionFisica: string;
  personalidad: string;
  relaciones: string;
  citasRelevantes: string[];
  rol: 'protagonista' | 'secundario' | 'mencionado';
}

export interface ConsistencyIssue {
  tipo: 'descripcion' | 'continuidad' | 'nombre' | 'temporal' | 'ubicacion';
  descripcion: string;
  capitulos: string[];
  gravedad: 'alta' | 'media' | 'baja';
}

// App Settings (persisted in Dexie)
export interface AppSettings {
  id: string;
  key: string;
  value: string;
}

// External Links — retired in DB v21. The Links engine duplicated Scrapper
// (url + title + notes + tags, no archive), so every row was migrated into a
// link-only snapshot. The legacy row shape now lives beside its converter in
// `engines/scrapper/legacyLinks.ts`, which is the only code that still needs it.

// Tag
export interface Tag {
  id: string;
  name: string;
  color?: string;
}

// Templates for Codex entries
export const CHARACTER_FIELDS = {
  name: '',
  age: '',
  species: '',
  role: '',
  physicalDescription: '',
  personality: '',
  backstory: '',
  abilities: '',
  goals: '',
  flaws: '',
} as const;

export const LOCATION_FIELDS = {
  name: '',
  region: '',
  climate: '',
  population: '',
  history: '',
  notableFeatures: '',
  inhabitants: '',
} as const;

export const ITEM_FIELDS = {
  name: '',
  type: '',
  origin: '',
  properties: '',
  history: '',
  currentOwner: '',
} as const;

export const FACTION_FIELDS = {
  name: '',
  type: '',
  leader: '',
  goals: '',
  territory: '',
  allies: '',
  enemies: '',
  history: '',
} as const;

export function getTemplateFields(type: CodexEntryType): Record<string, string> {
  switch (type) {
    case 'character': return { ...CHARACTER_FIELDS };
    case 'location': return { ...LOCATION_FIELDS };
    case 'item': return { ...ITEM_FIELDS };
    case 'faction': return { ...FACTION_FIELDS };
    default: return { name: '' };
  }
}
