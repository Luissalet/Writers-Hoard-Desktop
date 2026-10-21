/**
 * A play grid laid over the map: squares or hexes of a size in kilometres, as
 * tabletop and wargame maps use. It is drawn in map space at the equator's
 * scale, so it stays square on the equirectangular sheet and lines up with the
 * scale bar there; it is a counting aid, not a projection.
 */
import type { Ctx } from './symbols';

export type MapGridKind = 'square' | 'hex';
export interface MapGrid { kind: MapGridKind; km: number }
export const MAP_GRID_KM = { min: 1, max: 2000 } as const;

/** Validates a grid; null turns it off. Throws with the expected shape. */
export function normalizeMapGrid(input: unknown): MapGrid | null {
  if (input === null) return null;
  if (!input || typeof input !== 'object') throw new Error('grid must be { kind: "square" | "hex", km } or null.');
  const raw = input as Record<string, unknown>;
  if (raw.kind !== 'square' && raw.kind !== 'hex') throw new Error('grid.kind must be "square" or "hex".');
  const km = raw.km;
  if (typeof km !== 'number' || !Number.isFinite(km) || km < MAP_GRID_KM.min || km > MAP_GRID_KM.max) throw new Error(`grid.km must be a number from ${MAP_GRID_KM.min} to ${MAP_GRID_KM.max}.`);
  return { kind: raw.kind, km: Math.round(km * 100) / 100 };
}

/**
 * Draw the grid over the visible part of the sheet.
 *
 * `cellPx` is the size of one world cell on screen and `originX/originY` the
 * screen position of world cell (0,0); `kmPerCell` is the equator's
 * kilometres per world cell. Cells smaller than 6 px are skipped: a grid
 * finer than that is a grey wash, not a grid.
 */
export function drawMapGrid(ctx: Ctx, grid: MapGrid, opts: { width: number; height: number; cellPx: number; originX: number; originY: number; kmPerCell: number; color?: string; alpha?: number }): boolean {
  const size = (grid.km / opts.kmPerCell) * opts.cellPx;
  if (!(size >= 6)) return false;
  ctx.save();
  ctx.strokeStyle = opts.color ?? 'rgba(20,16,10,0.9)';
  ctx.globalAlpha = opts.alpha ?? 0.32;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (grid.kind === 'square') {
    const x0 = opts.originX + Math.floor((0 - opts.originX) / size) * size;
    const y0 = opts.originY + Math.floor((0 - opts.originY) / size) * size;
    for (let x = x0; x <= opts.width; x += size) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, opts.height); }
    for (let y = y0; y <= opts.height; y += size) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(opts.width, Math.round(y) + 0.5); }
  } else {
    // Flat-topped hexes `size` across flats: columns 1.5 r apart, rows √3 r apart.
    const r = size / Math.sqrt(3), colW = 1.5 * r, rowH = size;
    const c0 = Math.floor((0 - opts.originX) / colW) - 1, c1 = Math.ceil((opts.width - opts.originX) / colW) + 1;
    const r0 = Math.floor((0 - opts.originY) / rowH) - 1, r1 = Math.ceil((opts.height - opts.originY) / rowH) + 1;
    for (let c = c0; c <= c1; c++) {
      const cx = opts.originX + c * colW;
      for (let row = r0; row <= r1; row++) {
        const cy = opts.originY + row * rowH + (((c % 2) + 2) % 2 ? rowH / 2 : 0);
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k;
          const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
    }
  }
  ctx.stroke();
  ctx.restore();
  return true;
}
