// ============================================
// World Generator — Landform Extraction
// ============================================
// A map is not a list of continents and rivers. What a reader actually navigates
// by are the small shapes: the cape you round, the bay you shelter in, the strait
// you are charged a toll to pass, the isthmus the road has to use, the pass that
// decides where the border goes. Those shapes already exist in the elevation
// field — nobody had ever asked it for them.
//
// Every detector here answers a question about SHAPE, never about height alone:
//
//   CAPE       Land almost surrounded by sea.
//   BAY        Sea almost surrounded by land. Cold, steep and narrow → fjord.
//   STRAIT     Water pinched between land on two opposite sides, open on the
//              other two. That last clause is the whole definition: without it
//              every bay mouth is a strait.
//   ISTHMUS    The same test with land and sea exchanged.
//   PENINSULA  A region of land whose neighbourhood is mostly sea, joined to
//              somewhere that isn't.
//   DELTA      A big river arriving at a coast too flat to hold one channel.
//   PASS       A saddle: ground that rises in two opposite directions and falls
//              in the other two.
//   VALLEY     A river run with high ground on both banks. Very high and very
//              narrow → gorge.
//
// The detectors share one trick for turning "fraction of sea nearby" into
// something affordable: blur the 0/1 sea mask. A box blur at radius R IS the
// local mean at radius R, and it costs four passes over the grid instead of a
// disc sample per cell.

import type { WorldData } from './types';
import { blur, distanceTo } from './fields';
import { Biome } from './types';

export type LandformKind =
  | 'cape' | 'bay' | 'fjord' | 'strait' | 'isthmus' | 'peninsula'
  | 'delta' | 'pass' | 'valley' | 'gorge';

export interface Landform {
  kind: LandformKind;
  /** Cell coordinates of the label anchor. */
  x: number;
  y: number;
  /** Half-extent in cells — how much room the name is allowed to take. */
  extent: number;
  /** Label rotation in radians (0 for point features). */
  angle: number;
  /** 0–1, used for label priority and gazetteer ordering. */
  importance: number;
  /** Path features (valleys, straits) carry their cells for curved lettering. */
  cells?: number[];
}

interface Ctx {
  W: number;
  H: number;
  N: number;
  world: WorldData;
  /**
   * 1 on OCEAN — water connected to the world ocean, not merely water.
   *
   * Using `elevation <= 0` alone put a bay label in the middle of every
   * below-sea-level inland lake, because an enclosed puddle is, geometrically,
   * the most perfect bay there is. A bay has to open onto the sea.
   */
  sea: Uint8Array;
  seaF6: Float32Array;
  seaF16: Float32Array;
  /** Distance in cells from any cell to the nearest sea cell. */
  toSea: Float32Array;
  /** Distance in cells from any cell to the nearest land cell. */
  toLand: Float32Array;
  relief: Float32Array;
  elevSmooth: Float32Array;
  /** Size in cells of the land mass a land cell belongs to (0 on water). */
  landMass: Int32Array;
}

/**
 * Label 8-connected components of `pass`, returning each cell's component SIZE.
 * Size rather than id, because every caller here wants to ask "is this thing big
 * enough to matter" and none of them care which thing it is.
 */
function componentSizes(W: number, H: number, pass: Uint8Array): Int32Array {
  const N = W * H;
  const id = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!pass[s] || id[s] >= 0) continue;
    const cid = sizes.length;
    let count = 0, top = 0;
    stack[top++] = s;
    id[s] = cid;
    while (top > 0) {
      const i = stack[--top];
      count++;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        const j = yy * W + ((x + dx + W) % W);
        if (pass[j] && id[j] < 0) { id[j] = cid; stack[top++] = j; }
      }
    }
    sizes.push(count);
  }
  const out = new Int32Array(N);
  for (let i = 0; i < N; i++) out[i] = id[i] >= 0 ? sizes[id[i]] : 0;
  return out;
}

