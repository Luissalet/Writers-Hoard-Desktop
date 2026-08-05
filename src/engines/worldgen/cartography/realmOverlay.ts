// ============================================
// World Generator — realm borders as screen polylines, and the political wash
// ============================================
// The Carta has drawn political boundaries since it existed; the 2D map, which
// is the view where realms can actually be renamed and where their capitals are
// placed, has never drawn them at all.
//
// The Carta's `drawBorders` re-derives the boundary from `realmOf` on every
// render, scanning every cell of the visible rect. That is affordable for a
// sheet that settles; it is not affordable for a canvas that redraws on every
// frame of a pan, where the visible rect at planetary zoom IS the whole grid —
// two million realm lookups per frame.
//
// So the boundary is extracted ONCE per political map into a segment list. A
// border is a perimeter, not an area: a world of a hundred and sixty towns comes
// out at a few thousand segments, which is nothing to project per frame. The
// extraction is keyed on `realmOf`, so a frontier that moved gets a fresh line
// and nothing else pays.
//
// TWO LAYERS live here, and they are one fact drawn twice: the LINE
// (`realmBorders` → `drawRealmBorders`) and the WASH (`realmTint`). The wash was
// argued against for a long time, and the argument was good — the Carta tints
// because it is a drawn map on paper, while the 2D is photographic ground and a
// colour field over photography reads as haze or as weather rather than as a
// country. What answered it is not the wash but its dose: 16 % of a flat,
// unshaded fill, in the realm's OWN hue — the same hue the border carries, so
// the two read as one statement about the map and not as two layers that happen
// to agree. At that strength nothing about it can be mistaken for terrain, and
// it does the one thing lines alone cannot: it says which side of the frontier
// you are standing on when only one side of it is on screen, which past the
// regional zoom is most of the time. Both cache on `realmOf`, for the same
// reason, and go stale together.

import type { HumanGeography } from '../core/settlements';

/** Cell-corner coordinates: cell (x, y) spans [x, x+1) × [y, y+1). */
export interface BorderSegments {
  /** Flat runs of x0, y0, x1, y1 — one segment per four entries. */
  xy: Float32Array;
  /** Hue 0–360 of the more senior realm at each segment. */
  hue: Uint16Array;
  count: number;
}

/**
 * Keyed on `realmOf`, NOT on the geography wrapper.
 *
 * `patchGeography` builds a new `HumanGeography` object after every stroke and
 * hands back the SAME `realmOf` array unless the political map actually moved —
 * realms are not re-grown by a patch, and the painted overlay is only re-laid
 * when its contents changed. On the wrapper, every brush stroke paid a two-pass
 * scan of the whole grid (16 ms at 1024x512, ~60 ms at 2048x1024) from inside
 * a requestAnimationFrame callback, which is precisely when the reader has just
 * let go of the brush and is looking for it to feel quick.
 */
const CACHE = new WeakMap<Int32Array, BorderSegments>();

/**
 * Every edge where two realms meet, or where a realm meets unclaimed ground.
 *
 * Only the right and bottom edge of each cell are tested, which is the standard
 * way to visit every interior edge exactly once. The east–west wrap is included
 * (a realm that straddles the antimeridian has a real boundary there, not a
 * seam), and the south edge of the last row is not, because there is nothing
 * below it.
 */
export function realmBorders(world: { width: number; height: number }, geo: HumanGeography): BorderSegments {
  const cached = CACHE.get(geo.realmOf);
  if (cached) return cached;
  const W = world.width, H = world.height;
  const of = geo.realmOf;
  // Two passes: count, then fill. Growing a JS array of a few thousand entries
  // is fine, but the typed arrays are what make the per-frame projection cheap.
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = of[i];
      if (a !== of[y * W + ((x + 1) % W)]) n++;
      if (y < H - 1 && a !== of[i + W]) n++;
    }
  }
  const xy = new Float32Array(n * 4);
  const hue = new Uint16Array(n);
  let k = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = of[i];
      const r = of[y * W + ((x + 1) % W)];
      const d = y < H - 1 ? of[i + W] : a;
      if (a !== r) {
        xy[k * 4] = x + 1; xy[k * 4 + 1] = y;
        xy[k * 4 + 2] = x + 1; xy[k * 4 + 3] = y + 1;
        hue[k] = geo.realms[Math.max(a, r)]?.hue ?? 0;
        k++;
      }
      if (y < H - 1 && a !== d) {
        xy[k * 4] = x; xy[k * 4 + 1] = y + 1;
        xy[k * 4 + 2] = x + 1; xy[k * 4 + 3] = y + 1;
        hue[k] = geo.realms[Math.max(a, d)]?.hue ?? 0;
        k++;
      }
    }
  }
  const out = mergeRuns({ xy, hue, count: k });
  CACHE.set(geo.realmOf, out);
  return out;
}

