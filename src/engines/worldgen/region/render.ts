// ============================================
// Regional sheet — Rendering
// ============================================
// Same ink, same paper, same hand as the world map and the town plan, so moving
// between the three scales is a change of magnification rather than a change of
// medium. What changes is the VOCABULARY, because at 200 m per cell different
// things are legible and different things matter:
//
//   · relief is drawn with contours and form lines, not with mountain symbols —
//     a mountain glyph at this scale would be a hundred kilometres wide;
//   · woodland is drawn tree by tree, because you can afford to;
//   · the ground is divided: hedges, walls, strips and closes;
//   · every stream is drawn, not just the ones big enough to name;
//   · settlements are buildings, not dots.
//
// Draw order is a draughtsman's: ground, water, vegetation, division, ways,
// buildings, ink, type, furniture. Anything drawn out of that order reads as a
// mistake even when the reader cannot say why.

import { createRng, type Rng } from '../core/rng';
import { renderPaper } from '../cartography/paper';
import { drawBroadleaf, drawConifer, drawCactus, drawDune, drawMarsh, drawPalm, type Ctx } from '../cartography/symbols';
import { marchingSquares, chaikin as smoothContour } from '../cartography/contours';
import type { CartoTheme } from '../cartography/theme';
import { Biome } from '../core/types';
import { Cover, COVER_LABEL_ES, type RegionData } from './types';

export interface RegionRenderOptions {
  theme: CartoTheme;
  width: number;
  height: number;
  layers?: Partial<RegionLayers>;
  /** Multiplies all type sizes. */
  typeScale?: number;
  /** Multiplies symbol density (trees, tufts). */
  density?: number;
  title?: string;
  subtitle?: string;
}

export interface RegionLayers {
  paper: boolean;
  cover: boolean;
  contours: boolean;
  shading: boolean;
  woods: boolean;
  fields: boolean;
  water: boolean;
  tracks: boolean;
  places: boolean;
  labels: boolean;
  frame: boolean;
  scaleBar: boolean;
  legend: boolean;
}

const DEFAULT_LAYERS: RegionLayers = {
  paper: true, cover: true, contours: true, shading: true, woods: true,
  fields: true, water: true, tracks: true, places: true, labels: true,
  frame: true, scaleBar: true, legend: true,
};

// ---------------------------------------------------------------------------
// Cover palette
// ---------------------------------------------------------------------------

/**
 * Ground washes.
 *
 * Deliberately narrow in range: on a real sheet the ground tones sit within a
 * few steps of the paper, and all the contrast is spent on ink. Wide, saturated
 * landcover colours are what makes a generated map look like a GIS export.
 */
const COVER_TINT: Record<number, string | null> = {
  [Cover.Sea]: null,
  [Cover.Lake]: null,
  [Cover.Marsh]: '#9aab86',
  [Cover.Meadow]: '#b9c78c',
  [Cover.Wood]: '#8ba874',
  [Cover.Coppice]: '#9db47f',
  [Cover.Scrub]: '#c0bd8b',
  [Cover.Heath]: '#b7ac8b',
  [Cover.Moor]: '#a89d84',
  [Cover.Grass]: '#c6c68f',
  [Cover.Pasture]: '#c2c98d',
  [Cover.Arable]: '#dcce9b',
  [Cover.Orchard]: '#b3c184',
  [Cover.Vineyard]: '#c5bf8a',
  [Cover.Rock]: '#b6ab99',
  [Cover.Scree]: '#c1b7a4',
  [Cover.Snow]: '#eef2f4',
  [Cover.Waste]: '#ded0aa',
  [Cover.Dune]: '#e6d5a6',
  [Cover.Beach]: '#e8dab0',
};

