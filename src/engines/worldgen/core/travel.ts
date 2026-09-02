// ============================================
// World Generator — Travel and distance
// ============================================
// "How long does it take to get from here to there?" is the question a writer
// asks a map more often than any other, and no map generator answers it, because
// answering it needs the things a picture throws away: the gradient, the surface,
// the road, the river, the pass, the ice, and the season.
//
// All of that already exists in this world. This module spends it.
//
// The model is a least-TIME route, not a least-distance one, which is why its
// answers are interesting: the shortest way over a range is almost never the
// quickest, a road that goes round is usually faster than a track that goes
// through, and a river is either the best road in the country or an obstacle
// requiring a bridge, depending entirely on which way you are going.

import { Biome, type WorldData } from './types';
import type { HumanGeography } from './settlements';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type TravelMode = 'foot' | 'horse' | 'cart' | 'boat' | 'ship';

/**
 * CLAVES de catálogo, no texto. El motor no traduce: guarda la clave y quien
 * pinta la pasa por `t()` — las tablas `_ES` con español a fuego eran la única
 * parte del motor fuera de i18n (una UI en inglés decía «a caballo»).
 */
export const SEASON_KEY: Record<Season, string> = {
  spring: 'worldgen.travel.season.spring', summer: 'worldgen.travel.season.summer',
  autumn: 'worldgen.travel.season.autumn', winter: 'worldgen.travel.season.winter',
};
export const MODE_KEY: Record<TravelMode, string> = {
  foot: 'worldgen.travel.mode.foot', horse: 'worldgen.travel.mode.horse',
  cart: 'worldgen.travel.mode.cart', boat: 'worldgen.travel.mode.boat',
  ship: 'worldgen.travel.mode.ship',
};

export interface TravelOptions {
  mode: TravelMode;
  season: Season;
  /**
   * Places the journey must pass through, in order.
   *
   * Routed leg by leg rather than as one search, because "go by way of X" is a
   * constraint on the route and not a hint to the cost function — a single
   * search with a bonus near X finds a route that goes NEAR X, which is a
   * different journey and, for a novel, the wrong one.
   */
  via?: { x: number; y: number }[];
  /** Hours of travel per day. Left undefined, it follows the season. */
  hoursPerDay?: number;
  /** Planet radius, for honest distances. */
  planetRadiusKm?: number;
}

export interface RouteLeg {
  /** What the party is crossing here. */
  terrain: string;
  km: number;
  hours: number;
  onRoad: boolean;
}

/**
 * Where one day of travelling ends.
 *
 * This is the answer a writer is actually after. "Nine days" is a number;
 * "the fourth night is in the open, on the moor, eleven kilometres short of
 * Kaldvik" is a scene. Everything else in this module exists to be able to say
 * that sentence.
 */
export interface RouteStage {
  /** 1 for the first night. */
  night: number;
  x: number;
  y: number;
  km: number;
  hours: number;
  /** Nearest named place, and how far off the route it is. */
  nearest?: { name: string; kind: string; km: number };
  /** True when the nearest shelter is too far to reach — camping out. */
  rough: boolean;
  /** What the ground is here. */
  terrain: string;
}

export interface Route {
  /** World cell indices, start → end. */
  cells: number[];
  km: number;
  hours: number;
  days: number;
  /** Straight-line distance, for the "and the crow flies X" line. */
  directKm: number;
  legs: RouteLeg[];
  /** Rivers and straits the route has to get across. */
  crossings: { x: number; y: number; kind: 'river' | 'strait' | 'pass'; name?: string }[];
  /** Fraction of the distance travelled on a made road. */
  roadFraction: number;
  /** Where each night falls. */
  stages: RouteStage[];
  /** Realms the route passes through, in order. */
  realms: string[];
  /** Highest and lowest ground on the way, in metres. */
  highestM: number;
  lowestM: number;
  /** Total climb, which is what actually tires a party out. */
  ascentM: number;
  /** Set when no route exists for this mode — a cart cannot cross an ocean. */
  impossible?: string;
}

// ---------------------------------------------------------------------------
// The physics of getting about
// ---------------------------------------------------------------------------

/**
 * Base speed in km per hour of actual travelling.
 *
 * These are not guesses. A marching army makes about 3 km/h and 25–30 km a day;
 * a courier changing horses makes 100 km a day and exhausts the horses; an
 * ox-cart on a made road makes 2 km/h and cannot leave the road at all. The
 * numbers below are the sustained rates for a party that expects to arrive.
 */
