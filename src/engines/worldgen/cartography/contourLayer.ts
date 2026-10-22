// ============================================
// World Generator — Contour lines at the author's interval
// ============================================
// The themes that draw relief by lines bring their own contours. This is the
// author's: lines of equal height every N metres over the land, an index line
// every fifth, on any look (the atlas, the Carta, the PNG export). Levels are
// worked out once per world revision and interval, in world cells, and drawn
// through the view's own projection.

import { chaikin, marchingSquares, simplify, type Contour } from './contours';
import type { WorldData } from '../core/types';

/** The intervals offered in the toolbar, in metres. */
export const CONTOUR_INTERVALS_M = [100, 200, 500, 1000] as const;
export const CONTOUR_INTERVAL_RANGE_M = { min: 50, max: 2000 } as const;
/** Never more lines than this, however small the interval: the top levels are dropped. */
const MAX_LEVELS = 60;

const CACHE = new WeakMap<WorldData, { rev: number; intervalM: number; levels: Contour[][] }>();

/** The contour polylines for each level (lowest first), in world-cell coordinates. */
export function contourLevels(world: WorldData, intervalM: number): Contour[][] {
  const rev = world.revision ?? 0;
  const hit = CACHE.get(world);
  if (hit && hit.rev === rev && hit.intervalM === intervalM) return hit.levels;
  let max = 0;
  for (const e of world.elevation) if (e > max) max = e;
  const step = intervalM / 1000;
  const levels: Contour[][] = [];
  for (let level = step; level < max && levels.length < MAX_LEVELS; level += step) {
    levels.push(marchingSquares(world.elevation, world.width, world.height, level, true));
  }
  CACHE.set(world, { rev, intervalM, levels });
  return levels;
}

/**
 * Draw the lines. `sx`/`sy` map world cells to canvas pixels and `k` is pixels
 * per cell; the sheet is repeated east and west so the lines continue across
 * the seam wherever the view shows another copy of the world.
 */
export function drawContourLines(
  ctx: CanvasRenderingContext2D,
  world: WorldData,
  intervalM: number,
  sx: (wx: number) => number,
  sy: (wy: number) => number,
  k: number,
  style: { color?: string; alpha?: number } = {},
): number {
  const levels = contourLevels(world, intervalM);
  const W = world.width, width = ctx.canvas.width, height = ctx.canvas.height;
  const x0 = sx(0), y0 = sy(0), span = W * k;
  // Raster samples sit at cell centres; marching squares works in sample indices.
  const px = (x: number) => x0 + (x + 0.5) * k, py = (y: number) => y0 + (y + 0.5) * k;
  const copies: number[] = [];
  for (let c = -2; c <= 2; c++) { const left = x0 + c * span; if (left < width && left + span > 0) copies.push(c * span); }
  let drawn = 0;
  ctx.save();
  ctx.strokeStyle = style.color ?? '#6b5a3e';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const [index, contours] of levels.entries()) {
    const major = (index + 1) % 5 === 0;
    ctx.globalAlpha = (style.alpha ?? 0.5) * (major ? 1 : 0.6);
    ctx.lineWidth = (major ? 1.3 : 0.7) * Math.max(0.8, Math.min(1.8, k / 6));
    for (const contour of contours) {
      if (contour.pts.length < 4) continue;
      const pts = chaikin(simplify(contour.pts.map((p) => ({ x: px(p.x), y: py(p.y) })), 0.3), contour.closed, 1);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
      if (maxY < 0 || minY > height) continue;
      for (const dx of copies) {
        if (maxX + dx < 0 || minX + dx > width) continue;
        ctx.beginPath(); ctx.moveTo(pts[0].x + dx, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + dx, pts[i].y);
        if (contour.closed) ctx.closePath();
        ctx.stroke();
        drawn++;
      }
    }
  }
  ctx.restore();
  return drawn;
}
