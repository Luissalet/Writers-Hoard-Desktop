// ============================================
// Sculpt view — the live brush
// ============================================
// The brush has to do two jobs that pull in opposite directions:
//
//   DURING the drag it must change the picture at 60 fps, which means touching
//   only the cells under the pointer and uploading only that rectangle.
//   AFTER the drag it must produce exactly the same world as replaying the
//   stored edit list would, or the world stops being reproducible from its seed.
//
// The resolution is that the live pass and `applyEdits` share their falloff
// exactly, and the live pass is thrown away on release: the stroke is committed
// as one `WorldEdit`, the session replays from the pristine snapshot, and any
// drift between the two disappears. Live painting is a PREVIEW that happens to
// be pixel-accurate, not a second implementation of the truth.

import type { Pt, TerrainOp, LandOp } from '../core/edits';

export interface LiveStrokeOptions {
  radius: number;
  strength: number;
  softness: number;
}

/** The rectangle a live stroke has dirtied so far, in cell coordinates. */
export interface DirtyRect { x0: number; y0: number; x1: number; y1: number }

export function emptyRect(): DirtyRect {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function rectIsEmpty(r: DirtyRect): boolean {
  return r.x1 < r.x0 || r.y1 < r.y0;
}

function grow(r: DirtyRect, x0: number, y0: number, x1: number, y1: number): void {
  r.x0 = Math.min(r.x0, x0); r.y0 = Math.min(r.y0, y0);
  r.x1 = Math.max(r.x1, x1); r.y1 = Math.max(r.y1, y1);
}

/**
 * Live sculpting state for one drag.
 *
 * Keeps a copy of the untouched heights under the stroke so that (a) the brush
 * is idempotent along its own path — dragging back over a spot does not double
 * the effect, which is the difference between a brush and a stain — and (b) the
 * preview can be rolled back exactly when the stroke is committed or cancelled.
 */
export class LiveStroke {
  readonly pts: Pt[] = [];
  /** Per-cell maximum coverage reached anywhere along the stroke. */
  private cover = new Map<number, number>();
  /** Original height of every cell the stroke has touched. */
  private before = new Map<number, number>();
  readonly dirty: DirtyRect = emptyRect();

  private readonly W: number;
  private readonly H: number;
  private readonly elevation: Float32Array;
  readonly opts: LiveStrokeOptions;

  // Explicit fields rather than constructor parameter properties: the project
  // builds with `erasableSyntaxOnly`, which forbids the shorthand.
  constructor(W: number, H: number, elevation: Float32Array, opts: LiveStrokeOptions) {
    this.W = W;
    this.H = H;
    this.elevation = elevation;
    this.opts = opts;
  }

  /**
   * Extend the stroke to a new pointer position and rewrite the affected cells.
   * Returns the rectangle changed by THIS call, for a tight texture upload.
   */
  extend(p: Pt, apply: (i: number, cover: number, before: number) => number): DirtyRect {
    const step = emptyRect();
    const prev = this.pts.length ? this.pts[this.pts.length - 1] : p;
    this.pts.push(p);

    const r = Math.max(0.5, this.opts.radius);
    const inner = r * (1 - Math.min(1, Math.max(0, this.opts.softness)));
    const segLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const steps = Math.max(1, Math.ceil(segLen * 2));

    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const cx = prev.x + (p.x - prev.x) * t;
      const cy = prev.y + (p.y - prev.y) * t;
      const gy0 = Math.max(0, Math.floor(cy - r));
      const gy1 = Math.min(this.H - 1, Math.ceil(cy + r));
      const gx0 = Math.floor(cx - r);
      const gx1 = Math.ceil(cx + r);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const d = Math.hypot(gx - cx, gy - cy);
          if (d > r) continue;
          const f = d <= inner ? 1 : 1 - (d - inner) / Math.max(1e-6, r - inner);
          const sm = f * f * (3 - 2 * f);
          const wx = ((gx % this.W) + this.W) % this.W;
          const i = gy * this.W + wx;
          // MAX, never sum: the same rule the committed edit uses.
          const had = this.cover.get(i) ?? 0;
          if (sm <= had) continue;
          this.cover.set(i, sm);
          if (!this.before.has(i)) this.before.set(i, this.elevation[i]);
          this.elevation[i] = apply(i, sm, this.before.get(i)!);
          grow(step, gx, gy, gx, gy);
          grow(this.dirty, gx, gy, gx, gy);
        }
      }
    }
    return step;
  }

  /** Put every touched cell back the way it was. */
  rollback(): void {
    for (const [i, v] of this.before) this.elevation[i] = v;
  }

  get touched(): number {
    return this.before.size;
  }
}

/**
 * The per-cell height rule for each terrain operation.
 *
 * `base` is the height BEFORE the stroke started, not before this sample, which
 * is what makes a stroke that crosses itself behave like one pass of paint.
 */
export function terrainRule(
  op: TerrainOp,
  strength: number,
  neighbourMean: (i: number) => number,
  roughAt: (i: number) => number,
): (i: number, cover: number, base: number) => number {
  const amp = 0.9 * strength;
  switch (op) {
    case 'raise': return (_i, c, base) => base + amp * c;
    case 'lower': return (_i, c, base) => base - amp * c;
    case 'smooth': return (i, c, base) => base + (neighbourMean(i) - base) * c * strength;
    case 'flatten': return (i, c, base) => base + (neighbourMean(i) - base) * c * strength;
    case 'roughen': return (i, c, base) => base + roughAt(i) * amp * c * 0.5;
    default: return (_i, _c, base) => base;
  }
}

/** The per-cell rule for the coastline brush: max/min against a noisy dome. */
export function landRule(
  op: LandOp,
  strength: number,
  noiseAt: (i: number) => number,
): (i: number, cover: number, base: number) => number {
  const amp = op === 'land' ? 0.05 + 0.22 * strength : 0.1 + 0.5 * strength;
  return op === 'land'
    ? (i, c, base) => Math.max(base, amp * c * noiseAt(i))
    : (i, c, base) => Math.min(base, -amp * c * noiseAt(i));
}
