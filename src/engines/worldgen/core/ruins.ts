// ============================================
// World Generator — Ruins
// ============================================
// A ruin is not a decoration scattered at random. A ruin is a place that USED to
// be worth holding, and the only honest way to generate one is to look for a site
// the world itself makes valuable — and then find that nobody is using it.
//
// That is the whole idea, and it comes out of the map for free, because the
// settlement generator already scores sites. Anywhere it scored high and then
// declined to build is a place where a city plausibly stood once:
//
//   a magnificent natural harbour with no port on it
//   a pass through a range with nothing guarding it
//   a river confluence with no bridge
//   an island summit nobody watches from
//   a spring in a desert nobody drinks at
//
// Every ruin below is one of those, and the KIND follows from the site, not from
// a dice roll: passes get forts, summits get towers, confluences get bridges,
// deserts get temples, high mineral ground gets mines.

import type { WorldData, RuinKind, LandmarkType } from './types';
import type { Settlement } from './settlements';
import type { Landform } from './landforms';
import { blur, distanceTo } from './fields';
import { Biome } from './types';
import { createRng, type Rng } from './rng';
import type { Gloss } from './language';
import { DEFAULT_FILTERS, ruinKindAllowed, ruinSiteAllowed, type GenerationFilters } from './generation';

/** How a ruin has weathered. Purely descriptive — it is what the map says. */
export type RuinCondition = 'overgrown' | 'buried' | 'flooded' | 'burnt' | 'standing' | 'drowned';

export type RuinSite =
  | 'harbour' | 'pass' | 'confluence' | 'summit' | 'island' | 'oasis'
  | 'ford' | 'mineral' | 'holy' | 'strait' | 'cape';

export interface Ruin {
  id: number;
  kind: RuinKind;
  x: number;
  y: number;
  name: string;
  condition: RuinCondition;
  /** Why this spot: the geographic reason the site was ever worth anything. */
  site: RuinSite;
  /** 0–1: how large a mark it deserves on the sheet. */
  importance: number;
  /** Placed by hand with the brush rather than derived from the terrain. */
  painted?: boolean;
}

export interface RuinParams {
  /** Multiplier on the count derived from land area. */
  density: number;
  /** What the world is allowed to contain. */
  filters?: GenerationFilters;
}

export const DEFAULT_RUIN_PARAMS: RuinParams = { density: 1 };

interface Cand {
  x: number;
  y: number;
  site: RuinSite;
  /** How good the site is, before asking whether anyone is using it. */
  quality: number;
}

/** Kind implied by the site. A pass is guarded, a summit is watched from. */
const KIND_BY_SITE: Record<RuinSite, RuinKind[]> = {
  harbour: ['city', 'city', 'tower'],
  pass: ['fort', 'fort', 'wall'],
  confluence: ['bridge', 'city', 'bridge'],
  summit: ['tower', 'tower', 'temple'],
  island: ['tower', 'temple', 'fort'],
  oasis: ['temple', 'stones', 'city'],
  ford: ['bridge', 'fort', 'bridge'],
  mineral: ['mine', 'mine', 'fort'],
  holy: ['temple', 'stones', 'temple'],
  strait: ['fort', 'tower', 'wall'],
  cape: ['tower', 'temple', 'stones'],
};

const SPANISH: Record<RuinKind, string[]> = {
  city: ['Ruinas de', 'Ciudad Muerta de', 'Restos de'],
  fort: ['Fuerte de', 'Castillo de', 'Bastión de'],
  tower: ['Torre de', 'Atalaya de', 'Aguja de'],
  temple: ['Templo de', 'Santuario de', 'Altar de'],
  stones: ['Círculo de', 'Piedras de', 'Menhires de'],
  bridge: ['Puente de', 'Vado de', 'Arcos de'],
  mine: ['Minas de', 'Pozos de', 'Galerías de'],
  wall: ['Muralla de', 'Muro de', 'Cerca de'],
};

