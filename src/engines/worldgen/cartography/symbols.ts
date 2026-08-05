// ============================================
// Cartography — Hand-drawn map symbols
// ============================================
// Every symbol is constructed procedurally in a local design space where the
// anchor is the base-centre at (0,0) and the symbol grows upward (-y). The
// caller translates/scales; nothing here knows about the world.
//
// The mountain construction follows the "topline / ridgeline / secondary"
// decomposition that hand-drawn reference maps actually use:
//   topline    — the carat silhouette, occasionally interrupted by a sub-peak
//   ridgeline  — from the peak: one near-vertical segment ~half the height,
//                then up to three shorter segments at sharp alternating angles,
//                usually running past the baseline
//   shading    — the polygon between the unlit topline and the ridgeline,
//                hatched perpendicular to the topline
//   secondary  — extra toplines springing from ridgeline corners, on ~half of
//                the symbols and never on the smallest
// Draw order inside one symbol is fixed: mask → shading → highlight → outline.
//
// Hills are the same generator with the side-curvature sign flipped (convex
// instead of concave), broader proportions, a rounded top and no ridgeline.

import type { Rng } from '../core/rng';
import type { CartoTheme } from './theme';

export type Ctx = CanvasRenderingContext2D;

/** Light comes from the upper LEFT: the classic cartographic convention, and
 *  it matches the NW hillshade the atlas view already bakes. */
export const LIGHT_FROM_LEFT = true;

interface P { x: number; y: number }

/** Parse `#rrggbb` or `rgb(r,g,b)`. Both appear because `shiftColor` emits the
 *  second form and its output feeds straight back into `mixColor`. */
