// ============================================
// Cartography — the reader's-eye fog, on paper
// ============================================
// What the story has not shown yet is blank paper; what it has only mentioned
// is a faint sketch under a wash; what it has shown is the map. The mask comes
// from `core/readerFog`; this file only puts it on a canvas, for every view
// that draws a flat map (atlas, Carta, exports).

import { FOG_HEARD, FOG_HIDDEN } from '../core/readerFog';

export interface ReaderFogLayer {
  /** One byte per world cell: 0 hidden, 1 heard of, 2 seen. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** 'reader' draws the paper; 'author' only tints, so the author can still see what is under it. */
  mode: 'reader' | 'author';
  /** The paper colour for the reader's view. */
  paper?: string;
}

/** The reader's blank paper. */
export const READER_PAPER = '#ece3c8';
const DEFAULT_PAPER = READER_PAPER;
const CACHE = new WeakMap<Uint8Array, { key: string; canvas: HTMLCanvasElement | OffscreenCanvas }>();

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0xece3c8;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function fogCanvas(layer: ReaderFogLayer): HTMLCanvasElement | OffscreenCanvas | null {
  const { mask, width: W, height: H, mode } = layer;
  if (mask.length !== W * H || W < 1 || H < 1) return null;
  const paper = layer.paper ?? DEFAULT_PAPER;
  const key = `${mode}|${paper}|${W}x${H}`;
  const hit = CACHE.get(mask);
  if (hit && hit.key === key) return hit.canvas;
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(W, H)
    : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  const [pr, pg, pb] = mode === 'reader' ? hexRgb(paper) : [24, 26, 38];
  const hiddenA = mode === 'reader' ? 255 : 120;
  const heardA = mode === 'reader' ? 165 : 52;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    if (v !== FOG_HIDDEN && v !== FOG_HEARD) continue;
    const o = i * 4;
    img.data[o] = pr; img.data[o + 1] = pg; img.data[o + 2] = pb;
    img.data[o + 3] = v === FOG_HIDDEN ? hiddenA : heardA;
  }
  ctx.putImageData(img, 0, 0);
  CACHE.set(mask, { key, canvas });
  return canvas;
}

/**
 * Draw the fog for one copy of the world. `sx`/`sy` map world cells to screen
 * pixels (any projection whose x depends only on longitude and y only on
 * latitude); the sheet is drawn in horizontal bands so a stretched latitude
 * scale (Mercator) still lines up. `copies` repeats it one world-width either
 * side, for callers that do not wrap the map themselves.
 */
export function drawReaderFog(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layer: ReaderFogLayer,
  sx: (wx: number) => number,
  sy: (wy: number) => number,
  copies = false,
): boolean {
  const sheet = fogCanvas(layer);
  if (!sheet) return false;
  const W = layer.width, H = layer.height;
  const x0 = sx(0), span = sx(W) - x0;
  if (!(span > 0)) return false;
  const offsets = copies ? [-span, 0, span] : [0];
  // A linear latitude scale draws in one piece (no band seams); a stretched one in bands.
  const linear = Math.abs(sy(H / 2) - (sy(0) + sy(H)) / 2) < 0.5;
  const band = linear ? H : Math.max(1, Math.ceil(H / 128));
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const off of offsets) {
    const left = x0 + off;
    if (left > cw || left + span < 0) continue;
    for (let y = 0; y < H; y += band) {
      const h = Math.min(band, H - y);
      const top = sy(y), bottom = sy(y + h);
      if (bottom < 0 || top > ch) continue;
      ctx.drawImage(sheet, 0, y, W, h, left, top, span, Math.max(0.5, bottom - top));
    }
  }
  ctx.restore();
  return true;
}

/** Whether the world cell under a point is blank paper for the reader. */
export function fogHides(layer: ReaderFogLayer | null | undefined, wx: number, wy: number): boolean {
  if (!layer || layer.mode !== 'reader') return false;
  const W = layer.width, H = layer.height;
  const x = ((Math.floor(wx) % W) + W) % W, y = Math.floor(wy);
  if (y < 0 || y >= H) return false;
  return layer.mask[y * W + x] === FOG_HIDDEN;
}
