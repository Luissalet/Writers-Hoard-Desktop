// ============================================
// Cartography — The reader's marks on the map
// ============================================
// A planned route, the ancient coastline, the two ends of a journey, the places
// the manuscript points at. None of it belongs in the cartographic render: it
// changes for reasons the map does not, it must survive a sea-level slider being
// dragged without paying for a re-render of the sheet, and — the real reason —
// it is annotation, not cartography. A route drawn INTO the map would be a road.

import type { WorldData } from '../core/types';
import type { PaleoMap } from '../core/paleo';
import { marchingSquares, chaikin } from './contours';

export interface CartoAnnotations {
  /** A planned route, as world cell indices. */
  route?: { cells: number[]; color?: string; label?: string };
  /** Journey ends. */
  pins?: { x: number; y: number; label: string; kind: 'from' | 'to' | 'mark' }[];
  /** The world at another sea level: shelf, drowned coast, ice. */
  paleo?: PaleoMap;
  /** Places the manuscript points at, sized by how much it says about them. */
  linked?: { x: number; y: number; weight: number }[];
  /** The reader's saved regions: a window on the world with a name. Drawn as
   *  a surveyor's mark — wash, corner brackets, cartouche label — because a
   *  saved valley the carta cannot show is a bookmark in someone else's book. */
  regions?: {
    x: number; y: number; spanKm: number; aspect: number;
    title: string; active: boolean;
  }[];
}

type Ctx2D = CanvasRenderingContext2D;

/**
 * Draw the annotation layer.
 *
 * Order is deliberate and it is the order of a draughtsman adding to a finished
 * sheet: the wash that changes the ground first, then the line, then the marks
 * that sit on top of everything and must never be hidden.
 */
