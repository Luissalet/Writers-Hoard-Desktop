// ============================================
// Writer's Hoard — Core Data Types
// ============================================

// Project Mode (determines which engines are visible by default)
export type ProjectMode = 'novelist' | 'biographer' | 'reporter' | 'playwright' | 'content-creator' | 'custom';

// Project (Bubble)
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

// Yarn Board
export interface YarnBoard {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type YarnNodeType =
  | 'character' | 'event' | 'concept' | 'note'         // semantic (original)
  | 'postit' | 'image' | 'text' | 'group' | 'shape';   // generic canvas primitives

export interface YarnNode {
  id: string;
  projectId: string;
  boardId: string;
  type: YarnNodeType;
  title: string;
  content: string;
  image?: string;                          // base64 — cropped for display
  imageOriginal?: string;                  // base64 — original uncropped source
  color: string;
  position: { x: number; y: number };
  width?: number;                          // resizable nodes (group, image, text)
  height?: number;
  linkedEntryId?: string;                  // codex cross-ref
  // Group node: child node IDs positioned inside this group
  childNodeIds?: string[];
  // Shape node specifics
  shape?: 'rectangle' | 'circle' | 'diamond' | 'pill';
  // Text node: rich HTML content (TipTap)
  richContent?: string;
  // Post-it: just uses title + color (compact sticky)
  // Image node: uses image + optional title caption
  zIndex?: number;                         // layering order
}

export type YarnEdgeDirection = 'none' | 'forward' | 'backward' | 'both';

export interface YarnEdge {
  id: string;
  boardId: string;
  sourceId: string;
  targetId: string;
  color: string;
  style: 'solid' | 'dashed' | 'dotted';
  label?: string;
  direction?: YarnEdgeDirection;           // arrow direction (default: 'none' = no arrows)
  curvature?: 'straight' | 'curved' | 'step'; // path type
}

// Maps
export interface WorldMap {
  id: string;
  projectId: string;
  title: string;
  backgroundImage?: string; // base64
  createdAt: number;
  updatedAt: number;
}

export interface MapPin {
  id: string;
  projectId: string;
  mapId: string;
  name: string;
  icon: 'city' | 'mountain' | 'forest' | 'castle' | 'port' | 'ruins' | 'temple' | 'village' | 'cave' | 'custom';
  position: { x: number; y: number };
  linkedEntryId?: string;
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
}

// Writings
export type WritingStatus = 'idea' | 'draft' | 'finished';

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

// External Links
export type ExternalLinkType = 'google-doc' | 'word-file' | 'youtube' | 'instagram' | 'pinterest' | 'spotify' | 'other';

export interface ExternalLink {
  id: string;
  projectId: string;
  type: ExternalLinkType;
  url: string;
  title: string;
  thumbnail?: string;
  notes: string;
  tags: string[];
  category?: string;
  createdAt: number;
  updatedAt: number;
}

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