/**
 * Fuse collinear neighbours into single runs.
 *
 * A boundary extracted cell by cell is a staircase of unit edges, and a realm
 * the size of a country contributes thousands of them — on the harness world,
 * 9 939. Long stretches of that are straight: a frontier that follows a coast
 * or a watershed goes several cells in one direction before it turns. Merging
 * those runs draws the IDENTICAL line (same endpoints, same pixels) with a
 * fraction of the `moveTo`/`lineTo` pairs, which is what a dashed stroke with
 * round caps actually costs — the dash phase restarts per subpath, so fewer,
 * longer subpaths are cheaper twice over.
 */
function mergeRuns(src: BorderSegments): BorderSegments {
  const n = src.count;
  if (n === 0) return src;
  // Vertical edges have x0 === x1, horizontal ones y0 === y1. Sort each family
  // so that consecutive collinear edges land next to each other.
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (let k = 0; k < n; k++) {
    (src.xy[k * 4] === src.xy[k * 4 + 2] ? vertical : horizontal).push(k);
  }
  vertical.sort((a, b) => (src.xy[a * 4] - src.xy[b * 4]) || (src.xy[a * 4 + 1] - src.xy[b * 4 + 1]));
  horizontal.sort((a, b) => (src.xy[a * 4 + 1] - src.xy[b * 4 + 1]) || (src.xy[a * 4] - src.xy[b * 4]));

  const xy = new Float32Array(n * 4);
  const hue = new Uint16Array(n);
  let out = 0;
  const flush = (list: number[], along: 0 | 1) => {
    let i = 0;
    while (i < list.length) {
      const head = list[i];
      let tail = head;
      let j = i + 1;
      // Same line, same colour, and the next edge starts where this one ends.
      while (j < list.length) {
        const c = list[j];
        const sameLine = src.xy[c * 4 + (1 - along)] === src.xy[head * 4 + (1 - along)];
        const joins = src.xy[c * 4 + along] === src.xy[tail * 4 + 2 + along];
        if (!sameLine || !joins || src.hue[c] !== src.hue[head]) break;
        tail = c;
        j++;
      }
      xy[out * 4] = src.xy[head * 4];
      xy[out * 4 + 1] = src.xy[head * 4 + 1];
      xy[out * 4 + 2] = src.xy[tail * 4 + 2];
      xy[out * 4 + 3] = src.xy[tail * 4 + 3];
      hue[out] = src.hue[head];
      out++;
      i = j;
    }
  };
  flush(vertical, 1);
  flush(horizontal, 0);
  return { xy, hue, count: out };
}

export interface RealmOverlayOptions {
  worldWidth: number;
  worldHeight: number;
  /** Map coords (u east 0..1, v south 0..1) → screen pixels, for ONE copy. */
  toScreen: (u: number, v: number) => [number, number];
  /**
   * The canvas, in pixels. Kept — not decoration — because it is the SECOND
   * cull: `view` rejects in cell space before projecting, which is what keeps a
   * curved projection from paying a solve per off-screen edge, but a cell-space
   * window has to be conservative precisely where the projection curves. This
   * pair rejects what is left, in the coordinates the ink actually lands in.
   */
  width: number;
  height: number;
  /** Screen pixels per world cell — sets the weight and the visible-cell cull. */
  pxPerCell: number;
  /** World-cell rect on screen, for rejecting segments without projecting them. */
  view: { x: number; y: number; w: number; h: number };
  alpha?: number;
  /**
   * Equirect fast path: screen = origin + cell x scale, for both axes.
   *
   * With the whole world on screen the boundary is ~10 000 segments of genuine
   * geometry — no cull can reject any of it, and it measured 15 ms a frame. Most
   * of that was not the drawing: it was 20 000 calls through the `toScreen`
   * closure, each allocating a two-element tuple. Doing the arithmetic inline
   * where the projection is affine takes the same picture down to a couple of
   * milliseconds. Absent, `toScreen` is used and nothing changes.
   */
  linear?: { ox: number; oy: number; scale: number };
}

