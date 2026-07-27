import type { RegionData } from './types';

export interface RegionPoint {
  x: number;
  y: number;
}

export interface RegionSpatialFrame {
  width: number;
  height: number;
  margin: number;
  originX: number;
  originY: number;
  worldPerCellX: number;
  worldPerCellY: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export type RegionFrame = RegionSpatialFrame | Pick<
  RegionData,
  'width' | 'height' | 'margin' | 'originX' | 'originY' | 'worldPerCellX' | 'worldPerCellY'
>;

/** The drawable part of a regional grid; the surrounding cells are generation overhang. */
export function regionVisibleRect(
  region: Pick<RegionFrame, 'width' | 'height' | 'margin'>,
): { x: number; y: number; width: number; height: number } {
  const width = Math.max(0, region.width - region.margin * 2);
  const height = Math.max(0, region.height - region.margin * 2);
  return { x: region.margin, y: region.margin, width, height };
}

/**
 * Convert a regional-grid point to pixels in the visible canvas.
 *
 * Canvas dimensions may be CSS pixels for pointer input or backing-store pixels
 * for drawing. Using the matching dimensions on the reverse conversion makes
 * the pair exact regardless of device pixel ratio.
 */
export function regionCellToCanvas(
  region: Pick<RegionFrame, 'width' | 'height' | 'margin'>,
  point: RegionPoint,
  canvas: CanvasSize,
): RegionPoint {
  const visible = regionVisibleRect(region);
  return {
    x: ((point.x - visible.x) / Math.max(1, visible.width)) * canvas.width,
    y: ((point.y - visible.y) / Math.max(1, visible.height)) * canvas.height,
  };
}

/** Convert visible-canvas pixels to FULL regional-grid coordinates, including the margin offset. */
export function canvasToRegionCell(
  region: Pick<RegionFrame, 'width' | 'height' | 'margin'>,
  point: RegionPoint,
  canvas: CanvasSize,
): RegionPoint {
  const visible = regionVisibleRect(region);
  return {
    x: visible.x + (point.x / Math.max(1, canvas.width)) * visible.width,
    y: visible.y + (point.y / Math.max(1, canvas.height)) * visible.height,
  };
}

export function isVisibleRegionCell(
  region: Pick<RegionFrame, 'width' | 'height' | 'margin'>,
  point: RegionPoint,
  overhang = 0,
): boolean {
  const visible = regionVisibleRect(region);
  return point.x >= visible.x - overhang
    && point.x <= visible.x + visible.width + overhang
    && point.y >= visible.y - overhang
    && point.y <= visible.y + visible.height + overhang;
}

/** Canonicalise a longitudinal world coordinate while leaving non-wrapping worlds untouched. */
export function wrapWorldX(x: number, worldWidth?: number): number {
  if (!worldWidth || !Number.isFinite(worldWidth) || worldWidth <= 0) return x;
  return ((x % worldWidth) + worldWidth) % worldWidth;
}

/** FULL regional-grid coordinates to world-cell coordinates. */
export function regionCellToWorld(
  region: Pick<RegionFrame, 'originX' | 'originY' | 'worldPerCellX' | 'worldPerCellY'>,
  point: RegionPoint,
  worldWidth?: number,
): RegionPoint {
  return {
    x: wrapWorldX(region.originX + point.x * region.worldPerCellX, worldWidth),
    y: region.originY + point.y * region.worldPerCellY,
  };
}

/**
 * World-cell coordinates to FULL regional-grid coordinates.
 *
 * When a world width is supplied, the nearest wrapped copy is chosen. This is
 * important for sheets that cross the longitude seam.
 */
export function worldToRegionCell(
  region: Pick<RegionFrame, 'originX' | 'originY' | 'worldPerCellX' | 'worldPerCellY'>,
  point: RegionPoint,
  worldWidth?: number,
): RegionPoint {
  let dx = point.x - region.originX;
  if (worldWidth && Number.isFinite(worldWidth) && worldWidth > 0) {
    while (dx < -worldWidth / 2) dx += worldWidth;
    while (dx > worldWidth / 2) dx -= worldWidth;
  }
  return {
    x: dx / region.worldPerCellX,
    y: (point.y - region.originY) / region.worldPerCellY,
  };
}

export function canvasToRegionWorld(
  region: RegionFrame,
  point: RegionPoint,
  canvas: CanvasSize,
  worldWidth?: number,
): RegionPoint {
  return regionCellToWorld(region, canvasToRegionCell(region, point, canvas), worldWidth);
}

export function regionWorldToCanvas(
  region: RegionFrame,
  point: RegionPoint,
  canvas: CanvasSize,
  worldWidth?: number,
): RegionPoint {
  return regionCellToCanvas(region, worldToRegionCell(region, point, worldWidth), canvas);
}
