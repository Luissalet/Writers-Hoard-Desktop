// ============================================
// World Generator — the ways trade goes
// ============================================
// A road between two towns is not a ruler line. Where a bay lies between them
// the carts go round it by land, and where a river runs their way they follow
// its valley; a ship keeps to open water and rounds the headlands. These are
// the paths the trade lens draws and the land links the economy may use.
//
// Both searches are bounded: a window round the two ends (or a radius round
// one place), so a world of two hundred towns costs a fraction of a second.

import { Biome } from './types';

/** What a route needs of the world: its grid, where the open sea is and (optionally) where water flows. */
export interface RouteWorld {
  width: number;
  height: number;
  elevation: Float32Array;
  lake: Uint8Array;
  biome: Uint8Array;
  /** 0..1 drainage (log scale); a river valley is cheaper going. */
  flow?: Float32Array;
}

export interface RoutePoint { x: number; y: number }


const SQRT2 = Math.SQRT2;
const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Open sea: under water and neither a lake nor a lake biome. */
export function isOpenSea(world: RouteWorld, i: number): boolean {
  return world.elevation[i] <= 0 && world.lake[i] === 0 && world.biome[i] !== Biome.Lake;
}

/** A cell carts may cross: anything but the open sea. */
function landStep(world: RouteWorld, i: number): number {
  if (isOpenSea(world, i)) return Infinity;
  // Along a river: the valley floor is the easy way (towpaths, fords, flat ground).
  const f = world.flow ? world.flow[i] : 0;
  return f > 0.45 ? 0.6 : 1;
}

/** A cell a ship may cross: the open sea (and the two harbours at the ends). */
function seaStep(world: RouteWorld, i: number): number {
  return isOpenSea(world, i) ? 1 : Infinity;
}

/** A small binary heap of (cost, cell). */
class Heap {
  private c: number[] = [];
  private v: number[] = [];
  get size() { return this.c.length; }
  push(cost: number, cell: number) {
    const c = this.c, v = this.v;
    let i = c.length;
    c.push(cost); v.push(cell);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p]; v[i] = v[p]; i = p;
    }
    c[i] = cost; v[i] = cell;
  }
  pop(): [number, number] {
    const c = this.c, v = this.v;
    const top: [number, number] = [c[0], v[0]];
    const lc = c.pop()!, lv = v.pop()!;
    if (c.length) {
      let i = 0;
      const n = c.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mc = lc;
        if (l < n && c[l] < mc) { m = l; mc = c[l]; }
        if (r < n && c[r] < mc) { m = r; mc = c[r]; }
        if (m === i) break;
        c[i] = c[m]; v[i] = v[m]; i = m;
      }
      c[i] = lc; v[i] = lv;
    }
    return top;
  }
}

const wrapX = (x: number, w: number) => ((x % w) + w) % w;

/**
 * Cheapest path between two cells by land or by sea (points are cells, x
 * unwrapped from the start: it may run past the seam), inside a window of
 * `margin` cells round the two ends (x wraps round the world). Null when none
 * is shorter than `maxCost` (in cells, a river step counting 0.6).
 */
export function findRoute(
  world: RouteWorld, a: RoutePoint, b: RoutePoint, bySea: boolean, maxCost: number, margin = 24,
): RoutePoint[] | null {
  const W = world.width, H = world.height;
  const ax = wrapX(Math.floor(a.x), W), ay = Math.min(H - 1, Math.max(0, Math.floor(a.y)));
  const bxr = wrapX(Math.floor(b.x), W), by = Math.min(H - 1, Math.max(0, Math.floor(b.y)));
  let dx = bxr - ax;
  if (dx > W / 2) dx -= W;
  if (dx < -W / 2) dx += W;
  const bx = ax + dx;
  // The window, in unwrapped x.
  const x0 = Math.min(ax, bx) - margin, x1 = Math.max(ax, bx) + margin;
  const y0 = Math.max(0, Math.min(ay, by) - margin), y1 = Math.min(H - 1, Math.max(ay, by) + margin);
  const ww = Math.min(W, x1 - x0 + 1), wh = y1 - y0 + 1;
  const local = (x: number, y: number) => {
    let lx = x - x0;
    if (ww === W) lx = wrapX(lx, W);
    if (lx < 0 || lx >= ww || y < y0 || y > y1) return -1;
    return (y - y0) * ww + lx;
  };
  const cost = new Float64Array(ww * wh).fill(Infinity);
  const prev = new Int32Array(ww * wh).fill(-1);
  const start = local(ax, ay), goal = local(bx, by);
  if (start < 0 || goal < 0) return null;
  const step = bySea ? seaStep : landStep;
  const heap = new Heap();
  cost[start] = 0;
  heap.push(Math.hypot(bx - ax, by - ay), start);
  while (heap.size) {
    const [, cur] = heap.pop();
    if (cur === goal) break;
    const c = cost[cur];
    if (c > maxCost) continue;
    const cx = x0 + (cur % ww), cy = y0 + Math.floor(cur / ww);
    for (const [ox, oy, d] of NEIGHBOURS) {
      const nx = cx + ox, ny = cy + oy;
      const n = local(nx, ny);
      if (n < 0) continue;
      const gi = ny * W + wrapX(nx, W);
      // The two ends are always enterable: a harbour is on the shore, a town may sit by a lake.
      const s = n === goal ? 1 : step(world, gi);
      if (s === Infinity) continue;
      const nc = c + d * s;
      if (nc >= cost[n] || nc > maxCost) continue;
      cost[n] = nc; prev[n] = cur;
      // A* with the straight distance at the cheapest step (0.6), so it stays admissible.
      const hx = bx - nx, hy = by - ny;
      heap.push(nc + 0.6 * Math.hypot(hx, hy), n);
    }
  }
  if (!(cost[goal] < Infinity)) return null;
  const path: RoutePoint[] = [];
  for (let at = goal; at >= 0; at = prev[at]) {
    path.push({ x: x0 + (at % ww), y: y0 + Math.floor(at / ww) });
    if (at === start) break;
  }
  path.reverse();
  // A window as wide as the world folds at its edge: keep each step short so
  // the line round the seam does not jump the width of the map.
  for (let i = 1; i < path.length; i++) {
    while (path[i].x - path[i - 1].x > W / 2) path[i].x -= W;
    while (path[i].x - path[i - 1].x < -W / 2) path[i].x += W;
  }
  return path;
}

