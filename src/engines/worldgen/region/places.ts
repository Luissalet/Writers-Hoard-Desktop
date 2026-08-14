// ============================================
// Regional sheet — Habitation
// ============================================
// Where people live when you can see individual farms.
//
// The hard requirement here is not realism, it is STABILITY: pan the sheet ten
// metres east and every hamlet must stay exactly where it was, keep its name and
// keep its rank. A generator that scores the sheet grid and takes the best N
// cells fails all three, because the grid, the candidate set and the ranking all
// move with the window.
//
// So habitation is sited on a lattice anchored to WORLD coordinates, not to the
// sheet: each lattice square owns one deterministically jittered candidate point
// whose name key is the lattice index. Acceptance is a local-maximum test inside
// a fixed radius — a property of the candidate and its neighbours, not of the
// window — and rank comes from absolute score thresholds rather than from a
// sorted position in a list that changes size. The result is a country that
// exists independently of where you happen to be looking at it.

import { createRng } from '../core/rng';
import { coinName, settlementBias, type LanguageFamily } from '../core/language';
import type { HumanGeography, Settlement } from '../core/settlements';
import { zoneAllowsWorld, type SitesPolicy } from '../core/edits';
import type { WorldData } from '../core/types';
import { Cover, type RegionParams, type RegionPlace, type RegionStream } from './types';
import { patchBilinear, type RegionGeometry, type TerrainFields, type WorldPatch } from './terrain';
import {
  childRegionSourceKey,
  habitationSourceKey,
  materializeRegionPlace,
  regionalSourceKeyAt,
  worldRuinSourceKey,
  worldSettlementSourceKey,
} from './identity';

/** 32-bit mix of two lattice indices — stable, cheap, no allocation. */
function hash2(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Candidate {
  /** World cell coordinates. */
  wx: number;
  wy: number;
  /** Sheet cell coordinates. */
  x: number;
  y: number;
  a: number;
  b: number;
  score: number;
}

/**
 * ¿Puede sembrarse un lugar en esta celda de la HOJA?
 *
 * La pregunta se contesta en coordenadas del MUNDO (las zonas son pinceladas
 * guardadas en celdas del mundo, con envoltura en x), y la respuesta sigue la
 * semántica de pintar: se parte del grifo global y la ÚLTIMA zona que pisa el
 * punto decide. Sin política (bancos, llamantes de siempre): todo permitido.
 */
export function siteAllower(
  policy: SitesPolicy | undefined,
  g: RegionGeometry,
  worldWidth: number,
): (x: number, y: number) => boolean {
  if (!policy) return () => true;
  if (!policy.zones.length) {
    const all = policy.everywhere;
    return () => all;
  }
  // La misma pregunta que la geografía humana del mundo, con la misma
  // aritmética: `zoneAllowsWorld` (core/edits). Aquí sólo se traduce de celda
  // de HOJA a celda de MUNDO antes de preguntar.
  return (x: number, y: number): boolean => {
    const wx = ((g.originX + x * g.worldPerCellX) % worldWidth + worldWidth) % worldWidth;
    const wy = g.originY + y * g.worldPerCellY;
    return zoneAllowsWorld(policy, wx, wy, worldWidth);
  };
}

/**
 * Two-pass chamfer distance transform, in cells.
 *
 * `init` may carry a NON-ZERO starting distance, which is what lets a feature
 * outside the grid still be measured from. A town two hundred cells off the
 * north edge is clamped to the edge and seeded with the distance it really is —
 * so a hamlet near that edge knows it is near a town, instead of concluding it
 * is in the middle of nowhere and quietly changing rank the moment the reader
 * pans far enough to bring the town onto the page.
 */
export function chamferFrom(init: Float32Array, W: number, H: number): Float32Array {
  const n = W * H;
  const d = new Float32Array(n);
  d.set(init);
  const D1 = 1, D2 = 1.41421356;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + D1);
      if (y > 0) v = Math.min(v, d[i - W] + D1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - W - 1] + D2);
      if (x < W - 1 && y > 0) v = Math.min(v, d[i - W + 1] + D2);
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + D1);
      if (y < H - 1) v = Math.min(v, d[i + W] + D1);
      if (x < W - 1 && y < H - 1) v = Math.min(v, d[i + W + 1] + D2);
      if (x > 0 && y < H - 1) v = Math.min(v, d[i + W - 1] + D2);
      d[i] = v;
    }
  }
  return d;
}

