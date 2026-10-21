import type { WorldSpatialStyle } from '../core/spatialEntities';
import type { Ctx } from './symbols';

const HATCHES = new Map<string, CanvasPattern>();
/** Screen-space ink, anchored to the world by the caller's transform. */
export function realmFillStyle(ctx: Ctx, color: string, style: WorldSpatialStyle = {}): string | CanvasPattern {
  if (style.areaStyle !== 'hatch') return color;
  const hit = HATCHES.get(color); if (hit) return hit;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
  canvas.width = 8; canvas.height = 8;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!c) return color;
  c.strokeStyle = color; c.lineWidth = 1.2; c.beginPath();
  for (const x of [-8, 0, 8]) { c.moveTo(x, 8); c.lineTo(x + 8, 0); } c.stroke();
  const pattern = ctx.createPattern(canvas, 'repeat');
  if (!pattern) return color;
  if (HATCHES.size >= 64) HATCHES.clear(); HATCHES.set(color, pattern); return pattern;
}
