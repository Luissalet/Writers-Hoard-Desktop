import { Biome } from './types';
import { cellKmOf } from './geoScale';
import { landReach } from './tradeRoutes';
import { createRng } from './rng';
import type { Settlement, SettlementRank } from './settlements';

/**
 * The trade lens: a small, deterministic settlement economy over a generated
 * world, so a novelist can ask "who is short of grain this winter?" and get an
 * answer that is plausible and never changes between runs.
 *
 * Pure functions only. Nothing here touches the DOM, storage or the generator;
 * it reads the physical grids (biome, elevation, temperature) and a list of
 * places. The world is a cylinder: x wraps at the seam, y does not.
 *
 * Shape of the model: sites (farms, mines, ...) make goods, each place eats its
 * population's monthly need, surplus flows to the nearest deficit places by
 * road (instant, nearest first) or by sea between ports (one month), and the
 * price of a good at a place follows how long its supply lasts.
 */

// ---------------------------------------------------------------- vocabulary

export const GOODS = ['grain', 'fish', 'meat', 'wool', 'timber', 'stone', 'iron', 'salt'] as const;
export type Good = (typeof GOODS)[number];

export const SITE_KINDS = ['farm', 'fishery', 'pasture', 'camp', 'quarry', 'mine', 'saltworks'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export type SiteSize = 'S' | 'M' | 'L';
export const SITE_SIZES: readonly SiteSize[] = ['S', 'M', 'L'];
/** Yield multiplier per size. */
export const SIZE_YIELD: Record<SiteSize, number> = { S: 0.6, M: 1, L: 1.6 };

/** Units a thousand people use per month. Grain dwarfs the rest; iron is a trickle. */
export const NEED_PER_1000: Record<Good, number> = {
  grain: 30, fish: 3, meat: 4, wool: 2.5, timber: 2, stone: 0.8, iron: 0.5, salt: 1.2,
};

/** What a unit costs when things are normal, in silver. The simulation works in
 *  an index (1.0 = usual); multiply by this to show coin. */
export const BASE_PRICE: Record<Good, number> = {
  grain: 1, fish: 1.5, meat: 3, wool: 4, timber: 1.2, stone: 2, iron: 8, salt: 10,
};

/** Monthly yield of a size-M site on perfect ground. Grain is the yearly mean;
 *  the harvest swings it month to month. Farms, fisheries and pastures feed
 *  their own town; camps, quarries, mines and saltworks are few and supply a
 *  whole region, so they yield far beyond any one town's need (with the old
 *  local-sized yields iron, stone and salt ran out in every market of every
 *  world tried, which is not a scarcity but a broken trade). */
export const SITE_OUTPUT: Record<SiteKind, Partial<Record<Good, number>>> = {
  farm: { grain: 60 },
  fishery: { fish: 25 },
  pasture: { meat: 12, wool: 8 },
  camp: { timber: 40 },
  quarry: { stone: 60 },
  mine: { iron: 50 },
  saltworks: { salt: 60 },
};

/**
 * The goods whose running out is a story: bread, meat and salt. Wool, timber,
 * stone and iron are scarce or dear when short, not a hunger; fish is a
 * staple only where people fish, so it is shown by its price too.
 */
export const STAPLES: readonly Good[] = ['grain', 'meat', 'salt'];

/** The kind of site that makes a good (the hint for "nobody makes this"). */
export const SITE_FOR_GOOD: Record<Good, SiteKind> = {
  grain: 'farm', fish: 'fishery', meat: 'pasture', wool: 'pasture',
  timber: 'camp', stone: 'quarry', iron: 'mine', salt: 'saltworks',
};

/** Most sites a place opens by itself: farms, pastures, other trades and (towns up) the regional ones. */
export const SITE_CAP: Record<SettlementRank, number> = { village: 7, town: 16, city: 28, capital: 36 };

export const MAX_MONTHS = 240;
/** How far goods go by road (km, wrapped straight line; converted to cells for the world's grid). */
export const LAND_RANGE_KM = 800;
/** Trade partners kept per place; keeps the monthly loop linear in places. */
export const NEIGHBOUR_CAP = 12;
/** A road round a bay is worth taking up to this many times the straight line. */
export const DETOUR_MAX = 1.8;
/** How far (cells of going) the search for a way round looks from a place. */
const DETOUR_RADIUS_CELLS = 120;

// ------------------------------------------------------------------ records

export interface EconomyPlace {
  id: number; name: string; x: number; y: number;
  rank: SettlementRank; population: number; port: boolean; realm: number;
}
export interface TradeSite {
  id: string; kind: SiteKind; x: number; y: number; size: SiteSize;
  placeId: number | null; auto: boolean;
}
export interface EconomyWorld {
  width: number; height: number;
  /** Km; <= 0 is sea. */
  elevation: Float32Array;
  /** Degrees C. */
  temperature: Float32Array;
  biome: Uint8Array;
  lake: Uint8Array;
  /** A sheet's width in km, when the world is a sheet rather than a planet. */
  params?: { worldKm?: number };
  /** 0..1 drainage; roads follow river valleys where they can. */
  flow?: Float32Array;
}
export interface EconomyInput {
  world: EconomyWorld;
  places: EconomyPlace[];
  seed: string;
  manualSites?: TradeSite[];
  /** Ids of generated sites the author deleted. */
  removedSites?: string[];
}

export interface Movement { good: Good; from: number; to: number; amount: number; bySea: boolean }

export interface PlaceEconomy {
  id: number;
  name: string;
  /** Held at the end of the month. */
  stock: Record<Good, number>;
  /** Made this month (grain follows the harvest). */
  production: Record<Good, number>;
  /** Wanted this month. */
  need: Record<Good, number>;
  /** Actually eaten/used this month (never more than was held). */
  consumed: Record<Good, number>;
  /** Fish and meat eaten in place of missing bread (same units as grain), beyond their own need. */
  eatenInstead: Partial<Record<Good, number>>;
  /** Index, 1.0 = usual. */
  price: Record<Good, number>;
  /** Months until the place first cannot get all it needs, trade included (0 = this month); absent when that is 24+ months away. */
  shortIn: Partial<Record<Good, number>>;
  /** Grain need met this month. */
  fed: boolean;
}
export interface EconomySnapshot {
  month: number;
  places: PlaceEconomy[];
  /** Shipments dispatched this month (sea ones land next month). */
  movements: Movement[];
  /** How many shipments are travelling this month. */
  onTheMove: number;
}
export interface GoodSummary {
  good: Good; priceMin: number; priceMax: number;
  /** Places with a site that makes it. */
  madeIn: number;
  /** Nobody makes it. */
  missing: boolean;
  /** The site kind that would make it (only when missing). */
  hint?: SiteKind;
}

// ------------------------------------------------------------------- helpers

function emptyGoods(): Record<Good, number> {
  return { grain: 0, fish: 0, meat: 0, wool: 0, timber: 0, stone: 0, iron: 0, salt: 0 };
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrap = (v: number, n: number) => ((v % n) + n) % n;
/** Signed shortest x difference on a cylinder of width n. */
function wrapDelta(d: number, n: number): number {
  const r = wrap(d, n);
  return r > n / 2 ? r - n : r;
}

/** Throws a readable message when the grids do not match the stated size. */
function checkWorld(world: EconomyWorld): void {
  const n = world.width * world.height;
  if (!(world.width > 0 && world.height > 0) || !Number.isInteger(n)) throw new Error('World size must be positive whole cells.');
  if (world.elevation.length !== n || world.temperature.length !== n || world.biome.length !== n || world.lake.length !== n) {
    throw new Error('World grids must all be width x height cells.');
  }
}

/** Place id -> index, refusing duplicates (everything downstream keys on id). */
function indexPlaces(places: readonly EconomyPlace[]): Map<number, number> {
  const byId = new Map<number, number>();
  places.forEach((place, i) => {
    if (byId.has(place.id)) throw new Error(`Two places share the id ${place.id}.`);
    byId.set(place.id, i);
  });
  return byId;
}

export function placesFromSettlements(settlements: Settlement[]): EconomyPlace[] {
  return settlements.map((s) => ({
    id: s.id, name: s.name, x: s.x, y: s.y, rank: s.rank,
    population: s.population, port: s.port, realm: s.realm,
  }));
}

// ------------------------------------------------------------------- fitness

const TABLE_SIZE = 64;
function table(entries: ReadonlyArray<readonly [number, number]>): Float32Array {
  const t = new Float32Array(TABLE_SIZE);
  for (const [b, v] of entries) t[b] = v;
  return t;
}
const pick = (t: Float32Array, b: number) => (b < TABLE_SIZE ? t[b] : 0);

// How well each biome suits a kind of work, 0..1. Anything not listed is 0.
const FARM_BIOME = table([
  [Biome.Grassland, 1], [Biome.RiparianForest, 0.9], [Biome.AshPlain, 0.8], [Biome.Chaparral, 0.75],
  [Biome.Steppe, 0.7], [Biome.Savanna, 0.65], [Biome.MonsoonForest, 0.65], [Biome.TemperateForest, 0.6],
  [Biome.Shrubland, 0.5], [Biome.TropicalForest, 0.45], [Biome.Bamboo, 0.4], [Biome.TemperateRainforest, 0.3],
  [Biome.TropicalRainforest, 0.3], [Biome.Marsh, 0.25], [Biome.SaltMarsh, 0.25], [Biome.Moor, 0.25],
  [Biome.ThornScrub, 0.25], [Biome.BorealForest, 0.2], [Biome.MontaneForest, 0.2], [Biome.CloudForest, 0.2],
  [Biome.AlpineMeadow, 0.15], [Biome.Beach, 0.1], [Biome.Mangrove, 0.1], [Biome.PeatBog, 0.1], [Biome.Tundra, 0.05],
]);
const PASTURE_BIOME = table([
  [Biome.Grassland, 1], [Biome.Steppe, 0.9], [Biome.AlpineMeadow, 0.9], [Biome.Savanna, 0.8], [Biome.Moor, 0.8],
  [Biome.Shrubland, 0.7], [Biome.Puna, 0.6], [Biome.Chaparral, 0.6], [Biome.AshPlain, 0.5], [Biome.ThornScrub, 0.4],
  [Biome.TemperateForest, 0.4], [Biome.SaltMarsh, 0.4], [Biome.Tundra, 0.3], [Biome.Marsh, 0.3],
  [Biome.ColdDesert, 0.25], [Biome.BorealForest, 0.2], [Biome.Reg, 0.1],
]);
const CAMP_BIOME = table([
  [Biome.TemperateForest, 1], [Biome.MontaneForest, 1], [Biome.TemperateRainforest, 0.9], [Biome.BorealForest, 0.85],
  [Biome.MonsoonForest, 0.85], [Biome.TropicalForest, 0.8], [Biome.Bamboo, 0.8], [Biome.RiparianForest, 0.7],
  [Biome.TropicalRainforest, 0.6], [Biome.CloudForest, 0.5], [Biome.Mangrove, 0.35], [Biome.FungalForest, 0.3],
]);
const QUARRY_BIOME = table([
  [Biome.Badlands, 1], [Biome.Karst, 1], [Biome.Alpine, 0.9], [Biome.Volcanic, 0.8], [Biome.Reg, 0.6],
  [Biome.Puna, 0.6], [Biome.AlpineMeadow, 0.55], [Biome.MontaneForest, 0.5], [Biome.ColdDesert, 0.45],
  [Biome.Desert, 0.3], [Biome.Tundra, 0.3], [Biome.Moor, 0.3], [Biome.Chaparral, 0.3], [Biome.Shrubland, 0.2],
  [Biome.Steppe, 0.15],
]);
/** Dry, hot ground where a shallow sea dries into salt. */
const SALT_COAST_BIOME = table([
  [Biome.Desert, 1], [Biome.Savanna, 1], [Biome.Steppe, 1], [Biome.Shrubland, 1], [Biome.Chaparral, 1],
  [Biome.ThornScrub, 1], [Biome.FogDesert, 1], [Biome.Reg, 1], [Biome.Erg, 1], [Biome.Badlands, 1],
]);

/** Quarries and mines need real height; below this a hill is only a hill. */
export const MINE_MIN_ELEV = 0.8;
/** Fieldstone and low hills still give building stone; real height only makes it better. */
const QUARRY_MIN_ELEV = 0.1;

function isOcean(world: EconomyWorld, i: number): boolean {
  return world.elevation[i] <= 0 && world.lake[i] === 0 && world.biome[i] !== Biome.Lake;
}
function isLand(world: EconomyWorld, i: number): boolean {
  if (world.elevation[i] <= 0 || world.lake[i] !== 0) return false;
  const b = world.biome[i];
  return b !== Biome.Ocean && b !== Biome.Lake && b !== Biome.IceCap && b !== Biome.Glacier;
}

/** Chebyshev distance (<= 2) to the nearest sea and lake cell; Infinity when none. */
function waterDist(world: EconomyWorld, cx: number, cy: number): { sea: number; lake: number } {
  const { width: w, height: h } = world;
  let sea = Infinity, lake = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const i = y * w + wrap(cx + dx, w);
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (isOcean(world, i)) { if (d < sea) sea = d; }
      else if (world.lake[i] !== 0 || world.biome[i] === Biome.Lake) { if (d < lake) lake = d; }
    }
  }
  return { sea, lake };
}