function hexToRgb(c: string): [number, number, number] {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ---------------------------------------------------------------------------

export function renderRegion(r: RegionData, ctx: Ctx, opts: RegionRenderOptions): void {
  const L: RegionLayers = { ...DEFAULT_LAYERS, ...opts.layers };
  const theme = opts.theme;
  const W = opts.width, H = opts.height;
  // The visible sheet, not the full working grid. Everything outside it was
  // generated so that the edge of the page would be RIGHT, and drawing it would
  // defeat the point.
  const m = r.margin;
  const RW = r.width - m * 2, RH = r.height - m * 2;
  const sx = W / RW, sy = H / RH;
  const s = Math.min(sx, sy);
  const seed = `${r.originX.toFixed(2)}:${r.originY.toFixed(2)}`;
  const rng = createRng(seed, 'region-render');
  const density = opts.density ?? 1;
  const typeScale = opts.typeScale ?? 1;

  /** Sheet cell → canvas px. */
  const px = (x: number) => (x - m) * sx;
  const py = (y: number) => (y - m) * sy;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ---- paper ---------------------------------------------------------------
  if (L.paper) {
    const buf = renderPaper({ width: W, height: H, seed, theme, scale: Math.max(W, H) / 1200 });
    const img = ctx.createImageData(W, H);
    img.data.set(buf);
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = theme.paper.base;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- ground: cover washes and sea, painted as one raster ------------------
  if (L.cover) paintGround(r, ctx, theme, W, H, L.shading);

  // ---- contours ------------------------------------------------------------
  if (L.contours) drawContours(r, ctx, theme, px, py, s, W, H);

  // ---- coastline -----------------------------------------------------------
  drawWaterEdges(r, ctx, theme, px, py, s);

  // ---- vegetation and surface symbols --------------------------------------
  if (L.woods) drawVegetation(r, ctx, theme, px, py, s, rng, density);

  // ---- the division of the ground ------------------------------------------
  if (L.fields) drawEnclosures(r, ctx, theme, px, py, s, rng);

  // ---- water ---------------------------------------------------------------
  if (L.water) drawStreams(r, ctx, theme, px, py, s);

  // ---- ways ----------------------------------------------------------------
  if (L.tracks) drawTracks(r, ctx, theme, px, py, s);

  // ---- buildings -----------------------------------------------------------
  if (L.places) drawPlaces(r, ctx, theme, px, py, s, rng);

  // ---- type ----------------------------------------------------------------
  if (L.labels) drawLabels(r, ctx, theme, px, py, s, W, H, typeScale);

  // ---- furniture -----------------------------------------------------------
  if (L.legend !== false) drawLegend(r, ctx, theme, W, H);
  if (L.frame) drawSheetFrame(ctx, theme, W, H);
  if (L.scaleBar) drawSheetScale(r, ctx, theme, W, H);
  drawSheetTitle(r, ctx, theme, W, H, typeScale, opts.title, opts.subtitle);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

/**
 * The whole ground layer in a single ImageData pass.
 *
 * Painting a rectangle per cell is 273 000 fill calls and it dominates
 * everything else in the renderer by an order of magnitude. Compositing into a
 * pixel buffer and blitting once is the same picture in about a fortieth of the
 * time, and it is also the only way the hillshade can be a per-pixel multiply
 * rather than a second translucent pass.
 */
function paintGround(
  r: RegionData, ctx: Ctx, theme: CartoTheme, W: number, H: number, shading: boolean,
): void {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const m = r.margin;
  const GW = r.width;
  const RW = r.width - m * 2, RH = r.height - m * 2;
  const tint = new Int32Array(256 * 3).fill(-1);
  for (const k of Object.keys(COVER_TINT)) {
    const c = COVER_TINT[Number(k)];
    if (!c) continue;
    const [rr, gg, bb] = hexToRgb(c);
    tint[Number(k) * 3] = rr; tint[Number(k) * 3 + 1] = gg; tint[Number(k) * 3 + 2] = bb;
  }
  const [lr, lg, lb] = hexToRgb(theme.land.base);
  const [sr, sg, sb] = hexToRgb(theme.ocean.shallow);
  const [dr, dg, db] = hexToRgb(theme.ocean.deep);
  const alpha = theme.land.tintAlpha;
  const shadeAmt = shading ? theme.land.shading * 1.35 : 0;
  const deepAt = 0.35; // km — a regional sheet never shows abyssal ocean

  for (let y = 0; y < H; y++) {
    const ry = Math.min(RH - 1, (y * RH / H) | 0) + m;
    for (let x = 0; x < W; x++) {
      const rx = Math.min(RW - 1, (x * RW / W) | 0) + m;
      const i = ry * GW + rx;
      const o = (y * W + x) * 4;
      const w = r.water[i];

      if (w === 1 || w === 2) {
        const depth = Math.min(1, Math.max(0, -r.elevation[i]) / deepAt);
        const t = w === 2 ? 0.25 : depth;
        d[o] = sr + (dr - sr) * t;
        d[o + 1] = sg + (dg - sg) * t;
        d[o + 2] = sb + (db - sb) * t;
        continue;
      }

      const c = r.cover[i];
      let cr = lr, cg = lg, cb = lb;
      const ti = c * 3;
      if (tint[ti] >= 0) {
        cr = lr + (tint[ti] - lr) * alpha;
        cg = lg + (tint[ti + 1] - lg) * alpha;
        cb = lb + (tint[ti + 2] - lb) * alpha;
      }

      if (shadeAmt > 0) {
        // Hillshade from the north-west, the cartographic convention. Computed
        // from the sheet's own elevation, so the invented relief is lit too —
        // which is most of what sells it as terrain rather than as noise.
        const xm = i - 1, xp = i + 1;
        const ym = i - GW, yp = i + GW;
        const gx = (r.elevation[xp] - r.elevation[xm]) * 1000;
        const gy = (r.elevation[yp] - r.elevation[ym]) * 1000;
        const nz = 2 * r.metresPerCell;
        const len = Math.hypot(gx, gy, nz) || 1;
        // Light from NW, 45° altitude.
        const lum = (-gx * 0.5 - gy * 0.5 + nz * 0.7071) / len;
        const k = 1 + (lum - 0.62) * shadeAmt * 1.9;
        cr *= k; cg *= k; cb *= k;
      }

      d[o] = cr < 0 ? 0 : cr > 255 ? 255 : cr;
      d[o + 1] = cg < 0 ? 0 : cg > 255 ? 255 : cg;
      d[o + 2] = cb < 0 ? 0 : cb > 255 ? 255 : cb;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Contours
// ---------------------------------------------------------------------------

/**
 * Contour interval, chosen so the sheet carries roughly 12–24 lines.
 *
 * A fixed interval is wrong at both ends: 20 m across a delta is a solid black
 * page, and 20 m across a cordillera is a moiré. Picking the interval from the
 * sheet's own relief is what a real map series does when it changes interval
 * between the lowland and the mountain sheets.
 */
function contourInterval(r: RegionData): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < r.elevation.length; i += 7) {
    if (r.water[i] !== 0) continue;
    const e = r.elevation[i];
    if (e < lo) lo = e;
    if (e > hi) hi = e;
  }
  if (!isFinite(lo) || hi <= lo) return 0;
  const rangeM = (hi - lo) * 1000;
  const raw = rangeM / 16;
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  return steps.reduce((best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best), 10);
}

function drawContours(
  r: RegionData, ctx: Ctx, theme: CartoTheme,
  px: (x: number) => number, py: (y: number) => number, s: number,
  W0: number, H0: number,
): void {
  const interval = contourInterval(r);
  if (interval <= 0) return;
  // Contour the LAND only: an isoline that runs out into the sea and back is a
  // bathymetric line pretending to be a hill.
  const field = new Float32Array(r.elevation.length);
  for (let i = 0; i < field.length; i++) {
    field[i] = r.water[i] === 1 ? -9999 : r.elevation[i] * 1000;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < field.length; i++) {
    if (field[i] < -8000) continue;
    if (field[i] < lo) lo = field[i];
    if (field[i] > hi) hi = field[i];
  }
  if (!isFinite(lo)) return;

  const first = Math.ceil(lo / interval) * interval;
  const ink = theme.mountains.ink;
  ctx.save();
  // Index contours get their height written on them, because a contour without a
  // number tells you the ground is uneven and nothing else. Collected first and
  // drawn last, so a number is never crossed by a later line.
  const numbers: { x: number; y: number; a: number; text: string }[] = [];
  const spacingPx = Math.max(180, Math.min(W0, H0) * 0.5);

  for (let level = first; level <= hi; level += interval) {
    if (level <= 0) continue;
    const index = Math.round(level / interval);
    const bold = index % 5 === 0;
    ctx.strokeStyle = ink;
    ctx.globalAlpha = bold ? 0.62 : 0.36;
    ctx.lineWidth = Math.max(0.5, s * (bold ? 0.36 : 0.2));
    for (const c of marchingSquares(field, r.width, r.height, level, false)) {
      if (c.pts.length < 6) continue;
      const pts = smoothContour(c.pts, c.closed, 2);
      ctx.beginPath();
      ctx.moveTo(px(pts[0].x), py(pts[0].y));
      for (let k = 1; k < pts.length; k++) ctx.lineTo(px(pts[k].x), py(pts[k].y));
      if (c.closed) ctx.closePath();
      ctx.stroke();

      if (!bold || pts.length < 40) continue;
      // Walk the line and drop a number every so often, on the straightest bit
      // available — a number on a hairpin is unreadable at any size.
      let run = 0;
      for (let k = 6; k < pts.length - 6; k++) {
        const ax = px(pts[k].x), ay = py(pts[k].y);
        const bx = px(pts[k - 1].x), by = py(pts[k - 1].y);
        run += Math.hypot(ax - bx, ay - by);
        if (run < spacingPx) continue;
        const p0 = pts[k - 5], p1 = pts[k + 5];
        const dx = px(p1.x) - px(p0.x), dy = py(p1.y) - py(p0.y);
        const chord = Math.hypot(dx, dy);
        let arc = 0;
        for (let q = k - 5; q < k + 5; q++) {
          arc += Math.hypot(px(pts[q + 1].x) - px(pts[q].x), py(pts[q + 1].y) - py(pts[q].y));
        }
        if (arc <= 0 || chord / arc < 0.93) continue;   // too curved here
        if (ax < 30 || ay < 30 || ax > W0 - 30 || ay > H0 - 30) continue;
        let a = Math.atan2(dy, dx);
        if (a > Math.PI / 2) a -= Math.PI;
        if (a < -Math.PI / 2) a += Math.PI;
        numbers.push({ x: ax, y: ay, a, text: String(Math.round(level)) });
        run = 0;
      }
    }
  }
  ctx.globalAlpha = 1;

  const size = Math.max(7, s * 2.4);
  ctx.font = `500 ${size}px ${theme.type.body}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const nmb of numbers) {
    ctx.save();
    ctx.translate(nmb.x, nmb.y);
    ctx.rotate(nmb.a);
    ctx.strokeStyle = theme.paper.base;
    ctx.lineWidth = size * 0.65;
    ctx.lineJoin = 'round';
    ctx.strokeText(nmb.text, 0, 0);
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.85;
    ctx.fillText(nmb.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Water edges
// ---------------------------------------------------------------------------

function drawWaterEdges(
  r: RegionData, ctx: Ctx, theme: CartoTheme,
  px: (x: number) => number, py: (y: number) => number, s: number,
): void {
  const mask = new Float32Array(r.water.length);
  for (let i = 0; i < mask.length; i++) mask[i] = r.water[i] === 1 ? 1 : 0;
  const lakes = new Float32Array(r.water.length);
  for (let i = 0; i < mask.length; i++) lakes[i] = r.water[i] === 2 ? 1 : 0;

  const stroke = (field: Float32Array, color: string, width: number, rings: boolean) => {
    const cs = marchingSquares(field, r.width, r.height, 0.5, false);
    if (rings) {
      // Wonderdraft's coastal effect: a few offset lines fading seaward. Drawn
      // by stroking the same path with a growing width and falling alpha, which
      // is a cheap and surprisingly convincing stand-in for a real offset.
      const cfg = theme.ocean.rings;
      for (let k = cfg.count; k >= 1; k--) {
        ctx.strokeStyle = cfg.color;
        ctx.globalAlpha = cfg.alpha * Math.pow(cfg.falloff, k - 1) * 0.8;
        ctx.lineWidth = Math.max(1, s * cfg.spacing * 0.34 * k);
        for (const c of cs) {
          if (c.pts.length < 5) continue;
          const pts = smoothContour(c.pts, c.closed, 2);
          ctx.beginPath();
          ctx.moveTo(px(pts[0].x), py(pts[0].y));
          for (let q = 1; q < pts.length; q++) ctx.lineTo(px(pts[q].x), py(pts[q].y));
          if (c.closed) ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = 1;
    for (const c of cs) {
      if (c.pts.length < 5) continue;
      const pts = smoothContour(c.pts, c.closed, 2);
      ctx.beginPath();
      ctx.moveTo(px(pts[0].x), py(pts[0].y));
      for (let q = 1; q < pts.length; q++) ctx.lineTo(px(pts[q].x), py(pts[q].y));
      if (c.closed) ctx.closePath();
      ctx.stroke();
    }
  };

  ctx.save();
  stroke(mask, theme.coastline.color, Math.max(1, s * 0.55), true);
  stroke(lakes, theme.lakes.stroke, Math.max(0.8, s * 0.4), false);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Vegetation
// ---------------------------------------------------------------------------

const CONIFER_BIOMES = new Set<number>([
  Biome.BorealForest, Biome.MontaneForest, Biome.Alpine, Biome.Tundra,
]);
const PALM_BIOMES = new Set<number>([
  Biome.TropicalRainforest, Biome.TropicalForest, Biome.MonsoonForest, Biome.Mangrove,
]);

/**
 * Trees, tufts, dunes and cactus, scattered on a jittered lattice.
 *
 * The lattice is in SHEET cells rather than in world coordinates, unlike the
 * habitation lattice, because a tree is not a place: nobody notices that an
 * individual oak moved when they panned, and paying for world-stable scatter
 * here would cost a hash per symbol for no perceptible gain.
 */
function drawVegetation(
  r: RegionData, ctx: Ctx, theme: CartoTheme,
  px: (x: number) => number, py: (y: number) => number, s: number,
  rng: Rng, density: number,
): void {
  const RW = r.width, RH = r.height;
  // One symbol per ~3.4 sheet cells, so a wood reads as a canopy rather than as
  // a row of lollipops, and a big sheet does not cost a million draws.
  const step = Math.max(2, Math.round(3.4 / Math.max(0.35, density)));
  const size = Math.max(2.2, s * 2.6);

  type Sym = { x: number; y: number; kind: number; h: number };
  const syms: Sym[] = [];

  const m = r.margin;
  for (let y = Math.max(1, m - step); y < r.height - m + step && y < RH - 1; y += step) {
    for (let x = Math.max(1, m - step); x < r.width - m + step && x < RW - 1; x += step) {
      const jx = x + (rng() - 0.5) * step * 1.35;
      const jy = y + (rng() - 0.5) * step * 1.35;
      const xi = Math.min(RW - 1, Math.max(0, Math.round(jx)));
      const yi = Math.min(RH - 1, Math.max(0, Math.round(jy)));
      const i = yi * RW + xi;
      const c = r.cover[i];
      if (c === Cover.Sea || c === Cover.Lake) continue;
      const b = r.biome[i];

      if (c === Cover.Wood || c === Cover.Coppice) {
        if (c === Cover.Coppice && rng() < 0.45) continue;
        // Thinning by height: a wood is not a uniform stand, and drawing it as
        // one produces a green rug of identical lollipops. Trees drop out where
        // the ground rises toward the treeline and where it is dry, which is
        // both true and — more to the point — visible.
        const thin = r.elevation[i] > 1.1 ? 0.45 : r.elevation[i] > 0.7 ? 0.72 : 0.92;
        if (rng() > thin) continue;
        // Conifers take over with height rather than by biome alone: the same
        // wood is oak at the bottom and pine at the top, which is what a real
        // hillside looks like.
        const conif = CONIFER_BIOMES.has(b) ? 0.86
          : Math.min(0.8, Math.max(0, (r.elevation[i] - 0.45) * 1.5));
        const kind = PALM_BIOMES.has(b) ? 2 : rng() < conif ? 1 : 0;
        syms.push({
          x: jx, y: jy, kind,
          h: size * (c === Cover.Coppice ? 0.7 : 1) * (0.66 + rng() * 0.78),
        });
      } else if (c === Cover.Marsh && rng() < 0.55) {
        syms.push({ x: jx, y: jy, kind: 3, h: size * 0.8 });
      } else if (c === Cover.Dune) {
        syms.push({ x: jx, y: jy, kind: 4, h: size * 1.5 });
      } else if (c === Cover.Waste && rng() < 0.12) {
        syms.push({ x: jx, y: jy, kind: 5, h: size * 0.8 });
      } else if (c === Cover.Orchard) {
        syms.push({ x: jx, y: jy, kind: 0, h: size * 0.6 });
      } else if ((c === Cover.Scrub || c === Cover.Heath) && rng() < 0.2) {
        syms.push({ x: jx, y: jy, kind: 6, h: size * 0.5 });
      }
    }
  }

  // Painter's order, or the shadows stack wrong and a wood looks flat.
  syms.sort((a, b) => a.y - b.y);
  ctx.save();
  for (const sym of syms) {
    ctx.save();
    ctx.translate(px(sym.x), py(sym.y));
    switch (sym.kind) {
      case 0: drawBroadleaf(ctx, rng, theme, sym.h); break;
      case 1: drawConifer(ctx, rng, theme, sym.h); break;
      case 2: drawPalm(ctx, rng, theme, sym.h); break;
      case 3: drawMarsh(ctx, rng, theme, sym.h); break;
      case 4: drawDune(ctx, rng, theme, sym.h); break;
      case 5: drawCactus(ctx, rng, theme, sym.h); break;
      default: {
        // Scrub: two short strokes, the standard "rough grazing" mark.
        ctx.strokeStyle = theme.forest.ink;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = Math.max(0.4, s * 0.16);
        ctx.beginPath();
        ctx.moveTo(-sym.h * 0.4, 0); ctx.lineTo(0, -sym.h * 0.55);
        ctx.lineTo(sym.h * 0.4, 0);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Enclosures
// ---------------------------------------------------------------------------

function drawEnclosures(
  r: RegionData, ctx: Ctx, theme: CartoTheme,
  px: (x: number) => number, py: (y: number) => number, s: number, rng: Rng,
): void {
  ctx.save();
  ctx.setLineDash([]);

  // Washes first, so every boundary line lands on top of its own field.
  for (const f of r.fields) {
    const p = f.poly;
    const wash = f.cover === Cover.Arable ? '#e6d8a6'
      : (f.cover === Cover.Vineyard || f.cover === Cover.Orchard) ? '#c8cf92' : null;
    if (!wash) continue;
    ctx.beginPath();
    ctx.moveTo(px(p[0].x), py(p[0].y));
    for (let k = 1; k < p.length; k++) ctx.lineTo(px(p[k].x), py(p[k].y));
    ctx.closePath();
    ctx.fillStyle = wash;
    ctx.globalAlpha = 0.3;
    ctx.fill();
  }

  // Then the boundaries that survived — NOT one closed outline per parcel. The
  // outlines were what made the sheet look like graph paper: every field the
  // same size, every corner a right angle, the whole parish under a net.
  const lw = Math.max(0.6, s * 0.2);
  ctx.strokeStyle = theme.forest.ink;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (const h of r.hedges) {
    if (h.length < 2) continue;
    ctx.moveTo(px(h[0].x), py(h[0].y));
    for (let k = 1; k < h.length; k++) ctx.lineTo(px(h[k].x), py(h[k].y));
  }
  ctx.stroke();

  // Head-dyke last and heaviest: on a real sheet it is the line the eye uses to
  // read where the parish stops and the hill begins.
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(0.7, s * 0.32);
  for (const h of r.dykes) {
    if (h.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(px(h[0].x), py(h[0].y));
    for (let k = 1; k < h.length; k++) ctx.lineTo(px(h[k].x), py(h[k].y));
    ctx.stroke();
  }

  ctx.lineWidth = lw;
  for (const f of r.fields) {
    const p = f.poly;
    // Strip fields: furrow lines along the long axis, no cross-hedges. This is
    // the visual difference between open-field and enclosed country, and it is
    // one of the few things that dates a landscape at a glance.
    if (f.strip) {
      const ax = p[1].x - p[0].x, ay = p[1].y - p[0].y;
      const bx = p[3].x - p[0].x, by = p[3].y - p[0].y;
      const along = Math.hypot(ax, ay) > Math.hypot(bx, by);
      const n = 3 + Math.floor(rng() * 3);
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = lw * 0.7;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const s0 = along
          ? { x: p[0].x + bx * t, y: p[0].y + by * t }
          : { x: p[0].x + ax * t, y: p[0].y + ay * t };
        const s1 = along
          ? { x: p[1].x + (p[2].x - p[1].x) * t, y: p[1].y + (p[2].y - p[1].y) * t }
          : { x: p[3].x + (p[2].x - p[3].x) * t, y: p[3].y + (p[2].y - p[3].y) * t };
        ctx.beginPath();
        ctx.moveTo(px(s0.x), py(s0.y));
        ctx.lineTo(px(s1.x), py(s1.y));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

function drawStreams(
  r: RegionData, ctx: Ctx, theme: CartoTheme,
  px: (x: number) => number, py: (y: number) => number, s: number,
): void {
  ctx.save();
  ctx.strokeStyle = theme.rivers.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Widest last, so a tributary never draws over the trunk it joins.
  const sorted = [...r.streams].sort((a, b) => a.areaKm2 - b.areaKm2);
  for (const st of sorted) {
    if (st.pts.length < 3) continue;
    // Width from the SQUARE ROOT of the catchment, which is roughly how channel
    // width actually scales with drainage area. Using the sheet-relative rank
    // instead (the obvious thing) makes every brook on a dry sheet as wide as
    // the Rhine, because it is the widest thing present.
    // A minimum of two thirds of a pixel, not a quarter: thinner than that the
    // line is anti-aliased into invisibility, and combining a sub-pixel width
    // with a 55 % alpha — which is what the first version did — made the entire
    // drainage network vanish from the sheet.
    const w = Math.min(s * 3.2,
      Math.max(0.7, s * (0.2 + 0.055 * Math.sqrt(st.areaKm2)) * (st.trunk ? 1.25 : 1)));
    ctx.lineWidth = w;
    ctx.globalAlpha = w <= 0.75 ? 0.8 : 1;
    ctx.beginPath();
    ctx.moveTo(px(st.pts[0].x), py(st.pts[0].y));
    for (let k = 1; k < st.pts.length; k++) ctx.lineTo(px(st.pts[k].x), py(st.pts[k].y));
    ctx.stroke();
    // A casing line on the big ones only: on a brook it doubles the width and
    // turns the whole drainage into a black net.
    if (w > s * 1.5) {
      ctx.strokeStyle = theme.lakes.stroke;
      ctx.lineWidth = Math.max(0.35, s * 0.16);
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.rivers.color;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ways
// ---------------------------------------------------------------------------

function drawTracks(
  r: RegionData, ctx: Ctx, theme: CartoTheme,
  px: (x: number) => number, py: (y: number) => number, s: number,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const order: Record<string, number> = { path: 0, lane: 1, road: 2 };
  const sorted = [...r.tracks].sort((a, b) => order[a.kind] - order[b.kind]);
  for (const t of sorted) {
    if (t.pts.length < 2) continue;
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(px(t.pts[0].x), py(t.pts[0].y));
      for (let k = 1; k < t.pts.length; k++) ctx.lineTo(px(t.pts[k].x), py(t.pts[k].y));
    };
    if (t.kind === 'road') {
      // Casing + fill: a highway is a strip of made ground, not a line.
      trace();
      ctx.setLineDash([]);
      ctx.strokeStyle = theme.roads.major;
      ctx.lineWidth = Math.max(1.4, s * 0.9);
      ctx.globalAlpha = 0.95;
      ctx.stroke();
      trace();
      ctx.strokeStyle = theme.paper.base;
      ctx.lineWidth = Math.max(0.5, s * 0.42);
      ctx.globalAlpha = 0.85;
      ctx.stroke();
    } else if (t.kind === 'lane') {
      trace();
      ctx.setLineDash([]);
      ctx.strokeStyle = theme.roads.minor;
      ctx.lineWidth = Math.max(0.7, s * 0.42);
      ctx.globalAlpha = 0.9;
      ctx.stroke();
    } else {
      trace();
      ctx.setLineDash([s * 1.4, s * 1.1]);
      ctx.strokeStyle = theme.roads.minor;
      ctx.lineWidth = Math.max(0.45, s * 0.24);
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

function drawPlaces(
  r: RegionData, ctx: Ctx, theme: CartoTheme,
  px: (x: number) => number, py: (y: number) => number, s: number, rng: Rng,
): void {
  ctx.save();
  const ink = theme.settlement.ink;
  const fill = theme.settlement.fill;
  const u = Math.max(1.6, s * 1.5); // one "building" unit

  const sorted = [...r.places].sort((a, b) => a.y - b.y);
  for (const p of sorted) {
    const x = px(p.x), y = py(p.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = ink;
    ctx.fillStyle = fill;
    ctx.lineWidth = Math.max(0.4, s * 0.2);

    switch (p.kind) {
      case 'town': {
        // A cluster of blocks with a wall ring: recognisably the same town the
        // world map draws as a dot and the city generator draws as a plan.
        const rad = u * (2.2 + p.importance * 3.4);
        ctx.beginPath();
        ctx.arc(0, 0, rad, 0, Math.PI * 2);
        ctx.fillStyle = theme.settlement.capitalFill;
        ctx.globalAlpha = 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = Math.max(0.7, s * 0.34);
        ctx.stroke();
        const n = 5 + Math.floor(p.importance * 9);
        for (let k = 0; k < n; k++) {
          const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * rad * 0.8;
          block(ctx, Math.cos(a) * d, Math.sin(a) * d, u * 0.8, ink, fill);
        }
        break;
      }
      case 'village': {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + rng(), d = u * (0.5 + rng() * 1.1);
          block(ctx, Math.cos(a) * d, Math.sin(a) * d, u * 0.72, ink, fill);
        }
        church(ctx, 0, 0, u * 1.05, ink, fill);
        break;
      }
      case 'hamlet': {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + rng(), d = u * 0.75;
          block(ctx, Math.cos(a) * d, Math.sin(a) * d, u * 0.62, ink, fill);
        }
        break;
      }
      case 'farm':
        block(ctx, 0, 0, u * 0.62, ink, fill);
        break;
      case 'abbey':
        church(ctx, 0, 0, u * 1.5, ink, theme.settlement.capitalFill);
        break;
      case 'shrine':
        cross(ctx, 0, 0, u * 0.9, ink, s);
        break;
      case 'mill': {
        ctx.beginPath();
        ctx.arc(0, 0, u * 0.6, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.4;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * u * 0.6, Math.sin(a) * u * 0.6);
        }
        ctx.stroke();
        break;
      }
      case 'tower': {
        ctx.beginPath();
        ctx.rect(-u * 0.32, -u * 1.3, u * 0.64, u * 1.3);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-u * 0.45, -u * 1.3);
        ctx.lineTo(u * 0.45, -u * 1.3);
        ctx.stroke();
        break;
      }
      case 'inn': {
        block(ctx, 0, 0, u * 0.7, ink, fill);
        ctx.beginPath();
        ctx.moveTo(u * 0.5, -u * 0.35);
        ctx.lineTo(u * 1.0, -u * 0.35);
        ctx.stroke();
        break;
      }
      case 'quarry':
      case 'mine': {
        ctx.beginPath();
        // Crossed hammers, reduced to two strokes at this size.
        ctx.moveTo(-u * 0.55, u * 0.45); ctx.lineTo(u * 0.55, -u * 0.45);
        ctx.moveTo(u * 0.55, u * 0.45); ctx.lineTo(-u * 0.55, -u * 0.45);
        ctx.lineWidth = Math.max(0.6, s * 0.3);
        ctx.stroke();
        break;
      }
      case 'bridge': {
        ctx.beginPath();
        ctx.arc(0, u * 0.2, u * 0.55, Math.PI, 0);
        ctx.lineWidth = Math.max(0.6, s * 0.3);
        ctx.stroke();
        break;
      }
      case 'ford': {
        ctx.beginPath();
        ctx.moveTo(-u * 0.6, -u * 0.2); ctx.lineTo(u * 0.6, -u * 0.2);
        ctx.moveTo(-u * 0.6, u * 0.25); ctx.lineTo(u * 0.6, u * 0.25);
        ctx.lineWidth = Math.max(0.5, s * 0.24);
        ctx.setLineDash([s * 0.7, s * 0.5]);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'landmark': {
        ctx.lineWidth = Math.max(0.55, s * 0.26);
        switch (p.landmark) {
          case 'waterfall': {
            // Three chevrons across the channel: the standard fall mark, and
            // legible at a size where a picture of falling water would not be.
            for (let k = 0; k < 3; k++) {
              const yy = -u * 0.5 + k * u * 0.5;
              ctx.beginPath();
              ctx.moveTo(-u * 0.7, yy);
              ctx.lineTo(0, yy + u * 0.32);
              ctx.lineTo(u * 0.7, yy);
              ctx.strokeStyle = theme.rivers.color;
              ctx.stroke();
            }
            break;
          }
          case 'spring': {
            ctx.beginPath();
            ctx.arc(0, 0, u * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = theme.rivers.color;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, 0, u * 0.72, -0.6, Math.PI + 0.6);
            ctx.strokeStyle = theme.rivers.color;
            ctx.stroke();
            break;
          }
          case 'gorge': {
            // Two hachured lips facing each other.
            ctx.strokeStyle = ink;
            for (const side of [-1, 1]) {
              ctx.beginPath();
              ctx.moveTo(-u, side * u * 0.55);
              ctx.lineTo(u, side * u * 0.55);
              ctx.stroke();
              for (let k = -2; k <= 2; k++) {
                ctx.beginPath();
                ctx.moveTo(k * u * 0.42, side * u * 0.55);
                ctx.lineTo(k * u * 0.42, side * u * 0.2);
                ctx.stroke();
              }
            }
            break;
          }
          case 'crag': {
            ctx.strokeStyle = ink;
            ctx.beginPath();
            ctx.moveTo(-u * 0.8, u * 0.5);
            ctx.lineTo(-u * 0.2, -u * 0.6);
            ctx.lineTo(u * 0.15, -u * 0.05);
            ctx.lineTo(u * 0.55, -u * 0.75);
            ctx.lineTo(u * 0.9, u * 0.5);
            ctx.closePath();
            ctx.fillStyle = theme.hills.light;
            ctx.fill();
            ctx.stroke();
            break;
          }
          case 'cave': {
            ctx.strokeStyle = ink;
            ctx.beginPath();
            ctx.arc(0, u * 0.35, u * 0.55, Math.PI, 0);
            ctx.lineTo(u * 0.55, u * 0.35);
            ctx.lineTo(-u * 0.55, u * 0.35);
            ctx.fillStyle = ink;
            ctx.globalAlpha = 0.75;
            ctx.fill();
            ctx.globalAlpha = 1;
            break;
          }
          case 'volcano': {
            ctx.strokeStyle = ink;
            ctx.beginPath();
            ctx.moveTo(-u * 1.1, u * 0.6);
            ctx.lineTo(-u * 0.3, -u * 0.8);
            ctx.lineTo(u * 0.3, -u * 0.8);
            ctx.lineTo(u * 1.1, u * 0.6);
            ctx.closePath();
            ctx.fillStyle = theme.mountains.shadow;
            ctx.fill();
            ctx.stroke();
            break;
          }
          case 'hotspring': {
            ctx.strokeStyle = theme.rivers.color;
            for (let k = -1; k <= 1; k++) {
              ctx.beginPath();
              ctx.moveTo(k * u * 0.4, u * 0.5);
              ctx.quadraticCurveTo(k * u * 0.4 + u * 0.3, 0, k * u * 0.4, -u * 0.6);
              ctx.stroke();
            }
            break;
          }
          case 'pass': {
            // Two contours pinching: the way a pass reads on a real sheet.
            ctx.strokeStyle = ink;
            for (const side of [-1, 1]) {
              ctx.beginPath();
              ctx.moveTo(-u, side * u);
              ctx.quadraticCurveTo(0, side * u * 0.18, u, side * u);
              ctx.stroke();
            }
            break;
          }
          default: break;
        }
        break;
      }
      case 'ruin': {
        // Broken wall stubs — the same language the world map uses.
        ctx.lineWidth = Math.max(0.5, s * 0.26);
        ctx.beginPath();
        ctx.moveTo(-u * 0.7, u * 0.4); ctx.lineTo(-u * 0.7, -u * 0.5);
        ctx.moveTo(-u * 0.1, u * 0.4); ctx.lineTo(-u * 0.1, -u * 0.15);
        ctx.moveTo(u * 0.6, u * 0.4); ctx.lineTo(u * 0.6, -u * 0.7);
        ctx.moveTo(-u * 0.9, u * 0.4); ctx.lineTo(u * 0.8, u * 0.4);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

function block(ctx: Ctx, x: number, y: number, w: number, ink: string, fill: string): void {
  ctx.beginPath();
  ctx.rect(x - w / 2, y - w / 2, w, w * 0.82);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.stroke();
}

function church(ctx: Ctx, x: number, y: number, w: number, ink: string, fill: string): void {
  ctx.beginPath();
  ctx.rect(x - w * 0.5, y - w * 0.35, w, w * 0.7);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - w * 0.3, y - w * 0.35);
  ctx.lineTo(x - w * 0.3, y - w * 1.05);
  ctx.moveTo(x - w * 0.48, y - w * 0.78);
  ctx.lineTo(x - w * 0.12, y - w * 0.78);
  ctx.stroke();
}

function cross(ctx: Ctx, x: number, y: number, w: number, ink: string, s: number): void {
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.5, s * 0.24);
  ctx.beginPath();
  ctx.moveTo(x, y + w * 0.5); ctx.lineTo(x, y - w * 0.6);
  ctx.moveTo(x - w * 0.3, y - w * 0.25); ctx.lineTo(x + w * 0.3, y - w * 0.25);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

interface Rect { x: number; y: number; w: number; h: number }

function drawLabels(
  r: RegionData, ctx: Ctx, theme: CartoTheme,
  px: (x: number) => number, py: (y: number) => number, s: number,
  W: number, H: number, typeScale: number,
): void {
  const taken: Rect[] = [];
  const fits = (rect: Rect): boolean => {
    if (rect.x < 4 || rect.y < 4 || rect.x + rect.w > W - 4 || rect.y + rect.h > H - 4) return false;
    for (const o of taken) {
      if (rect.x - 2 < o.x + o.w && rect.x + rect.w + 2 > o.x
        && rect.y - 2 < o.y + o.h && rect.y + rect.h + 2 > o.y) return false;
    }
    return true;
  };

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // Rivers first: they run through everything, and a name shouldered aside by a
  // hamlet ends up nowhere sensible.
  const streams = [...r.streams].filter((x) => x.name).sort((a, b) => b.areaKm2 - a.areaKm2);
  const seenRiver = new Set<string>();
  for (const st of streams) {
    if (!st.name || seenRiver.has(st.name)) continue;
    const size = Math.max(7, s * 3.1 * typeScale);
    ctx.font = `italic 400 ${size}px ${theme.type.body}`;
    const mid = st.pts[st.pts.length >> 1];
    const w = ctx.measureText(st.name).width;
    const rect = { x: px(mid.x) - w / 2, y: py(mid.y) - size / 2 - size * 0.9, w, h: size };
    if (!fits(rect)) continue;
    taken.push(rect);
    seenRiver.add(st.name);
    ctx.textAlign = 'center';
    ctx.strokeStyle = theme.type.halo;
    ctx.lineWidth = Math.max(2, size * 0.34);
    ctx.fillStyle = theme.rivers.color;
    ctx.strokeText(st.name, px(mid.x), rect.y + size / 2);
    ctx.fillText(st.name, px(mid.x), rect.y + size / 2);
  }

  // Then places, biggest first.
  const RANK: Record<string, number> = {
    town: 0, abbey: 1, village: 2, ruin: 3, tower: 4, mill: 5, inn: 5,
    hamlet: 6, quarry: 7, mine: 7, bridge: 8, ford: 8, farm: 9, shrine: 9,
  };
  // Landmarks are not one rank. A volcano outranks a market town; a spring is
  // the last thing on the page that deserves a name, and treating the two the
  // same is how a sheet ends up with forty "Fuente de…" labels and no villages.
  const LANDMARK_RANK: Partial<Record<string, number>> = {
    volcano: 1, lake: 3, waterfall: 3, gorge: 4, pass: 4, cave: 5, crag: 6,
    hotspring: 5, spring: 8, island: 5, moss: 8,
  };
  const rankOf = (p: { kind: string; landmark?: string }) =>
    (p.kind === 'landmark' ? (LANDMARK_RANK[p.landmark ?? ''] ?? 6) : (RANK[p.kind] ?? 9));
  const places = [...r.places]
    .filter((p) => p.x > r.margin && p.x < r.width - r.margin
      && p.y > r.margin && p.y < r.height - r.margin)
    .sort((a, b) => (rankOf(a) - rankOf(b)) || (b.importance - a.importance));

  // A sheet can carry roughly one name per 9 000 px² before it stops being a
  // map and becomes a word search. Beyond that, the low ranks lose their names
  // and keep their symbols — which is exactly what a real map series does when
  // it generalises: the farm is still there, it just is not labelled.
  const budget = Math.round((W * H) / 15000);
  let used = 0;
  for (const p of places) {
    const rank = rankOf(p);
    if (used >= budget && rank > 2) continue;
    const size = Math.max(6, s * (rank === 0 ? 4.6 : rank <= 2 ? 3.5 : rank <= 5 ? 2.9 : 2.5) * typeScale);
    const caps = rank === 0;
    const weight = rank === 0 ? 600 : rank <= 2 ? 500 : 400;
    const italic = p.kind === 'ruin' || p.kind === 'ford' || p.kind === 'bridge' || p.kind === 'landmark';
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${rank <= 2 ? theme.type.display : theme.type.body}`;
    const text = caps ? p.name.toUpperCase() : p.name;
    const w = ctx.measureText(text).width;
    const anchorX = px(p.x), anchorY = py(p.y);
    const off = Math.max(3, s * (rank === 0 ? 4.4 : rank <= 2 ? 3 : 2.2));

    // Four candidate positions, in the order a cartographer prefers them.
    const cands: Rect[] = [
      { x: anchorX + off, y: anchorY - size / 2, w, h: size },
      { x: anchorX - off - w, y: anchorY - size / 2, w, h: size },
      { x: anchorX - w / 2, y: anchorY - off - size, w, h: size },
      { x: anchorX - w / 2, y: anchorY + off, w, h: size },
    ];
    const slot = cands.find(fits);
    if (!slot) continue;
    taken.push(slot);
    used++;
    ctx.textAlign = 'left';
    ctx.strokeStyle = theme.type.halo;
    ctx.lineWidth = Math.max(2, size * 0.36);
    ctx.fillStyle = theme.type.color;
    ctx.strokeText(text, slot.x, slot.y + size / 2);
    ctx.fillText(text, slot.x, slot.y + size / 2);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/**
 * A legend built from THIS sheet, not from the vocabulary.
 *
 * Listing all twenty covers on a sheet that contains four is how a legend
 * becomes furniture nobody reads. Counting what is actually on the page and
 * showing the six that matter makes it a thing the reader uses — and it also
 * quietly tells them what kind of country they are looking at before they have
 * looked at anything.
 */
function drawLegend(r: RegionData, ctx: Ctx, theme: CartoTheme, W: number, H: number): void {
  const m = r.margin;
  const counts = new Map<number, number>();
  let land = 0;
  for (let y = m; y < r.height - m; y += 2) {
    for (let x = m; x < r.width - m; x += 2) {
      const c = r.cover[y * r.width + x];
      if (c === Cover.Sea) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      land++;
    }
  }
  if (!land) return;
  const top = [...counts].sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v / land > 0.03).slice(0, 6);
  if (top.length < 2) return;

  const pad = Math.max(7, Math.min(W, H) * 0.018);
  const size = Math.max(8, W * 0.0085);
  const rowH = size * 1.55;
  ctx.save();
  ctx.font = `400 ${size}px ${theme.type.body}`;
  // Wide enough for the LONGEST label plus its percentage plus the swatch —
  // measuring only the label is how "bosque" and "34 %" ended up printed on top
  // of each other.
  let labelW = 0, pctW = 0;
  for (const [k, v] of top) {
    labelW = Math.max(labelW, ctx.measureText(COVER_LABEL_ES[k] ?? '').width);
    pctW = Math.max(pctW, ctx.measureText(`${Math.round((v / land) * 100)} %`).width);
  }
  const boxW = size * 0.7 + size * 1.5 + size * 0.9 + labelW + size * 0.9 + pctW + size * 0.6;
  const boxH = rowH * top.length + size * 1.5;
  const bx = W - pad * 2.6 - boxW, by = H - pad * 2.6 - boxH;

  ctx.fillStyle = theme.furniture.frameFill;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.furniture.frame;
  ctx.lineWidth = Math.max(0.7, size * 0.09);
  ctx.strokeRect(bx, by, boxW, boxH);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let y = by + size * 1.1;
  for (const [k, v] of top) {
    // Water has no cover tint — it is painted from the ocean ramp — so the
    // legend has to reach for the same colour the map used, or a lake shows up
    // in the key as a patch of bare paper.
    const tint = k === Cover.Lake ? theme.lakes.fill
      : k === Cover.Sea ? theme.ocean.shallow
        : COVER_TINT[k];
    ctx.fillStyle = tint ?? theme.land.base;
    ctx.fillRect(bx + size * 0.7, y - size * 0.42, size * 1.5, size * 0.84);
    ctx.strokeStyle = theme.furniture.ink;
    ctx.lineWidth = 0.6;
    ctx.strokeRect(bx + size * 0.7, y - size * 0.42, size * 1.5, size * 0.84);
    ctx.fillStyle = theme.furniture.ink;
    ctx.fillText(`${COVER_LABEL_ES[k] ?? k}`, bx + size * 2.6, y);
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.6;
    ctx.fillText(`${Math.round((v / land) * 100)} %`, bx + boxW - size * 0.6, y);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    y += rowH;
  }
  ctx.restore();
}

function drawSheetFrame(ctx: Ctx, theme: CartoTheme, W: number, H: number): void {
  const m = Math.max(7, Math.min(W, H) * 0.018);
  ctx.save();
  ctx.strokeStyle = theme.furniture.frame;
  ctx.lineWidth = Math.max(1.5, m * 0.16);
  ctx.strokeRect(m, m, W - m * 2, H - m * 2);
  ctx.lineWidth = Math.max(0.6, m * 0.06);
  ctx.strokeRect(m * 1.55, m * 1.55, W - m * 3.1, H - m * 3.1);
  ctx.restore();
}

function drawSheetScale(r: RegionData, ctx: Ctx, theme: CartoTheme, W: number, H: number): void {
  const kmPerPx = (r.metresPerCell / 1000) * ((r.width - r.margin * 2) / W);
  const targetPx = Math.min(220, Math.max(100, W * 0.16));
  const raw = targetPx * kmPerPx;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag)
    .reduce((best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best), mag);
  const barPx = nice / kmPerPx;
  const m = Math.max(7, Math.min(W, H) * 0.018);
  const h = Math.max(4, H * 0.008);
  const x = m * 2.6, y = H - m * 2.6 - h - 12;

  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = theme.furniture.ink;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? theme.furniture.frameFill : theme.furniture.ink;
    ctx.fillRect((i * barPx) / 4, 0, barPx / 4, h);
    ctx.strokeRect((i * barPx) / 4, 0, barPx / 4, h);
  }
  ctx.fillStyle = theme.furniture.ink;
  ctx.textBaseline = 'top';
  ctx.font = `400 ${Math.max(7, h * 1.6)}px ${theme.type.body}`;
  ctx.textAlign = 'left';
  ctx.fillText('0', 0, h + 3);
  ctx.textAlign = 'right';
  ctx.fillText(`${nice >= 1 ? Math.round(nice) : nice} km`, barPx, h + 3);
  ctx.restore();
}

function drawSheetTitle(
  r: RegionData, ctx: Ctx, theme: CartoTheme, W: number, H: number,
  typeScale: number, title?: string, subtitle?: string,
): void {
  const t = title ?? r.title;
  const sub = subtitle ?? r.subtitle;
  if (!t) return;
  const m = Math.max(7, Math.min(W, H) * 0.018);
  const size = Math.max(12, W * 0.026 * typeScale);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // A plate under the title rather than a halo: on a sheet this busy, haloed
  // display type at the top edge reads as a watermark.
  ctx.font = `600 ${size}px ${theme.type.display}`;
  const tracking = size * 0.16;
  const up = t.toUpperCase();
  const tw = [...up].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + tracking * (up.length - 1);
  ctx.font = `italic 400 ${size * 0.42}px ${theme.type.body}`;
  const sw = sub ? ctx.measureText(sub).width : 0;
  const boxW = Math.max(tw, sw) + size * 1.1;
  const boxH = size * (sub ? 2.1 : 1.5);
  const bx = m * 2.6, by = m * 2.2;

  ctx.fillStyle = theme.furniture.frameFill;
  ctx.globalAlpha = 0.82;
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.furniture.frame;
  ctx.lineWidth = Math.max(0.8, size * 0.05);
  ctx.strokeRect(bx, by, boxW, boxH);

  ctx.font = `600 ${size}px ${theme.type.display}`;
  ctx.fillStyle = theme.furniture.ink;
  let cursor = bx + size * 0.55;
  for (const ch of up) {
    const w = ctx.measureText(ch).width;
    ctx.fillText(ch, cursor, by + size * 1.05);
    cursor += w + tracking;
  }
  if (sub) {
    ctx.font = `italic 400 ${size * 0.42}px ${theme.type.body}`;
    ctx.fillStyle = theme.furniture.accent;
    ctx.fillText(sub, bx + size * 0.55, by + size * 1.72);
  }
  ctx.restore();
}
