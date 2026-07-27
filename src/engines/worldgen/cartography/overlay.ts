// ============================================
// Cartography — Culture layer and lettering
// ============================================
// Roads, borders, settlement marks, labels and map furniture. Drawn last,
// over everything, because on a real map type and political ink always win the
// depth fight against terrain.
//
// Label placement follows the two rules that matter most in practice:
//   1. area labels sit at the pole of inaccessibility and run along the
//      region's principal axis, never at the centroid (which falls outside
//      crescent-shaped regions)
//   2. everything is collision-tested against everything already placed, in
//      importance order, and a label that cannot fit is dropped rather than
//      allowed to overlap

import type { RuinKind, WorldData } from '../core/types';
import { createRng } from '../core/rng';
import type { HumanGeography, NamedFeature, Settlement } from '../core/settlements';
import type { CartoTheme } from './theme';
import type { Ctx } from './symbols';
import { chaikin, resample, simplify, type Pt } from './contours';
import type { CartoView } from './render';

interface Rect { x: number; y: number; w: number; h: number }

/** Greedy collision index: labels are placed in importance order and anything
 *  that cannot find clear space is dropped. */
class LabelSpace {
  private rects: Rect[] = [];
  fits(r: Rect, pad = 2): boolean {
    for (const o of this.rects) {
      if (r.x - pad < o.x + o.w && r.x + r.w + pad > o.x && r.y - pad < o.y + o.h && r.y + r.h + pad > o.y) return false;
    }
    return true;
  }
  add(r: Rect): void { this.rects.push(r); }
}

export interface OverlayOptions {
  theme: CartoTheme;
  view: CartoView;
  scale: number;
  width: number;
  height: number;
  worldWidth: number;
  layers: { roads: boolean; borders: boolean; settlements: boolean; labels: boolean };
  /** Scales all type. */
  typeScale?: number;
}

