// ============================================
// World history — borders in a given year
// ============================================
// Each place held that year spreads its holder's claim over a coarse grid of
// land cells, cheapest way first, as far as its rank carries: a capital
// further than a village. Where two claims meet, the cheaper wins, which puts
// borders on ridges and rivers of cost rather than on straight lines.

import { cellCost, MinHeap } from './ground';
import { ownerAt } from './simulate';
import type { HistoryInput, WorldHistory } from './types';

export interface TerritoryRaster {
  /** Grid cell size in world cells. */
  cell: number;
  gw: number;
  gh: number;
  /** Index into `polities` per grid cell, -1 unclaimed. */
  owner: Int16Array;
  /** Polity keys, in the order `owner` indexes them. */
  polities: string[];
  /** Where to letter each realm: the place it holds that weighs most. */
  labels: { polity: string; x: number; y: number }[];
}

const REACH: Record<string, number> = { capital: 22, city: 16, town: 11, village: 7, ruin: 13 };

export function territoryAt(input: HistoryInput, history: WorldHistory, year: number): TerritoryRaster {
  const { world } = input;
  const cell = Math.max(1, Math.ceil(world.width / 256));
  const gw = Math.ceil(world.width / cell), gh = Math.ceil(world.height / cell);
  const n = gw * gh;
  const cost = new Float32Array(n);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) cost[gy * gw + gx] = cellCost(world, gx * cell + cell / 2, gy * cell + cell / 2);

  const polities: string[] = [];
  const index = new Map<string, number>();
  const best = new Float32Array(n).fill(Infinity);
  const owner = new Int16Array(n).fill(-1);
  const heap = new MinHeap();
  const limitOf: number[] = [];
  const seedOwner: number[] = [];
  const labelAt = new Map<string, { x: number; y: number; w: number }>();
  const seeds: { key: string; x: number; y: number; rank: string; w: number }[] = [
    ...input.places.map((p) => ({ key: p.key, x: p.x, y: p.y, rank: input.realms.some((r) => r.capital === p.id) ? 'capital' : p.rank, w: Math.log10(1 + p.population) })),
    ...input.ruins.map((r) => ({ key: r.key, x: r.x, y: r.y, rank: 'ruin', w: 1 + r.importance })),
  ];
  for (const s of seeds) {
    const holder = ownerAt(history, s.key, year);
    if (!holder) continue;
    let pi = index.get(holder);
    if (pi === undefined) { pi = polities.length; polities.push(holder); index.set(holder, pi); }
    const gx = Math.min(gw - 1, Math.floor(s.x / cell)), gy = Math.min(gh - 1, Math.floor(s.y / cell));
    const g = gy * gw + gx;
    // A seed carries its own reach: the heap value packs the grid cell and the seed.
    const seedId = limitOf.length;
    if (seedId >= SEEDS_MAX) break;
    limitOf.push(REACH[s.rank] ?? 8);
    seedOwner.push(pi);
    heap.push(0, g * SEEDS_MAX + seedId);
    const lab = labelAt.get(holder);
    if (!lab || s.w > lab.w) labelAt.set(holder, { x: s.x, y: s.y, w: s.w });
  }
  // Multi-source spread. Cost units are grid cells of flat land.
  const settled = new Uint8Array(n);
  while (heap.size) {
    const v = heap.pop();
    const d = heap.lastPriority;
    const g = Math.floor(v / SEEDS_MAX), sid = v % SEEDS_MAX;
    if (settled[g]) continue;
    settled[g] = 1;
    best[g] = d;
    owner[g] = seedOwner[sid];
    const gx = g % gw, gy = (g - gx) / gw;
    for (let k = 0; k < 8; k++) {
      const dx = DX[k], dy = DY[k];
      let nx = gx + dx;
      const ny = gy + dy;
      if (ny < 0 || ny >= gh) continue;
      if (nx < 0 || nx >= gw) { if (!world.wrapX) continue; nx = (nx + gw) % gw; }
      const m = ny * gw + nx;
      if (settled[m] || !Number.isFinite(cost[m])) continue;
      const nd = d + cost[m] * (dx && dy ? Math.SQRT2 : 1);
      if (nd > limitOf[sid] || nd >= best[m]) continue;
      best[m] = nd;
      heap.push(nd, m * SEEDS_MAX + sid);
    }
  }
  const labels = [...labelAt.entries()].map(([polity, p]) => ({ polity, x: p.x, y: p.y }));
  return { cell, gw, gh, owner, polities, labels };
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const SEEDS_MAX = 8192;
