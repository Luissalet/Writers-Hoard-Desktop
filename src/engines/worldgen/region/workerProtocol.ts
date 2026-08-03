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