function makeCtx(world: WorldData): Ctx {
  const W = world.width, H = world.height, N = W * H;
  const water = new Uint8Array(N);
  const land = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const isWater = world.elevation[i] <= 0 ? 1 : 0;
    water[i] = isWater;
    land[i] = isWater ? 0 : 1;
  }
  // Only water bodies big enough to be an ocean or an open sea count as "sea".
  const waterMass = componentSizes(W, H, water);
  const oceanMin = Math.max(400, Math.round(N * 0.004));
  const sea = new Uint8Array(N);
  const seaF = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = water[i] && waterMass[i] >= oceanMin ? 1 : 0;
    sea[i] = s;
    seaF[i] = s;
  }
  const elevSmooth = blur(world.elevation, W, H, Math.max(2, Math.round(W / 220)), 2);
  const relief = new Float32Array(N);
  for (let i = 0; i < N; i++) relief[i] = world.elevation[i] - elevSmooth[i];
  return {
    W, H, N, world, sea,
    seaF6: blur(seaF, W, H, Math.max(2, Math.round(W / 170)), 2),
    seaF16: blur(seaF, W, H, Math.max(5, Math.round(W / 64)), 2),
    toSea: distanceTo(sea, W, H),
    toLand: distanceTo(land, W, H),
    relief,
    elevSmooth,
    landMass: componentSizes(W, H, land),
  };
}

const DIRS: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** Distance at which a ray leaving `i` in direction `d` first hits `mask`, or `max`. */
function rayHit(c: Ctx, x: number, y: number, d: number, mask: Uint8Array, max: number): number {
  const [dx, dy] = DIRS[d];
  const step = d & 1 ? Math.SQRT2 : 1;
  for (let s = 1; s * step <= max; s++) {
    const yy = y + dy * s;
    if (yy < 0 || yy >= c.H) return max;
    const xx = ((x + dx * s) % c.W + c.W) % c.W;
    if (mask[yy * c.W + xx]) return s * step;
  }
  return max;
}

/**
 * Greedy spatial thinning: take candidates best-first, reject any that lands
 * within `sep` cells of one already taken.
 *
 * Point landforms MUST go through this. Without it a single headland produces
 * forty capes, because "mostly surrounded by sea" is true of every cell on it.
 */
function thin<T extends { x: number; y: number; importance: number }>(
  items: T[],
  W: number,
  sep: number,
  limit: number,
): T[] {
  const out: T[] = [];
  const sep2 = sep * sep;
  for (const it of items.sort((a, b) => b.importance - a.importance)) {
    let ok = true;
    for (const o of out) {
      let dx = Math.abs(o.x - it.x);
      if (dx > W / 2) dx = W - dx;
      const dy = o.y - it.y;
      if (dx * dx + dy * dy < sep2) { ok = false; break; }
    }
    if (!ok) continue;
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Capes
// ---------------------------------------------------------------------------

function findCapes(c: Ctx, budget: number): Landform[] {
  const cand: Landform[] = [];
  const { W, H } = c;
  for (let y = 2; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (c.sea[i] || c.toSea[i] > 1.6) continue;
      // A rock in the ocean satisfies "almost surrounded by sea" perfectly, and
      // naming it a cape is nonsense: a cape is part of a coast.
      if (c.landMass[i] < Math.max(120, c.N * 0.0004)) continue;
      const near = c.seaF6[i];
      if (near < 0.63) continue;
      // A cape has to stick out at BOTH scales. Judging on the small radius
      // alone promotes every rock on a straight coast.
      const far = c.seaF16[i];
      if (far < 0.5) continue;
      cand.push({
        kind: 'cape', x, y, extent: 7, angle: 0,
        importance: Math.min(1, (near - 0.6) * 1.7 + (far - 0.45) * 1.2),
      });
    }
  }
  return thin(cand, W, Math.max(9, W / 90), budget);
}

// ---------------------------------------------------------------------------
// Bays and fjords
// ---------------------------------------------------------------------------

function findBays(c: Ctx, budget: number): Landform[] {
  const cand: Landform[] = [];
  const { W, H, world } = c;
  for (let y = 2; y < H - 2; y++) {
    const lat = Math.abs((0.5 - (y + 0.5) / H) * 180);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!c.sea[i]) continue;
      const d = c.toLand[i];
      if (d > 6) continue;
      const enclosed = 1 - c.seaF16[i];
      if (enclosed < 0.5) continue;
      // Steep walls and cold water: the two things that make an inlet read as a
      // fjord rather than a bay. Both are needed — a cold shallow bight is still
      // a bay, and a warm gorge-walled inlet is a ría.
      let wall = 0, n = 0;
      for (let dy = -5; dy <= 5; dy += 2) {
        for (let dx = -5; dx <= 5; dx += 2) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          const j = yy * W + ((x + dx + W) % W);
          if (world.elevation[j] > 0) { wall = Math.max(wall, c.relief[j]); n++; }
        }
      }
      const narrow = 1 - Math.min(1, d / 4);
      const isFjord = lat > 45 && wall > 0.22 && narrow > 0.4 && n > 6;
      cand.push({
        kind: isFjord ? 'fjord' : 'bay',
        x, y,
        extent: isFjord ? 7 : 11,
        angle: 0,
        importance: Math.min(1, (enclosed - 0.45) * 1.8 + narrow * 0.3 + (isFjord ? 0.12 : 0)),
      });
    }
  }
  return thin(cand, W, Math.max(11, W / 74), budget);
}

