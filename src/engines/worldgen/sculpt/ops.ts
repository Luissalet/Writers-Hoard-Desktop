// ============================================
// Sculpt — the brushes themselves
// ============================================
// There used to be two implementations of every brush: one in `applyEdits`, which
// is the truth, and one in the live view, which is what you actually see while
// you drag. They were written to agree and they did not — `flatten` levelled to
// the mean of the whole stroke when replayed and to a 3×3 neighbourhood while you
// were drawing it, which is a different tool wearing the same name.
//
// So there is now ONE implementation, here, and both callers go through it. The
// live preview is not "written to match" the committed edit; it *is* the
// committed edit, run over the part of the stroke that exists so far. Divergence
// is not a bug that got fixed, it is a bug that can no longer be written.
//
// Everything in this file obeys three rules, because the storage contract depends
// on them: a brush is a pure function of (seed, stroke, the field before the
// stroke); it never reads its own output; and it never consults anything that is
// not in the edit list.

import type { Stroke, TerrainOp, LandOp } from '../core/edits';
import { SphereNoise } from '../core/noise';

// ---------------------------------------------------------------------------
// Falloff
// ---------------------------------------------------------------------------

/**
 * The shape of the brush's edge.
 *
 * Sculpting programs put this behind a curve editor and it is the control people
 * reach for most after size: a soft round falloff makes hills, a sharp one makes
 * ridges and cliffs, a flat one makes plateaus with a wall round them. Four named
 * curves cover what a curve editor is used for without inventing a widget.
 */
export type Falloff = 'smooth' | 'sharp' | 'linear' | 'flat';

/**
 * The shape of the brush itself.
 *
 * Everything a brush does here was a disc, and a disc is a tell. Paint a patch
 * of desert with one and you get a crop circle; cut a plateau and you get a
 * bowl; drag a scarp and you get a row of beads. The falloff curve controls how
 * the paint FADES, which is a different question from what shape it is.
 *
 *   round    the disc. Still the right answer most of the time.
 *   square   Chebyshev distance, rotatable. Mesas, benches, deliberate cuts —
 *            anything that should read as made rather than grown.
 *   ragged   a disc whose rim is pushed in and out by a noise field sampled in
 *            WORLD space, not per stamp. That last part is the whole trick: two
 *            overlapping stamps perturb a shared cell identically, so the edge
 *            comes out as coherent lobes instead of per-pixel fizz.
 *   ridge    an ellipse whose long axis follows the direction of the stroke, so
 *            a drag lays a ridgeline or a dune instead of a sausage of circles.
 */
export type BrushTip = 'round' | 'square' | 'ragged' | 'ridge';

export interface TipSpec {
  kind: BrushTip;
  /** Radians. `square` uses it directly; `ridge` gets it from the stroke. */
  angle: number;
  /** 0–1, how broken the rim of a `ragged` tip is. */
  jitter: number;
  /** How much longer than wide a `ridge` tip is. */
  aspect: number;
}

export const DEFAULT_TIP: TipSpec = { kind: 'round', angle: 0, jitter: 0.5, aspect: 2.6 };

export function tipOf(stroke: Stroke): TipSpec {
  return {
    kind: stroke.tip ?? 'round',
    angle: ((stroke.angle ?? 0) * Math.PI) / 180,
    jitter: Math.min(1, Math.max(0, stroke.jitter ?? 0.5)),
    aspect: Math.max(1, stroke.aspect ?? 2.6),
  };
}

/**
 * Value noise on the integer lattice, for the ragged rim.
 *
 * Sampled at the CELL rather than at an offset from the stamp centre, which is
 * what makes the rim agree with itself where stamps overlap.
 */
function lattice(ix: number, iy: number): number {
  // `Math.imul`, not `*`. A plain multiply here overflows the 53 bits a double
  // holds exactly, so the low nine bits — the only bits a hash cares about —
  // were being rounded away. It still gave a deterministic field, which is why
  // it went unnoticed; what it could not do is be reproduced anywhere else, and
  // the brush cursor now draws this rim on the GPU.
  //
  // Measured, before anyone worries about the worlds already painted with it:
  // the two versions disagree on 98% of cells and by at most 3e-5 of a unit,
  // which is 2e-4 of a cell of rim. Nothing that was saved has moved.
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy), b = lattice(ix + 1, iy);
  const c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/**
 * The outline of a head, in world cells: where the paint stops.
 *
 * The brush cursor was a circle no matter which head was selected, which on a
 * square or a ridge is simply a wrong answer to "what will this stroke cover" —
 * and the reader only finds out after the stroke lands. This solves the rim for
 * each head in the SAME metric `stampDisc` culls with, so the ring and the paint
 * are the same shape by construction.
 *
 * `cx`/`cy` matter for the ragged head only, whose rim is a function of where it
 * is: the noise lives in the world, not in the stamp.
 */
export function tipOutline(
  tip: TipSpec, r: number, cx: number, cy: number, n = 72,
): { x: number; y: number }[] {
  const ca = Math.cos(tip.angle), sa = Math.sin(tip.angle);
  const freq = 1 / Math.max(2.5, r * 0.9);
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2;
    const dx = Math.cos(th), dy = Math.sin(th);
    let rr = r;
    switch (tip.kind) {
      case 'square': {
        const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
        rr = r / Math.max(1e-6, Math.max(Math.abs(u), Math.abs(v)));
        break;
      }
      case 'ridge': {
        const u = (dx * ca + dy * sa) / tip.aspect, v = -dx * sa + dy * ca;
        rr = r / Math.max(1e-6, Math.hypot(u, v));
        break;
      }
      case 'ragged':
        // d = |p| + push(p) = r. Three passes of a fixed point; the push varies
        // slowly compared with the radius, so it converges immediately.
        for (let it = 0; it < 3; it++) {
          // The cell whose CENTRE sits at the rim point — the same cell whose
          // noise `stampDisc` will read there under the centre convention.
          const gx = Math.round(cx + dx * rr - 0.5), gy = Math.round(cy + dy * rr - 0.5);
          rr = r - (vnoise2(gx * freq, gy * freq) - 0.5) * r * tip.jitter * 0.9;
        }
        break;
      default:
        break;
    }
    out.push({ x: cx + dx * rr, y: cy + dy * rr });
  }
  return out;
}

