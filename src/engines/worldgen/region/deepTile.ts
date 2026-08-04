// ============================================
// Regional canon — deep display tiles
// ============================================
// From z10 the carta stops magnifying the world raster and starts drawing the
// COUNTRYSIDE: the same 152 m canon ground the 3D close-up and the regional
// pliego read, rendered with the pliego's own vocabulary — contours, hedges,
// buildings, every stream — through `renderRegion` in tile-ink mode, where
// every stochastic choice is keyed to the global canon lattice. One landscape,
// one vocabulary per scale, no window anywhere in the chain.
//
// Pure data + injected 2D context: the worker feeds an OffscreenCanvas, the
// harness feeds @napi-rs — the SHIPPING path is the TESTED path.

import { scaleBytes, scaleCount } from '@/utils/capacity';
import type { WorldData } from '../core/types';
import type { WorldEdit } from '../core/edits';
import type { HumanGeography } from '../core/settlements';
import type { CartoTheme } from '../cartography/theme';
import type { Ctx } from '../cartography/symbols';
import type { RegionData } from './types';
import { generateCanonTile, canonTileKey } from './generate';
import { canonRefinement, type TileId } from './tiles';
import { canonWindowCover, composeCanonWindow, type CanonWindowSpec } from './composeWindow';
import { renderRegion, type RegionLayers } from './render';
import {
  TILE_PX, tileCountX, tileCountY, wrapTileX, type TileKey,
} from '../cartography/tiles';

/** First level drawn from canon ground (1 px per canon cell). Below this the
 *  carta raster is still the sharper truth. */
export const DEEP_TILE_Z = 10;

/** Px per canon cell at a display level — width-independent by construction:
 *  the canon lattice has `width·refinement = 262144` cells around any world. */
export function pxPerCanonCell(z: number): number {
  return Math.pow(2, z) / 1024;
}

/**
 * Contour interval by LEVEL, fixed for every tile of that level. A per-sheet
 * interval (what the pliego rightly does) would end lines mid-air at tile
 * joins; a per-level ladder is what a real map series does as it zooms.
 */
export function contourIntervalForZ(z: number): number {
  return z >= 12 ? 25 : z >= 11 ? 50 : 100;
}

/** The exact canon-lattice window under a display tile. */
export function deepTileSpec(world: WorldData, key: TileKey): CanonWindowSpec {
  const wrapX = world.width * canonRefinement(world);
  const cells = Math.round(wrapX / tileCountX(key.z));
  return {
    gx0: wrapTileX(key.z, key.tx) * cells,
    gy0: key.ty * cells,
    cw: cells,
    ch: cells,
    // Feature reach: canopies, building clusters, stroke widths. 16 canon
    // cells ≈ 2.4 km of overhang — measured enough for every stamp we draw.
    margin: 16,
  };
}

/** A named place riding a deep tile's reply, in WORLD cell coordinates —
 *  the main thread letters these live (names never bake into tiles). */
export interface TilePlace {
  worldX: number;
  worldY: number;
  name: string;
  kind: string;
  importance: number;
}

/** Session-scoped cache of generated canon supertiles, bounded by BYTES:
 *  a 2048-width world's supertile weighs ~8 MB, a 1024-width world's ~25 MB —
 *  a flat count would hold three of the latter and quietly triple the
 *  worker's residency. */
export interface CanonCache {
  map: Map<string, RegionData>;
  order: string[];
  bytes: number;
}
export const CANON_CACHE_CAP = scaleCount(4);
export const CANON_CACHE_BYTES = scaleBytes(96 * 1024 * 1024);

function canonBytes(r: RegionData): number {
  return r.elevation.byteLength + r.water.byteLength + r.flow.byteLength
    + r.slope.byteLength + r.wet.byteLength + r.biome.byteLength
    + r.cover.byteLength + 4096;
}

export function makeCanonCache(): CanonCache {
  return { map: new Map(), order: [], bytes: 0 };
}

