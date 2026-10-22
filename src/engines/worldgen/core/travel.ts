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
import { riverKey } from './edits';
import { englishRoute } from './travelText';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type TravelMode = 'foot' | 'horse' | 'cart' | 'boat' | 'ship';

/** Only facts consumed by route planning; excludes language functions and naming registries. */
export interface TravelGeography {
  roads: { cells: number[]; major: boolean }[];
  settlements: { x: number; y: number; name: string; rank: string }[];
  ruins: { x: number; y: number; name: string }[];
  realms: { id: number; name: string }[];
  realmOf: Int32Array;
}


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
  /**
   * How hard the party pushes: easy keeps long rests, hard rides like a
   * messenger and needs a rest day every few days. Absent = steady, as before.
   */
  pace?: TravelPace;
  /** One mode per leg between consecutive stops; missing entries use `mode`. */
  legModes?: TravelMode[];
  /** The author's own speeds and ground costs; absent = the built-in physics. */
  profile?: TravelProfile;
  /** Planet radius, for honest distances. */
  planetRadiusKm?: number;
  /** Clock hour the party sets off each day (0–23); presentation only, the route does not change. */
  setOffHour?: number;
  /**
   * Laying out a road rather than travelling: the builders bridge the rivers
   * they meet, so no time is lost at fords and a closed crossing does not stop them.
   */
  building?: boolean;
}

export type TravelPace = 'easy' | 'steady' | 'hard';
export const TRAVEL_PACES: TravelPace[] = ['easy', 'steady', 'hard'];
/** Share of the day's usable hours actually spent moving. */
export const PACE_HOURS: Record<TravelPace, number> = { easy: 0.75, steady: 1, hard: 1.3 };
/**
 * A hard pace spends a full day resting after this many days on the move.
 * Six keeps a forced march honest: 1.3 × 6/7 ≈ 1.11, about a tenth faster
 * than steady over a long journey, never slower.
 */
export const HARD_PACE_REST_EVERY = 6;

/** Kinds of open country, as the author thinks of them, each with its own cost. */
export type GroundClass = 'open' | 'dry' | 'forest' | 'jungle' | 'marsh' | 'mountains' | 'ice';
export const GROUND_CLASSES: GroundClass[] = ['open', 'dry', 'forest', 'jungle', 'marsh', 'mountains', 'ice'];

/**
 * The author's travel physics. Multipliers over the built-in model, so the
 * least-time search, the seasons and the gradients keep working: speed 1.2
 * makes that mode 20% faster everywhere, ground 2 makes that country twice as
 * slow to cross off the road. Absent keys are 1.
 */
export interface TravelProfile {
  speed?: Partial<Record<TravelMode, number>>;
  ground?: Partial<Record<GroundClass, number>>;
}
export const TRAVEL_FACTOR_RANGE = { min: 0.25, max: 4 } as const;