/** Height spread of the LAND within two cells (km). Coast cliffs must not read as mountains, so sea floor is ignored. */
function localRelief(world: EconomyWorld, cx: number, cy: number): number {
  const { width: w, height: h } = world;
  let lo = Infinity, hi = -Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const e = world.elevation[y * w + wrap(cx + dx, w)];
      if (e <= 0) continue;
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
  }
  return hi > lo ? hi - lo : 0;
}

/**
 * How well a cell suits a kind of site, 0..1 (0 = impossible). Sea, lake and
 * ice never qualify. Coordinates are cells; x wraps, y clamps.
 */
export function siteFitness(world: EconomyWorld, kind: SiteKind, x: number, y: number): number {
  const w = world.width, h = world.height;
  const cx = wrap(Math.floor(x), w), cy = clamp(Math.floor(y), 0, h - 1);
  const i = cy * w + cx;
  if (!isLand(world, i)) return 0;
  const biome = world.biome[i], elev = world.elevation[i], temp = world.temperature[i];
  switch (kind) {
    case 'farm': {
      const base = pick(FARM_BIOME, biome);
      if (base === 0 || temp <= -4) return 0;
      // Cool ground still grows oats and barley; only frost-bound ground yields little.
      const warmth = clamp((temp + 5) / 15, 0.2, 1);
      const heat = temp > 34 ? 0.8 : 1;
      const height = elev > 1 ? Math.max(0.1, 1 - (elev - 1) / 1.5) : 1; // thin air, short seasons
      return base * warmth * heat * height;
    }
    case 'fishery': {
      const { sea, lake } = waterDist(world, cx, cy);
      const s = sea === 1 ? 1 : sea === 2 ? 0.8 : 0;
      const l = lake === 1 ? 0.7 : lake === 2 ? 0.55 : 0;
      return Math.max(s, l) * (temp < -5 ? 0.4 : 1);
    }
    case 'pasture':
      return pick(PASTURE_BIOME, biome) * (temp < -5 ? 0.4 : 1) * (elev > 3.5 ? 0.3 : 1);
    case 'camp':
      return pick(CAMP_BIOME, biome) * (temp < -8 ? 0.5 : 1) * (elev > 3 ? 0.3 : 1);
    case 'quarry': {
      if (elev < QUARRY_MIN_ELEV) return 0;
      const base = pick(QUARRY_BIOME, biome);
      if (base === 0) return 0;
      return base * (0.6 + 0.4 * clamp(localRelief(world, cx, cy) / 0.4, 0, 1));
    }
    case 'mine': {
      if (elev < MINE_MIN_ELEV || biome === Biome.Erg) return 0;
      return 0.5 + 0.5 * Math.min(1, (elev - MINE_MIN_ELEV) / 1.5);
    }
    case 'saltworks': {
      if (elev > 0.5) return 0;
      if (biome === Biome.SaltFlat) return 1;
      if (biome === Biome.CrystalFlats) return 0.8;
      if (waterDist(world, cx, cy).sea > 2) return 0;
      if (biome === Biome.SaltMarsh) return 0.55;
      if (temp >= 18 && (biome === Biome.Beach || pick(SALT_COAST_BIOME, biome) > 0)) return biome === Biome.Beach ? 0.85 : 0.75;
      if (biome === Biome.Beach && temp >= 12) return 0.4; // cool coast: boiling brine costs fuel
      return 0;
    }
  }
}

