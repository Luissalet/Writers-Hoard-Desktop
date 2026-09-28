// ============================================
// Writer's Hoard — Core Data Types
// ============================================
import type { CreativePossibility } from '@/components/project/creative-lab/types';
import type { EditorialProfile } from './editorial';
import type { WritingWorkflow } from './writingWorkflow';

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
  createdAt: number;
  updatedAt: number;
}

// Codex Entry (Wiki)
export type CodexEntryType = 'character' | 'location' | 'item' | 'faction' | 'concept' | 'magic' | 'custom';

export interface CodexEntry {
  id: string;
  projectId: string;
  type: CodexEntryType;
  title: string;
  avatar?: string; // base64 data URL (cropped for display)
  avatarOriginal?: string; // base64 — original uncropped source
  fields: Record<string, string>;
  content: string; // HTML from TipTap
  tags: string[];
  relations: Relation[];
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
  createdAt: number;
  updatedAt: number;
}

export type DateMode = 'text' | 'calendar';
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
  eventType: TimelineEventType; // 'point' = dot, 'range' = bar, 'milestone' = diamond
  order: number;
  lane: string;
  color: string;
  linkedEntryId?: string;
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
export interface WorldMap {
  id: string;
  projectId: string;
  title: string;
  backgroundImage?: string; // base64
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