/** f goes 1 at the centre to 0 at the rim; the curve reshapes it. */
export function shapeFalloff(f: number, curve: Falloff): number {
  switch (curve) {
    case 'linear': return f;
    case 'sharp': return f * f * f;
    case 'flat': return f > 0.02 ? 1 : 0;
    default: return f * f * (3 - 2 * f);
  }
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * How much of the brush landed on each cell.
 *
 * Two shapes implement this: a compact rectangle (what a committed edit builds,
 * once) and a world-sized scratch buffer (what a live drag keeps, so extending a
 * stroke costs one segment instead of re-rasterising the whole path — the
 * difference between a stroke that stays at 60 fps and one that degrades as you
 * draw it).
 */
export interface Brush {
  x0: number; y0: number; w: number; h: number;
  /** Coverage at a wrapped world index. */
  cover(i: number): number;
  each(fn: (i: number, cover: number, x: number, y: number) => void): void;
  /** True when nothing is covered. */
  readonly empty: boolean;
}

/** The heights as they were before this stroke started. */
export interface BaseField {
  at(i: number): number;
}

class CompactBrush implements Brush {
  x0: number; y0: number; w: number; h: number;
  private m: Float32Array;
  private W: number;
  private H: number;
  private wrapX: boolean;
  empty: boolean;

  constructor(
    m: Float32Array, x0: number, y0: number, w: number, h: number, W: number, H: number,
    wrapX = true,
  ) {
    this.m = m; this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; this.W = W; this.H = H;
    this.wrapX = wrapX;
    let any = false;
    for (let k = 0; k < m.length; k++) if (m[k] > 0.002) { any = true; break; }
    this.empty = !any;
  }

  cover(i: number): number {
    const W = this.W;
    const x = i % W, y = (i / W) | 0;
    if (!this.wrapX) {
      if (x < this.x0 || x >= this.x0 + this.w || y < this.y0 || y >= this.y0 + this.h) return 0;
      return this.m[(y - this.y0) * this.w + (x - this.x0)];
    }
    for (let ux = x; ux < this.x0 + this.w; ux += W) {
      if (ux >= this.x0 && y >= this.y0 && y < this.y0 + this.h) {
        return this.m[(y - this.y0) * this.w + (ux - this.x0)];
      }
    }
    for (let ux = x - W; ux >= this.x0; ux -= W) {
      if (ux < this.x0 + this.w && y >= this.y0 && y < this.y0 + this.h) {
        return this.m[(y - this.y0) * this.w + (ux - this.x0)];
      }
    }
    return 0;
  }

  each(fn: (i: number, cover: number, x: number, y: number) => void): void {
    const W = this.W, H = this.H;
    for (let gy = 0; gy < this.h; gy++) {
      const wy = this.y0 + gy;
      if (wy < 0 || wy >= H) continue;
      for (let gx = 0; gx < this.w; gx++) {
        const c = this.m[gy * this.w + gx];
        if (c <= 0.002) continue;
        const raw = this.x0 + gx;
        // A world grid wraps east-west; a regional sheet does NOT. Wrapping a
        // sheet-edge stroke would paint phantom cells on the far side of the
        // page — the canonical tiles pass wrapX=false for exactly that reason.
        if (!this.wrapX && (raw < 0 || raw >= W)) continue;
        const wx = (((raw % W) + W) % W);
        fn(wy * W + wx, c, wx, wy);
      }
    }
  }
}

/**
 * Rasterise a stroke into a coverage mask over its own bounding box.
 *
 * The mask is the MAXIMUM of the per-sample falloffs rather than their sum. That
 * distinction is the whole difference between a brush and a stain: summing makes
 * the paint darker wherever the pointer happened to move slowly, and every
 * hand-rolled paint tool has that bug once.
 */
export function strokeMask(stroke: Stroke, W: number, H: number, wrapX = true): Brush | null {
  const r = Math.max(0.5, stroke.radius);
  const soft = Math.min(1, Math.max(0, stroke.softness ?? 0.6));
  const curve = stroke.curve ?? 'smooth';
  if (!stroke.pts.length) return null;

  // Bounding box in unwrapped coordinates around the first point, so a stroke
  // across the seam stays contiguous.
  const ax = stroke.pts[0].x;
  const un = stroke.pts.map((p) => {
    let x = p.x;
    while (x - ax > W / 2) x -= W;
    while (x - ax < -W / 2) x += W;
    return { x, y: p.y };
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of un) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  // The box has to hold whatever the tip reaches to, not just the radius.
  const tip = tipOf(stroke);
  const pad = Math.ceil(r * tipReach(tip)) + 2;
  const x0 = Math.floor(minX) - pad;
  const y0 = Math.max(0, Math.floor(minY) - pad);
  const x1 = Math.ceil(maxX) + pad;
  const y1 = Math.min(H - 1, Math.ceil(maxY) + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w <= 0 || h <= 0 || w > W * 2) return null;
  const mask = new Float32Array(w * h);

  const inner = r * (1 - soft);
  const taper = Math.min(1, Math.max(0, stroke.taper ?? 0));
  const ramp = taperRamp(taper, r);
  const put = (gx: number, gy: number, v: number): void => {
    if (gx < x0 || gx > x1 || gy < y0 || gy > y1) return;
    const mi = (gy - y0) * w + (gx - x0);
    if (v > mask[mi]) mask[mi] = v;
  };

  // Length along the polyline, so the taper is a function of DISTANCE and not
  // of how many points the pointer happened to emit.
  const { seg, total } = arcLengths(un);
  if (un.length === 1) {
    walkSegment(un[0], un[0], r, inner, curve, tip, taper, ramp, 0, 0, put);
  } else {
    let walked = 0;
    for (let k = 0; k < un.length - 1; k++) {
      walkSegment(un[k], un[k + 1], r, inner, curve, tip, taper, ramp, walked, total, put);
      walked += seg[k];
    }
  }
  return new CompactBrush(mask, x0, y0, w, h, W, H, wrapX);
}

/**
 * The coverage an op actually wants.
 *
 * Every brush but one paints along the whole path. `grab` does not: its disc is a
 * handle you grip once, and sweeping it would smear the terrain along the drag
 * instead of carrying it.
 */
export function maskForOp(
  op: TerrainOp, stroke: Stroke, W: number, H: number, wrapX = true,
): Brush | null {
  if (op === 'grab' && stroke.pts.length > 1) {
    return strokeMask({ ...stroke, pts: stroke.pts.slice(0, 1) }, W, H, wrapX);
  }
  return strokeMask(stroke, W, H, wrapX);
}

/**
 * How far a taper reaches in from each end, in world cells.
 *
 * Measured against the BRUSH and not against the stroke. Ramp as a fraction of
 * total length reads well in the abstract and behaves badly in the hand: the
 * fade would keep growing while you drag, so the shape under the pointer would
 * never settle — and, worse, no part of a live stroke could ever be considered
 * finished, which is what makes the preview affordable.
 */
const TAPER_REACH = 3;

function taperRamp(taper: number, r: number): number {
  return taper * TAPER_REACH * r;
}

/**
 * How much of its strength the stroke has at a point along its own length.
 *
 * Zero taper is a stroke that starts and stops at full strength — right for a
 * coastline, wrong for a spur or a watercourse, which should come to a point.
 */
function taperAt(at: number, total: number, taper: number, ramp: number): number {
  if (taper <= 0.001 || ramp <= 1e-6 || total <= 1e-6) return 1;
  const e = Math.min(1, Math.max(0, Math.min(at, total - at) / ramp));
  return 1 - taper + taper * (e * e * (3 - 2 * e));
}

/** Segment lengths and the total, so a taper can be placed by distance. */
function arcLengths(pts: { x: number; y: number }[]): { seg: number[]; total: number } {
  const seg: number[] = [];
  let total = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const l = Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y);
    seg.push(l);
    total += l;
  }
  return { seg, total };
}