type Ctx = CanvasRenderingContext2D;

/**
 * Draw the boundary. The line carries the realm's hue, so two neighbours are
 * told apart and the line and `realmTint`'s wash read as the same fact.
 *
 * Culled TWICE, and deliberately: in CELL space first, before anything is
 * projected, which is what keeps a curved projection from paying a Robinson
 * solve per off-screen edge; then in SCREEN space, on what survived. Returns
 * how many segments reached the path.
 */
export function drawRealmBorders(
  ctx: Ctx,
  segs: BorderSegments,
  opts: RealmOverlayOptions,
): number {
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.01 || segs.count === 0) return 0;
  const { worldWidth: W, worldHeight: H, toScreen, view } = opts;
  // One cell of slack, plus the wrap: a segment at x=W is the same edge as x=0.
  const x0 = view.x - 1, x1 = view.x + view.w + 1;
  const y0 = view.y - 1, y1 = view.y + view.h + 1;
  /**
   * `view` is THIS COPY's window, in this copy's own cell coordinates.
   *
   * The first version took one window for the whole map and skipped the cull
   * whenever it spanned the world — which, because `fit()` sizes the map to 98 %
   * of the canvas, is the view the map OPENS in. Every segment was then
   * projected once per east–west copy: measured on the harness world (9 939
   * segments, 1400×800, three copies) at **15,4 ms per frame**, on every frame
   * of every pan.
   *
   * A copy at screen offset `ox` shows cells `x ∈ [-ox/scale, (cw-ox)/scale]`,
   * so each copy has its own window and the cull is a plain range test with no
   * modulo and no special case. Total work across the copies is then the
   * segments that are actually on screen, once.
   */

  /**
   * The same test again, downstream of the projection, in pixels.
   *
   * OVERLAP of the segment's screen box with the canvas, never "both ends are
   * outside": a run twenty cells long that CROSSES the view has both ends off
   * screen and is the one segment the reader has zoomed in to see — the same
   * trap the cell-space cull fell into below. Four "both on the same side"
   * tests are exactly that overlap test, and since the stroke between two
   * projected endpoints is a straight line, the box is exact about the ink.
   *
   * FOR WHOEVER WIDENS `view`: this is why you may. The cell window has to be
   * conservative wherever the projection curves — a Robinson row is not a
   * screen row, so the honest cell-space window for a given canvas is bigger
   * than the naive inverse and grows toward the poles. Widen it as much as
   * correctness needs; whatever extra it lets through is rejected here, in the
   * coordinates that actually decide whether anything is drawn, for four
   * comparisons on a projection each of those segments had to pay anyway.
   */
  const cw = opts.width, ch = opts.height;
  // The widest line this draws is 2,6 px with a round cap, so 4 px of slack
  // keeps a cap that belongs on screen from being clipped by its own centre.
  const m = 4;
  const offScreen = (ax: number, ay: number, bx: number, by: number): boolean =>
    (ax < -m && bx < -m) || (ax > cw + m && bx > cw + m)
    || (ay < -m && by < -m) || (ay > ch + m && by > ch + m);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, Math.min(2.6, 0.9 + opts.pxPerCell * 0.06));
  ctx.setLineDash([Math.max(3, opts.pxPerCell * 1.2), Math.max(2.5, opts.pxPerCell * 0.9)]);

  // Batched by hue: a `beginPath`/`stroke` per segment is a state change per
  // edge, and there are thousands. Ten or so realms means ten strokes.
  const byHue = new Map<number, number[]>();
  let drawn = 0;
  for (let k = 0; k < segs.count; k++) {
    const ax = segs.xy[k * 4], ay = segs.xy[k * 4 + 1];
    const bx = segs.xy[k * 4 + 2], by = segs.xy[k * 4 + 3];
    /**
     * OVERLAP, not containment - and this is the bug `mergeRuns` introduced.
     *
     * Before the runs were fused, every entry here was one cell long, so
     * testing the first corner against the window was the same question as
     * testing the segment. Fused, a frontier that follows a watershed is one
     * entry twenty cells long, and `ax < x0` then throws away precisely the run
     * that CROSSES the view - the one whose ends are off both sides because the
     * reader has zoomed in on it.
     *
     * Invisible at planetary zoom, where every run fits inside the window;
     * total at 40 km, where none of them do. Measured on the harness world
     * (harness/realm-brush.ts, section 5): the 21-cell run, alone, in a 7-cell
     * window, drew 0 pixels. At the local tier the fix takes the visible ink
     * from 0,062 % of the canvas to 0,344 %.
     *
     * `mergeRuns` emits west-to-east and north-to-south, so ax <= bx and
     * ay <= by, and the plain interval test is enough.
     */
    if (ay > y1 || by < y0) continue;
    if (bx < x0 || ax > x1) continue;
    let list = byHue.get(segs.hue[k]);
    if (!list) { list = []; byHue.set(segs.hue[k], list); }
    list.push(k);
  }

  // Counted where the ink is, not where the cull is: the return value is what
  // the harness reads to answer "is the frontier visible from here", and a
  // segment that passed the cell window and then landed off the canvas is not.
  for (const [h, list] of byHue) {
    ctx.strokeStyle = `hsl(${h} 62% 62%)`;
    ctx.beginPath();
    const lin = opts.linear;
    if (lin) {
      // The affine case: here the cell window IS the screen window, so all this
      // catches is the one cell of slack the first cull grants itself — kept
      // anyway, because it costs four comparisons on numbers already in hand and
      // it means NO caller has to get its `view` exactly right to stay cheap.
      for (const k of list) {
        const sx0 = lin.ox + segs.xy[k * 4] * lin.scale, sy0 = lin.oy + segs.xy[k * 4 + 1] * lin.scale;
        const sx1 = lin.ox + segs.xy[k * 4 + 2] * lin.scale, sy1 = lin.oy + segs.xy[k * 4 + 3] * lin.scale;
        if (offScreen(sx0, sy0, sx1, sy1)) continue;
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx1, sy1);
        drawn++;
      }
    } else {
      for (const k of list) {
        const [sx0, sy0] = toScreen(segs.xy[k * 4] / W, segs.xy[k * 4 + 1] / H);
        const [sx1, sy1] = toScreen(segs.xy[k * 4 + 2] / W, segs.xy[k * 4 + 3] / H);
        if (offScreen(sx0, sy0, sx1, sy1)) continue;
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx1, sy1);
        drawn++;
      }
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
  return drawn;
}