/** Naming roots that suit each kind, so a mine is not named after a bay. */
export const RUIN_BIAS: Record<RuinKind, { heads: Gloss[]; modifiers?: Gloss[] }> = {
  city: { heads: ['town', 'people', 'king', 'house'], modifiers: ['old', 'great', 'dark'] },
  fort: { heads: ['fort', 'wall', 'gate', 'battle'], modifiers: ['old', 'grey', 'black', 'high'] },
  tower: { heads: ['tower', 'rock', 'cliff'], modifiers: ['high', 'far', 'grey', 'quiet'] },
  temple: { heads: ['god', 'holy', 'stone', 'grave'], modifiers: ['old', 'holy', 'white', 'quiet'] },
  stones: { heads: ['stone', 'grave', 'god'], modifiers: ['grey', 'old', 'wild', 'cold'] },
  bridge: { heads: ['bridge', 'ford', 'water', 'road'], modifiers: ['old', 'great', 'black'] },
  mine: { heads: ['stone', 'rock', 'gold', 'grave'], modifiers: ['dark', 'black', 'cold'] },
  wall: { heads: ['wall', 'gate', 'battle'], modifiers: ['great', 'old', 'grey', 'far'] },
};

const DESERTS = new Set<number>([Biome.Desert, Biome.Erg, Biome.Reg, Biome.Badlands, Biome.ColdDesert, Biome.SaltFlat]);

/**
 * Every ruin on the map.
 *
 * `settlements` is required, not optional: without it the generator cannot tell a
 * ruin from a town, and the ruins land on top of living cities — which is exactly
 * what the first version did.
 */
