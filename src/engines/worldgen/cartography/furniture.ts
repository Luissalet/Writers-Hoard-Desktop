// ============================================
// Cartography — Map furniture
// ============================================
// Compass rose, scale bar, graticule, decorative border and title cartouche.
// These carry no information the map body doesn't already have, which is
// exactly why they matter: they are the signals that say "this is a map" before
// the reader has parsed a single coastline.

import { createRng, type Rng } from '../core/rng';
import type { CartoTheme } from './theme';
import type { Ctx } from './symbols';
import type { CartoView } from './render';

export interface FurnitureOptions {
  theme: CartoTheme;
  width: number;
  height: number;
  view: CartoView;
  scale: number;
  /** Planet radius in km, for an honest scale bar. */
  planetRadiusKm?: number;
  worldWidth: number;
  title?: string;
  subtitle?: string;
  seed: string;
}

/**
 * Eight-point compass rose: four long cardinal points, four short ordinals,
 * each split into a lit and a shaded half so the star reads as an engraved
 * object rather than a flat icon.
 */
export function drawCompass(ctx: Ctx, cx: number, cy: number, r: number, theme: CartoTheme, rng: Rng): void {
  ctx.save();
  ctx.translate(cx, cy);
  const ink = theme.furniture.ink;
  const accent = theme.furniture.accent;

  // Outer rings and tick marks.
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(0.7, r * 0.022);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.4, r * 0.014);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const inner = i % 4 === 0 ? r * 0.78 : r * 0.83;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const point = (angle: number, len: number, halfWidth: number) => {
    const tipX = Math.cos(angle) * len, tipY = Math.sin(angle) * len;
    const lx = Math.cos(angle + Math.PI / 2) * halfWidth;
    const ly = Math.sin(angle + Math.PI / 2) * halfWidth;
    // Lit half.
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(lx, ly);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = theme.furniture.frameFill;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.5, r * 0.016);
    ctx.stroke();
    // Shaded half.
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(-lx, -ly);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.82;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  };

  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * Math.PI * 2 + Math.PI / 4;
    point(a, r * 0.52, r * 0.075);
  }
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * Math.PI * 2;
    point(a, r * 0.82, r * 0.1);
  }

  // North fleur: a slim spearhead over the north point.
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.02);
  ctx.lineTo(r * 0.09, -r * 0.72);
  ctx.lineTo(0, -r * 0.78);
  ctx.lineTo(-r * 0.09, -r * 0.72);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.max(6, r * 0.2)}px ${theme.type.display}`;
  const labels: [string, number][] = [['N', -Math.PI / 2], ['E', 0], ['S', Math.PI / 2], ['O', Math.PI]];
  for (const [ch, a] of labels) {
    ctx.fillText(ch, Math.cos(a) * r * 1.16, Math.sin(a) * r * 1.16);
  }
  void rng;
  ctx.restore();
}

/** Scale bar with alternating filled/empty blocks, rounded to a sane number. */
export function drawScaleBar(ctx: Ctx, x: number, y: number, opts: FurnitureOptions): void {
  const { theme, scale, worldWidth } = opts;
  const radiusKm = opts.planetRadiusKm ?? 6371;
  // One grid cell spans (2πR / worldWidth) km at the equator.
  const kmPerCell = (2 * Math.PI * radiusKm) / worldWidth;
  const kmPerPx = kmPerCell / scale;

  const targetPx = Math.min(240, Math.max(110, opts.width * 0.16));
  const rawKm = targetPx * kmPerPx;
  const mag = Math.pow(10, Math.floor(Math.log10(rawKm)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag).reduce((best, v) =>
    Math.abs(v - rawKm) < Math.abs(best - rawKm) ? v : best, mag);
  const barPx = nice / kmPerPx;
  const blocks = 4;

  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = theme.furniture.ink;
  ctx.lineWidth = 1;
  const h = Math.max(5, opts.height * 0.009);
  for (let i = 0; i < blocks; i++) {
    ctx.fillStyle = i % 2 ? theme.furniture.frameFill : theme.furniture.ink;
    ctx.fillRect((i * barPx) / blocks, 0, barPx / blocks, h);
    ctx.strokeRect((i * barPx) / blocks, 0, barPx / blocks, h);
  }
  ctx.fillStyle = theme.furniture.ink;
  ctx.textBaseline = 'top';
  ctx.font = `400 ${Math.max(7, h * 1.5)}px ${theme.type.body}`;
  ctx.textAlign = 'left';
  ctx.fillText('0', 0, h + 3);
  ctx.textAlign = 'right';
  ctx.fillText(`${nice >= 1 ? Math.round(nice) : nice} km`, barPx, h + 3);
  ctx.restore();
}

/** Lat/long graticule with edge ticks. */
export function drawGraticule(ctx: Ctx, opts: FurnitureOptions): void {
  const { theme, view, scale, width, height, worldWidth } = opts;
  const worldHeight = worldWidth / 2;
  ctx.save();
  ctx.strokeStyle = theme.furniture.ink;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 0.7;
  ctx.setLineDash([3, 4]);
  const stepDeg = view.w / worldWidth > 0.5 ? 30 : view.w / worldWidth > 0.2 ? 15 : 5;
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    const wx = ((lon + 180) / 360) * worldWidth;
    const sx = (wx - view.x) * scale;
    if (sx < 0 || sx > width) continue;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();
  }
  for (let lat = -90; lat <= 90; lat += stepDeg) {
    const wy = ((90 - lat) / 180) * worldHeight;
    const sy = (wy - view.y) * scale;
    if (sy < 0 || sy > height) continue;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** Decorative double border with corner blocks. */
export function drawFrame(ctx: Ctx, opts: FurnitureOptions): void {
  const { theme, width: W, height: H } = opts;
  const m = Math.max(9, Math.min(W, H) * 0.022);
  ctx.save();
  ctx.strokeStyle = theme.furniture.frame;
  ctx.lineWidth = Math.max(1.4, m * 0.16);
  ctx.strokeRect(m * 0.55, m * 0.55, W - m * 1.1, H - m * 1.1);
  ctx.lineWidth = Math.max(0.7, m * 0.07);
  ctx.strokeRect(m * 1.15, m * 1.15, W - m * 2.3, H - m * 2.3);

  // Corner blocks tie the two rules together.
  ctx.fillStyle = theme.furniture.frame;
  const c = m * 0.5;
  for (const [cx, cy] of [[m * 0.55, m * 0.55], [W - m * 0.55, m * 0.55], [m * 0.55, H - m * 0.55], [W - m * 0.55, H - m * 0.55]]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-c / 2, -c / 2, c, c);
    ctx.restore();
  }
  ctx.restore();
}

/** Title cartouche: a bordered plate with the world's name. */
export function drawCartouche(ctx: Ctx, x: number, y: number, opts: FurnitureOptions): void {
  if (!opts.title) return;
  const { theme } = opts;
  const size = Math.max(13, Math.min(46, opts.width * 0.028));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${size}px ${theme.type.display}`;
  const tw = ctx.measureText(opts.title.toUpperCase()).width + size * 0.4 * (opts.title.length - 1);
  const subSize = size * 0.42;
  ctx.font = `italic 400 ${subSize}px ${theme.type.body}`;
  const sw = opts.subtitle ? ctx.measureText(opts.subtitle).width : 0;
  const boxW = Math.max(tw, sw) + size * 1.9;
  const boxH = size * (opts.subtitle ? 2.9 : 2.1);

  ctx.translate(x, y);
  ctx.fillStyle = theme.furniture.frameFill;
  ctx.globalAlpha = 0.9;
  roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, size * 0.28);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.furniture.frame;
  ctx.lineWidth = Math.max(1.1, size * 0.07);
  roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, size * 0.28);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.6, size * 0.03);
  roundRect(ctx, -boxW / 2 + size * 0.28, -boxH / 2 + size * 0.28, boxW - size * 0.56, boxH - size * 0.56, size * 0.18);
  ctx.stroke();

  ctx.fillStyle = theme.type.color;
  ctx.font = `600 ${size}px ${theme.type.display}`;
  const title = opts.title.toUpperCase();
  const tracking = size * 0.4;
  let cursor = -(ctx.measureText(title).width + tracking * (title.length - 1)) / 2;
  const yText = opts.subtitle ? -boxH * 0.12 : 0;
  for (const ch of title) {
    const w = ctx.measureText(ch).width;
    ctx.fillText(ch, cursor + w / 2, yText);
    cursor += w + tracking;
  }
  if (opts.subtitle) {
    ctx.font = `italic 400 ${subSize}px ${theme.type.body}`;
    ctx.fillText(opts.subtitle, 0, boxH * 0.26);
  }
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Place all enabled furniture in the conventional corners. */
export function drawFurniture(
  ctx: Ctx,
  opts: FurnitureOptions,
  enabled: { frame: boolean; compass: boolean; scaleBar: boolean; graticule: boolean; cartouche?: boolean },
): void {
  const rng = createRng(opts.seed, 'furniture');
  if (enabled.graticule) drawGraticule(ctx, opts);
  if (enabled.frame) drawFrame(ctx, opts);
  const m = Math.max(9, Math.min(opts.width, opts.height) * 0.022);
  if (enabled.compass) {
    const r = Math.max(20, Math.min(opts.width, opts.height) * 0.055);
    drawCompass(ctx, opts.width - m * 2.4 - r * 1.25, opts.height - m * 2.4 - r * 1.25, r, opts.theme, rng);
  }
  if (enabled.scaleBar) {
    drawScaleBar(ctx, m * 2.4, opts.height - m * 2.4 - Math.max(5, opts.height * 0.009) - 12, opts);
  }
  if (enabled.cartouche !== false && opts.title) {
    drawCartouche(ctx, opts.width * 0.5, m * 2.6 + opts.height * 0.035, opts);
  }
}