const BASE_KMH: Record<TravelMode, { road: number; off: number }> = {
  foot: { road: 4.0, off: 2.8 },
  horse: { road: 7.0, off: 4.6 },
  cart: { road: 3.6, off: 1.5 },
  boat: { road: 5.5, off: 5.5 },
  ship: { road: 8.0, off: 8.0 },
};

/** Daylight a party can actually use. */
const SEASON_HOURS: Record<Season, number> = {
  spring: 10, summer: 11, autumn: 9, winter: 7,
};

export interface StraightLineEstimate {
  mode: TravelMode;
  /** Hours on the move, at the mode's ROAD pace over the crow-flies distance. */
  hours: number;
  /** The daylight the season allows, so the caller can say it in days. */
  hoursPerDay: number;
}

/**
 * How long a straight line takes — the ruler's answer, not the planner's.
 *
 * The 2D ruler measures between any two points, so there is no route, no
 * gradient and no surface to spend: the honest figure is the distance at the
 * pace a made road allows, which is the OPTIMISTIC bound a real journey never
 * beats. It lives here, next to `BASE_KMH`, so the ruler and the planner can
 * never disagree about how fast a horse goes — the two are read side by side,
 * and "9 days by the planner, 6 by the ruler" is a conversation the reader
 * should be able to have by looking at the road fraction, not at two tables.
 *
 * Boats are left out: a river boat cannot follow a straight line at all, and a
 * ship's straight line over land is not a crossing. The order is the order of
 * the planner's mode list, so the two readouts stack the same way.
 */
export function straightLineEstimates(km: number, season: Season = 'summer'): StraightLineEstimate[] {
  const d = Math.max(0, km);
  const hoursPerDay = SEASON_HOURS[season];
  return (['foot', 'horse', 'cart', 'ship'] as const).map((mode) => ({
    mode, hours: d / BASE_KMH[mode].road, hoursPerDay,
  }));
}

/**
 * How much slower the ground is than open grass.
 *
 * Marsh is the one people always underestimate: crossing a fen is three to five
 * times the effort of crossing a meadow, which is why the roads go round and why
 * a map that ignores it sends every route straight through the Fens.
 */
const BIOME_DRAG: Partial<Record<number, number>> = {
  [Biome.Marsh]: 3.6, [Biome.PeatBog]: 3.4, [Biome.SaltMarsh]: 3.2, [Biome.Mangrove]: 4.6,
  [Biome.TropicalRainforest]: 3.2, [Biome.CloudForest]: 3.0, [Biome.Bamboo]: 2.6,
  [Biome.TemperateRainforest]: 2.1, [Biome.MonsoonForest]: 2.2,
  [Biome.TropicalForest]: 2.2, [Biome.BorealForest]: 1.9, [Biome.MontaneForest]: 2.0,
  [Biome.TemperateForest]: 1.6, [Biome.RiparianForest]: 1.7, [Biome.Karst]: 2.6,
  [Biome.Erg]: 3.0, [Biome.Desert]: 1.9, [Biome.Reg]: 1.5, [Biome.Badlands]: 2.8,
  [Biome.SaltFlat]: 1.3, [Biome.FogDesert]: 1.7, [Biome.ThornScrub]: 2.3,
  [Biome.Chaparral]: 1.8, [Biome.Shrubland]: 1.4, [Biome.Moor]: 1.9, [Biome.Tundra]: 1.7, [Biome.Puna]: 1.8,
  [Biome.Alpine]: 3.2, [Biome.Glacier]: 4.5, [Biome.IceCap]: 4.0,
  [Biome.Volcanic]: 3.0, [Biome.AshPlain]: 1.8,
  [Biome.Grassland]: 1.0, [Biome.Savanna]: 1.1, [Biome.Steppe]: 1.05,
  [Biome.AlpineMeadow]: 1.3, [Biome.Beach]: 1.3, [Biome.ColdDesert]: 1.4,
};

