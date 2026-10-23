// ============================================
// World Generator Engine — DB Record Types
// ============================================
// Worlds are stored as seed + parameters ONLY (plus a small thumbnail): the
// pipeline is deterministic, so the terrain is regenerated on demand and
// cached in memory. This keeps Dexie light and makes backups tiny.

import type { WorldParams } from './core/types';
import type { RegionParams } from './region/types';
import type { WorldJourney } from './journeyTypes';

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
  /** Fixed, reversible window composed from the world's shared canonical terrain. */
  frameMode?: 'canon';
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
  /** Original world when this recipe was explored as an independent alternative. */
  originWorldId?: string;
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
  /** Named travel plans; geographic paths and durations are derived on opening. */
  journeys?: WorldJourney[];
  /** Own contextual manuscript links; absence inherits shared links. */
  manuscriptLinks?: import('@/types/projectTools').EntityLink[];
  /** Small JPEG data URL preview for dashboards / future use. */
  thumbnail?: string;
  /** The author's chosen look; absent fields keep the built-in defaults. See presentation.ts. */
  presentation?: WorldPresentation;
  /** Increments on every saved presentation change, for compare-and-swap writers. */
  presentationRevision?: number;
  /** The author's travel speeds and ground costs for this world; absent = built-in physics. */
  travelProfile?: import('./core/travel').TravelProfile;
  /** Default pace for new itineraries on this world. */
  travelPace?: import('./core/travel').TravelPace;
  /** Increments on every saved travel settings change. */
  travelRevision?: number;
  createdAt: number;
  updatedAt: number;
}

export type WorldPresentationLayer = 'relief' | 'forests' | 'labels' | 'settlements' | 'roads' | 'borders' | 'frame' | 'compass' | 'scaleBar';

/** How a world is shown to everyone who opens it, flat and in 3D, and in its exports. */
export interface WorldPresentation {
  theme?: 'wonder' | 'antique' | 'relief' | 'survey';
  skin3D?: 'satelite' | 'dibujado' | 'arcilla' | 'pintado';
  /** On the 3D plane with the whole world in view: a tabletop model (default) or a landscape to the horizon. */
  stage3D?: 'maqueta' | 'paisaje';
  reliefAmount?: number;
  layers?: Partial<Record<WorldPresentationLayer, boolean>>;
  /** A square or hex play grid over the map, in km; null or absent = none. */
  grid?: import('./cartography/mapGrid').MapGrid | null;
  /** How the reader's-eye map starts before any fog stroke: blank paper (default), all sketched, all in ink, or the land in ink and the sea blank. */
  readerStart?: 'blank' | 'sketch' | 'ink' | 'land';
  /** In the reader's view, towns the story has not shown: hidden under the fog with their names (default), or as unnamed dots where heard of. */
  readerTowns?: 'names' | 'dots';
  /** In the reader's view, the party's trail: the events that have happened, in chapter order. Off unless chosen. */
  readerTrail?: boolean;
  /** Contour lines: absent/null = as the look draws them, 'off' = none, a number = every N metres on any look. */
  contours?: number | 'off' | null;
  /** Clouds drifting over the 3D plane, with their shadows on the ground. Off unless chosen. */
  clouds?: boolean;
  /** The tabletop model's block: cut rock (default), stacked paper (the land rises in paper sheets) or an engraving. */
  block3D?: 'roca' | 'papel' | 'grabado';
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

/** Una tesela de pantalla ENTINTADA y persistida (ver `renderedSnapshots.ts`):
 *  el producto final del render — png/webp de 256² — guardado con clave de
 *  contenido, para que revisitar suelo ya dibujado cueste milisegundos ENTRE
 *  SESIONES (la sensación Google Maps; ARQUITECTURA-TESELAS §3.2). Caché puro:
 *  versionado, con presupuesto en bytes, desalojado por `savedAt`, fuera del
 *  registro de copias — nunca el único hogar de nada que el lector hiciera. */
export interface RenderedTileRow {
  /** `${worldId}:${styleHash}:${z}/${tx}/${ty}` — una fila por suelo y estilo;
   *  el contenido nuevo del mismo suelo REEMPLAZA la fila vieja en vez de
   *  acumular basura. */
  id: string;
  worldId: string;
  /** Clave de invalidación completa (versiones + semilla + params + ediciones
   *  relevantes + estilo); cualquier desajuste es un fallo de caché. */
  key: string;
  version: number;
  /** La imagen codificada (webp/png). */
  bytes: Uint8Array;
  byteLength: number;
  /** Lugares con nombre de la tesela (JSON), para las etiquetas del visor. */
  places?: string;
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
