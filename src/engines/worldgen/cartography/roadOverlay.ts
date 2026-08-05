// ============================================
// World Generator — the road network, as screen polylines
// ============================================
// Roads had two homes and a hole between them. The Carta inks them itself
// (`cartography/overlay.ts`), and the deep satellite tiles drape them onto the
// canon as real worn tracks (`region/tracks.ts`) — but only from the level
// where a canon cell is 1,5 output pixels across, which on a 2048 world is
// z11. Everything above that — the whole planetary, continental and regional
// range, which is exactly where a road between two cities is the thing you are
// looking at — drew the ground, the rivers and the towns and left the calzadas
// out entirely.
//
// This is that layer, kept out of `Map2D` so it can be measured without a
// browser: it takes a plain 2D context and returns what it actually drew.

import type { Road } from '../core/settlements';
import { chaikin, simplify, type Pt } from './contours';

export interface RoadOverlayOptions {
  /** World grid, for un-flattening the cell indices. */
  worldWidth: number;
  worldHeight: number;
  /** Map coords (u east 0..1, v south 0..1) → screen pixels, for ONE copy. */
  toScreen: (u: number, v: number) => [number, number];
  /** Screen extent in CSS pixels, for culling. */
  width: number;
  height: number;
  /** Screen pixels per world cell — sets the weights and the dash rhythm. */
  pxPerCell: number;
  /** Below 1 the layer is fading out under the tiles that ink the real thing. */
  alpha?: number;
  /** Drawn brighter and thicker: the road being laid, or the one picked. */
  emphasis?: (road: Road, index: number) => boolean;
}

export interface RoadOverlayResult {
  /** Roads whose polyline reached the canvas. */
  drawn: number;
  /** Roads rejected by the viewport test before any stroking. */
  culled: number;
  /** Vertices stroked, after simplification — the cost of the layer. */
  vertices: number;
}

/**
 * Cell path → continuous world-cell polyline.
 *
 * The path is un-wrapped as it is read: each x is pulled to the copy nearest
 * the one before it, so a road that crosses the antimeridian keeps going west
 * into negative x instead of teleporting to the far side of the map and
 * drawing a straight line back across the ocean. The whole path is then
 * shifted, ONCE and as a unit, into the [0, W) copy nearest its own centre —
 * shifting per point is the bug this comment exists to prevent.
 */
export function unwrapRoad(cells: number[], W: number): Pt[] {
  const raw: Pt[] = [];
  let prev = 0;
  for (let k = 0; k < cells.length; k++) {
    let x = cells[k] % W;
    const y = (cells[k] / W) | 0;
    if (k > 0) {
      if (x - prev > W / 2) x -= W;
      if (x - prev < -W / 2) x += W;
    }
    prev = x;
    raw.push({ x, y });
  }
  if (!raw.length) return raw;
  let mean = 0;
  for (const p of raw) mean += p.x;
  mean /= raw.length;
  let shift = 0;
  while (mean + shift < 0) shift += W;
  while (mean + shift >= W) shift -= W;
  if (shift !== 0) for (const p of raw) p.x += shift;
  return raw;
}

/**
 * World-cell polyline → screen polyline, or null if none of it can be seen.
 *
 * The cull is a bounding box with a generous skirt rather than a segment test:
 * a road is a hundred vertices and there are hundreds of roads, so the point is
 * to reject the ones on the other side of the planet in a few dozen
 * comparisons, not to be exact about the ones that graze the edge.
 */