/** How far past its radius a head reaches, as a multiple of it. */
export function tipReach(tip: TipSpec): number {
  switch (tip.kind) {
    case 'ridge': return tip.aspect;
    case 'square': return 1.45;
    case 'ragged': return 1 + tip.jitter * 0.5;
    default: return 1;
  }
}

/**
 * One segment of a stroke: the stamps along it, and the stamp at its far end.
 *
 * THE canonical loop. `strokeMask`, the live preview and the tapered re-lay all
 * go through it, and that is not tidiness — it is the only reason the three can
 * be trusted to produce the same paint. They diverged once, over exactly this:
 * a ridge takes its angle from the direction of travel, so a shared point
 * stamped as the end of one segment and again as the start of the next carries
 * two different angles, and any caller that skipped one of the two got a
 * different mask. Walking the polyline the same way everywhere is the fix.
 */
function walkSegment(
  a: { x: number; y: number }, b: { x: number; y: number },
  r: number, inner: number, curve: Falloff, tip: TipSpec,
  taper: number, ramp: number, at: number, total: number,
  put: (gx: number, gy: number, v: number) => void,
): void {
  const segLen = Math.hypot(b.x - a.x, b.y - a.y);
  // Half-cell steps, so a fast drag leaves no gaps.
  const steps = Math.max(1, Math.ceil(segLen * 2));
  // A ridge lies along the way it is going; a stroke with no direction of its
  // own falls back to the angle the reader set.
  const segTip = tip.kind === 'ridge' && segLen > 1e-6
    ? { ...tip, angle: Math.atan2(b.y - a.y, b.x - a.x) }
    : tip;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    stampDisc(
      a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r, inner, curve, put, segTip,
      taperAt(at + segLen * t, total, taper, ramp),
    );
  }
}

/**
 * One stamp of paint. The single place the tip and the falloff are evaluated —
 * which is why the live preview and the committed replay cannot disagree about
 * either: they call this.
 *
 * `scale` is the taper: the strength the stroke has at this point along its own
 * length. It multiplies coverage rather than the op, so a tapered stroke fades
 * at its ends instead of stopping dead.
 */
function stampDisc(
  cx: number, cy: number, r: number, inner: number, curve: Falloff,
  put: (gx: number, gy: number, v: number) => void,
  tip: TipSpec = DEFAULT_TIP,
  scale = 1,
): void {
  const ca = Math.cos(tip.angle), sa = Math.sin(tip.angle);
  // A ridge reaches further along its long axis, and a square reaches to its
  // corner, so the box that is walked has to grow with the shape. For the ridge
  // the box follows the ROTATION too: a square box round a long thin ellipse is
  // three quarters empty, and walking it made a ridge three times the cost of
  // a disc for nothing.
  let rx: number, ry: number;
  if (tip.kind === 'ridge') {
    const A = r * tip.aspect, B = r;
    rx = Math.sqrt(A * A * ca * ca + B * B * sa * sa);
    ry = Math.sqrt(A * A * sa * sa + B * B * ca * ca);
  } else {
    rx = r * tipReach(tip); ry = rx;
  }
  const gx0 = Math.floor(cx - rx), gx1 = Math.ceil(cx + rx);
  const gy0 = Math.floor(cy - ry), gy1 = Math.ceil(cy + ry);
  // About seven lobes around the rim, whatever the brush size. Finer than that
  // and a ragged edge reads as sandpaper rather than as a coastline; coarser
  // and one lobe swallows the whole stamp.
  const freq = 1 / Math.max(2.5, r * 0.9);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      // Cell k is the ground from k to k+1 with its centre at k+0.5 — that is
      // how `polygonCells`, the hover probe and every screen draw read the
      // grid. Measuring against the INDEX shifted every stamp half a cell
      // south-east of the pointer (B6): the world grid hid it behind a
      // half-cell ring offset in the 2D, and the canon grid re-rasterised the
      // same stroke half a WORLD cell away from where the world grid put it,
      // because the offset is half of whichever cell is doing the stamping.
      // Saved worlds keep their ground: `deserializeEdits` shifts pre-v2
      // stroke points by the same half cell, which reproduces the old masks
      // bit for bit under this formula.
      const dx = gx + 0.5 - cx, dy = gy + 0.5 - cy;
      let d: number;
      switch (tip.kind) {
        case 'square': {
          const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
          d = Math.max(Math.abs(u), Math.abs(v));
          break;
        }
        case 'ridge': {
          const u = (dx * ca + dy * sa) / tip.aspect, v = -dx * sa + dy * ca;
          d = Math.hypot(u, v);
          break;
        }
        case 'ragged':
          d = Math.hypot(dx, dy) + (vnoise2(gx * freq, gy * freq) - 0.5) * r * tip.jitter * 0.9;
          break;
        default:
          d = Math.hypot(dx, dy);
      }
      if (d > r) continue;
      const f = d <= inner ? 1 : 1 - (d - inner) / Math.max(1e-6, r - inner);
      const v = shapeFalloff(Math.max(0, f), curve) * scale;
      if (v > 0) put(gx, gy, v);
    }
  }
}

