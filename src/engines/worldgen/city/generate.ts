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
  area, bisect, centroid, circle, compactness, contains, dist, lerp, longestEdge,
  radial, rect, relax, ring, semiRadial, shrink, shrinkEdges, smoothPoly, voronoi,
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
  /** Wall vertices that are gates. */
  gates: V[];
  towers: V[];
  /** Citadel wall, if the town has one. */
  citadel: Poly | null;
  /** Street centrelines inside the town. */
  streets: V[][];
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
  ['military', 3], ['slum', 11], ['park', 3], ['cathedral', 2],
];

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
    coast = { p: { x: center.x + n.x * radius * 0.82, y: center.y + n.y * radius * 0.82 }, n };
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
    const pts: V[] = [];
    for (let t = -1; t <= 1.0001; t += 0.1) {
      const wobbleAmt = Math.sin(t * 5 + rng() * 0.4) * radius * 0.12;
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
  let market: Patch | null = null;
  let bestD = Infinity;
  for (const q of inner) {
    const d = dist(centroid(q.shape), center);
    if (d < bestD) { bestD = d; market = q; }
  }
  if (market) market.ward = 'market';

  let citadelPatch: Patch | null = null;
  if (p.citadel && inner.length > 5) {
    let best = -Infinity;
    for (const q of inner) {
      if (q === market) continue;
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
  // Outer ring: farms if requested, otherwise ragged outskirts.
  for (const q of patches) {
    if (q.withinCity) continue;
    const d = dist(centroid(q.shape), center);
    q.ward = p.farms && d < radius * 1.7 ? 'farm' : 'outskirts';
  }

  // ---- streets ------------------------------------------------------------
  // Straight-ish spokes from each gate to the market, bowed so they read as
  // worn paths rather than avenues, plus a ring road just inside the wall.
  const streets: V[][] = [];
  const roads: V[][] = [];
  const marketC = market ? centroid(market.shape) : center;
  for (const g of gates) {
    const seg: V[] = [];
    const steps = 7;
    const bow = (rng() - 0.5) * radius * 0.22;
    const dirx = marketC.x - g.x, diry = marketC.y - g.y;
    const px = -diry, py = dirx;
    const pl = Math.hypot(px, py) || 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const k = Math.sin(t * Math.PI) * bow;
      seg.push({ x: g.x + dirx * t + (px / pl) * k, y: g.y + diry * t + (py / pl) * k });
    }
    streets.push(seg);

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
  if (wallRing.length >= 6) {
    const inner1 = shrink(wallRing, MAIN_STREET * 1.6);
    if (inner1.length >= 3) streets.push([...inner1, inner1[0]]);
  }

  // ---- building geometry --------------------------------------------------
  for (const q of patches) {
    const isEdge = !q.withinCity;
    // Pull the block back from its streets. A block facing a main street sits
    // further back than one facing an alley — that differential is most of what
    // makes a street network legible from the footprints alone.
    const inset = q.shape.map((_, i) => {
      const v1 = q.shape[i], v2 = q.shape[(i + 1) % q.shape.length];
      const mid = lerp(v1, v2, 0.5);
      const nearStreet = streets.some((st) => st.some((sp) => dist(sp, mid) < MAIN_STREET * 2.2));
      return (nearStreet ? MAIN_STREET : q.withinCity ? REGULAR_STREET : ALLEY) / 2;
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
        if (rng() < 0.45) {
          const { strips, court } = ring(block, 2 + 4 * rng());
          q.buildings.push(...strips);
          if (court) q.courts.push(court);
        } else {
          q.buildings.push(...createOrthoBuilding(block, 50, 0.8, rng));
        }
        break;
      }
      case 'castle': {
        const keep = shrink(block, MAIN_STREET * 2);
        if (keep.length >= 3) q.buildings.push(...createOrthoBuilding(keep, Math.sqrt(area(keep)) * 4, 0.6, rng));
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
    const nearRiver = (v: V) => river!.some((rp) => dist(rp, v) < radius * 0.1);
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
    gates,
    towers: p.walls ? towers : [],
    citadel: citadelPatch ? citadelPatch.shape : null,
    streets,
    roads,
    river,
    coast,
    center,
    radius,
    population: p.population ?? Math.round(nInner * 320 * (0.7 + rng() * 0.8)),
  };
}

export { contains };