const TERRAIN_ES: Partial<Record<number, string>> = {
  [Biome.Ocean]: 'mar', [Biome.Lake]: 'lago', [Biome.Marsh]: 'marisma',
  [Biome.PeatBog]: 'turbera', [Biome.SaltMarsh]: 'marisma salada',
  [Biome.Mangrove]: 'manglar', [Biome.TropicalRainforest]: 'selva',
  [Biome.TropicalForest]: 'bosque tropical', [Biome.MonsoonForest]: 'bosque monzónico',
  [Biome.CloudForest]: 'bosque nuboso', [Biome.TemperateForest]: 'bosque',
  [Biome.TemperateRainforest]: 'bosque húmedo', [Biome.BorealForest]: 'taiga',
  [Biome.MontaneForest]: 'bosque de montaña', [Biome.RiparianForest]: 'soto',
  [Biome.Grassland]: 'pradera', [Biome.Savanna]: 'sabana', [Biome.Steppe]: 'estepa',
  [Biome.Shrubland]: 'matorral', [Biome.Chaparral]: 'monte mediterráneo',
  [Biome.ThornScrub]: 'espinar', [Biome.Moor]: 'páramo', [Biome.Tundra]: 'tundra',
  [Biome.Desert]: 'desierto', [Biome.Erg]: 'mar de arena', [Biome.Reg]: 'pedregal',
  [Biome.Badlands]: 'cárcavas', [Biome.ColdDesert]: 'desierto frío',
  [Biome.SaltFlat]: 'salar', [Biome.FogDesert]: 'desierto de niebla',
  [Biome.Alpine]: 'roquedo', [Biome.AlpineMeadow]: 'pastos de altura',
  [Biome.Glacier]: 'glaciar', [Biome.IceCap]: 'casquete', [Biome.Beach]: 'playa',
  [Biome.Puna]: 'puna', [Biome.Volcanic]: 'malpaís', [Biome.AshPlain]: 'llano de ceniza',
  [Biome.Karst]: 'karst', [Biome.Bamboo]: 'bambú',
};

const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

class Heap {
  private key: Float64Array;
  private val: Int32Array;
  private n = 0;
  constructor(cap: number) { this.key = new Float64Array(cap); this.val = new Int32Array(cap); }
  get size(): number { return this.n; }
  push(k: number, v: number): void {
    if (this.n >= this.key.length) {
      const nk = new Float64Array(this.key.length * 2), nv = new Int32Array(this.val.length * 2);
      nk.set(this.key); nv.set(this.val); this.key = nk; this.val = nv;
    }
    let i = this.n++;
    this.key[i] = k; this.val[i] = v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key[p] <= this.key[i]) break;
      const tk = this.key[p]; this.key[p] = this.key[i]; this.key[i] = tk;
      const tv = this.val[p]; this.val[p] = this.val[i]; this.val[i] = tv;
      i = p;
    }
  }
  pop(): number {
    const top = this.val[0];
    this.n--;
    if (this.n > 0) {
      this.key[0] = this.key[this.n]; this.val[0] = this.val[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.key[l] < this.key[m]) m = l;
        if (r < this.n && this.key[r] < this.key[m]) m = r;
        if (m === i) break;
        const tk = this.key[m]; this.key[m] = this.key[i]; this.key[i] = tk;
        const tv = this.val[m]; this.val[m] = this.val[i]; this.val[i] = tv;
        i = m;
      }
    }
    return top;
  }
}

/** Road membership per cell, cached per geography. */
const ROAD_CACHE = new WeakMap<HumanGeography, Uint8Array>();
function roadMask(world: WorldData, geo: HumanGeography): Uint8Array {
  const hit = ROAD_CACHE.get(geo);
  if (hit && hit.length === world.width * world.height) return hit;
  const m = new Uint8Array(world.width * world.height);
  for (const r of geo.roads) for (const c of r.cells) m[c] = r.major ? 2 : 1;
  ROAD_CACHE.set(geo, m);
  return m;
}

/**
 * Winter is not a modifier on a number; it is a different map.
 *
 * Rivers freeze and become roads. Passes close. Marsh becomes the best going in
 * the county because it is solid for the first time all year. Getting this right
 * is most of what makes a seasonal answer worth asking for, and it is why the
 * season is baked into the cost rather than applied to the total afterwards.
 */