// ---------------------------------------------------------------------------
// The live stroke
// ---------------------------------------------------------------------------

/** One arm of a gesture: the stroke itself, or one of its mirror images. */
interface Arm {
  pts: { x: number; y: number }[];
  stroke: Stroke;
  cov: Float32Array;
  /** Everything this arm has ever painted. */
  x0: number; y0: number; x1: number; y1: number;
  /** Just what the latest pointer move painted. */
  sx0: number; sy0: number; sx1: number; sy1: number;
  map: (p: { x: number; y: number }) => { x: number; y: number };

  // Tapering only. See `taperedExtend`.
  /** Coverage whose value can no longer change, kept so the fading end can be
   *  wiped and laid again without taking the rest of the stroke with it. */
  body: Float32Array | null;
  /** Index of the first segment that is not yet in `body`, and its arc length. */
  baked: number;
  bakedLen: number;
  /** What the last re-lay of the fading end touched. */
  tx0: number; ty0: number; tx1: number; ty1: number;
}

export interface GestureSpec {
  kind: 'terrain' | 'land';
  op: TerrainOp | LandOp;
  radius: number;
  strength: number;
  softness: number;
  curve?: Falloff;
  /** The brush head — see `BrushTip`. Absent is the disc it always was. */
  tip?: BrushTip;
  angle?: number;
  jitter?: number;
  aspect?: number;
  taper?: number;
  /** Mirror about the prime meridian, the equator, or both. */
  mirrorX?: boolean;
  mirrorY?: boolean;
}

export interface DirtyRect { x0: number; y0: number; x1: number; y1: number }

/**
 * One drag, previewed exactly — including its mirror images.
 *
 * Two world-sized scratch buffers (the heights before the gesture, and a flag for
 * which of them are valid) plus one coverage buffer per arm are allocated when the
 * button goes down. In exchange, extending a stroke costs one segment of
 * rasterisation plus one pass over the dirty rectangle — not a re-rasterisation of
 * the whole path, which is quadratic and turns a long stroke into a slideshow.
 *
 * Every extend puts the field back the way it was and re-runs the WHOLE gesture.
 * That looks wasteful and is the point:
 *
 *   - `flatten`, `terrace` and `grab` are not per-cell functions. Their answer
 *     depends on the entire stroke, so applying them incrementally would give a
 *     different result from replaying them.
 *   - Mirrored arms are separate edits applied in order, and where they overlap —
 *     which is exactly what symmetry is for — the second reads what the first
 *     wrote. Restoring and re-running in the same order is the only way the
 *     preview can land on that.
 */
export class SculptGesture {
  private elev: Float32Array;
  private W: number;
  private H: number;
  private seed: string;
  private spec: GestureSpec;
  private arms: Arm[] = [];
  private base: Float32Array;
  private known: Uint8Array;
  /** The field as it was before the gesture, readable anywhere. */
  private pre: BaseField;
  /** Union of every arm's rectangle, unwrapped x. */
  private rx0 = Infinity; private ry0 = Infinity; private rx1 = -Infinity; private ry1 = -Infinity;

  /** The head, resolved once — it cannot change mid-drag. */
  private tip: TipSpec;

  constructor(elev: Float32Array, W: number, H: number, seed: string, spec: GestureSpec) {
    this.elev = elev; this.W = W; this.H = H; this.seed = seed; this.spec = spec;
    this.tip = tipOf(spec as unknown as Stroke);
    const N = W * H;
    this.base = new Float32Array(N);
    this.known = new Uint8Array(N);
    const base = this.base, known = this.known;
    this.pre = { at: (i: number) => (known[i] ? base[i] : elev[i]) };

    // Order is fixed and is the order the committed edits will be replayed in.
    const maps: ((p: { x: number; y: number }) => { x: number; y: number })[] = [(p) => p];
    if (spec.mirrorX) maps.push((p) => ({ x: W - p.x, y: p.y }));
    if (spec.mirrorY) maps.push((p) => ({ x: p.x, y: H - p.y }));
    if (spec.mirrorX && spec.mirrorY) maps.push((p) => ({ x: W - p.x, y: H - p.y }));
    for (const map of maps) {
      const pts: { x: number; y: number }[] = [];
      this.arms.push({
        pts,
        stroke: {
          pts, radius: spec.radius, strength: spec.strength,
          softness: spec.softness, curve: spec.curve,
          tip: spec.tip, angle: spec.angle, jitter: spec.jitter,
          aspect: spec.aspect, taper: spec.taper,
        },
        cov: new Float32Array(N),
        x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity,
        sx0: Infinity, sy0: Infinity, sx1: -Infinity, sy1: -Infinity,
        map,
        body: null, baked: 0, bakedLen: 0,
        tx0: Infinity, ty0: Infinity, tx1: -Infinity, ty1: -Infinity,
      });
    }
  }

  get dirty(): DirtyRect { return { x0: this.rx0, y0: this.ry0, x1: this.rx1, y1: this.ry1 }; }
  get points(): number { return this.arms[0].pts.length; }
  get arity(): number { return this.arms.length; }

