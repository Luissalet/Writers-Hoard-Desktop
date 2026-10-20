import type { WorldData } from '../core/types';
import type { SavedWorldRegion } from '../types';
import { canonWindowCover, type CanonWindowSpec } from '../region/composeWindow';
import { canonRefinement } from '../region/tiles';
import { kmPerWorldCell } from '../region/terrain';

export interface SheetFrame { x: number; y: number; widthKm: number; heightKm: number }
export interface SheetEdges { west: number; east: number; north: number; south: number }
export const MAX_SHEET_CELLS = 2_000_000, MAX_SHEET_TILES = 16;
export class SheetFrameError extends Error {}
export function savedSheetFrame(region: SavedWorldRegion): SheetFrame { return { x: region.x, y: region.y, widthKm: region.spanKm, heightKm: region.spanKm / region.params.aspect }; }
export function sheetFrame(world: Pick<WorldData, 'width' | 'height'>, frame: SheetFrame): SheetFrame {
  const km = kmPerWorldCell(world as WorldData), min = km / canonRefinement(world);
  if (![frame.x, frame.y, frame.widthKm, frame.heightKm].every(Number.isFinite) || frame.widthKm < min || frame.heightKm < min || frame.widthKm > km * world.width || frame.heightKm > km * world.height || frame.y - frame.heightKm / km / 2 < -1e-8 || frame.y + frame.heightKm / km / 2 > world.height + 1e-8) throw new SheetFrameError('Invalid sheet bounds');
  return { ...frame, x: ((frame.x % world.width) + world.width) % world.width };
}
/** Positive edge amounts reveal ground; negative amounts crop it. */
export function adjustSheetEdges(world: Pick<WorldData, 'width' | 'height'>, frame: SheetFrame, edges: SheetEdges): SheetFrame {
  if (!Object.values(edges).every(Number.isFinite)) throw new SheetFrameError('Invalid edge amount');
  const km = kmPerWorldCell(world as WorldData);
  return sheetFrame(world, { x: frame.x + (edges.east - edges.west) / km / 2, y: frame.y + (edges.south - edges.north) / km / 2, widthKm: frame.widthKm + edges.west + edges.east, heightKm: frame.heightKm + edges.north + edges.south });
}
export function sheetSpec(world: WorldData, requested: SheetFrame): { frame: SheetFrame; spec: CanonWindowSpec; crop: { x: number; y: number; width: number; height: number } } {
  const frame = sheetFrame(world, requested), km = kmPerWorldCell(world), refinement = canonRefinement(world);
  const width = frame.widthKm / km * refinement, height = frame.heightKm / km * refinement;
  const left = frame.x * refinement - width / 2, top = frame.y * refinement - height / 2;
  const gx0 = Math.floor(left), gy0 = Math.max(0, Math.floor(top));
  const spec: CanonWindowSpec = { gx0, gy0, cw: Math.ceil(left + width) - gx0, ch: Math.min(world.height * refinement, Math.ceil(top + height)) - gy0, margin: 4 };
  if ((spec.cw + spec.margin * 2) * (spec.ch + spec.margin * 2) > MAX_SHEET_CELLS || canonWindowCover(world, spec).length > MAX_SHEET_TILES) throw new SheetFrameError('Sheet exceeds canonical raster or tile budget');
  return { frame, spec, crop: { x: left - gx0, y: top - gy0, width, height } };
}
export function applySheetFrame(region: SavedWorldRegion, frame: SheetFrame): SavedWorldRegion { return { ...region, frameMode: 'canon', x: frame.x, y: frame.y, spanKm: frame.widthKm, params: { ...region.params, aspect: frame.widthKm / frame.heightKm } }; }
