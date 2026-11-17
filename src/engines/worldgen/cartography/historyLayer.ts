// ============================================
// Cartography — the history lens on a map
// ============================================
// The realms of one year: a wash of each realm's colour over the land it
// held, a darker line where two holds meet, and the realm's name over the
// place it held that weighed most.

import type { TerritoryRaster } from '../history/territory';

export interface HistoryLayer {
  raster: TerritoryRaster;
  /** Hue per entry of `raster.polities`. */
  hues: number[];
  /** Name per entry of `raster.polities`. */
  names: string[];
  /** Highlighted realm, drawn stronger. */
  focus?: string;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const images = new WeakMap<HistoryLayer, HTMLCanvasElement | OffscreenCanvas>();

function hslBytes(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** One pixel per grid cell, painted once per layer. */
function imageOf(layer: HistoryLayer): HTMLCanvasElement | OffscreenCanvas {
  const cached = images.get(layer);
  if (cached) return cached;
  const { gw, gh, owner, polities } = layer.raster;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(gw, gh) : Object.assign(document.createElement('canvas'), { width: gw, height: gh });
  const ctx = canvas.getContext('2d') as Ctx;
  const img = ctx.createImageData(gw, gh);
  const colours = polities.map((key, i) => hslBytes(layer.hues[i] ?? 0, 0.6, key === layer.focus ? 0.42 : 0.5));
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const g = gy * gw + gx, o = owner[g];
      if (o < 0) continue;
      const edge = (gx > 0 && owner[g - 1] !== o) || (gx < gw - 1 && owner[g + 1] !== o) || (gy > 0 && owner[g - gw] !== o) || (gy < gh - 1 && owner[g + gw] !== o);
      const [r, gr, b] = colours[o];
      const p = g * 4;
      img.data[p] = edge ? r * 0.55 : r;
      img.data[p + 1] = edge ? gr * 0.55 : gr;
      img.data[p + 2] = edge ? b * 0.55 : b;
      img.data[p + 3] = edge ? 200 : polities[o] === layer.focus ? 130 : 88;
    }
  }
  ctx.putImageData(img, 0, 0);
  images.set(layer, canvas);
  return canvas;
}

/**
 * Draw the layer on a cylindrical sheet. `x0` is the screen x of world column
 * 0, `k` pixels per cell; `sy` maps rows. Drawn once per world copy that can show.
 */
export function drawHistoryLayer(ctx: Ctx, layer: HistoryLayer, x0: number, sy: (wy: number) => number, k: number, worldWidth: number, wrap = true): void {
  const { raster } = layer;
  const image = imageOf(layer);
  const span = worldWidth * k;
  const top = sy(0), bottom = sy(raster.gh * raster.cell);
  const w = raster.gw * raster.cell * k;
  ctx.save();
  ctx.imageSmoothingEnabled = k * raster.cell > 6;
  for (const off of wrap ? [-span, 0, span] : [0]) {
    if (x0 + off > ctx.canvas.width || x0 + off + w < 0) continue;
    ctx.drawImage(image as CanvasImageSource, x0 + off, top, w, bottom - top);
  }
  // Names over the place each realm held that weighed most.
  const size = Math.max(10, Math.min(16, k * 3));
  ctx.font = `600 ${size}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  raster.polities.forEach((key, i) => {
    const at = raster.labels.find((l) => l.polity === key);
    if (!at) return;
    for (const off of wrap ? [-span, 0, span] : [0]) {
      const x = x0 + off + (at.x + 0.5) * k, y = sy(at.y + 0.5) - size;
      if (x < -200 || x > ctx.canvas.width + 200 || y < -20 || y > ctx.canvas.height + 20) continue;
      const [r, g, b] = hslBytes(layer.hues[i] ?? 0, 0.65, 0.28);
      ctx.strokeText(layer.names[i] ?? key, x, y);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillText(layer.names[i] ?? key, x, y);
    }
  });
  ctx.restore();
}