  /** Add a pointer position and rebuild the preview. Returns the dirty rect. */
  extend(p: { x: number; y: number }): DirtyRect {
    // 1. paint the new segment into each arm's accumulated coverage, recording
    //    both what the arm has ever painted and what THIS move painted
    const taper = Math.min(1, Math.max(0, this.spec.taper ?? 0));
    for (const arm of this.arms) {
      arm.sx0 = Infinity; arm.sy0 = Infinity; arm.sx1 = -Infinity; arm.sy1 = -Infinity;
    }
    for (const arm of this.arms) {
      arm.pts.push(arm.map(p));
      if (taper > 0.001 && this.spec.op !== 'grab') this.taperedExtend(arm, taper);
      else this.append(arm);
    }

    // 2. re-run, over as little ground as the brush allows
    this.apply();
    return this.dirty;
  }

  /** The usual case: lay only the segment that just arrived. */
  private append(arm: Arm): void {
    const n = arm.pts.length;
    const q = arm.pts[n - 1];
    const r = Math.max(0.5, this.spec.radius);
    const inner = r * (1 - Math.min(1, Math.max(0, this.spec.softness)));
    const curve = this.spec.curve ?? 'smooth';
    if (this.spec.op === 'grab') {
      // Grab is not swept. The disc stays where the drag began — it is the
      // handle you took hold of — and the ground is pulled through it, so the
      // coverage is stamped once and never grows. Cells outside the disc are
      // read but never written, which is why the rectangle does not follow.
      if (n === 1) walkSegment(q, q, r, inner, curve, this.tip, 0, 0, 0, 0, this.put(arm));
      return;
    }
    if (n === 1) {
      walkSegment(q, q, r, inner, curve, this.tip, 0, 0, 0, 0, this.put(arm));
      return;
    }
    if (n === 2 && this.tip.kind === 'ridge') {
      // The first point went down before the stroke had a direction, so it took
      // the angle the reader set. There is a drag now and the ridge lies along
      // it — wipe that first dab instead of leaving it as a lump crossing the
      // start of the stroke, which is what the committed replay will show.
      const cov = arm.cov;
      this.sweep(arm.x0, arm.y0, arm.x1, arm.y1, (i) => { cov[i] = 0; });
      this.grow(arm, arm.x0, arm.y0, arm.x1, arm.y1);
    }
    walkSegment(arm.pts[n - 2], q, r, inner, curve, this.tip, 0, 0, 0, 0, this.put(arm));
  }

  /**
   * The tapered case: the fading end is laid again from scratch every move.
   *
   * A taper is a function of the WHOLE stroke — how far a stamp sits from the
   * nearer end — so one more point changes the answer behind you, and coverage
   * that has already been accumulated cannot simply be added to. Re-laying the
   * entire path each move would fix that and turn a long stroke into a
   * slideshow, quadratically.
   *
   * What saves it is that the fade reaches a bounded distance in from each end
   * (see `TAPER_REACH`). A stamp further in than that has `e` clamped to 1 and
   * its value is settled for good, whatever you do next — so it is baked into
   * `body` once and never touched again, and each move only has to wipe and
   * re-lay the last few brush-widths. The cost per move stops growing with the
   * length of the stroke, which is the whole point.
   */
  private taperedExtend(arm: Arm, taper: number): void {
    const r = Math.max(0.5, this.spec.radius);
    const inner = r * (1 - Math.min(1, Math.max(0, this.spec.softness)));
    const curve = this.spec.curve ?? 'smooth';
    const pts = arm.pts;
    if (!arm.body) arm.body = new Float32Array(this.W * this.H);
    const body = arm.body;

    // 1. put back whatever the fading end painted last time. Underneath it is
    //    what was baked, which is zero anywhere the settled stroke never
    //    reached — so this both restores and erases, which is what a tail that
    //    has moved on needs.
    if (arm.tx1 >= arm.tx0) {
      const cov = arm.cov;
      this.sweep(arm.tx0, arm.ty0, arm.tx1, arm.ty1, (i) => { cov[i] = body[i]; });
      this.grow(arm, arm.tx0, arm.ty0, arm.tx1, arm.ty1);
      arm.tx0 = Infinity; arm.ty0 = Infinity; arm.tx1 = -Infinity; arm.ty1 = -Infinity;
    }

    const { seg, total } = arcLengths(pts);
    const ramp = taperRamp(taper, r);
    const settled = total - ramp;

    // 2. bake every segment that has passed out of the fade, once and for all
    const both = this.put(arm, body);
    while (arm.baked < pts.length - 1 && arm.bakedLen + seg[arm.baked] <= settled) {
      walkSegment(pts[arm.baked], pts[arm.baked + 1], r, inner, curve, this.tip,
        taper, ramp, arm.bakedLen, total, both);
      arm.bakedLen += seg[arm.baked];
      arm.baked++;
    }

    // 3. lay the fading end again, into the coverage only
    const tail = this.put(arm, null, true);
    if (pts.length === 1) {
      walkSegment(pts[0], pts[0], r, inner, curve, this.tip, taper, ramp, 0, 0, tail);
    } else {
      let walked = arm.bakedLen;
      for (let k = arm.baked; k < pts.length - 1; k++) {
        walkSegment(pts[k], pts[k + 1], r, inner, curve, this.tip, taper, ramp, walked, total, tail);
        walked += seg[k];
      }
    }
  }

  /**
   * A sink for stamps: max into the arm's coverage, optionally into its settled
   * copy as well, and grow whichever rectangles are watching.
   */
  private put(arm: Arm, body: Float32Array | null = null, tail = false) {
    const W = this.W, H = this.H;
    return (gx: number, gy: number, v: number): void => {
      if (gy < 0 || gy >= H) return;
      const i = gy * W + (((gx % W) + W) % W);
      if (v > arm.cov[i]) arm.cov[i] = v;
      if (body && v > body[i]) body[i] = v;
      if (tail) {
        if (gx < arm.tx0) arm.tx0 = gx;
        if (gx > arm.tx1) arm.tx1 = gx;
        if (gy < arm.ty0) arm.ty0 = gy;
        if (gy > arm.ty1) arm.ty1 = gy;
      }
      if (gx < arm.x0) arm.x0 = gx;
      if (gx > arm.x1) arm.x1 = gx;
      if (gy < arm.y0) arm.y0 = gy;
      if (gy > arm.y1) arm.y1 = gy;
      if (gx < arm.sx0) arm.sx0 = gx;
      if (gx > arm.sx1) arm.sx1 = gx;
      if (gy < arm.sy0) arm.sy0 = gy;
      if (gy > arm.sy1) arm.sy1 = gy;
      if (gx < this.rx0) this.rx0 = gx;
      if (gx > this.rx1) this.rx1 = gx;
      if (gy < this.ry0) this.ry0 = gy;
      if (gy > this.ry1) this.ry1 = gy;
    };
  }

