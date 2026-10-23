// ============================================
// Cartography — the author's named zones
// ============================================
// A zone as a map draws a region it was asked to: an outline in its colour, a
// light wash or a hatching inside, and its name across the middle in spaced
// italic capitals. Shared by the atlas, the Carta and the exported pictures.

import { unwrapRing, zoneShape, type WorldZone } from '../core/zones';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Draw the zones with a linear world→screen map (`sx`, `sy`, cells to pixels),
 * once for each copy offset in `offsets` (whole world widths, for a wrapping map).
 * `k` is pixels per cell, which sizes the names.
 */
export function drawZones(ctx: Ctx, zones: readonly WorldZone[], W: number, sx: (wx: number) => number, sy: (wy: number) => number, k: number, offsets: readonly number[] = [0], selectedId: string | null = null): void {
  if (!zones.length) return;
  for (const zone of zones) {
    const ring = unwrapRing(zone.pts, W);
    if (ring.length < 3) continue;
    const shape = zoneShape(zone, W);
    const strength = zone.opacity ?? 1;
    for (const off of offsets) {
      ctx.save();
      ctx.beginPath();
      ring.forEach((p, i) => { const x = sx(p.x + off), y = sy(p.y); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      if (zone.pattern === 'wash') { ctx.fillStyle = rgba(zone.color, 0.2 * strength); ctx.fill(); }
      if (zone.pattern === 'hatch') {
        ctx.save();
        ctx.clip();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of ring) { const x = sx(p.x + off), y = sy(p.y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        // Only what the canvas shows: a large zone seen close would otherwise be tens of thousands of strokes.
        const cw = ctx.canvas.width, ch = ctx.canvas.height;
        minX = Math.max(minX, -ch - 8); maxX = Math.min(maxX, cw + 8); minY = Math.max(minY, -8); maxY = Math.min(maxY, ch + 8);
        if (minX < maxX && minY < maxY) {
          ctx.strokeStyle = rgba(zone.color, 0.5 * strength);
          ctx.lineWidth = 1;
          ctx.beginPath();
          // Lines x + y = c, every 7 px, anchored to the map's own origin: they
          // travel with the zone when it pans and never slide when the clip moves.
          const anchor = sx(off) + sy(0);
          for (let c = anchor + Math.floor((minX + minY - anchor) / 7) * 7; c < maxX + maxY; c += 7) { ctx.moveTo(c - maxY, maxY); ctx.lineTo(c - minY, minY); }
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.lineJoin = 'round';
      ctx.setLineDash(zone.pattern === 'outline' ? [] : [7, 4]);
      ctx.lineWidth = zone.id === selectedId ? 3.2 : 2;
      ctx.strokeStyle = rgba(zone.color, Math.min(1, 0.85 * strength + 0.15));
      ctx.stroke();
      ctx.setLineDash([]);
      // The name across the middle, sized by the zone and readable over any ground.
      const span = Math.sqrt(Math.max(1, shape.cells)) * k;
      const size = Math.max(10, Math.min(26, span / Math.max(4, zone.name.length * 0.62)));
      let cx = shape.cx;
      const mid = ring.reduce((s, p) => s + p.x, 0) / ring.length;
      while (cx - mid > W / 2) cx -= W;
      while (cx - mid < -W / 2) cx += W;
      const x = sx(cx + off), y = sy(shape.cy);
      ctx.font = `italic 600 ${Math.round(size)}px Georgia, "Times New Roman", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = zone.name.toUpperCase().split('').join(' ');
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(250,246,236,0.85)';
      ctx.strokeText(label, x, y);
      ctx.fillStyle = rgba(zone.color, 1);
      ctx.fillText(label, x, y);
      ctx.restore();
    }
  }
}
