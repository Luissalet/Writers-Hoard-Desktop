// ============================================
// World Generator Engine — DB Record Types
// ============================================
// Worlds are stored as seed + parameters ONLY (plus a small thumbnail): the
// pipeline is deterministic, so the terrain is regenerated on demand and
// cached in memory. This keeps Dexie light and makes backups tiny.

import type { WorldParams } from './core/types';

export interface GeneratedWorld {
  id: string;
  projectId: string;
  title: string;
  params: WorldParams;
  /** Small JPEG data URL preview for dashboards / future use. */
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
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
