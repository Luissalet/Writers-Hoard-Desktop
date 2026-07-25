// ============================================
// City Generator — Medieval town layout
// ============================================
// A seeded city plan: Voronoi districts, a curtain wall with gates and towers,
// a street network routed from the gates to the market, wards assigned by
// suitability, and building footprints produced by recursive subdivision.
//
// The two details that decide whether the result reads as a medieval town or
// as noise:
//
//   1. ANGLE SUPPRESSION — the recursive subdivider skews its cuts on large
//      blocks but goes strictly perpendicular once a block is within 4× the
//      minimum lot. The last two levels of recursion are always square-on, so
//      buildings come out rectangular even inside a chaotic ward.
//   2. GAPLESS SPLITS — most deep cuts open no alley, so houses share party
//      walls and form terraced rows. Only large blocks get a real gap.
//
// Both come from the reference implementation; without them the footprints are
// random quadrilaterals and the plan reads as static.

import { createRng, type Rng } from '../core/rng';
import { generateName, type CultureId } from '../core/naming';
import {
  area, bisect, centroid, circle, clipHalfPlane, compactness, contains, dist, lerp, longestEdge,
  norm, radial, rect, relax, ring, rot90, semiRadial, shrink, shrinkEdges, smoothPoly,
  sub, voronoi,
  type Poly, type V,
} from './geometry';

// Street widths, in city units. One unit ≈ 4 m, so a main street is ~8 m.
export const MAIN_STREET = 2.0;
export const REGULAR_STREET = 1.0;
export const ALLEY = 0.6;

export type WardType =
  | 'craftsmen' | 'merchant' | 'patriciate' | 'administration' | 'military'
  | 'slum' | 'gate' | 'market' | 'cathedral' | 'castle' | 'park' | 'farm' | 'outskirts';

export const WARD_LABEL: Record<WardType, string> = {
  craftsmen: 'Barrio de artesanos',
  merchant: 'Barrio mercantil',
  patriciate: 'Barrio patricio',
  administration: 'Barrio administrativo',
  military: 'Cuartel',
  slum: 'Arrabal',
  gate: 'Barrio de la puerta',
  market: 'Plaza del mercado',
  cathedral: 'Catedral',
  castle: 'Ciudadela',
  park: 'Parque',
  farm: 'Granjas',
  outskirts: 'Afueras',
};

export interface Patch {
  shape: Poly;
  withinCity: boolean;
  withinWalls: boolean;
  ward: WardType;
  buildings: Poly[];
  /** Open space inside the ward: courtyards, cloisters, plazas. */
  courts: Poly[];
}

export interface CityPlan {
  name: string;
  seed: string;
  /** Requested size class; drives patch count and whether walls exist. */
  size: number;
  patches: Patch[];
  /** Curtain-wall ring, or null for an open town. */
  wall: Poly | null;
  /** False when the wall is an open arc ending at the water on both sides. */
  wallClosed: boolean;
  /** Wall vertices that are gates. */
  gates: V[];
  towers: V[];
  /** Citadel wall, if the town has one. */
  citadel: Poly | null;
  /** Street centrelines inside the town. */
  streets: V[][];
  /** The avenues: gate → market, routed along the gaps between blocks. */
  mainStreets: V[][];
  /** Bridge decks, only where a street really crosses the water. */
  bridges: Poly[];
  /** Quay along the shore, and the piers off it. */
  quays: Poly[];
  piers: Poly[];
  /** Roads leaving the gates into the countryside. */
  roads: V[][];
  /** River polyline crossing the town, if any. */
  river: V[] | null;
  /** Water half-plane for a coastal town: everything on the far side is sea. */
  coast: { p: V; n: V } | null;
  center: V;
  radius: number;
  population: number;
}

export interface CityParams {
  seed: string;
  name?: string;
  culture?: CultureId;
  /** Roughly the number of inner districts: 6 = hamlet, 40 = large city. */
  size: number;
  walls: boolean;
  citadel: boolean;
  /** Put a river through the town. */
  river: boolean;
  /** Put the sea on one side. */
  coast: boolean;
  /** Ring of farmland outside the walls. */
  farms: boolean;
  population?: number;
}

export const DEFAULT_CITY: CityParams = {
  seed: 'ciudad',
  size: 15,
  walls: true,
  citadel: true,
  river: false,
  coast: false,
  farms: true,
};

// ---------------------------------------------------------------------------
// Patch construction
// ---------------------------------------------------------------------------

/**
 * Sites on an expanding spiral. The spiral is what gives a medieval town its
 * characteristic radial density gradient: tight in the middle, loosening
 * outward, with no grid axis anywhere.
 */
function spiralSites(rng: Rng, count: number): V[] {
  const sa = rng() * 2 * Math.PI;
  const pts: V[] = [];
  for (let i = 0; i < count; i++) {
    const a = sa + Math.sqrt(i) * 5;
    const r = i === 0 ? 0 : 10 + i * (2 + rng());
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** Merge vertices that are nearly coincident so patches share exact corners —
 *  the street graph depends on that identity. */
function weldVertices(patches: Poly[], tol = 0.35): void {
  const pool: V[] = [];
  const key = (v: V) => `${Math.round(v.x / tol)},${Math.round(v.y / tol)}`;
  const map = new Map<string, V>();
  for (const p of patches) {
    for (let i = 0; i < p.length; i++) {
      const k = key(p[i]);
      let hit = map.get(k);
      if (!hit) {
        // Also probe the 8 neighbouring buckets so a vertex sitting on a bucket
        // boundary still welds.
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const c = map.get(`${Math.round(p[i].x / tol) + dx},${Math.round(p[i].y / tol) + dy}`);
            if (c && dist(c, p[i]) <= tol) { hit = c; break; }
          }
        }
      }
      if (hit) p[i] = hit;
      else { map.set(k, p[i]); pool.push(p[i]); }
    }
  }
}

