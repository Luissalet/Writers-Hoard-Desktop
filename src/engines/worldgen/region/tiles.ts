// ============================================
// Regional canon — world-aligned supertiles
// ============================================
// The scale-canonical layer under the Google-Maps zoom. The freeform sheet
// (`regionGeometry`) derives its grid from whatever window the reader asked
// for, so two windows over the same valley disagree about its streams and its
// hamlets the moment their span or resolution differs. A CANON TILE removes
// every free variable: the grid is fixed by the world itself — tiles are
// aligned to world-cell boundaries at one refinement per world — so the same
// ground has exactly ONE canonical countryside, whatever window it is later
// shown through. Span and resolution stop being generation inputs and become
// what they should have been: rendering choices.
//
// Geometry invariants (all exact in floating point, none rely on snapping):
//   · originX/Y are multiples of `1/refinement` by construction;
//   · every coarse lattice the amplifier uses (`latticeOffset`) lands on the
//     same global indices for every tile, so overlapping aprons re-sample
//     identical points;
//   · the interior of the tile grid tiles the world exactly; the apron exists
//     so erosion, hydrology and habitation converge before the interior edge.

import type { WorldData } from '../core/types';
import { kmPerWorldCell, type RegionGeometry } from './terrain';
import { DEFAULT_REGION_PARAMS, type RegionParams, type RegionWindow } from './types';

/** Supertile edge in WORLD cells. 4 cells ≈ 78 km on a 2048-wide world. */
export const TILE_WORLD_CELLS = 4;
/**
 * Structural apron in canon cells (~10 km at the default refinement): the
 * margin inside which depression filling, stream-power erosion and habitation
 * scoring are allowed to feel the edge of the grid. Same cap the freeform
 * sheet uses; measured seam divergence gates it (see harness-p2).
 */
export const TILE_MARGIN = 64;
/** Band (canon cells) both neighbours compute, for display cross-fades. */
export const SEAM_BAND = 16;

/**
 * Canon cells per world cell.
 *
 * Pinned to the WORLD GRID, not to metres, because tiles must align to world
 * cells for determinism and for the edit list to rasterize identically at
 * every level. The power of two keeps the physical resolution near the tuned
 * ~187.5 m/cell of the classic default sheet across world tiers:
 * 1024 → 256 (≈153 m), 2048 → 128 (≈153 m), 3072 → 64 (≈204 m).
 * Cost per tile is CONSTANT regardless (the grid is always the same size);
 * finer worlds simply have more tiles.
 */
export function canonRefinement(world: Pick<WorldData, 'width'>): number {
  const ideal = (2048 / world.width) * 128;
  const pow = Math.round(Math.log2(Math.max(1, ideal)));
  return Math.max(16, Math.min(512, Math.pow(2, pow)));
}

/** Canon metres per cell for this world (~153–204 m across the size tiers). */
export function canonMetresPerCell(world: WorldData): number {
  return (kmPerWorldCell(world) * 1000 * TILE_WORLD_CELLS) / tileInterior(world);
}

/** Interior grid edge of a canon tile (canon cells). 512 at refinement 128. */
export function tileInterior(world: Pick<WorldData, 'width'>): number {
  return TILE_WORLD_CELLS * canonRefinement(world);
}

export interface TileId { tx: number; ty: number }

export function tileCountX(world: Pick<WorldData, 'width'>): number {
  return Math.max(1, Math.round(world.width / TILE_WORLD_CELLS));
}
export function tileCountY(world: Pick<WorldData, 'width' | 'height'>): number {
  return Math.max(1, Math.round(world.height / TILE_WORLD_CELLS));
}

export function wrapTx(world: Pick<WorldData, 'width'>, tx: number): number {
  const n = tileCountX(world);
  return ((tx % n) + n) % n;
}

export function tileKey(id: TileId): string {
  return `c:${id.tx}:${id.ty}`;
}

/** The tile whose INTERIOR contains this world coordinate. */
export function tileAt(world: Pick<WorldData, 'width' | 'height'>, wx: number, wy: number): TileId {
  const tx = wrapTx(world, Math.floor(wx / TILE_WORLD_CELLS));
  const ty = Math.min(tileCountY(world) - 1, Math.max(0, Math.floor(wy / TILE_WORLD_CELLS)));
  return { tx, ty };
}

/**
 * The geometry a canon tile hands to the SAME pipeline the freeform sheet
 * runs. Everything downstream — the amplifier, erosion, hydrology, cover,
 * habitation, tracks, fields — reads only this struct, which is what makes the
 * canon a re-keying of the existing engine rather than a second engine.
 */
export function tileGeometry(world: WorldData, id: TileId): RegionGeometry {
  const per = 1 / canonRefinement(world);
  const interior = tileInterior(world);
  const tx = wrapTx(world, id.tx);
  const ty = Math.min(tileCountY(world) - 1, Math.max(0, id.ty));
  return {
    width: interior + TILE_MARGIN * 2,
    height: interior + TILE_MARGIN * 2,
    margin: TILE_MARGIN,
    metresPerCell: canonMetresPerCell(world),
    originX: tx * TILE_WORLD_CELLS - TILE_MARGIN * per,
    originY: ty * TILE_WORLD_CELLS - TILE_MARGIN * per,
    worldPerCellX: per,
    worldPerCellY: per,
  };
}

/** The window a tile covers — for titles, subtitles and cache identity. */
export function tileWindow(world: WorldData, id: TileId): RegionWindow {
  const tx = wrapTx(world, id.tx);
  const ty = Math.min(tileCountY(world) - 1, Math.max(0, id.ty));
  return {
    cx: (tx + 0.5) * TILE_WORLD_CELLS,
    cy: (ty + 0.5) * TILE_WORLD_CELLS,
    spanKm: TILE_WORLD_CELLS * kmPerWorldCell(world),
  };
}

/**
 * Canon generation parameters. `res`/`aspect` are carried for compatibility
 * with the RegionParams shape but the tile GEOMETRY is authoritative; the
 * content knobs (detail, settled, habitation, streamDensity) stay the reader's.
 */
export function canonParams(world: WorldData, base?: Partial<RegionParams>): RegionParams {
  return {
    ...DEFAULT_REGION_PARAMS,
    ...base,
    res: tileInterior(world),
    aspect: 1,
    // El canon SIEMPRE deriva su sembrado de las ediciones (`sites: 'auto'`):
    // cerrado por defecto, el tick del menú lo abre entero, el pincel por
    // zonas (Luis, 2026-08-12). Forzado tras `base` igual que `res`: es parte
    // del contrato del canon, no una preferencia del llamante.
    sites: 'auto',
  };
}

/** Every tile whose INTERIOR intersects the given world-cell rect (x wraps). */
export function tilesInRect(
  world: Pick<WorldData, 'width' | 'height'>,
  x0: number, y0: number, x1: number, y1: number,
): TileId[] {
  const out: TileId[] = [];
  const nx = tileCountX(world), ny = tileCountY(world);
  const ty0 = Math.max(0, Math.floor(y0 / TILE_WORLD_CELLS));
  const ty1 = Math.min(ny - 1, Math.floor(y1 / TILE_WORLD_CELLS));
  const rawTx0 = Math.floor(x0 / TILE_WORLD_CELLS);
  const rawTx1 = Math.floor(x1 / TILE_WORLD_CELLS);
  const span = Math.min(nx - 1, rawTx1 - rawTx0);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let k = 0; k <= span; k++) out.push({ tx: wrapTx(world, rawTx0 + k), ty });
  }
  return out;
}
