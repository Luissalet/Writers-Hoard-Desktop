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
  /** Held behind a dam on a slope (no hollow): its surface follows the ground, not one level. */
  dammed: boolean;
}

/** How far (in steps) the water may run down from the click to find its hollow. */
export const LAKE_DESCENT_MAX = 12;
/** The smallest pond a click makes on ground with no hollow. */
export const LAKE_MIN_CELLS = 4;
/** The default ceiling, scaled to the world's grid. */
export function defaultLakeMaxCells(world: Pick<WorldData, 'width' | 'height'>): number {
  return Math.max(16, Math.min(600, Math.round((world.width * world.height) / 4000)));
}

/**
 * Visit marks shared by the fills of one replay: one buffer for the whole edit
 * list instead of a world-sized array per lake, and nothing to clear between
 * lakes (each fill takes a new stamp).
 */
export interface LakeScratch { mark: Uint32Array; stamp: number }
export function lakeScratch(world: Pick<WorldData, 'width' | 'height'>): LakeScratch {
  return { mark: new Uint32Array(world.width * world.height), stamp: 0 };
}
function nextStamp(world: Pick<WorldData, 'width' | 'height'>, scratch?: LakeScratch): { mark: Uint32Array; stamp: number } {
  const s = scratch ?? lakeScratch(world);
  s.stamp += 1;
  if (s.stamp >= 0xffffffff) { s.mark.fill(0); s.stamp = 1; }
  return s;
}

/**
 * The lake that forms at (x, y), in world cells. The water first runs down to
 * the bottom of the hollow it is in (a few cells at most); from there it fills
 * until it spills — over dry ground, or straight into the sea, which makes a
 * lagoon — or reaches the cap. Where no hollow is that close, or the water runs
 * off into the sea or a lake first, the lake is dammed at the clicked spot
 * (`dammed`): the ground below the dam stays dry and the water rises up the
 * valley until the lake has `minCells`. A lake that would touch another lake is
 * refused (`lake`), and `nowhere` when the spot is sea or already a lake.
 */
export function fillLake(
  world: Pick<WorldData, 'width' | 'height' | 'elevation'> & { lake?: Uint8Array },
  x: number, y: number,
  options: { maxCells?: number; minCells?: number; scratch?: LakeScratch } = {},
): LakeFill {
  const W = world.width, H = world.height, elev = world.elevation, lake = world.lake;
  const minCells0 = Math.max(1, Math.floor(options.minCells ?? LAKE_MIN_CELLS));
  const maxCells = Math.max(minCells0, Math.floor(options.maxCells ?? defaultLakeMaxCells(world)));
  const minCells = Math.min(maxCells, minCells0);
  const sx = ((Math.floor(x) % W) + W) % W, sy = Math.min(H - 1, Math.max(0, Math.floor(y)));
  const clicked = sy * W + sx;
  if (elev[clicked] <= 0 || lake?.[clicked]) return { cells: [], level: 0, end: 'nowhere', dammed: false };
  // Down to the bottom of the hollow: steepest descent over dry land. Reaching the
  // sea or a lake means there is no hollow on this slope, so the lake is dammed
  // where the author clicked.
  // Only a short way, though: a lake that formed far down a long slope would not be
  // the one the author clicked for, so beyond that the lake is dammed at the click.
  let start = clicked, dammed = false, found = false;
  for (let step = 0; step < LAKE_DESCENT_MAX; step++) {
    const cx = start % W, cy = (start / W) | 0;
    let best = -1, bestE = elev[start];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      const j = ny * W + ((cx + dx + W) % W);
      if (elev[j] < bestE) { bestE = elev[j]; best = j; }
    }
    if (best < 0) { found = true; break; }
    if (elev[best] <= 0 || lake?.[best]) break;
    start = best;
  }
  if (!found) { start = clicked; dammed = true; }
  const { mark, stamp } = nextStamp(world, options.scratch);
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
  const cells: number[] = [];
  let level = -Infinity, end: LakeEnd = 'full';
  mark[start] = stamp; push(start);
  while (heap.length && cells.length < maxCells) {
    const i = heap[0];
    const e = elev[i];
    // The sea and other lakes never become this lake's water: below the water they
    // are where it spills (or what the dam holds back); otherwise the shore stops there.
    const wet = e <= 0 || !!lake?.[i];
    if (wet && e >= level) { end = e <= 0 ? 'sea' : 'lake'; break; }
    if (e < level) {
      // Lower than the water held: the hollow spills here once the lake is as big
      // as asked. Before that, the lower ground is behind a dam and stays dry, so
      // the water rises up the valley instead of running down it.
      if (cells.length >= minCells) { end = 'spill'; break; }
      dammed = true;
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
      if (mark[j] !== stamp) { mark[j] = stamp; push(j); }
    }
  }
  if (!heap.length && cells.length < maxCells) end = 'full';
  // Water that reaches the sea or another lake before it stands does not stand: it runs on.
  if (end === 'sea' || end === 'lake') return { cells: [], level: 0, end, dammed };
  // Two lakes touching are one lake with two levels: refused, the water joins the other.
  if (lake) for (const i of cells) {
    const cx = i % W, cy = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ny = cy + dy;
      if ((!dx && !dy) || ny < 0 || ny >= H) continue;
      if (lake[ny * W + ((cx + dx + W) % W)]) return { cells: [], level: 0, end: 'lake', dammed };
    }
  }
  return { cells, level: Math.max(level, 0.001), end, dammed };
}

/** The connected lake under (x, y), flat indices, for draining it; empty when there is none. */
export function lakeAt(world: Pick<WorldData, 'width' | 'height'> & { lake: Uint8Array }, x: number, y: number, scratch?: LakeScratch): number[] {
  const W = world.width, H = world.height, lake = world.lake;
  const sx = ((Math.floor(x) % W) + W) % W, sy = Math.min(H - 1, Math.max(0, Math.floor(y)));
  const first = sy * W + sx;
  if (!lake[first]) return [];
  const { mark, stamp } = nextStamp(world, scratch);
  const out = [first];
  mark[first] = stamp;
  for (let q = 0; q < out.length; q++) {
    const i = out[q], cx = i % W, cy = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      const j = ny * W + ((cx + dx + W) % W);
      if (lake[j] && mark[j] !== stamp) { mark[j] = stamp; out.push(j); }
    }
  }
  return out;
}