function seasonFactor(world: WorldData, i: number, season: Season, biome: number): number {
  const t = world.temperature[i];
  if (season === 'winter') {
    const winterT = t - 9;
    if (winterT < -12) return 2.2;                     // deep snow, everything stops
    if (winterT < -2) {
      // Frozen ground: marsh and bog are easier than in any other season.
      if (biome === Biome.Marsh || biome === Biome.PeatBog || biome === Biome.SaltMarsh) return 0.42;
      return 1.45;
    }
    return 1.2;
  }
  if (season === 'spring') {
    // The mud. Thaw plus rain is the reason medieval campaigns started in May.
    const wet = world.precipitation[i] > 800 || t < 10;
    return wet ? 1.4 : 1.12;
  }
  if (season === 'autumn') return world.precipitation[i] > 900 ? 1.25 : 1.05;
  // Summer: fast, unless the problem is heat and no water.
  return world.precipitation[i] < 200 && t > 26 ? 1.3 : 1;
}

export interface TravelCostInfo {
  /** Hours to cross one cell, or Infinity when the mode cannot pass. */
  hours: number;
  onRoad: boolean;
}

function cellCost(
  world: WorldData, roads: Uint8Array,
  from: number, to: number, kmPerCell: number, diagonal: boolean, opts: TravelOptions,
): TravelCostInfo {
  const b = world.biome[to];
  const sea = world.elevation[to] <= 0 && b === Biome.Ocean;
  const mode = opts.mode;
  const km = kmPerCell * (diagonal ? Math.SQRT2 : 1)
    // East-west cells shrink toward the poles; ignoring it makes polar journeys
    // twice as long as they are.
    * (diagonal ? 1 : 1) * lonScale(world, to, from);

  if (mode === 'ship') {
    if (!sea) return { hours: Infinity, onRoad: false };
    // Ice closes the northern route in winter, which is a real and dramatic fact
    // about a world and exactly the sort of thing a plot turns on.
    const ice = world.ice[to] * (opts.season === 'winter' ? 1.5 : 0.65);
    if (ice > 0.55) return { hours: Infinity, onRoad: false };
    // Currents: worth up to about a third of a ship's speed either way.
    const dx = ((to % world.width) - (from % world.width) + world.width * 1.5) % world.width - world.width * 0.5;
    const dy = ((to / world.width) | 0) - ((from / world.width) | 0);
    const len = Math.hypot(dx, dy) || 1;
    const along = (world.currentU[to] * dx + world.currentV[to] * dy) / len;
    const help = Math.max(0.62, Math.min(1.5, 1 + along * 0.42));
    const drag = 1 + ice * 1.6;
    return { hours: km / (BASE_KMH.ship.road * help / drag), onRoad: false };
  }

  if (sea) return { hours: Infinity, onRoad: false };

  if (mode === 'boat') {
    // A boat needs water under it: a real river, a lake, or the coast.
    const navigable = world.flow[to] > 0.62 || world.lake[to] === 1 || nearSea(world, to);
    if (!navigable) return { hours: Infinity, onRoad: false };
    if (opts.season === 'winter' && world.temperature[to] - 9 < -6) {
      return { hours: Infinity, onRoad: false };       // frozen solid
    }
    // Downstream is fast, upstream is a haul. Elevation decides which.
    const downhill = world.elevation[to] < world.elevation[from];
    const kmh = BASE_KMH.boat.road * (downhill ? 1.45 : 0.62);
    return { hours: km / kmh, onRoad: false };
  }

  const road = roads[to] > 0 && roads[from] > 0;
  if (mode === 'cart' && !road) {
    // Not forbidden — just very slow, so a cart will go a long way round to stay
    // on a road, which is the correct behaviour and produces the correct answer.
    const drag = (BIOME_DRAG[b] ?? 1.5) * 2.2;
    const grade = gradePenalty(world, from, to, kmPerCell);
    if (grade > 4) return { hours: Infinity, onRoad: false };
    const kmh = BASE_KMH.cart.off / (drag * grade * seasonFactor(world, to, opts.season, b));
    return { hours: km / kmh, onRoad: false };
  }

  const drag = road ? (roads[to] === 2 ? 1 : 1.12) : (BIOME_DRAG[b] ?? 1.4);
  const grade = gradePenalty(world, from, to, kmPerCell);
  const base = road ? BASE_KMH[mode].road : BASE_KMH[mode].off;
  const kmh = base / (drag * grade * seasonFactor(world, to, opts.season, b));
  return { hours: km / kmh, onRoad: road };
}

function lonScale(world: WorldData, to: number, from: number): number {
  const y = (to / world.width) | 0;
  const sameRow = ((from / world.width) | 0) === y;
  if (!sameRow) return 1;
  const lat = (0.5 - (y + 0.5) / world.height) * Math.PI;
  return Math.max(0.08, Math.cos(lat));
}

