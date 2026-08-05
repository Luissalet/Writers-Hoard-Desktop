import io

# ===========================================================================
# 1. THE VOCABULARY  (core/edits.ts)
# ===========================================================================
p = "src/engines/worldgen/core/edits.ts"
s = io.open(p, encoding="utf-8").read()

anchor = "  /** The negative of the river brush: unmake the watercourses it crosses. */"
new_kinds = '''  /**
   * WHERE A COUNTRY REACHES.
   *
   * The generator grows realms by cost-based flood fill from the capitals, so
   * their borders settle onto ridges and wastes the way real ones do — a good
   * first draft and, for a novelist, only ever a first draft. The war that moved
   * the frontier is not in the terrain.
   *
   * Three shapes, because redrawing a border is three different gestures:
   *   · `realm`     a brush, for nudging a frontier a few leagues
   *   · `realmFill` a bucket that stops at real edges, for "this whole peninsula"
   *   · `realmArea` a polygon, for "these provinces, exactly here"
   *
   * `realm` is an INDEX into `geography.realms`, or −1 for unclaimed. The index
   * is what `editKey('realm', 0, 0, `${id}:`)` already uses for renames, so the
   * two agree; like a rename, a painted border follows the seed, and a world
   * regenerated with different capitals can hand a province to a neighbour.
   */
  | { kind: 'realm'; realm: number; stroke: Stroke }
  /**
   * Bucket fill, stopped by the ground itself.
   *
   * `bounded` says what counts as an edge. `coast` is always an edge — a country
   * does not flow across the sea — and the other two add the features a reader
   * points at when they say "up to the river" or "the far side of the range".
   */
  | { kind: 'realmFill'; realm: number; x: number; y: number;
      bounded: 'coast' | 'river' | 'ridge'; maxCells?: number }
  /** A closed shape. `smooth` rounds the corners first, which is the difference
   *  between the straight-edged and the curved lasso. */
  | { kind: 'realmArea'; realm: number; pts: Pt[]; smooth: boolean }
'''
assert anchor in s
s = s.replace(anchor, new_kinds + anchor, 1)

# --- AppliedEdits carries the overlay -------------------------------------
old = """  /** Circles inside which generated roads are erased. */
  roadErasers: { x: number; y: number; radius: number }[];
}"""
new = """  /** Circles inside which generated roads are erased. */
  roadErasers: { x: number; y: number; radius: number }[];
  /**
   * Realm ownership the reader painted, or null if they never has.
   *
   * `-2` is UNTOUCHED, `-1` is explicitly unclaimed, `>= 0` is a realm index.
   * Untouched needs its own value because "nobody owns this" is a thing a reader
   * can legitimately paint, and it must not read the same as "I never said".
   * Allocated lazily: two bytes a cell is 4 MB on a 2048 world, and most worlds
   * never carry one.
   */
  realmCells: Int16Array | null;
}"""
assert old in s; s = s.replace(old, new, 1)

old = """    renames: {}, populations: {}, removed: new Set(), moves: {}, styles: {},
    roads: [], roadErasers: [],
  };"""
new = """    renames: {}, populations: {}, removed: new Set(), moves: {}, styles: {},
    roads: [], roadErasers: [], realmCells: null,
  };"""
assert old in s; s = s.replace(old, new, 1)

# --- apply, in list order, after the biome overlay -------------------------
marker = "    } else if (e.kind === 'eraseRoads') {"
assert marker in s
realm_apply = '''    } else if (e.kind === 'realm' || e.kind === 'realmFill' || e.kind === 'realmArea') {
      // In LIST ORDER with each other, like the biome overlay: paint a province,
      // hand a corner of it back, paint over it again. Ordering is the only thing
      // that makes these strokes rather than commands.
      if (!out.realmCells) { out.realmCells = new Int16Array(N); out.realmCells.fill(-2); }
      const cells = out.realmCells;
      const own = Math.max(-1, Math.min(32767, Math.round(e.realm)));
      if (e.kind === 'realm') {
        const m = strokeMask(e.stroke, W, H);
        m?.each((i, c) => {
          // Categorical, so coverage is a threshold with the same dither the
          // biome brush uses — a hard circle around a country reads as a stamp.
          const hsh = Math.sin(i * 45.164 + 11.71) * 27183.13;
          const jitter = (hsh - Math.floor(hsh)) * 0.45;
          if (c * e.stroke.strength <= 0.35 + jitter * 0.4) return;
          cells[i] = own;
        });
      } else if (e.kind === 'realmFill') {
        for (const i of realmFloodCells(world, e)) cells[i] = own;
      } else {
        for (const i of polygonCells(e.pts, e.smooth, W, H)) cells[i] = own;
      }
'''
s = s.replace(marker, realm_apply + marker, 1)