/** Validates a profile; unknown keys and out-of-range factors are refused. */
export function normalizeTravelProfile(input: unknown): TravelProfile {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Travel profile must be an object.');
  const raw = input as Record<string, unknown>, out: TravelProfile = {};
  for (const key of Object.keys(raw)) if (key !== 'speed' && key !== 'ground') throw new Error(`Unknown travel profile field "${key}".`);
  const table = <K extends string>(value: unknown, keys: readonly K[], what: string): Partial<Record<K, number>> | undefined => {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} must be an object of factors.`);
    const result: Partial<Record<K, number>> = {};
    for (const [key, factor] of Object.entries(value as Record<string, unknown>)) {
      if (!keys.includes(key as K)) throw new Error(`Unknown ${what} "${key}".`);
      if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < TRAVEL_FACTOR_RANGE.min || factor > TRAVEL_FACTOR_RANGE.max) throw new Error(`${what} "${key}" must be from ${TRAVEL_FACTOR_RANGE.min} to ${TRAVEL_FACTOR_RANGE.max}.`);
      if (factor !== 1) result[key as K] = Math.round(factor * 100) / 100;
    }
    return Object.keys(result).length ? result : undefined;
  };
  const speed = table(raw.speed, ['foot', 'horse', 'cart', 'boat', 'ship'] as const, 'speed');
  const ground = table(raw.ground, GROUND_CLASSES, 'ground');
  if (speed) out.speed = speed;
  if (ground) out.ground = ground;
  return out;
}

const GROUND_OF: Partial<Record<number, GroundClass>> = {
  [Biome.Grassland]: 'open', [Biome.Savanna]: 'open', [Biome.Steppe]: 'open', [Biome.Shrubland]: 'open', [Biome.Chaparral]: 'open',
  [Biome.AlpineMeadow]: 'open', [Biome.Beach]: 'open', [Biome.Moor]: 'open', [Biome.Tundra]: 'open', [Biome.Puna]: 'open',
  [Biome.Desert]: 'dry', [Biome.Erg]: 'dry', [Biome.Reg]: 'dry', [Biome.Badlands]: 'dry', [Biome.SaltFlat]: 'dry',
  [Biome.FogDesert]: 'dry', [Biome.ColdDesert]: 'dry', [Biome.AshPlain]: 'dry', [Biome.ThornScrub]: 'dry',
  [Biome.TemperateForest]: 'forest', [Biome.TemperateRainforest]: 'forest', [Biome.BorealForest]: 'forest',
  [Biome.MontaneForest]: 'forest', [Biome.RiparianForest]: 'forest',
  [Biome.TropicalRainforest]: 'jungle', [Biome.TropicalForest]: 'jungle', [Biome.MonsoonForest]: 'jungle',
  [Biome.CloudForest]: 'jungle', [Biome.Bamboo]: 'jungle', [Biome.Mangrove]: 'jungle',
  [Biome.Marsh]: 'marsh', [Biome.PeatBog]: 'marsh', [Biome.SaltMarsh]: 'marsh',
  [Biome.Alpine]: 'mountains', [Biome.Karst]: 'mountains', [Biome.Volcanic]: 'mountains',
  [Biome.Glacier]: 'ice', [Biome.IceCap]: 'ice',
  [Biome.PetrifiedForest]: 'dry', [Biome.CrystalFlats]: 'dry', [Biome.FungalForest]: 'forest', [Biome.GlowMarsh]: 'marsh',
};
/** Which ground class a biome belongs to, for the author's cost table. */
export function groundClassOf(biome: number): GroundClass | undefined { return GROUND_OF[biome]; }
function speedFactor(opts: TravelOptions, mode: TravelMode): number { return opts.profile?.speed?.[mode] ?? 1; }
function groundFactor(opts: TravelOptions, biome: number): number { const g = GROUND_OF[biome]; return g ? opts.profile?.ground?.[g] ?? 1 : 1; }

/** The hours actually spent moving each day: the season's (or the author's) daylight times the pace. */
export function effectiveHoursPerDay(opts: Pick<TravelOptions, 'season' | 'hoursPerDay' | 'pace'>): number {
  const base = Number.isFinite(opts.hoursPerDay) && opts.hoursPerDay! > 0 ? opts.hoursPerDay! : SEASON_HOURS[opts.season];
  return base * PACE_HOURS[opts.pace ?? 'steady'];
}
/** Rest days a hard pace adds to a journey of this many days on the move. */
export function paceRestDays(pace: TravelPace | undefined, travelDays: number): number {
  if (pace !== 'hard' || !(travelDays > 0)) return 0;
  return Math.floor(Math.max(0, Math.ceil(travelDays - 1e-9) - 1) / HARD_PACE_REST_EVERY);
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
  /** The town (an inn there) or ruin close enough to sleep in, when there is one. */
  shelter?: { name: string; kind: string };
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
  /**
   * The same ground in TRAVEL ORDER: one entry per stretch of a terrain as the
   * party meets it (very short stretches folded into the one before). `legs`
   * is the summary by terrain, largest first; this is what a clock can follow.
   */
  stretches?: RouteLeg[];
  /** Rivers and straits the route has to get across. */
  crossings: { x: number; y: number; kind: 'river' | 'strait' | 'pass'; name?: string; bridge?: boolean; frozen?: boolean }[];
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
  /** Full days of rest the pace required, already included in `days`. */
  restDays?: number;
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
export function straightLineEstimates(km: number, season: Season = 'summer', profile?: TravelProfile): StraightLineEstimate[] {
  const d = Math.max(0, km);
  const hoursPerDay = SEASON_HOURS[season];
  // The world's own speeds apply here as in the planner, so the two still agree.
  let speed: TravelProfile['speed'] = {};
  try { speed = normalizeTravelProfile(profile ?? {}).speed ?? {}; } catch { /* a damaged profile reads as the built-in physics */ }
  return (['foot', 'horse', 'cart', 'ship'] as const).map((mode) => ({
    mode, hours: d / (BASE_KMH[mode].road * (speed[mode] ?? 1)), hoursPerDay,
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
  [Biome.PetrifiedForest]: 1.7, [Biome.FungalForest]: 2.4, [Biome.CrystalFlats]: 1.6, [Biome.GlowMarsh]: 3.4,
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
  [Biome.PetrifiedForest]: 'bosque petrificado', [Biome.FungalForest]: 'bosque fúngico',
  [Biome.CrystalFlats]: 'llanos de cristal', [Biome.GlowMarsh]: 'marisma luminosa',
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
const ROAD_CACHE = new WeakMap<TravelGeography, Uint8Array>();
function roadMask(world: WorldData, geo: TravelGeography): Uint8Array {
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
  from: number, to: number, metric: TravelMetric, opts: TravelOptions, terminals: ReadonlySet<number>,
): TravelCostInfo {
  const b = world.biome[to];
  const mode = opts.mode;
  const km = stepDistance(world, metric, from, to);

  if (mode === 'ship' || mode === 'boat') {
    const fromWater = navigableWater(world, from, opts);
    const toWater = navigableWater(world, to, opts);
    if (!fromWater || !toWater) {
      // A selected coastal town can embark/disembark at adjacent water. These
      // terminal access steps never turn dry coastal land into a waterway.
      const shore = fromWater ? to : from;
      if (fromWater !== toWater && terminals.has(shore) && !isSea(world, shore) && !isLake(world, shore)) {
        return { hours: km / (BASE_KMH.foot.off * speedFactor(opts, 'foot')), onRoad: false };
      }
      return { hours: Infinity, onRoad: false };
    }
  } else if (isSea(world, from) || isLake(world, from) || isSea(world, to) || isLake(world, to)) {
    // A road mask does not establish a bridge or a ferry across open water.
    return { hours: Infinity, onRoad: false };
  }

  if (mode === 'ship') {
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
    return { hours: km / (BASE_KMH.ship.road * speedFactor(opts, 'ship') * help / drag), onRoad: false };
  }

  if (mode === 'boat') {
    // Downstream is fast, upstream is a haul. Elevation decides which.
    // Flat lakes and coastal water have no upstream/downstream penalty.
    const flowing = !isSea(world, to) && !isLake(world, to) && !isLake(world, from);
    const downhill = world.elevation[to] < world.elevation[from];
    const kmh = BASE_KMH.boat.road * speedFactor(opts, 'boat') * (flowing ? (downhill ? 1.45 : 0.62) : 1);
    return { hours: km / kmh, onRoad: false };
  }

  // Getting across a river: closed where the author said so (a bridge down closes the road too),
  // and off the road it costs the time of a ford. A stop placed on a river is where the party
  // halts, not a river it crosses (it leaves from the river cell, which crosses nothing); a stop
  // beside a river is not exempt. A road being laid out bridges what it meets.
  const rivers = landRivers(world);
  const haltsOnRiver = rivers[to] === 1 && terminals.has(to);
  const blocked = opts.building ? undefined : world.painted?.blockedCrossings;
  if (blocked && !haltsOnRiver) {
    // Any step onto a closed river cell, so a party cannot ford upstream and wade down through it
    // either, and any diagonal step that slips between two closed river cells.
    if (rivers[to] === 1 && blocked.has(to)) return { hours: Infinity, onRoad: false };
    const corner = cornerCut(world, rivers, from, to);
    if (corner && (blocked.has(corner[0]) || blocked.has(corner[1]))) return { hours: Infinity, onRoad: false };
  }
  const crossed = opts.building || haltsOnRiver ? -1 : riverCrossed(world, rivers, from, to);
  const road = roads[to] > 0 && roads[from] > 0;
  const ford = crossed >= 0 && !road && !frozenRiver(world, crossed, opts) ? (FORD_HOURS[mode] ?? 0) : 0;
  if (mode === 'cart' && !road) {
    // Not forbidden — just very slow, so a cart will go a long way round to stay
    // on a road, which is the correct behaviour and produces the correct answer.
    const drag = (BIOME_DRAG[b] ?? 1.5) * 2.2 * groundFactor(opts, b);
    const grade = gradePenalty(world, from, to, km);
    if (grade > 4) return { hours: Infinity, onRoad: false };
    const kmh = BASE_KMH.cart.off * speedFactor(opts, 'cart') / (drag * grade * seasonFactor(world, to, opts.season, b));
    return { hours: km / kmh + ford, onRoad: false };
  }

  const drag = road ? (roads[to] === 2 ? 1 : 1.12) : (BIOME_DRAG[b] ?? 1.4) * groundFactor(opts, b);
  const grade = gradePenalty(world, from, to, km);
  const base = (road ? BASE_KMH[mode].road : BASE_KMH[mode].off) * speedFactor(opts, mode);
  const kmh = base / (drag * grade * seasonFactor(world, to, opts.season, b));
  return { hours: km / kmh + ford, onRoad: road };
}

interface TravelMetric { radius: number; horizontal: Float64Array; diagonal: Float64Array; vertical: number }
const METRIC_CACHE = new WeakMap<WorldData, TravelMetric>();
function travelMetric(world: WorldData, radius: number): TravelMetric {
  const cached = METRIC_CACHE.get(world);
  if (cached?.radius === radius) return cached;
  const horizontal = new Float64Array(world.height), diagonal = new Float64Array(world.height);
  for (let y = 0; y < world.height; y++) {
    horizontal[y] = greatCircleKm(world, y * world.width, y * world.width + 1, radius);
    if (y + 1 < world.height) diagonal[y] = greatCircleKm(world, y * world.width, (y + 1) * world.width + 1, radius);
  }
  const metric = { radius, horizontal, diagonal, vertical: Math.PI * radius / world.height };
  METRIC_CACHE.set(world, metric);
  return metric;
}
function stepDistance(world: WorldData, metric: TravelMetric, from: number, to: number): number {
  const fy = Math.floor(from / world.width), ty = Math.floor(to / world.width);
  if (fy === ty) return metric.horizontal[fy];
  return from % world.width === to % world.width ? metric.vertical : metric.diagonal[Math.min(fy, ty)];
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

function isSea(world: WorldData, i: number): boolean { return world.elevation[i] <= 0 && world.biome[i] === Biome.Ocean; }
function isLake(world: WorldData, i: number): boolean {
  // The hydrology mask also retains arid basins classified as dry salt flats.
  return world.biome[i] === Biome.Lake || (world.lake[i] === 1 && world.biome[i] !== Biome.SaltFlat);
}
function nearLand(world: WorldData, i: number): boolean {
  const W = world.width, H = world.height;
  const x = i % W, y = (i / W) | 0;
  for (let k = 0; k < 8; k++) {
    const nx = ((x + DX8[k]) % W + W) % W, ny = y + DY8[k];
    if (ny < 0 || ny >= H) continue;
    const j = ny * W + nx;
    if (!isSea(world, j) && !isLake(world, j)) return true;
  }
  return false;
}

function navigableWater(world: WorldData, i: number, opts: TravelOptions): boolean {
  if (opts.mode === 'ship') return isSea(world, i) && world.ice[i] * (opts.season === 'winter' ? 1.5 : 0.65) <= 0.55;
  if (opts.season === 'winter' && world.temperature[i] - 9 < -6) return false;
  if (isSea(world, i)) return nearLand(world, i);
  if (isLake(world, i)) return true;
  const riverEdit = riverEditsMask(world)?.[i] ?? 0;
  if (riverEdit === 1) return true;
  return world.biome[i] !== Biome.SaltFlat && riverEdit !== 2 && world.flow[i] > 0.62;
}

/**
 * Rivers as a traveller on land meets them: a generated channel (unless the
 * author removed it) or one the author drew. Worked out once per state of the
 * world and kept in one slot, because the route search asks for every step.
 */
const LAND_RIVERS = new WeakMap<WorldData, { revision: number | undefined; painted: WorldData['painted']; mask: Uint8Array }>();
function landRivers(world: WorldData): Uint8Array {
  const cached = LAND_RIVERS.get(world);
  if (cached && cached.revision === world.revision && cached.painted === world.painted) return cached.mask;
  const N = world.width * world.height, edits = riverEditsMask(world), mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const m = edits?.[i] ?? 0;
    // Water already stops a party on land, so a river cell under a lake or the sea is not one to cross.
    mask[i] = isSea(world, i) || isLake(world, i) ? 0 : m === 1 ? 1 : m === 2 ? 0 : world.flow[i] > 0.7 ? 1 : 0;
  }
  LAND_RIVERS.set(world, { revision: world.revision, painted: world.painted, mask });
  return mask;
}
/** True where a river runs that a party on land has to get across. */
export function isRiverCell(world: WorldData, i: number): boolean { return landRivers(world)[i] === 1; }
/** The river cell whose centre lies nearest (x, y), no further than a cell and a half; -1 when there is none. */
export function riverCellNear(world: WorldData, x: number, y: number): number {
  const W = world.width, H = world.height, rivers = landRivers(world);
  const cx = Math.floor(x), cy = Math.floor(y);
  let best = -1, bestD = 1.5 * 1.5 + 1e-9;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const ny = cy + dy;
    if (ny < 0 || ny >= H) continue;
    const i = ny * W + (((cx + dx) % W) + W) % W;
    if (!rivers[i]) continue;
    const d = (cx + dx + 0.5 - x) ** 2 + (ny + 0.5 - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
/**
 * The two river cells a diagonal step slips between, when it does: rivers join
 * on the diagonal, so a step from one dry cell to another can cut across a river
 * at the corner of two of its cells. Null for a straight step or no such corner.
 */
function cornerCut(world: WorldData, rivers: Uint8Array, from: number, to: number): [number, number] | null {
  if (rivers[from] === 1 || rivers[to] === 1) return null;
  const W = world.width, fx = from % W, fy = (from / W) | 0, tx = to % W, ty = (to / W) | 0;
  if (fx === tx || fy === ty) return null;
  const a = fy * W + tx, b = ty * W + fx;
  return rivers[a] === 1 && rivers[b] === 1 ? [a, b] : null;
}
/** The river cell a step gets across (onto it from the bank, or past it at a corner); -1 when none. */
function riverCrossed(world: WorldData, rivers: Uint8Array, from: number, to: number): number {
  if (rivers[to] === 1) return rivers[from] === 1 ? -1 : to;
  return cornerCut(world, rivers, from, to)?.[0] ?? -1;
}
/** A river frozen hard enough to walk over: the same cold that stops a boat on it in winter. */
function frozenRiver(world: WorldData, i: number, opts: TravelOptions): boolean {
  return opts.season === 'winter' && world.temperature[i] - 9 < -6;
}
/** Hours a party loses getting across a river off the road: finding the ford, unloading, drying out. */
const FORD_HOURS: Partial<Record<TravelMode, number>> = { foot: 1.5, horse: 1, cart: 4 };

const RIVER_EDIT_CACHE = new WeakMap<WorldData, { revision: number; painted: WorldData['painted']; mask: Uint8Array | null }>();
function riverEditsMask(world: WorldData): Uint8Array | null {
  const cached = RIVER_EDIT_CACHE.get(world);
  if (cached?.revision === world.revision && cached.painted === world.painted) return cached.mask;
  const painted = world.painted;
  let mask: Uint8Array | null = null;
  if (painted && (painted.rivers.length || painted.removed.size)) {
    mask = new Uint8Array(world.width * world.height);
    for (const river of world.rivers) {
      if (painted.removed.has(riverKey(river.cells))) for (const cell of river.cells) mask[cell] = 2;
    }
    // Author-declared rivers are waterways too, even though their strokes do
    // not rerun the planet's expensive drainage model. A later painted river
    // may deliberately restore a channel that was removed from the generator.
    for (const river of painted.rivers) for (const cell of river.cells) mask[cell] = 1;
  }
  RIVER_EDIT_CACHE.set(world, { revision: world.revision, painted, mask });
  return mask;
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
  world: WorldData, geo: TravelGeography, from: { x: number; y: number }, to: { x: number; y: number }, opts: TravelOptions, locale: 'es' | 'en' = 'es',
): Route {
  const route = solveRoute(world, geo, from, to, opts);
  return locale === 'en' ? englishRoute(route) : route;
}

function solveRoute(
  world: WorldData,
  geo: TravelGeography,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: TravelOptions,
): Route {
  const pace = opts.pace;
  opts = {
    ...opts,
    // The pace scales the hours on the move; the rest days are added once, at the end.
    hoursPerDay: effectiveHoursPerDay(opts),
    pace: undefined,
    planetRadiusKm: Number.isFinite(opts.planetRadiusKm) && opts.planetRadiusKm! > 0 ? opts.planetRadiusKm : 6371,
  };
  const withRest = (route: Route): Route => {
    const restDays = paceRestDays(pace, route.days);
    return restDays && !route.impossible ? { ...route, days: route.days + restDays, restDays } : route;
  };
  // "By way of X" is a chain of journeys, not one journey with a hint. Each leg
  // is solved on its own and the results are welded; a single search with a
  // bonus near X produces a route that passes NEAR X, which is not what anybody
  // meant by it.
  if (opts.via && opts.via.length) {
    const points = [from, ...opts.via, to];
    const legsOut: Route[] = [];
    const modes: TravelMode[] = [];
    for (let k = 0; k < points.length - 1; k++) {
      const mode = opts.legModes?.[k] ?? opts.mode;
      const leg = solveRoute(world, geo, points[k], points[k + 1], { ...opts, mode, via: undefined, legModes: undefined });
      if (leg.impossible) return leg;
      legsOut.push(leg); modes.push(mode);
    }
    return withRest(weldRoutes(world, geo, legsOut, opts, modes));
  }
  if (opts.legModes?.[0] && opts.legModes[0] !== opts.mode) opts = { ...opts, mode: opts.legModes[0] };
  const W = world.width, H = world.height, N = W * H;
  const metric = travelMetric(world, opts.planetRadiusKm!);
  const roads = roadMask(world, geo);

  const idx = (x: number, y: number) => Math.min(H - 1, Math.max(0, Math.round(y))) * W
    + (((Math.round(x) % W) + W) % W);
  const start = idx(from.x, from.y);
  const goal = idx(to.x, to.y);
  const terminals = new Set([start, goal]);

  // Every edge costs at least its spherical distance / this speed bound.
  // Include favourable currents, downstream flow and frozen road surfaces;
  // a planar/base-speed heuristic overestimated at high latitudes and could
  // permanently close a cell before its quickest approach was considered.
  const boost = opts.mode === 'ship' ? 1.5 : opts.mode === 'boat' ? 1.45 : opts.season === 'winter' ? 1 / 0.42 : 1;
  const minGround = Math.min(1, ...Object.values(opts.profile?.ground ?? {}));
  const modeFastest = Math.max(BASE_KMH[opts.mode].road, BASE_KMH[opts.mode].off / minGround) * speedFactor(opts, opts.mode) * boost;
  // Water modes walk their embark/disembark steps; with a very fast walker those
  // steps can beat the boat, and the bound must cover them to stay admissible.
  const accessFastest = opts.mode === 'ship' || opts.mode === 'boat'
    ? Math.max(BASE_KMH.foot.road, BASE_KMH.foot.off / minGround) * speedFactor(opts, 'foot') * (opts.season === 'winter' ? 1 / 0.42 : 1)
    : 0;
  const fastest = Math.max(modeFastest, accessFastest);
  const heur = (i: number) => greatCircleKm(world, i, goal, metric.radius) / fastest;

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
      const c = cellCost(world, roads, i, j, metric, opts, terminals);
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
    const c = cellCost(world, roads, a, b, metric, opts, terminals);
    const segKm = stepDistance(world, metric, a, b);
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
    if (opts.mode !== 'boat' && opts.mode !== 'ship' && !opts.building && !(terminals.has(b) && isRiverCell(world, b))) {
      const crossed = riverCrossed(world, landRivers(world), a, b);
      if (crossed >= 0) {
        crossings.push({ x: crossed % W, y: (crossed / W) | 0, kind: 'river', ...(c.onRoad ? { bridge: true } : frozenRiver(world, crossed, opts) ? { frozen: true } : {}) });
      }
    }
  }

  const hours = dist[goal];
  const hpd = opts.hoursPerDay ?? SEASON_HOURS[opts.season];
  const profile = elevationProfile(world, cells);
  return withRest({
    cells,
    km,
    hours,
    days: hours / hpd,
    directKm,
    // Legs shorter than a couple of kilometres are noise in a summary the reader
    // is going to read aloud; fold them into their neighbours.
    legs: mergeSmallLegs(legs, km * 0.04),
    stretches: orderedStretches(legs, km * 0.02),
    crossings,
    roadFraction: km > 0 ? roadKm / km : 0,
    stages: findStages(world, geo, roads, cells, metric, hpd, opts, terminals),
    realms: realmsAlong(world, geo, cells),
    ...profile,
  });
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
  world: WorldData, geo: TravelGeography, roads: Uint8Array,
  cells: number[], metric: TravelMetric, hoursPerDay: number, opts: TravelOptions, terminals: ReadonlySet<number>,
  /** For a journey whose legs travel differently: the mode of the step ending at each cell index. */
  stepModes?: TravelMode[],
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
    const c = cellCost(world, roads, a, b, metric, stepModes?.[k] && stepModes[k] !== opts.mode ? { ...opts, mode: stepModes[k] } : opts, terminals);
    if (!isFinite(c.hours)) continue;
    const stepKm = stepDistance(world, metric, a, b);

    // A world cell is FORTY KILOMETRES, which at walking pace is most of a day.
    // Cutting the day only at cell boundaries therefore reported nights 94 km
    // apart — two days' walking called one — so a step that overruns the day is
    // split along its own length, and a step long enough to hold several days
    // yields several nights.
    let done = 0;
    while (acc + c.hours * (1 - done) >= hoursPerDay && night < 400) {
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
        const d = coordinateDistance(world, x, y, sh.x, sh.y, metric.radius);
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
      const roofKm = (stepModes?.[k] ?? opts.mode) === 'horse' ? 8 : 5;
      const reached = !!best && best.km <= roofKm;
      const rough = !reached && !(onRoad && inRealm);

      out.push({
        night: night++,
        x, y,
        km: accKm,
        hours: hoursPerDay,
        nearest: best,
        rough,
        ...(reached && best ? { shelter: { name: best.name, kind: best.kind } } : {}),
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
function realmsAlong(world: WorldData, geo: TravelGeography, cells: number[]): string[] {
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
  world: WorldData, geo: TravelGeography, parts: Route[], opts: TravelOptions, modes?: TravelMode[],
): Route {
  const cells: number[] = [];
  const stepModes: TravelMode[] = [];
  parts.forEach((p, part) => {
    for (let k = cells.length ? 1 : 0; k < p.cells.length; k++) { cells.push(p.cells[k]); stepModes.push(modes?.[part] ?? opts.mode); }
  });
  const hpd = opts.hoursPerDay ?? SEASON_HOURS[opts.season];
  const km = parts.reduce((a, p) => a + p.km, 0);
  const hours = parts.reduce((a, p) => a + p.hours, 0);
  const roadKm = parts.reduce((a, p) => a + p.km * p.roadFraction, 0);
  const legs = mergeSmallLegs(parts.flatMap((p) => p.legs), km * 0.04);
  const stretches = orderedStretches(parts.flatMap((p) => p.stretches ?? []), km * 0.02);
  // The stages are recomputed over the WHOLE journey rather than concatenated:
  // a night does not fall at a waypoint just because the route happened to be
  // solved in pieces there.
  const metric = travelMetric(world, opts.planetRadiusKm ?? 6371);
  const terminals = new Set(parts.flatMap(part => [part.cells[0], part.cells[part.cells.length - 1]]));
  const stages = findStages(world, geo, roadMask(world, geo), cells, metric, hpd, opts, terminals, modes?.some(mode => mode !== opts.mode) ? stepModes : undefined);
  const profile = elevationProfile(world, cells);
  const realms: string[] = [];
  for (const p of parts) for (const n of p.realms) if (realms[realms.length - 1] !== n) realms.push(n);
  return {
    cells, km, hours, days: hours / hpd,
    directKm: cells.length ? greatCircleKm(world, cells[0], cells[cells.length - 1], metric.radius) : 0,
    legs,
    stretches,
    crossings: parts.flatMap((p) => p.crossings),
    roadFraction: km > 0 ? roadKm / km : 0,
    stages,
    realms,
    ...profile,
  };
}

/** The legs in the order they are travelled: short ones folded into the one before, then neighbours of the same ground joined. */
function orderedStretches(legs: RouteLeg[], minKm: number): RouteLeg[] {
  const out: RouteLeg[] = [];
  for (const l of legs) {
    const last = out[out.length - 1];
    if (last && (l.km < minKm || (last.terrain === l.terrain && last.onRoad === l.onRoad))) { last.km += l.km; last.hours += l.hours; continue; }
    out.push({ ...l });
  }
  return out;
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
  return coordinateDistance(world, a % world.width, Math.floor(a / world.width), b % world.width, Math.floor(b / world.width), radiusKm);
}

export function coordinateDistance(world: WorldData, ax: number, ay: number, bx: number, by: number, radiusKm: number): number {
  const W = world.width, H = world.height;
  const toRad = (x: number, y: number) => ({
    lon: (x / W) * Math.PI * 2,
    lat: (0.5 - (y + 0.5) / H) * Math.PI,
  });
  const p = toRad(ax, ay), q = toRad(bx, by);
  const hav = Math.sin((p.lat - q.lat) / 2) ** 2 + Math.cos(p.lat) * Math.cos(q.lat) * Math.sin((p.lon - q.lon) / 2) ** 2;
  const d = 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, hav))));
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
  world: WorldData, geo: TravelGeography,
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