/**
 * Tobler's hiking function, in spirit: gentle uphill is nearly free, steep
 * uphill is brutal, and steep DOWNHILL is also slow — which is the part every
 * naive cost model gets wrong and the part that makes routes descend by the
 * spur instead of straight off the cliff.
 */
function gradePenalty(world: WorldData, from: number, to: number, kmPerCell: number): number {
  const dz = (world.elevation[to] - world.elevation[from]) * 1000;
  const slope = dz / (kmPerCell * 1000);
  const a = Math.abs(slope);
  if (a < 0.03) return 1;
  const up = slope > 0;
  if (a > 0.45) return up ? 9 : 5;
  const k = up ? 6.5 : 3.4;
  return 1 + a * k + a * a * (up ? 22 : 10);
}

function nearSea(world: WorldData, i: number): boolean {
  const W = world.width, H = world.height;
  const x = i % W, y = (i / W) | 0;
  for (let k = 0; k < 8; k++) {
    const nx = ((x + DX8[k]) % W + W) % W, ny = y + DY8[k];
    if (ny < 0 || ny >= H) continue;
    if (world.elevation[ny * W + nx] <= 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

/**
 * Least-time route between two cells.
 *
 * A* rather than Dijkstra, because a two-million-cell grid searched blind takes
 * long enough that the reader stops believing the map is thinking. The heuristic
 * is straight-line distance divided by the fastest speed the mode can ever
 * reach, which is admissible by construction: nothing can arrive sooner than
 * that, so the route found is genuinely optimal and not merely plausible.
 */
export function planRoute(
  world: WorldData,
  geo: HumanGeography,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: TravelOptions,
): Route {
  // "By way of X" is a chain of journeys, not one journey with a hint. Each leg
  // is solved on its own and the results are welded; a single search with a
  // bonus near X produces a route that passes NEAR X, which is not what anybody
  // meant by it.
  if (opts.via && opts.via.length) {
    const points = [from, ...opts.via, to];
    const legsOut: Route[] = [];
    for (let k = 0; k < points.length - 1; k++) {
      const leg = planRoute(world, geo, points[k], points[k + 1], { ...opts, via: undefined });
      if (leg.impossible) return leg;
      legsOut.push(leg);
    }
    return weldRoutes(world, geo, legsOut, opts);
  }
  const W = world.width, H = world.height, N = W * H;
  const kmPerCell = (2 * Math.PI * (opts.planetRadiusKm ?? 6371)) / W;
  const roads = roadMask(world, geo);

  const idx = (x: number, y: number) => Math.min(H - 1, Math.max(0, Math.round(y))) * W
    + (((Math.round(x) % W) + W) % W);
  const start = idx(from.x, from.y);
  const goal = idx(to.x, to.y);

  const gx = goal % W, gy = (goal / W) | 0;
  const fastest = Math.max(BASE_KMH[opts.mode].road, BASE_KMH[opts.mode].off);
  const heur = (i: number) => {
    const x = i % W, y = (i / W) | 0;
    let dx = Math.abs(x - gx);
    if (dx > W / 2) dx = W - dx;
    return (Math.hypot(dx, y - gy) * kmPerCell) / fastest;
  };

  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new Heap(1 << 16);
  dist[start] = 0;
  heap.push(heur(start), start);

  let found = false;
  let expanded = 0;
  while (heap.size > 0) {
    const i = heap.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) { found = true; break; }
    if (expanded++ > N * 2) break;
    const x = i % W, y = (i / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = ((x + DX8[k]) % W + W) % W;
      const ny = y + DY8[k];
      if (ny < 0 || ny >= H) continue;
      const j = ny * W + nx;
      if (closed[j]) continue;
      const c = cellCost(world, roads, i, j, kmPerCell, (k & 1) === 1, opts);
      if (!isFinite(c.hours)) continue;
      const nd = dist[i] + c.hours;
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        heap.push(nd + heur(j), j);
      }
    }
  }

  const directKm = greatCircleKm(world, start, goal, opts.planetRadiusKm ?? 6371);
  if (!found) {
    return {
      cells: [], km: 0, hours: 0, days: 0, directKm, legs: [], crossings: [],
      roadFraction: 0, stages: [], realms: [], highestM: 0, lowestM: 0, ascentM: 0,
      impossible: opts.mode === 'ship' ? 'no hay ruta de mar entre esos dos puntos'
        : opts.mode === 'boat' ? 'no hay vía de agua continua entre esos dos puntos'
          : opts.mode === 'cart' ? 'un carro no puede llegar hasta allí'
            : 'no hay ruta transitable entre esos dos puntos',
    };
  }

  const cells: number[] = [];
  for (let i = goal; i >= 0; i = prev[i]) {
    cells.push(i);
    if (prev[i] === -1) break;
  }
  cells.reverse();

  // ---- summarise ----------------------------------------------------------
  const legs: RouteLeg[] = [];
  const crossings: Route['crossings'] = [];
  let km = 0, roadKm = 0;
  let cur: RouteLeg | null = null;
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1], b = cells[k];
    const diag = Math.abs((a % W) - (b % W)) === 1 && Math.abs(((a / W) | 0) - ((b / W) | 0)) === 1;
    const c = cellCost(world, roads, a, b, kmPerCell, diag, opts);
    const segKm = kmPerCell * (diag ? Math.SQRT2 : 1) * lonScale(world, b, a);
    km += segKm;
    if (c.onRoad) roadKm += segKm;
    const label = c.onRoad ? 'calzada' : (TERRAIN_ES[world.biome[b]] ?? 'campo abierto');
    if (cur && cur.terrain === label && cur.onRoad === c.onRoad) {
      cur.km += segKm;
      cur.hours += c.hours;
    } else {
      cur = { terrain: label, km: segKm, hours: c.hours, onRoad: c.onRoad };
      legs.push(cur);
    }
    // A river crossed off-road is a ford or a ferry, and it is the kind of thing
    // that turns up in a chapter.
    if (opts.mode !== 'boat' && opts.mode !== 'ship' && world.flow[b] > 0.7 && world.flow[a] <= 0.7) {
      crossings.push({ x: b % W, y: (b / W) | 0, kind: 'river' });
    }
  }

  const hours = dist[goal];
  const hpd = opts.hoursPerDay ?? SEASON_HOURS[opts.season];
  const profile = elevationProfile(world, cells);
  return {
    cells,
    km,
    hours,
    days: hours / hpd,
    directKm,
    // Legs shorter than a couple of kilometres are noise in a summary the reader
    // is going to read aloud; fold them into their neighbours.
    legs: mergeSmallLegs(legs, km * 0.04),
    crossings,
    roadFraction: km > 0 ? roadKm / km : 0,
    stages: findStages(world, geo, roads, cells, kmPerCell, hpd, opts),
    realms: realmsAlong(world, geo, cells),
    ...profile,
  };
}

