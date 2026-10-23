// ============================================
// Cartography — the trade lens on a map
// ============================================
// Where goods are made (a small lozenge per site, coloured by kind; the
// author's own ringed) and what is moving this month (a dashed line per
// shipment, brown by road and blue by sea, with an arrowhead at the buyer).

import type { SiteKind } from '../core/economy';

export interface TradeLayer {
  sites: { x: number; y: number; kind: SiteKind; manual: boolean }[];
  /** `path`: the way it goes in world cells (round bays, along rivers, round headlands); absent = straight. */
  movements: { fromX: number; fromY: number; toX: number; toY: number; bySea: boolean; path?: { x: number; y: number }[] }[];
}

export const SITE_COLORS: Record<SiteKind, string> = {
  farm: '#c9a227', fishery: '#2f7fb8', pasture: '#6fa84a', camp: '#2f6b3a',
  quarry: '#8c8c8c', mine: '#5a4a6e', saltworks: '#e8e4da',
};

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draw the layer. `x0` is the screen x of world column 0 and `k` pixels per
 * cell; `sy` maps rows. Every mark is drawn once per world copy that can show.
 */
export function drawTradeLayer(ctx: Ctx, layer: TradeLayer, x0: number, sy: (wy: number) => number, k: number, worldWidth: number): void {
  const span = worldWidth * k, cw = ctx.canvas.width, ch = ctx.canvas.height;
  const offsets = [-span, 0, span];
  ctx.save();
  ctx.lineCap = 'round';
  for (const m of layer.movements) {
    // The way it goes, unwrapped from its start: the short way round, never across the whole sheet.
    const way = unwrapWay(m, worldWidth);
    for (const off of offsets) {
      const pts = way.map((p) => [x0 + (p.x + 0.5) * k + off, sy(p.y + 0.5)] as const);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      if (maxX < -20 || minX > cw + 20 || maxY < -20 || minY > ch + 20) continue;
      strokeShipment(ctx, pts, m.bySea);
    }
  }
  const r = Math.max(3, Math.min(6, k * 0.45));
  for (const site of layer.sites) {
    for (const off of offsets) {
      const x = x0 + (site.x + 0.5) * k + off, y = sy(site.y + 0.5);
      if (x < -10 || x > cw + 10 || y < -10 || y > ch + 10) continue;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      ctx.fillStyle = SITE_COLORS[site.kind] ?? '#888';
      ctx.fill();
      ctx.lineWidth = site.manual ? 2 : 1;
      ctx.strokeStyle = site.manual ? '#ffd27a' : 'rgba(20,16,10,0.85)';
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A shipment's points in world cells, unwrapped from its start so it never jumps the seam. */
export function unwrapWay(m: TradeLayer['movements'][number], worldWidth: number): { x: number; y: number }[] {
  const raw = m.path && m.path.length >= 2 ? m.path : [{ x: m.fromX, y: m.fromY }, { x: m.toX, y: m.toY }];
  const out: { x: number; y: number }[] = [];
  let prev = raw[0].x;
  for (const p of raw) {
    let x = p.x;
    while (x - prev > worldWidth / 2) x -= worldWidth;
    while (x - prev < -worldWidth / 2) x += worldWidth;
    out.push({ x, y: p.y });
    prev = x;
  }
  return out;
}

/** The dashed line of a shipment with its arrowhead at the buyer, in screen points. */
export function strokeShipment(ctx: Ctx, pts: ReadonlyArray<readonly [number, number]>, bySea: boolean, arrow = true): void {
  if (pts.length < 2) return;
  ctx.strokeStyle = bySea ? 'rgba(40,110,190,0.85)' : 'rgba(120,70,30,0.85)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!arrow) return;
  const [bx, by] = pts[pts.length - 1];
  // The arrow points along the last leg long enough to have a direction.
  let j = pts.length - 2;
  while (j > 0 && Math.hypot(bx - pts[j][0], by - pts[j][1]) < 6) j--;
  const a = Math.atan2(by - pts[j][1], bx - pts[j][0]);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - 9 * Math.cos(a - 0.4), by - 9 * Math.sin(a - 0.4));
  ctx.lineTo(bx - 9 * Math.cos(a + 0.4), by - 9 * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
}

/**
 * The lens on a curved projection (azimuthal, Mollweide, Winkel), where a
 * point's screen x depends on its latitude too: every point goes through the
 * projection. `toScreen` returns null for a point the projection does not show.
 */
export function drawTradeLayerProjected(
  ctx: Ctx, layer: TradeLayer, toScreen: (wx: number, wy: number) => [number, number] | null, k: number, worldWidth: number,
): void {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.save();
  ctx.lineCap = 'round';
  for (const m of layer.movements) {
    // Densified so a long leg bends with the projection instead of cutting the curve.
    const way = unwrapWay(m, worldWidth);
    const dense: { x: number; y: number }[] = [];
    for (let i = 0; i < way.length; i++) {
      if (i > 0) {
        const a = way[i - 1], b = way[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
        for (let s = 1; s < n; s++) dense.push({ x: a.x + (b.x - a.x) * s / n, y: a.y + (b.y - a.y) * s / n });
      }
      dense.push(way[i]);
    }
    // Split where the projection loses a point or jumps (an interruption or the back of the globe).
    let run: Array<readonly [number, number]> = [];
    const flush = (last: boolean) => { if (run.length >= 2) strokeShipment(ctx, run, m.bySea, last); run = []; };
    for (const p of dense) {
      const s = toScreen(((p.x % worldWidth) + worldWidth) % worldWidth + 0.5, p.y + 0.5);
      if (!s) { flush(false); continue; }
      const prev = run[run.length - 1];
      if (prev && Math.hypot(s[0] - prev[0], s[1] - prev[1]) > Math.max(cw, ch) * 0.25) flush(false);
      run.push(s);
    }
    flush(true);
  }
  const r = Math.max(3, Math.min(6, k * 0.45));
  for (const site of layer.sites) {
    const s = toScreen(site.x + 0.5, site.y + 0.5);
    if (!s) continue;
    const [x, y] = s;
    if (x < -10 || x > cw + 10 || y < -10 || y > ch + 10) continue;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    ctx.fillStyle = SITE_COLORS[site.kind] ?? '#888';
    ctx.fill();
    ctx.lineWidth = site.manual ? 2 : 1;
    ctx.strokeStyle = site.manual ? '#ffd27a' : 'rgba(20,16,10,0.85)';
    ctx.stroke();
  }
  ctx.restore();
}
