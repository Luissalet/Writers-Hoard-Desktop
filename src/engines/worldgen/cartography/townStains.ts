// ============================================
// World Generator — la mancha urbana, como capa pura
// ============================================
// «Coloca las ciudades» (Luis, 2026-08-11): en el 3D las ciudades tienen que
// verse EN EL SUELO siempre, no sólo donde el canon está caliente. Esta capa
// dibuja la misma mancha parda que las teselas hondas (lóbulos solapados y un
// corazón denso) pero desde `geography.settlements`, en el hilo principal y a
// la resolución del lienzo que se le dé — así el relleno de la piel de cerca
// lleva pueblos aunque ninguna tesela haya llegado, y cuando las teselas
// llegan se posan ENCIMA con su propia mancha o sus tejados.
//
// Fuera de Map2D/World3D a propósito, como `roadOverlay`: un módulo puro se
// mide sin navegador (lección #21).

import type { Settlement } from '../core/settlements';

/** Radio de la mancha por rango, en METROS — la misma escala que usa
 *  `satelliteInk` para su dispersión de tejados (town 620 m). El rango manda:
 *  una capital ocupa más suelo que una aldea, cosa que las teselas todavía no
 *  distinguen. */
const STAIN_RADIUS_M: Record<string, number> = {
  capital: 820,
  city: 680,
  town: 480,
  village: 260,
};

/** Hash determinista barato sobre la celda del asentamiento: la misma mancha
 *  en cada fotograma, en cada composición y en cada sesión. */
function hash01(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 974634551) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface TownStainOptions {
  /** Rejilla del mundo, para envolver la costura. */
  worldWidth: number;
  worldHeight: number;
  /** Ventana en CELDAS de mundo (x puede ser negativo o pasar de W). */
  view: { x: number; y: number; w: number; h: number };
  /** Lienzo de salida, en píxeles. */
  width: number;
  height: number;
  /** Metros de suelo por celda de mundo (2πR/W · 1000). */
  metresPerCell: number;
}

/**
 * Dibuja la mancha de cada asentamiento visible. Devuelve cuántas se
 * dibujaron, que es lo que un banco puede comprobar.
 */
export function drawTownStains(
  ctx: CanvasRenderingContext2D,
  settlements: readonly Settlement[],
  opts: TownStainOptions,
): number {
  const { worldWidth: W, view, width, height, metresPerCell } = opts;
  const scale = width / view.w; // px por celda
  const metresPerPx = metresPerCell / scale;
  if (!(metresPerPx > 0)) return 0;
  let drawn = 0;
  ctx.save();
  for (const s of settlements) {
    const radiusM = STAIN_RADIUS_M[s.rank] ?? 260;
    const stainPx = radiusM / metresPerPx;
    // Por debajo de 2,5 px la mancha es un punto sucio; el mapa ya enseña su
    // punto y su nombre a esos encuadres.
    if (stainPx < 2.5) continue;
    // La rama envuelta más cercana a la ventana, como los caminos.
    let cx = s.x + 0.5;
    const mid = view.x + view.w / 2;
    while (cx - mid > W / 2) cx -= W;
    while (cx - mid < -W / 2) cx += W;
    const px = (cx - view.x) * scale;
    const py = (s.y + 0.5 - view.y) * scale;
    if (px < -stainPx * 2 || px > width + stainPx * 2) continue;
    if (py < -stainPx * 2 || py > height + stainPx * 2) continue;

    const hx = Math.round(s.x), hy = Math.round(s.y);
    // EL HALO DE LABRANZA, primero y debajo: el cinturón de campo abierto que
    // rodea a cualquier pueblo visto desde arriba. Las teselas hondas no lo
    // necesitan (el canon trae los campos de verdad); aquí es lo que separa
    // «mancha parda sobre verde plano» de «asentamiento» — el relleno no tiene
    // otro contexto que dar. Dos elipses desalineadas para que no sea un aro.
    ctx.fillStyle = '#b3a262';
    ctx.globalAlpha = 0.13;
    for (let k = 0; k < 2; k++) {
      const a = hash01(hx, hy, 340 + k * 3) * Math.PI * 2;
      const d = stainPx * 0.3 * hash01(hx, hy, 341 + k * 3);
      const r = stainPx * (1.5 + hash01(hx, hy, 342 + k * 3) * 0.5);
      ctx.beginPath();
      ctx.ellipse(px + Math.cos(a) * d, py + Math.sin(a) * d, r, r * 0.82, a, 0, Math.PI * 2);
      ctx.fill();
    }
    const blobs = Math.max(4, Math.min(11, Math.round(stainPx * 0.8)));
    // Más tinta que la α0,26 original: sobre el albedo ampliado (sin campos,
    // sin setos, sin textura) aquella mancha era un borrón tímido — MIRADO en
    // `harness/fill-probe.ts`. Las teselas suben al mismo nivel para que el
    // relevo relleno→tesela sea un cambio de pincel y no un atenuado.
    ctx.fillStyle = '#6e5847';
    ctx.globalAlpha = 0.34;
    for (let k = 0; k < blobs; k++) {
      const a = hash01(hx, hy, 300 + k * 3) * Math.PI * 2;
      const d = Math.sqrt(hash01(hx, hy, 301 + k * 3)) * stainPx * 0.72;
      const r = stainPx * (0.26 + hash01(hx, hy, 302 + k * 3) * 0.3);
      ctx.beginPath();
      ctx.ellipse(px + Math.cos(a) * d, py + Math.sin(a) * d, r, r * 0.78, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // El corazón: el casco denso alrededor del que creció lo demás.
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    ctx.arc(px, py, stainPx * 0.34, 0, Math.PI * 2);
    ctx.fill();
    // Motas de manzana cuando la mancha ya es un pueblo grande en pantalla:
    // tres puntos más oscuros dentro del casco, que a 10-30 m/px sugieren
    // bloques edificados sin inventar ninguna casa concreta.
    if (stainPx >= 12) {
      ctx.fillStyle = '#4c3b2c';
      ctx.globalAlpha = 0.3;
      for (let k = 0; k < 3; k++) {
        const a = hash01(hx, hy, 360 + k * 3) * Math.PI * 2;
        const d = hash01(hx, hy, 361 + k * 3) * stainPx * 0.5;
        const r = stainPx * (0.07 + hash01(hx, hy, 362 + k * 3) * 0.06);
        ctx.beginPath();
        ctx.arc(px + Math.cos(a) * d, py + Math.sin(a) * d, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawn++;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  return drawn;
}
