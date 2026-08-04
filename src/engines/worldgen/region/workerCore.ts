// ============================================
// Regional worker — the CORE, host-agnostic
// ============================================
// One message handler, two homes. In the browser it runs inside a Web Worker
// (a thread of the renderer process, paying renderer memory prices). In the
// Forge it runs inside an Electron utilityProcess — a real OS process with
// its own memory space, where a generation can gorge on RAM and a crash
// cannot take the window down. The host injects the two things that differ:
// how to POST a reply, and how to make a 2D SURFACE for tile rendering.

import { clearRegionCache, generateRegion } from './generate';
import { deserializeEdits } from '../core/edits';
import { renderCartaTile, TILE_PX } from '../cartography/tiles';
import { canonRefinement, tileAt, tileGeometry, tileKey as canonKeyOf } from './tiles';
import { renderBase } from '../core/render';
import {
  renderSatelliteDeepTile, renderSatelliteShallowTile, satelliteDeepSupported,
} from './satelliteTile';
import { CANON_CACHE_CAP, CANON_CACHE_BYTES } from './deepTile';
import { deepTileSupported, makeCanonCache, renderDeepTile, type CanonCache, type TilePlace } from './deepTile';
import { THEMES } from '../cartography/theme';
import { regionTransferables, type RegionWorkerReply, type RegionWorkerRequest } from './workerProtocol';
import { buildLanguageFamily } from '../core/language';
import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';

/** What a finished tile hands back: either a zero-copy bitmap (web worker,
 *  same process) or raw pixels (forge, crossing a process boundary). */
export interface TileResult {
  bitmap?: ImageBitmap;
  rgba?: ArrayBuffer;
  width?: number;
  height?: number;
  transfer: Transferable[];
}

export interface RegionWorkerHost {
  post(message: RegionWorkerReply, transfer?: Transferable[]): void;
  /** Draw one tile with `draw`, then package the pixels for this host. */
  renderTile(px: number, draw: (ctx: CanvasRenderingContext2D) => void): TileResult;
}

export function createRegionWorkerCore(host: RegionWorkerHost): (message: RegionWorkerRequest) => void {
  const cancelled = new Set<string>();
  let context: {
    id: string;
    world: WorldData;
    geography: HumanGeography;
    /** Canon supertiles for deep display tiles, LRU per session. */
    canon: CanonCache;
    /** The unshaded atlas raster, built once and only if a shallow satellite
     *  tile ever asks for it — it is ~8 MB and the carta path never needs it. */
    unshaded?: Uint8ClampedArray;
  } | null = null;

  return (message: RegionWorkerRequest) => {
    if (message.type === 'configure') {
      const { languageCount, ...geography } = message.geography;
      context = {
        id: message.contextId,
        world: message.world,
        geography: {
          ...geography,
          languages: buildLanguageFamily(message.world.params.seed, languageCount),
        },
        canon: makeCanonCache(),
      };
      host.post({ type: 'configured', contextId: message.contextId });
      return;
    }
    if (message.type === 'cancel') {
      cancelled.add(message.requestId);
      host.post({ type: 'cancelled', requestId: message.requestId });
      return;
    }

    const { requestId } = message;
    if (!context || context.id !== message.contextId) {
      host.post({ type: 'error', requestId, message: 'Regional worker context is not configured.' });
      return;
    }
    if (cancelled.delete(requestId)) {
      host.post({ type: 'cancelled', requestId });
      return;
    }

    if (message.type === 'probe') {
      const live = context;
      const id = tileAt(live.world, message.wx, message.wy);
      const data = live.canon.map.get(canonKeyOf(id));
      if (!data) {
        host.post({ type: 'probed', requestId, probe: null });
        return;
      }
      const g = tileGeometry(live.world, id);
      const per = 1 / canonRefinement(live.world);
      const gx = Math.round((message.wx - g.originX) / per - 0.5);
      const gy = Math.round((message.wy - g.originY) / per - 0.5);
      if (gx < 0 || gy < 0 || gx >= data.width || gy >= data.height) {
        host.post({ type: 'probed', requestId, probe: null });
        return;
      }
      const i = gy * data.width + gx;
      host.post({
        type: 'probed',
        requestId,
        probe: {
          elevationM: data.elevation[i] * 1000,
          water: data.water[i],
          cover: data.cover[i],
          biome: data.biome[i],
          slope: data.slope[i],
          wet: data.wet[i],
          metresPerCell: data.metresPerCell,
        },
      });
      return;
    }

    if (message.type === 'renderTile') {
      try {
        const theme = THEMES.find((t) => t.id === message.themeId) ?? THEMES[0];
        const live = context;
        let places: TilePlace[] | undefined;
        const satellite = message.ink === 'satellite';
        const result = host.renderTile(TILE_PX, (c2d) => {
          if (satellite) {
            if (satelliteDeepSupported(live.world, message.z)) {
              const deep = renderSatelliteDeepTile(
                live.world, live.geography, live.canon, c2d,
                { z: message.z, tx: message.tx, ty: message.ty },
                {
                  layers: message.layers,
                  density: message.density,
                  edits: message.edits ? deserializeEdits(message.edits) : undefined,
                },
                { cap: CANON_CACHE_CAP, bytes: CANON_CACHE_BYTES },
              );
              if (deep.places.length) places = deep.places;
            } else {
              if (!live.unshaded) {
                live.unshaded = renderBase(live.world, 'atlas', { shade: false });
              }
              renderSatelliteShallowTile(
                live.world, live.unshaded, c2d,
                { z: message.z, tx: message.tx, ty: message.ty },
                { rivers: message.layers.rivers !== false },
              );
            }
          } else if (deepTileSupported(live.world, message.z)) {
            // Deep levels draw the canon COUNTRYSIDE pliego-style. The session
            // world here is the pristine one; strokes ride the request and are
            // re-applied at canon resolution inside generation.
            const deep = renderDeepTile(
              live.world,
              live.geography,
              live.canon,
              c2d,
              { z: message.z, tx: message.tx, ty: message.ty },
              {
                theme,
                layers: message.layers,
                density: message.density,
                edits: message.edits ? deserializeEdits(message.edits) : undefined,
              },
            );
            if (deep.places.length) places = deep.places;
          } else {
            renderCartaTile(live.world, live.geography, c2d, {
              key: { z: message.z, tx: message.tx, ty: message.ty },
              theme,
              layers: message.layers,
              density: message.density,
              reliefAmount: message.reliefAmount,
            });
          }
        });
        host.post({
          type: 'tile',
          requestId,
          bitmap: result.bitmap,
          rgba: result.rgba,
          width: result.width,
          height: result.height,
          places,
        }, result.transfer);
      } catch (error) {
        host.post({
          type: 'error',
          requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    try {
      const region = generateRegion(context.world, context.geography, message.window, {
        params: message.params,
        geometry: message.geometry,
        edits: message.edits ? deserializeEdits(message.edits) : undefined,
        onProgress: (stage, overall) => {
          if (!cancelled.has(requestId)) {
            host.post({ type: 'progress', requestId, stage, overall });
          }
        },
      });
      if (cancelled.delete(requestId)) {
        host.post({ type: 'cancelled', requestId });
        return;
      }
      // The renderer owns the bounded cache. Clear the worker's reference before
      // transferring buffers so a detached cached result can never be reused.
      clearRegionCache(context.world);
      host.post({ type: 'done', requestId, region }, regionTransferables(region));
    } catch (error) {
      host.post({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