/**
 * Split the route into days and name where each night falls.
 *
 * Walked forward accumulating the SAME per-cell hours the router used, so the
 * stages are consistent with the total by construction rather than by dividing
 * the distance — dividing would put a night in the middle of a mountain pass
 * that the party would in fact have hurried to get out of.
 */
function findStages(
  world: WorldData, geo: HumanGeography, roads: Uint8Array,
  cells: number[], kmPerCell: number, hoursPerDay: number, opts: TravelOptions,
): RouteStage[] {
  const W = world.width;
  const out: RouteStage[] = [];
  if (cells.length < 2) return out;

  const shelters: { x: number; y: number; name: string; kind: string }[] = [];
  for (const s of geo.settlements) shelters.push({ x: s.x, y: s.y, name: s.name, kind: s.rank });
  for (const r of geo.ruins) shelters.push({ x: r.x, y: r.y, name: r.name, kind: 'ruina' });

  let acc = 0, accKm = 0, night = 1;
  for (let k = 1; k < cells.length && night < 400; k++) {
    const a = cells[k - 1], b = cells[k];
    const diag = Math.abs((a % W) - (b % W)) === 1 && Math.abs(((a / W) | 0) - ((b / W) | 0)) === 1;
    const c = cellCost(world, roads, a, b, kmPerCell, diag, opts);
    if (!isFinite(c.hours)) continue;
    const stepKm = kmPerCell * (diag ? Math.SQRT2 : 1) * lonScale(world, b, a);

    // A world cell is FORTY KILOMETRES, which at walking pace is most of a day.
    // Cutting the day only at cell boundaries therefore reported nights 94 km
    // apart — two days' walking called one — so a step that overruns the day is
    // split along its own length, and a step long enough to hold several days
    // yields several nights.
    let done = 0;
    while (acc + c.hours * (1 - done) >= hoursPerDay) {
      const need = hoursPerDay - acc;
      const f = done + need / c.hours;
      const ax = a % W, ay = (a / W) | 0;
      let dx = (b % W) - ax;
      if (dx > W / 2) dx -= W;
      if (dx < -W / 2) dx += W;
      const x = ((ax + dx * f) % W + W) % W;
      const y = ay + (((b / W) | 0) - ay) * f;
      accKm += stepKm * (f - done);

      let best: { name: string; kind: string; km: number } | undefined;
      for (const sh of shelters) {
        let sdx = Math.abs(sh.x - x);
        if (sdx > W / 2) sdx = W - sdx;
        const d = Math.hypot(sdx, sh.y - y) * kmPerCell;
        if (!best || d < best.km) best = { name: sh.name, kind: sh.kind, km: d };
      }

      // Whether the night has a roof over it is NOT the distance to the nearest
      // town on the world map. A world map at 40 km per cell shows perhaps
      // ninety places on a whole planet; the villages, hamlets and inns a
      // traveller actually sleeps in live one scale down and are not in this
      // data. Asking "is this settled country" — on a road, inside a realm — is
      // the question the available data can honestly answer, and the answer that
      // matters: on the king's road you find a bed, on the moor you do not.
      const ci = Math.min(world.height - 1, Math.max(0, Math.round(y))) * W + Math.round(x) % W;
      const onRoad = roads[ci] > 0;
      const inRealm = geo.realmOf[ci] >= 0;
      const roofKm = opts.mode === 'horse' ? 8 : 5;
      const rough = !(best && best.km <= roofKm) && !(onRoad && inRealm);

      out.push({
        night: night++,
        x, y,
        km: accKm,
        hours: hoursPerDay,
        nearest: best,
        rough,
        terrain: onRoad ? 'la calzada' : (TERRAIN_ES[world.biome[ci]] ?? 'campo abierto'),
      });
      acc = 0;
      accKm = 0;
      done = f;
      if (done >= 1) break;
    }
    acc += c.hours * (1 - done);
    accKm += stepKm * (1 - done);
  }
  return out;
}


