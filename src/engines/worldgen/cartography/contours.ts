// ============================================
// Cartography — Contour extraction and curve shaping
// ============================================
// Turns raster fields into the vector polylines the ink layers need:
// coastlines, lake shores, biome-region outlines, political borders.
//
// Marching squares gives sub-cell accuracy (linear interpolation on the cell
// edge), which matters: a coastline snapped to cell corners reads as a staircase
// no amount of smoothing will hide.

export interface Pt { x: number; y: number }
export interface Contour { pts: Pt[]; closed: boolean }

const EPS = 1e-9;

/**
 * Extract iso-lines of `field` at `level`. Returns polylines in grid
 * coordinates. Cells above the level are "inside"; loops come out
 * counter-clockwise around inside regions in screen coords (y down).
 */
export function marchingSquares(
  field: Float32Array,
  W: number,
  H: number,
  level: number,
  wrapX = true,
): Contour[] {
  // Segment soup, then stitched into polylines by endpoint matching.
  const segs: number[] = []; // x0,y0,x1,y1 quadruples
  const at = (x: number, y: number) => field[y * W + (wrapX ? ((x % W) + W) % W : Math.min(W - 1, Math.max(0, x)))];

  const lerp = (v0: number, v1: number) => {
    const d = v1 - v0;
    if (Math.abs(d) < EPS) return 0.5;
    return (level - v0) / d;
  };

  const xMax = wrapX ? W : W - 1;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < xMax; x++) {
      const v00 = at(x, y), v10 = at(x + 1, y), v11 = at(x + 1, y + 1), v01 = at(x, y + 1);
      let code = 0;
      if (v00 > level) code |= 1;
      if (v10 > level) code |= 2;
      if (v11 > level) code |= 4;
      if (v01 > level) code |= 8;
      if (code === 0 || code === 15) continue;

      // Edge crossing points (top, right, bottom, left).
      const T = { x: x + lerp(v00, v10), y };
      const R = { x: x + 1, y: y + lerp(v10, v11) };
      const B = { x: x + lerp(v01, v11), y: y + 1 };
      const L = { x, y: y + lerp(v00, v01) };

      const push = (a: Pt, b: Pt) => segs.push(a.x, a.y, b.x, b.y);
      switch (code) {
        case 1: push(L, T); break;
        case 2: push(T, R); break;
        case 3: push(L, R); break;
        case 4: push(R, B); break;
        case 5: { // saddle
          const c = (v00 + v10 + v11 + v01) / 4;
          if (c > level) { push(L, B); push(R, T); } else { push(L, T); push(R, B); }
          break;
        }
        case 6: push(T, B); break;
        case 7: push(L, B); break;
        case 8: push(B, L); break;
        case 9: push(B, T); break;
        case 10: { // saddle
          const c = (v00 + v10 + v11 + v01) / 4;
          if (c > level) { push(T, R); push(B, L); } else { push(T, L); push(B, R); }
          break;
        }
        case 11: push(B, R); break;
        case 12: push(R, L); break;
        case 13: push(R, T); break;
        case 14: push(T, L); break;
      }
    }
  }
  return stitch(segs, W, wrapX);
}

