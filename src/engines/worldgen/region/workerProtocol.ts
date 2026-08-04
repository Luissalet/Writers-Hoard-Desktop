import type { HumanGeography } from '../core/settlements';
import type { TilePlace } from './deepTile';
import type { WorldData } from '../core/types';
import type { RegionGeometry } from './terrain';
import type { RegionData, RegionParams, RegionWindow } from './types';

/**
 * Worker-safe geography.
 *
 * `Language.orthography` is a function and therefore cannot cross the
 * structured-clone boundary. The whole family is deterministic from the world
 * seed and living-language count, so the worker rebuilds it instead.
 */
export type RegionWorkerGeography = Omit<HumanGeography, 'languages'> & {
  languageCount: number;
};

export function packRegionGeography(
  geography: HumanGeography,
): RegionWorkerGeography {
  const { languages, ...cloneable } = geography;
  return {
    ...cloneable,
    languageCount: Math.max(2, languages.living.length),
  };
}

export interface RegionConfigureWorkerRequest {
  type: 'configure';
  contextId: string;
  world: WorldData;
  geography: RegionWorkerGeography;
}

export interface RegionGenerateWorkerRequest {
  type: 'generate';
  requestId: string;
  contextId: string;
  window: RegionWindow;
  params: RegionParams;
  /** Canon tiles pass their world-aligned grid; freeform sheets omit it. */
  geometry?: RegionGeometry;
  /** Serialized edit list, applied at sheet resolution (canon path only —
   *  requires the configured world to carry PRISTINE elevation). */
  edits?: string;
}

/**
 * Read the canon under one point.
 *
 * Deliberately incapable of generating anything: it answers only from canon
 * tiles this session has ALREADY built, and says so when it cannot. A hover
 * readout that could trigger a nine-second supertile build would make the
 * cursor a trap; this way it is free, and by the time the reader is looking at
 * canon ground the canon under the cursor is by definition resident.
 */
export interface RegionProbeWorkerRequest {
  type: 'probe';
  requestId: string;
  contextId: string;
  /** World cell coordinates (x wraps). */
  wx: number;
  wy: number;
}

export interface RegionProbe {
  /** Metres above sea level, at ~153 m resolution. */
  elevationM: number;
  /** 0 land · 1 sea · 2 lake. */
  water: number;
  /** Regional ground cover id (see region/types Cover). */
  cover: number;
  /** World biome id, after the sheet's own correction. */
  biome: number;
  /** Metres per metre. */
  slope: number;
  /** 0–1 topographic wetness. */
  wet: number;
  /** Ground resolution this reading came from. */
  metresPerCell: number;
}

export interface RegionCancelWorkerRequest {
  type: 'cancel';
  requestId: string;
}

/**
 * One carta display tile, drawn by this worker because it already holds the
 * cloned world and geography — the whole cost of a tile is the render, not
 * another 80 MB structured clone. Theme travels by id: a CartoTheme is data
 * plus nothing, but the id is smaller and cannot drift from the registry.
 */
export interface RegionRenderTileWorkerRequest {
  type: 'renderTile';
  /**
   * Which vocabulary to ink this tile in.
   *
   * `carta` is the paper sheet the Carta view reads. `satellite` is the ground
   * seen from above, which is what the 2D view edits on. Same worker, same
   * cloned world, same canon cache — a satellite tile and a carta tile over the
   * same hillside share the expensive part and differ only in the paint.
   * Absent means `carta`, so every existing caller keeps its behaviour.
   */
  ink?: 'carta' | 'satellite';
  requestId: string;
  contextId: string;
  z: number;
  tx: number;
  ty: number;
  themeId: string;
  layers: Record<string, boolean>;
  density: number;
  reliefAmount: number;
  /** Serialized edit list for DEEP tiles (z ≥ DEEP_TILE_Z): the canon ground
   *  re-applies strokes at its own resolution, so the session world must be
   *  the PRISTINE one and the edits ride the request. */
  edits?: string;
}

export type RegionWorkerRequest =
  | RegionConfigureWorkerRequest
  | RegionGenerateWorkerRequest
  | RegionRenderTileWorkerRequest
  | RegionProbeWorkerRequest
  | RegionCancelWorkerRequest;

export type RegionWorkerReply =
  | { type: 'configured'; contextId: string }
  | { type: 'progress'; requestId: string; stage: string; overall: number }
  | { type: 'done'; requestId: string; region: RegionData }
  | {
    type: 'tile';
    requestId: string;
    /** Same-process host (web worker): a zero-copy bitmap. */
    bitmap?: ImageBitmap;
    /** Cross-process host (the Forge): raw pixels; the client rebuilds the
     *  bitmap on arrival. */
    rgba?: ArrayBuffer;
    width?: number;
    height?: number;
    places?: TilePlace[];
  }
  | { type: 'probed'; requestId: string; probe: RegionProbe | null }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string };

/** Transfer the heavy raster layers without copying the generated result back to the renderer. */
export function regionTransferables(region: RegionData): Transferable[] {
  return [
    region.elevation.buffer,
    region.water.buffer,
    region.flow.buffer,
    region.slope.buffer,
    region.wet.buffer,
    region.biome.buffer,
    region.cover.buffer,
  ] as Transferable[];
}