// ----------------------------------------------------------------- auto sites

/** How far from its own cell a place looks for ground to work (cells). */
/**
 * How far from its own cell a place works the ground, in km (a village its
 * own valley, a capital a province), converted to cells for the world's grid,
 * never fewer than a couple of cells on a coarse one.
 */
const SEARCH_RADIUS_KM: Record<SettlementRank, number> = { village: 60, town: 80, city: 120, capital: 160 };
const SEARCH_RADIUS_MIN: Record<SettlementRank, number> = { village: 2, town: 2, city: 3, capital: 3 };
function searchRadius(rank: SettlementRank, kmPerCell: number): number {
  return Math.max(SEARCH_RADIUS_MIN[rank], Math.round(SEARCH_RADIUS_KM[rank] / kmPerCell));
}
/** Farms and herds a place may open further out to feed itself (see autoSites step 3). */
const HINTERLAND_FARMS: Record<SettlementRank, number> = { village: 1, town: 2, city: 6, capital: 9 };
const HINTERLAND_PASTURES: Record<SettlementRank, number> = { village: 0, town: 1, city: 3, capital: 4 };
/** Fisheries and herds a place opens in place of the fields it cannot have (step 3b). */
const STAPLE_SUBSTITUTE_SLOTS: Record<SettlementRank, number> = { village: 2, town: 3, city: 5, capital: 6 };
/** Slots for farms, then (with PASTURE_SLOTS below) for everything else; together they sum to SITE_CAP. */
const FARM_SLOTS: Record<SettlementRank, number> = { village: 2, town: 3, city: 5, capital: 6 };
const EXTRA_SLOTS: Record<SettlementRank, number> = { village: 1, town: 2, city: 3, capital: 4 };
/**
 * Herds come second only to bread: every settlement keeps some animals for
 * meat and wool where the ground allows, before any other trade. Without this
 * step most villages had no pasture at all and every market in the world
 * showed meat at five times the usual, which reads as a broken economy rather
 * than a hungry one.
 */