// ---------------------------------------------------------------------------
// Straits and isthmuses — the same geometry, twice
// ---------------------------------------------------------------------------

function findPinches(c: Ctx, kind: 'strait' | 'isthmus', budget: number): Landform[] {
  const { W, H } = c;
  const near = kind === 'strait' ? c.sea : null;      // medium the cell must be
  const barrier = kind === 'strait'
    ? ((i: number) => c.sea[i] === 0)                 // what pinches it
    : ((i: number) => c.sea[i] === 1);
  const barrierMask = new Uint8Array(c.N);
  for (let i = 0; i < c.N; i++) barrierMask[i] = barrier(i) ? 1 : 0;
  const openMax = Math.max(16, Math.round(W / 55));
  const pinchMax = Math.max(7, Math.round(W / 130));

  const cand: Landform[] = [];
  for (let y = 3; y < H - 3; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (near ? !near[i] : c.sea[i]) continue;
      // Cheap rejection first: a pinch point is always close to the barrier.
      const dBar = kind === 'strait' ? c.toLand[i] : c.toSea[i];
      if (dBar > pinchMax * 0.75) continue;

      let best: { imp: number; d: number } | null = null;
      for (let d = 0; d < 4; d++) {
        const a = rayHit(c, x, y, d, barrierMask, pinchMax);
        const b = rayHit(c, x, y, d + 4, barrierMask, pinchMax);
        if (a >= pinchMax || b >= pinchMax) continue;
        // …and open, for a long way, in the perpendicular. This is the clause
        // that separates a strait from the mouth of a bay.
        const p = (d + 2) & 7;
        const o1 = rayHit(c, x, y, p, barrierMask, openMax);
        const o2 = rayHit(c, x, y, (p + 4) & 7, barrierMask, openMax);
        if (o1 < openMax || o2 < openMax) continue;
        const width = a + b;
        const imp = Math.min(1, 0.35 + (pinchMax * 2 - width) / (pinchMax * 2.6));
        if (!best || imp > best.imp) best = { imp, d };
      }
      if (!best) continue;
      cand.push({
        kind, x, y,
        extent: kind === 'strait' ? 8 : 9,
        // Name a strait along the water, i.e. across the pinch.
        angle: 0,
        importance: best.imp,
      });
    }
  }
  return thin(cand, W, Math.max(14, W / 60), budget);
}

// ---------------------------------------------------------------------------
// Peninsulas
// ---------------------------------------------------------------------------

