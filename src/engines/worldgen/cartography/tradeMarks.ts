// ============================================
// Cartography — the trade lens on a map
// ============================================
// Where goods are made (a small lozenge per site, coloured by kind; the
// author's own ringed) and what is moving this month (a dashed line per
// shipment, brown by road and blue by sea, with an arrowhead at the buyer).

import type { SiteKind } from '../core/economy';

export interface TradeLayer {
  sites: { x: number; y: number; kind: SiteKind; manual: boolean }[];
  movements: { fromX: number; fromY: number; toX: number; toY: number; bySea: boolean }[];
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
    // The short way round: a shipment never crosses the whole sheet.
    let dx = m.toX - m.fromX;
    if (dx > worldWidth / 2) dx -= worldWidth;
    if (dx < -worldWidth / 2) dx += worldWidth;
    for (const off of offsets) {
      const ax = x0 + (m.fromX + 0.5) * k + off, ay = sy(m.fromY + 0.5);
      const bx = ax + dx * k, by = sy(m.fromY + 0.5 + (m.toY - m.fromY));
      if (Math.max(ax, bx) < -20 || Math.min(ax, bx) > cw + 20 || Math.max(ay, by) < -20 || Math.min(ay, by) > ch + 20) continue;
      ctx.strokeStyle = m.bySea ? 'rgba(40,110,190,0.85)' : 'rgba(120,70,30,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
      const a = Math.atan2(by - ay, bx - ax);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - 9 * Math.cos(a - 0.4), by - 9 * Math.sin(a - 0.4));
      ctx.lineTo(bx - 9 * Math.cos(a + 0.4), by - 9 * Math.sin(a + 0.4));
      ctx.closePath(); ctx.fill();
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