const PASTURE_SLOTS: Record<SettlementRank, number> = { village: 1, town: 1, city: 2, capital: 3 };
const PASTURE_MIN_FIT = 0.2;
const MEAT_COVER: Record<SettlementRank, number> = { village: 1.3, town: 1.1, city: 0.9, capital: 0.9 };
const RANK_ORDER: Record<SettlementRank, number> = { village: 0, town: 1, city: 2, capital: 3 };
/**
 * Timber, stone, iron and salt come from a few places and supply a region.
 * Towns and larger look further afield (twice, or for cities three times,
 * their working radius) for the best ground for each of these they do not
 * already work, so every inhabited region has somewhere that makes them.
 */
const REGIONAL_KINDS: readonly SiteKind[] = ['camp', 'quarry', 'mine', 'saltworks'];
const REGIONAL_MIN_FIT = 0.3;
/** How far (km) towns and cities look for their regional trades, and for hinterland farms and herds beyond their own radius. */
const REGIONAL_REACH_KM: Record<SettlementRank, number> = { village: 0, town: 300, city: 500, capital: 500 };
const HINTERLAND_REACH_KM: Record<SettlementRank, number> = { village: 40, town: 120, city: 200, capital: 250 };
/** Poor fields are still fields: a village farms what it has rather than none. */
const FARM_MIN_FIT = 0.12;
const EXTRA_MIN_FIT = 0.3;
/** Aim a little above own grain need, so a normal year leaves something to sell. */
/** How much of its own bread (and meat, below) a place grows: villages and towns
 *  grow a surplus for the cities, which never feed themselves. Without it the
 *  world as a whole grew a fifth too little grain and two in five markets
 *  went short every winter. */
const GRAIN_COVER: Record<SettlementRank, number> = { village: 1.5, town: 1.25, city: 1.05, capital: 1.05 };
const EXTRA_KINDS: readonly SiteKind[] = ['fishery', 'pasture', 'camp', 'quarry', 'mine', 'saltworks'];

function grainNeedOf(place: EconomyPlace): number {
  return (Math.max(0, place.population) / 1000) * NEED_PER_1000.grain;
}

function siteYield(kind: SiteKind, size: SiteSize, fit: number, good: Good): number {
  return (SITE_OUTPUT[kind][good] ?? 0) * SIZE_YIELD[size] * (0.5 + 0.5 * fit);
}

/**
 * Sites that exist now: generated ones (deterministic from `seed` and the
 * place), minus `removedSites`, plus `manualSites`. Generated ids are stable
 * (`auto:<x>,<y>:<kind>:<n>`, from the settlement's cell): removing one never renumbers the rest, because
 * everything is generated first and the removals filter afterwards.
 */
