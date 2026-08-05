// ============================================
// City Generator — Polygon toolkit
// ============================================
// Everything the city layout needs from computational geometry: half-plane
// Voronoi, polygon cutting, insetting, and the three cutters (bisect, ring,
// radial) that turn a district polygon into building footprints.
//
// Voronoi is built by half-plane clipping rather than a Delaunay dual. For the
// couple of hundred sites a city uses, the O(n²) clip is fast, has no
// degenerate-case handling to get wrong, and yields convex cells by
// construction — which every downstream cutter relies on.

export interface V { x: number; y: number }
export type Poly = V[];

export const EPS = 1e-9;

export const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
export const dot = (a: V, b: V): number => a.x * b.x + a.y * b.y;
export const len = (a: V): number => Math.hypot(a.x, a.y);
export const dist = (a: V, b: V): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: V, b: V, t: number): V => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const rot90 = (a: V): V => ({ x: -a.y, y: a.x });

export function norm(a: V, l = 1): V {
  const m = len(a) || 1;
  return { x: (a.x / m) * l, y: (a.y / m) * l };
}

export function area(p: Poly): number {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function signedArea(p: Poly): number {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function centroid(p: Poly): V {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[i], r = p[(i + 1) % n];
    const f = q.x * r.y - r.x * q.y;
    cx += (q.x + r.x) * f;
    cy += (q.y + r.y) * f;
    a += f;
  }
  if (Math.abs(a) < EPS) {
    let sx = 0, sy = 0;
    for (const q of p) { sx += q.x; sy += q.y; }
    return { x: sx / p.length, y: sy / p.length };
  }
  a *= 3;
  return { x: cx / a, y: cy / a };
}

export function perimeter(p: Poly): number {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) s += dist(p[i], p[(i + 1) % n]);
  return s;
}

/** 4πA / P². Circle = 1, square ≈ 0.79, sliver → 0. */
export function compactness(p: Poly): number {
  const per = perimeter(p);
  return per < EPS ? 0 : (4 * Math.PI * area(p)) / (per * per);
}

export function longestEdge(p: Poly): number {
  let best = 0, bestLen = -1;
  for (let i = 0, n = p.length; i < n; i++) {
    const l = dist(p[i], p[(i + 1) % n]);
    if (l > bestLen) { bestLen = l; best = i; }
  }
  return best;
}

export function contains(p: Poly, q: V): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Clip a convex polygon by the half-plane on the `keep` side of a line. */
export function clipHalfPlane(poly: Poly, p: V, n: V): Poly {
  // Keeps points where dot(x - p, n) <= 0.
  const out: Poly = [];
  const N = poly.length;
  for (let i = 0; i < N; i++) {
    const a = poly[i], b = poly[(i + 1) % N];
    const da = dot(sub(a, p), n);
    const db = dot(sub(b, p), n);
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push(lerp(a, b, t));
    }
  }
  return out;
}

/**
 * Voronoi cells by half-plane clipping against a bounding polygon. Returns one
 * convex cell per site, in input order.
 */
export function voronoi(sites: V[], bounds: Poly): Poly[] {
  return sites.map((s, i) => {
    let cell = bounds;
    for (let j = 0; j < sites.length && cell.length >= 3; j++) {
      if (i === j) continue;
      const o = sites[j];
      const mid = lerp(s, o, 0.5);
      // Normal points away from `s`, so the half-plane kept is the one nearer s.
      cell = clipHalfPlane(cell, mid, sub(o, s));
    }
    return cell;
  });
}

/** One step of Lloyd relaxation — moves each site to its cell's centroid. */
export function relax(sites: V[], bounds: Poly, keep?: (i: number) => boolean): V[] {
  const cells = voronoi(sites, bounds);
  return sites.map((s, i) => {
    if (keep && !keep(i)) return s;
    const c = cells[i];
    return c.length >= 3 ? centroid(c) : s;
  });
}

/**
 * Slice a polygon with the infinite line through p1→p2, optionally opening a
 * gap of `gap` units centred on the cut. Returns 1 or 2 pieces.
 */
