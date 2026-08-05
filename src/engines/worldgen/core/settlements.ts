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
import {
  buildLanguageFamily, coinName, settlementBias, type CoinedName, type Gloss,
  type Language, type LanguageFamily,
} from './language';
import { findLandforms, type Landform, type LandformKind } from './landforms';
import { generateRuins, ruinPrefix, RUIN_BIAS, type Ruin } from './ruins';
import { compatibleEditKeys, editKey, realmEditKey } from './edits';

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
  /** Etymology, when the name was coined in a generated language. */
  etym?: CoinedName;
  /** Placed by hand with the brush rather than sited by the generator. */
  painted?: boolean;
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
  etym?: CoinedName;
}

export interface HumanGeography {
  settlements: Settlement[];
  roads: Road[];
  realms: Realm[];
  /** Realm id per cell, -1 for unclaimed/water. */
  realmOf: Int32Array;
  features: NamedFeature[];
  /** Abandoned structures, sited where the world made a place worth holding. */
  ruins: Ruin[];
  /** The raw landform hits, before naming — the ruin generator wants these too. */
  landforms: Landform[];
  /** The world's language family, and which language each culture speaks. */
  languages: LanguageFamily;
  languageOf: Record<string, string>;
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

/**
 * How much of the human world to work out.
 *
 * Measured on a 2048 × 1024 grid, by timing the real calls:
 *
 *   cultures, languages, coasts, siting, realms     1 158 ms
 *   + the road network (A* between 162 towns)       7 888 ms
 *   + landforms, named geography, ruins             8 818 ms
 *   ────────────────────────────────────────────── 17 864 ms
 *
 * The 3D world and the satellite map want dots you can click and a name to put
 * beside each one. They draw no roads, no named capes and no ruins. The carta,
 * the index and the journey panel want all of it.
 *
 * Splitting that turns opening a world into a second and a bit instead of
 * eighteen, and leaves the expensive pass exactly where it always was: paid
 * once, when the reader asks for the sheet that draws it.
 *
 * NOTE FOR WHOEVER PROFILES THIS NEXT: the first attempt put timing marks at the
 * section comments and mis-attributed the cost by one phase, which sent an hour
 * of work at the wrong function. Time the CALLS.
 */
export type GeoDepth = 'places' | 'full';

/**
 * @param corrections Apply the reader's renames and deletions at the end.
 *
 * The cache in `cartography/texture.ts` asks for `false`, and there is one
 * reason: it keeps a BASE and patches it cheaply after every stroke, and a base
 * that already has the corrections baked in cannot be patched back out of them.
 * Undoing a rename left the new name on the map, because the only copy of the
 * generated name had been overwritten before the patch ever ran. With the base
 * kept free of them, `patchGeography` is the single place corrections are
 * applied and it can therefore also apply NONE of them.
 */
/**
 * Lay the reader's painted frontiers over a realm map.
 *
 * Exported and shared because it runs in TWO places that must agree exactly:
 * the full build in `buildHumanGeography`, and the cheap patch in
 * `patchGeography` that is the only thing that runs after a stroke. When they
 * drifted, the frontier brush drew nothing until a nineteen-second rebuild that
 * itself waits for the brush to be put away - which, from the reader's chair,
 * is a tool that does not work.
 *
 * Mutates `realmOf` in place and refreshes `cellCount`. Returns false and
 * touches nothing when there is no overlay, so a world nobody has painted pays
 * one property read.
 *
 * Two rules the generator's own flood fill also obeys, restated here because
 * this runs after it: a realm never holds open water, and a realm index this
 * world no longer has is ignored rather than trusted - an edit list outlives
 * the world it was drawn on, and a saved stroke naming realm 11 must not
 * corrupt a map that now has six.
 */
export function applyPaintedRealms(
  world: WorldData,
  realmOf: Int32Array,
  realms: { cellCount: number }[],
): boolean {
  const painted = world.painted?.realmCells;
  if (!painted) return false;
  const N = world.width * world.height;
  const limit = realms.length;
  const { elevation } = world;
  for (let i = 0; i < N; i++) {
    const v = painted[i];
    if (v === -2) continue;                       // untouched: the reader never said
    if (v >= limit) continue;                     // a realm this world no longer has
    realmOf[i] = elevation[i] > 0 ? v : -1;       // never claim open water
  }
  for (let r = 0; r < limit; r++) realms[r].cellCount = 0;
  for (let i = 0; i < N; i++) {
    const r = realmOf[i];
    if (r >= 0 && r < limit) realms[r].cellCount++;
  }
  return true;
}

export function buildHumanGeography(
  world: WorldData,
  params: HumanGeographyParams = DEFAULT_HUMAN_PARAMS,
  depth: GeoDepth = 'full',
  corrections = true,
): HumanGeography {
  const { width: W, height: H, elevation, biome, temperature, precipitation, flow, lake } = world;
  const seed = world.params.seed;
  const rng = createRng(seed, 'human');
  const registry = new NameRegistry(seed);
  const { cultureAt, seeds: cultureSeeds } = cultureMap(seed, W, H, params.cultureCount);

  // One living language per culture present on the map, all descended from a
  // single reconstructed proto-language — so neighbours share cognates and the
  // gazetteer can print an etymology for every name it prints.
  const cultureIds = [...new Set(cultureSeeds.map((c) => c.culture))];
  const languages = buildLanguageFamily(seed, Math.max(2, cultureIds.length));
  const languageOf: Record<string, string> = {};
  cultureIds.forEach((c, i) => { languageOf[c] = languages.living[i % languages.living.length].id; });
  const langFor = (c: CultureId): Language =>
    languages.byId.get(languageOf[c]) ?? languages.living[0];

  /** Coin a unique name in the local language. */
  const coin = (
    culture: CultureId,
    key: string,
    bias?: { heads?: Gloss[]; modifiers?: Gloss[] },
  ): CoinedName => {
    const lang = langFor(culture);
    for (let attempt = 0; attempt < 20; attempt++) {
      const n = coinName(lang, languages.proto, `${key}#${attempt}`, seed, bias);
      if (registry.claim(n.text)) return n;
    }
    return coinName(lang, languages.proto, `${key}#final`, seed, bias);
  };

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
    const b = biome[i];
    const et = coin(culture, `s${s.id}`, settlementBias({
      port,
      river: onRiver,
      capital: rank === 'capital',
      mountainous: elevation[i] > 0.9,
      forested: b === Biome.TemperateForest || b === Biome.BorealForest
        || b === Biome.TropicalForest || b === Biome.TemperateRainforest,
      arid: b === Biome.Desert || b === Biome.SaltFlat || b === Biome.Shrubland,
      cold: temperature[i] < 4,
      marshy: riverine[i] > 0.5 && elevation[i] < 0.2,
    }));
    s.etym = et;
    s.name = et.text;
    settlements.push(s);
    const k = gkey(x, y);
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push(s);
  }