export function autoSites(input: EconomyInput): TradeSite[] {
  const { world, places } = input;
  checkWorld(world);
  indexPlaces(places);
  const w = world.width, h = world.height;
  const kmPerCell = cellKmOf(world.params, w);
  const occupied = new Set<number>();
  for (const p of places) occupied.add(clamp(Math.floor(p.y), 0, h - 1) * w + wrap(Math.floor(p.x), w));

  // Small places choose first, so a village keeps its own field when a city's
  // wider reach would otherwise swallow it.
  const order = places.slice().sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || a.id - b.id);
  const made = new Map<number, TradeSite[]>();

  for (const place of order) {
    const R = searchRadius(place.rank, kmPerCell);
    // Keyed by the settlement's CELL, not its id: ids are founding order and
    // shift when a terrain edit re-runs the founding, which would hand one
    // town's switched-off farm to another. The cell is how every other edit
    // names a settlement (`settlement:x,y`).
    const cellKey = `${Math.floor(place.x)},${Math.floor(place.y)}`;
    const rng = createRng(input.seed, `economy:${cellKey}`);
    const px = Math.floor(place.x), py = Math.floor(place.y);
    // The window around the place, scored once for every kind. A jitter per
    // cell (drawn for every cell so the stream never depends on the terrain)
    // keeps two similar villages from picking identical-looking spots.
    const cx: number[] = [], cy: number[] = [], dist: number[] = [], jitter: number[] = [];
    const fits: number[] = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const jit = rng();
        const y = py + dy;
        if (y < 0 || y >= h) continue;
        const x = wrap(px + dx, w);
        cx.push(x); cy.push(y); dist.push(Math.hypot(dx, dy)); jitter.push(jit);
        for (const kind of SITE_KINDS) fits.push(siteFitness(world, kind, x, y));
      }
    }
    const K = SITE_KINDS.length;
    const best = (kind: SiteKind, minFit: number): { c: number; fit: number; score: number } | null => {
      const k = SITE_KINDS.indexOf(kind);
      let found: { c: number; fit: number; score: number } | null = null;
      for (let c = 0; c < cx.length; c++) {
        const fit = fits[c * K + k];
        if (fit < minFit || occupied.has(cy[c] * w + cx[c])) continue;
        const score = fit * (1 - 0.25 * dist[c] / R) + jitter[c] * 0.08;
        if (!found || score > found.score) found = { c, fit, score };
      }
      return found;
    };

    const list: TradeSite[] = [];
    const counts = new Map<SiteKind, number>();
    const open = (kind: SiteKind, size: SiteSize, c: number) => {
      const n = counts.get(kind) ?? 0;
      counts.set(kind, n + 1);
      occupied.add(cy[c] * w + cx[c]);
      list.push({ id: `auto:${cellKey}:${kind}:${n}`, kind, x: cx[c], y: cy[c], size, placeId: place.id, auto: true });
    };

    // 1. Feed yourself: open farms until the local grain covers the need.
    const target = grainNeedOf(place) * GRAIN_COVER[place.rank];
    let grain = 0;
    for (let n = 0; n < FARM_SLOTS[place.rank] && grain < target; n++) {
      const hit = best('farm', FARM_MIN_FIT);
      if (!hit) break;
      const unit = siteYield('farm', 'M', hit.fit, 'grain');
      const remaining = target - grain;
      const size: SiteSize = remaining >= unit * SIZE_YIELD.L * 0.9 ? 'L' : remaining >= unit * 0.9 ? 'M' : 'S';
      open('farm', size, hit.c);
      grain += unit * SIZE_YIELD[size];
    }

    // 1b. Keep herds: pastures until local meat covers most of the need.
    const meatTarget = (Math.max(0, place.population) / 1000) * NEED_PER_1000.meat * MEAT_COVER[place.rank];
    let meat = 0;
    for (let n = 0; n < PASTURE_SLOTS[place.rank] && meat < meatTarget; n++) {
      const hit = best('pasture', PASTURE_MIN_FIT);
      if (!hit) break;
      const unit = siteYield('pasture', 'M', hit.fit, 'meat');
      const remaining = meatTarget - meat;
      const size: SiteSize = remaining >= unit * SIZE_YIELD.L * 0.9 ? 'L' : remaining >= unit * 0.9 ? 'M' : 'S';
      open('pasture', size, hit.c);
      meat += unit * SIZE_YIELD[size];
    }

    // 2. A few other trades, the best the neighbourhood offers.
    const picks: Array<{ kind: SiteKind; c: number; fit: number; score: number }> = [];
    for (const kind of EXTRA_KINDS) {
      const hit = best(kind, EXTRA_MIN_FIT);
      if (hit) picks.push({ kind, ...hit });
    }
    picks.sort((a, b) => b.score - a.score || SITE_KINDS.indexOf(a.kind) - SITE_KINDS.indexOf(b.kind));
    for (const hit of picks.slice(0, EXTRA_SLOTS[place.rank])) {
      // The same cell may be best for two kinds; the first pick keeps it.
      if (occupied.has(cy[hit.c] * w + cx[hit.c])) continue;
      const big = RANK_ORDER[place.rank] >= 2 && hit.fit >= 0.85 ? 'L'
        : RANK_ORDER[place.rank] >= 1 && hit.fit >= 0.7 ? 'M' : 'S';
      open(hit.kind, big, hit.c);
    }

    // Further afield than the working radius: the best free cell for a kind within `reach` cells.
    const hinterReach = R + Math.max(1, Math.round(HINTERLAND_REACH_KM[place.rank] / kmPerCell));
    const regionalReach = REGIONAL_REACH_KM[place.rank] > 0 ? Math.max(R + 1, Math.round(REGIONAL_REACH_KM[place.rank] / kmPerCell)) : 0;
    const afield = (kind: SiteKind, minFit: number, reach: number): { x: number; y: number; fit: number } | null => {
      let found: { x: number; y: number; fit: number; score: number } | null = null;
      for (let dy = -reach; dy <= reach; dy++) {
        const y = py + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > reach) continue;
          const x = wrap(px + dx, w);
          if (occupied.has(y * w + x)) continue;
          const fit = siteFitness(world, kind, x, y);
          if (fit < minFit) continue;
          const score = fit * (1 - 0.3 * d / reach);
          if (!found || score > found.score) found = { x, y, fit, score };
        }
      }
      return found;
    };
    const openAt = (kind: SiteKind, size: SiteSize, at: { x: number; y: number }) => {
      const n = counts.get(kind) ?? 0;
      counts.set(kind, n + 1);
      occupied.add(at.y * w + at.x);
      list.push({ id: `auto:${cellKey}:${kind}:${n}`, kind, x: at.x, y: at.y, size, placeId: place.id, auto: true });
    };

    // 3. The hinterland: a town or city that cannot feed itself from its own
    //    fields draws on farms and herds further out (a city's bread has always
    //    come from far beyond its walls).
    for (let n = 0; n < HINTERLAND_FARMS[place.rank] && grain < target; n++) {
      const at = afield('farm', FARM_MIN_FIT, hinterReach);
      if (!at) break;
      openAt('farm', 'L', at);
      grain += siteYield('farm', 'L', at.fit, 'grain');
    }
    for (let n = 0; n < HINTERLAND_PASTURES[place.rank] && meat < meatTarget; n++) {
      const at = afield('pasture', PASTURE_MIN_FIT, hinterReach);
      if (!at) break;
      openAt('pasture', 'L', at);
      meat += siteYield('pasture', 'L', at.fit, 'meat');
    }

    // 3b. Where bread will not grow (frost, salt marsh, bog), people live on
    //     fish and herds instead: more fisheries, then pastures, until they
    //     cover what the fields cannot. The simulation eats them in bread's place.
    let gap = target - grain;
    for (let n = 0; n < STAPLE_SUBSTITUTE_SLOTS[place.rank] && gap > target * 0.2; n++) {
      const fish = afield('fishery', 0.3, hinterReach);
      const kind: SiteKind = fish ? 'fishery' : 'pasture';
      const at = fish ?? afield('pasture', PASTURE_MIN_FIT, hinterReach);
      if (!at) break;
      openAt(kind, 'L', at);
      gap -= siteYield(kind, 'L', at.fit, kind === 'fishery' ? 'fish' : 'meat');
    }

    // 4. The regional trades this place does not already work, from further afield.
    if (regionalReach > 0) {
      for (const kind of REGIONAL_KINDS) {
        if (counts.get(kind)) continue;
        const at = afield(kind, REGIONAL_MIN_FIT, regionalReach);
        if (at) openAt(kind, at.fit >= 0.8 ? 'L' : 'M', at);
      }
    }
    made.set(place.id, list);
  }

  const removed = new Set(input.removedSites ?? []);
  const out: TradeSite[] = [];
  for (const place of places.slice().sort((a, b) => a.id - b.id)) {
    for (const site of made.get(place.id) ?? []) if (!removed.has(site.id)) out.push(site);
  }

  // Manual sites: the author's word wins. Later records replace earlier ones by id.
  const manual = new Map<string, TradeSite>();
  for (const site of input.manualSites ?? []) manual.set(site.id, site);
  for (const site of manual.values()) {
    out.push({ ...site, auto: false, placeId: resolvePlace(site, places, w) });
  }
  return out;
}

/** The site's own place if it names a real one; otherwise the nearest (wrapped distance). */
function resolvePlace(site: TradeSite, places: readonly EconomyPlace[], width: number): number | null {
  if (places.length === 0) return null;
  if (site.placeId !== null && places.some((p) => p.id === site.placeId)) return site.placeId;
  let bestId = places[0].id, bestD = Infinity;
  for (const p of places) {
    const dx = wrapDelta(p.x - site.x, width), dy = p.y - site.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; bestId = p.id; }
  }
  return bestId;
}

// ----------------------------------------------------------------- simulation

