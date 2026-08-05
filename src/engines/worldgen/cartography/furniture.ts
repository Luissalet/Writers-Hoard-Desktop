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
  /**
   * Los cuatro puntos cardinales, en el orden N, E, S, O.
   *
   * Vienen por opciones como el título y por la misma razón: "N/E/S/O" es
   * castellano, y un mapa en inglés pide "N/E/S/W". El literal de reserva sólo
   * existe para que un llamante viejo no dibuje una rosa muda.
   */
  cardinals?: [string, string, string, string];
  /** Unidad de la barra de escala (km, leguas, millas del reino…). */
  distanceUnit?: string;
  seed: string;
}

/**
 * Eight-point compass rose: four long cardinal points, four short ordinals,
 * each split into a lit and a shaded half so the star reads as an engraved
 * object rather than a flat icon.
 */
export function drawCompass(
  ctx: Ctx, cx: number, cy: number, r: number, theme: CartoTheme, rng: Rng,
  cardinals: [string, string, string, string] = ['N', 'E', 'S', 'O'],
): void {
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
  const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  for (let i = 0; i < 4; i++) {
    ctx.fillText(cardinals[i], Math.cos(angles[i]) * r * 1.16, Math.sin(angles[i]) * r * 1.16);
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
  ctx.fillText(`${nice >= 1 ? Math.round(nice) : nice} ${opts.distanceUnit ?? 'km'}`, barPx, h + 3);
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

/**
 * Marco graduado: dos filetes y, entre ellos, la cenefa de damero de los atlas
 * grabados.
 *
 * La cenefa no es adorno: es el borde GRADUADO, y es la señal más barata de que
 * el papel es una hoja publicada y no una captura de pantalla. Los dientes se
 * cuadran para que las cuatro esquinas caigan en cambio de color — un damero que
 * llega a la esquina con dos blancos seguidos delata el rectángulo.
 */
export function drawFrame(ctx: Ctx, opts: FurnitureOptions): void {
  const { theme, width: W, height: H } = opts;
  const m = Math.max(9, Math.min(W, H) * 0.022);
  ctx.save();

  // El MARGEN es opaco. Un damero calado sobre el mar deja ver el agua por los
  // huecos y delata que el borde está pintado encima del mapa en vez de ser el
  // canto de la hoja; con el margen relleno, el pliego tiene canto.
  ctx.fillStyle = theme.furniture.frameFill;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(m * 1.15, m * 1.15, W - m * 2.3, H - m * 2.3);
  ctx.fill('evenodd');

  ctx.strokeStyle = theme.furniture.frame;
  ctx.lineWidth = Math.max(1.4, m * 0.16);
  ctx.strokeRect(m * 0.55, m * 0.55, W - m * 1.1, H - m * 1.1);

  const teeth = theme.furniture.teeth;
  const bandOuter = m * 0.66, bandInner = m * 1.06;
  const band = bandInner - bandOuter;
  if (teeth > 0 && band > 1.5) {
    const x0 = bandOuter, y0 = bandOuter;
    const x1 = W - bandOuter, y1 = H - bandOuter;
    const innerW = x1 - x0 - band * 2, innerH = y1 - y0 - band * 2;
    // Un paso común a los dos lados: si cada lado eligiera el suyo, la cenefa
    // cambiaría de ritmo en cada esquina.
    const nx = Math.max(2, Math.round((innerW / (innerW + innerH)) * teeth));
    const ny = Math.max(2, Math.round((innerH / (innerW + innerH)) * teeth));
    const sx = innerW / nx, sy = innerH / ny;
    ctx.fillStyle = theme.furniture.frame;
    const cell = (x: number, y: number, w: number, h: number, on: boolean) => {
      if (!on) return;
      ctx.fillRect(x, y, w, h);
    };
    for (let i = 0; i < nx; i++) {
      const on = i % 2 === 0;
      cell(x0 + band + i * sx, y0, sx, band, on);
      cell(x0 + band + i * sx, y1 - band, sx, band, on);
    }
    for (let j = 0; j < ny; j++) {
      const on = j % 2 === 0;
      cell(x0, y0 + band + j * sy, band, sy, on);
      cell(x1 - band, y0 + band + j * sy, band, sy, on);
    }
    // Las cuatro esquinas, siempre entintadas: cierran el damero.
    for (const [cx, cy] of [[x0, y0], [x1 - band, y0], [x0, y1 - band], [x1 - band, y1 - band]]) {
      ctx.fillRect(cx, cy, band, band);
    }
  }

  ctx.lineWidth = Math.max(0.7, m * 0.07);
  ctx.strokeRect(m * 1.15, m * 1.15, W - m * 2.3, H - m * 2.3);
  // Un tercer filete fino por dentro: el aire entre reglas es lo que hace que un
  // borde se lea como marco y no como recuadro de tabla.
  ctx.lineWidth = Math.max(0.5, m * 0.045);
  ctx.strokeRect(m * 1.55, m * 1.55, W - m * 3.1, H - m * 3.1);

  // Corner blocks tie the two rules together.
  ctx.fillStyle = theme.furniture.frame;
  const c = m * 0.5;
  for (const [cx, cy] of [[m * 0.55, m * 0.55], [W - m * 0.55, m * 0.55], [m * 0.55, H - m * 0.55], [W - m * 0.55, H - m * 0.55]]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-c / 2, -c / 2, c, c);
    if (theme.furniture.flourish) {
      // Voluta: cuatro pétalos en las diagonales, del tamaño del bloque.
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const px = Math.cos(a) * c * 0.92, py = Math.sin(a) * c * 0.92;
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(px * 0.5 - py * 0.42, py * 0.5 + px * 0.42, px, py);
        ctx.quadraticCurveTo(px * 0.5 + py * 0.42, py * 0.5 - px * 0.42, 0, 0);
      }
      ctx.fill();
    }
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
  const boxW = Math.max(tw, sw) + size * 2.4;
  const boxH = size * (opts.subtitle ? 3.2 : 2.1);

  ctx.translate(x, y);
  // Placa con las esquinas MATADAS, no redondeadas: un rectángulo de esquinas
  // suaves se lee como un cuadro de diálogo; el bisel a 45° se lee como una
  // cartela grabada, y cuesta lo mismo.
  const bev = size * 0.5;
  const plate = () => {
    ctx.beginPath();
    ctx.moveTo(-boxW / 2 + bev, -boxH / 2);
    ctx.lineTo(boxW / 2 - bev, -boxH / 2);
    ctx.lineTo(boxW / 2, -boxH / 2 + bev);
    ctx.lineTo(boxW / 2, boxH / 2 - bev);
    ctx.lineTo(boxW / 2 - bev, boxH / 2);
    ctx.lineTo(-boxW / 2 + bev, boxH / 2);
    ctx.lineTo(-boxW / 2, boxH / 2 - bev);
    ctx.lineTo(-boxW / 2, -boxH / 2 + bev);
    ctx.closePath();
  };
  ctx.fillStyle = theme.furniture.frameFill;
  ctx.globalAlpha = 0.94;
  plate();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.furniture.frame;
  ctx.lineWidth = Math.max(1.1, size * 0.07);
  plate();
  ctx.stroke();
  ctx.lineWidth = Math.max(0.6, size * 0.03);
  roundRect(ctx, -boxW / 2 + size * 0.3, -boxH / 2 + size * 0.3, boxW - size * 0.6, boxH - size * 0.6, size * 0.1);
  ctx.stroke();

  // Filete con rombo entre el título y el subtítulo: el separador clásico de
  // una portada de atlas, y lo que impide que las dos líneas se lean como un
  // párrafo de dos renglones.
  if (opts.subtitle) {
    const ry = boxH * 0.06;
    const half = boxW * 0.3;
    ctx.strokeStyle = theme.furniture.accent;
    ctx.lineWidth = Math.max(0.6, size * 0.035);
    ctx.beginPath();
    ctx.moveTo(-half, ry);
    ctx.lineTo(-size * 0.34, ry);
    ctx.moveTo(size * 0.34, ry);
    ctx.lineTo(half, ry);
    ctx.stroke();
    ctx.fillStyle = theme.furniture.accent;
    ctx.beginPath();
    ctx.moveTo(0, ry - size * 0.16);
    ctx.lineTo(size * 0.2, ry);
    ctx.lineTo(0, ry + size * 0.16);
    ctx.lineTo(-size * 0.2, ry);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = theme.type.color;
  ctx.font = `600 ${size}px ${theme.type.display}`;
  const title = opts.title.toUpperCase();
  const tracking = size * 0.4;
  let cursor = -(ctx.measureText(title).width + tracking * (title.length - 1)) / 2;
  const yText = opts.subtitle ? -boxH * 0.16 : 0;
  for (const ch of title) {
    const w = ctx.measureText(ch).width;
    ctx.fillText(ch, cursor + w / 2, yText);
    cursor += w + tracking;
  }
  if (opts.subtitle) {
    ctx.font = `italic 400 ${subSize}px ${theme.type.body}`;
    ctx.fillText(opts.subtitle, 0, boxH * 0.28);
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
    drawCompass(ctx, opts.width - m * 2.4 - r * 1.25, opts.height - m * 2.4 - r * 1.25, r, opts.theme, rng, opts.cardinals);
  }
  if (enabled.scaleBar) {
    drawScaleBar(ctx, m * 2.4, opts.height - m * 2.4 - Math.max(5, opts.height * 0.009) - 12, opts);
  }
  if (enabled.cartouche !== false && opts.title) {
    drawCartouche(ctx, opts.width * 0.5, m * 2.6 + opts.height * 0.035, opts);
  }
}
