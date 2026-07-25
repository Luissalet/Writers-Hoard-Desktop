// ============================================
// City Generator — Plan rendering
// ============================================
// Draws a CityPlan in the same ink-on-parchment language as the world map, so
// zooming from the atlas into a town is a change of scale rather than a change
// of medium.
//
// Draw order is the order a draughtsman would work in: ground, water, fields,
// blocks, buildings, streets, walls, labels. Roads are laid as a pale ribbon
// with a thin casing rather than a single stroke — that is what makes a street
// read as negative space between buildings instead of a line on top of them.

import { createRng } from '../core/rng';
import type { CartoTheme } from '../cartography/theme';
import type { Ctx } from '../cartography/symbols';
import { area, centroid, dist, type Poly, type V } from './geometry';
import { ALLEY, MAIN_STREET, WARD_LABEL, type CityPlan, type WardType } from './generate';

export interface CityRenderOptions {
  theme: CartoTheme;
  width: number;
  height: number;
  /** Extra margin around the plan, as a fraction of its radius. */
  margin?: number;
  showLabels?: boolean;
  showWardTints?: boolean;
  title?: string;
}

/** Per-ward wash, kept very light — the footprints must stay the main event. */
const WARD_TINT: Partial<Record<WardType, string>> = {
  market: '#d8c79b',
  cathedral: '#c9b7d2',
  castle: '#cbb9a0',
  park: '#a9c08d',
  military: '#c4b0a2',
  slum: '#c8bda3',
  patriciate: '#d5c8a4',
  merchant: '#d9cba6',
  administration: '#cfc6ab',
  farm: '#cdc79a',
};

function tracePoly(ctx: Ctx, p: Poly): void {
  if (p.length < 3) return;
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  ctx.closePath();
}