export function drawAnnotations(
  ctx: Ctx2D,
  ann: CartoAnnotations | undefined,
  world: WorldData,
  sx: (wx: number) => number,
  sy: (wy: number) => number,
  k: number,
): void {
  if (!ann) return;
  const W = world.width;

  // ---- the world at another sea level --------------------------------------
  if (ann.paleo) {
    const p = ann.paleo;
    // Drawn as a stipple of small squares on a coarse lattice rather than as a
    // per-pixel wash: at world zoom that is a few thousand rectangles instead of
    // a million pixel reads, and it reads as a hachure, which is how an atlas
    // marks "this was land" anyway.
    const step = Math.max(1, Math.round(1.6 / Math.max(0.08, k)));
    const cell = Math.max(1, k * step);
    ctx.save();
    for (let y = 0; y < world.height; y += step) {
      const py = sy(y);
      if (py < -cell || py > ctx.canvas.height + cell) continue;
      for (let x = 0; x < W; x += step) {
        const i = y * W + x;
        const px = sx(x);
        if (px < -cell || px > ctx.canvas.width + cell) continue;
        if (p.exposed[i]) {
          ctx.fillStyle = 'rgba(214,196,150,0.72)';
          ctx.fillRect(px, py, cell, cell);
        } else if (p.drowned[i]) {
          ctx.fillStyle = 'rgba(70,120,170,0.6)';
          ctx.fillRect(px, py, cell, cell);
        }
        if (p.land[i] && p.ice[i] > 0.35) {
          ctx.fillStyle = `rgba(238,246,250,${Math.min(0.8, (p.ice[i] - 0.3) * 1.2)})`;
          ctx.fillRect(px, py, cell, cell);
        }
      }
    }
    // The ancient coastline, as a LINE.
    //
    // The stipple says "this was dry"; only a line says where the shore WAS, and
    // the shore is the thing the reader came to see. Traced on the paleo land
    // mask at world resolution, which is exactly the resolution the fact has.
    const mask = new Float32Array(p.land.length);
    for (let i = 0; i < mask.length; i++) mask[i] = p.land[i];
    ctx.strokeStyle = 'rgba(90,60,30,0.9)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 4]);
    for (const c of marchingSquares(mask, world.width, world.height, 0.5, true)) {
      if (c.pts.length < 8) continue;
      const pts = chaikin(c.pts, c.closed, 1);
      ctx.beginPath();
      let prev = sx(pts[0].x);
      ctx.moveTo(prev, sy(pts[0].y));
      for (let q = 1; q < pts.length; q++) {
        const X = sx(pts[q].x), Y = sy(pts[q].y);
        if (Math.abs(X - prev) > ctx.canvas.width * 0.6) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
        prev = X;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Land bridges are the whole point of the view, so they get a ring and are
    // drawn at a fixed screen size — a bridge is a fact, not a feature that
    // should shrink out of existence when the reader zooms out.
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const b of p.bridges) {
      ctx.beginPath();
      ctx.arc(sx(b.x), sy(b.y), 11, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(140,29,29,0.95)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(sx(b.x), sy(b.y), 13.4, 0, Math.PI * 2);
      ctx.stroke();
      if (b.name) {
        const w = ctx.measureText(b.name).width;
        ctx.fillStyle = 'rgba(20,16,10,0.72)';
        ctx.fillRect(sx(b.x) + 16, sy(b.y) - 8, w + 8, 16);
        ctx.fillStyle = '#f2e2c4';
        ctx.fillText(b.name, sx(b.x) + 20, sy(b.y));
      }
    }
    ctx.restore();
  }

  // ---- places the manuscript talks about -----------------------------------
  if (ann.linked?.length) {
    ctx.save();
    for (const l of ann.linked) {
      const r = 5 + Math.min(14, Math.sqrt(l.weight) * 4.5);
      const g = ctx.createRadialGradient(sx(l.x), sy(l.y), 0, sx(l.x), sy(l.y), r);
      g.addColorStop(0, 'rgba(226,169,60,0.55)');
      g.addColorStop(1, 'rgba(226,169,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx(l.x), sy(l.y), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- the route -----------------------------------------------------------
  if (ann.route && ann.route.cells.length > 1) {
    const cells = ann.route.cells;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const trace = () => {
      ctx.beginPath();
      let prevX = sx(cells[0] % W);
      ctx.moveTo(prevX, sy((cells[0] / W) | 0));
      for (let i = 1; i < cells.length; i++) {
        const x = sx(cells[i] % W);
        const y = sy((cells[i] / W) | 0);
        // A route that runs over the seam must not draw a line back across the
        // whole world; lift the pen instead.
        if (Math.abs(x - prevX) > ctx.canvas.width * 0.6) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        prevX = x;
      }
    };
    trace();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 6;
    ctx.stroke();
    trace();
    ctx.strokeStyle = ann.route.color ?? '#a3261e';
    ctx.lineWidth = 2.6;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  // ---- the reader's saved regions ------------------------------------------
  if (ann.regions?.length) {
    const kx = sx(1) - sx(0);
    const ky = sy(1) - sy(0);
    ctx.save();
    ctx.font = '600 10px "Source Sans 3", system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    for (const rg of ann.regions) {
      const halfW = ((rg.spanKm / 40075) * W * kx) / 2;
      const halfH = (halfW / Math.max(0.25, rg.aspect)) * (ky / kx);
      const cx = sx(rg.x), cy = sy(rg.y);
      if (cx + halfW < -30 || cx - halfW > ctx.canvas.width + 30
        || cy + halfH < -20 || cy - halfH > ctx.canvas.height + 20) continue;
      const ink = rg.active ? 'rgba(140,90,20,0.95)' : 'rgba(90,60,30,0.7)';
      if (halfW < 4 || halfH < 4) {
        // Too small for a frame: a surveyor's lozenge, like the 2D's.
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy);
        ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 5, cy);
        ctx.closePath();
        ctx.stroke();
      } else {
        // The wash first — saved ground reads as GROUND, not as a box.
        ctx.fillStyle = rg.active ? 'rgba(198,148,55,0.08)' : 'rgba(90,60,30,0.05)';
        ctx.fillRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
        ctx.strokeStyle = ink;
        ctx.lineWidth = rg.active ? 1.6 : 1.1;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
        ctx.setLineDash([]);
        // Corner brackets, solid: the draughtsman's "this sheet exists".
        const arm = Math.min(14, Math.min(halfW, halfH) * 0.34);
        ctx.lineWidth = rg.active ? 2.2 : 1.6;
        ctx.beginPath();
        for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          const px = cx + dx * halfW, py = cy + dy * halfH;
          ctx.moveTo(px + (dx < 0 ? arm : -arm), py);
          ctx.lineTo(px, py);
          ctx.lineTo(px, py + (dy < 0 ? arm : -arm));
        }
        ctx.stroke();
      }
      if (rg.title) {
        const ty = Math.max(10, cy - halfH - 5);
        const w = ctx.measureText(rg.title).width;
        ctx.fillStyle = 'rgba(244,234,210,0.85)';
        ctx.fillRect(cx - w / 2 - 4, ty - 10, w + 8, 13);
        ctx.strokeStyle = 'rgba(90,60,30,0.5)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(cx - w / 2 - 4, ty - 10, w + 8, 13);
        ctx.fillStyle = rg.active ? '#7a5416' : '#5c4426';
        ctx.textAlign = 'center';
        ctx.fillText(rg.title, cx, ty);
        ctx.textAlign = 'start';
      }
    }
    ctx.restore();
  }

  // ---- pins ----------------------------------------------------------------
  for (const pin of ann.pins ?? []) {
    const x = sx(pin.x), y = sy(pin.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = pin.kind === 'from' ? '#1b5e20' : pin.kind === 'to' ? '#a3261e' : '#7a5c1e';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (pin.label) {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(pin.label).width;
      ctx.fillStyle = 'rgba(20,16,10,0.78)';
      ctx.fillRect(x + 10, y - 9, w + 10, 18);
      ctx.fillStyle = '#f4ead2';
      ctx.fillText(pin.label, x + 15, y);
    }
    ctx.restore();
  }
}