// ---------------------------------------------------------------------------
// The street graph
// ---------------------------------------------------------------------------
// A town's streets are not lines drawn across it. They are the GAPS BETWEEN ITS
// BLOCKS, which means the street network already exists the moment the patches
// do: it is the edge graph of the patch subdivision. Routing along it is what
// makes a main street bend around a block the way a real one does, instead of
// cutting through six houses on its way to the market.
//
// `weldVertices` has already made neighbouring patches share vertex OBJECTS, so
// the graph can be keyed on identity and needs no geometric matching.

interface StreetGraph {
  nodes: V[];
  index: Map<V, number>;
  adj: number[][];
  /** How many patches an edge borders: 1 = on the town's edge, 2 = interior. */
  shared: Map<string, number>;
}

function buildStreetGraph(patches: Poly[]): StreetGraph {
  const index = new Map<V, number>();
  const nodes: V[] = [];
  const adj: number[][] = [];
  const shared = new Map<string, number>();
  const id = (v: V) => {
    let i = index.get(v);
    if (i === undefined) {
      i = nodes.length;
      index.set(v, i);
      nodes.push(v);
      adj.push([]);
    }
    return i;
  };
  const ek = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const poly of patches) {
    for (let i = 0; i < poly.length; i++) {
      const a = id(poly[i]), b = id(poly[(i + 1) % poly.length]);
      if (a === b) continue;
      const k = ek(a, b);
      const seen = shared.get(k) ?? 0;
      shared.set(k, seen + 1);
      if (seen === 0) { adj[a].push(b); adj[b].push(a); }
    }
  }
  return { nodes, index, adj, shared };
}

/**
 * Cheapest path along the block boundaries.
 *
 * The cost is length, but scaled by a per-edge multiplier the caller supplies —
 * that is where "prefer streets that already exist" and "never route through the
 * castle" live. Straight A* on raw length gives every gate the same boring
 * radial, which is exactly what this replaced.
 */
function routeStreet(
  g: StreetGraph,
  from: number,
  to: number,
  weight: (a: number, b: number) => number,
): number[] | null {
  const n = g.nodes.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (i: number) => dist(g.nodes[i], g.nodes[to]);
  gScore[from] = 0;
  // A binary heap is overkill here: a town has a few hundred nodes and the
  // linear scan is measurably faster than the bookkeeping.
  const open = new Set<number>([from]);
  while (open.size) {
    let cur = -1, best = Infinity;
    for (const i of open) {
      const f = gScore[i] + h(i);
      if (f < best) { best = f; cur = i; }
    }
    if (cur < 0) break;
    if (cur === to) {
      const path: number[] = [];
      for (let i = to; i >= 0; i = came[i]) path.push(i);
      return path.reverse();
    }
    open.delete(cur);
    closed[cur] = 1;
    for (const nb of g.adj[cur]) {
      if (closed[nb]) continue;
      const w = weight(cur, nb);
      if (!Number.isFinite(w)) continue;
      const tentative = gScore[cur] + dist(g.nodes[cur], g.nodes[nb]) * w;
      if (tentative >= gScore[nb]) continue;
      gScore[nb] = tentative;
      came[nb] = cur;
      open.add(nb);
    }
  }
  return null;
}

/** Nearest graph node to a point, restricted to nodes passing `ok`. */
function nearestNode(g: StreetGraph, at: V, ok?: (i: number) => boolean): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    if (ok && !ok(i)) continue;
    const d = dist(g.nodes[i], at);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Round off a routed path.
 *
 * A path along Voronoi edges is correct and looks like a circuit diagram. Two
 * Chaikin passes turn the corners into the slight curves a street worn by traffic
 * actually has, while keeping it inside the gap between the blocks.
 */