export function renderCity(plan: CityPlan, ctx: Ctx, opts: CityRenderOptions): void {
  const { theme, width: W, height: H } = opts;
  const margin = opts.margin ?? 0.35;
  const rng = createRng(plan.seed, 'city-render');

  // Fit the plan to the canvas.
  const extent = plan.radius * (1 + margin) * 2;
  const s = Math.min(W, H) / extent;
  const ox = W / 2 - plan.center.x * s;
  const oy = H / 2 - plan.center.y * s;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.paper.base;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const unit = 1 / s; // one screen pixel in plan units
  const px = (n: number) => n * unit;

  // ---- ward washes and open space -----------------------------------------
  if (opts.showWardTints !== false) {
    ctx.globalAlpha = 0.5;
    for (const q of plan.patches) {
      const tint = WARD_TINT[q.ward];
      if (!tint) continue;
      ctx.fillStyle = tint;
      ctx.beginPath();
      tracePoly(ctx, q.shape);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Parks and courtyards read as open green / bare ground.
  for (const q of plan.patches) {
    for (const c of q.courts) {
      ctx.beginPath();
      tracePoly(ctx, c);
      ctx.fillStyle = q.ward === 'park' ? theme.forest.light : theme.paper.base;
      ctx.globalAlpha = q.ward === 'park' ? 0.75 : 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (q.ward === 'park') {
        ctx.strokeStyle = theme.forest.ink;
        ctx.lineWidth = px(0.5);
        ctx.stroke();
      }
    }
  }

  // ---- field lines outside the walls --------------------------------------
  ctx.strokeStyle = theme.dunes.color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = px(0.6);
  for (const q of plan.patches) {
    if (q.ward !== 'farm') continue;
    const c = centroid(q.shape);
    const a = rng() * Math.PI;
    const dx = Math.cos(a), dy = Math.sin(a);
    const r = Math.sqrt(area(q.shape));
    for (let k = -4; k <= 4; k++) {
      const off = (k / 4) * r * 0.45;
      ctx.beginPath();
      ctx.moveTo(c.x - dx * r * 0.5 - dy * off, c.y - dy * r * 0.5 + dx * off);
      ctx.lineTo(c.x + dx * r * 0.5 - dy * off, c.y + dy * r * 0.5 + dx * off);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // ---- water --------------------------------------------------------------
  // Drawn AFTER the ward washes. Before them, the half-opaque district tints
  // were painted straight over the river, which came out as a grey smear
  // wherever it passed through the town — i.e. everywhere that mattered.
  if (plan.coast) {
    const { p, n } = plan.coast;
    const far = plan.radius * 6;
    const t = { x: -n.y, y: n.x };
    ctx.beginPath();
    ctx.moveTo(p.x + t.x * far, p.y + t.y * far);
    ctx.lineTo(p.x - t.x * far, p.y - t.y * far);
    ctx.lineTo(p.x - t.x * far + n.x * far, p.y - t.y * far + n.y * far);
    ctx.lineTo(p.x + t.x * far + n.x * far, p.y + t.y * far + n.y * far);
    ctx.closePath();
    ctx.fillStyle = theme.ocean.shallow;
    ctx.fill();
    ctx.strokeStyle = theme.coastline.color;
    ctx.lineWidth = px(1.4);
    ctx.beginPath();
    ctx.moveTo(p.x + t.x * far, p.y + t.y * far);
    ctx.lineTo(p.x - t.x * far, p.y - t.y * far);
    ctx.stroke();
  }
  if (plan.river) {
    ctx.strokeStyle = theme.rivers.color;
    ctx.lineWidth = plan.radius * 0.09;
    ctx.beginPath();
    ctx.moveTo(plan.river[0].x, plan.river[0].y);
    for (let i = 1; i < plan.river.length; i++) ctx.lineTo(plan.river[i].x, plan.river[i].y);
    ctx.stroke();
    ctx.strokeStyle = theme.lakes.stroke;
    ctx.lineWidth = px(0.9);
    ctx.stroke();
  }

  // ---- streets: pale ribbon with a thin casing ----------------------------
  const drawRibbon = (path: V[], w: number) => {
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.strokeStyle = theme.roads.minor;
    ctx.lineWidth = w + px(1.2);
    ctx.stroke();
    ctx.strokeStyle = theme.paper.base;
    ctx.lineWidth = Math.max(px(0.6), w - px(0.6));
    ctx.stroke();
  };
  const fillPoly = (poly: Poly, fill: string, stroke?: string, lw = px(0.8)) => {
    ctx.beginPath();
    tracePoly(ctx, poly);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };

  for (const r of plan.roads) drawRibbon(r, MAIN_STREET * 0.8);
  for (const st of plan.streets) drawRibbon(st, MAIN_STREET);
  // Avenues last and wider, so the hierarchy survives every crossing.
  for (const st of plan.mainStreets) drawRibbon(st, MAIN_STREET * 1.45);

  // ---- waterfront and bridges ---------------------------------------------
  // Drawn after the streets and before the buildings: a quay is paving that the
  // houses stand back from, and a bridge deck has to cover the water the street
  // was just drawn across.
  for (const pier of plan.piers) fillPoly(pier, theme.roads.minor, theme.settlement.ink, px(0.8));
  for (const b of plan.bridges) {
    fillPoly(b, theme.paper.base, theme.settlement.ink, px(1.1));
    // Two parapet lines along the deck read as a bridge at any zoom; a plain
    // rectangle over a river reads as a mistake.
    if (b.length === 4) {
      ctx.strokeStyle = theme.settlement.ink;
      ctx.lineWidth = px(0.7);
      for (const [i, j] of [[0, 1], [2, 3]] as [number, number][]) {
        ctx.beginPath();
        ctx.moveTo(b[i].x, b[i].y);
        ctx.lineTo(b[j].x, b[j].y);
        ctx.stroke();
      }
    }
  }

  // ---- buildings ----------------------------------------------------------
  // Painter's order by lowest point so the tiny drop shadows stack correctly.
  const all: { poly: Poly; ward: WardType }[] = [];
  for (const q of plan.patches) for (const b of q.buildings) all.push({ poly: b, ward: q.ward });
  all.sort((a, b) => Math.max(...a.poly.map((v) => v.y)) - Math.max(...b.poly.map((v) => v.y)));

  const shadow = px(0.9);
  for (const { poly, ward } of all) {
    if (poly.length < 3) continue;
    // Offset shadow first — a hair of relief is what separates a town plan from
    // a floor plan.
    ctx.beginPath();
    ctx.moveTo(poly[0].x + shadow, poly[0].y + shadow);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x + shadow, poly[i].y + shadow);
    ctx.closePath();
    ctx.fillStyle = theme.mountains.ink;
    ctx.globalAlpha = 0.22;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    tracePoly(ctx, poly);
    ctx.fillStyle = ward === 'castle' || ward === 'cathedral' ? theme.settlement.capitalFill : theme.settlement.fill;
    ctx.fill();
    ctx.strokeStyle = theme.settlement.ink;
    ctx.lineWidth = px(ward === 'castle' || ward === 'cathedral' ? 0.9 : 0.65);
    ctx.stroke();
  }

  // ---- walls, towers, gates ------------------------------------------------
  if (plan.wall) {
    ctx.beginPath();
    if (plan.wallClosed === false) {
      ctx.moveTo(plan.wall[0].x, plan.wall[0].y);
      for (let i = 1; i < plan.wall.length; i++) ctx.lineTo(plan.wall[i].x, plan.wall[i].y);
    } else tracePoly(ctx, plan.wall);
    ctx.strokeStyle = theme.settlement.ink;
    ctx.lineWidth = MAIN_STREET * 0.85;
    ctx.stroke();
    ctx.strokeStyle = theme.settlement.fill;
    ctx.lineWidth = MAIN_STREET * 0.4;
    ctx.stroke();

    const tr = MAIN_STREET * 0.9;
    for (const t of plan.towers) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, tr, 0, Math.PI * 2);
      ctx.fillStyle = theme.settlement.fill;
      ctx.fill();
      ctx.strokeStyle = theme.settlement.ink;
      ctx.lineWidth = px(0.9);
      ctx.stroke();
    }
    for (const g of plan.gates) {
      ctx.beginPath();
      ctx.arc(g.x, g.y, tr * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = theme.settlement.capitalFill;
      ctx.fill();
      ctx.strokeStyle = theme.settlement.ink;
      ctx.lineWidth = px(1.1);
      ctx.stroke();
    }
  }
  if (plan.citadel) {
    ctx.beginPath();
    tracePoly(ctx, plan.citadel);
    ctx.strokeStyle = theme.settlement.ink;
    ctx.lineWidth = MAIN_STREET * 0.7;
    ctx.stroke();
  }

  ctx.restore();

  // ---- labels -------------------------------------------------------------
  if (opts.showLabels !== false) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const seen = new Set<WardType>();
    for (const q of plan.patches) {
      if (!q.withinCity) continue;
      const named: WardType[] = ['market', 'cathedral', 'castle', 'park', 'military'];
      if (!named.includes(q.ward) || seen.has(q.ward)) continue;
      seen.add(q.ward);
      const c = centroid(q.shape);
      const size = Math.max(8, Math.min(15, (W / 46)));
      ctx.font = `500 ${size}px ${theme.type.display}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.type.halo;
      ctx.fillStyle = theme.type.color;
      const x = c.x * s + ox, y = c.y * s + oy;
      ctx.strokeText(WARD_LABEL[q.ward], x, y);
      ctx.fillText(WARD_LABEL[q.ward], x, y);
    }

    const title = opts.title ?? plan.name;
    const tSize = Math.max(16, W * 0.036);
    ctx.font = `600 ${tSize}px ${theme.type.display}`;
    ctx.fillStyle = theme.type.color;
    ctx.strokeStyle = theme.type.halo;
    ctx.lineWidth = 5;
    let cursor = 0;
    const tracking = tSize * 0.32;
    const up = title.toUpperCase();
    const total = [...up].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + tracking * (up.length - 1);
    cursor = W / 2 - total / 2;
    for (const ch of up) {
      const w = ctx.measureText(ch).width;
      ctx.strokeText(ch, cursor + w / 2, tSize * 1.2);
      ctx.fillText(ch, cursor + w / 2, tSize * 1.2);
      cursor += w + tracking;
    }
    ctx.font = `italic 400 ${tSize * 0.4}px ${theme.type.body}`;
    ctx.lineWidth = 3;
    const sub = `${plan.population.toLocaleString('es-ES')} habitantes · ${plan.wall ? 'ciudad amurallada' : 'villa abierta'}`;
    ctx.strokeText(sub, W / 2, tSize * 2.05);
    ctx.fillText(sub, W / 2, tSize * 2.05);
    ctx.restore();
  }
  void dist;
  void ALLEY;

}