function project(view: CartoView, scale: number, W: number) {
  const cx = view.x + view.w / 2;
  return {
    x(wx: number): number {
      let x = wx;
      while (x < cx - W / 2) x += W;
      while (x > cx + W / 2) x -= W;
      return (x - view.x) * scale;
    },
    y(wy: number): number { return (wy - view.y) * scale; },
  };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Letter-spaced text: canvas has no tracking, so glyphs are placed by hand. */
function trackedText(ctx: Ctx, text: string, x: number, y: number, tracking: number, stroke = false): number {
  let cursor = 0;
  const widths: number[] = [];
  for (const ch of text) widths.push(ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1);
  cursor = -total / 2;
  let k = 0;
  for (const ch of text) {
    if (stroke) ctx.strokeText(ch, x + cursor + widths[k] / 2, y);
    else ctx.fillText(ch, x + cursor + widths[k] / 2, y);
    cursor += widths[k] + tracking;
    k++;
  }
  return total;
}

/**
 * Lay a string along a polyline, one glyph at a time: walk the path by each
 * glyph's advance and rotate it to the local tangent. Flips the whole run when
 * the path mostly heads leftward so the text is never upside-down.
 */
function textOnPath(ctx: Ctx, text: string, path: Pt[], tracking: number, offset = 0): boolean {
  if (path.length < 2) return false;
  const seg: number[] = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    seg.push(total);
  }
  const widths = [...text].map((c) => ctx.measureText(c).width);
  const textLen = widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1);
  if (textLen > total * 0.92) return false;

  // Reverse when the run would read right-to-left.
  const flip = path[path.length - 1].x < path[0].x;
  const p = flip ? [...path].reverse() : path;
  if (flip) {
    seg.length = 0;
    seg.push(0);
    let t = 0;
    for (let i = 1; i < p.length; i++) {
      t += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
      seg.push(t);
    }
  }

  const at = (d: number): { x: number; y: number; a: number } => {
    let i = 1;
    while (i < seg.length - 1 && seg[i] < d) i++;
    const t = (d - seg[i - 1]) / Math.max(1e-6, seg[i] - seg[i - 1]);
    const a = p[i - 1], b = p[i];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      a: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };

  let d = (total - textLen) / 2;
  for (let k = 0; k < text.length; k++) {
    const pos = at(d + widths[k] / 2);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(pos.a);
    ctx.fillText(text[k], 0, offset);
    ctx.restore();
    d += widths[k] + tracking;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Roads / borders / settlements
// ---------------------------------------------------------------------------

/**
 * Cell path → screen polyline. The path is first un-wrapped so it stays
 * continuous across the seam, then shifted ONCE as a whole into the view
 * window. Re-wrapping each point independently — the obvious implementation —
 * teleports a single vertex to the far side and draws a road straight across
 * the ocean.
 */
function toScreenPath(
  cells: number[],
  W: number,
  view: CartoView,
  scale: number,
): Pt[] {
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
  let mean = 0;
  for (const p of raw) mean += p.x;
  mean /= raw.length;
  const cx = view.x + view.w / 2;
  let shift = 0;
  while (mean + shift < cx - W / 2) shift += W;
  while (mean + shift > cx + W / 2) shift -= W;
  return raw.map((p) => ({ x: (p.x + shift - view.x) * scale, y: (p.y - view.y) * scale }));
}

export function drawRoads(ctx: Ctx, geo: HumanGeography, opts: OverlayOptions): void {
  const { theme, scale, worldWidth: W } = opts;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const road of geo.roads) {
    let pts = toScreenPath(road.cells, W, opts.view, scale);
    pts = chaikin(simplify(pts, 1.1), false, 2);
    if (pts.length < 2) continue;
    // Casing first, then the dashed track over it: the pale under-stroke is what
    // keeps a road legible where it crosses forest and hills.
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = theme.paper.base;
    ctx.lineWidth = (road.major ? theme.roads.majorWidth : theme.roads.minorWidth) * scale * 0.55 + 2.2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = road.major ? theme.roads.major : theme.roads.minor;
    ctx.lineWidth = Math.max(0.7, (road.major ? theme.roads.majorWidth : theme.roads.minorWidth) * Math.min(2, Math.max(0.6, scale)));
    ctx.setLineDash(theme.roads.dash.map((d) => d * Math.max(0.8, Math.min(1.8, scale))));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

export function drawBorders(ctx: Ctx, world: WorldData, geo: HumanGeography, opts: OverlayOptions): void {
  const { theme, scale, worldWidth: W } = opts;
  const H = world.height;
  const pr = project(opts.view, scale, W);
  ctx.save();

  // Translucent fill per realm, painted cell-wise at low resolution: the point
  // is a tint, so a chunky raster is cheaper and reads identically.
  const step = Math.max(1, Math.round(1 / Math.max(0.15, scale)));
  ctx.globalAlpha = theme.borders.fillAlpha;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const id = geo.realmOf[y * W + x];
      if (id < 0) continue;
      const sx = pr.x(x), sy = pr.y(y);
      if (sx < -20 || sy < -20 || sx > opts.width + 20 || sy > opts.height + 20) continue;
      ctx.fillStyle = `hsl(${geo.realms[id].hue} 42% 44%)`;
      ctx.fillRect(sx, sy, step * scale + 1, step * scale + 1);
    }
  }

  // Border ink: every cell whose right/bottom neighbour belongs elsewhere.
  ctx.globalAlpha = theme.borders.alpha;
  ctx.lineWidth = theme.borders.width * Math.max(0.7, Math.min(2, scale));
  ctx.setLineDash(theme.borders.dash.map((d) => d * Math.max(0.8, Math.min(1.6, scale))));
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = geo.realmOf[i];
      const r = geo.realmOf[y * W + ((x + 1) % W)];
      const d = geo.realmOf[i + W];
      if (a === r && a === d) continue;
      const sx = pr.x(x), sy = pr.y(y);
      if (sx < -10 || sy < -10 || sx > opts.width + 10 || sy > opts.height + 10) continue;
      ctx.strokeStyle = `hsl(${geo.realms[Math.max(a, r, d)]?.hue ?? 0} 45% 28%)`;
      ctx.beginPath();
      if (a !== r) { ctx.moveTo(sx + scale, sy); ctx.lineTo(sx + scale, sy + scale); }
      if (a !== d) { ctx.moveTo(sx, sy + scale); ctx.lineTo(sx + scale, sy + scale); }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** Settlement marks: the classic cartographic hierarchy of dot, ring, and a
 *  little walled-town glyph for the largest places. */
function drawSettlementMark(ctx: Ctx, s: Settlement, theme: CartoTheme, r: number): void {
  ctx.lineWidth = Math.max(0.6, r * 0.24);
  ctx.strokeStyle = theme.settlement.ink;
  if (s.rank === 'village') {
    ctx.fillStyle = theme.settlement.ink;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (s.rank === 'town') {
    ctx.fillStyle = theme.settlement.fill;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }
  // City / capital: a squat tower block with crenellations.
  const w = r * 2.1, h = r * 1.5;
  ctx.fillStyle = s.rank === 'capital' ? theme.settlement.capitalFill : theme.settlement.fill;
  ctx.beginPath();
  ctx.moveTo(-w / 2, r * 0.5);
  ctx.lineTo(-w / 2, r * 0.5 - h);
  const merlons = 4;
  for (let i = 0; i < merlons; i++) {
    const x0 = -w / 2 + (w * i) / merlons;
    const x1 = -w / 2 + (w * (i + 0.5)) / merlons;
    const x2 = -w / 2 + (w * (i + 1)) / merlons;
    ctx.lineTo(x0, r * 0.5 - h - r * 0.35);
    ctx.lineTo(x1, r * 0.5 - h - r * 0.35);
    ctx.lineTo(x1, r * 0.5 - h);
    ctx.lineTo(x2, r * 0.5 - h);
  }
  ctx.lineTo(w / 2, r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (s.rank === 'capital') {
    // A star above the capital, the way atlases mark a seat of government.
    ctx.fillStyle = theme.settlement.ink;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 ? r * 0.32 : r * 0.72;
      const px = Math.cos(a) * rad, py = Math.sin(a) * rad - h - r * 0.95;
      if (i > 0) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Ruin glyphs.
 *
 * Every one is drawn BROKEN — a gap in the wall, a snapped tower, one arch
 * missing from the bridge. That asymmetry is the entire signal: a neat little
 * tower reads as a living castle, and no amount of grey ink fixes it.
 */
function drawRuinMark(ctx: Ctx, kind: RuinKind, theme: CartoTheme, r: number): void {
  ctx.lineWidth = Math.max(0.55, r * 0.2);
  ctx.strokeStyle = theme.settlement.ink;
  ctx.fillStyle = theme.settlement.fill;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  };
  switch (kind) {
    case 'tower': {
      // A stump: two walls standing, the top jagged.
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, r * 0.6);
      ctx.lineTo(-r * 0.45, -r * 0.75);
      ctx.lineTo(-r * 0.12, -r * 0.45);
      ctx.lineTo(r * 0.12, -r * 0.95);
      ctx.lineTo(r * 0.45, -r * 0.3);
      ctx.lineTo(r * 0.45, r * 0.6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'fort': {
      // A curtain wall with a breach in the middle.
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.55);
      ctx.lineTo(-r, -r * 0.45);
      ctx.lineTo(-r * 0.62, -r * 0.45);
      ctx.lineTo(-r * 0.62, r * 0.1);
      ctx.lineTo(-r * 0.2, r * 0.1);
      ctx.lineTo(-r * 0.2, r * 0.55);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.25, r * 0.55);
      ctx.lineTo(r * 0.25, -r * 0.2);
      ctx.lineTo(r, -r * 0.6);
      ctx.lineTo(r, r * 0.55);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'wall': {
      line(-r, r * 0.35, -r * 0.25, r * 0.35);
      line(-r * 0.25, r * 0.35, -r * 0.25, -r * 0.35);
      line(r * 0.3, r * 0.35, r, r * 0.35);
      line(r * 0.3, r * 0.35, r * 0.3, -r * 0.2);
      break;
    }
    case 'temple': {
      // Columns and a fallen lintel.
      for (const cx of [-r * 0.6, -r * 0.15, r * 0.55]) line(cx, r * 0.6, cx, -r * 0.4);
      line(-r * 0.8, -r * 0.5, r * 0.1, -r * 0.62);
      break;
    }
    case 'stones': {
      // A ring seen obliquely, one stone down.
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = Math.cos(a) * r * 0.85, py = Math.sin(a) * r * 0.45;
        if (i === 3) { line(px - r * 0.2, py, px + r * 0.2, py); continue; }
        ctx.beginPath();
        ctx.rect(px - r * 0.12, py - r * 0.42, r * 0.24, r * 0.52);
        ctx.fill(); ctx.stroke();
      }
      break;
    }
    case 'bridge': {
      // Two piers and one surviving arch.
      ctx.beginPath();
      ctx.arc(-r * 0.35, r * 0.45, r * 0.42, Math.PI, 0);
      ctx.stroke();
      line(-r, r * 0.55, -r, r * 0.05);
      line(r * 0.35, r * 0.55, r * 0.35, -r * 0.05);
      line(r * 0.35, r * 0.02, r * 0.68, r * 0.02);
      break;
    }
    case 'mine': {
      // An adit: a dark mouth in a hillside, with spoil below.
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, r * 0.55);
      ctx.lineTo(0, -r * 0.7);
      ctx.lineTo(r * 0.75, r * 0.55);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = theme.settlement.ink;
      ctx.beginPath();
      ctx.arc(0, r * 0.3, r * 0.24, Math.PI, 0);
      ctx.fill();
      break;
    }
    default: {
      // A dead city: a broken block plan.
      ctx.beginPath();
      ctx.rect(-r * 0.9, -r * 0.25, r * 0.7, r * 0.8);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.rect(-r * 0.05, -r * 0.6, r * 0.55, r * 1.15);
      ctx.fill(); ctx.stroke();
      line(r * 0.7, r * 0.55, r * 0.7, -r * 0.1);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// The full overlay
// ---------------------------------------------------------------------------

export function drawOverlay(ctx: Ctx, world: WorldData, geo: HumanGeography, opts: OverlayOptions): void {
  const { theme, scale, worldWidth: W } = opts;
  const pr = project(opts.view, scale, W);
  const ts = opts.typeScale ?? 1;
  const space = new LabelSpace();
  const inside = (x: number, y: number, m = 0) => x > -m && y > -m && x < opts.width + m && y < opts.height + m;

  if (opts.layers.borders) drawBorders(ctx, world, geo, opts);
  if (opts.layers.roads) drawRoads(ctx, geo, opts);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const halo = (size: number) => {
    ctx.lineWidth = theme.type.haloWidth * Math.max(0.6, size / 14);
    ctx.strokeStyle = theme.type.halo;
  };

  // ---- area labels, most important first ----------------------------------
  if (opts.layers.labels) {
    const areas = geo.features
      .filter((f) => f.kind !== 'river' && f.kind !== 'peak')
      .sort((a, b) => b.importance - a.importance);

    for (const f of areas) {
      const style = AREA_STYLE[f.kind] ?? AREA_STYLE.default;
      const x = pr.x(f.x), y = pr.y(f.y);
      if (!inside(x, y, 60)) continue;

      const text = style.caps ? f.name.toUpperCase() : f.name;
      // FIXED SCREEN SIZE, not a function of the zoom.
      //
      // Tying type size to `pow(scale, 0.55)` meant every name grew and shrank
      // continuously as the reader turned the wheel, and because the shrink-to-fit
      // and the collision test both re-ran against those changing sizes, labels
      // also popped in and out at different moments. On a real atlas a city name
      // is the same height on the sheet whatever the sheet's scale; what changes
      // with scale is WHICH names are on it. So size is constant per class and
      // visibility is gated on a discrete threshold, which cannot flicker.
      let size = Math.max(8, Math.min(52, style.size * ts * (0.85 + f.importance * 0.35)));
      if (f.extent * scale < (style.bounded === false ? 26 : 46)) continue;

      // Shrink to fit the region. A continent label wider than its continent is
      // the single most common way a generated map betrays itself, so the
      // region's own screen extent is a hard cap, not a suggestion.
      const budget = style.bounded === false ? Infinity : f.extent * scale * 0.92;
      ctx.font = `${style.italic ? 'italic ' : ''}${style.weight} ${size}px ${theme.type.display}`;
      let w = ctx.measureText(text).width + size * style.tracking * (text.length - 1);
      if (w > budget) {
        size *= budget / w;
        if (size < 8) continue;
        ctx.font = `${style.italic ? 'italic ' : ''}${style.weight} ${size}px ${theme.type.display}`;
        w = ctx.measureText(text).width + size * style.tracking * (text.length - 1);
      }
      const tracking = size * style.tracking;
      const angle = style.rotate ? clampAngle(f.angle) : 0;
      // Collision uses the ROTATED bounds; testing the upright box lets two
      // slanted labels sit right on top of each other.
      const rect = rotatedBounds(x, y, w, size * 1.4, angle);
      if (!space.fits(rect, 3)) continue;
      // A sea name lying across a continent is worse than no sea name: sample
      // the label's own footprint and require it to stay on the right medium.
      if (style.footprint !== false
        && !footprintMatches(world, opts, rect, style.water === true, style.bounded === false ? 0.55 : 0.72)) continue;
      space.add(rect);

      ctx.save();
      ctx.translate(x, y);
      if (angle) ctx.rotate(angle);
      ctx.fillStyle = style.water ? theme.type.oceanColor : theme.type.color;
      halo(size);
      trackedText(ctx, text, 0, 0, tracking, true);
      trackedText(ctx, text, 0, 0, tracking, false);
      ctx.restore();
    }

    // ---- river labels, curved along the channel ---------------------------
    ctx.fillStyle = theme.rivers.color;
    for (const f of geo.features) {
      if (f.kind !== 'river' || !f.cells) continue;
      const size = 11 * ts;
      ctx.font = `italic 400 ${size}px ${theme.type.body}`;
      // Label the middle third — the mouth is busy and the source is thin.
      const a = Math.floor(f.cells.length * 0.35), b = Math.floor(f.cells.length * 0.8);
      const seg = f.cells.slice(a, b);
      if (seg.length < 6) continue;
      let path = toScreenPath(seg, W, opts.view, scale);
      if (!path.some((p) => inside(p.x, p.y, 30))) continue;
      path = chaikin(simplify(path, 1.2), false, 2);
      path = resample(path, Math.max(3, size * 0.5), false);
      const bb = pathBBox(path);
      if (!space.fits(bb, 1)) continue;
      if (textOnPath(ctx, f.name, path, size * 0.06, -size * 0.75)) space.add(bb);
    }
  }

  // ---- settlements ---------------------------------------------------------
  if (opts.layers.settlements) {
    const order = geo.settlements.slice().sort((a, b) => rankWeight(b) - rankWeight(a));
    const rng = createRng(world.params.seed, 'labels');
    for (const s of order) {
      const x = pr.x(s.x), y = pr.y(s.y);
      if (!inside(x, y, 24)) continue;
      // The mark is a symbol on the sheet, so it keeps its size too.
      const r = (s.rank === 'capital' ? 5.6 : s.rank === 'city' ? 4.6 : s.rank === 'town' ? 3.4 : 2.4) * ts;
      const markRect: Rect = { x: x - r * 1.3, y: y - r * 2.6, w: r * 2.6, h: r * 3.4 };
      if (!space.fits(markRect, 1)) continue;
      space.add(markRect);

      ctx.save();
      ctx.translate(x, y);
      drawSettlementMark(ctx, s, theme, r);
      ctx.restore();

      if (!opts.layers.labels) continue;
      const size = (s.rank === 'capital' ? 13 : s.rank === 'city' ? 11 : s.rank === 'town' ? 9 : 7.6) * ts;
      // Smaller places appear as you zoom in, at fixed thresholds — the atlas
      // convention, and the only way the set of visible names stays stable while
      // the wheel is turning.
      const minScale = s.rank === 'capital' ? 0 : s.rank === 'city' ? 0.8 : s.rank === 'town' ? 1.6 : 3.2;
      if (scale < minScale) continue;
      ctx.font = `${s.rank === 'capital' ? '600' : '400'} ${size}px ${theme.type.display}`;
      const text = s.rank === 'capital' ? s.name.toUpperCase() : s.name;
      const tw = ctx.measureText(text).width;
      // Standard cartographic preference order: right, left, above, below.
      const candidates: [number, number][] = [
        [x + r * 1.6 + tw / 2, y + size * 0.1],
        [x - r * 1.6 - tw / 2, y + size * 0.1],
        [x, y - r * 2.2 - size * 0.6],
        [x, y + r * 1.6 + size * 0.7],
      ];
      let done = false;
      for (const [lx, ly] of candidates) {
        const rect: Rect = { x: lx - tw / 2, y: ly - size * 0.6, w: tw, h: size * 1.2 };
        if (!space.fits(rect, 2)) continue;
        space.add(rect);
        ctx.fillStyle = theme.type.color;
        halo(size);
        ctx.strokeText(text, lx, ly);
        ctx.fillText(text, lx, ly);
        done = true;
        break;
      }
      void done;
      void rng;
    }
  }

  // ---- ruins ---------------------------------------------------------------
  // Drawn AFTER settlements so a living town always wins the space fight: a ruin
  // crowding out a city is the wrong way round.
  if (opts.layers.settlements) {
    for (const ru of geo.ruins.slice().sort((a, b) => b.importance - a.importance)) {
      const x = pr.x(ru.x), y = pr.y(ru.y);
      if (!inside(x, y, 20)) continue;
      const r = (ru.kind === 'city' ? 5.4 : ru.kind === 'fort' ? 5 : 4.2) * ts;
      if (scale < 1.4) continue;  // below this a ruin is clutter, not information
      const markRect: Rect = { x: x - r * 1.2, y: y - r * 1.3, w: r * 2.4, h: r * 2.4 };
      if (!space.fits(markRect, 1)) continue;
      space.add(markRect);

      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 0.85;      // ruins sit back from the living map
      drawRuinMark(ctx, ru.kind, theme, r);
      ctx.restore();

      if (!opts.layers.labels) continue;
      const size = 8.4 * ts;
      ctx.font = `italic 400 ${size}px ${theme.type.body}`;
      const tw = ctx.measureText(ru.name).width;
      for (const [lx, ly] of [
        [x, y + r * 1.5 + size * 0.7],
        [x + r * 1.5 + tw / 2, y + size * 0.1],
        [x - r * 1.5 - tw / 2, y + size * 0.1],
        [x, y - r * 1.5 - size * 0.6],
      ] as [number, number][]) {
        const rect: Rect = { x: lx - tw / 2, y: ly - size * 0.6, w: tw, h: size * 1.2 };
        if (!space.fits(rect, 2)) continue;
        space.add(rect);
        ctx.fillStyle = theme.type.color;
        halo(size);
        ctx.strokeText(ru.name, lx, ly);
        ctx.fillText(ru.name, lx, ly);
        break;
      }
    }
  }

  // ---- hand-written labels -------------------------------------------------
  // Last, and unconditionally placed: the reader typed these, so they outrank
  // everything the generator has an opinion about.
  if (opts.layers.labels && world.painted?.labels.length) {
    for (const pl of world.painted.labels) {
      const x = pr.x(pl.x), y = pr.y(pl.y);
      if (!inside(x, y, 80)) continue;
      const style = AREA_STYLE[pl.style === 'water' ? 'sea' : pl.style === 'range' ? 'range'
        : pl.style === 'settlement' ? 'default' : pl.style === 'note' ? 'default' : 'continent'];
      const size = Math.max(8, (pl.size ?? style.size) * ts * Math.pow(Math.max(0.35, scale), 0.55));
      ctx.font = `${style.italic ? 'italic ' : ''}${style.weight} ${size}px ${theme.type.display}`;
      const text = style.caps ? pl.text.toUpperCase() : pl.text;
      const tracking = size * style.tracking;
      const w = ctx.measureText(text).width + tracking * (text.length - 1);
      const angle = pl.angle ?? 0;
      space.add(rotatedBounds(x, y, w, size * 1.4, angle));
      ctx.save();
      ctx.translate(x, y);
      if (angle) ctx.rotate(angle);
      ctx.fillStyle = pl.style === 'water' ? theme.type.oceanColor : theme.type.color;
      halo(size);
      trackedText(ctx, text, 0, 0, tracking, true);
      trackedText(ctx, text, 0, 0, tracking, false);
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * True when most of a label's footprint sits on the medium it belongs to —
 * water for hydronyms, land for everything else. Sampled on a coarse grid
 * because a label is allowed to clip a headland, just not to straddle one.
 */
function footprintMatches(
  world: WorldData,
  opts: OverlayOptions,
  r: Rect,
  wantWater: boolean,
  need = 0.72,
): boolean {
  const { worldWidth: W, view, scale } = opts;
  const H = world.height;
  let hit = 0, total = 0;
  for (let sy = 0; sy <= 3; sy++) {
    for (let sx = 0; sx <= 6; sx++) {
      const px = r.x + (r.w * sx) / 6;
      const py = r.y + (r.h * sy) / 3;
      const wx = Math.round(view.x + px / scale);
      const wy = Math.round(view.y + py / scale);
      if (wy < 0 || wy >= H) continue;
      const isWater = world.elevation[wy * W + ((wx % W) + W) % W] <= 0;
      total++;
      if (isWater === wantWater) hit++;
    }
  }
  return total === 0 || hit / total >= need;
}

/** Axis-aligned bounds of a rotated, centred box. */
function rotatedBounds(cx: number, cy: number, w: number, h: number, angle: number): Rect {
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const bw = w * c + h * s;
  const bh = w * s + h * c;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

function pathBBox(path: Pt[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of path) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Keep rotated labels within ±60° of horizontal — past that they stop being
 *  readable at a glance, which is the whole point of a map label. */
function clampAngle(a: number): number {
  let x = a;
  while (x > Math.PI / 2) x -= Math.PI;
  while (x < -Math.PI / 2) x += Math.PI;
  return Math.max(-Math.PI / 3, Math.min(Math.PI / 3, x));
}

function rankWeight(s: Settlement): number {
  return s.rank === 'capital' ? 4 : s.rank === 'city' ? 3 : s.rank === 'town' ? 2 : 1;
}

interface AreaStyle {
  size: number;
  caps: boolean;
  italic: boolean;
  weight: string;
  tracking: number;
  rotate: boolean;
  water?: boolean;
  /**
   * False for point features (a cape, a pass, a delta), which are allowed a name
   * longer than the thing they name. Shrinking "Cabo Tormentas" to fit inside a
   * seven-cell headland produces four-pixel type, which is how the first version
   * of this managed to place every coastal name and show none of them.
   */
  bounded?: boolean;
  /** Whether the label's footprint must sit on the right medium. */
  footprint?: boolean;
}

/** Type hierarchy. Water is italic and blue by convention; physical regions get
 *  letter-spaced caps; political names are the largest thing on the sheet. */
const AREA_STYLE: Record<string, AreaStyle> = {
  continent: { size: 30, caps: true, italic: false, weight: '600', tracking: 0.4, rotate: true },
  ocean: { size: 26, caps: true, italic: true, weight: '400', tracking: 0.55, rotate: true, water: true },
  sea: { size: 18, caps: true, italic: true, weight: '400', tracking: 0.4, rotate: true, water: true },
  bay: { size: 11, caps: false, italic: true, weight: '400', tracking: 0.12, rotate: true, water: true, bounded: false },
  isle: { size: 11, caps: false, italic: true, weight: '400', tracking: 0.1, rotate: false },
  range: { size: 15, caps: true, italic: false, weight: '500', tracking: 0.28, rotate: true },
  forest: { size: 13, caps: false, italic: true, weight: '400', tracking: 0.14, rotate: true },
  desert: { size: 15, caps: true, italic: false, weight: '400', tracking: 0.34, rotate: true },
  plain: { size: 13, caps: false, italic: true, weight: '400', tracking: 0.2, rotate: true },
  lake: { size: 10, caps: false, italic: true, weight: '400', tracking: 0.08, rotate: false, water: true },
  realm: { size: 20, caps: true, italic: false, weight: '600', tracking: 0.45, rotate: true },
  // The fine print of a coast. Small, unspaced, and — for the water ones — italic
  // blue, which is the convention that lets a reader tell a bay from a headland
  // without reading either name.
  // A cape name lies over the water beside the headland — that is the convention,
  // so it must NOT be footprint-tested against land.
  cape: { size: 9, caps: false, italic: false, weight: '400', tracking: 0.06, rotate: false, bounded: false, footprint: false },
  strait: { size: 9.5, caps: false, italic: true, weight: '400', tracking: 0.08, rotate: true, water: true, bounded: false },
  valley: { size: 9.5, caps: false, italic: true, weight: '400', tracking: 0.08, rotate: true, bounded: false, footprint: false },
  gorge: { size: 9, caps: false, italic: true, weight: '400', tracking: 0.06, rotate: true, bounded: false, footprint: false },
  marsh: { size: 9.5, caps: false, italic: true, weight: '400', tracking: 0.1, rotate: true, bounded: false, footprint: false },
  default: { size: 12, caps: false, italic: false, weight: '400', tracking: 0.1, rotate: false },
};

export { AREA_STYLE, LabelSpace, textOnPath, trackedText };
export type { Rect, NamedFeature };
