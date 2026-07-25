// ============================================
// World Generator — Human geography
// ============================================
// Where people live, how they get between places, who claims what, and what
// every notable piece of the map is called. Runs after the physical pipeline
// and depends only on its outputs, so it is cheap to regenerate and equally
// deterministic.
//
// Settlement siting follows the factors that actually decided medieval town
// locations: fresh water first, then a usable harbour, then arable land, then
// defensibility — weighted, not ranked, because a great harbour beats mediocre
// soil and vice versa.

import { Biome, type WorldData } from './types';
import { createRng, type Rng } from './rng';
import { cultureMap, NameRegistry, type CultureId, type FeatureKind } from './naming';

export type SettlementRank = 'capital' | 'city' | 'town' | 'village';

export interface Settlement {
  id: number;
  /** Cell coordinates. */
  x: number;
  y: number;
  name: string;
  culture: CultureId;
  rank: SettlementRank;
  population: number;
  /** Sits on the coast with a sheltered approach. */
  port: boolean;
  /** Sits on a named river. */
  river: boolean;
  /** Index into `realms`, or -1. */
  realm: number;
  score: number;
}

export interface Road {
  /** Cell indices along the route. */
  cells: number[];
  /** Trade artery between major settlements, versus a local track. */
  major: boolean;
}

export interface Realm {
  id: number;
  name: string;
  capital: number;
  culture: CultureId;
  /** Deterministic hue 0–360 for the political overlay. */
  hue: number;
  cellCount: number;
}

export interface NamedFeature {
  kind: FeatureKind;
  name: string;
  /** Label anchor in cell coordinates — the pole of inaccessibility. */
  x: number;
  y: number;
  /** Rough extent in cells, used to size the label. */
  extent: number;
  /** Label orientation in radians, from the region's principal axis. */
  angle: number;
  /** Cells belonging to the feature, for path labels. */
  cells?: number[];
  importance: number;
}

export interface HumanGeography {
  settlements: Settlement[];
  roads: Road[];
  realms: Realm[];
  /** Realm id per cell, -1 for unclaimed/water. */
  realmOf: Int32Array;
  features: NamedFeature[];
}

export interface HumanGeographyParams {
  /** Multiplies the number of settlements. */
  settlementDensity: number;
  /** Number of independent realms to grow. */
  realmCount: number;
  /** How many distinct language groups populate the world. */
  cultureCount: number;
}

export const DEFAULT_HUMAN_PARAMS: HumanGeographyParams = {
  settlementDensity: 1,
  realmCount: 7,
  cultureCount: 6,
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Connected components over a predicate, 8-connected, wrapping in x. */
function components(
  W: number,
  H: number,
  pass: (i: number) => boolean,
  minSize: number,
): number[][] {
  const seen = new Uint8Array(W * H);
  const out: number[][] = [];
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !pass(s)) continue;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    const cells: number[] = [];
    while (sp > 0) {
      const i = stack[--sp];
      cells.push(i);
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const n = yy * W + ((x + dx + W) % W);
          if (seen[n] || !pass(n)) continue;
          seen[n] = 1;
          stack[sp++] = n;
        }
      }
    }
    if (cells.length >= minSize) out.push(cells);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Label anchor + orientation for a region. The anchor is the interior cell
 * furthest from the region's edge (a discrete pole of inaccessibility — the
 * centroid of a crescent-shaped region falls outside it, which is exactly the
 * case where a label goes wrong). The angle comes from a PCA of the cells, so
 * a long thin range gets a label that runs along it.
 */