export interface DeepTileOptions {
  theme: CartoTheme;
  /** Carta layer flags, translated to the pliego vocabulary here. */
  layers: Record<string, boolean | undefined>;
  density: number;
  edits?: WorldEdit[];
}

export interface DeepTileResult {
  /** Canon supertiles generated for this tile (0 = fully warm). */
  generated: number;
  /** Named places whose ground lies INSIDE this tile (margin excluded, so a
   *  place reports from exactly one tile and the caller needs no dedup). */
  places: TilePlace[];
}

/**
 * Render one deep display tile. Generates (or reuses) the canon supertiles
 * under it, composes the exact window, and inks it pliego-style.
 */
export function renderDeepTile(
  world: WorldData,
  geography: HumanGeography,
  cache: CanonCache,
  ctx: Ctx,
  key: TileKey,
  opts: DeepTileOptions,
): DeepTileResult {
  const spec = deepTileSpec(world, key);
  const cover = canonWindowCover(world, spec);
  let generated = 0;
  const placed: { id: TileId; data: RegionData }[] = [];
  for (const id of cover) {
    const k = canonTileKey(id);
    let data = cache.map.get(k);
    if (!data) {
      data = generateCanonTile(world, geography, id, { edits: opts.edits });
      generated++;
      cache.map.set(k, data);
      cache.order.push(k);
      cache.bytes += canonBytes(data);
      while ((cache.order.length > CANON_CACHE_CAP || cache.bytes > CANON_CACHE_BYTES)
        && cache.order.length > 1) {
        const evict = cache.order.shift();
        if (!evict) break;
        const dead = cache.map.get(evict);
        if (dead) cache.bytes -= canonBytes(dead);
        cache.map.delete(evict);
      }
    } else {
      // Touch for LRU.
      const at = cache.order.indexOf(k);
      if (at >= 0) cache.order.splice(at, 1);
      cache.order.push(k);
    }
    placed.push({ id, data });
  }

  const region = composeCanonWindow(world, placed, spec);
  const m = region.margin;
  const places: TilePlace[] = [];
  for (const p of region.places) {
    if (p.x < m || p.x >= m + spec.cw || p.y < m || p.y >= m + spec.ch) continue;
    if (!p.name) continue;
    places.push({
      worldX: p.worldX, worldY: p.worldY,
      name: p.name, kind: p.kind, importance: p.importance,
    });
  }
  const L = opts.layers;
  const layers: Partial<RegionLayers> = {
    // Ground vocabulary rides the nearest carta flag; lettering and furniture
    // NEVER bake into a tile (same law as the carta pyramid).
    water: L.rivers !== false,
    tracks: L.roads !== false,
    places: true,
    labels: false,
    frame: false,
    legend: false,
    scaleBar: false,
  };
  renderRegion(region, ctx, {
    theme: opts.theme,
    width: TILE_PX,
    height: TILE_PX,
    layers,
    density: opts.density,
    tileInk: {
      seed: `${world.params.seed}::tiles`,
      gx0: spec.gx0 - spec.margin,
      gy0: spec.gy0 - spec.margin,
      wrapX: world.width * canonRefinement(world),
      contourIntervalM: contourIntervalForZ(key.z),
    },
    paperAnchor: {
      x: wrapTileX(key.z, key.tx) * TILE_PX,
      y: key.ty * TILE_PX,
      extentX: TILE_PX * tileCountX(key.z),
      extentY: TILE_PX * tileCountY(key.z),
    },
  });
  return { generated, places };
}

/** Guard used by the worker: deep rendering needs the canon lattice to divide
 *  the display grid exactly, which it does for every power-of-two world. */
export function deepTileSupported(world: WorldData, z: number): boolean {
  const wrapX = world.width * canonRefinement(world);
  return z >= DEEP_TILE_Z && Number.isInteger(wrapX / tileCountX(z));
}