function parseColor(c: string): [number, number, number] {
  if (c.charCodeAt(0) === 35) {
    const h = c.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = c.match(/-?\d+(\.\d+)?/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [0, 0, 0];
}

/** Lighten (positive) or darken (negative) a hex colour. Per-instance colour
 *  jitter is what stops a forest reading as one repeated stamp. */
function shiftColor(hex: string, amount: number): string {
  const [r, g, b] = parseColor(hex);
  const k = amount >= 0 ? amount : 0;
  const d = amount < 0 ? 1 + amount : 1;
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, c * d + (255 - c) * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/**
 * Interpolación hacia otro color. Es el motor de la PERSPECTIVA AÉREA: un
 * símbolo tapado por otro se lava hacia el papel en vez de dibujarse con la
 * misma tinta que el de delante. Sin esto una sierra de cuarenta cumbres es una
 * fila de tiendas de campaña recortadas; con esto tiene fondo.
 */
export function mixColor(from: string, to: string, t: number): string {
  if (t <= 0.001) return from;
  const a = parseColor(from), b = parseColor(to);
  const k = Math.min(1, t);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}

// ---------------------------------------------------------------------------
// Line work
// ---------------------------------------------------------------------------

/** Perpendicular offset of a segment's midpoint, giving a concave (negative)
 *  or convex (positive) side. Returns a quadratic control point. */
function bulgeControl(a: P, b: P, bulge: number): P {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  return { x: (a.x + b.x) / 2 + nx * bulge * len, y: (a.y + b.y) / 2 + ny * bulge * len };
}

/** Trace a polyline as bulged quadratics without stroking or filling. */
function tracePath(ctx: Ctx, pts: P[], bulges: number[] | number, move = true): void {
  if (pts.length < 2) return;
  if (move) ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const bl = typeof bulges === 'number' ? bulges : (bulges[i - 1] ?? 0);
    if (Math.abs(bl) < 1e-4) ctx.lineTo(pts[i].x, pts[i].y);
    else {
      const c = bulgeControl(pts[i - 1], pts[i], bl);
      ctx.quadraticCurveTo(c.x, c.y, pts[i].x, pts[i].y);
    }
  }
}

/**
 * Stroke a polyline the way a pen does: slight per-vertex jitter and a width
 * that drifts along the line. Splitting into a handful of sub-strokes is what
 * sells "drawn" over "plotted"; more than ~4 pieces is wasted at map scale.
 */
export function handStroke(
  ctx: Ctx,
  pts: P[],
  rng: Rng,
  opts: { width: number; color: string; jitter?: number; taper?: number; bulge?: number | number[]; alpha?: number },
): void {
  if (pts.length < 2) return;
  const jitter = opts.jitter ?? 0;
  const jittered = jitter
    ? pts.map((p, i) => (i === 0 || i === pts.length - 1
      ? p
      : { x: p.x + (rng() - 0.5) * jitter, y: p.y + (rng() - 0.5) * jitter }))
    : pts;

  ctx.save();
  ctx.strokeStyle = opts.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;

  const taper = opts.taper ?? 0;
  if (taper <= 0) {
    ctx.lineWidth = opts.width;
    ctx.beginPath();
    tracePath(ctx, jittered, opts.bulge ?? 0);
    ctx.stroke();
  } else {
    // Fake a gradient stroke by chopping the path into width-stepped pieces.
    const pieces = Math.min(4, Math.max(2, jittered.length - 1));
    const per = (jittered.length - 1) / pieces;
    for (let k = 0; k < pieces; k++) {
      const i0 = Math.floor(k * per);
      const i1 = Math.min(jittered.length - 1, Math.ceil((k + 1) * per));
      const t = k / (pieces - 1 || 1);
      ctx.lineWidth = opts.width * (1 - taper * t);
      ctx.beginPath();
      tracePath(ctx, jittered.slice(i0, i1 + 1), opts.bulge ?? 0);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Parallel hatching clipped to the current path, at `angle` radians. */
function hatch(
  ctx: Ctx,
  angle: number,
  spacing: number,
  width: number,
  color: string,
  alpha: number,
  extent: number,
  rng: Rng,
): void {
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.rotate(angle);
  for (let d = -extent; d <= extent; d += spacing * (0.75 + rng() * 0.5)) {
    // Slight arc per stroke, alternating side — a ruled line reads as machine.
    const bow = (rng() - 0.5) * spacing * 0.5;
    ctx.beginPath();
    ctx.moveTo(d, -extent);
    ctx.quadraticCurveTo(d + bow, 0, d + (rng() - 0.5) * spacing * 0.3, extent);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Mountains
// ---------------------------------------------------------------------------

export interface MountainSpec {
  /** Height in map px. */
  h: number;
  /** Width in map px. */
  w: number;
  /** 0–1: how far above the snow line the peak sits (0 = none). */
  snow: number;
  /** Colour to fill the silhouette with — sample the map under the base so
   *  the symbol sits in the terrain instead of on top of it. */
  fill: string;
  /**
   * −1…+1: inclinación de la cumbre HACIA la dirección de la cresta. Un símbolo
   * que no sabe por dónde corre su sierra se dibuja siempre simétrico, y una
   * cadena de simétricos es una retícula. Con esto la cumbre se desplaza cuesta
   * arriba y la arista cae cuesta abajo, que es como se dibuja a mano.
   */
  lean?: number;
  /**
   * 0 = en primer término, 1 = totalmente detrás. Lava el símbolo hacia el
   * papel y adelgaza su línea (perspectiva aérea).
   */
  depth?: number;
  /** −1…+1: desvío de tono de esta instancia, en fracción de `toneJitter`. */
  tone?: number;
  /** Tono del papel hacia el que lavar la profundidad. */
  paper?: string;
}

interface MountainGeom {
  topline: P[];
  bulges: number[];
  ridge: P[];
  peakIndex: number;
  secondary: P[][];
}

/** Build the geometry once so hit-testing, occlusion and drawing agree. */
function buildMountain(rng: Rng, w: number, h: number, hill: boolean, lean = 0): MountainGeom {
  const halfW = w / 2;
  // Baselines commonly slant down to the right on hand-drawn maps; una cresta
  // que sube hacia la derecha inclina también la base hacia ese lado.
  const slant = (rng() - 0.35) * h * 0.1 - lean * h * 0.07;
  // La cumbre se corre HACIA la cresta: ±22 % por azar, ±26 % más por la
  // orientación. Es el único parámetro que hace que dos vecinas de la misma
  // sierra no sean la misma silueta desplazada.
  const peakX = (rng() - 0.5) * w * 0.22 + lean * w * 0.26;
  const flatTop = !hill && rng() < 0.05;

  const left: P = { x: -halfW, y: 0 };
  const right: P = { x: halfW, y: slant };

  const topline: P[] = [left];
  const bulges: number[] = [];
  // Mountains pinch inward (concave sides); hills swell outward (convex).
  const sideBulge = hill ? 0.1 + rng() * 0.06 : -(0.05 + rng() * 0.07);

  // Sub-peak: a jog part-way up one side, proportioned like the mountain.
  const subLeft = !hill && rng() < 0.42;
  const subRight = !hill && rng() < 0.22;
  if (subLeft) {
    const t = 0.42 + rng() * 0.2;
    const sx = left.x + (peakX - left.x) * t;
    const sy = -h * (0.34 + rng() * 0.22);
    topline.push({ x: sx, y: sy }); bulges.push(sideBulge);
    topline.push({ x: sx + w * (0.03 + rng() * 0.04), y: sy + h * 0.05 }); bulges.push(0);
  }

  if (flatTop) {
    const fw = w * (0.06 + rng() * 0.06);
    topline.push({ x: peakX - fw, y: -h }); bulges.push(sideBulge);
    topline.push({ x: peakX + fw, y: -h * (0.99 + rng() * 0.02) }); bulges.push(0);
  } else if (hill) {
    // Rounded crown rather than a point. Casi la mitad llevan una segunda
    // giba más baja: una loma de una sola joroba, repetida cien veces, es la
    // firma inconfundible de un sello — y las lomas son el símbolo MÁS repetido
    // del pliego, así que es donde más se nota.
    const twin = rng() < 0.46;
    const side = rng() < 0.5 ? -1 : 1;
    if (twin) {
      const bx = peakX + side * w * (0.24 + rng() * 0.12);
      const bh = h * (0.5 + rng() * 0.22);
      if (side < 0) {
        topline.push({ x: bx - w * 0.09, y: -bh }); bulges.push(sideBulge);
        topline.push({ x: bx + w * 0.09, y: -bh * (0.95 + rng() * 0.08) }); bulges.push(-0.2);
        topline.push({ x: (bx + peakX) / 2, y: -h * (0.6 + rng() * 0.1) }); bulges.push(0.1);
      }
    }
    const fw = w * (0.1 + rng() * 0.1);
    topline.push({ x: peakX - fw, y: -h * (0.94 + rng() * 0.05) }); bulges.push(sideBulge);
    topline.push({ x: peakX + fw, y: -h * (0.94 + rng() * 0.05) }); bulges.push(-0.16);
    if (twin && side > 0) {
      const bx = peakX + side * w * (0.24 + rng() * 0.12);
      const bh = h * (0.5 + rng() * 0.22);
      topline.push({ x: (bx + peakX) / 2, y: -h * (0.6 + rng() * 0.1) }); bulges.push(0.1);
      topline.push({ x: bx - w * 0.09, y: -bh }); bulges.push(0.12);
      topline.push({ x: bx + w * 0.09, y: -bh * (0.95 + rng() * 0.08) }); bulges.push(-0.2);
    }
  } else {
    topline.push({ x: peakX, y: -h }); bulges.push(sideBulge);
  }
  const peakIndex = topline.length - 1;

  if (subRight) {
    const t = 0.4 + rng() * 0.2;
    const sx = peakX + (right.x - peakX) * t;
    const sy = -h * (0.32 + rng() * 0.2);
    topline.push({ x: sx - w * 0.03, y: sy + h * 0.05 }); bulges.push(sideBulge);
    topline.push({ x: sx, y: sy }); bulges.push(0);
  }
  topline.push(right);
  bulges.push(sideBulge);

  // --- ridgeline ----------------------------------------------------------
  const ridge: P[] = [];
  if (!hill) {
    const start = topline[peakIndex];
    ridge.push(start);
    // First segment: near-vertical, about half the height, landing inside a
    // middle band so the ridge never hugs a side.
    const band = w * 0.16;
    let x = Math.max(-band, Math.min(band, start.x + (rng() - 0.5) * w * 0.12));
    let y = start.y + h * (0.44 + rng() * 0.14);
    ridge.push({ x, y });
    let dir = rng() < 0.5 ? -1 : 1;
    const segs = 1 + Math.floor(rng() * 3); // up to four segments in total
    for (let k = 0; k < segs; k++) {
      const len = h * (0.22 + rng() * 0.26) * (k === segs - 1 ? 0.7 : 1);
      const ang = (Math.PI / 2) * (0.42 + rng() * 0.4) * dir;
      x += Math.sin(ang) * len;
      y += Math.cos(ang) * len;
      ridge.push({ x, y });
      dir = -dir;
      // Ridgelines generally run past the baseline; stop once well below.
      if (y > h * 0.16) break;
    }
  }

  // --- secondary toplines --------------------------------------------------
  const secondary: P[][] = [];
  if (!hill && ridge.length > 2 && rng() < 0.55) {
    for (let k = 1; k < ridge.length - 1; k++) {
      if (rng() > 0.45) continue;
      const c = ridge[k];
      // Run roughly parallel to the main topline on the shaded side.
      const side = c.x >= 0 ? 1 : -1;
      const len = w * (0.16 + rng() * 0.2);
      const drop = h * (0.2 + rng() * 0.22);
      secondary.push([c, { x: c.x + side * len, y: c.y + drop }]);
      if (secondary.length >= 2) break;
    }
  }

  return { topline, bulges, ridge, peakIndex, secondary };
}

/**
 * Draw one mountain (or hill) at the current transform origin, base-centred.
 * Returns nothing; the caller owns placement and back-to-front ordering.
 */
export function drawMountain(ctx: Ctx, rng: Rng, theme: CartoTheme, spec: MountainSpec, hill = false): void {
  const style = hill ? theme.hills : theme.mountains;
  const { w, h } = spec;
  const g = buildMountain(rng, w, h, hill, spec.lean ?? 0);

  // ---- tinta de ESTA instancia -------------------------------------------
  // Dos correcciones sobre el estilo del tema, ambas por instancia:
  //   tono   — ±toneJitter, para que la sierra no sea un sello repetido
  //   fondo  — lavado hacia el papel proporcional a `depth` (perspectiva aérea)
  const paper = spec.paper ?? theme.paper.base;
  const back = Math.min(1, Math.max(0, spec.depth ?? 0)) * (theme.mountains.aerial ?? 0);
  const jt = (spec.tone ?? 0) * style.toneJitter;
  const ink = mixColor(shiftColor(style.ink, jt * 0.5), paper, back * 0.72);
  const lightC = mixColor(shiftColor(style.light, jt), paper, back * 0.8);
  const shadowC = mixColor(shiftColor(style.shadow, jt * 0.8), paper, back * 0.8);
  const hatchC = mixColor(theme.mountains.hatch, paper, back * 0.75);

  // Line width barely scales with the symbol: small symbols need proportionally
  // fatter ink or they read as grey smudges. Lo de detrás además adelgaza: la
  // línea pesada delante y la ligera detrás es la mitad del efecto de sierra.
  //
  // Crece con la RAÍZ del tamaño, no linealmente ni a tope fijo: con el tope de
  // 1.6× anterior un pico de 60 px (zoom 24×) se dibujaba con 1.33 px de contorno
  // y se leía como un recorte de papel; con la raíz sube a ~2.0 px y vuelve a
  // tener peso, sin engordar el símbolo de 10 px de la vista de mundo.
  const lw = style.lineWidth * (0.6 + 0.55 * Math.min(3.2, Math.sqrt(h / style.size))) * (1 - back * 0.34);

  // 0. FALDA DE DERRUBIOS — un par de trazos de talud al pie, por fuera de la
  //    silueta, que atan el símbolo al suelo. Sin ella la montaña flota.
  const scree = hill ? 0 : theme.mountains.scree;
  if (scree > 0.001 && h > 5) {
    ctx.save();
    ctx.strokeStyle = shadowC;
    ctx.globalAlpha = 0.5 * (1 - back * 0.6);
    ctx.lineWidth = lw * 0.5;
    ctx.lineCap = 'round';
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const x0 = side * w * (0.1 + rng() * 0.3);
      const drop = h * scree * (0.6 + rng() * 0.8);
      ctx.beginPath();
      ctx.moveTo(x0, -h * 0.04);
      ctx.quadraticCurveTo(x0 + side * w * 0.1, drop * 0.5, x0 + side * w * (0.16 + rng() * 0.14), drop);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 1. MASK — opaque silhouette plus a short apron so the ridgeline of the
  //    mountain behind cannot peek out beneath this one.
  ctx.beginPath();
  ctx.moveTo(g.topline[0].x, g.topline[0].y);
  tracePath(ctx, g.topline, g.bulges, false);
  const last = g.topline[g.topline.length - 1];
  const apron = h * 0.1;
  ctx.lineTo(last.x, last.y + apron);
  ctx.lineTo(g.topline[0].x, g.topline[0].y + apron);
  ctx.closePath();
  ctx.fillStyle = spec.fill;
  ctx.fill();

  // Body tone: lit face.
  ctx.beginPath();
  ctx.moveTo(g.topline[0].x, g.topline[0].y);
  tracePath(ctx, g.topline, g.bulges, false);
  ctx.lineTo(last.x, last.y);
  ctx.closePath();
  ctx.fillStyle = lightC;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  // 2. SHADING — polygon between the unlit topline and the ridgeline.
  if (!hill && g.ridge.length > 1) {
    const shadeSide = LIGHT_FROM_LEFT ? 1 : -1;
    const poly: P[] = [...g.ridge];
    // Walk back up the shaded half of the topline to the peak.
    if (shadeSide > 0) for (let i = g.topline.length - 1; i >= g.peakIndex; i--) poly.push(g.topline[i]);
    else for (let i = 0; i <= g.peakIndex; i++) poly.push(g.topline[i]);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.fillStyle = shadowC;
    ctx.globalAlpha = 0.66;
    ctx.fill();
    ctx.globalAlpha = 1;
    // Hatching runs perpendicular to the topline.
    const tl0 = g.topline[g.peakIndex], tl1 = g.topline[g.topline.length - 1];
    const topAngle = Math.atan2(tl1.y - tl0.y, tl1.x - tl0.x);
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    hatch(ctx, topAngle + Math.PI / 2, Math.max(1.5, h * 0.105), lw * 0.5,
      hatchC, theme.mountains.hatchAlpha * (1 - back * 0.5), h * 1.4, rng);
    ctx.restore();
  } else if (hill) {
    // Hills get curved shadow lines instead of a hatched facet: dos o tres,
    // escalonadas, porque una sola raya idéntica en cada loma vuelve a delatar
    // el sello que las gibas acaban de disimular.
    const base = g.topline[g.topline.length - 1];
    const n = 1 + (h > 6 ? Math.floor(rng() * 2) + 1 : 0);
    for (let i = 0; i < n; i++) {
      const k = 1 - i * (0.24 + rng() * 0.1);
      handStroke(ctx, [
        { x: base.x - w * 0.34 * k, y: base.y - h * (0.06 + i * 0.12) },
        { x: base.x - w * 0.02 * k, y: base.y - h * i * 0.09 },
      ], rng, { width: lw * (0.9 - i * 0.2), color: shadowC, bulge: -0.22, alpha: 0.85 - i * 0.2 });
    }
  }

  // 3. SNOW — triggered by absolute height, clipped to the silhouette.
  if (spec.snow > 0.01 && !hill) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g.topline[0].x, g.topline[0].y);
    tracePath(ctx, g.topline, g.bulges, false);
    ctx.closePath();
    ctx.clip();
    const snowY = -h * (0.42 + 0.5 * (1 - spec.snow));
    ctx.beginPath();
    ctx.moveTo(-w, -h * 1.3);
    ctx.lineTo(w, -h * 1.3);
    ctx.lineTo(w, snowY);
    // Ragged snow line rather than a ruled one.
    const steps = 5;
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      ctx.lineTo(-w + 2 * w * t, snowY + (rng() - 0.5) * h * 0.12);
    }
    ctx.closePath();
    ctx.fillStyle = mixColor(theme.mountains.snow, paper, back * 0.6);
    ctx.globalAlpha = 0.88;
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 4. OUTLINE — last, so it sits over the shading and the snow.
  handStroke(ctx, g.topline, rng, { width: lw, color: ink, bulge: g.bulges, jitter: hill ? 0 : h * 0.012 });
  if (g.ridge.length > 1) {
    handStroke(ctx, g.ridge, rng, { width: lw * 0.85, color: ink, taper: 0.45 });
  }
  for (const s of g.secondary) {
    handStroke(ctx, s, rng, { width: lw * 0.6, color: ink, alpha: 0.8, taper: 0.5 });
  }
}

/**
 * Casquete / banquisa: la placa de hielo se dibuja con grietas, no con relleno.
 * Una lengua recta con dos ramas cortas, que es como un atlas marca un glaciar
 * sin recurrir a otro color plano que el ojo ya no distingue del papel nevado.
 */
export function drawIce(ctx: Ctx, rng: Rng, theme: CartoTheme, w: number): void {
  ctx.save();
  ctx.strokeStyle = theme.ice.color;
  ctx.globalAlpha = theme.ice.alpha;
  ctx.lineWidth = Math.max(0.5, theme.ice.width * (0.7 + w * 0.045));
  ctx.lineCap = 'round';
  const ang = (rng() - 0.5) * 0.7;
  const len = w * (0.7 + rng() * 0.5);
  const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len * 0.45;
  ctx.beginPath();
  ctx.moveTo(-dx / 2, -dy / 2);
  ctx.quadraticCurveTo((rng() - 0.5) * w * 0.3, (rng() - 0.5) * w * 0.2, dx / 2, dy / 2);
  ctx.stroke();
  const branches = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < branches; i++) {
    const t = 0.25 + rng() * 0.5;
    const bx = -dx / 2 + dx * t, by = -dy / 2 + dy * t;
    const side = rng() < 0.5 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + side * w * (0.12 + rng() * 0.16), by + side * w * (0.14 + rng() * 0.16));
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/** Bumpy cloud outline: an ellipse whose every edge is replaced by an outward
 *  bulging cubic. This one primitive builds canopies and forest masses alike. */
function cloudPath(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, bumps: number, rng: Rng, roughness = 0.35): void {
  const pts: P[] = [];
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 - Math.PI / 2;
    const jr = 1 + (rng() - 0.5) * roughness;
    pts.push({ x: cx + Math.cos(a) * rx * jr, y: cy + Math.sin(a) * ry * jr });
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < bumps; i++) {
    const a = pts[i], b = pts[(i + 1) % bumps];
    const mx = (a.x + b.x) / 2 - cx, my = (a.y + b.y) / 2 - cy;
    const L = Math.hypot(mx, my) || 1;
    const bulge = (0.5 + rng() * 0.45) * Math.hypot(b.x - a.x, b.y - a.y) * 0.6;
    const c1 = { x: a.x + (mx / L) * bulge, y: a.y + (my / L) * bulge };
    const c2 = { x: b.x + (mx / L) * bulge, y: b.y + (my / L) * bulge };
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  }
  ctx.closePath();
}

/**
 * Sombra al pie: una elipse baja y translúcida bajo el tronco. Cuesta un fill
 * por árbol y es lo que impide que una masa forestal se lea como pegatinas
 * sobre el papel — con ella los árboles pisan el suelo que ya está pintado.
 */
function footShadow(ctx: Ctx, theme: CartoTheme, h: number, alpha: number): void {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = theme.forest.shadow;
  ctx.beginPath();
  ctx.ellipse(h * 0.08, 0, h * 0.3, h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Broadleaf: trunk first (the canopy hides its top), then a fluffy crown.
 *  `depth` 0…1 lava el árbol hacia el papel: una masa forestal con todos los
 *  ejemplares al mismo tono es una trama, no un bosque. */
export function drawBroadleaf(ctx: Ctx, rng: Rng, theme: CartoTheme, h: number, depth = 0): void {
  const st = theme.forest;
  const back = Math.min(1, Math.max(0, depth)) * st.aerial;
  const paper = theme.paper.base;
  const ink = mixColor(st.ink, paper, back * 0.7);
  const r = h * 0.4;
  const trunkH = h * (0.2 + rng() * 0.08);
  footShadow(ctx, theme, h, 0.2 * (1 - back));
  ctx.beginPath();
  ctx.moveTo(-h * 0.055, 0);
  ctx.lineTo(-h * 0.022, -trunkH - r * 0.6);
  ctx.lineTo(h * 0.022, -trunkH - r * 0.6);
  ctx.lineTo(h * 0.055, 0);
  ctx.closePath();
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;

  const cy = -trunkH - r;
  ctx.beginPath();
  cloudPath(ctx, 0, cy, r * 1.06, r * (0.88 + rng() * 0.16), 7 + Math.floor(rng() * 3), rng);
  ctx.fillStyle = mixColor(shiftColor(st.broadleaf, (rng() - 0.5) * 2 * st.toneJitter), paper, back * 0.8);
  ctx.fill();
  ctx.lineWidth = st.lineWidth * (0.7 + 0.5 * Math.min(1.4, h / st.size)) * (1 - back * 0.3);
  ctx.strokeStyle = ink;
  ctx.stroke();

  // Shaded lower-right lobe, a single crescent rather than real hatching.
  ctx.save();
  ctx.beginPath();
  cloudPath(ctx, 0, cy, r * 1.06, r * 0.95, 7, rng);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(r * 0.42, cy + r * 0.3, r * 0.85, r * 0.75, 0, 0, Math.PI * 2);
  ctx.fillStyle = mixColor(st.shadow, paper, back * 0.8);
  ctx.globalAlpha = 0.4;
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Conifer: a tapered stack of branch scallops, wider toward the base. */
export function drawConifer(ctx: Ctx, rng: Rng, theme: CartoTheme, h: number, depth = 0): void {
  const st = theme.forest;
  const back = Math.min(1, Math.max(0, depth)) * st.aerial;
  const paper = theme.paper.base;
  const ink = mixColor(st.ink, paper, back * 0.7);
  // 0.27–0.36 de media anchura, no 0.20–0.27: a la anchura vieja, un pino de
  // 9 px (la vista de mundo) degeneraba en un palito con dos púas y la masa de
  // coníferas se leía como una lluvia de tildes sobre el papel.
  const halfW = h * (0.27 + rng() * 0.09);
  const trunkH = h * 0.14;
  footShadow(ctx, theme, h, 0.18 * (1 - back));
  ctx.beginPath();
  ctx.moveTo(-h * 0.035, 0);
  ctx.lineTo(-h * 0.018, -trunkH * 1.6);
  ctx.lineTo(h * 0.018, -trunkH * 1.6);
  ctx.lineTo(h * 0.035, 0);
  ctx.closePath();
  ctx.fillStyle = ink;
  ctx.fill();

  // Menos pisos cuando el símbolo es pequeño: cuatro escalones en 9 px caen por
  // debajo del píxel y el contorno se convierte en ruido.
  const tiers = h < 11 ? 3 : 3 + Math.floor(rng() * 2);
  const top = -h;
  const bottom = -trunkH;
  const lean = (rng() - 0.5) * h * 0.06;

  ctx.beginPath();
  ctx.moveTo(lean, top);
  // Left side, top → bottom, branches growing longer.
  for (let i = 1; i <= tiers; i++) {
    const t = i / tiers;
    const y = top + (bottom - top) * t;
    const spread = halfW * Math.pow(t, 0.78) * (0.9 + rng() * 0.2);
    const prevY = top + (bottom - top) * ((i - 1) / tiers);
    ctx.quadraticCurveTo(lean * (1 - t) - spread * 0.55, (prevY + y) / 2, lean * (1 - t) - spread, y);
    // Notch back toward the trunk before the next, longer branch.
    if (i < tiers) ctx.lineTo(lean * (1 - t) - spread * 0.34, y + (bottom - top) / tiers * 0.28);
  }
  ctx.lineTo(0, bottom);
  // Right side, bottom → top.
  for (let i = tiers; i >= 1; i--) {
    const t = i / tiers;
    const y = top + (bottom - top) * t;
    const spread = halfW * Math.pow(t, 0.78) * (0.9 + rng() * 0.2);
    if (i < tiers) ctx.lineTo(lean * (1 - t) + spread * 0.34, y + (bottom - top) / tiers * 0.28);
    ctx.lineTo(lean * (1 - t) + spread, y);
    const nextY = top + (bottom - top) * ((i - 1) / tiers);
    ctx.quadraticCurveTo(lean + spread * 0.55, (y + nextY) / 2, lean * (1 - (i - 1) / tiers), nextY);
  }
  ctx.closePath();
  ctx.fillStyle = mixColor(shiftColor(st.conifer, (rng() - 0.5) * 2 * st.toneJitter), paper, back * 0.8);
  ctx.fill();
  ctx.lineWidth = st.lineWidth * (0.7 + 0.5 * Math.min(1.4, h / st.size)) * (1 - back * 0.3);
  ctx.strokeStyle = ink;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Palm — a slim leaning trunk with drooping fronds, for tropical coasts. */
export function drawPalm(ctx: Ctx, rng: Rng, theme: CartoTheme, h: number): void {
  const st = theme.forest;
  const lean = (rng() - 0.5) * h * 0.34;
  ctx.strokeStyle = st.ink;
  ctx.lineWidth = st.lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(lean * 0.4, -h * 0.55, lean, -h * 0.82);
  ctx.stroke();
  const fronds = 5;
  ctx.fillStyle = st.broadleaf;
  for (let i = 0; i < fronds; i++) {
    const a = -Math.PI + (i / (fronds - 1)) * Math.PI;
    const len = h * (0.3 + rng() * 0.16);
    ctx.beginPath();
    ctx.moveTo(lean, -h * 0.82);
    ctx.quadraticCurveTo(
      lean + Math.cos(a) * len * 0.6, -h * 0.82 + Math.sin(a) * len * 0.5 - h * 0.1,
      lean + Math.cos(a) * len, -h * 0.82 + Math.sin(a) * len * 0.45 + h * 0.08,
    );
    ctx.quadraticCurveTo(
      lean + Math.cos(a) * len * 0.55, -h * 0.82 + Math.sin(a) * len * 0.4 + h * 0.02,
      lean, -h * 0.8,
    );
    ctx.fill();
  }
}

/** Cactus / arid scrub marker. */
export function drawCactus(ctx: Ctx, rng: Rng, theme: CartoTheme, h: number): void {
  const st = theme.forest;
  ctx.strokeStyle = st.shadow;
  ctx.lineWidth = Math.max(0.9, h * 0.13);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -h);
  ctx.stroke();
  const armY = -h * (0.4 + rng() * 0.2);
  const side = rng() < 0.5 ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(0, armY);
  ctx.lineTo(side * h * 0.3, armY);
  ctx.lineTo(side * h * 0.3, armY - h * 0.26);
  ctx.stroke();
  if (rng() < 0.5) {
    const y2 = -h * (0.55 + rng() * 0.2);
    ctx.beginPath();
    ctx.moveTo(0, y2);
    ctx.lineTo(-side * h * 0.26, y2);
    ctx.lineTo(-side * h * 0.26, y2 - h * 0.2);
    ctx.stroke();
  }
}

/**
 * Sand dune: a crescent ridge with a trailing lee line.
 *
 * BAJA y LARGA, no un arco de medio punto: a la altura anterior (0.26–0.38 w)
 * el símbolo salía como un aro de croquet y un erg entero se leía como una
 * hilera de aros idénticos. Una duna real es una cresta tendida — 0.11–0.20 w
 * de flecha sobre una base de anchura completa — y su asimetría (barlovento
 * largo, sotavento corto) es lo que da la variación sin tocar nada más.
 */
export function drawDune(ctx: Ctx, rng: Rng, theme: CartoTheme, w: number): void {
  ctx.save();
  ctx.strokeStyle = theme.dunes.color;
  ctx.globalAlpha = theme.dunes.alpha;
  ctx.lineWidth = Math.max(0.6, theme.dunes.width * (0.75 + w * 0.03));
  ctx.lineCap = 'round';
  // Barlovento hacia un lado u otro: la cresta se corre del centro.
  const side = rng() < 0.5 ? -1 : 1;
  const crest = side * w * (0.08 + rng() * 0.16);
  const rise = w * (0.11 + rng() * 0.09);
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.quadraticCurveTo(crest - w * 0.16, -rise, crest, -rise);
  ctx.quadraticCurveTo(crest + w * 0.12, -rise * 0.92, w / 2, 0);
  ctx.stroke();
  // Cuernos: las puntas del creciente, que es lo que hace barján a una duna.
  ctx.globalAlpha = theme.dunes.alpha * 0.7;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.quadraticCurveTo(-w * 0.3, w * 0.1, -w * (0.16 + rng() * 0.1), w * 0.14);
  ctx.moveTo(w / 2, 0);
  ctx.quadraticCurveTo(w * 0.3, w * 0.1, w * (0.16 + rng() * 0.1), w * 0.14);
  ctx.stroke();
  if (rng() < 0.55) {
    // Una segunda cresta detrás, más floja: los ergs vienen en trenes.
    ctx.globalAlpha = theme.dunes.alpha * 0.5;
    ctx.beginPath();
    ctx.moveTo(-w * 0.34, -w * 0.2);
    ctx.quadraticCurveTo(0, -w * (0.28 + rng() * 0.08), w * 0.36, -w * 0.19);
    ctx.stroke();
  }
  ctx.restore();
}

/** Marsh: the standard cartographic tuft — stacked horizontal dashes. */
export function drawMarsh(ctx: Ctx, rng: Rng, theme: CartoTheme, w: number): void {
  ctx.strokeStyle = theme.marsh.color;
  ctx.globalAlpha = theme.marsh.alpha;
  ctx.lineWidth = Math.max(0.7, w * 0.1);
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const y = -i * w * 0.26;
    const half = (w / 2) * (1 - i * 0.22);
    ctx.beginPath();
    ctx.moveTo(-half, y);
    ctx.lineTo(half, y);
    ctx.stroke();
  }
  // A couple of reed tufts above the dashes.
  if (rng() < 0.6) {
    ctx.beginPath();
    ctx.moveTo(0, -w * 0.52);
    ctx.lineTo(0, -w * 0.85);
    ctx.moveTo(0, -w * 0.7);
    ctx.lineTo(-w * 0.16, -w * 0.92);
    ctx.moveTo(0, -w * 0.7);
    ctx.lineTo(w * 0.16, -w * 0.92);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