export interface SiteFields {
  /** Distance in cells to running water. */
  toStream: Float32Array;
  /** Distance in cells to standing water or the sea. */
  toWater: Float32Array;
  /** Distance in cells to a world road passing through the sheet. */
  toRoad: Float32Array;
  /** Distance in cells to a world settlement inside the sheet. */
  toTown: Float32Array;
}

export function buildSiteFields(
  world: WorldData,
  geo: HumanGeography,
  g: RegionGeometry,
  t: TerrainFields,
  streams: RegionStream[],
): SiteFields {
  const W = g.width, H = g.height, n = W * H;
  const BIG = 1e9;
  const WW = world.width;

  const toSheet = (wx: number, wy: number) => {
    let dx = wx - g.originX;
    while (dx < -WW / 2) dx += WW;
    while (dx > WW / 2) dx -= WW;
    return { x: dx / g.worldPerCellX, y: (wy - g.originY) / g.worldPerCellY };
  };

  /**
   * Seed a distance field from points that may lie OUTSIDE the grid.
   *
   * The obvious version — mark the cells the points land in and run a chamfer —
   * silently answers "infinitely far" for anything off the page, which makes the
   * whole field depend on where the page happens to be. Clamping the point to
   * the nearest border cell and seeding it with its true outside distance costs
   * nothing and makes the field a property of the world instead.
   */
  const seedFrom = (pts: { x: number; y: number }[]): Float32Array => {
    const init = new Float32Array(n).fill(BIG);
    let any = false;
    for (const p of pts) {
      const cx = Math.min(W - 1, Math.max(0, Math.round(p.x)));
      const cy = Math.min(H - 1, Math.max(0, Math.round(p.y)));
      // Only bother with things near enough to matter; beyond a few hundred
      // cells the answer is "far" either way.
      const out = Math.hypot(p.x - cx, p.y - cy);
      if (out > Math.max(W, H)) continue;
      const i = cy * W + cx;
      if (out < init[i]) init[i] = out;
      any = true;
    }
    return any ? chamferFrom(init, W, H) : init;
  };

  const streamPts: { x: number; y: number }[] = [];
  for (const s of streams) for (const p of s.pts) streamPts.push(p);

  const waterInit = new Float32Array(n).fill(BIG);
  let anyWater = false;
  for (let i = 0; i < n; i++) if (t.water[i] !== 0) { waterInit[i] = 0; anyWater = true; }

  const roadPts: { x: number; y: number }[] = [];
  for (const r of geo.roads) {
    for (const c of r.cells) roadPts.push(toSheet(c % WW, (c / WW) | 0));
  }
  const townPts = geo.settlements.map((s) => toSheet(s.x, s.y));

  return {
    toStream: seedFrom(streamPts),
    toWater: anyWater ? chamferFrom(waterInit, W, H) : waterInit,
    toRoad: seedFrom(roadPts),
    toTown: seedFrom(townPts),
  };
}

/** Cover quality for living on, 0–1. */
const SOIL: Partial<Record<number, number>> = {
  [Cover.Meadow]: 0.94, [Cover.Grass]: 0.9, [Cover.Wood]: 0.78, [Cover.Coppice]: 0.82,
  [Cover.Scrub]: 0.6, [Cover.Heath]: 0.5, [Cover.Moor]: 0.26, [Cover.Marsh]: 0.08,
  [Cover.Beach]: 0.3, [Cover.Dune]: 0.05, [Cover.Waste]: 0.06, [Cover.Rock]: 0.03,
  [Cover.Scree]: 0.02, [Cover.Snow]: 0, [Cover.Sea]: 0, [Cover.Lake]: 0,
  [Cover.Pasture]: 0.9, [Cover.Arable]: 0.95, [Cover.Orchard]: 0.9, [Cover.Vineyard]: 0.85,
};