/** Months of need a place tries to hold at the END of a month (after eating), and the level above which it will sell. */
const STOCK_TARGET = 2;
const STOCK_EXPORT_FLOOR = 3;
/** Start with this many months in the larder. Durable goods (wool, timber, stone, iron) and salt keep for months, so a town starts with more of them. */
export const INITIAL_COVER: Record<Good, number> = { grain: 2, fish: 1, meat: 1, wool: 2, timber: 4, stone: 6, iron: 6, salt: 4 };
/** Months of supply (stock + this month's output) that count as "usual" for a price. */
const USUAL_COVER = 3;
export const PRICE_MIN = 0.3;
export const PRICE_MAX = 5;
/** A shipment smaller than this share of the buyer's monthly need is not worth a cart. */
const MIN_SHIPMENT = 0.05;
const SHORT_HORIZON = 24;

/** Harvest swing of the grain yield: mean 1 over the year, sharper away from the equator. Month 0 = first month of the year. */
function grainSeason(month: number, y: number, height: number): number {
  const half = height / 2;
  const lat = Math.min(1, Math.abs(y + 0.5 - half) / half);
  const amp = 0.25 + 0.55 * lat * lat;
  const harvest = y + 0.5 > half ? 2 : 8; // southern hemisphere harvests six months earlier
  const m = wrap(month, 12);
  return 1 + amp * Math.cos((2 * Math.PI * (m - harvest)) / 12);
}

interface Links { land: number[][]; sea: number[][] }

/** True when the straight line between two places crosses no open sea. */
function overLand(world: EconomyWorld, a: EconomyPlace, b: EconomyPlace): boolean {
  const w = world.width, h = world.height;
  const dx = wrapDelta(b.x - a.x, w), dy = b.y - a.y;
  const steps = Math.ceil(Math.hypot(dx, dy));
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const i = clamp(Math.round(a.y + dy * t), 0, h - 1) * w + wrap(Math.round(a.x + dx * t), w);
    if (isOcean(world, i)) return false;
  }
  return true;
}

/**
 * Each place's trade partners, nearest first, computed once: road partners
 * within LAND_RANGE_KM over land, and (for ports) the nearest other ports by sea.
 * Capping both keeps the monthly loop linear in the number of places.
 */
function buildLinks(world: EconomyWorld, places: readonly EconomyPlace[]): Links {
  const w = world.width;
  const range = Math.max(12, Math.round(LAND_RANGE_KM / cellKmOf(world.params, w)));
  const range2 = range * range;
  const ports: number[] = [];
  places.forEach((p, i) => { if (p.port) ports.push(i); });
  // Hot (places squared): wrapped |dx| without the generic modulo helper.
  const d2 = (a: EconomyPlace, b: EconomyPlace) => {
    let dx = Math.abs(b.x - a.x);
    if (dx > w) dx %= w;
    if (dx > w / 2) dx = w - dx;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
  };
  const land: number[][] = [], sea: number[][] = [];
  for (let a = 0; a < places.length; a++) {
    const cand: Array<[number, number]> = [];
    for (let b = 0; b < places.length; b++) {
      if (b === a) continue;
      const d = d2(places[a], places[b]);
      if (d <= range2) cand.push([d, b]);
    }
    cand.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const roads: number[] = [];
    // Round the bay by land: a partner across water is still a road partner when
    // the way round (along the rivers where it can) is under DETOUR_MAX times
    // the straight line. One bounded search from this place answers them all.
    let reach: ((x: number, y: number) => number) | null = null;
    for (const [dd, b] of cand) {
      if (roads.length >= NEIGHBOUR_CAP) break;
      if (overLand(world, places[a], places[b])) { roads.push(b); continue; }
      const straight = Math.sqrt(dd);
      if (straight * DETOUR_MAX > DETOUR_RADIUS_CELLS) continue;
      reach ??= landReach(world, places[a], Math.min(DETOUR_RADIUS_CELLS, range * DETOUR_MAX));
      if (reach(places[b].x, places[b].y) <= straight * DETOUR_MAX) roads.push(b);
    }
    land.push(roads);
    const lanes: number[] = [];
    if (places[a].port) {
      const far: Array<[number, number]> = [];
      for (const b of ports) if (b !== a && !roads.includes(b)) far.push([d2(places[a], places[b]), b]);
      far.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      for (const [, b] of far.slice(0, NEIGHBOUR_CAP)) lanes.push(b);
    }
    sea.push(lanes);
  }
  return { land, sea };
}

/**
 * Run the economy month by month. Order inside a month: sea cargo from last
 * month lands, sites produce, surplus places ship to deficit places, everyone
 * consumes, prices are read off what is left.
 *
 * Price of a good at a place = clamp(sqrt(3 months * need / (stock + output)), 0.3, 5):
 * three months of supply is "usual" (1.0), a week's worth is dear, a glut is cheap.
 * Deterministic: same input, same output.
 *
 * `sites` may be passed to reuse a previous `autoSites(input)` result.
 */