// ---------------------------------------------------------------------------
// The wash
// ---------------------------------------------------------------------------

const TINT_CACHE = new WeakMap<Int32Array, HTMLCanvasElement | null>();

/**
 * A country's colour, as a canvas at world-cell resolution.
 *
 * Built ONCE per `realmOf` and blitted like the base raster, rather than filled
 * cell by cell every frame the way the Carta does it. The Carta can afford the
 * loop because it settles; this view redraws on every frame of a pan, and a
 * stepped lattice over two million cells is not a per-frame cost. One
 * `drawImage` also gets smooth interpolation for free, so at planetary zoom the
 * wash reads as territory rather than as a mosaic of squares.
 *
 * Deliberately faint and deliberately flat: this sits over photographic ground,
 * and anything stronger stops being a country and starts being weather. The
 * hue is the realm's own, so the wash and its border are obviously the same
 * fact about the map.
 */
export function realmTint(
  world: { width: number; height: number },
  geo: HumanGeography,
): HTMLCanvasElement | null {
  const hit = TINT_CACHE.get(geo.realmOf);
  if (hit !== undefined) return hit;
  const W = world.width, H = world.height;
  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== 'undefined' && geo.realms.length) {
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(W, H);
      const px = img.data;
      // One RGB per realm, resolved once: `hsl()` per cell would be two million
      // string parses.
      const rgb = geo.realms.map((r) => hslToRgb(r.hue, 0.55, 0.58));
      for (let i = 0; i < W * H; i++) {
        const r = geo.realmOf[i];
        if (r < 0 || r >= rgb.length) continue;
        const c = rgb[r];
        px[i * 4] = c[0];
        px[i * 4 + 1] = c[1];
        px[i * 4 + 2] = c[2];
        px[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
  }
  TINT_CACHE.set(geo.realmOf, canvas);
  return canvas;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