/** Join a segment soup into polylines by snapping shared endpoints. */
function stitch(segs: number[], W: number, wrapX: boolean): Contour[] {
  const Q = 1000; // quantisation for endpoint identity
  const key = (x: number, y: number) => `${Math.round(x * Q)},${Math.round(y * Q)}`;
  const wrapKey = (x: number, y: number) => (wrapX ? key(((x % W) + W) % W, y) : key(x, y));

  const starts = new Map<string, number[]>();
  const used = new Uint8Array(segs.length / 4);
  for (let s = 0; s < segs.length; s += 4) {
    const k = wrapKey(segs[s], segs[s + 1]);
    let arr = starts.get(k);
    if (!arr) starts.set(k, (arr = []));
    arr.push(s);
  }

  const out: Contour[] = [];
  for (let s0 = 0; s0 < segs.length; s0 += 4) {
    if (used[s0 / 4]) continue;
    used[s0 / 4] = 1;
    const pts: Pt[] = [{ x: segs[s0], y: segs[s0 + 1] }, { x: segs[s0 + 2], y: segs[s0 + 3] }];
    // Walk forward.
    for (;;) {
      const tail = pts[pts.length - 1];
      const cands = starts.get(wrapKey(tail.x, tail.y));
      let found = -1;
      if (cands) for (const c of cands) if (!used[c / 4]) { found = c; break; }
      if (found < 0) break;
      used[found / 4] = 1;
      let nx = segs[found + 2];
      const ny = segs[found + 3];
      // Keep the polyline continuous across the seam by un-wrapping x.
      if (wrapX) {
        const px = segs[found];
        const shift = tail.x - px;
        if (Math.abs(shift) > 1) nx += shift;
      }
      pts.push({ x: nx, y: ny });
      if (Math.abs(nx - pts[0].x) < 1e-6 && Math.abs(ny - pts[0].y) < 1e-6) break;
    }
    const closed =
      pts.length > 3 &&
      Math.abs(pts[pts.length - 1].x - pts[0].x) < 1e-6 &&
      Math.abs(pts[pts.length - 1].y - pts[0].y) < 1e-6;
    if (closed) pts.pop();
    if (pts.length >= 3) out.push({ pts, closed });
  }
  return out;
}

/** Chaikin corner cutting — the cheapest way to a smooth organic coastline. */
export function chaikin(pts: Pt[], closed: boolean, iterations = 2): Pt[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const n = cur.length;
    if (n < 3) return cur;
    const next: Pt[] = [];
    const last = closed ? n : n - 1;
    if (!closed) next.push(cur[0]);
    for (let i = 0; i < last; i++) {
      const a = cur[i], b = cur[(i + 1) % n];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (!closed) next.push(cur[n - 1]);
    cur = next;
  }
  return cur;
}

/** Ramer–Douglas–Peucker. Keeps detail where the line actually bends. */
export function simplify(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    if (i1 - i0 < 2) continue;
    const a = pts[i0], b = pts[i1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let best = -1, bestD = 0;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const px = a.x + t * dx - p.x, py = a.y + t * dy - p.y;
      const d = px * px + py * py;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (bestD > t2 && best > 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Total length of a polyline. */
export function pathLength(pts: Pt[], closed = false): number {
  let L = 0;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    L += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return L;
}

/** Resample a polyline to evenly spaced points — needed before per-character
 *  text layout and before fractal displacement. */
export function resample(pts: Pt[], spacing: number, closed = false): Pt[] {
  if (pts.length < 2) return pts;
  const out: Pt[] = [pts[0]];
  let carry = 0;
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < EPS) continue;
    let t = (spacing - carry) / len;
    while (t <= 1) {
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      t += spacing / len;
    }
    carry = (carry + len) % spacing;
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/**
 * Hand-drawn wobble. Displaces each vertex along the local normal by smoothed
 * noise, so the line keeps its shape but loses its machine precision. Amplitude
 * must stay well under the local sampling distance or the curve self-crosses.
 */
export function wobble(pts: Pt[], amplitude: number, rand: () => number, closed = false): Pt[] {
  const n = pts.length;
  if (n < 3 || amplitude <= 0) return pts;
  // Smoothed 1-D noise along the parameter.
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = rand() * 2 - 1;
  const smooth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += raw[closed ? ((i + k) % n + n) % n : Math.min(n - 1, Math.max(0, i + k))];
    smooth[i] = s / 5;
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y;
    const L = Math.hypot(tx, ty) || 1;
    const nx = -ty / L, ny = tx / L;
    const d = smooth[i] * amplitude;
    out.push({ x: p.x + nx * d, y: p.y + ny * d });
  }
  return out;
}

/** Signed area (screen coords, y down): negative = counter-clockwise. */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(pts: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

export function bbox(pts: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/** Point-in-polygon (ray casting). */
export function pointInPolygon(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