  // ---- hand-placed settlements -------------------------------------------
  // Merged HERE, before realms and roads, not at the end: a painted town has to
  // join the road network and belong to a realm, or it sits on the map as an
  // orphan and every reader can see that it was added later.
  for (const m of world.painted?.markers ?? []) {
    if (m.marker !== 'settlement') continue;
    const x = ((Math.round(m.x) % W) + W) % W;
    const y = Math.min(H - 1, Math.max(0, Math.round(m.y)));
    const i = y * W + x;
    if (elevation[i] <= 0) continue;      // refuse to found a town in the sea
    const rank = m.rank ?? 'town';
    const culture = cultureAt(x, y);
    const s: Settlement = {
      id: settlements.length,
      x, y,
      name: m.name ?? coin(culture, `painted:${x},${y}`).text,
      culture,
      rank,
      population: m.population
        ?? (rank === 'capital' ? 42000 : rank === 'city' ? 16000 : rank === 'town' ? 3800 : 700),
      port: coastal[i] === 1,
      river: riverine[i] > 0.35,
      realm: -1,
      score: 1,
      painted: true,
    };
    settlements.push(s);
    const k = gkey(x, y);
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, (bucket = []));
    bucket.push(s);
  }

  // ---- realms -------------------------------------------------------------
  // A realm is named for its people, not invented separately: the same roots,
  // with a political suffix.
  const realmTitle = ['Reino de', 'Ducado de', 'Dominio de', 'Confederación de', 'Marca de', 'Principado de'];
  const { realms, realmOf } = growRealms(world, settlements, params, (idx, cap) => {
    const et = coin(cap.culture, `realm${idx}`, {
      heads: ['people', 'king', 'town', 'field', 'wall'],
      modifiers: ['great', 'old', 'holy', 'high', 'gold', 'far'],
    });
    return `${realmTitle[idx % realmTitle.length]} ${et.text}`;
  }, rng);
  /**
   * The reader's own frontiers, over the generator's.
   *
   * Applied HERE — after the flood fill and before settlements are assigned to
   * realms, roads are routed and the country is named — so a province handed to
   * a neighbour takes its towns with it, and everything downstream sees one
   * consistent map rather than a drawing laid on top of a different one.
   */
  /**
   * Only when corrections are wanted — which, from `texture.ts`, is NEVER.
   *
   * The base is deliberately built without the reader's corrections so that the
   * patch can apply them and, crucially, apply NONE of them: that is what makes
   * an undo instant. Baking the painted frontier in here would have meant that
   * undoing a lasso left the ground in the hands it had been given until the
   * next full pass — nineteen seconds, and suppressed for as long as a brush is
   * out. The overlay is applied in `patchGeography` instead, which runs after
   * every stroke and costs one grid pass.
   *
   * Kept behind the flag rather than deleted because a direct caller — the
   * benches, the forge — asks for a finished map in one call and should get
   * one.
   */
  if (corrections) applyPaintedRealms(world, realmOf, realms);

  for (const s of settlements) s.realm = realmOf[s.y * W + s.x];

  // ---- roads --------------------------------------------------------------
  // A* between every pair of towns worth joining: eight seconds, and nothing
  // outside the carta and the journey panel draws or walks them.
  const roads = depth === 'full' ? buildRoads(world, settlements, coastal) : [];

  // ---- named geography ----------------------------------------------------
  // Landforms are found once and used twice: the label layer names them, and the
  // ruin generator treats passes, straits and capes as sites worth having held.
  const landforms = depth === 'full' ? findLandforms(world) : [];
  const features = depth === 'full' ? nameGeography(world, coin, cultureAt, landforms) : [];

  // ---- ruins --------------------------------------------------------------
  // Generated ruins are part of the expensive half; ruins the reader PLACED are
  // theirs and appear at either depth, which is the loop just below.
  const ruins: Ruin[] = depth === 'full'
    ? generateRuins(world, settlements, landforms, (kind, x, y) => {
      const et = coin(cultureAt(x, y), `ruin:${kind}:${x},${y}`, RUIN_BIAS[kind]);
      return `${ruinPrefix(kind, x, y)} ${et.text}`;
    }, { density: world.params.filters?.ruinDensity ?? 1, filters: world.params.filters })
    : [];

  for (const m of world.painted?.markers ?? []) {
    if (m.marker !== 'ruin') continue;
    const x = ((Math.round(m.x) % W) + W) % W;
    const y = Math.min(H - 1, Math.max(0, Math.round(m.y)));
    const kind = m.ruin ?? 'city';
    ruins.push({
      id: ruins.length,
      kind,
      x, y,
      name: m.name
        ?? `${ruinPrefix(kind, x, y)} ${coin(cultureAt(x, y), `pruin:${x},${y}`, RUIN_BIAS[kind]).text}`,
      condition: 'overgrown',
      site: 'holy',
      importance: 0.72,
      painted: true,
    });
  }

  // ---- the reader's corrections ------------------------------------------
  // Renames and deletions of GENERATED content, applied last so they win over
  // everything the generator decided. Keyed by position rather than by index:
  // the same seed always puts the same city in the same place, but nothing
  // guarantees it keeps the same array slot once a parameter moves, and a rename
  // that survives only until a slider is touched is not a rename.
  const painted2 = corrections ? world.painted : undefined;
  const pops = world.painted?.populations ?? {};
  if (painted2 && (Object.keys(painted2.renames).length || painted2.removed.size
    || Object.keys(pops).length)) {
    const ren = painted2.renames, gone = painted2.removed;
    const keep = <T extends { x: number; y: number; name: string }>(list: T[], target: 'settlement' | 'ruin') =>
      list.filter((o) => !gone.has(editKey(target, o.x, o.y)))
        .map((o) => {
          const k = editKey(target, o.x, o.y);
          const n = ren[k];
          const pop = target === 'settlement' ? pops[k] : undefined;
          if (!n && pop === undefined) return o;
          return { ...o, ...(n ? { name: n } : {}), ...(pop === undefined ? {} : { population: pop }) };
        });
    const keptS = keep(settlements, 'settlement');
    settlements.length = 0;
    settlements.push(...keptS as Settlement[]);
    const keptR = keep(ruins, 'ruin');
    ruins.length = 0;
    ruins.push(...keptR as Ruin[]);

    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const k = editKey('feature', f.x, f.y, `${f.kind}:`);
      if (gone.has(k)) { features.splice(i--, 1); continue; }
      if (ren[k]) features[i] = { ...f, name: ren[k] };
    }
    for (let i = 0; i < realms.length; i++) {
      // Through `realmEditKey`, because this loop spelled the key by hand as
      // `realm:<id>` while the Índice was filing renames under
      // `realm:<id>:0,0` — so a renamed country kept its generated name here,
      // in the hover readout, on the map and in the frontier tool's picker,
      // and the edit sat in the list being read by nothing. The alias list is
      // what keeps a hand-edited or otherwise short-keyed save working.
      for (const k of compatibleEditKeys('realm', realmEditKey(realms[i].id))) {
        if (ren[k]) { realms[i] = { ...realms[i], name: ren[k] }; break; }
      }
    }
  }

  // Hand-drawn roads join the network; erased ones leave it.
  const finalRoads: Road[] = [];
  for (const r of roads) {
    const erased = (world.painted?.roadErasers ?? []).some((e) =>
      r.cells.some((c) => {
        const x = c % W, y = (c / W) | 0;
        let dx = Math.abs(x - e.x);
        if (dx > W / 2) dx = W - dx;
        return dx * dx + (y - e.y) ** 2 <= e.radius * e.radius;
      }));
    if (!erased) finalRoads.push(r);
  }
  for (const r of world.painted?.roads ?? []) finalRoads.push({ cells: r.cells, major: r.major });

  return { settlements, roads: finalRoads, realms, realmOf, features, ruins, landforms, languages, languageOf };
}