/** The path's length in cells (unwrapped). */
export function routeLength(path: readonly RoutePoint[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return n;
}

/** Fewer points for drawing: drops those within `tolerance` cells of the line they sit on (Douglas-Peucker). */
export function simplifyRoute(path: readonly RoutePoint[], tolerance = 0.8): RoutePoint[] {
  if (path.length <= 2) return path.slice();
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, path.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = path[i], b = path[j];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let far = -1, best = tolerance;
    for (let k = i + 1; k < j; k++) {
      const p = path[k];
      const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
      if (d > best) { best = d; far = k; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return path.filter((_, k) => keep[k]);
}

/**
 * A shipment's way on the map: by sea round the headlands, by land round the
 * bays and along the rivers; the straight line when no way is found within
 * reach (the lens then still shows who trades with whom).
 */
export function shipmentPath(world: RouteWorld, a: RoutePoint, b: RoutePoint, bySea: boolean): RoutePoint[] {
  const straight = Math.hypot(Math.min(Math.abs(b.x - a.x), world.width - Math.abs(b.x - a.x)), b.y - a.y);
  const margin = Math.max(8, Math.min(90, Math.round(straight * (bySea ? 0.8 : 0.5))));
  const found = findRoute(world, a, b, bySea, Math.max(12, straight * (bySea ? 3 : 2.2)), margin);
  if (!found) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  // Ends on the places themselves (cells, as places are), not on their cells' corners.
  found[0] = { x: found[0].x + (a.x - Math.floor(a.x)), y: a.y };
  const last = found.length - 1;
  found[last] = { x: found[last].x + (b.x - Math.floor(b.x)), y: b.y };
  return simplifyRoute(found);
}

/**
 * The places a town can reach by road within `radius` cells of going, round
 * bays and along rivers: one bounded search from the town; `reached(i)` tells
 * the cost to each cell (Infinity beyond reach or over the sea).
 */
export function landReach(world: RouteWorld, from: RoutePoint, radius: number): (x: number, y: number) => number {
  const W = world.width, H = world.height;
  const r = Math.ceil(radius) + 1;
  const ax = wrapX(Math.floor(from.x), W), ay = Math.min(H - 1, Math.max(0, Math.floor(from.y)));
  const x0 = ax - r, y0 = Math.max(0, ay - r), y1 = Math.min(H - 1, ay + r);
  const ww = Math.min(W, 2 * r + 1), wh = y1 - y0 + 1;
  const local = (x: number, y: number) => {
    let lx = x - x0;
    if (ww === W) lx = wrapX(lx, W);
    else { lx = wrapX(lx, W); if (lx >= ww) return -1; }
    if (y < y0 || y > y1) return -1;
    return (y - y0) * ww + lx;
  };
  const cost = new Float64Array(ww * wh).fill(Infinity);
  const start = local(ax, ay);
  const heap = new Heap();
  cost[start] = 0; heap.push(0, start);
  while (heap.size) {
    const [c, cur] = heap.pop();
    if (c > cost[cur]) continue;
    const cx = x0 + (cur % ww), cy = y0 + Math.floor(cur / ww);
    for (const [ox, oy, d] of NEIGHBOURS) {
      const nx = cx + ox, ny = cy + oy;
      const n = local(nx, ny);
      if (n < 0) continue;
      const s = landStep(world, ny * W + wrapX(nx, W));
      if (s === Infinity) continue;
      const nc = c + d * s;
      if (nc > radius || nc >= cost[n]) continue;
      cost[n] = nc; heap.push(nc, n);
    }
  }
  return (x: number, y: number) => {
    const n = local(Math.floor(x), Math.floor(y));
    return n < 0 ? Infinity : cost[n];
  };
}