/** Which realms the route passes through, in order, without repeats. */
function realmsAlong(world: WorldData, geo: HumanGeography, cells: number[]): string[] {
  const out: string[] = [];
  let last = -2;
  for (let k = 0; k < cells.length; k += 3) {
    const id = geo.realmOf[cells[k]];
    if (id === last) continue;
    last = id;
    const r = geo.realms.find((q) => q.id === id);
    if (r && out[out.length - 1] !== r.name) out.push(r.name);
  }
  void world;
  return out;
}

function elevationProfile(
  world: WorldData, cells: number[],
): { highestM: number; lowestM: number; ascentM: number } {
  let hi = -Infinity, lo = Infinity, up = 0;
  for (let k = 0; k < cells.length; k++) {
    const e = world.elevation[cells[k]] * 1000;
    if (e > hi) hi = e;
    if (e < lo) lo = e;
    if (k > 0) {
      const d = e - world.elevation[cells[k - 1]] * 1000;
      // Only climbs of more than a metre count, or grid noise inflates the total
      // by an order of magnitude and the number stops meaning anything.
      if (d > 1) up += d;
    }
  }
  return {
    highestM: isFinite(hi) ? hi : 0,
    lowestM: isFinite(lo) ? lo : 0,
    ascentM: up,
  };
}

/**
 * Turn a run-length list of legs into a summary a person would say out loud.
 *
 * Two steps, and the second one matters: first the slivers are folded into their
 * neighbours, then everything is totalled BY TERRAIN. Without the totalling the
 * summary lists "road" four times because the route touched a marsh twice, which
 * is true and useless — the reader wants "nine hundred kilometres of road and a
 * hundred of fen", not a turn-by-turn.
 */
