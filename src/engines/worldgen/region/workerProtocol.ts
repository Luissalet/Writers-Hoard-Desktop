import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
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
}

export interface RegionCancelWorkerRequest {
  type: 'cancel';
  requestId: string;
}

export type RegionWorkerRequest =
  | RegionConfigureWorkerRequest
  | RegionGenerateWorkerRequest
  | RegionCancelWorkerRequest;

export type RegionWorkerReply =
  | { type: 'configured'; contextId: string }
  | { type: 'progress'; requestId: string; stage: string; overall: number }
  | { type: 'done'; requestId: string; region: RegionData }
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