  /** Widen the rectangles that say what has to be re-run. */
  private grow(arm: Arm, x0: number, y0: number, x1: number, y1: number): void {
    arm.x0 = Math.min(arm.x0, x0); arm.y0 = Math.min(arm.y0, y0);
    arm.x1 = Math.max(arm.x1, x1); arm.y1 = Math.max(arm.y1, y1);
    arm.sx0 = Math.min(arm.sx0, x0); arm.sy0 = Math.min(arm.sy0, y0);
    arm.sx1 = Math.max(arm.sx1, x1); arm.sy1 = Math.max(arm.sy1, y1);
    this.rx0 = Math.min(this.rx0, x0); this.ry0 = Math.min(this.ry0, y0);
    this.rx1 = Math.max(this.rx1, x1); this.ry1 = Math.max(this.ry1, y1);
  }


  /** Walk a rectangle once, doing something to each wrapped index. */
  private sweep(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void {
    if (x1 < x0) return;
    const W = this.W, H = this.H;
    for (let gy = Math.max(0, y0); gy <= Math.min(H - 1, y1); gy++) {
      const row = gy * W;
      for (let gx = x0; gx <= x1; gx++) fn(row + (((gx % W) + W) % W));
    }
  }

  /** Put a rectangle back the way it was before the gesture started. */
  private restore(x0: number, y0: number, x1: number, y1: number): void {
    const base = this.base, known = this.known, e = this.elev;
    this.sweep(x0, y0, x1, y1, (i) => { if (known[i]) e[i] = base[i]; });
  }

  private apply(): void {
    if (this.rx1 < this.rx0) return;
    // The fast path is for ONE arm only.
    //
    // A neighbourhood brush reads cells the last move did not paint, and those
    // cells must read as they were before the gesture — which the gesture's own
    // snapshot gives for free. With mirrors it stops being free: the second arm
    // has to read what the first one wrote, and reconstructing that outside the
    // step rectangle costs more than simply redoing the whole stroke. Symmetry is
    // therefore slower per move, deliberately, because the alternative is a
    // preview that lies about the world you are saving.
    const local = opIsLocal(this.spec.op) && this.arms.length === 1;
    // A local brush only has to redo what the last move painted; a global one has
    // to redo the whole stroke, because one more point changed its answer
    // everywhere.
    const box = (a: Arm) => (local
      ? { x0: a.sx0, y0: a.sy0, x1: a.sx1, y1: a.sy1 }
      : { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 });

    // Every arm's ground goes back to how it started BEFORE any arm runs. Doing it
    // arm by arm would have the second arm's restore wipe the first arm's work
    // wherever a stroke crosses its own mirror.
    const boxes = this.arms.map(box);
    for (const b of boxes) {
      this.restore(b.x0, b.y0, b.x1, b.y1);
      const base = this.base, known = this.known, e = this.elev;
      this.sweep(b.x0, b.y0, b.x1, b.y1, (i) => {
        if (!known[i]) { base[i] = e[i]; known[i] = 1; }
      });
    }

    for (let k = 0; k < this.arms.length; k++) {
      const arm = this.arms[k];
      const b = boxes[k];
      if (b.x1 < b.x0) continue;
      const brush = new LiveBrush(arm.cov, b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, this.W, this.H);
      // The field as it is RIGHT NOW, before this arm runs — which is what the
      // replay hands each edit in turn. Taken per arm and per move because the arm
      // before it may have written into the same ground.
      if (this.spec.kind === 'land') {
        const bf = local ? this.pre
          : snapshotBase(this.elev, this.W, this.H, b.x0 - 1, b.y0 - 1, brush.w + 2, brush.h + 2);
        applyLandOp(this.spec.op as LandOp, this.elev, bf, this.W, this.H, brush, arm.stroke, this.seed);
      } else {
        const op = this.spec.op as TerrainOp;
        const r = opBaseRect(op, arm.stroke, brush, this.W);
        const bf = local ? this.pre
          : snapshotBase(this.elev, this.W, this.H, r.x0, r.y0, r.w, r.h);
        applyTerrainOp(op, this.elev, bf, this.W, this.H, brush, arm.stroke, this.seed);
      }
    }
  }

  /** Put every touched cell back the way it was. */
  rollback(): void { this.restore(this.rx0, this.ry0, this.rx1, this.ry1); }

  /**
   * The gesture as edits, in the order they must be replayed.
   *
   * Mirrors are separate edits rather than one stroke with a zigzag path, because
   * a single polyline that jumps across the world would sweep a band of paint
   * between the two halves — the brush walks its own path, and the path between
   * mirror images is not somewhere the reader drew.
   */
  edits(): { kind: 'terrain' | 'land'; op: TerrainOp | LandOp; stroke: Stroke }[] {
    return this.arms
      .filter((a) => a.pts.length > 0)
      .map((a) => ({
        kind: this.spec.kind,
        op: this.spec.op,
        stroke: {
          pts: a.pts.slice(),
          radius: this.spec.radius,
          strength: this.spec.strength,
          softness: this.spec.softness,
          curve: this.spec.curve,
          // The head goes into the stored edit, or the replay would draw a disc
          // where the reader watched a ridge go down.
          tip: this.spec.tip,
          angle: this.spec.angle,
          jitter: this.spec.jitter,
          aspect: this.spec.aspect,
          taper: this.spec.taper,
        },
      }));
  }
}

/** Coverage held in a world-sized buffer, addressed by a rectangle. */
class LiveBrush implements Brush {
  x0: number; y0: number; w: number; h: number;
  private c: Float32Array;
  private W: number;
  private H: number;
  empty = false;

  constructor(c: Float32Array, x0: number, y0: number, w: number, h: number, W: number, H: number) {
    this.c = c; this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; this.W = W; this.H = H;
  }