export function cut(poly: Poly, p1: V, p2: V, gap = 0): Poly[] {
  const d = sub(p2, p1);
  const n = norm(rot90(d));
  const offset = gap / 2;
  const left = clipHalfPlane(poly, add(p1, scale(n, offset)), n);
  const right = clipHalfPlane(poly, add(p1, scale(n, -offset)), scale(n, -1));
  const out: Poly[] = [];
  if (left.length >= 3 && area(left) > EPS) out.push(left);
  if (right.length >= 3 && area(right) > EPS) out.push(right);
  return out.length ? out : [poly];
}

/**
 * Split a polygon perpendicular to one of its edges. `ratio` picks the point
 * along that edge; `angle` skews the cut. Always cutting perpendicular to the
 * LONGEST edge is what keeps the resulting footprints rectangular.
 */
export function bisect(poly: Poly, edgeIndex: number, ratio = 0.5, angle = 0, gap = 0): Poly[] {
  const n = poly.length;
  const v = poly[edgeIndex];
  const next = poly[(edgeIndex + 1) % n];
  const p1 = lerp(v, next, ratio);
  const d = sub(next, v);
  const cosB = Math.cos(angle), sinB = Math.sin(angle);
  const vx = d.x * cosB - d.y * sinB;
  const vy = d.y * cosB + d.x * sinB;
  const p2 = { x: p1.x - vy, y: p1.y + vx };
  return cut(poly, p1, p2, gap);
}

/**
 * Peel a ring of strips off the inside of a polygon and return them plus the
 * leftover core. Short edges are peeled first so a long edge's slice cannot
 * consume the whole shape before the others get their turn.
 *
 * The core — which the original implementation discards — is returned as the
 * courtyard, because a cloister around an open court is the single most
 * recognisable medieval institutional plan.
 */
export function ring(poly: Poly, thickness: number): { strips: Poly[]; court: Poly | null } {
  const slices: { p1: V; p2: V; len: number }[] = [];
  const N = poly.length;
  // Inward normal depends on winding; normalise to counter-clockwise first.
  const p = signedArea(poly) < 0 ? [...poly].reverse() : poly;
  for (let i = 0; i < N; i++) {
    const v1 = p[i], v2 = p[(i + 1) % N];
    const v = sub(v2, v1);
    const n = norm(rot90(v), thickness);
    slices.push({ p1: add(v1, n), p2: add(v2, n), len: len(v) });
  }
  slices.sort((a, b) => a.len - b.len);
  const strips: Poly[] = [];
  let core: Poly = p;
  for (const s of slices) {
    if (core.length < 3) break;
    const halves = cut(core, s.p1, s.p2);
    if (halves.length === 2) {
      // The half containing the polygon's centre is the remaining core.
      const c = centroid(p);
      const keepFirst = contains(halves[0], c);
      core = keepFirst ? halves[0] : halves[1];
      strips.push(keepFirst ? halves[1] : halves[0]);
    } else {
      core = halves[0];
    }
  }
  return { strips, court: core.length >= 3 && area(core) > EPS ? core : null };
}

/** Pie-slice a polygon from its centre — the standard park subdivision. */
export function radial(poly: Poly, gap = 0, center?: V): Poly[] {
  const c = center ?? centroid(poly);
  const out: Poly[] = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    let sector: Poly = [c, a, b];
    if (gap > 0) sector = shrink(sector, gap / 2);
    if (sector.length >= 3 && area(sector) > EPS) out.push(sector);
  }
  return out;
}

/** Radial, but only from the longest edge's midpoint — for awkward shapes. */
export function semiRadial(poly: Poly, gap = 0): Poly[] {
  const e = longestEdge(poly);
  const c = lerp(poly[e], poly[(e + 1) % poly.length], 0.5);
  return radial(poly, gap, c);
}

/** Inset every edge by `d`. Convex input only, which is what Voronoi gives. */
export function shrink(poly: Poly, d: number): Poly {
  if (d <= 0) return poly;
  const p = signedArea(poly) < 0 ? [...poly].reverse() : poly;
  let out = p;
  const N = p.length;
  for (let i = 0; i < N; i++) {
    if (out.length < 3) return [];
    const v1 = p[i], v2 = p[(i + 1) % N];
    const n = norm(rot90(sub(v2, v1)), d);
    out = clipHalfPlane(out, add(v1, n), scale(n, -1));
  }
  return out.length >= 3 && area(out) > EPS ? out : [];
}