/** Join consecutive legs into one journey, without double-counting the joints. */
function weldRoutes(
  world: WorldData, geo: HumanGeography, parts: Route[], opts: TravelOptions,
): Route {
  const cells: number[] = [];
  for (const p of parts) {
    for (let k = cells.length ? 1 : 0; k < p.cells.length; k++) cells.push(p.cells[k]);
  }
  const hpd = opts.hoursPerDay ?? SEASON_HOURS[opts.season];
  const km = parts.reduce((a, p) => a + p.km, 0);
  const hours = parts.reduce((a, p) => a + p.hours, 0);
  const roadKm = parts.reduce((a, p) => a + p.km * p.roadFraction, 0);
  const legs = mergeSmallLegs(parts.flatMap((p) => p.legs), km * 0.04);
  // The stages are recomputed over the WHOLE journey rather than concatenated:
  // a night does not fall at a waypoint just because the route happened to be
  // solved in pieces there.
  const kmPerCell = (2 * Math.PI * (opts.planetRadiusKm ?? 6371)) / world.width;
  const stages = findStages(world, geo, roadMask(world, geo), cells, kmPerCell, hpd, opts);
  const profile = elevationProfile(world, cells);
  const realms: string[] = [];
  for (const p of parts) for (const n of p.realms) if (realms[realms.length - 1] !== n) realms.push(n);
  return {
    cells, km, hours, days: hours / hpd,
    directKm: parts.reduce((a, p) => a + p.directKm, 0),
    legs,
    crossings: parts.flatMap((p) => p.crossings),
    roadFraction: km > 0 ? roadKm / km : 0,
    stages,
    realms,
    ...profile,
  };
}

function mergeSmallLegs(legs: RouteLeg[], minKm: number): RouteLeg[] {
  const run: RouteLeg[] = [];
  for (const l of legs) {
    const last = run[run.length - 1];
    if (last && l.km < minKm) { last.km += l.km; last.hours += l.hours; continue; }
    run.push({ ...l });
  }
  const byTerrain = new Map<string, RouteLeg>();
  for (const l of run) {
    const key = `${l.terrain}|${l.onRoad}`;
    const hit = byTerrain.get(key);
    if (hit) { hit.km += l.km; hit.hours += l.hours; } else byTerrain.set(key, { ...l });
  }
  return [...byTerrain.values()].sort((a, b) => b.km - a.km);
}

function greatCircleKm(world: WorldData, a: number, b: number, radiusKm: number): number {
  const W = world.width, H = world.height;
  const toRad = (i: number) => ({
    lon: ((i % W) / W) * Math.PI * 2,
    lat: (0.5 - (((i / W) | 0) + 0.5) / H) * Math.PI,
  });
  const p = toRad(a), q = toRad(b);
  const d = Math.acos(Math.min(1, Math.max(-1,
    Math.sin(p.lat) * Math.sin(q.lat) + Math.cos(p.lat) * Math.cos(q.lat) * Math.cos(p.lon - q.lon))));
  return d * radiusKm;
}

/** "4 días y 3 horas", the way a person would say it. */
export function describeDuration(
  hours: number,
  hoursPerDay: number,
  // La frase entera sale del catálogo (lección #8: nada de gramática
  // concatenada alrededor de un fragmento traducido). El separador decimal
  // también es del catálogo: «1,5 h» en español, "1.5 h" en inglés.
  t: (key: string) => string,
): string {
  if (hours < 1) return t('worldgen.travel.dur.min').replace('{n}', String(Math.round(hours * 60)));
  if (hours < hoursPerDay) {
    return t('worldgen.travel.dur.hours')
      .replace('{n}', hours.toFixed(1).replace('.', t('worldgen.travel.dur.decimal')));
  }
  const days = Math.floor(hours / hoursPerDay);
  const rest = hours - days * hoursPerDay;
  const d = t(days === 1 ? 'worldgen.travel.dur.days.one' : 'worldgen.travel.dur.days.many')
    .replace('{n}', String(days));
  if (rest < 0.6) return d;
  return t('worldgen.travel.dur.daysAnd').replace('{d}', d).replace('{h}', String(Math.round(rest)));
}

/** Every mode and season at once — the table a writer actually wants. */
export function travelTable(
  world: WorldData, geo: HumanGeography,
  from: { x: number; y: number }, to: { x: number; y: number },
  modes: TravelMode[] = ['foot', 'horse', 'cart'],
  seasons: Season[] = ['summer', 'winter'],
): { mode: TravelMode; season: Season; route: Route }[] {
  const out: { mode: TravelMode; season: Season; route: Route }[] = [];
  for (const mode of modes) {
    for (const season of seasons) {
      out.push({ mode, season, route: planRoute(world, geo, from, to, { mode, season }) });
    }
  }
  return out;
}