# --- the two rasterisers ---------------------------------------------------
tail_anchor = "/** Rough cost estimate, so the UI can warn"
assert tail_anchor in s
helpers = '''/**
 * Flood fill from a point, stopped by the ground.
 *
 * Four-connected over LAND only — the sea is always an edge, because a realm
 * that leaks across an ocean is never what anyone meant. `river` also stops at
 * any cell carrying real discharge, and `ridge` at any cell steep enough to be
 * a watershed; both are the features a reader is pointing at when they say "up
 * to the river" or "the other side of the mountains".
 *
 * Bounded by `maxCells` so a mis-aimed click on a continent is a mistake you
 * undo, not a wait you sit through.
 */
export function realmFloodCells(
  world: WorldData,
  e: { x: number; y: number; bounded: 'coast' | 'river' | 'ridge'; maxCells?: number },
): number[] {
  const W = world.width, H = world.height;
  const { elevation, flow } = world;
  const cap = Math.max(1, Math.min(W * H, e.maxCells ?? Math.round(W * H * 0.25)));
  const sx = ((Math.round(e.x) % W) + W) % W;
  const sy = Math.min(H - 1, Math.max(0, Math.round(e.y)));
  const start = sy * W + sx;
  if (elevation[start] <= 0) return [];

  // A ridge is measured the way the eye reads steepness: the fall across one
  // cell, from central differences, in kilometres of elevation units.
  const steep = (i: number): number => {
    const x = i % W, y = (i / W) | 0;
    const l = elevation[y * W + ((x - 1 + W) % W)];
    const r = elevation[y * W + ((x + 1) % W)];
    const u = elevation[Math.max(0, y - 1) * W + x];
    const d = elevation[Math.min(H - 1, y + 1) * W + x];
    return Math.max(Math.abs(r - l), Math.abs(d - u)) * 0.5;
  };
  const blocked = (i: number): boolean => {
    if (elevation[i] <= 0) return true;
    if (e.bounded === 'river' && flow[i] > 0.45) return true;
    if (e.bounded === 'ridge' && steep(i) > 0.28) return true;
    return false;
  };

  const seen = new Uint8Array(W * H);
  const out: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length && out.length < cap) {
    const i = stack.pop() as number;
    out.push(i);
    const x = i % W, y = (i / W) | 0;
    const around = [
      y * W + ((x + 1) % W),
      y * W + ((x - 1 + W) % W),
      y > 0 ? (y - 1) * W + x : -1,
      y < H - 1 ? (y + 1) * W + x : -1,
    ];
    for (const n of around) {
      if (n < 0 || seen[n]) continue;
      seen[n] = 1;
      if (blocked(n)) continue;
      stack.push(n);
    }
  }
  return out;
}

/**
 * Every cell inside a closed polygon, by scanline.
 *
 * `smooth` runs the ring through Chaikin first, which is the whole difference
 * between the straight-edged lasso and the curved one — the same corner-cutting
 * the coastlines use, so a hand-drawn frontier sits in the same visual language
 * as the generated ones.
 *
 * The ring is un-wrapped as it is read, so a province drawn across the
 * antimeridian is one shape rather than two touching the opposite edges.
 */
export function polygonCells(pts: Pt[], smooth: boolean, W: number, H: number): number[] {
  if (pts.length < 3) return [];
  const ring: Pt[] = [];
  let prev = pts[0].x;
  for (const p of pts) {
    let x = p.x;
    while (x - prev > W / 2) x -= W;
    while (x - prev < -W / 2) x += W;
    prev = x;
    ring.push({ x, y: p.y });
  }
  const shape = smooth ? chaikinRing(ring, 2) : ring;

  let y0 = Infinity, y1 = -Infinity;
  for (const p of shape) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  y0 = Math.max(0, Math.floor(y0));
  y1 = Math.min(H - 1, Math.ceil(y1));
  const out: number[] = [];
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let k = 0; k < shape.length; k++) {
      const a = shape[k], b = shape[(k + 1) % shape.length];
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
        xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.ceil(xs[k] - 0.5), to = Math.floor(xs[k + 1] - 0.5);
      for (let gx = from; gx <= to; gx++) out.push(y * W + (((gx % W) + W) % W));
    }
  }
  return out;
}

/** Corner cutting on a CLOSED ring — the open-path version lives in
 *  `cartography/contours.ts` and would leave the last corner square. */
function chaikinRing(pts: Pt[], iterations: number): Pt[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const next: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i], b = cur[(i + 1) % cur.length];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    cur = next;
  }
  return cur;
}

'''
s = s.replace(tail_anchor, helpers + tail_anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("edits.ts: realm vocabulary + rasterisers")

# ===========================================================================
# 2. APPLYING IT  (core/settlements.ts)
# ===========================================================================
p = "src/engines/worldgen/core/settlements.ts"
s = io.open(p, encoding="utf-8").read()
old = "  for (const s of settlements) s.realm = realmOf[s.y * W + s.x];"
new = """  /**
   * The reader's own frontiers, over the generator's.
   *
   * Applied HERE — after the flood fill and before settlements are assigned to
   * realms, roads are routed and the country is named — so a province handed to
   * a neighbour takes its towns with it, and everything downstream sees one
   * consistent map rather than a drawing laid on top of a different one.
   */
  const paintedRealms = world.painted?.realmCells;
  if (paintedRealms) {
    const limit = realms.length;
    for (let i = 0; i < W * H; i++) {
      const v = paintedRealms[i];
      if (v === -2) continue;                       // untouched
      if (v >= limit) continue;                     // a realm this world no longer has
      realmOf[i] = elevation[i] > 0 ? v : -1;       // never claim open water
    }
    for (const r of realms) r.cellCount = 0;
    for (let i = 0; i < W * H; i++) {
      const r = realmOf[i];
      if (r >= 0 && r < limit) realms[r].cellCount++;
    }
  }

  for (const s of settlements) s.realm = realmOf[s.y * W + s.x];"""
assert old in s; s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("settlements.ts: overlay applied")
