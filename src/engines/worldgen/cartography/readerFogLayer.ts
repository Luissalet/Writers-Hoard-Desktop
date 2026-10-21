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

let projectedCache: { key: string; mask: Uint8Array; canvas: HTMLCanvasElement | OffscreenCanvas } | null = null;

/**
 * The fog for a projection that is not a simple grid of rows and columns
 * (Robinson, Mollweide, azimuthal). The sheet is sampled once per projection
 * and mask over the projection's own unit square, through its inverse, and
 * then laid over the map's rectangle on screen: panning and zooming only
 * move it. In the reader's view the paper also covers what lies outside the
 * projected world and outside the map's rectangle.
 */
export function drawReaderFogProjected(
  ctx: CanvasRenderingContext2D,
  layer: ReaderFogLayer,
  inverse: (X: number, Y: number) => [number, number] | null,
  key: string,
  rect: { x: number; y: number; w: number; h: number },
  viewport: { width: number; height: number },
): void {
  const w = Math.min(1024, Math.max(64, layer.width));
  const h = Math.max(32, Math.round(w * rect.h / Math.max(1, rect.w)));
  const fullKey = `${key}|${layer.mode}|${layer.paper ?? ''}|${w}x${h}`;
  let sheet = projectedCache && projectedCache.key === fullKey && projectedCache.mask === layer.mask ? projectedCache.canvas : null;
  if (!sheet) {
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const sctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!sctx) return;
    const img = sctx.createImageData(w, h);
    const [pr, pg, pb] = layer.mode === 'reader' ? hexRgb(layer.paper ?? DEFAULT_PAPER) : [24, 26, 38];
    const hiddenA = layer.mode === 'reader' ? 255 : 120, heardA = layer.mode === 'reader' ? 165 : 52;
    const W = layer.width, H = layer.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const uv = inverse((x + 0.5) / w, (y + 0.5) / h);
        let alpha: number;
        if (!uv) alpha = layer.mode === 'reader' ? 255 : 0;
        else {
          const cx = ((Math.floor(uv[0] * W) % W) + W) % W, cy = Math.min(H - 1, Math.max(0, Math.floor(uv[1] * H)));
          const v = layer.mask[cy * W + cx];
          alpha = v === FOG_HIDDEN ? hiddenA : v === FOG_HEARD ? heardA : 0;
        }
        if (!alpha) continue;
        const o = (y * w + x) * 4;
        img.data[o] = pr; img.data[o + 1] = pg; img.data[o + 2] = pb; img.data[o + 3] = alpha;
      }
    }
    sctx.putImageData(img, 0, 0);
    projectedCache = { key: fullKey, mask: layer.mask, canvas };
    sheet = canvas;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sheet, 0, 0, w, h, rect.x, rect.y, rect.w, rect.h);
  if (layer.mode === 'reader') {
    ctx.fillStyle = layer.paper ?? DEFAULT_PAPER;
    const { width: vw, height: vh } = viewport;
    if (rect.y > 0) ctx.fillRect(0, 0, vw, rect.y);
    if (rect.y + rect.h < vh) ctx.fillRect(0, rect.y + rect.h, vw, vh - rect.y - rect.h);
    if (rect.x > 0) ctx.fillRect(0, rect.y, rect.x, rect.h);
    if (rect.x + rect.w < vw) ctx.fillRect(rect.x + rect.w, rect.y, vw - rect.x - rect.w, rect.h);
  }
  ctx.restore();
}
