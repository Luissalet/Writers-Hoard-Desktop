// ============================================
// World Generator — Contour lines at the author's interval
// ============================================
// The themes that draw relief by lines bring their own contours. This is the
// author's: lines of equal height every N metres over the land, an index line
// every fifth, on any look (the atlas, the Carta, the PNG export). Levels are
// worked out once per shape of the ground and interval, smoothed once in
// world cells, and only projected and culled when drawn, so a pan costs a
// projection per point and nothing more.

import { chaikin, marchingSquares, simplify, type Pt } from './contours';
import type { WorldData } from '../core/types';

/** The intervals offered in the toolbar, in metres. */
export const CONTOUR_INTERVALS_M = [100, 200, 500, 1000] as const;
export const CONTOUR_INTERVAL_RANGE_M = { min: 50, max: 2000 } as const;
/** Never more lines than this, however small the interval: the top levels are dropped. */
const MAX_LEVELS = 60;

export interface ContourLine { pts: Pt[]; closed: boolean; minX: number; maxX: number; minY: number; maxY: number }

/**
 * A cheap fingerprint of the heights: a label, a marker or a story event bumps
 * the world's revision without moving the ground, and must not cost sixty
 * marching-squares passes.
 */
function groundPrint(world: WorldData): number {
  const e = world.elevation;
  let h = e.length;
  const step = Math.max(1, Math.floor(e.length / 4096));
  for (let i = 0; i < e.length; i += step) h = (h * 31 + Math.round(e[i] * 1e4)) | 0;
  return h;
}

const CACHE = new WeakMap<WorldData, { rev: number; print: number; intervalM: number; levels: ContourLine[][] }>();

/** The smoothed contour polylines for each level (lowest first), in world-cell coordinates (cell centres). */
export function contourLevels(world: WorldData, intervalM: number): ContourLine[][] {
  const rev = world.revision ?? 0;
  const hit = CACHE.get(world);
  if (hit && hit.intervalM === intervalM && (hit.rev === rev || hit.print === groundPrint(world))) {
    hit.rev = rev;
    return hit.levels;
  }
  let max = 0;
  for (const e of world.elevation) if (e > max) max = e;
  const step = intervalM / 1000;
  const levels: ContourLine[][] = [];
  for (let level = step; level < max && levels.length < MAX_LEVELS; level += step) {
    levels.push(marchingSquares(world.elevation, world.width, world.height, level, true)
      .filter((c) => c.pts.length >= 4)
      .map((c) => {
        // Raster samples sit at cell centres; marching squares works in sample indices.
        const pts = chaikin(simplify(c.pts.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })), 0.05), c.closed, 1);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
        return { pts, closed: c.closed, minX, maxX, minY, maxY };
      }));
  }
  CACHE.set(world, { rev, print: groundPrint(world), intervalM, levels });
  return levels;
}

/**
 * Draw the lines. `sx`/`sy` map world cells to canvas pixels (`sy` may be any
 * monotonic projection of the row, as Mercator's is); `k` is pixels per cell
 * across. The sheet is repeated east and west so the lines continue across the
 * seam wherever the view shows another copy of the world.
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
  const x0 = sx(0), span = W * k;
  const copies: number[] = [];
  for (let c = -2; c <= 2; c++) { const left = x0 + c * span; if (left < width && left + span > 0) copies.push(c * span); }
  let drawn = 0;
  ctx.save();
  ctx.strokeStyle = style.color ?? '#6b5a3e';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const [index, lines] of levels.entries()) {
    const major = (index + 1) % 5 === 0;
    ctx.globalAlpha = (style.alpha ?? 0.5) * (major ? 1 : 0.6);
    ctx.lineWidth = (major ? 1.3 : 0.7) * Math.max(0.8, Math.min(1.8, k / 6));
    for (const line of lines) {
      const top = sy(line.minY), bottom = sy(line.maxY);
      if (Math.max(top, bottom) < 0 || Math.min(top, bottom) > height) continue;
      for (const dx of copies) {
        const left = x0 + line.minX * k + dx, right = x0 + line.maxX * k + dx;
        if (right < 0 || left > width) continue;
        ctx.beginPath();
        ctx.moveTo(x0 + line.pts[0].x * k + dx, sy(line.pts[0].y));
        for (let i = 1; i < line.pts.length; i++) ctx.lineTo(x0 + line.pts[i].x * k + dx, sy(line.pts[i].y));
        if (line.closed) ctx.closePath();
        ctx.stroke();
        drawn++;
      }
    }
  }
  ctx.restore();
  return drawn;
}