// ---------------------------------------------------------------------------
// Realms
// ---------------------------------------------------------------------------

function growRealms(
  world: WorldData,
  settlements: Settlement[],
  params: HumanGeographyParams,
  realmName: (idx: number, capital: Settlement) => string,
  rng: Rng,
): { realms: Realm[]; realmOf: Int32Array } {
  const { width: W, height: H, elevation, biome } = world;
  const realmOf = new Int32Array(W * H).fill(-1);
  const capitals = settlements.filter((s) => s.rank === 'capital').slice(0, params.realmCount);
  const realms: Realm[] = capitals.map((c, idx) => ({
    id: idx,
    name: realmName(idx, c),
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

// These sets must cover every biome the classifier can emit, or a whole class of
// country silently loses its names. Splitting Desert into erg/reg/badlands did
// exactly that: for one build the world had no deserts to name, because the only
// id this set knew about had stopped being assigned.
const FOREST_SET = new Set<number>([
  Biome.BorealForest, Biome.TemperateForest, Biome.TemperateRainforest,
  Biome.TropicalForest, Biome.TropicalRainforest, Biome.MonsoonForest,
  Biome.MontaneForest, Biome.CloudForest,
]);

const DESERT_SET = new Set<number>([
  Biome.Desert, Biome.SaltFlat, Biome.Erg, Biome.Reg, Biome.Badlands, Biome.ColdDesert,
]);

const PLAIN_SET = new Set<number>([
  Biome.Grassland, Biome.Savanna, Biome.Steppe,
]);

const MARSH_SET = new Set<number>([
  Biome.Marsh, Biome.SaltMarsh, Biome.Mangrove, Biome.PeatBog,
]);

/** Spanish wording per landform, varied so a coast is not forty "Cabo"s. */
const LANDFORM_LABELS: Record<LandformKind, string[]> = {
  cape: ['Cabo', 'Punta', 'Cabo'],
  bay: ['Bahía de', 'Ensenada de', 'Golfo de'],
  fjord: ['Fiordo de', 'Ría de', 'Fiordo de'],
  strait: ['Estrecho de', 'Paso de', 'Canal de'],
  isthmus: ['Istmo de', 'Lengua de', 'Istmo de'],
  peninsula: ['Península de', 'Península', 'Tierras de'],
  delta: ['Delta del', 'Bocas del', 'Delta del'],
  pass: ['Paso de', 'Puerto de', 'Collado de'],
  valley: ['Valle de', 'Cañada de', 'Vega de'],
  gorge: ['Garganta de', 'Desfiladero de', 'Tajo de'],
};

/** Which FeatureKind each landform is filed under for styling and gazetteering. */
const LANDFORM_FEATURE: Record<LandformKind, FeatureKind> = {
  cape: 'cape', bay: 'bay', fjord: 'bay', strait: 'strait', isthmus: 'cape',
  peninsula: 'cape', delta: 'marsh', pass: 'valley', valley: 'valley', gorge: 'gorge',
};

const LANDFORM_BIAS: Record<LandformKind, { heads: Gloss[]; modifiers?: Gloss[] }> = {
  cape: { heads: ['rock', 'cliff', 'stone'], modifiers: ['far', 'grey', 'wild', 'black'] },
  bay: { heads: ['bay', 'water', 'sea'], modifiers: ['quiet', 'small', 'green', 'bright'] },
  fjord: { heads: ['bay', 'water', 'cliff'], modifiers: ['cold', 'dark', 'grey', 'quiet'] },
  strait: { heads: ['gate', 'water', 'sea'], modifiers: ['small', 'dark', 'cold'] },
  isthmus: { heads: ['road', 'gate', 'field'], modifiers: ['small', 'great', 'old'] },
  peninsula: { heads: ['field', 'rock', 'people'], modifiers: ['far', 'wild', 'green'] },
  delta: { heads: ['marsh', 'water', 'river'], modifiers: ['great', 'green', 'quiet'] },
  pass: { heads: ['pass', 'gate', 'mountain'], modifiers: ['high', 'cold', 'grey'] },
  valley: { heads: ['valley', 'river', 'meadow'], modifiers: ['green', 'quiet', 'low'] },
  gorge: { heads: ['cliff', 'stone', 'valley'], modifiers: ['dark', 'black', 'cold'] },
};

/** Which roots suit which class of feature, so a mountain is not called a bay. */
const FEATURE_BIAS: Partial<Record<FeatureKind, { heads: Gloss[]; modifiers?: Gloss[] }>> = {
  continent: { heads: ['people', 'field', 'town', 'king'], modifiers: ['great', 'old', 'far'] },
  isle: { heads: ['island', 'rock', 'cliff'], modifiers: ['small', 'far', 'grey', 'wild'] },
  ocean: { heads: ['sea', 'water'], modifiers: ['great', 'far', 'dark', 'wild'] },
  sea: { heads: ['sea', 'bay', 'water'], modifiers: ['small', 'quiet', 'green'] },
  range: { heads: ['mountain', 'rock', 'cliff', 'wall'], modifiers: ['high', 'grey', 'cold', 'black'] },
  peak: { heads: ['mountain', 'rock', 'tower'], modifiers: ['high', 'white', 'holy', 'god'] },
  forest: { heads: ['forest', 'tree'], modifiers: ['dark', 'old', 'green', 'wild', 'oak', 'pine'] },
  desert: { heads: ['sand', 'stone', 'moor'], modifiers: ['white', 'warm', 'dark', 'wild'] },
  plain: { heads: ['field', 'meadow', 'moor'], modifiers: ['great', 'green', 'wild', 'horse'] },
  lake: { heads: ['lake', 'water'], modifiers: ['black', 'bright', 'quiet', 'holy'] },
  river: { heads: ['river', 'water'], modifiers: ['great', 'black', 'bright', 'salmon', 'cold'] },
};

function nameGeography(
  world: WorldData,
  coin: (c: CultureId, key: string, bias?: { heads?: Gloss[]; modifiers?: Gloss[] }) => CoinedName,
  cultureAt: (x: number, y: number) => CultureId,
  landforms: Landform[] = [],
): NamedFeature[] {
  const { width: W, height: H, elevation, biome, lake } = world;
  const out: NamedFeature[] = [];
  const total = W * H;

  const label: Partial<Record<FeatureKind, string>> = {
    continent: '', isle: 'Isla de', ocean: 'Océano', sea: 'Mar de', range: 'Montes',
    peak: 'Monte', forest: 'Bosque de', desert: 'Desierto de', plain: 'Llanura de',
    lake: 'Lago', river: 'Río', marsh: 'Marismas de',
  };
  const add = (kind: FeatureKind, cells: number[], importance: number) => {
    const a = regionAnchor(cells, W, H);
    const et = coin(cultureAt(a.x, a.y), `${kind}:${a.x},${a.y}`, FEATURE_BIAS[kind]);
    const pre = label[kind] ?? '';
    out.push({
      kind,
      name: pre ? `${pre} ${et.text}` : et.text,
      x: a.x, y: a.y,
      extent: a.extent,
      angle: a.angle,
      importance,
      etym: et,
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
    const et = coin(cultureAt(x, y), `peak:${x},${y}`, FEATURE_BIAS.peak);
    out.push({
      kind: 'peak',
      name: `Monte ${et.text}`,
      x, y, extent: 3, angle: 0, importance: 0.55, etym: et,
    });
  });

  const forests = components(W, H, (i) => elevation[i] > 0 && FOREST_SET.has(biome[i]), Math.round(total * 0.0018));
  forests.slice(0, 26).forEach((cells, idx) => add('forest', cells, 0.6 - idx * 0.015));

  const deserts = components(
    W, H,
    (i) => elevation[i] > 0 && DESERT_SET.has(biome[i]),
    Math.round(total * 0.0018),
  );
  deserts.slice(0, 14).forEach((cells, idx) => add('desert', cells, 0.6 - idx * 0.02));

  const plains = components(
    W, H,
    (i) => elevation[i] > 0 && PLAIN_SET.has(biome[i]),
    Math.round(total * 0.0026),
  );
  plains.slice(0, 14).forEach((cells, idx) => add('plain', cells, 0.45 - idx * 0.02));

  const marshes = components(
    W, H,
    (i) => elevation[i] > 0 && MARSH_SET.has(biome[i]),
    Math.round(total * 0.0007),
  );
  marshes.slice(0, 12).forEach((cells, idx) => add('marsh', cells, 0.4 - idx * 0.02));

  const lakes = components(W, H, (i) => lake[i] === 1, Math.round(total * 0.00012));
  lakes.slice(0, 18).forEach((cells, idx) => add('lake', cells, 0.5 - idx * 0.02));

  // Rivers get path labels, so they carry their cells with them.
  const byFlow = world.rivers.slice().sort((a, b) => b.flow - a.flow);
  byFlow.slice(0, 26).forEach((r, idx) => {
    const mid = r.cells[Math.floor(r.cells.length * 0.55)];
    const x = mid % W, y = (mid / W) | 0;
    const et = coin(cultureAt(x, y), `river:${x},${y}`, FEATURE_BIAS.river);
    out.push({
      kind: 'river',
      name: `Río ${et.text}`,
      etym: et,
      x, y,
      extent: r.cells.length,
      angle: 0,
      cells: Array.from(r.cells),
      importance: 0.5 + r.flow * 0.4 - idx * 0.008,
    });
  });

  // Landforms: capes, bays, straits, isthmuses, peninsulas, deltas, passes and
  // valleys. These carry their own extent and angle from the detector, so the
  // label layer can size and slant them without re-measuring anything.
  for (const lf of landforms) {
    const wording = LANDFORM_LABELS[lf.kind];
    const pre = wording[(lf.x * 7 + lf.y * 13) % wording.length];
    const et = coin(cultureAt(lf.x, lf.y), `${lf.kind}:${lf.x},${lf.y}`, LANDFORM_BIAS[lf.kind]);
    out.push({
      kind: LANDFORM_FEATURE[lf.kind],
      name: `${pre} ${et.text}`,
      x: lf.x,
      y: lf.y,
      extent: lf.extent,
      angle: lf.angle,
      cells: lf.cells,
      // Deliberately below the continent/ocean band: these are the fine print of
      // a map, and they must lose the space fight against a realm name.
      importance: 0.18 + lf.importance * 0.22,
      etym: et,
    });
  }

  return out;
}
