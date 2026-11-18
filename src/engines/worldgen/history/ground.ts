// ============================================
// World history — the ground between places
// ============================================
// How hard it is to cross the world from one place to another: open land is
// cheap, mountains dear, the sea dearer still unless both ends are harbours.
// The simulation moves armies and settlers along a sparse graph of places;
// the border raster spreads each realm's hold over a coarse grid of cells.

import type { HistoryWorld } from './types';

/** Cost of crossing one cell; Infinity for water. */
export function cellCost(world: HistoryWorld, x: number, y: number): number {
  const W = world.width, H = world.height;
  const cx = world.wrapX ? ((Math.floor(x) % W) + W) % W : Math.min(W - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(H - 1, Math.max(0, Math.floor(y)));
  const e = world.elevation[cy * W + cx];
  if (!(e > 0)) return Infinity;
  return 1 + Math.min(3, Math.max(0, (e - 0.6) * 1.2));
}

/** Signed shortest dx, round the seam when the world wraps. */
export function wrapDx(world: HistoryWorld, ax: number, bx: number): number {
  let dx = bx - ax;
  if (world.wrapX) {
    const W = world.width;
    if (dx > W / 2) dx -= W;
    else if (dx < -W / 2) dx += W;
  }
  return dx;
}

export interface GraphNode { key: string; x: number; y: number; port: boolean }
export interface PlaceGraph { edges: { to: number; cost: number }[][] }

/**
 * Each place joined to its nearest neighbours, the cost of the way between
 * them sampled along the straight line: 1 per cell over flat land, more over
 * mountains, 3 per cell over water (1.5 when both ends are ports).
 */
export function buildPlaceGraph(world: HistoryWorld, nodes: readonly GraphNode[], k = 6): PlaceGraph {
  const n = nodes.length;
  const edges: { to: number; cost: number }[][] = nodes.map(() => []);
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    const near: { j: number; d: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = wrapDx(world, a.x, nodes[j].x), dy = nodes[j].y - a.y;
      near.push({ j, d: Math.hypot(dx, dy) });
    }
    near.sort((p, q) => p.d - q.d || p.j - q.j);
    for (const { j, d } of near.slice(0, k)) {
      const id = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const b = nodes[j];
      const dx = wrapDx(world, a.x, b.x), dy = b.y - a.y;
      const samples = Math.max(2, Math.min(24, Math.ceil(d)));
      const sea = a.port && b.port ? 1.5 : 3;
      let sum = 0;
      for (let s = 0; s <= samples; s++) {
        const c = cellCost(world, a.x + 0.5 + (dx * s) / samples, a.y + 0.5 + (dy * s) / samples);
        sum += Number.isFinite(c) ? c : sea;
      }
      const cost = Math.max(0.5, (d * sum) / (samples + 1));
      edges[i].push({ to: j, cost });
      edges[j].push({ to: i, cost });
    }
  }
  return { edges };
}

/** A minimal binary heap of [priority, value] pairs. */
export class MinHeap {
  private pri: number[] = [];
  private val: number[] = [];
  get size(): number { return this.pri.length; }
  push(p: number, v: number): void {
    const pri = this.pri, val = this.val;
    let i = pri.length;
    pri.push(p); val.push(v);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up] <= p) break;
      pri[i] = pri[up]; val[i] = val[up];
      i = up;
    }
    pri[i] = p; val[i] = v;
  }
  /** Removes the smallest; returns its value and leaves its priority in `lastPriority`. */
  lastPriority = 0;
  pop(): number {
    const pri = this.pri, val = this.val;
    const top = val[0];
    this.lastPriority = pri[0];
    const p = pri.pop()!, v = val.pop()!;
    const n = pri.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mp = p;
        if (l < n && pri[l] < mp) { m = l; mp = pri[l]; }
        if (r < n && pri[r] < mp) { m = r; mp = pri[r]; }
        if (m === i) break;
        pri[i] = pri[m]; val[i] = val[m];
        i = m;
      }
      pri[i] = p; val[i] = v;
    }
    return top;
  }
}