function smoothStreet(pts: V[]): V[] {
  let out = pts;
  for (let pass = 0; pass < 2; pass++) {
    if (out.length < 3) break;
    const next: V[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      next.push(lerp(out[i], out[i + 1], 0.25), lerp(out[i], out[i + 1], 0.75));
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** Where a polyline crosses another, as a list of intersection points. */
function crossings(a: V[], b: V[]): { at: V; dir: V }[] {
  const out: { at: V; dir: V }[] = [];
  for (let i = 0; i < a.length - 1; i++) {
    const p1 = a[i], p2 = a[i + 1];
    for (let j = 0; j < b.length - 1; j++) {
      const p3 = b[j], p4 = b[j + 1];
      const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
      if (Math.abs(d) < 1e-9) continue;
      const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
      const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      out.push({
        at: lerp(p1, p2, t),
        dir: norm(sub(p2, p1)),
      });
    }
  }
  return out;
}

/** Ordered boundary of a set of patches: edges used exactly once. */
function outerRing(patches: Poly[]): Poly {
  const count = new Map<string, { a: V; b: V; n: number }>();
  const ek = (a: V, b: V) => {
    const ka = `${a.x.toFixed(4)},${a.y.toFixed(4)}`;
    const kb = `${b.x.toFixed(4)},${b.y.toFixed(4)}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (const p of patches) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const k = ek(a, b);
      const hit = count.get(k);
      if (hit) hit.n++;
      else count.set(k, { a, b, n: 1 });
    }
  }
  const edges = [...count.values()].filter((e) => e.n === 1);
  if (!edges.length) return [];

  // Walk the boundary edges into a ring.
  const byPoint = new Map<string, { a: V; b: V }[]>();
  const pk = (v: V) => `${v.x.toFixed(4)},${v.y.toFixed(4)}`;
  for (const e of edges) {
    for (const v of [e.a, e.b]) {
      let arr = byPoint.get(pk(v));
      if (!arr) byPoint.set(pk(v), (arr = []));
      arr.push(e);
    }
  }
  const used = new Set<{ a: V; b: V }>();
  const start = edges[0];
  const ringOut: V[] = [start.a, start.b];
  used.add(start);
  for (let guard = 0; guard < edges.length + 4; guard++) {
    const tail = ringOut[ringOut.length - 1];
    const cands = byPoint.get(pk(tail)) ?? [];
    const next = cands.find((e) => !used.has(e));
    if (!next) break;
    used.add(next);
    const other = pk(next.a) === pk(tail) ? next.b : next.a;
    if (pk(other) === pk(ringOut[0])) break;
    ringOut.push(other);
  }
  return ringOut;
}

// ---------------------------------------------------------------------------
// Building subdivision
// ---------------------------------------------------------------------------

interface AlleyParams {
  minSq: number;
  gridChaos: number;
  sizeChaos: number;
  emptyProb: number;
}

/**
 * Recursively bisect a block into building footprints.
 *
 * Every cut is perpendicular to the block's LONGEST edge — that alone keeps
 * footprints rectangular. The cut position is centred on the midpoint with a
 * spread proportional to `gridChaos`, so a planned quarter halves cleanly while
 * a slum splits 10/90. The recursion stops at a STOCHASTIC area threshold, so
 * one ward contains a spread of building sizes rather than a uniform grid.
 */
function createAlleys(poly: Poly, p: AlleyParams, rng: Rng, split = true, depth = 0): Poly[] {
  if (depth > 14 || poly.length < 3) return [];
  const a = area(poly);
  const e = longestEdge(poly);
  const spread = 0.8 * p.gridChaos;
  const ratio = (1 - spread) / 2 + rng() * spread;
  // Below 4× the minimum lot the cut goes strictly perpendicular. This is what
  // stops small buildings from becoming random quadrilaterals.
  const angleSpread = (Math.PI / 6) * p.gridChaos * (a < p.minSq * 4 ? 0 : 1);
  const angle = (rng() - 0.5) * 2 * angleSpread;
  const gap = split ? ALLEY : 0;

  const halves = bisect(poly, e, ratio, angle, gap);
  const out: Poly[] = [];
  for (const h of halves) {
    const ha = area(h);
    const threshold = p.minSq * Math.pow(2, 4 * p.sizeChaos * (rng() - 0.5));
    if (ha < threshold) {
      if (rng() >= p.emptyProb) out.push(h);
    } else {
      const u = rng();
      out.push(...createAlleys(h, p, rng, ha > p.minSq / Math.max(1e-3, u * u), depth + 1));
    }
  }
  return out;
}

/** Axis-locked subdivision for castles and cathedrals: every cut aligns to one
 *  of two fixed perpendicular axes, so the complex reads as built rather than
 *  subdivided. `fill` below 1 leaves courtyards and wings. */
function createOrthoBuilding(poly: Poly, minBlockSq: number, fill: number, rng: Rng): Poly[] {
  const angle = rng() * Math.PI;
  const build = (p: Poly, depth: number): Poly[] => {
    if (depth > 10 || p.length < 3) return [];
    if (area(p) < minBlockSq) return rng() < fill ? [p] : [];
    // Alternate between the two fixed axes rather than the polygon's own edges.
    const e = longestEdge(p);
    const ratio = 0.4 + rng() * 0.2;
    const edgeDir = Math.atan2(
      p[(e + 1) % p.length].y - p[e].y,
      p[(e + 1) % p.length].x - p[e].x,
    );
    const target = Math.abs(Math.cos(edgeDir - angle)) > 0.5 ? angle : angle + Math.PI / 2;
    const halves = bisect(p, e, ratio, target - edgeDir, 0);
    const out: Poly[] = [];
    for (const h of halves) out.push(...build(h, depth + 1));
    return out;
  };
  return build(poly, 0);
}

// ---------------------------------------------------------------------------
// Wards
// ---------------------------------------------------------------------------

const WARD_WEIGHTS: [WardType, number][] = [
  ['craftsmen', 40], ['merchant', 6], ['patriciate', 4], ['administration', 3],
  ['military', 3], ['slum', 11], ['park', 3],
];

/**
 * How many districts of a kind a town is allowed.
 *
 * Drawing each ward independently from a weighted bag is right for the common
 * ones and wrong for the singular ones: a town of twenty districts came out with
 * three cathedrals and three parks, or with none at all, because 4% of twenty is
 * a coin toss and nobody had told the generator that a cathedral is *the*
 * cathedral. Rare wards get a quota instead.
 */
function wardQuota(ward: WardType, innerCount: number): number {
  switch (ward) {
    case 'cathedral': return innerCount >= 10 ? 1 : 0;
    case 'park': return Math.max(1, Math.round(innerCount / 14));
    case 'military': return Math.max(1, Math.round(innerCount / 12));
    case 'administration': return Math.max(1, Math.round(innerCount / 15));
    case 'patriciate': return Math.max(1, Math.round(innerCount / 10));
    default: return Infinity;
  }
}

function pickWard(rng: Rng): WardType {
  const total = WARD_WEIGHTS.reduce((s, w) => s + w[1], 0);
  let r = rng() * total;
  for (const [w, n] of WARD_WEIGHTS) {
    r -= n;
    if (r <= 0) return w;
  }
  return 'craftsmen';
}

function alleyParamsFor(ward: WardType, blockArea: number, rng: Rng): AlleyParams {
  const r = () => rng();
  switch (ward) {
    case 'merchant': return { minSq: 50 + 60 * r() * r(), gridChaos: 0.5 + 0.3 * r(), sizeChaos: 0.7, emptyProb: 0.15 };
    case 'patriciate': return { minSq: 80 + 30 * r() * r(), gridChaos: 0.5 + 0.3 * r(), sizeChaos: 0.8, emptyProb: 0.2 };
    case 'administration': return { minSq: 80 + 30 * r() * r(), gridChaos: 0.1 + 0.3 * r(), sizeChaos: 0.3, emptyProb: 0.04 };
    case 'military': return { minSq: Math.sqrt(blockArea) * (1 + r()), gridChaos: 0.1 + 0.3 * r(), sizeChaos: 0.3, emptyProb: 0.25 };
    case 'slum': return { minSq: 10 + 30 * r() * r(), gridChaos: 0.6 + 0.4 * r(), sizeChaos: 0.8, emptyProb: 0.03 };
    case 'gate': return { minSq: 10 + 50 * r() * r(), gridChaos: 0.5 + 0.3 * r(), sizeChaos: 0.7, emptyProb: 0.04 };
    case 'outskirts': return { minSq: 30 + 60 * r() * r(), gridChaos: 0.7 + 0.3 * r(), sizeChaos: 0.9, emptyProb: 0.55 };
    default: return { minSq: 10 + 80 * r() * r(), gridChaos: 0.5 + 0.2 * r(), sizeChaos: 0.6, emptyProb: 0.04 };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function generateCity(params: CityParams): CityPlan {
  const p = { ...DEFAULT_CITY, ...params };
  const rng = createRng(p.seed, 'city');
  const nInner = Math.max(4, Math.round(p.size));
  // Generate a generous surplus so the inner set is fully surrounded by outer
  // patches — the wall needs neighbours on every side to have somewhere to go.
  const nTotal = nInner * 8;

  let sites = spiralSites(rng, nTotal);
  const span = Math.max(...sites.map((s) => Math.hypot(s.x, s.y))) * 1.15 + 20;
  const bounds: Poly = [
    { x: -span, y: -span }, { x: span, y: -span }, { x: span, y: span }, { x: -span, y: span },
  ];
  // Relax only the inner sites: the outskirts should stay irregular.
  for (let k = 0; k < 2; k++) sites = relax(sites, bounds, (i) => i < nInner * 2);

  const cells = voronoi(sites, bounds);
  const patches: Patch[] = [];
  const shapes: Poly[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].length < 3) continue;
    shapes.push(cells[i]);
    patches.push({
      shape: cells[i],
      withinCity: i < nInner,
      withinWalls: p.walls && i < nInner,
      ward: 'outskirts',
      buildings: [],
      courts: [],
    });
  }
  weldVertices(shapes);

  const inner = patches.filter((q) => q.withinCity);
  const center = centroid(inner[0]?.shape ?? [{ x: 0, y: 0 }]);

  // ---- curtain wall -------------------------------------------------------
  let wallRing = outerRing(inner.map((q) => q.shape));
  if (wallRing.length >= 6) wallRing = smoothPoly(wallRing, 0.32);
  const radius = wallRing.length
    ? wallRing.reduce((m, v) => Math.max(m, dist(v, center)), 0)
    : 40;

  // ---- coast and river ----------------------------------------------------
  let coast: CityPlan['coast'] = null;
  if (p.coast) {
    const a = rng() * Math.PI * 2;
    const n = { x: Math.cos(a), y: Math.sin(a) };
    // 0.82 left the shore grazing the town: no wall reached it, so no quay, no
    // piers and no clipped wall ever appeared on a "coastal" plan. The sea has to
    // bite into the plan for the town to be a port.
    coast = { p: { x: center.x + n.x * radius * 0.6, y: center.y + n.y * radius * 0.6 }, n };
  }
  let river: V[] | null = null;
  if (p.river) {
    // On a coastal town the river runs to the sea rather than across it, so its
    // heading is taken from the shore normal and the polyline is cut at the
    // waterline.
    const a = coast ? Math.atan2(coast.n.y, coast.n.x) + (rng() - 0.5) * 0.7 : rng() * Math.PI;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const perp = { x: -dir.y, y: dir.x };
    const L = radius * 2.6;
    // Offset the channel off-centre. Running it exactly through the middle put
    // the river through the market square of every river town ever generated,
    // because the market is chosen as the most central district — the two
    // definitions collided and nobody noticed until a reader saw twenty maps.
    const off = (rng() < 0.5 ? -1 : 1) * radius * (0.22 + rng() * 0.3);
    const pts: V[] = [];
    for (let t = -1; t <= 1.0001; t += 0.1) {
      const wobbleAmt = off + Math.sin(t * 5 + rng() * 0.4) * radius * 0.12;
      pts.push({
        x: center.x + dir.x * L * t * 0.5 + perp.x * wobbleAmt,
        y: center.y + dir.y * L * t * 0.5 + perp.y * wobbleAmt,
      });
    }
    river = pts;
    if (coast) {
      const wet = (v: V) => (v.x - coast!.p.x) * coast!.n.x + (v.y - coast!.p.y) * coast!.n.y > 0;
      // Keep the run from the inland end up to the first wet vertex, plus one
      // so the channel visibly meets the water.
      const startsWet = wet(pts[0]);
      const ordered = startsWet ? [...pts].reverse() : pts;
      const cutAt = ordered.findIndex(wet);
      river = cutAt < 0 ? ordered : ordered.slice(0, cutAt + 1);
      if (river.length < 3) river = null;
    }
  }

  // A wall does not run into the sea. Clip the ring to the dry arc so it ends at
  // the waterline on both sides, the way a real harbour town's does — the sea
  // wall was the harbour chain, not masonry.
  let wallClosed = true;
  if (coast && wallRing.length >= 6) {
    const dry = (v: V) => (v.x - coast!.p.x) * coast!.n.x + (v.y - coast!.p.y) * coast!.n.y < 0;
    const n = wallRing.length;
    if (wallRing.some((v) => !dry(v)) && wallRing.some(dry)) {
      // Find the first vertex whose predecessor is wet: the start of the arc.
      let start = -1;
      for (let i = 0; i < n; i++) {
        if (dry(wallRing[i]) && !dry(wallRing[(i - 1 + n) % n])) { start = i; break; }
      }
      if (start >= 0) {
        const arc: V[] = [];
        for (let k = 0; k < n; k++) {
          const v = wallRing[(start + k) % n];
          if (!dry(v)) break;
          arc.push(v);
        }
        if (arc.length >= 3) { wallRing = arc; wallClosed = false; }
      }
    }
  }

  // ---- gates --------------------------------------------------------------
  // Gate count follows the reference default, thinned on a coast where part of
  // the perimeter is water.
  const gates: V[] = [];
  if (wallRing.length >= 6) {
    const want = Math.max(1, Math.min(6, 2 + Math.floor((nInner / 12) * (p.coast ? 0.75 : 1))));
    const spacingIdx = Math.max(2, Math.floor(wallRing.length / (want + 1)));
    let idx = Math.floor(rng() * wallRing.length);
    for (let g = 0; g < want; g++) {
      const v = wallRing[idx % wallRing.length];
      // Never put a gate on the waterfront.
      if (!coast || (v.x - coast.p.x) * coast.n.x + (v.y - coast.p.y) * coast.n.y < 0) gates.push(v);
      idx += spacingIdx + Math.floor(rng() * 2);
    }
  }
  const towers = wallRing.filter((v) => !gates.some((g) => g === v || dist(g, v) < 0.01));

  // ---- market and citadel -------------------------------------------------
  // The market takes the most central district; the castle takes a peripheral
  // one, which is where urban castles actually sat — commanding the town from
  // an edge, with one gate to the fields and one to the streets.
  //
  // "Most central" is the rule, but it is not the only rule: a market square is
  // a dry open place where carts stand, so a district the river runs through or
  // one that is half sea is disqualified outright. It has to be a hard veto and
  // not a penalty — a slightly-less-central square is free, a market under two
  // feet of water is not.
  const riverWidth = radius * 0.09;
  const inWater = (v: V): boolean => {
    if (coast && (v.x - coast.p.x) * coast.n.x + (v.y - coast.p.y) * coast.n.y > -riverWidth) return true;
    if (river && river.some((rp) => dist(rp, v) < riverWidth * 1.5)) return true;
    return false;
  };
  const dryPatch = (q: Patch) => !q.shape.some(inWater) && !inWater(centroid(q.shape));

  let market: Patch | null = null;
  let bestD = Infinity;
  for (const q of inner) {
    if (!dryPatch(q)) continue;
    const d = dist(centroid(q.shape), center);
    if (d < bestD) { bestD = d; market = q; }
  }
  // Fall back to plain centrality only if literally every district is wet.
  if (!market) {
    for (const q of inner) {
      const d = dist(centroid(q.shape), center);
      if (d < bestD) { bestD = d; market = q; }
    }
  }
  if (market) market.ward = 'market';

  let citadelPatch: Patch | null = null;
  if (p.citadel && inner.length > 5) {
    let best = -Infinity;
    for (const q of inner) {
      if (q === market || !dryPatch(q)) continue;
      const c = centroid(q.shape);
      const score = dist(c, center) * compactness(q.shape);
      if (score > best) { best = score; citadelPatch = q; }
    }
    if (citadelPatch) citadelPatch.ward = 'castle';
  }

  // ---- ward assignment ----------------------------------------------------
  const gateSet = new Set(gates.map((g) => `${g.x.toFixed(3)},${g.y.toFixed(3)}`));
  for (const q of inner) {
    if (q.ward !== 'outskirts') continue;
    const touchesGate = q.shape.some((v) => gateSet.has(`${v.x.toFixed(3)},${v.y.toFixed(3)}`));
    if (touchesGate && rng() < (p.walls ? 0.5 : 0.2)) { q.ward = 'gate'; continue; }
    let ward = pickWard(rng);
    // Suitability: the rich cluster near the middle, the poor near the wall.
    const d = dist(centroid(q.shape), center) / Math.max(1, radius);
    if ((ward === 'patriciate' || ward === 'administration') && d > 0.6 && rng() < 0.7) ward = 'craftsmen';
    if (ward === 'slum' && d < 0.45 && rng() < 0.7) ward = 'craftsmen';
    if (ward === 'military' && d < 0.5 && rng() < 0.6) ward = 'craftsmen';
    q.ward = ward;
  }

  // Enforce the quotas: keep the best-suited district of each rare ward and turn
  // the rest over to the craftsmen, who will take any street in any town.
  const dryEnough = (q: Patch) => dryPatch(q);
  const counted = new Map<WardType, Patch[]>();
  for (const q of inner) {
    if (q.ward === 'market' || q.ward === 'castle' || q.ward === 'gate') continue;
    let l = counted.get(q.ward);
    if (!l) counted.set(q.ward, (l = []));
    l.push(q);
  }
  for (const [ward, list] of counted) {
    const quota = wardQuota(ward, inner.length);
    if (list.length <= quota) continue;
    // A cathedral wants a big dry central block; a park wants whatever is left.
    const ranked = list.slice().sort((a, b) => {
      const score = (q: Patch) => area(q.shape) * (dryEnough(q) ? 1 : 0.15)
        * (ward === 'cathedral' ? 1 / (1 + dist(centroid(q.shape), center) / radius) : 1);
      return score(b) - score(a);
    });
    for (const q of ranked.slice(quota)) q.ward = 'craftsmen';
  }
  // A town of any size has one cathedral, even if the bag never dealt one.
  if (!inner.some((q) => q.ward === 'cathedral') && wardQuota('cathedral', inner.length) > 0) {
    const pick = inner
      .filter((q) => q.ward === 'craftsmen' && dryEnough(q))
      .sort((a, b) => area(b.shape) - area(a.shape))[0];
    if (pick) pick.ward = 'cathedral';
  }
  // Outer ring: farms if requested, otherwise ragged outskirts.
  for (const q of patches) {
    if (q.withinCity) continue;
    const d = dist(centroid(q.shape), center);
    q.ward = p.farms && d < radius * 1.7 ? 'farm' : 'outskirts';
  }

  // ---- streets ------------------------------------------------------------
  // Routed along the gaps between blocks, not drawn across them. See
  // `buildStreetGraph` for why that is the whole trick.
  const streets: V[][] = [];
  const mainStreets: V[][] = [];
  const roads: V[][] = [];
  const marketC = market ? centroid(market.shape) : center;

  const graph = buildStreetGraph(inner.map((q) => q.shape));
  const citadelVerts = new Set(citadelPatch ? citadelPatch.shape : []);
  // Edges already carrying a main street are cheaper, so later routes prefer to
  // join an existing avenue instead of cutting a parallel one two blocks over.
  // That single term is what turns N independent paths into a network.
  const used = new Set<string>();
  const ekey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const weight = (a: number, b: number) => {
    // A street may not run through the castle bailey.
    if (citadelVerts.has(graph.nodes[a]) && citadelVerts.has(graph.nodes[b])) return Infinity;
    let w = used.has(ekey(a, b)) ? 0.45 : 1;
    // Fording is expensive; a bridge is a decision, not an accident. The route
    // will cross where the town is narrow, which is where bridges really go.
    const mid = lerp(graph.nodes[a], graph.nodes[b], 0.5);
    if (river && river.some((rp) => dist(rp, mid) < riverWidth * 1.4)) w *= 3.2;
    if (coast && (mid.x - coast.p.x) * coast.n.x + (mid.y - coast.p.y) * coast.n.y > 0) return Infinity;
    return w;
  };

  const marketNode = nearestNode(graph, marketC);
  for (const g of gates) {
    const from = graph.index.get(g) ?? nearestNode(graph, g);
    if (marketNode < 0 || from < 0) continue;
    const path = routeStreet(graph, from, marketNode, weight);
    if (path && path.length >= 2) {
      for (let i = 0; i < path.length - 1; i++) used.add(ekey(path[i], path[i + 1]));
      mainStreets.push(smoothStreet(path.map((i) => graph.nodes[i])));
    }

    // Road out of the gate, away from the centre.
    const out = { x: g.x - center.x, y: g.y - center.y };
    const ol = Math.hypot(out.x, out.y) || 1;
    const road: V[] = [g];
    let cur = { ...g };
    let ang = Math.atan2(out.y / ol, out.x / ol);
    for (let s = 0; s < 9; s++) {
      ang += (rng() - 0.5) * 0.35;
      cur = { x: cur.x + Math.cos(ang) * radius * 0.28, y: cur.y + Math.sin(ang) * radius * 0.28 };
      road.push({ ...cur });
    }
    roads.push(road);
  }

  // Secondary streets: from the far corners of the town back to the network, so
  // the quarters that no gate route happened to pass through are still reachable.
  // Without them a town has four grand avenues and a lot of sealed courtyards.
  const onNetwork = new Set<number>();
  for (const k of used) for (const part of k.split('|')) onNetwork.add(Number(part));
  const far = [...inner]
    .map((q) => ({ q, d: dist(centroid(q.shape), center) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, Math.max(2, Math.round(inner.length * 0.35)));
  for (const { q } of far) {
    const from = nearestNode(graph, centroid(q.shape));
    if (from < 0 || onNetwork.has(from)) continue;
    const to = nearestNode(graph, graph.nodes[from], (i) => onNetwork.has(i));
    if (to < 0) continue;
    const path = routeStreet(graph, from, to, weight);
    if (!path || path.length < 2) continue;
    for (let i = 0; i < path.length - 1; i++) {
      used.add(ekey(path[i], path[i + 1]));
      onNetwork.add(path[i]); onNetwork.add(path[i + 1]);
    }
    streets.push(smoothStreet(path.map((i) => graph.nodes[i])));
  }

  if (wallRing.length >= 6) {
    const inner1 = shrink(wallRing, MAIN_STREET * 1.6);
    // On a big town the road just inside the wall is an avenue in its own right:
    // it is how the garrison moves between gates without crossing the market square.
    // On a small one it is a back lane.
    if (inner1.length >= 3) {
      const ringRoad = wallClosed ? [...inner1, inner1[0]] : inner1;
      (nInner >= 24 ? mainStreets : streets).push(ringRoad);
    }
  }

  // ---- bridges ------------------------------------------------------------
  // Wherever a street actually crosses the water there is a bridge, and where it
  // does not there is nothing. Placing bridges independently of the streets is
  // how generated towns end up with a bridge to a blank wall.
  const bridges: Poly[] = [];
  if (river) {
    const seen: V[] = [];
    for (const st of [...mainStreets, ...streets]) {
      for (const x of crossings(st, river)) {
        if (seen.some((s) => dist(s, x.at) < riverWidth * 2)) continue;
        seen.push(x.at);
        const halfLen = riverWidth * 1.9;
        const halfW = MAIN_STREET * 1.5;
        const d = x.dir, n = rot90(d);
        bridges.push([
          { x: x.at.x - d.x * halfLen - n.x * halfW, y: x.at.y - d.y * halfLen - n.y * halfW },
          { x: x.at.x + d.x * halfLen - n.x * halfW, y: x.at.y + d.y * halfLen - n.y * halfW },
          { x: x.at.x + d.x * halfLen + n.x * halfW, y: x.at.y + d.y * halfLen + n.y * halfW },
          { x: x.at.x - d.x * halfLen + n.x * halfW, y: x.at.y - d.y * halfLen + n.y * halfW },
        ]);
      }
    }
  }

  // ---- waterfront ---------------------------------------------------------
  // A quay running along the shore inside the town, with piers off it. A coastal
  // town without them is an inland town that happens to end at some blue.
  // The waterfront is a STREET, not a slab. Modelling it as a filled quay drew a
  // brown bar across the harbour and out the other side of the town; as a ribbon
  // along the shore it reads immediately as the road the warehouses face onto,
  // and it cannot escape the street layer's colours.
  const quays: Poly[] = [];
  const piers: Poly[] = [];
  if (coast) {
    const n = coast.n, t = rot90(n);
    const signed = (v: V) => (v.x - coast.p.x) * n.x + (v.y - coast.p.y) * n.y;
    // Measured on the districts, not the wall: on a town whose wall stops short
    // of the water the wall test produced a quay floating offshore with piers
    // running from nothing to nothing.
    const along: number[] = [];
    for (const q of inner) {
      for (const v of q.shape) {
        if (signed(v) > -radius * 0.3) along.push((v.x - coast.p.x) * t.x + (v.y - coast.p.y) * t.y);
      }
    }
    if (along.length >= 4) {
      // Trim the outliers: one stray district corner reaching along the shore
      // was stretching the quay right out of the town.
      along.sort((x, y) => x - y);
      const a0 = along[Math.floor(along.length * 0.08)];
      const a1 = along[Math.floor(along.length * 0.92)];
      const base = -MAIN_STREET * 1.6;
      const at = (sAlong: number, d: number): V => ({
        x: coast.p.x + t.x * sAlong + n.x * d,
        y: coast.p.y + t.y * sAlong + n.y * d,
      });
      if (a1 - a0 > radius * 0.3) {
        const quay: V[] = [];
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
          const sAlong = a0 + ((a1 - a0) * i) / steps;
          quay.push(at(sAlong, base - Math.sin((i / steps) * Math.PI) * MAIN_STREET * 0.4));
        }
        mainStreets.push(quay);

        const pierCount = Math.max(1, Math.round((a1 - a0) / (radius * 0.55)));
        for (let i = 0; i < pierCount; i++) {
          const sAlong = a0 + ((i + 0.5) / pierCount) * (a1 - a0) + (rng() - 0.5) * radius * 0.08;
          const w = MAIN_STREET * (0.6 + rng() * 0.4);
          // A pier is a jetty, not a causeway. At radius*0.28 they reached a third
          // of the way across the bay and read as breakwaters.
          const out = radius * (0.05 + rng() * 0.06);
          piers.push([
            at(sAlong - w, base), at(sAlong + w, base),
            at(sAlong + w * 0.7, base + out), at(sAlong - w * 0.7, base + out),
          ]);
        }
      }
    }
  }

  // ---- clip the land ------------------------------------------------------
  // Only NOW, after the street graph has been routed on the un-clipped shapes:
  // clipping earlier would replace the welded vertex objects the graph is keyed
  // on. From here on a district ends at the waterline, so its ward wash, its
  // courtyards and its blocks all stop there too — previously the wash carried
  // on across the harbour and the cathedral was cut in half with no shoreline to
  // explain why.
  if (coast) {
    for (const q of patches) {
      const clipped = clipHalfPlane(q.shape, coast.p, coast.n);
      if (clipped.length >= 3) q.shape = clipped;
      else if (q.withinCity) { q.shape = []; q.withinCity = false; }
      else q.shape = [];
    }
  }

  // ---- building geometry --------------------------------------------------
  for (const q of patches) {
    if (q.shape.length < 3) continue;
    const isEdge = !q.withinCity;
    // Pull the block back from its streets. A block facing a main street sits
    // further back than one facing an alley — that differential is most of what
    // makes a street network legible from the footprints alone.
    const inset = q.shape.map((_, i) => {
      const v1 = q.shape[i], v2 = q.shape[(i + 1) % q.shape.length];
      const mid = lerp(v1, v2, 0.5);
      const onAvenue = mainStreets.some((st) => st.some((sp) => dist(sp, mid) < MAIN_STREET * 1.4));
      const nearStreet = onAvenue || streets.some((st) => st.some((sp) => dist(sp, mid) < MAIN_STREET * 1.2));
      // An avenue is wider than a street is wider than an alley, and the blocks
      // stepping back by different amounts is most of what makes the hierarchy
      // legible from the footprints alone.
      //
      // The set-back is capped against the block's own size: a small patch with
      // an avenue down two of its sides was being inset until nothing was left,
      // which read on the map as a plaza the size of a district.
      const cap = Math.sqrt(area(q.shape)) * 0.16;
      const want = onAvenue ? MAIN_STREET * 1.15 : nearStreet ? MAIN_STREET : q.withinCity ? REGULAR_STREET : ALLEY;
      return Math.min(want, cap * 2) / 2;
    });
    const block = shrinkEdges(q.shape, inset);
    if (block.length < 3) continue;

    switch (q.ward) {
      case 'market': {
        // Left open, with a well or a statue offset from the centre.
        const c = centroid(block);
        const off = lerp(c, lerp(block[longestEdge(block)], block[(longestEdge(block) + 1) % block.length], 0.5), 0.2 + 0.4 * rng());
        q.buildings.push(rng() < 0.6
          ? rect(1 + rng(), 1 + rng(), off, rng() * Math.PI)
          : circle(1 + rng(), 12, off));
        q.courts.push(block);
        break;
      }
      case 'cathedral': {
        // The precinct: a claustral range around the edge, or a dense chapter
        // block. Either way THE CHURCH ITSELF goes in the middle — the ring
        // branch alone produced a walled enclosure with nothing inside it, which
        // is a monastery that has lost its abbey.
        const { strips, court } = ring(block, 2 + 4 * rng());
        if (rng() < 0.55) {
          q.buildings.push(...strips);
          if (court) q.courts.push(court);
        } else {
          q.buildings.push(...createOrthoBuilding(block, 50, 0.8, rng));
        }
        const inner2 = court ?? block;
        const c = centroid(inner2);
        const span = Math.sqrt(area(inner2));
        if (span > 6) {
          // A cross on the ground: nave, then transepts across it.
          const ang = rng() * Math.PI;
          const nave = rect(span * 0.28, span * 0.62, c, ang);
          const trans = rect(span * 0.52, span * 0.2, c, ang);
          q.buildings.push(nave, trans);
        }
        break;
      }
      case 'castle': {
        // A bailey: ranges built against the inside of the wall, a courtyard, and
        // a rectangular keep. Subdividing the raw polygon instead produced two
        // enormous triangles that read as a bowtie, not a castle.
        const bailey = shrink(block, MAIN_STREET * 1.2);
        if (bailey.length < 3) break;
        const { strips, court } = ring(bailey, Math.sqrt(area(bailey)) * 0.17);
        q.buildings.push(...strips);
        const yard = court ?? bailey;
        if (court) q.courts.push(court);
        const c = centroid(yard);
        const span = Math.sqrt(area(yard));
        if (span > 4) {
          const ang = rng() * Math.PI;
          q.buildings.push(rect(span * 0.5, span * 0.42, c, ang));
          // A corner tower, offset, so the keep is not a lonely rectangle.
          const v = yard[Math.floor(rng() * yard.length)];
          q.buildings.push(rect(span * 0.2, span * 0.2, lerp(v, c, 0.45), ang));
        }
        break;
      }
      case 'park': {
        const slices = compactness(block) >= 0.7 ? radial(block, ALLEY) : semiRadial(block, ALLEY);
        q.courts.push(...slices);
        break;
      }
      case 'farm': {
        q.courts.push(block);
        // Farmsteads sit ON the roads out of the gates. One per field regardless
        // of position turns the countryside into a scatter of debris — the
        // fields themselves, drawn as furrow hatching, carry the farmland.
        const fc = centroid(block);
        const onRoad = roads.some((rd) => rd.some((rp) => dist(rp, fc) < radius * 0.3));
        if (!onRoad || rng() < 0.45) break;
        const v = block[Math.floor(rng() * block.length)];
        const spot = lerp(v, fc, 0.35 + 0.35 * rng());
        const yard = rect(6 + rng() * 4, 6 + rng() * 4, spot, rng() * Math.PI);
        q.buildings.push(...createOrthoBuilding(yard, 9, 0.55, rng));
        break;
      }
      default: {
        const ap = alleyParamsFor(q.ward, area(block), rng);
        if (isEdge) {
          // Hamlets outside the wall gather on the roads. Scattering them evenly
          // over the countryside reads as debris, not as settlement.
          const c = centroid(block);
          const onRoad = roads.some((rd) => rd.some((rp) => dist(rp, c) < radius * 0.35));
          if (!onRoad || rng() < 0.5) break;
          const spot = lerp(c, block[Math.floor(rng() * block.length)], 0.2 + 0.3 * rng());
          const cluster = rect(9 + rng() * 5, 8 + rng() * 5, spot, rng() * Math.PI);
          q.buildings.push(...createAlleys(cluster, { ...ap, emptyProb: 0.3 }, rng, true));
          break;
        }
        q.buildings.push(...createAlleys(block, ap, rng, true));
      }
    }
  }

  // ---- water clipping -----------------------------------------------------
  if (coast) {
    const wet = (v: V) => (v.x - coast!.p.x) * coast!.n.x + (v.y - coast!.p.y) * coast!.n.y > 0;
    for (const q of patches) {
      q.buildings = q.buildings.filter((b) => !b.some(wet));
      q.courts = q.courts.filter((c) => !c.some(wet));
    }
  }
  if (river) {
    const nearRiver = (v: V) => river!.some((rp) => dist(rp, v) < riverWidth * 0.8);
    for (const q of patches) {
      q.buildings = q.buildings.filter((b) => !b.some(nearRiver));
      q.courts = q.courts.filter((c) => !c.some(nearRiver));
    }
  }

  const culture: CultureId = p.culture ?? 'imperial';
  const name = p.name ?? generateName(p.seed, 'city', { culture, kind: nInner > 24 ? 'capital' : 'settlement' });

  return {
    name,
    seed: p.seed,
    size: nInner,
    patches,
    wall: p.walls && wallRing.length >= 6 ? wallRing : null,
    wallClosed,
    gates,
    towers: p.walls ? towers : [],
    citadel: citadelPatch ? citadelPatch.shape : null,
    streets,
    mainStreets,
    bridges,
    quays,
    piers,
    roads,
    river,
    coast,
    center,
    radius,
    population: p.population ?? Math.round(nInner * 320 * (0.7 + rng() * 0.8)),
  };
}

export { contains };
