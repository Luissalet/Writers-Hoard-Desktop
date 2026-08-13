// ============================================
// World Generator Engine — DB Record Types
// ============================================
// Worlds are stored as seed + parameters ONLY (plus a small thumbnail): the
// pipeline is deterministic, so the terrain is regenerated on demand and
// cached in memory. This keeps Dexie light and makes backups tiny.

import type { WorldParams } from './core/types';
import type { RegionParams } from './region/types';

/**
 * A bookmarked regional view.
 *
 * The expensive regional arrays remain deterministic derived data.  Saving a
 * region stores only enough information to reproduce the same sheet and the
 * reader-facing title, keeping worlds and backups small.
 */
export interface SavedWorldRegion {
  id: string;
  title: string;
  /** Centre in world-cell coordinates. */
  x: number;
  y: number;
  spanKm: number;
  params: RegionParams;
  createdAt: number;
  updatedAt: number;
}

/** View shared by the 2D, 3D, and regional renderers. */
export interface WorldViewport {
  /** Normalized longitude, wrapping in [0, 1). */
  u: number;
  /** Normalized latitude position, clamped to [0, 1]. */
  v: number;
  /** Approximate horizontal ground span in kilometres. */
  spanKm: number;
  /** Optional camera bearing used by the 3D view. */
  bearing?: number;
}

export interface GeneratedWorld {
  id: string;
  projectId: string;
  title: string;
  params: WorldParams;
  /**
   * The brush strokes, serialised.
   *
   * This is the other half of the world and it was not being saved: a coastline
   * painted by hand, a river drawn by hand, a town placed by hand and every
   * renamed sea existed only until the application was closed. Seed and
   * parameters describe what the generator made; this describes what the reader
   * made of it, and a world is both.
   *
   * Stored as the JSON `PaintSession.serialize()` produces — an ordered list,
   * replayed from the pristine world on load. A few hundred bytes for a normal
   * session, and it travels in the backup with the rest of the row.
   */
  edits?: string;
  /** Named/bookmarked regional views. Generated pixels are never persisted. */
  regions?: SavedWorldRegion[];
  /** Small JPEG data URL preview for dashboards / future use. */
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A forged world, kept so it does not have to be forged again.
 *
 * A cache row, not a record: see `snapshots.ts` and `core/worldStore.ts`. The
 * bytes are quantised and gzipped, and anything whose `key` or `version` no
 * longer matches is discarded and regenerated.
 */
export interface WorldSnapshot {
  worldId: string;
  key: string;
  version: number;
  bytes: Uint8Array;
  width: number;
  height: number;
  savedAt: number;
}

/** One persisted canon supertile (see `canonSnapshots.ts`): the ~31 s of
 *  regional generation paid once per world instead of once per session.
 *  A cache like `worldSnapshots` — versioned, LRU-evicted, outside the
 *  backup registry — never the only home of anything the reader made. */
export interface CanonTileRow {
  /** `${worldId}:${canonKey}`. */
  id: string;
  worldId: string;
  /** Full invalidation key; any mismatch is a miss. */
  key: string;
  version: number;
  bytes: Uint8Array;
  byteLength: number;
  savedAt: number;
}

export interface WorldWaypoint {
  id: string;
  projectId: string;
  worldId: string;
  name: string;
  description?: string;
  /** Marker color (hex). */
  color: string;
  /** Normalized map position: u ∈ [0,1) west→east, v ∈ [0,1] north→south. */
  u: number;
  v: number;
  createdAt: number;
  updatedAt: number;
}

export const WAYPOINT_COLORS = [
  '#e4a853', // amber
  '#c4463a', // red
  '#4a9e6d', // green
  '#4a7ec4', // blue
  '#7c5cbf', // plum
  '#d4a843', // gold
] as const;
