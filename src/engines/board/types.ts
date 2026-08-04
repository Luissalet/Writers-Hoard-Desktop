// ============================================
// Board Engine — Type Definitions
// ============================================
//
// This engine is the fusion of the former `yarn-board` and `brainstorm`
// engines. Both were the same thing wearing different clothes: an infinite
// canvas holding cards, images and text, wired together with lines. Neither
// modelled the wiring as an actual graph — the meaning of a connection was
// encoded in its colour, groups were decorative rectangles, and half the
// declared fields (width, zIndex, childNodeIds, richContent, linkedEntryId)
// were never read by anything.
//
// The unified model treats the board as a real property graph:
//
//   • Nodes carry a *kind* (how they draw) and a *role* (what they mean).
//   • Edges carry a *kind* from a semantic catalog — not a colour we
//     reverse-engineer — plus weight and certainty.
//   • An edge may have many sources and many targets (hyper-edge), and an
//     endpoint may be another edge (edge-to-edge), so "A and B together
//     cause C" and "this rivalry is *because of* that betrayal" are both
//     first-class statements instead of hand-drawn approximations.
//   • Layers slice the same graph into overlays that can be hidden or locked.
//   • Views save a query + layer set + layout as a reusable lens.

/** Persisted camera position so a board reopens exactly where it was left. */
export interface BoardViewport {
  x: number;
  y: number;
  zoom: number;
}

export type BoardSurface = 'cork' | 'slate' | 'grid' | 'blueprint';

export interface Board {
  id: string;
  projectId: string;
  title: string;
  /** Canvas backdrop. Defaults to 'cork' (the detective-board look). */
  surface: BoardSurface;
  viewport?: BoardViewport;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * A layer is an overlay over the same board: "Act I", "Suspects",
 * "What the reader knows". Nodes and edges belong to at most one; hiding a
 * layer hides its elements without deleting anything.
 */
export interface BoardLayer {
  id: string;
  projectId: string;
  boardId: string;
  name: string;
  color: string;
  visible: boolean;
  /** Locked layers cannot be dragged, edited or deleted from the canvas. */
  locked: boolean;
  /** 0..1 — dimming for context layers you want visible but quiet. */
  opacity: number;
  order: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * How a node draws. Deliberately small: meaning lives in `role`, not here.
 *   card   — titled card with optional image and body (the yarn "semantic" node)
 *   postit — compact sticky note, colour-first
 *   text   — free rich text on the canvas, no chrome
 *   image  — picture with optional caption
 *   shape  — geometric primitive used as annotation
 *   frame  — a real region that carries the nodes inside it when moved
 *   entity — a live reference to a record owned by another engine
 */
export type BoardNodeKind =
  | 'card'
  | 'postit'
  | 'text'
  | 'image'
  | 'shape'
  | 'frame'
  | 'entity';

export type BoardShape = 'rectangle' | 'circle' | 'diamond' | 'pill' | 'hexagon';

/**
 * A live pointer at a record owned by another engine (a codex entry, a scene,
 * a seed, a map…). The preview fields are a cache so the board renders
 * instantly offline; `missing` is set when a revalidation pass can no longer
 * find the target, which is how a deleted character shows up as a broken
 * pin instead of silently lying forever.
 */
export interface BoardEntityRef {
  engineId: string;
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string;
  thumbnail?: string;
  color?: string;
  missing?: boolean;
  checkedAt?: number;
}

export interface BoardSize {
  width: number;
  height: number;
}

export interface BoardNode {
  id: string;
  projectId: string;
  boardId: string;
  kind: BoardNodeKind;
  /**
   * Semantic role — 'character', 'event', 'place', 'clue', 'question'…
   * Free-form on purpose: the catalog seeds the useful ones, users may type
   * their own, and queries match on the string.
   */
  role?: string;
  title: string;
  /** Plain-text body. Always kept in sync as the searchable projection. */
  content: string;
  /** Rich HTML body (TipTap) for `text` and `card` nodes. */
  richContent?: string;
  image?: string;
  imageOriginal?: string;
  color: string;
  position: { x: number; y: number };
  size: BoardSize;
  shape?: BoardShape;
  layerId?: string;
  zIndex: number;
  locked?: boolean;
  /** Frames only: hide the nodes contained in this frame. */
  collapsed?: boolean;
  /** Excluded from auto-layout — the node stays where the author put it. */
  pinned?: boolean;
  tags: string[];
  /** Arbitrary attributes, queryable with `prop:key=value` and `key>3`. */
  props?: Record<string, string | number | boolean>;
  ref?: BoardEntityRef;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/** Which face of a card a thread leaves from or arrives at. */
export type BoardSide = 'top' | 'right' | 'bottom' | 'left';

/** What an edge endpoint attaches to. `on: 'edge'` is the edge-to-edge case. */
export interface BoardEndpoint {
  id: string;
  on: 'node' | 'edge';
  /**
   * The connector the author actually used. Without it the line is routed
   * centre-to-centre and lands wherever the geometry says, which is not what
   * you asked for when you dropped the thread on the left side of a card.
   * Absent for endpoints picked with the link tool, which selects whole nodes.
   */
  side?: BoardSide;
}

export type BoardEdgeStyle = 'solid' | 'dashed' | 'dotted';
export type BoardEdgeDirection = 'none' | 'forward' | 'backward' | 'both';
export type BoardEdgeCurvature = 'straight' | 'curved' | 'step' | 'arc';

export interface BoardEdge {
  id: string;
  projectId: string;
  boardId: string;
  /**
   * Denormalised first endpoints. They exist so Dexie can index them and so
   * integrity checks stay cheap; `sources`/`targets` are the truth.
   */
  sourceId: string;
  targetId: string;
  sources: BoardEndpoint[];
  targets: BoardEndpoint[];
  /** Semantic relation id from the catalog, or a user-defined string. */
  kind: string;
  label?: string;
  color: string;
  style: BoardEdgeStyle;
  /** Stroke width in flow units. 0 means "derive it from weight". */
  width: number;
  direction: BoardEdgeDirection;
  curvature: BoardEdgeCurvature;
  /** Relation strength. Drives auto width, layout pull and metric weighting. */
  weight: number;
  /** 0..1 — how sure the author is. Below 1 the line is drawn translucent. */
  certainty: number;
  layerId?: string;
  tags: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Saved views (lenses)
// ---------------------------------------------------------------------------

/**
 * A view is a saved way of looking at the board: a query, the layers that
 * were on, and optionally a frozen set of positions (so an auto-layout can be
 * kept as a view without destroying the hand-placed arrangement).
 */
export interface BoardView {
  id: string;
  projectId: string;
  boardId: string;
  name: string;
  query: string;
  layerIds: string[];
  /** 'filter' hides non-matches; 'highlight' dims them. */
  mode: 'filter' | 'highlight';
  viewport?: BoardViewport;
  positions?: Record<string, { x: number; y: number }>;
  order: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Canvas-side helper shapes (not persisted)
// ---------------------------------------------------------------------------

/** Axis-aligned box in flow coordinates. */
export interface BoardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardPoint {
  x: number;
  y: number;
}