function findPeninsulas(c: Ctx, budget: number): Landform[] {
  const { W, H, N } = c;
  const inPen = new Uint8Array(N);
  for (let i = 0; i < N; i++) inPen[i] = !c.sea[i] && c.seaF16[i] > 0.52 ? 1 : 0;

  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const out: Landform[] = [];
  const minSize = Math.max(90, Math.round(N * 0.00035));
  const maxSize = Math.round(N * 0.02);

  for (let s = 0; s < N; s++) {
    if (!inPen[s] || seen[s]) continue;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    const cells: number[] = [];
    let hasNeck = false;
    while (top > 0) {
      const i = stack[--top];
      cells.push(i);
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        const j = yy * W + ((x + dx + W) % W);
        // Touching land that is NOT peninsular is the neck: proof there is a
        // mainland to be a peninsula OF. An island fails this and stays an island.
        if (!inPen[j] && !c.sea[j]) hasNeck = true;
        if (inPen[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
      }
    }
    if (!hasNeck || cells.length < minSize || cells.length > maxSize) continue;

    // Centroid and principal axis, so the name lies along the finger of land.
    const ax = cells[0] % W;
    let sx = 0, sy = 0;
    for (const i of cells) {
      let x = i % W;
      while (x - ax > W / 2) x -= W;
      while (x - ax < -W / 2) x += W;
      sx += x; sy += (i / W) | 0;
    }
    const cx = sx / cells.length, cy = sy / cells.length;
    let mxx = 0, myy = 0, mxy = 0;
    for (const i of cells) {
      let x = i % W;
      while (x - ax > W / 2) x -= W;
      while (x - ax < -W / 2) x += W;
      const dx = x - cx, dy = ((i / W) | 0) - cy;
      mxx += dx * dx; myy += dy * dy; mxy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * mxy, mxx - myy);
    const extent = Math.sqrt(Math.max(mxx, myy) / cells.length) * 2.4;
    out.push({
      kind: 'peninsula',
      x: ((Math.round(cx) % W) + W) % W,
      y: Math.round(cy),
      extent: Math.max(6, extent),
      angle,
      importance: Math.min(1, 0.3 + Math.sqrt(cells.length / maxSize) * 0.9),
    });
  }
  return thin(out, W, Math.max(18, W / 46), budget);
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

const WET = new Set<number>([Biome.Marsh, Biome.SaltMarsh, Biome.Mangrove, Biome.PeatBog, Biome.Beach]);

function findDeltas(c: Ctx, budget: number): Landform[] {
  const { W, H, world } = c;
  const cand: Landform[] = [];
  const byFlow = world.rivers.slice().sort((a, b) => b.flow - a.flow).slice(0, 40);
  for (const r of byFlow) {
    const mouth = r.cells[r.cells.length - 1];
    const x = mouth % W, y = (mouth / W) | 0;
    if (c.toSea[mouth] > 2.5) continue;
    // Flat and waterlogged for some way inland: a river dropping straight into
    // deep water builds an estuary, not a delta.
    let flat = 0, wet = 0, n = 0;
    for (let dy = -5; dy <= 5; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -5; dx <= 5; dx++) {
        const j = yy * W + ((x + dx + W) % W);
        if (world.elevation[j] <= 0) continue;
        n++;
        if (world.elevation[j] < 0.09 && Math.abs(c.relief[j]) < 0.03) flat++;
        if (WET.has(world.biome[j])) wet++;
      }
    }
    if (n < 20) continue;
    const flatFrac = flat / n, wetFrac = wet / n;
    if (flatFrac < 0.42) continue;
    // Anchor a few cells upstream of the mouth, not on it. Anchored at the mouth
    // the name sits half over open water, which reads as a sea label.
    const back = r.cells[Math.max(0, r.cells.length - 4)];
    cand.push({
      kind: 'delta', x: back % W, y: (back / W) | 0, extent: 8, angle: 0,
      importance: Math.min(1, r.flow * 0.7 + flatFrac * 0.3 + wetFrac * 0.4),
    });
  }
  return thin(cand, W, Math.max(12, W / 70), budget);
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

function findPasses(c: Ctx, budget: number): Landform[] {
  const { W, H, world } = c;
  const e = world.elevation;
  const cand: Landform[] = [];
  // A cell is ~40 km wide on a default world, so "the ground either side of the
  // pass" is two cells, not ten. Sampling far out measured the whole mountain
  // range and found two saddles on the entire planet.
  const reach = Math.max(2, Math.round(W / 460));
  const far = reach * 2;
  for (let y = 2; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (e[i] < 0.4 || e[i] > 2.8) continue;
      if (c.elevSmooth[i] < 0.5) continue;   // must be inside high country
      let best: number | null = null;
      for (let d = 0; d < 4; d++) {
        const sample = (dd: number, dist: number) => {
          const [dx, dy] = DIRS[dd];
          const yy = Math.min(H - 1, Math.max(0, y + dy * dist));
          return e[yy * W + (((x + dx * dist) % W + W) % W)];
        };
        // Rise on one axis…
        // "Rises within `far` cells", not "is higher at every distance": along a
        // ridge the ground goes up and then over, and demanding a monotone climb
        // at both sample distances found exactly zero saddles on a whole planet.
        const upA = Math.max(sample(d, reach), sample(d, far)) - e[i];
        const upB = Math.max(sample(d + 4, reach), sample(d + 4, far)) - e[i];
        if (upA < 0.22 || upB < 0.22) continue;
        // …falls on the other. A saddle needs both, or it is just a slope.
        const p = (d + 2) & 7;
        const dnA = e[i] - Math.min(sample(p, reach), sample(p, far));
        const dnB = e[i] - Math.min(sample((p + 4) & 7, reach), sample((p + 4) & 7, far));
        if (dnA < 0.05 || dnB < 0.05) continue;
        const score = Math.min(upA, upB) * 0.6 + Math.min(dnA, dnB) * 0.4;
        if (best === null || score > best) best = score;
      }
      if (best === null) continue;
      cand.push({ kind: 'pass', x, y, extent: 6, angle: 0, importance: Math.min(1, best / 0.7) });
    }
  }
  return thin(cand, W, Math.max(13, W / 64), budget);
}

// ---------------------------------------------------------------------------
// Valleys and gorges
// ---------------------------------------------------------------------------

function findValleys(c: Ctx, budget: number): Landform[] {
  const { W, H, world } = c;
  const e = world.elevation;
  const out: Landform[] = [];
  const off = Math.max(2, Math.round(W / 460));
  for (const r of world.rivers.slice().sort((a, b) => b.flow - a.flow).slice(0, 44)) {
    const cells = r.cells;
    if (cells.length < 16) continue;
    let runStart = -1;
    let runWall = 0;
    const flushRun = (endEx: number) => {
      if (runStart < 0) return;
      const len = endEx - runStart;
      if (len >= 9) {
        const seg = Array.from(cells.slice(runStart, endEx));
        const mid = seg[len >> 1];
        const x = mid % W, y = (mid / W) | 0;
        const wall = runWall / len;
        // A gorge is a valley whose walls you cannot walk up.
        const gorge = wall > 0.42;
        out.push({
          kind: gorge ? 'gorge' : 'valley',
          x, y,
          extent: Math.max(8, len * 0.5),
          angle: 0,
          importance: Math.min(1, 0.25 + wall * 0.8 + Math.min(0.3, len / 90)),
          cells: seg,
        });
      }
      runStart = -1;
      runWall = 0;
    };
    for (let k = 2; k < cells.length - 2; k++) {
      const i = cells[k];
      const x = i % W, y = (i / W) | 0;
      const nx = cells[k + 1] % W, ny = (cells[k + 1] / W) | 0;
      // Perpendicular to the channel, normalised on the grid.
      let tx = nx - x;
      if (tx > W / 2) tx -= W; else if (tx < -W / 2) tx += W;
      const ty = ny - y;
      const tl = Math.hypot(tx, ty) || 1;
      const px = -ty / tl, py = tx / tl;
      const bank = (sign: number) => {
        const yy = Math.round(y + py * off * sign);
        if (yy < 0 || yy >= H) return -1;
        const xx = ((Math.round(x + px * off * sign) % W) + W) % W;
        return e[yy * W + xx] - e[i];
      };
      const a = bank(1), b = bank(-1);
      const wall = Math.min(a, b);
      if (a > 0.07 && b > 0.07 && e[i] > 0.05) {
        if (runStart < 0) runStart = k;
        runWall += wall;
      } else {
        flushRun(k);
      }
    }
    flushRun(cells.length - 2);
  }
  return thin(out, W, Math.max(16, W / 52), budget);
}

// ---------------------------------------------------------------------------

export interface LandformBudget {
  cape?: number; bay?: number; strait?: number; isthmus?: number;
  peninsula?: number; delta?: number; pass?: number; valley?: number;
}

/**
 * Every landform on the map, thinned so the label layer has a chance.
 *
 * Budgets scale with world area: the same absolute count on a 512-wide world and
 * a 2048-wide one gives either a bare coast or a wall of type.
 */
export function findLandforms(world: WorldData, budget: LandformBudget = {}): Landform[] {
  const c = makeCtx(world);
  const area = c.N / (1024 * 512);
  const n = (base: number, override?: number) =>
    override ?? Math.max(3, Math.round(base * Math.sqrt(area)));
  return [
    ...findCapes(c, n(18, budget.cape)),
    ...findBays(c, n(18, budget.bay)),
    ...findPinches(c, 'strait', n(9, budget.strait)),
    ...findPinches(c, 'isthmus', n(7, budget.isthmus)),
    ...findPeninsulas(c, n(12, budget.peninsula)),
    ...findDeltas(c, n(8, budget.delta)),
    ...findPasses(c, n(14, budget.pass)),
    ...findValleys(c, n(14, budget.valley)),
  ];
}