export function generateRuins(
  world: WorldData,
  settlements: Settlement[],
  landforms: Landform[],
  nameFor: (kind: RuinKind, x: number, y: number) => string,
  params: RuinParams = DEFAULT_RUIN_PARAMS,
): Ruin[] {
  const { width: W, height: H, elevation, biome, lake, flow, boundary, landmarks } = world;
  const N = W * H;
  const rng = createRng(world.params.seed, 'ruins');
  const filters = params.filters ?? world.params.filters ?? DEFAULT_FILTERS;

  const seaMask = new Uint8Array(N);
  const landMask = new Uint8Array(N);
  let landCount = 0;
  for (let i = 0; i < N; i++) {
    if (elevation[i] <= 0) seaMask[i] = 1;
    else { landMask[i] = 1; landCount++; }
  }
  const toSea = distanceTo(seaMask, W, H);
  const toLand = distanceTo(landMask, W, H);
  const seaF = new Float32Array(N);
  for (let i = 0; i < N; i++) seaF[i] = seaMask[i];
  const shelter = blur(seaF, W, H, Math.max(2, Math.round(W / 170)), 2);
  const elevSmooth = blur(elevation, W, H, Math.max(3, Math.round(W / 150)), 2);

  const at = (x: number, y: number) => y * W + (((x % W) + W) % W);
  const cand: Cand[] = [];

  // --- harbours: sheltered water, deep water in reach, flat land behind -----
  for (let y = 3; y < H - 3; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!landMask[i] || toSea[i] > 1.6 || elevation[i] > 0.5) continue;
      const s = shelter[i];
      // Too exposed is a beach, too enclosed is a lagoon with no way out.
      if (s < 0.38 || s > 0.72) continue;
      let deep = 0;
      for (let d = 0; d < 8; d++) {
        const dx = [1, 1, 0, -1, -1, -1, 0, 1][d], dy = [0, 1, 1, 1, 0, -1, -1, -1][d];
        for (let k = 2; k <= 5; k++) {
          const yy = y + dy * k; if (yy < 0 || yy >= H) break;
          const j = at(x + dx * k, yy);
          if (elevation[j] < -0.35) { deep++; break; }
        }
      }
      if (deep < 2) continue;
      cand.push({ x, y, site: 'harbour', quality: 0.62 + deep * 0.045 + (0.55 - Math.abs(s - 0.55)) * 0.3 });
    }
  }

  // --- landform-derived sites -----------------------------------------------
  for (const lf of landforms) {
    if (lf.kind === 'pass') cand.push({ x: lf.x, y: lf.y, site: 'pass', quality: 0.55 + lf.importance * 0.4 });
    else if (lf.kind === 'strait' || lf.kind === 'isthmus') {
      // The narrow point is water for a strait; put the fort on the shore.
      let px = lf.x, py = lf.y, found = elevation[at(lf.x, lf.y)] > 0;
      for (let r = 1; r <= 5 && !found; r++) {
        for (let d = 0; d < 8 && !found; d++) {
          const dx = [1, 1, 0, -1, -1, -1, 0, 1][d], dy = [0, 1, 1, 1, 0, -1, -1, -1][d];
          const yy = lf.y + dy * r; if (yy < 1 || yy >= H - 1) continue;
          const j = at(lf.x + dx * r, yy);
          if (elevation[j] > 0) { px = ((lf.x + dx * r) % W + W) % W; py = yy; found = true; }
        }
      }
      if (found) cand.push({ x: px, y: py, site: 'strait', quality: 0.6 + lf.importance * 0.35 });
    } else if (lf.kind === 'cape' && rng() < 0.5) {
      cand.push({ x: lf.x, y: lf.y, site: 'cape', quality: 0.42 + lf.importance * 0.3 });
    }
  }

  // --- confluences and fords ------------------------------------------------
  // Two rivers meeting is the classic town site; a shallow crossing on one big
  // river is the classic bridge site.
  const riverAt = new Float32Array(N);
  for (const r of world.rivers) {
    for (const cell of r.cells) riverAt[cell] = Math.max(riverAt[cell], r.flow);
  }
  for (let y = 2; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!riverAt[i] || flow[i] < 0.45) continue;
      let tribs = 0;
      for (let d = 0; d < 8; d++) {
        const dx = [1, 1, 0, -1, -1, -1, 0, 1][d], dy = [0, 1, 1, 1, 0, -1, -1, -1][d];
        const j = at(x + dx * 2, Math.min(H - 1, Math.max(0, y + dy * 2)));
        if (riverAt[j] > 0.2) tribs++;
      }
      if (tribs >= 4) cand.push({ x, y, site: 'confluence', quality: 0.5 + flow[i] * 0.45 });
      else if (flow[i] > 0.66 && Math.abs(elevation[i] - elevSmooth[i]) < 0.06) {
        cand.push({ x, y, site: 'ford', quality: 0.44 + flow[i] * 0.3 });
      }
    }
  }

  // --- summits with a view --------------------------------------------------
  for (let y = 2; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!landMask[i] || elevation[i] < 0.55) continue;
      const prom = elevation[i] - elevSmooth[i];
      if (prom < 0.28) continue;
      let isMax = true;
      for (let dy = -2; dy <= 2 && isMax; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (elevation[at(x + dx, Math.min(H - 1, Math.max(0, y + dy)))] > elevation[i]) { isMax = false; break; }
        }
      }
      if (!isMax) continue;
      // High ground over a converging plate boundary is mining country, and it
      // gets claimed by the mineral pass below. Without this the two site types
      // compete for the same cells, the separation filter picks whichever came
      // first, and the map ends up with 153 watchtowers and two mines.
      if (boundary[i] >= 0.35 && elevation[i] >= 0.85) continue;
      // A watchtower is built where there is something to watch: a coast, or a
      // pass below. A peak in the middle of a massif is just a peak.
      const useful = toSea[i] < 12 ? 0.22 : 0;
      cand.push({ x, y, site: 'summit', quality: 0.36 + prom * 0.5 + useful });
    }
  }

  // --- oases: water in a desert --------------------------------------------
  for (let y = 2; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!landMask[i] || !DESERTS.has(biome[i])) continue;
      let water = 0;
      for (let dy = -3; dy <= 3; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const j = at(x + dx, yy);
          if (lake[j] || riverAt[j] > 0.1) water++;
        }
      }
      if (water < 2) continue;
      cand.push({ x, y, site: 'oasis', quality: 0.48 + Math.min(0.25, water * 0.03) });
    }
  }

  // --- mineral ground: high relief over a converging boundary ---------------
  for (let y = 2; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!landMask[i] || elevation[i] < 0.85) continue;
      const b = boundary[i];
      if (b < 0.35) continue;
      cand.push({ x, y, site: 'mineral', quality: 0.4 + b * 0.35 + Math.min(0.2, (elevation[i] - 0.85) * 0.12) });
    }
  }

  // --- holy ground: a landmark is a reason on its own ----------------------
  const HOLY: LandmarkType[] = ['hotspring', 'cave', 'waterfall', 'volcano'];
  for (const lm of landmarks) {
    if (!HOLY.includes(lm.type)) continue;
    cand.push({ x: lm.x, y: lm.y, site: 'holy', quality: 0.45 + lm.strength * 0.4 });
  }

  // --- islands: small land, far from anywhere ------------------------------
  for (let y = 2; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!landMask[i] || toSea[i] > 2.2) continue;
      // Deep water all round within a short reach = a rock in the open sea.
      if (toLand[at(x + 8, y)] > 0 || elevation[i] < 0.05) continue;
      let open = 0;
      for (let d = 0; d < 8; d++) {
        const dx = [1, 1, 0, -1, -1, -1, 0, 1][d], dy = [0, 1, 1, 1, 0, -1, -1, -1][d];
        const yy = Math.min(H - 1, Math.max(0, y + dy * 7));
        if (elevation[at(x + dx * 7, yy)] <= 0) open++;
      }
      if (open < 7) continue;
      cand.push({ x, y, site: 'island', quality: 0.4 + Math.min(0.3, elevation[i] * 0.2) });
    }
  }

  // --- the filter that makes them ruins ------------------------------------
  // Multiply site quality by how UNUSED the site is. A superb harbour with a city
  // on it scores zero; the same harbour empty scores its full quality.
  const scored = cand.map((cd) => {
    let near = Infinity;
    for (const s of settlements) {
      let dx = Math.abs(s.x - cd.x);
      if (dx > W / 2) dx = W - dx;
      const dy = s.y - cd.y;
      const d = Math.hypot(dx, dy) / (s.rank === 'capital' ? 0.45 : s.rank === 'city' ? 0.6 : s.rank === 'town' ? 0.8 : 1);
      if (d < near) near = d;
    }
    const unused = Math.min(1, near / Math.max(6, W / 78));
    return { ...cd, score: cd.quality * (0.15 + unused * 0.85) };
  }).filter((s) => s.score > 0.32 && ruinSiteAllowed(s.site, filters));

  scored.sort((a, b) => b.score - a.score);

  // A floor of six was right for "the world should not feel empty" and wrong for
  // "the reader asked for none": density 0 has to mean zero, or the switch lies.
  const target = params.density <= 0 ? 0 : Math.max(6, Math.round((landCount / 5200) * params.density));
  if (target === 0) return [];
  const sep = Math.max(8, W / 105);

  // Take the best of each site type in turn instead of the best overall.
  //
  // A single global ranking gave a planet with nothing but hill-top towers and
  // harbour cities, because summits and harbours produce thousands of candidates
  // and passes produce fourteen. Round-robin costs a little average site quality
  // and buys the thing that actually matters: a map where no two ruins are
  // there for the same reason.
  const queues = new Map<RuinSite, typeof scored>();
  for (const s of scored) {
    let q = queues.get(s.site);
    if (!q) queues.set(s.site, (q = []));
    q.push(s);
  }
  const order = [...queues.keys()].sort(
    (a, b) => (queues.get(b)![0]?.score ?? 0) - (queues.get(a)![0]?.score ?? 0),
  );
  const roundRobin: typeof scored = [];
  for (let round = 0; roundRobin.length < scored.length; round++) {
    let any = false;
    for (const site of order) {
      const q = queues.get(site)!;
      if (round >= q.length) continue;
      roundRobin.push(q[round]);
      any = true;
    }
    if (!any) break;
  }

  const out: Ruin[] = [];
  const sep2 = sep * sep;
  for (const s of roundRobin) {
    let ok = true;
    for (const o of out) {
      let dx = Math.abs(o.x - s.x);
      if (dx > W / 2) dx = W - dx;
      const dy = o.y - s.y;
      if (dx * dx + dy * dy < sep2) { ok = false; break; }
    }
    if (!ok) continue;
    const pool = KIND_BY_SITE[s.site].filter((k) => ruinKindAllowed(k, filters));
    // A site whose every structure kind is switched off simply has no ruin —
    // rather than falling back to one the reader explicitly forbade.
    if (!pool.length) continue;
    const kind = pool[Math.floor(rng() * pool.length) % pool.length];
    out.push({
      id: out.length,
      kind,
      x: s.x,
      y: s.y,
      name: nameFor(kind, s.x, s.y),
      condition: conditionFor(world, s.x, s.y, kind, rng),
      site: s.site,
      importance: Math.min(1, s.score),
    });
    if (out.length >= target) break;
  }
  return out;
}