export function simulateEconomy(
  input: EconomyInput, months: number, startMonth = 0, sites: TradeSite[] = autoSites(input),
): EconomySnapshot[] {
  if (typeof months !== 'number' || !Number.isFinite(months)) throw new Error('months must be a number.');
  if (typeof startMonth !== 'number' || !Number.isFinite(startMonth)) throw new Error('startMonth must be a number.');
  const { world, places } = input;
  checkWorld(world);
  const byId = indexPlaces(places);
  const total = clamp(Math.floor(months), 0, MAX_MONTHS);
  const P = places.length, G = GOODS.length;
  const grainAt = GOODS.indexOf('grain');
  /** What stands in for bread when it runs out, in order. */
  const SUBSTITUTES = [GOODS.indexOf('fish'), GOODS.indexOf('meat')];
  const fedGap = new Float64Array(P);

  const need = new Float64Array(P * G);
  const stock = new Float64Array(P * G);
  places.forEach((place, p) => {
    GOODS.forEach((good, g) => {
      need[p * G + g] = (Math.max(0, place.population) / 1000) * NEED_PER_1000[good];
      stock[p * G + g] = need[p * G + g] * INITIAL_COVER[good];
    });
  });

  // What each site yields (fitness applied once). Grain follows the harvest, so
  // farms are kept apart; everything else is a flat monthly rate.
  const flat = new Float64Array(P * G);   // non-grain output per month
  const meanGrain = new Float64Array(P);  // yearly-mean grain output
  const farms: Array<{ p: number; amount: number; y: number }> = [];
  for (const site of sites) {
    const p = site.placeId === null ? undefined : byId.get(site.placeId);
    if (p === undefined) continue;
    const fit = siteFitness(world, site.kind, site.x, site.y);
    GOODS.forEach((good, g) => {
      const amount = siteYield(site.kind, site.size, fit, good);
      if (amount <= 0) return;
      if (g === grainAt) { meanGrain[p] += amount; farms.push({ p, amount, y: site.y }); }
      else flat[p * G + g] += amount;
    });
  }

  const links = buildLinks(world, places);
  let landing: Array<{ to: number; g: number; amount: number }> = [];
  const out: EconomySnapshot[] = [];

  // Run SHORT_HORIZON months past the end so "short in N months" can be read
  // off what actually happens next (trade included), not guessed from a trend.
  const run = total + SHORT_HORIZON;
  for (let step = 0; step < run; step++) {
    const month = startMonth + step;
    const received = new Float64Array(P * G);
    const produced = new Float64Array(P * G), consumed = new Float64Array(P * G);
    const movements: Movement[] = [];

    for (const cargo of landing) {
      stock[cargo.to * G + cargo.g] += cargo.amount;
      received[cargo.to * G + cargo.g] += cargo.amount;
    }
    landing = [];

    produced.set(flat);
    for (const farm of farms) produced[farm.p * G + grainAt] += farm.amount * grainSeason(month, farm.y, world.height);
    for (let k = 0; k < produced.length; k++) stock[k] += produced[k];

    // Trade, one good at a time. Trading happens before eating, so every level
    // here is "target + this month's need". The hungriest places choose first; a
    // seller only parts with what keeps it above its own three months of need
    // after eating, so no one is both buyer and seller of a good in one month.
    // Sea cargo lands a month late, so a port that lives on it also orders next
    // month's eating (otherwise it would order every other month and swing).
    for (let g = 0; g < G; g++) {
      const buyers: number[] = [];
      for (let p = 0; p < P; p++) {
        // received[] holds only this month's landings at this point.
        const lagging = received[p * G + g] > 0;
        if (stock[p * G + g] < (STOCK_TARGET + (lagging ? 2 : 1)) * need[p * G + g]) buyers.push(p);
      }
      buyers.sort((a, b) => stock[a * G + g] / need[a * G + g] - stock[b * G + g] / need[b * G + g] || a - b);
      for (const d of buyers) {
        const nd = need[d * G + g];
        let want = (STOCK_TARGET + 1) * nd - stock[d * G + g];
        const floor = Math.max(1e-9, MIN_SHIPMENT * nd);
        const buy = (s: number, bySea: boolean) => {
          const offer = stock[s * G + g] - (STOCK_EXPORT_FLOOR + 1) * need[s * G + g];
          const amount = Math.min(offer, want);
          if (offer <= 0 || amount < floor) return;
          stock[s * G + g] -= amount;
          want -= amount;
          if (bySea) landing.push({ to: d, g, amount });
          else { stock[d * G + g] += amount; received[d * G + g] += amount; }
          movements.push({ good: GOODS[g], from: places[s].id, to: places[d].id, amount, bySea });
        };
        for (const s of links.land[d]) { if (want < floor) break; buy(s, false); }
        if (links.sea[d].length > 0 && (want >= floor || received[d * G + g] > 0)) {
          want = (STOCK_TARGET + 2) * nd - stock[d * G + g];
          for (const s of links.sea[d]) { if (want < floor) break; buy(s, true); }
        }
      }
    }

    for (let k = 0; k < stock.length; k++) {
      const eaten = Math.min(stock[k], need[k]);
      consumed[k] = eaten;
      stock[k] -= eaten;
    }
    // Where bread runs short, people eat the fish and meat left in the larder
    // instead, unit for unit. A fishing or herding village that grows no grain
    // is fed, not starving with a full smokehouse; it still shows short of bread.
    const instead = new Float64Array(P * G);
    for (let p = 0; p < P; p++) {
      let gap = need[p * G + grainAt] - consumed[p * G + grainAt];
      for (const g of SUBSTITUTES) {
        if (gap <= 1e-9) break;
        const k = p * G + g;
        const take = Math.min(gap, stock[k]);
        if (take <= 0) continue;
        stock[k] -= take; instead[k] = take; gap -= take;
      }
      fedGap[p] = gap;
    }

    const rows: PlaceEconomy[] = places.map((place, p) => {
      const row: PlaceEconomy = {
        id: place.id, name: place.name, stock: emptyGoods(), production: emptyGoods(), need: emptyGoods(),
        consumed: emptyGoods(), price: emptyGoods(), shortIn: {}, eatenInstead: {}, fed: fedGap[p] <= 1e-9,
      };
      GOODS.forEach((good, g) => {
        const k = p * G + g;
        row.stock[good] = stock[k]; row.production[good] = produced[k];
        row.need[good] = need[k]; row.consumed[good] = consumed[k];
        if (instead[k] > 0) row.eatenInstead[good] = instead[k];
        row.price[good] = need[k] > 0
          ? Math.round(clamp(Math.sqrt((USUAL_COVER * need[k]) / Math.max(stock[k] + produced[k], 1e-9)), PRICE_MIN, PRICE_MAX) * 1000) / 1000
          : 1;
      });
      return row;
    });
    out.push({ month, places: rows, movements, onTheMove: movements.length });
  }
  // Short in N months: the first month from this one on in which the place
  // could not have all it needed (0 = this very month), within the horizon.
  for (let i = 0; i < total; i++) {
    for (let p = 0; p < P; p++) {
      GOODS.forEach((good) => {
        for (let j = i; j < out.length && j - i <= SHORT_HORIZON; j++) {
          const row = out[j].places[p];
          if (row.need[good] > 0 && row.consumed[good] < row.need[good] - 1e-9) { out[i].places[p].shortIn[good] = j - i; break; }
        }
      });
    }
  }
  return out.slice(0, total);
}