  cover(i: number): number { return this.c[i]; }

  each(fn: (i: number, cover: number, x: number, y: number) => void): void {
    const W = this.W, H = this.H;
    for (let gy = Math.max(0, this.y0); gy <= Math.min(H - 1, this.y0 + this.h - 1); gy++) {
      for (let gx = this.x0; gx < this.x0 + this.w; gx++) {
        const wx = ((gx % W) + W) % W;
        const i = gy * W + wx;
        const c = this.c[i];
        if (c <= 0.002) continue;
        fn(i, c, wx, gy);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The ops
// ---------------------------------------------------------------------------

const idx = (W: number, H: number, x: number, y: number): number =>
  Math.min(H - 1, Math.max(0, y)) * W + (((x % W) + W) % W);

/** Mean of the 3×3 neighbourhood of the PRE-STROKE field. */
function mean3(base: BaseField, W: number, H: number, x: number, y: number): number {
  let sum = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= H) continue;
    for (let dx = -1; dx <= 1; dx++) { sum += base.at(idx(W, H, x + dx, yy)); n++; }
  }
  return n ? sum / n : base.at(idx(W, H, x, y));
}

function bilinearBase(base: BaseField, W: number, H: number, x: number, y: number): number {
  const fx = Math.floor(x), fy = Math.floor(y);
  const tx = x - fx, ty = y - fy;
  const h00 = base.at(idx(W, H, fx, fy));
  const h10 = base.at(idx(W, H, fx + 1, fy));
  const h01 = base.at(idx(W, H, fx, fy + 1));
  const h11 = base.at(idx(W, H, fx + 1, fy + 1));
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
}

/**
 * Run one terrain op.
 *
 * `elev` is written; `base` is the field as it was before the stroke and is the
 * only thing read. That separation is what lets the live preview restore and
 * re-run on every pointer move and still land on exactly the committed result.
 */
export function applyTerrainOp(
  op: TerrainOp,
  elev: Float32Array,
  base: BaseField,
  W: number,
  H: number,
  brush: Brush,
  stroke: Stroke,
  seed: string,
): void {
  const strength = stroke.strength;
  const amp = 0.9 * strength;

  switch (op) {
    case 'raise':
      brush.each((i, c) => { elev[i] = base.at(i) + amp * c; });
      return;

    case 'lower':
      brush.each((i, c) => { elev[i] = base.at(i) - amp * c; });
      return;

    case 'smooth':
      // Jacobi, not Gauss–Seidel: every cell reads the pre-stroke neighbourhood,
      // so the result does not depend on the order the rectangle is scanned in.
      // The old version read cells it had already written, which made a stroke
      // smear very slightly downward and to the right — invisible, deterministic,
      // and wrong.
      brush.each((i, c, x, y) => {
        const b = base.at(i);
        elev[i] = b + (mean3(base, W, H, x, y) - b) * c * strength;
      });
      return;

    case 'sharpen':
      // The opposite of smooth: push each cell away from its neighbourhood. Ridges
      // gain an edge and valleys deepen — the "pinch" of a sculpting program, which
      // is how you turn a plausible lump into a mountain that looks carved.
      // Clamped to the local range so it cannot run away into spikes.
      brush.each((i, c, x, y) => {
        const b = base.at(i);
        const m = mean3(base, W, H, x, y);
        const lim = Math.abs(b - m) * 2.5 + 0.004;
        elev[i] = b + Math.max(-lim, Math.min(lim, (b - m) * c * strength * 2.2));
      });
      return;

    case 'flatten': {
      // Level to the mean under the brush: a plateau, a terrace, a plaza.
      let mean = 0, n = 0;
      brush.each((i, c) => { mean += base.at(i) * c; n += c; });
      if (n <= 0) return;
      mean /= n;
      brush.each((i, c) => { const b = base.at(i); elev[i] = b + (mean - b) * c * strength; });
      return;
    }

    case 'terrace': {
      // Quantise to steps. Mesas, badlands, the stacked benches of a dry canyon.
      // The step is derived from the relief actually under the brush, so the same
      // control gives sensible results on a coastal plain and on a cordillera.
      let lo = Infinity, hi = -Infinity;
      brush.each((i) => { const b = base.at(i); if (b < lo) lo = b; if (b > hi) hi = b; });
      if (!(hi > lo)) return;
      const steps = 3 + Math.round(strength * 7);
      const q = (hi - lo) / steps;
      brush.each((i, c) => {
        const b = base.at(i);
        const t = lo + Math.round((b - lo) / q) * q;
        elev[i] = b + (t - b) * c * Math.min(1, strength * 1.2);
      });
      return;
    }

    case 'roughen': {
      // Deterministic per-cell jitter: the same stroke always roughens the same
      // way, which matters because the edit list is replayed.
      brush.each((i, c) => {
        const hsh = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
        const n = (hsh - Math.floor(hsh)) * 2 - 1;
        elev[i] = base.at(i) + n * amp * 0.35 * c;
      });
      return;
    }

    case 'gully': {
      // Dissect a slope into ridges and gullies.
      //
      // Deliberately NOT a hydraulic simulation. A world cell here is about twenty
      // kilometres across, and at twenty kilometres a river valley is a single
      // cell — there is no erosion to simulate that anyone could see. What the eye
      // reads as "eroded" at this scale is the TEXTURE of a dissected massif, and
      // that is a ridged multifractal keyed to the slope: flat ground stays flat,
      // steep flanks get cut. Real stream-power erosion lives in the regional
      // sheet, where the cells are two hundred metres and it is visible.
      const noise = new SphereNoise(seed, 'sculpt-gully');
      brush.each((i, c, x, y) => {
        const b = base.at(i);
        const gx = base.at(idx(W, H, x + 1, y)) - base.at(idx(W, H, x - 1, y));
        const gy = base.at(idx(W, H, x, y + 1)) - base.at(idx(W, H, x, y - 1));
        const slope = Math.hypot(gx, gy) * 0.5;
        const u = (x + 0.5) / W, v = (y + 0.5) / H;
        const r = 1 - Math.abs(noise.fbm(u, v, 260, 4));
        const cut = Math.pow(r, 2.2) * Math.min(1, slope * 12) * strength * 0.22;
        elev[i] = b - cut * c;
      });
      return;
    }

    case 'grab': {
      // Move the ground itself.
      //
      // The one brush that is a transform rather than a per-cell rule, and the one
      // that makes the tool feel like sculpting rather than airbrushing: you take
      // hold of a range and drag it somewhere else. Each cell reads the pre-stroke
      // field from a point pulled back along the drag by its own coverage, so the
      // centre travels the full distance and the rim does not move at all.
      if (stroke.pts.length < 2) return;
      const { dx, dy } = grabVector(stroke, W);
      brush.each((i, c, x, y) => {
        elev[i] = bilinearBase(base, W, H, x - dx * c, y - dy * c);
      });
      return;
    }

    default:
      return;
  }
}

/** Paint coastline: max/min against a roughened dome. */
export function applyLandOp(
  op: LandOp,
  elev: Float32Array,
  base: BaseField,
  W: number,
  H: number,
  brush: Brush,
  stroke: Stroke,
  seed: string,
): void {
  const coast = new SphereNoise(seed, 'paint-coast');
  // New land comes out LOW. This brush draws a coastline; the relief brush makes
  // mountains. At the old amplitude a single coast stroke produced a range of
  // peaks, which took the choice away from the reader.
  const amp = op === 'land'
    ? 0.05 + 0.22 * stroke.strength
    : 0.1 + 0.5 * stroke.strength;
  brush.each((i, c, x, y) => {
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    // Roughen the dome so the new 0-contour is ragged. A clean dome gives a
    // painted island the silhouette of a coin, which no amount of good ink
    // downstream can disguise.
    const n = 0.72 + 0.62 * coast.fbm(u, v, 34, 4);
    const h = amp * c * n;
    const b = base.at(i);
    elev[i] = op === 'land' ? Math.max(b, h) : Math.min(b, -h);
  });
}

/**
 * A base field for a one-shot application: nothing is snapshotted, so `at` reads
 * the live array. Correct only when every cell is written exactly once and no op
 * reads a cell it has written — true for every op except the two that snapshot
 * for themselves below.
 */
export function liveBase(elev: Float32Array): BaseField {
  return { at: (i: number) => elev[i] };
}

/**
 * A base field over a rectangle, copied out before the op runs.
 *
 * Needed by the ops that read cells other than the one they are writing —
 * `smooth`, `sharpen`, `terrace`, `gully`, `grab`. The pad must cover their reach:
 * one cell for a neighbourhood, the whole drag distance for `grab`.
 */
export function snapshotBase(
  elev: Float32Array, W: number, H: number,
  x0: number, y0: number, w: number, h: number,
): BaseField {
  const data = new Float32Array(w * h);
  for (let gy = 0; gy < h; gy++) {
    const wy = Math.min(H - 1, Math.max(0, y0 + gy));
    for (let gx = 0; gx < w; gx++) {
      data[gy * w + gx] = elev[wy * W + ((((x0 + gx) % W) + W) % W)];
    }
  }
  // No loops in the lookup. This function is called several times per cell per
  // brush op — a stroke with a wide brush runs it a few million times a second —
  // and the `while` version that walked the seam one world-width at a time was
  // the single most expensive line in the sculpt path.
  return {
    at: (i: number) => {
      const gy = ((i / W) | 0) - y0;
      if (gy < 0 || gy >= h) return elev[i];
      const gx = ((((i % W) - x0) % W) + W) % W;
      return gx < w ? data[gy * w + gx] : elev[i];
    },
  };
}

/**
 * Does this brush answer per cell, or does it need the whole stroke?
 *
 * `raise` writes `f(height here, coverage here)` and nothing else, so extending a
 * stroke only changes the cells the new segment touched. `flatten` levels to the
 * mean UNDER THE WHOLE BRUSH, `terrace` derives its step from the whole brush's
 * range, and `grab` reads a displacement measured from the first point to the
 * last — for those three, one more pointer move changes every cell the stroke has
 * ever touched.
 *
 * Getting this distinction wrong in either direction is expensive: treat a local
 * brush as global and a long stroke crawls (seventy milliseconds a move with a
 * wide brush, which is a stroke you can watch fall behind your hand); treat a
 * global one as local and the preview stops matching what gets saved.
 */
export function opIsLocal(op: TerrainOp | LandOp): boolean {
  return op !== 'flatten' && op !== 'terrace' && op !== 'grab';
}

/** The drag of a grab stroke, unwrapped across the seam. */
export function grabVector(stroke: Stroke, W: number): { dx: number; dy: number } {
  const pts = stroke.pts;
  if (pts.length < 2) return { dx: 0, dy: 0 };
  const a = pts[0], b = pts[pts.length - 1];
  let dx = b.x - a.x;
  while (dx > W / 2) dx -= W;
  while (dx < -W / 2) dx += W;
  return { dx, dy: b.y - a.y };
}

/**
 * The rectangle an op needs a pre-stroke copy of.
 *
 * A neighbourhood is one cell. `grab` is the awkward one: it reads from the disc
 * pulled back along the drag, so what it needs is the disc UNION the shifted disc
 * — not the disc grown by the drag distance in every direction, which is what the
 * first version did and which made a long grab snapshot a region the size of a
 * continent for the sake of a circle.
 */
export function opBaseRect(
  op: TerrainOp, stroke: Stroke, brush: Brush, W: number,
): { x0: number; y0: number; w: number; h: number } {
  if (op !== 'grab') {
    return { x0: brush.x0 - 1, y0: brush.y0 - 1, w: brush.w + 2, h: brush.h + 2 };
  }
  const { dx, dy } = grabVector(stroke, W);
  const x0 = Math.floor(Math.min(brush.x0, brush.x0 - dx)) - 2;
  const x1 = Math.ceil(Math.max(brush.x0 + brush.w, brush.x0 + brush.w - dx)) + 2;
  const y0 = Math.floor(Math.min(brush.y0, brush.y0 - dy)) - 2;
  const y1 = Math.ceil(Math.max(brush.y0 + brush.h, brush.y0 + brush.h - dy)) + 2;
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}