/**
 * How the ruin reads on the ground, from the climate it stands in. Jungle
 * swallows things; desert buries them; a marsh drowns them. Only cold dry
 * uplands leave anything standing.
 */
function conditionFor(world: WorldData, x: number, y: number, kind: RuinKind, rng: Rng): RuinCondition {
  const i = y * world.width + x;
  const b = world.biome[i];
  const P = world.precipitation[i];
  const T = world.temperature[i];
  if (b === Biome.Marsh || b === Biome.SaltMarsh || b === Biome.Mangrove || b === Biome.PeatBog) return 'flooded';
  if (DESERTS.has(b)) return rng() < 0.72 ? 'buried' : 'standing';
  if (P > 1400 && T > 16) return 'overgrown';
  if (kind === 'city' && rng() < 0.22) return 'burnt';
  // Cold dry uplands are the only climate that leaves masonry standing — and even
  // there most of it doesn't. "Standing" was the majority verdict on the first
  // pass, which made the whole set read as abandoned rather than ruined.
  if (T < 1 || (P < 500 && T < 12)) return rng() < 0.42 ? 'standing' : 'overgrown';
  return rng() < 0.72 ? 'overgrown' : 'standing';
}

/** Spanish prefix for a ruin's coined stem, varied per kind. */
export function ruinPrefix(kind: RuinKind, x: number, y: number): string {
  const opts = SPANISH[kind];
  // Deterministic from position so the same ruin keeps its wording.
  return opts[(x * 7 + y * 13) % opts.length];
}