/** Per-edge inset — lets a block pull back further from a main street than
 *  from an alley. */
export function shrinkEdges(poly: Poly, dists: number[]): Poly {
  const p = signedArea(poly) < 0 ? [...poly].reverse() : poly;
  const ds = signedArea(poly) < 0 ? [...dists].reverse() : dists;
  let out = p;
  const N = p.length;
  for (let i = 0; i < N; i++) {
    const d = ds[i] ?? 0;
    if (d <= 0) continue;
    if (out.length < 3) return [];
    const v1 = p[i], v2 = p[(i + 1) % N];
    const n = norm(rot90(sub(v2, v1)), d);
    out = clipHalfPlane(out, add(v1, n), scale(n, -1));
  }
  return out.length >= 3 && area(out) > EPS ? out : [];
}

/**
 * Cut a perimeter strip into individual plots along its length.
 *
 * This is the piece the plan was missing. A medieval block is not a shape that
 * gets chopped until the pieces are house-sized — it is a row of BURGAGES: long
 * thin lots, side by side, each with its narrow end on the street. That is why
 * a real town reads as terraces along a frontage and this one read as a quilt.
 *
 * `strip` comes from `ring()`, so it already runs along one edge of the block
 * and its long axis is that edge. Slicing it at a fixed frontage gives the row.
 * The number of plots is rounded, not floored, so a strip always yields at
 * least one and never leaves a half-plot of waste at the end.
 *
 * `gap` is the party-wall clearance. Zero is correct for a dense core — town
 * houses shared walls — and a small positive number opens the row up.
 */
export function slicePlots(strip: Poly, frontage: number, gap = 0): Poly[] {
  if (strip.length < 3 || frontage <= 0) return [];
  const e = longestEdge(strip);
  const a = strip[e], b = strip[(e + 1) % strip.length];
  const d = norm(sub(b, a));
  if (!isFinite(d.x) || !isFinite(d.y)) return [strip];
  // Extent along the axis, measured on every vertex: the longest edge sets the
  // direction, but a strip peeled off a convex cell is a trapezium and its
  // corners can reach past that edge's ends.
  let t0 = Infinity, t1 = -Infinity;
  for (const v of strip) {
    const t = (v.x - a.x) * d.x + (v.y - a.y) * d.y;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  const span = t1 - t0;
  const n = Math.max(1, Math.round(span / frontage));
  if (n === 1) return [strip];

  const out: Poly[] = [];
  let rest = strip;
  const perp = rot90(d);
  for (let i = 1; i < n && rest.length >= 3; i++) {
    const t = t0 + (span * i) / n;
    const p1 = { x: a.x + d.x * t, y: a.y + d.y * t };
    const p2 = { x: p1.x + perp.x, y: p1.y + perp.y };
    const halves = cut(rest, p1, p2, gap);
    if (halves.length < 2) break;
    // Which half is behind the cut: the one whose centroid projects lower.
    const c0 = centroid(halves[0]);
    const proj = (v: V) => (v.x - a.x) * d.x + (v.y - a.y) * d.y;
    const behind = proj(c0) < t ? 0 : 1;
    out.push(halves[behind]);
    rest = halves[1 - behind];
  }
  if (rest.length >= 3 && area(rest) > EPS) out.push(rest);
  return out;
}

/** Regular n-gon, used for market wells and tower footprints. */
export function circle(r: number, segments = 16, center: V = { x: 0, y: 0 }): Poly {
  const out: Poly = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
  }
  return out;
}

export function rect(w: number, h: number, center: V = { x: 0, y: 0 }, angle = 0): Poly {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [
    { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 },
  ].map((p) => ({ x: center.x + p.x * c - p.y * s, y: center.y + p.x * s + p.y * c }));
}

/** Smooth a closed ring by averaging each vertex with its neighbours. */
export function smoothPoly(poly: Poly, t = 0.5): Poly {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    return { x: p.x * (1 - t) + ((a.x + b.x) / 2) * t, y: p.y * (1 - t) + ((a.y + b.y) / 2) * t };
  });
}

export function bbox(poly: Poly): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}