function regionAnchor(cells: number[], W: number, H: number): { x: number; y: number; angle: number; extent: number } {
  const set = new Set(cells);
  // Multi-source BFS inward from the boundary.
  let frontier: number[] = [];
  const depth = new Map<number, number>();
  for (const i of cells) {
    const x = i % W, y = (i / W) | 0;
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) { edge = true; break; }
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (!set.has(yy * W + ((x + dx + W) % W))) { edge = true; break; }
      }
    }
    if (edge) { depth.set(i, 0); frontier.push(i); }
  }
  let maxDepth = 0, anchor = cells[0];
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const d = depth.get(i)!;
      if (d > maxDepth) { maxDepth = d; anchor = i; }
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const n = yy * W + ((x + dx + W) % W);
          if (!set.has(n) || depth.has(n)) continue;
          depth.set(n, d + 1);
          next.push(n);
        }
      }
    }
    frontier = next;
  }

  // PCA for the principal axis. Unwrap x around the anchor so a region
  // straddling the seam does not produce a meaningless axis.
  const ax = anchor % W;
  let mx = 0, my = 0;
  const xs: number[] = [], ys: number[] = [];
  for (const i of cells) {
    let x = i % W;
    if (x - ax > W / 2) x -= W;
    if (x - ax < -W / 2) x += W;
    const y = (i / W) | 0;
    xs.push(x); ys.push(y);
    mx += x; my += y;
  }
  mx /= cells.length; my /= cells.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (let k = 0; k < xs.length; k++) {
    const dx = xs[k] - mx, dy = ys[k] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const extent = 2 * Math.sqrt(Math.max(sxx, syy) / cells.length);
  return { x: ((anchor % W) + W) % W, y: (anchor / W) | 0, angle, extent };
}

