// ============================================
// Board Engine — Semantic catalogs
// ============================================
//
// The old Yarn Board encoded relation meaning in the stroke colour and
// recovered it with an exact string comparison against five presets. Pick a
// custom colour and the meaning evaporated. Here the meaning is the `kind`
// field; colour is a consequence of it, and can still be overridden per edge
// without losing what the line *says*.

import type { BoardEdgeDirection, BoardNodeKind, BoardSize } from './types';

export interface EdgeKindDef {
  id: string;
  /** i18n key for the display label. */
  labelKey: string;
  color: string;
  defaultDirection: BoardEdgeDirection;
  /** Grouping in the picker. */
  group: 'drama' | 'causal' | 'structural';
  /** Whether the relation reads the same in both directions. */
  symmetric: boolean;
}

export const EDGE_KINDS: EdgeKindDef[] = [
  { id: 'conflict', labelKey: 'board.edgeKind.conflict', color: '#c4463a', defaultDirection: 'both', group: 'drama', symmetric: true },
  { id: 'alliance', labelKey: 'board.edgeKind.alliance', color: '#4a9e6d', defaultDirection: 'both', group: 'drama', symmetric: true },
  { id: 'romance', labelKey: 'board.edgeKind.romance', color: '#c47ba8', defaultDirection: 'both', group: 'drama', symmetric: true },
  { id: 'family', labelKey: 'board.edgeKind.family', color: '#d4a843', defaultDirection: 'none', group: 'drama', symmetric: true },
  { id: 'mystery', labelKey: 'board.edgeKind.mystery', color: '#7c5cbf', defaultDirection: 'forward', group: 'drama', symmetric: false },
  { id: 'betrayal', labelKey: 'board.edgeKind.betrayal', color: '#a8384f', defaultDirection: 'forward', group: 'drama', symmetric: false },
  { id: 'causes', labelKey: 'board.edgeKind.causes', color: '#e4a853', defaultDirection: 'forward', group: 'causal', symmetric: false },
  { id: 'blocks', labelKey: 'board.edgeKind.blocks', color: '#c4463a', defaultDirection: 'forward', group: 'causal', symmetric: false },
  { id: 'enables', labelKey: 'board.edgeKind.enables', color: '#4a9e6d', defaultDirection: 'forward', group: 'causal', symmetric: false },
  { id: 'precedes', labelKey: 'board.edgeKind.precedes', color: '#8a8690', defaultDirection: 'forward', group: 'causal', symmetric: false },
  { id: 'contains', labelKey: 'board.edgeKind.contains', color: '#4a7ec4', defaultDirection: 'forward', group: 'structural', symmetric: false },
  { id: 'mirrors', labelKey: 'board.edgeKind.mirrors', color: '#9b7ed8', defaultDirection: 'both', group: 'structural', symmetric: true },
  { id: 'foreshadows', labelKey: 'board.edgeKind.foreshadows', color: '#6fa8c4', defaultDirection: 'forward', group: 'structural', symmetric: false },
  { id: 'related', labelKey: 'board.edgeKind.related', color: '#8a8690', defaultDirection: 'none', group: 'structural', symmetric: true },
];

const EDGE_KIND_INDEX = new Map(EDGE_KINDS.map((kind) => [kind.id, kind]));

export function getEdgeKind(id: string): EdgeKindDef | undefined {
  return EDGE_KIND_INDEX.get(id);
}

export function edgeKindColor(id: string): string {
  return EDGE_KIND_INDEX.get(id)?.color ?? '#8a8690';
}

// ---------------------------------------------------------------------------
// Node roles
// ---------------------------------------------------------------------------

export interface NodeRoleDef {
  id: string;
  labelKey: string;
  color: string;
  /** Lucide icon name, resolved by the node view. */
  icon: string;
}

export const NODE_ROLES: NodeRoleDef[] = [
  { id: 'character', labelKey: 'board.role.character', color: '#c4973b', icon: 'User' },
  { id: 'event', labelKey: 'board.role.event', color: '#4a7ec4', icon: 'Zap' },
  { id: 'place', labelKey: 'board.role.place', color: '#4a9e6d', icon: 'MapPin' },
  { id: 'object', labelKey: 'board.role.object', color: '#b08968', icon: 'Package' },
  { id: 'faction', labelKey: 'board.role.faction', color: '#a8384f', icon: 'Users' },
  { id: 'concept', labelKey: 'board.role.concept', color: '#7c5cbf', icon: 'Lightbulb' },
  { id: 'clue', labelKey: 'board.role.clue', color: '#d4a843', icon: 'Search' },
  { id: 'question', labelKey: 'board.role.question', color: '#e4a853', icon: 'HelpCircle' },
  { id: 'theme', labelKey: 'board.role.theme', color: '#9b7ed8', icon: 'Sparkles' },
  { id: 'note', labelKey: 'board.role.note', color: '#8a8690', icon: 'StickyNote' },
];

const NODE_ROLE_INDEX = new Map(NODE_ROLES.map((role) => [role.id, role]));

export function getNodeRole(id: string | undefined): NodeRoleDef | undefined {
  return id ? NODE_ROLE_INDEX.get(id) : undefined;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default footprint per kind. These match what the legacy engines rendered at,
 * so migrated boards keep their proportions instead of reflowing on first open.
 */
export const DEFAULT_SIZE: Record<BoardNodeKind, BoardSize> = {
  card: { width: 220, height: 140 },
  postit: { width: 168, height: 132 },
  text: { width: 280, height: 120 },
  image: { width: 220, height: 200 },
  shape: { width: 140, height: 140 },
  frame: { width: 420, height: 320 },
  entity: { width: 224, height: 96 },
};

export const MIN_SIZE: Record<BoardNodeKind, BoardSize> = {
  card: { width: 140, height: 80 },
  postit: { width: 96, height: 80 },
  text: { width: 120, height: 48 },
  image: { width: 100, height: 80 },
  shape: { width: 60, height: 60 },
  frame: { width: 180, height: 140 },
  entity: { width: 160, height: 72 },
};

export const DEFAULT_NODE_COLOR: Record<BoardNodeKind, string> = {
  card: '#c4973b',
  postit: '#d4a843',
  text: '#e8e5e0',
  image: '#8a8690',
  shape: '#7c5cbf',
  frame: '#4a7ec4',
  entity: '#4a9e6d',
};

export const POSTIT_PALETTE = [
  '#f2d675', '#f0b8c8', '#a9c9ef', '#a9dfc0',
  '#cfc2f0', '#f5c99b', '#c9d8e8', '#efb9a5',
];

export const SURFACE_PALETTE = ['#c4463a', '#4a9e6d', '#4a7ec4', '#d4a843', '#7c5cbf', '#c4973b', '#8a8690'];

/** Grid step used by snapping and by the tidy-grid layout. */
export const GRID_STEP = 20;