/** Per good, across the places of a snapshot: the price spread and whether anyone makes it. */
export function goodsSummary(snapshot: EconomySnapshot, sites: readonly TradeSite[]): GoodSummary[] {
  return GOODS.map((good) => {
    let priceMin = Infinity, priceMax = -Infinity;
    for (const place of snapshot.places) {
      const price = place.price[good];
      if (price < priceMin) priceMin = price;
      if (price > priceMax) priceMax = price;
    }
    if (snapshot.places.length === 0) { priceMin = 1; priceMax = 1; }
    const makers = new Set<string>();
    for (const site of sites) {
      if ((SITE_OUTPUT[site.kind][good] ?? 0) > 0) makers.add(site.placeId === null ? `site:${site.id}` : `place:${site.placeId}`);
    }
    const missing = makers.size === 0;
    return { good, priceMin, priceMax, madeIn: makers.size, missing, ...(missing ? { hint: SITE_FOR_GOOD[good] } : {}) };
  });
}

// -------------------------------------------------------------- manual sites

export const SITE_ID_MAX = 80;

/** Validate and tidy one hand-placed site; throws with a readable message. */
export function normalizeTradeSite(input: unknown): TradeSite {
  if (!input || typeof input !== 'object') throw new Error('A trade site must be an object.');
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.trim().length > SITE_ID_MAX) throw new Error('id must be a short non-empty string.');
  if (raw.id.trim().startsWith('auto:')) throw new Error('id must not start with "auto:" (that is for generated sites).');
  if (!SITE_KINDS.includes(raw.kind as SiteKind)) throw new Error(`kind must be one of ${SITE_KINDS.join(', ')}.`);
  if (typeof raw.x !== 'number' || !Number.isFinite(raw.x) || typeof raw.y !== 'number' || !Number.isFinite(raw.y)) throw new Error('x and y must be numbers (world cells).');
  if (raw.size !== undefined && !SITE_SIZES.includes(raw.size as SiteSize)) throw new Error('size must be S, M or L.');
  if (raw.placeId !== undefined && raw.placeId !== null && !(typeof raw.placeId === 'number' && Number.isInteger(raw.placeId))) throw new Error('placeId must be a place id (whole number) or null.');
  return {
    id: raw.id.trim(),
    kind: raw.kind as SiteKind,
    x: Math.round(raw.x * 256) / 256,
    y: Math.round(raw.y * 256) / 256,
    size: (raw.size as SiteSize | undefined) ?? 'M',
    placeId: (raw.placeId as number | null | undefined) ?? null,
    auto: false,
  };
}

/**
 * The world-edit records. `kind` is taken by the record type, so the site's own
 * kind travels as `siteKind` (a plain `{kind:'tradeSite', ...site}` would
 * overwrite one with the other).
 */
export interface TradeSiteEdit {
  kind: 'tradeSite'; id: string; siteKind: SiteKind; x: number; y: number; size: SiteSize; placeId: number | null;
}
export interface TradeSiteRemoveEdit { kind: 'tradeSiteRemove'; id: string }
/** Switch a generated site back on after it was removed. */
export interface TradeSiteRestoreEdit { kind: 'tradeSiteRestore'; id: string }

export function tradeSiteEdit(site: TradeSite): TradeSiteEdit {
  return { kind: 'tradeSite', id: site.id, siteKind: site.kind, x: site.x, y: site.y, size: site.size, placeId: site.placeId };
}
export function tradeSiteRemoveEdit(id: string): TradeSiteRemoveEdit {
  return { kind: 'tradeSiteRemove', id };
}
export function tradeSiteRestoreEdit(id: string): TradeSiteRestoreEdit {
  return { kind: 'tradeSiteRestore', id };
}

/**
 * The manual sites an edit list holds now (a later `tradeSite` with the same id
 * replaces an earlier one, keeping its place in the order) and the generated
 * site ids the author removed. Typed loosely so this file need not import the
 * edit union; malformed records are skipped, like the other edit readers.
 */
export function tradeSitesFrom(edits: readonly { kind: string }[]): { manual: TradeSite[]; removed: string[] } {
  const manual = new Map<string, TradeSite>();
  const removed = new Set<string>();
  for (const edit of edits) {
    const raw = edit as unknown as Record<string, unknown>;
    if (edit.kind === 'tradeSite') {
      try {
        const site = normalizeTradeSite({ id: raw.id, kind: raw.siteKind, x: raw.x, y: raw.y, size: raw.size, placeId: raw.placeId });
        manual.set(site.id, site);
      } catch { /* a broken record costs only itself */ }
    } else if (edit.kind === 'tradeSiteRemove' && typeof raw.id === 'string') {
      if (!manual.delete(raw.id)) removed.add(raw.id);
    } else if (edit.kind === 'tradeSiteRestore' && typeof raw.id === 'string') {
      removed.delete(raw.id);
    }
  }
  return { manual: [...manual.values()], removed: [...removed] };
}

/** What a port has shipped and taken in by sea, month 1 up to `month` (inclusive), per good and per partner. */
export interface PortTrade {
  port: boolean;
  landed: Partial<Record<Good, number>>;
  shipped: Partial<Record<Good, number>>;
  /** Other ports traded with, most cargo first: in and out, all goods together. */
  partners: { id: number; landed: number; shipped: number }[];
}

/**
 * A port's sea trade so far. Cargo shipped in a month lands the month after,
 * so what is still at sea at `month` counts as shipped but not yet landed.
 */
export function portTrade(snapshots: readonly EconomySnapshot[], place: Pick<EconomyPlace, 'id' | 'port'>, month: number): PortTrade {
  const landed: Partial<Record<Good, number>> = {}, shipped: Partial<Record<Good, number>> = {};
  const partners = new Map<number, { id: number; landed: number; shipped: number }>();
  const last = Math.min(month, snapshots.length - 1);
  for (let m = 0; m <= last; m++) {
    for (const move of snapshots[m].movements) {
      if (!move.bySea) continue;
      if (move.from === place.id) {
        shipped[move.good] = (shipped[move.good] ?? 0) + move.amount;
        const p = partners.get(move.to) ?? { id: move.to, landed: 0, shipped: 0 };
        p.shipped += move.amount; partners.set(move.to, p);
      }
      // A cargo lands the month after it sails.
      if (move.to === place.id && m + 1 <= last) {
        landed[move.good] = (landed[move.good] ?? 0) + move.amount;
        const p = partners.get(move.from) ?? { id: move.from, landed: 0, shipped: 0 };
        p.landed += move.amount; partners.set(move.from, p);
      }
    }
  }
  return { port: place.port, landed, shipped, partners: [...partners.values()].filter((p) => p.landed + p.shipped > 0).sort((a, b) => b.landed + b.shipped - (a.landed + a.shipped)) };
}