/**
 * How good a spot this is to put a house on.
 *
 * Weighted rather than ranked, and the weights are the ones that actually
 * decided where villages went: water you can carry, ground you can plough,
 * a slope that drains but does not exhaust you, and — the one that shapes the
 * map more than any other — a position on the way to somewhere.
 */
function siteScore(
  g: RegionGeometry, t: TerrainFields, cover: Uint8Array, f: SiteFields, i: number,
): number {
  if (t.water[i] !== 0) return 0;
  const soil = SOIL[cover[i]] ?? 0.5;
  if (soil < 0.05) return 0;
  const slope = t.slope[i];
  if (slope > 0.34) return 0;

  const cellKm = g.metresPerCell / 1000;
  const dStream = f.toStream[i] * cellKm;
  const dWater = f.toWater[i] * cellKm;
  const dRoad = f.toRoad[i] * cellKm;
  const dTown = f.toTown[i] * cellKm;

  // Water: close is essential, ON it is a flood risk.
  const water = dStream < 0.12 ? 0.55
    : dStream < 1.2 ? 1 - (dStream - 0.4) * 0.12
      : Math.max(0.12, 0.9 - (dStream - 1.2) * 0.34);
  const shore = dWater < 0.9 ? 0.16 : 0;

  const ground = soil * (slope < 0.02 ? 0.9 : slope < 0.12 ? 1 : slope < 0.22 ? 0.78 : 0.42);
  const drainage = t.wet[i] > 0.8 ? 0.35 : 1;
  const road = dRoad < 0.5 ? 0.42 : dRoad < 3 ? 0.42 - (dRoad - 0.5) * 0.13 : 0.06;
  // Right up against a town is the town; a couple of leagues out is its country.
  const town = dTown < 1.4 ? 0 : dTown < 5 ? 0.2 : dTown < 16 ? 0.1 : 0;
  const height = t.elevation[i] > 2.2 ? 0.25 : t.elevation[i] > 1.4 ? 0.7 : 1;

  return (water * 1.15 + ground * 1.35 + road + town + shore) * drainage * height;
}

export interface HabitationResult {
  places: RegionPlace[];
  fields: SiteFields;
}

/**
 * Site every regional place on the sheet.
 *
 * `geo` supplies the world's own settlements, roads, ruins and — importantly —
 * its languages, so a hamlet nobody has ever heard of is still named in the same
 * tongue as the county town twelve kilometres away.
 */
