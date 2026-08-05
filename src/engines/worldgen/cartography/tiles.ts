// ============================================
// Cartography — display tiles
// ============================================
// The slippy-map layer under the carta's gestures. A display tile is one
// 256-px square of the DRAWN map at a fixed zoom level, rendered by the same
// `renderCartography` that draws the full sheet — minus labels and furniture,
// which belong to the screen, not to the ground (a label baked into a tile is
// pinned to the wrong pixels the moment the view moves; the frame and compass
// never moved at all).
//
// Level z divides the world into 2^z × 2^(z-1) tiles (the world is 2:1), so a
// tile at z covers worldWidth/2^z cells and z+1 is exactly four children per
// parent — which is what makes the Google-Maps gesture work: any missing tile
// has an ancestor whose quarter can stand in, scaled, until the real one
// arrives. Blurry-then-sharp, never blank, never blocking.
//
// Every stochastic mark is keyed to WORLD position (paper grain, wobble,
// symbol jitter), so a tile is pixel-equal to its window of a monolithic
// render — the harness asserts it. The one bounded residue is Skia's
// clip-then-flatten antialiasing on glyphs that cross the canvas edge.

import type { WorldData } from '../core/types';
import type { HumanGeography } from '../core/settlements';
import { renderCartography, type CartoLayers, type CartoView } from './render';
import type { CartoTheme } from './theme';

export const TILE_PX = 256;
/** Lowest useful level: 4 tiles across ≈ the whole-world view. */
export const MIN_TILE_Z = 2;
/** Highest level of the pyramid. z2–z9 draw from the world raster; z10–z12
 *  draw the canon countryside pliego-style (region/deepTile.ts), ending at
 *  4 px per canon cell ≈ 38 m/px — beyond that there is nothing new to show
 *  until sub-canon amplification exists. */
export const MAX_TILE_Z = 12;
/** Highest level the WORLD raster can honestly serve (beyond it the carta
 *  base is pure magnification). Callers without a canon source cap here. */
export const MAX_WORLD_TILE_Z = 9;

export interface TileKey { z: number; tx: number; ty: number }

export function tileCountX(z: number): number {
  return 1 << z;
}
export function tileCountY(z: number): number {
  return Math.max(1, 1 << (z - 1));
}

export function wrapTileX(z: number, tx: number): number {
  const n = tileCountX(z);
  return ((tx % n) + n) % n;
}

export function tileId(key: TileKey): string {
  return `${key.z}/${key.tx}/${key.ty}`;
}

/** World-cell rect a tile covers. Exact: tile edges land on cell fractions
 *  that are powers of two, so neighbouring tiles share their boundary. */
export function tileView(world: { width: number; height: number }, key: TileKey): CartoView {
  const cells = world.width / tileCountX(key.z);
  return {
    x: wrapTileX(key.z, key.tx) * cells,
    y: key.ty * cells,
    w: cells,
    h: cells,
  };
}

/** The level whose tiles are at least as sharp as the screen. Callers pass
 *  `maxZ` = MAX_WORLD_TILE_Z when no canon source backs the deep levels. */
export function levelFor(world: { width: number }, pxPerCell: number, maxZ = MAX_TILE_Z): number {
  const ideal = Math.log2((pxPerCell * world.width) / TILE_PX);
  return Math.min(maxZ, Math.max(MIN_TILE_Z, Math.ceil(ideal - 1e-9)));
}

/**
 * One occurrence of a tile in a view.
 *
 * The key is WRAPPED — it names the ground, so it is what the cache id, the
 * request and the ancestor maths all use, and the same country is never
 * fetched twice. `viewTx` is the column BEFORE wrapping: which copy of the
 * world this occurrence sits in, which is what places it on screen.
 *
 * The two differ whenever the view is wider than the world — which is the
 * DEFAULT fitted view, since `fit()` sizes the map to 98 % of the canvas. Then
 * the leftmost and rightmost columns are the same ground seen twice, once at
 * each edge. Returning only the wrapped index collapsed them: one placement
 * for two on-screen positions (~14 px of coarse raster at each edge) and a
 * "terreno · n/m" that counted the duplicate — 40 keys for 32 distinct tiles.
 */
export interface ViewTile extends TileKey {
  viewTx: number;
}

/** Tiles whose ground intersects a view rect (x free, y clamped), row-major. */
export function tilesInView(
  world: { width: number; height: number },
  z: number,
  view: CartoView,
): ViewTile[] {
  const cells = world.width / tileCountX(z);
  const tx0 = Math.floor(view.x / cells);
  const tx1 = Math.floor((view.x + view.w - 1e-9) / cells);
  const ty0 = Math.max(0, Math.floor(view.y / cells));
  const ty1 = Math.min(tileCountY(z) - 1, Math.floor((view.y + view.h - 1e-9) / cells));
  const out: ViewTile[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    // Both indices, always: the wrapped one identifies the GROUND, the raw one
    // identifies the PLACE ON SCREEN, and a view wider than the world needs the
    // same ground drawn at both of its edges.
    for (let tx = tx0; tx <= tx1; tx++) out.push({ z, tx: wrapTileX(z, tx), ty, viewTx: tx });
  }
  return out;
}

/** The carta layers a TILE may carry: ground only. Settlement marks are
 *  screen-sized symbols (a capital's ring is 5.6 px on YOUR screen, not on the
 *  ground), so baking them into a tile stretches them whenever an ancestor
 *  stands in for a missing child — they ride the live overlay with the
 *  lettering instead. */
export function tileLayers(layers: Partial<CartoLayers>): Partial<CartoLayers> {
  return {
    ...layers,
    labels: false,
    settlements: false,
    frame: false,
    compass: false,
    scaleBar: false,
  };
}

export interface CartaTileRequest {
  key: TileKey;
  theme: CartoTheme;
  layers: Partial<CartoLayers>;
  density: number;
  reliefAmount: number;
}

/**
 * Draw one tile. Pure with respect to the surface: the caller supplies any
 * 2D context (OffscreenCanvas in the worker, @napi-rs in the harness, a
 * plain canvas in a pinch) — the same seam `renderCartography` has always
 * offered, finally used for what it was built for.
 */
export function renderCartaTile(
  world: WorldData,
  geography: HumanGeography | undefined,
  ctx: CanvasRenderingContext2D,
  req: CartaTileRequest,
): void {
  renderCartography(world, ctx, {
    theme: req.theme,
    width: TILE_PX,
    height: TILE_PX,
    view: tileView(world, req.key),
    layers: tileLayers(req.layers),
    density: req.density,
    reliefAmount: req.reliefAmount,
    geography,
    // One world-anchored type scale for every tile of a level, so symbol
    // sizes agree across joins (labels are off; this feeds symbol metrics).
    typeScale: 1,
    // The paper continues across tile joins: this tile's pixel origin inside
    // the level's virtual whole-world sheet.
    paperAnchor: {
      x: wrapTileX(req.key.z, req.key.tx) * TILE_PX,
      y: req.key.ty * TILE_PX,
      extentX: TILE_PX * tileCountX(req.key.z),
      extentY: TILE_PX * tileCountY(req.key.z),
    },
  });
}