/** Binary min-heap keyed by number, storing cell indices. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number { return this.vals.length; }
  push(key: number, val: number): void {
    this.keys.push(key); this.vals.push(val);
    let i = this.vals.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      [this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]];
      [this.vals[p], this.vals[i]] = [this.vals[i], this.vals[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.vals[0];
    const lastK = this.keys.pop()!, lastV = this.vals.pop()!;
    if (this.vals.length) {
      this.keys[0] = lastK; this.vals[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.vals.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.vals.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        [this.keys[m], this.keys[i]] = [this.keys[i], this.keys[m]];
        [this.vals[m], this.vals[i]] = [this.vals[i], this.vals[m]];
        i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function buildHumanGeography(
  world: WorldData,
  params: HumanGeographyParams = DEFAULT_HUMAN_PARAMS,
): HumanGeography {
  const { width: W, height: H, elevation, biome, temperature, precipitation, flow, lake } = world;
  const seed = world.params.seed;
  const rng = createRng(seed, 'human');
  const registry = new NameRegistry(seed);
  const { cultureAt } = cultureMap(seed, W, H, params.cultureCount);

  // ---- coastal / river proximity -----------------------------------------
  const coastal = new Uint8Array(W * H);
  const riverine = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (elevation[i] <= 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const n = yy * W + ((x + dx + W) % W);
          if (elevation[n] <= 0) coastal[i] = 1;
        }
      }
    }
  }
  for (const r of world.rivers) {
    for (let k = 0; k < r.cells.length; k++) {
      const c = r.cells[k];
      const strength = r.flow * (0.35 + 0.65 * (k / r.cells.length));
      const x = c % W, y = (c / W) | 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const n = yy * W + ((x + dx + W) % W);
          const fall = 1 - Math.hypot(dx, dy) / 3;
          if (fall > 0) riverine[n] = Math.max(riverine[n], strength * fall);
        }
      }
    }
  }

  // ---- site suitability ---------------------------------------------------
  const ARABLE: Partial<Record<number, number>> = {
    [Biome.Grassland]: 1, [Biome.TemperateForest]: 0.9, [Biome.Savanna]: 0.7,
    [Biome.TemperateRainforest]: 0.65, [Biome.Shrubland]: 0.55, [Biome.TropicalForest]: 0.6,
    [Biome.BorealForest]: 0.4, [Biome.TropicalRainforest]: 0.35, [Biome.Beach]: 0.4,
    [Biome.ColdDesert]: 0.12, [Biome.Tundra]: 0.1, [Biome.Desert]: 0.06,
    [Biome.Alpine]: 0.05, [Biome.SaltFlat]: 0.02,
  };

  const score = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elevation[i];
      if (e <= 0 || lake[i]) continue;
      const b = biome[i];
      if (b === Biome.IceCap || b === Biome.Glacier) continue;

      const water = Math.min(1, riverine[i] * 2.4) * 0.9 + (coastal[i] ? 0.5 : 0);
      if (water < 0.06) continue; // nobody founds a town with no water at all

      const arable = ARABLE[b] ?? 0.3;
      const T = temperature[i];
      const climate = Math.exp(-Math.pow((T - 13) / 17, 2));
      const rain = Math.min(1, precipitation[i] / 900);

      // Slope: gentle ground is buildable, a little relief is defensible, a
      // cliff is neither.
      const slope = Math.abs(elevation[i + 1 <= y * W + W - 1 ? i + 1 : i] - elevation[i - 1 >= y * W ? i - 1 : i])
        + Math.abs(elevation[i + W] - elevation[i - W]);
      const buildable = Math.exp(-slope * 3.2);
      const defensible = Math.min(1, slope * 2.5) * 0.18;

      const altitude = Math.exp(-Math.max(0, e - 1.2) * 1.1);
      const harbour = coastal[i] ? 0.55 + Math.min(0.45, flow[i] * 0.8) : 0;

      score[i] =
        water * 1.5 +
        arable * 1.15 * rain +
        climate * 0.85 +
        buildable * 0.6 +
        defensible +
        altitude * 0.45 +
        harbour * 0.7;
    }
  }

  // ---- pick sites with rank-dependent spacing -----------------------------
  const targetTotal = Math.round(
    Math.min(260, Math.max(24, (W * H) / 5200) * params.settlementDensity),
  );
  const order: number[] = [];
  for (let i = 0; i < W * H; i++) if (score[i] > 0.35) order.push(i);
  order.sort((a, b) => score[b] - score[a]);

  const settlements: Settlement[] = [];
  const minSpacing = Math.max(6, Math.sqrt((W * H) / Math.max(1, targetTotal)) * 0.55);
  const grid = new Map<string, Settlement[]>();
  const cellSize = Math.max(4, Math.round(minSpacing * 2));
  const gkey = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;

  const spacingFor = (rank: SettlementRank) =>
    rank === 'capital' ? minSpacing * 3.4 : rank === 'city' ? minSpacing * 2.1 : rank === 'town' ? minSpacing * 1.25 : minSpacing * 0.72;

  for (const i of order) {
    if (settlements.length >= targetTotal) break;
    const x = i % W, y = (i / W) | 0;
    // Rank by position in the sorted list — a Zipf-ish hierarchy where a few
    // dominant sites become cities and the long tail becomes villages.
    const q = settlements.length / targetTotal;
    const rank: SettlementRank = q < 0.05 ? 'capital' : q < 0.16 ? 'city' : q < 0.45 ? 'town' : 'village';
    const need = spacingFor(rank);

    let blocked = false;
    const span = Math.ceil(need / cellSize);
    for (let dy = -span; dy <= span && !blocked; dy++) {
      for (let dx = -span; dx <= span && !blocked; dx++) {
        const bucket = grid.get(gkey(x + dx * cellSize, y + dy * cellSize));
        if (!bucket) continue;
        for (const s of bucket) {
          let ddx = Math.abs(s.x - x);
          if (ddx > W / 2) ddx = W - ddx;
          const ddy = s.y - y;
          const other = spacingFor(s.rank);
          const req = Math.max(need, other) * 0.75;
          if (ddx * ddx + ddy * ddy < req * req) { blocked = true; break; }
        }
      }
    }
    if (blocked) continue;

    const culture = cultureAt(x, y);
    const port = coastal[i] === 1 && (rank === 'capital' || rank === 'city' || rng() < 0.75);
    const onRiver = riverine[i] > 0.12;
    const basePop = rank === 'capital' ? 26000 : rank === 'city' ? 9000 : rank === 'town' ? 2200 : 420;
    const s: Settlement = {
      id: settlements.length,
      x, y,
      name: '',
      culture,
      rank,
      population: Math.round(basePop * (0.6 + rng() * 0.95) * (port ? 1.25 : 1)),
      port,
      river: onRiver,
      realm: -1,
      score: score[i],
    };
    s.name = registry.take(`s${s.id}`, {
      culture,
      kind: rank === 'capital' ? 'capital' : 'settlement',
    });
    settlements.push(s);
    const k = gkey(x, y);
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push(s);
  }

  // ---- realms -------------------------------------------------------------
  const { realms, realmOf } = growRealms(world, settlements, params, registry, rng);
  for (const s of settlements) s.realm = realmOf[s.y * W + s.x];

  // ---- roads --------------------------------------------------------------
  const roads = buildRoads(world, settlements, coastal);

  // ---- named geography ----------------------------------------------------
  const features = nameGeography(world, registry, cultureAt);

  return { settlements, roads, realms, realmOf, features };
}

// ---------------------------------------------------------------------------
// Realms
// ---------------------------------------------------------------------------

function growRealms(
  world: WorldData,
  settlements: Settlement[],
  params: HumanGeographyParams,
  registry: NameRegistry,
  rng: Rng,
): { realms: Realm[]; realmOf: Int32Array } {
  const { width: W, height: H, elevation, biome } = world;
  const realmOf = new Int32Array(W * H).fill(-1);
  const capitals = settlements.filter((s) => s.rank === 'capital').slice(0, params.realmCount);
  const realms: Realm[] = capitals.map((c, idx) => ({
    id: idx,
    name: registry.take(`realm${idx}`, { culture: c.culture, kind: 'realm' }),
    capital: c.id,
    culture: c.culture,
    hue: Math.round((idx * 137.508 + rng() * 20) % 360),
    cellCount: 0,
  }));
  if (!realms.length) return { realms, realmOf };

  // Cost-based flood fill: expansion is cheap over farmland, expensive over
  // mountains and deserts, so borders settle onto ridges and wastes the way
  // real ones do.
  const cost = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] <= 0) { cost[i] = -1; continue; }
    const b = biome[i];
    let c = 1;
    if (b === Biome.Desert || b === Biome.SaltFlat) c = 4.5;
    else if (b === Biome.Alpine || b === Biome.Glacier || b === Biome.IceCap) c = 6;
    else if (b === Biome.Tundra || b === Biome.ColdDesert) c = 3;
    else if (b === Biome.TropicalRainforest) c = 2.2;
    cost[i] = c * (1 + Math.max(0, elevation[i]) * 0.7);
  }

  const dist = new Float32Array(W * H).fill(Infinity);
  const heap = new Heap();
  capitals.forEach((c, idx) => {
    const i = c.y * W + c.x;
    dist[i] = 0;
    realmOf[i] = idx;
    heap.push(0, i);
  });
  while (heap.size) {
    const i = heap.pop();
    const d = dist[i];
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = yy * W + ((x + dx + W) % W);
        if (cost[n] < 0) continue;
        const step = cost[n] * (dx && dy ? 1.414 : 1);
        const nd = d + step;
        // Cap the reach so a lone capital does not swallow an empty hemisphere.
        if (nd > 190 || nd >= dist[n]) continue;
        dist[n] = nd;
        realmOf[n] = realmOf[i];
        heap.push(nd, n);
      }
    }
  }
  for (let i = 0; i < W * H; i++) if (realmOf[i] >= 0) realms[realmOf[i]].cellCount++;
  return { realms, realmOf };
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

function buildRoads(world: WorldData, settlements: Settlement[], coastal: Uint8Array): Road[] {
  const { width: W, height: H, elevation, biome, lake } = world;
  if (settlements.length < 2) return [];

  // Travel cost. Slope dominates — medieval roads followed valleys and passes,
  // they did not go over ridges.
  const base = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (elevation[i] <= 0 || lake[i]) { base[i] = -1; continue; }
      const xr = y * W + ((x + 1) % W), xl = y * W + ((x - 1 + W) % W);
      const yd = Math.min(H - 1, y + 1) * W + x, yu = Math.max(0, y - 1) * W + x;
      const slope = Math.abs(elevation[xr] - elevation[xl]) + Math.abs(elevation[yd] - elevation[yu]);
      const b = biome[i];
      let terrain = 1;
      if (b === Biome.Desert || b === Biome.SaltFlat) terrain = 2.4;
      else if (b === Biome.TropicalRainforest) terrain = 2.6;
      else if (b === Biome.Alpine || b === Biome.Glacier || b === Biome.IceCap) terrain = 4;
      else if (b === Biome.Tundra) terrain = 1.8;
      else if (b === Biome.BorealForest) terrain = 1.6;
      else if (b === Biome.Grassland || b === Biome.Savanna) terrain = 0.85;
      base[i] = terrain + slope * 26 + (coastal[i] ? -0.12 : 0);
    }
  }
  // Discount accumulates on used cells so later routes merge into earlier ones
  // rather than running parallel — the classic "highway erosion" trick.
  const used = new Float32Array(W * H);

  const roads: Road[] = [];
  const pairs: [number, number, number][] = [];
  for (let a = 0; a < settlements.length; a++) {
    const A = settlements[a];
    const near: [number, number][] = [];
    for (let b = 0; b < settlements.length; b++) {
      if (a === b) continue;
      const B = settlements[b];
      let dx = Math.abs(A.x - B.x);
      if (dx > W / 2) dx = W - dx;
      const dy = A.y - B.y;
      near.push([dx * dx + dy * dy, b]);
    }
    near.sort((p, q) => p[0] - q[0]);
    const links = A.rank === 'capital' ? 4 : A.rank === 'city' ? 3 : 2;
    for (let k = 0; k < Math.min(links, near.length); k++) {
      const b = near[k][1];
      if (a < b) pairs.push([a, b, near[k][0]]);
      else pairs.push([b, a, near[k][0]]);
    }
  }
  // Deduplicate, and run the important links first so the trunk network exists
  // before the local tracks try to merge into it.
  const seenPair = new Set<string>();
  const unique = pairs.filter((p) => {
    const k = `${p[0]}-${p[1]}`;
    if (seenPair.has(k)) return false;
    seenPair.add(k);
    return true;
  });
  const weight = (s: Settlement) => (s.rank === 'capital' ? 3 : s.rank === 'city' ? 2 : s.rank === 'town' ? 1 : 0);
  unique.sort((p, q) => {
    const wp = weight(settlements[p[0]]) + weight(settlements[p[1]]);
    const wq = weight(settlements[q[0]]) + weight(settlements[q[1]]);
    return wq - wp || p[2] - q[2];
  });

  const maxDist = Math.min(W * 0.28, 260);
  for (const [a, b, d2] of unique) {
    if (Math.sqrt(d2) > maxDist) continue;
    const A = settlements[a], B = settlements[b];
    const path = aStar(base, used, W, H, A.y * W + A.x, B.y * W + B.x);
    if (!path) continue;
    for (const c of path) used[c] = Math.min(0.82, used[c] + 0.55);
    const major = weight(A) + weight(B) >= 4;
    roads.push({ cells: path, major });
  }
  return roads;
}

function aStar(
  base: Float32Array,
  used: Float32Array,
  W: number,
  H: number,
  start: number,
  goal: number,
): number[] | null {
  const gScore = new Float32Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const gx = goal % W, gy = (goal / W) | 0;
  const heuristic = (i: number) => {
    let dx = Math.abs((i % W) - gx);
    if (dx > W / 2) dx = W - dx;
    const dy = ((i / W) | 0) - gy;
    return Math.hypot(dx, dy) * 0.85;
  };
  const heap = new Heap();
  gScore[start] = 0;
  heap.push(heuristic(start), start);
  let expansions = 0;
  const limit = 400_000;

  while (heap.size) {
    const i = heap.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) break;
    if (++expansions > limit) return null;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = yy * W + ((x + dx + W) % W);
        if (closed[n] || base[n] < 0) continue;
        const step = base[n] * (1 - used[n]) * (dx && dy ? 1.414 : 1);
        const ng = gScore[i] + step;
        if (ng >= gScore[n]) continue;
        gScore[n] = ng;
        came[n] = i;
        heap.push(ng + heuristic(n), n);
      }
    }
  }
  if (came[goal] < 0 && goal !== start) return null;
  const path: number[] = [];
  let cur = goal;
  let guard = 0;
  while (cur >= 0 && guard++ < W * H) {
    path.push(cur);
    if (cur === start) break;
    cur = came[cur];
  }
  return path.reverse();
}

// ---------------------------------------------------------------------------
// Named geography
// ---------------------------------------------------------------------------

const FOREST_SET = new Set<number>([
  Biome.BorealForest, Biome.TemperateForest, Biome.TemperateRainforest,
  Biome.TropicalForest, Biome.TropicalRainforest,
]);

function nameGeography(
  world: WorldData,
  registry: NameRegistry,
  cultureAt: (x: number, y: number) => CultureId,
): NamedFeature[] {
  const { width: W, height: H, elevation, biome, lake } = world;
  const out: NamedFeature[] = [];
  const total = W * H;

  const add = (kind: FeatureKind, cells: number[], importance: number) => {
    const a = regionAnchor(cells, W, H);
    out.push({
      kind,
      name: registry.take(`${kind}:${a.x},${a.y}`, { culture: cultureAt(a.x, a.y), kind }),
      x: a.x, y: a.y,
      extent: a.extent,
      angle: a.angle,
      importance,
    });
  };

  // Continents and isles.
  const lands = components(W, H, (i) => elevation[i] > 0, Math.round(total * 0.0006));
  lands.forEach((cells, idx) => {
    const frac = cells.length / total;
    if (frac > 0.012) add('continent', cells, 1 - idx * 0.05);
    else if (idx < 26) add('isle', cells, 0.35 - idx * 0.01);
  });

  // Open water: the largest bodies are oceans, the enclosed ones seas.
  const waters = components(W, H, (i) => elevation[i] <= 0, Math.round(total * 0.002));
  waters.forEach((cells, idx) => {
    const frac = cells.length / total;
    add(frac > 0.1 ? 'ocean' : 'sea', cells, 0.9 - idx * 0.06);
  });

  // Mountain ranges: high ground with real local relief, grouped.
  const highs: number[] = [];
  for (let i = 0; i < total; i++) if (elevation[i] > 1.35) highs.push(i);
  const highSet = new Set(highs);
  const ranges = components(W, H, (i) => highSet.has(i), Math.round(total * 0.0009));
  ranges.slice(0, 22).forEach((cells, idx) => add('range', cells, 0.8 - idx * 0.02));

  // Named peaks: the top of each of the biggest ranges.
  ranges.slice(0, 10).forEach((cells) => {
    let best = cells[0];
    for (const c of cells) if (elevation[c] > elevation[best]) best = c;
    const x = best % W, y = (best / W) | 0;
    out.push({
      kind: 'peak',
      name: registry.take(`peak:${x},${y}`, { culture: cultureAt(x, y), kind: 'peak' }),
      x, y, extent: 3, angle: 0, importance: 0.55,
    });
  });

  const forests = components(W, H, (i) => elevation[i] > 0 && FOREST_SET.has(biome[i]), Math.round(total * 0.0018));
  forests.slice(0, 26).forEach((cells, idx) => add('forest', cells, 0.6 - idx * 0.015));

  const deserts = components(
    W, H,
    (i) => elevation[i] > 0 && (biome[i] === Biome.Desert || biome[i] === Biome.SaltFlat),
    Math.round(total * 0.0018),
  );
  deserts.slice(0, 14).forEach((cells, idx) => add('desert', cells, 0.6 - idx * 0.02));

  const plains = components(
    W, H,
    (i) => elevation[i] > 0 && (biome[i] === Biome.Grassland || biome[i] === Biome.Savanna),
    Math.round(total * 0.0026),
  );
  plains.slice(0, 14).forEach((cells, idx) => add('plain', cells, 0.45 - idx * 0.02));

  const lakes = components(W, H, (i) => lake[i] === 1, Math.round(total * 0.00012));
  lakes.slice(0, 18).forEach((cells, idx) => add('lake', cells, 0.5 - idx * 0.02));

  // Rivers get path labels, so they carry their cells with them.
  const byFlow = world.rivers.slice().sort((a, b) => b.flow - a.flow);
  byFlow.slice(0, 26).forEach((r, idx) => {
    const mid = r.cells[Math.floor(r.cells.length * 0.55)];
    const x = mid % W, y = (mid / W) | 0;
    out.push({
      kind: 'river',
      name: registry.take(`river:${x},${y}`, { culture: cultureAt(x, y), kind: 'river' }),
      x, y,
      extent: r.cells.length,
      angle: 0,
      cells: Array.from(r.cells),
      importance: 0.5 + r.flow * 0.4 - idx * 0.008,
    });
  });

  return out;
}