export function buildHabitation(
  world: WorldData,
  geo: HumanGeography,
  g: RegionGeometry,
  patch: WorldPatch,
  t: TerrainFields,
  cover: Uint8Array,
  streams: RegionStream[],
  params: RegionParams,
  /** El permiso de sembrado (ver `RegionParams.sites`). Ausente = todo
   *  permitido, el comportamiento de siempre para bancos y llamantes viejos. */
  policy?: SitesPolicy,
): HabitationResult {
  const W = g.width, H = g.height;
  const f = buildSiteFields(world, geo, g, t, streams);
  const places: RegionPlace[] = [];
  let id = 0;
  const WW = world.width;
  const allow = siteAllower(policy, g, WW);
  // Con el grifo cerrado y ni una zona que pise la hoja, el sembrado entero es
  // un no-op: ni candidatos, ni abadías, ni molinos — y `applyHabitation`,
  // `buildTracks` y `buildFields` reciben una lista vacía y dibujan el país
  // deshabitado (los caminos del MUNDO y sus pueblos no pasan por aquí).
  const deadSheet = !!policy && !policy.everywhere
    && !policy.zones.some((z) => z.mode === 'add');

  const toSheet = (wx: number, wy: number) => {
    let dx = wx - g.originX;
    while (dx < -WW / 2) dx += WW;
    while (dx > WW / 2) dx -= WW;
    return { x: dx / g.worldPerCellX, y: (wy - g.originY) / g.worldPerCellY };
  };

  // ---- the world's own places come through unchanged -----------------------
  const townCulture: Settlement[] = [];
  for (const s of geo.settlements) {
    const p = toSheet(s.x, s.y);
    if (p.x < -8 || p.x > W + 8 || p.y < -8 || p.y > H + 8) continue;
    townCulture.push(s);
    places.push(materializeRegionPlace({
      id: id++,
      kind: 'town',
      x: p.x, y: p.y,
      name: s.name,
      importance: s.rank === 'capital' ? 1 : s.rank === 'city' ? 0.82 : s.rank === 'town' ? 0.6 : 0.4,
      worldId: s.id,
      households: Math.round(s.population / 4.5),
      culture: s.culture,
    }, g, WW, worldSettlementSourceKey(s.x, s.y)));
  }
  for (const r of geo.ruins) {
    const p = toSheet(r.x, r.y);
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
    places.push(materializeRegionPlace({
      id: id++, kind: 'ruin', x: p.x, y: p.y, name: r.name,
      importance: r.importance, ruinKind: r.kind,
    }, g, WW, worldRuinSourceKey(r.x, r.y)));
  }

  const cultureAt = (x: number, y: number): Settlement | undefined => {
    let best: Settlement | undefined;
    let bd = Infinity;
    for (const s of townCulture) {
      const p = toSheet(s.x, s.y);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  const fam: LanguageFamily = geo.languages;
  const langFor = (c?: string) => {
    const id = c ? geo.languageOf[c] : undefined;
    return fam.living.find((l) => l.id === id) ?? fam.living[0];
  };

  // ---- the world-anchored candidate lattice --------------------------------
  // One candidate per ~2.6 km square: dense enough that the local-maximum test
  // has something to choose between, coarse enough that the whole sheet is a
  // few thousand candidates rather than a quarter of a million.
  const cellKm = g.metresPerCell / 1000;
  const km2Cell = cellKm * cellKm;
  const kmPerWorld = cellKm / g.worldPerCellX;
  const latticeWorld = 2.6 / kmPerWorld; // lattice pitch in world cells
  const margin = 3; // lattice squares of overhang, so the local-max test is complete

  const a0 = Math.floor(g.originX / latticeWorld) - margin;
  const a1 = Math.ceil((g.originX + W * g.worldPerCellX) / latticeWorld) + margin;
  const b0 = Math.floor(g.originY / latticeWorld) - margin;
  const b1 = Math.ceil((g.originY + H * g.worldPerCellY) / latticeWorld) + margin;

  const cands: Candidate[] = [];
  for (let b = b0; b <= b1; b++) {
    for (let a = a0; a <= a1; a++) {
      const jx = hash2(a, b, 1), jy = hash2(a, b, 2);
      const wx = (a + 0.15 + jx * 0.7) * latticeWorld;
      const wy = (b + 0.15 + jy * 0.7) * latticeWorld;
      const p = toSheet(wx, wy);
      const xi = Math.round(p.x), yi = Math.round(p.y);
      let score = 0;
      if (xi >= 2 && xi < W - 2 && yi >= 2 && yi < H - 2) {
        // Averaged over a small neighbourhood rather than read off one cell.
        // A single cell can flip — a brook appears, a slope crosses a threshold
        // — and with the score read from one cell that flip decides whether a
        // village exists. Averaging five samples makes the decision a property
        // of the SITE rather than of one pixel of it, which is both truer and
        // the difference between 86 % and 96 % of names surviving a pan.
        const at = (dx: number, dy: number) => siteScore(g, t, cover, f, (yi + dy) * W + (xi + dx));
        score = (at(0, 0) * 2 + at(-2, 0) + at(2, 0) + at(0, -2) + at(0, 2)) / 6;
        // A per-candidate roll, so identical ground does not produce a perfect
        // grid of villages. Multiplicative, so it cannot rescue bad ground.
        score *= 0.72 + hash2(a, b, 3) * 0.56;
        // Quantised, because the local-maximum test compares scores and the
        // scores are read off a grid that shifts with the window. Two candidates
        // whose scores differ in the fourth decimal are, for map purposes,
        // equally good — and letting that difference decide which one becomes a
        // village is how panning renames half the parish. Ties break on the
        // lattice index, which does not move.
        score = Math.round(score * 48) / 48;
      }
      cands.push({ wx, wy, x: p.x, y: p.y, a, b, score });
    }
  }

  // Local-maximum acceptance. Radius in lattice squares, so it is a property of
  // the lattice rather than of the window.
  const byIndex = new Map<number, Candidate>();
  const KEY = 100003;
  for (const c of cands) byIndex.set(c.a * KEY + c.b, c);
  const isLocalMax = (c: Candidate, r: number): boolean => {
    for (let db = -r; db <= r; db++) {
      for (let da = -r; da <= r; da++) {
        if (!da && !db) continue;
        if (da * da + db * db > r * r) continue;
        const o = byIndex.get((c.a + da) * KEY + (c.b + db));
        if (!o) continue;
        if (o.score > c.score) return false;
        // Deterministic tie-break, so two equal scores never both win.
        if (o.score === c.score && (o.a * KEY + o.b) < (c.a * KEY + c.b)) return false;
      }
    }
    return true;
  };

  const hab = params.habitation;
  // Absolute thresholds: rank must not depend on how many other candidates the
  // window happens to contain.
  const T_VILLAGE = 2.05 / Math.max(0.35, hab);
  const T_HAMLET = 1.62 / Math.max(0.35, hab);
  const T_FARM = 1.24 / Math.max(0.35, hab);

  for (const c of cands) {
    if (c.score < T_FARM) continue;
    // El permiso ANTES que el máximo local: un vecino vetado no debe robar la
    // plaza (su celda sigue contando para el máximo — el enrejado es del
    // mundo — pero él no se siembra).
    if (!allow(c.x, c.y)) continue;
    if (c.x < -2 || c.x > W + 2 || c.y < -2 || c.y > H + 2) continue;
    const kind = c.score >= T_VILLAGE && isLocalMax(c, 3) ? 'village'
      : c.score >= T_HAMLET && isLocalMax(c, 2) ? 'hamlet'
        : isLocalMax(c, 1) ? 'farm' : null;
    if (!kind) continue;
    // Never plant a hamlet inside a town the world already put here.
    const xi = Math.min(W - 1, Math.max(0, Math.round(c.x)));
    const yi = Math.min(H - 1, Math.max(0, Math.round(c.y)));
    if (f.toTown[yi * W + xi] * cellKm < (kind === 'village' ? 2.4 : 1.5)) continue;

    const near = cultureAt(c.x, c.y);
    const lang = langFor(near?.culture);
    const i = yi * W + xi;
    const bias = settlementBias({
      port: f.toWater[i] * cellKm < 0.8 && t.elevation[i] < 0.06,
      river: f.toStream[i] * cellKm < 0.5,
      capital: false,
      mountainous: t.elevation[i] > 0.9 || t.slope[i] > 0.2,
      forested: cover[i] === Cover.Wood || cover[i] === Cover.Coppice,
      arid: cover[i] === Cover.Waste || cover[i] === Cover.Dune || cover[i] === Cover.Scrub,
      cold: patchBilinear(patch, patch.temp, c.wx, c.wy) < 3,
      marshy: cover[i] === Cover.Marsh,
    });
    const key = `r:${c.a}:${c.b}`;
    const coined = coinName(lang, fam.proto, key, world.params.seed, bias);
    const households = kind === 'village' ? 18 + Math.floor(hash2(c.a, c.b, 7) * 40)
      : kind === 'hamlet' ? 4 + Math.floor(hash2(c.a, c.b, 7) * 11)
        : 1 + Math.floor(hash2(c.a, c.b, 7) * 3);
    places.push(materializeRegionPlace({
      id: id++,
      kind,
      x: c.x, y: c.y,
      name: kind === 'farm' ? farmName(coined.text, world.params.seed, key) : coined.text,
      importance: kind === 'village' ? 0.34 : kind === 'hamlet' ? 0.2 : 0.1,
      households,
      culture: near?.culture,
    }, g, WW, habitationSourceKey(c.a, c.b)));
  }

  // ---- water mills ---------------------------------------------------------
  // On the stream, below a fall, and within reach of somewhere to take the flour.
  // A watermill is a capital investment with a lord behind it, so it belongs to
  // a village or a town. Letting hamlets have one put twenty-five mills on a
  // sheet and made "Molino de …" the commonest phrase on the page.
  const settled = places.filter((p) => p.kind === 'village' || p.kind === 'town');
  const milled = new Set<number>();
  for (const s of streams) {
    if (s.pts.length < 12) continue;
    for (let k = 6; k < s.pts.length - 6; k += 5) {
      const p = s.pts[k], q = s.pts[k + 4];
      const xi = Math.round(p.x), yi = Math.round(p.y);
      if (xi < 0 || xi >= W || yi < 0 || yi >= H) continue;
      const i = yi * W + xi;
      if (t.accum[i] * km2Cell < 14) continue;
      const drop = (t.elevation[yi * W + xi] - t.elevation[
        Math.min(H - 1, Math.max(0, Math.round(q.y))) * W + Math.min(W - 1, Math.max(0, Math.round(q.x)))
      ]) * 1000;
      if (drop < 3.5) continue;
      let host: RegionPlace | null = null;
      let bd = Infinity;
      for (const pl of settled) {
        const d = Math.hypot(pl.x - p.x, pl.y - p.y);
        if (d < bd) { bd = d; host = pl; }
      }
      if (!host || bd * cellKm > 2.6) continue;
      // One mill per village. Manorial law was quite firm about this, and
      // without it a stream past three hamlets grows nine of them.
      if (milled.has(host.id)) continue;
      if (places.some((o) => o.kind === 'mill' && Math.hypot(o.x - p.x, o.y - p.y) * cellKm < 3.5)) continue;
      // El molino también pide permiso: su aldea puede estar dentro de la zona
      // y el tramo de río útil, fuera de ella.
      if (!allow(p.x, p.y)) continue;
      milled.add(host.id);
      places.push(materializeRegionPlace({
        id: id++, kind: 'mill', x: p.x, y: p.y,
        name: `Molino de ${stripArticle(host.name)}`,
        importance: 0.14,
      }, g, WW, childRegionSourceKey(host.sourceKey, 'mill')));
    }
  }

  // ---- the singular buildings ---------------------------------------------
  // `deadSheet` se lo salta entero: con el grifo cerrado y ninguna zona `add`
  // en la lista, puntuar candidatos de abadía es trabajo para una respuesta
  // conocida.
  if (!deadSheet) {
    addAbbey(places, () => id++, g, t, cover, f, geo, world, allow);
    addTowers(places, () => id++, g, t, f, world, allow);
    addWorkings(places, () => id++, g, t, cover, f, world, allow);
    addInns(places, () => id++, g, f, world, allow);
  }

  return { places, fields: f };
}

function stripArticle(n: string): string {
  return n.replace(/^(El|La|Los|Las|Puerto|Alto|Gran)\s+/i, '');
}

const FARM_FORMS = ['Casa de {n}', 'Casal de {n}', 'Alquería de {n}', 'Granja de {n}',
  'Cortijo de {n}', 'Majada de {n}', 'Caserío de {n}', 'Venta de {n}'];

function farmName(stem: string, seed: string, key: string): string {
  const rng = createRng(seed, `farm:${key}`);
  return FARM_FORMS[Math.floor(rng() * FARM_FORMS.length)].replace('{n}', stem);
}

/** An abbey wants good land, water, and to be a decent walk from the town. */
function addAbbey(
  places: RegionPlace[], nextId: () => number, g: RegionGeometry, t: TerrainFields,
  cover: Uint8Array, f: SiteFields, geo: HumanGeography, world: WorldData,
  allow: (x: number, y: number) => boolean,
): void {
  const W = g.width, H = g.height;
  const cellKm = g.metresPerCell / 1000;
  const areaKm2 = W * H * cellKm * cellKm;
  const want = Math.max(0, Math.round(areaKm2 / 4200));
  if (want === 0) return;
  const WW = world.width;
  const scored: { i: number; s: number }[] = [];
  for (let i = 0; i < W * H; i++) {
    if (t.water[i] !== 0 || t.slope[i] > 0.2) continue;
    const soil = SOIL[cover[i]] ?? 0;
    if (soil < 0.5) continue;
    // Everything about a candidate is a function of the GROUND, never of the
    // window. The old loop strode `i += 3` through sheet indices — two panned
    // grids sampled disjoint candidate sets and agreed on nothing — and broke
    // ties with an origin-seeded RNG stream on top. Now the one-in-three
    // decimation and the tie-break both hash the world position (1/256-cell
    // lattice, wrapped), so every window elects abbeys from the same ballot.
    const wx = g.originX + ((i % W) + 0.5) * g.worldPerCellX;
    const wy = g.originY + (((i / W) | 0) + 0.5) * g.worldPerCellY;
    const qa = Math.round((((wx % WW) + WW) % WW) * 256);
    const qb = Math.round(wy * 256);
    if (hash2(qa, qb, 4) >= 1 / 3) continue;
    const dTown = f.toTown[i] * cellKm;
    const dStream = f.toStream[i] * cellKm;
    if (dStream > 1.1 || dTown < 3.5 || dTown > 22) continue;
    scored.push({ i, s: soil * 1.2 + (1 - Math.abs(dTown - 8) / 12) + hash2(qa, qb, 5) * 0.35 });
  }
  scored.sort((a, b) => b.s - a.s);
  const fam = geo.languages;
  for (let k = 0, placed = 0; k < scored.length && placed < want; k++) {
    const i = scored[k].i;
    const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5;
    if (!allow(x, y)) continue;
    if (places.some((p) => Math.hypot(p.x - x, p.y - y) * cellKm < 4)) continue;
    const sourceKey = regionalSourceKeyAt('abbey', g, { x, y }, world.width);
    const nameRng = createRng(world.params.seed, sourceKey);
    const coined = coinName(fam.living[0], fam.proto, sourceKey,
      world.params.seed, { heads: ['holy', 'god', 'stone', 'water'], modifiers: ['white', 'old', 'quiet', 'green'] });
    places.push(materializeRegionPlace({
      id: nextId(), kind: 'abbey', x, y,
      name: `${nameRng() < 0.5 ? 'Abadía' : 'Monasterio'} de ${coined.text}`,
      importance: 0.4,
    }, g, world.width, sourceKey));
    placed++;
  }
}

/** Watchposts go on the ground that can see, above the road it is watching. */
function addTowers(
  places: RegionPlace[], nextId: () => number, g: RegionGeometry, t: TerrainFields,
  f: SiteFields, world: WorldData,
  allow: (x: number, y: number) => boolean,
): void {
  const W = g.width, H = g.height;
  const cellKm = g.metresPerCell / 1000;
  const areaKm2 = W * H * cellKm * cellKm;
  const want = Math.max(0, Math.round(areaKm2 / 2600));
  if (want === 0) return;
  const R = Math.max(3, Math.round(2.2 / cellKm));
  const scored: { i: number; s: number }[] = [];
  for (let y = R; y < H - R; y += 2) {
    for (let x = R; x < W - R; x += 2) {
      const i = y * W + x;
      if (t.water[i] !== 0) continue;
      const dRoad = f.toRoad[i] * cellKm;
      if (dRoad > 3.5) continue;
      // Prominence: how far above the surrounding ground it stands.
      let sum = 0, cnt = 0;
      for (let dy = -R; dy <= R; dy += R) {
        for (let dx = -R; dx <= R; dx += R) {
          sum += t.elevation[(y + dy) * W + (x + dx)]; cnt++;
        }
      }
      const prom = t.elevation[i] - sum / cnt;
      if (prom < 0.03) continue;
      scored.push({ i, s: prom * 3 + (3.5 - dRoad) * 0.2 });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  for (let k = 0, placed = 0; k < scored.length && placed < want; k++) {
    const i = scored[k].i;
    const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5;
    if (!allow(x, y)) continue;
    if (places.some((p) => Math.hypot(p.x - x, p.y - y) * cellKm < 5)) continue;
    const sourceKey = regionalSourceKeyAt('tower', g, { x, y }, world.width);
    const rng = createRng(world.params.seed, sourceKey);
    const forms = ['Atalaya de {n}', 'Torre de {n}', 'Vigía de {n}', 'Torre del {n}'];
    const stems = ['Levante', 'Poniente', 'Cierzo', 'Ábrego', 'Solano', 'Mediodía', 'Norte'];
    places.push(materializeRegionPlace({
      id: nextId(), kind: 'tower', x, y,
      name: forms[Math.floor(rng() * forms.length)].replace('{n}', stems[Math.floor(rng() * stems.length)]),
      importance: 0.24,
    }, g, world.width, sourceKey));
    placed++;
  }
}

/** Quarries and mines: bare rock within carting distance of somewhere building. */
function addWorkings(
  places: RegionPlace[], nextId: () => number, g: RegionGeometry, t: TerrainFields,
  cover: Uint8Array, f: SiteFields, world: WorldData,
  allow: (x: number, y: number) => boolean,
): void {
  const W = g.width, H = g.height;
  const cellKm = g.metresPerCell / 1000;
  const want = Math.max(0, Math.round((W * H * cellKm * cellKm) / 3400));
  const scored: { i: number; s: number; mine: boolean }[] = [];
  for (let i = 0; i < W * H; i += 5) {
    const c = cover[i];
    if (c !== Cover.Rock && c !== Cover.Scree) continue;
    const dTown = f.toTown[i] * cellKm;
    const dRoad = f.toRoad[i] * cellKm;
    const access = Math.min(dTown, dRoad + 2);
    if (access > 12) continue;
    scored.push({ i, s: 12 - access + t.slope[i] * 4, mine: t.elevation[i] > 0.8 });
  }
  scored.sort((a, b) => b.s - a.s);
  for (let k = 0, placed = 0; k < scored.length && placed < want; k++) {
    const { i, mine } = scored[k];
    const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5;
    if (!allow(x, y)) continue;
    if (places.some((p) => Math.hypot(p.x - x, p.y - y) * cellKm < 4)) continue;
    const kind = mine ? 'mine' : 'quarry';
    const sourceKey = regionalSourceKeyAt(kind, g, { x, y }, world.width);
    const rng = createRng(world.params.seed, sourceKey);
    const stems = ['la Peña', 'los Riscos', 'la Sierra', 'la Umbría', 'la Solana', 'el Tajo'];
    places.push(materializeRegionPlace({
      id: nextId(), kind, x, y,
      name: `${mine ? 'Mina' : 'Cantera'} de ${stems[Math.floor(rng() * stems.length)]}`,
      importance: 0.16,
    }, g, world.width, sourceKey));
    placed++;
  }
}

/** An inn stands where a day's travel ends and there is nothing else. */
function addInns(
  places: RegionPlace[], nextId: () => number, g: RegionGeometry, f: SiteFields, world: WorldData,
  allow: (x: number, y: number) => boolean,
): void {
  const W = g.width, H = g.height;
  const cellKm = g.metresPerCell / 1000;
  const scored: { i: number; s: number }[] = [];
  for (let i = 0; i < W * H; i += 4) {
    const dRoad = f.toRoad[i] * cellKm;
    if (dRoad > 0.35) continue;
    const dTown = f.toTown[i] * cellKm;
    if (dTown < 9) continue;
    scored.push({ i, s: dTown });
  }
  scored.sort((a, b) => b.s - a.s);
  const want = Math.max(0, Math.round((W * H * cellKm * cellKm) / 5200));
  for (let k = 0, placed = 0; k < scored.length && placed < want; k++) {
    const i = scored[k].i;
    const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5;
    if (!allow(x, y)) continue;
    if (places.some((p) => Math.hypot(p.x - x, p.y - y) * cellKm < 7)) continue;
    const sourceKey = regionalSourceKeyAt('inn', g, { x, y }, world.width);
    const rng = createRng(world.params.seed, sourceKey);
    const names = ['Venta del Camino', 'Posada del Cuervo', 'Venta Vieja', 'Mesón del Puerto',
      'Venta de la Sierra', 'Posada del Vado', 'Venta del Lobo'];
    places.push(materializeRegionPlace({
      id: nextId(), kind: 'inn', x, y,
      name: names[Math.floor(rng() * names.length)],
      importance: 0.15,
    }, g, world.width, sourceKey));
    placed++;
  }
}