/**
 * CLAVES de catálogo para la UI, no texto (las tablas `_ES` con español a
 * fuego eran motor fuera de i18n). El gazetteer — que es un documento en
 * castellano por diseño, como los nombres que acuña `naming.ts` — lleva sus
 * propias tablas de prosa junto al resto de su prosa.
 */
export const RUIN_KIND_KEY: Record<RuinKind, string> = {
  city: 'worldgen.ruinKind.city',
  fort: 'worldgen.ruinKind.fort',
  tower: 'worldgen.ruinKind.tower',
  temple: 'worldgen.ruinKind.temple',
  stones: 'worldgen.ruinKind.stones',
  bridge: 'worldgen.ruinKind.bridge',
  mine: 'worldgen.ruinKind.mine',
  wall: 'worldgen.ruinKind.wall',
};

export const RUIN_SITE_KEY: Record<RuinSite, string> = {
  harbour: 'worldgen.ruinSite.harbour',
  pass: 'worldgen.ruinSite.pass',
  confluence: 'worldgen.ruinSite.confluence',
  summit: 'worldgen.ruinSite.summit',
  island: 'worldgen.ruinSite.island',
  oasis: 'worldgen.ruinSite.oasis',
  ford: 'worldgen.ruinSite.ford',
  mineral: 'worldgen.ruinSite.mineral',
  holy: 'worldgen.ruinSite.holy',
  strait: 'worldgen.ruinSite.strait',
  cape: 'worldgen.ruinSite.cape',
};
