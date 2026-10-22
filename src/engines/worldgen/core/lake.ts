// ============================================
// World Generator — A lake that fills its hollow
// ============================================
// Click a spot and let the water rise: from the clicked cell the lake takes in
// the lowest ground around it, one cell at a time, until the next lowest cell
// is lower than the water (the hollow spills there), until it reaches the sea
// or another lake, or until it is as large as allowed. On a slope with no
// hollow the water is held as behind a dam: the ground below stays dry and the
// lake rises up the valley until it has the least size asked (a pond of a few
// cells by default).
// The cells become lake cells of the world (biome, shoreline, travel, trade),
// replayed from the edit list like any stroke.

import type { WorldData } from './types';

export type LakeEnd = 'spill' | 'sea' | 'lake' | 'full' | 'nowhere';
export interface LakeFill {
  /** Lake cells, flat indices. */
  cells: number[];
  /** Water surface, in the elevation field's own units (above sea level is > 0). */
  level: number;
  /** Why it stopped growing. */
  end: LakeEnd;
}

/** The smallest pond a click makes on ground with no hollow. */
export const LAKE_MIN_CELLS = 4;
/** The default ceiling, scaled to the world's grid. */
export function defaultLakeMaxCells(world: Pick<WorldData, 'width' | 'height'>): number {
  return Math.max(16, Math.min(600, Math.round((world.width * world.height) / 4000)));
}

/**
 * The lake that forms at (x, y), in world cells. `nowhere` when the spot is
 * sea or already a lake. `maxCells` caps it (default scaled to the grid).
 */
export function fillLake(
  world: Pick<WorldData, 'width' | 'height' | 'elevation'> & { lake?: Uint8Array },
  x: number, y: number,
  options: { maxCells?: number; minCells?: number } = {},
): LakeFill {
  const W = world.width, H = world.height, elev = world.elevation, lake = world.lake;
  const maxCells = Math.max(1, Math.floor(options.maxCells ?? defaultLakeMaxCells(world)));
  const minCells = Math.max(1, Math.min(maxCells, Math.floor(options.minCells ?? LAKE_MIN_CELLS)));
  const sx = ((Math.floor(x) % W) + W) % W, sy = Math.min(H - 1, Math.max(0, Math.floor(y)));
  const start = sy * W + sx;
  if (elev[start] <= 0 || lake?.[start]) return { cells: [], level: 0, end: 'nowhere' };
  // A min-heap of the shore: the next cell the water reaches is always the lowest one.
  const heap: number[] = [];
  const push = (i: number) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (elev[heap[p]] <= elev[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = (): number => {
    const top = heap[0], last = heap.pop() as number;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && elev[heap[l]] < elev[heap[m]]) m = l;
        if (r < heap.length && elev[heap[r]] < elev[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  const queued = new Uint8Array(W * H);
  const cells: number[] = [];
  let level = -Infinity, end: LakeEnd = 'full';
  queued[start] = 1; push(start);
  while (heap.length && cells.length < maxCells) {
    const i = heap[0];
    const e = elev[i];
    if (e <= 0) { end = 'sea'; break; }
    if (lake?.[i]) { end = 'lake'; break; }
    // Lower than the water already held: the hollow spills here once the lake is
    // as big as asked; before that the lower ground is behind a dam and stays dry,
    // so the water rises up the valley (and along the contour) instead of
    // running down it.
    if (e < level) {
      if (cells.length >= minCells) { end = 'spill'; break; }
      pop();
      continue;
    }
    pop();
    cells.push(i);
    if (e > level) level = e;
    const cx = i % W, cy = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      const j = ny * W + ((cx + dx + W) % W);
      if (!queued[j]) { queued[j] = 1; push(j); }
    }
  }
  if (!heap.length && cells.length < maxCells) end = 'full';
  // A lake that met the sea or another lake before it was a pond would only be a wet shore.
  if ((end === 'sea' || end === 'lake') && cells.length < minCells) return { cells: [], level: 0, end };
  return { cells, level: Math.max(level, 0.001), end };
}

/** The connected lake under (x, y), flat indices, for draining it; empty when there is none. */
export function lakeAt(world: Pick<WorldData, 'width' | 'height'> & { lake: Uint8Array }, x: number, y: number): number[] {
  const W = world.width, H = world.height, lake = world.lake;
  const sx = ((Math.floor(x) % W) + W) % W, sy = Math.min(H - 1, Math.max(0, Math.floor(y)));
  const start = sy * W + sx;
  if (!lake[start]) return [];
  const seen = new Uint8Array(W * H), out = [start];
  seen[start] = 1;
  for (let q = 0; q < out.length; q++) {
    const i = out[q], cx = i % W, cy = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      const j = ny * W + ((cx + dx + W) % W);
      if (lake[j] && !seen[j]) { seen[j] = 1; out.push(j); }
    }
  }
  return out;
}