export function roadScreenPath(
  path: Pt[],
  opts: Pick<RoadOverlayOptions, 'worldWidth' | 'worldHeight' | 'toScreen' | 'width' | 'height'>,
): Pt[] | null {
  const { worldWidth: W, worldHeight: H, toScreen, width, height } = opts;
  if (path.length < 2) return null;
  const out: Pt[] = new Array(path.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < path.length; k++) {
    const [sx, sy] = toScreen((path[k].x + 0.5) / W, (path[k].y + 0.5) / H);
    out[k] = { x: sx, y: sy };
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  const skirt = 24;
  if (maxX < -skirt || minX > width + skirt) return null;
  if (maxY < -skirt || minY > height + skirt) return null;
  return out;
}

/**
 * Weight of a road on screen, in CSS pixels.
 *
 * Sized in SCREEN pixels with a bounded lean on the zoom, not as a fraction of
 * a world cell: a cell is forty kilometres at the top of the pyramid and four
 * hundred metres at the bottom, and a road drawn as a fraction of it is either
 * an invisible thread or a tan motorway ten kilometres wide. A calzada is
 * about the same thickness of line on every map ever drawn.
 */
function roadWidth(major: boolean, pxPerCell: number, emphasised: boolean): number {
  const lean = Math.max(0.55, Math.min(2.4, pxPerCell));
  const base = (major ? 1.9 : 1.25) * lean;
  return emphasised ? base * 1.6 + 1 : base;
}

/** Pale casing under, warm track over: what keeps a road legible where it
 *  crosses forest, mountain shadow and the dark of an ocean shelf alike. */
const CASING = 'rgba(28,24,18,0.45)';
const MAJOR_INK = 'rgba(232,212,168,0.95)';
const MINOR_INK = 'rgba(206,188,152,0.88)';
const EMPHASIS_INK = 'rgba(255,214,120,0.98)';

/** The same alias the rest of the cartography uses; benches hand it a
 *  `@napi-rs/canvas` context through the usual cast. */
export type Ctx = CanvasRenderingContext2D;

/**
 * Draw the whole network into a context whose origin is the canvas corner.
 *
 * Major roads are solid and minor ones dashed, which is the only cue the
 * reader has for the `roadMajor` switch on the brush — a trade artery and a
 * cart track drawn identically make the toggle a lie.
 */
export function drawRoadNetwork(
  ctx: Ctx,
  roads: readonly Road[],
  opts: RoadOverlayOptions,
): RoadOverlayResult {
  const result: RoadOverlayResult = { drawn: 0, culled: 0, vertices: 0 };
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.01 || !roads.length) {
    result.culled = roads.length;
    return result;
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const dashUnit = Math.max(2.4, Math.min(9, opts.pxPerCell * 2.2));

  for (let i = 0; i < roads.length; i++) {
    const road = roads[i];
    if (road.cells.length < 2) { result.culled++; continue; }
    const screen = roadScreenPath(unwrapRoad(road.cells, opts.worldWidth), opts);
    if (!screen) { result.culled++; continue; }
    // Simplify in SCREEN space, so the cost of a road falls with the zoom
    // instead of staying at one vertex per world cell forever; smooth after,
    // because a route solved on a grid is a staircase and reads as one.
    let pts = simplify(screen, 0.9);
    if (pts.length > 2 && pts.length < 400) pts = chaikin(pts, false, 1);
    if (pts.length < 2) { result.culled++; continue; }
    const emphasised = opts.emphasis?.(road, i) === true;
    const w = roadWidth(road.major, opts.pxPerCell, emphasised);

    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.stroke();
    };

    ctx.globalAlpha = alpha * 0.85;
    ctx.setLineDash([]);
    ctx.strokeStyle = CASING;
    ctx.lineWidth = w * 2.1 + 0.8;
    trace();

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = emphasised ? EMPHASIS_INK : (road.major ? MAJOR_INK : MINOR_INK);
    ctx.lineWidth = w;
    ctx.setLineDash(road.major ? [] : [dashUnit * 1.6, dashUnit]);
    trace();

    result.drawn++;
    result.vertices += pts.length;
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
  return result;
}

/**
 * How much of this layer to draw at a satellite level.
 *
 * Below the level where the deep tiles ink real draped tracks the overlay is
 * the only road on screen and is drawn in full. From there it fades out over
 * one level rather than blinking off, because the two are the same roads drawn
 * two ways and a hard switch between them reads as the map flickering.
 *
 * `pxPerCanonCell` is `satPxPerCanonCell` at the level the pyramid is actually
 * drawing; 0 means no deep tile is in play at all.
 */
export function roadOverlayAlpha(pxPerCanonCell: number): number {
  if (!(pxPerCanonCell > 0)) return 1;
  const t = (1.5 - pxPerCanonCell) / 0.55;
  return Math.max(0, Math.min(1, t));
}
