// ============================================
// Cartography — Hand-placeable map stamps
// ============================================
// A small library of fantasy-map pictograms (houses, towers, temples, stones,
// swords...) drawn with plain Canvas 2D paths: no images, no fonts. The same
// `drawStamp` call is used by every renderer (atlas 2D canvas, parchment "Carta"
// canvas, 3D overlay canvas), so a stamp looks identical everywhere.
//
// Each glyph is authored in a unit design space: the glyph fits roughly in
// [-0.5, 0.5] on both axes, (0, 0) is the visual centre of its bounding box and
// +y points down. `drawStamp` translates to (x, y) and scales by the nominal
// pixel height, so the glyph functions never see pixels. Stroke widths are
// converted back to a constant 1.2-1.6 px so small stamps stay crisp.
//
// Palette: `ink` outlines and details, `paper` fills, `accent` is reserved for
// flags, fire, lava, roofs of capitals and swords. With `halo` the glyph is
// first drawn as a wide pale silhouette so it reads on dark terrain.

import type { Ctx } from './symbols';

export const STAMP_CATEGORIES = ['settlements', 'places', 'forts', 'nature'] as const;
export type StampCategory = typeof STAMP_CATEGORIES[number];

export const STAMP_SIZES = { S: 0.7, M: 1, L: 1.45 } as const;
export type StampSize = keyof typeof STAMP_SIZES;

export interface StampDef { id: string; category: StampCategory }

/** Every stamp, in display order (grouped by category). */
export const STAMPS = [
  { id: 'hamlet', category: 'settlements' },
  { id: 'village', category: 'settlements' },
  { id: 'town', category: 'settlements' },
  { id: 'city', category: 'settlements' },
  { id: 'capital', category: 'settlements' },
  { id: 'camp', category: 'settlements' },
  { id: 'inn', category: 'places' },
  { id: 'temple', category: 'places' },
  { id: 'shrine', category: 'places' },
  { id: 'monastery', category: 'places' },
  { id: 'mill', category: 'places' },
  { id: 'windmill', category: 'places' },
  { id: 'farm', category: 'places' },
  { id: 'mine', category: 'places' },
  { id: 'lighthouse', category: 'places' },
  { id: 'harbour', category: 'places' },
  { id: 'bridge', category: 'places' },
  { id: 'well', category: 'places' },
  { id: 'standingStones', category: 'places' },
  { id: 'barrow', category: 'places' },
  { id: 'ruins', category: 'places' },
  { id: 'battlefield', category: 'places' },
  { id: 'castle', category: 'forts' },
  { id: 'fort', category: 'forts' },
  { id: 'tower', category: 'forts' },
  { id: 'wizardTower', category: 'forts' },
  { id: 'motte', category: 'forts' },
  { id: 'walls', category: 'forts' },
  { id: 'mountain', category: 'nature' },
  { id: 'volcano', category: 'nature' },
  { id: 'forest', category: 'nature' },
  { id: 'cave', category: 'nature' },
] as const satisfies readonly StampDef[];

export type StampGlyph = typeof STAMPS[number]['id'];

const GLYPH_IDS: ReadonlySet<string> = new Set(STAMPS.map(s => s.id));

export function isStampGlyph(value: unknown): value is StampGlyph {
  return typeof value === 'string' && GLYPH_IDS.has(value);
}

// ---------------------------------------------------------------------------
// Drawing kit
// ---------------------------------------------------------------------------

interface G { c: Ctx; ink: string; paper: string; accent: string; lw: number; halo: boolean }
type Pt = readonly [number, number];
type Draw = (g: G) => void;
interface LineOpts { color?: string; w?: number; halo?: boolean }

const HALO = 'rgba(255,248,230,0.85)';

function trace(g: G, pts: readonly Pt[], close: boolean): void {
  g.c.beginPath();
  pts.forEach(([x, y], i) => { if (i) g.c.lineTo(x, y); else g.c.moveTo(x, y); });
  if (close) g.c.closePath();
}

/** Fill + stroke the current path. In the halo pass it paints a wide pale outline instead. */
function paint(g: G, fill: string | null, shade = false, wMul = 1): void {
  const c = g.c;
  if (g.halo) {
    c.fillStyle = HALO;
    if (fill) c.fill();
    c.strokeStyle = HALO;
    c.lineWidth = g.lw * (wMul + 2.8);
    c.stroke();
    return;
  }
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (shade) { c.save(); c.globalAlpha *= 0.2; c.fillStyle = g.ink; c.fill(); c.restore(); }
  c.strokeStyle = g.ink;
  c.lineWidth = g.lw * wMul;
  c.stroke();
}

/** Stroke the current open path; only drawn in the halo pass when `haloToo` is set. */
function strokeP(g: G, wMul: number, haloToo: boolean, color?: string): void {
  const c = g.c;
  if (g.halo) {
    if (!haloToo) return;
    c.strokeStyle = HALO;
    c.lineWidth = g.lw * (wMul + 2.8);
    c.stroke();
    return;
  }
  c.strokeStyle = color ?? g.ink;
  c.lineWidth = g.lw * wMul;
  c.stroke();
}

function poly(g: G, pts: readonly Pt[], fill: string | null = g.paper, shade = false): void {
  trace(g, pts, true);
  paint(g, fill, shade);
}

function box(g: G, x: number, y: number, w: number, h: number, fill: string | null = g.paper, shade = false): void {
  g.c.beginPath();
  g.c.rect(x, y, w, h);
  paint(g, fill, shade);
}

function ln(g: G, pts: readonly Pt[], o: LineOpts = {}): void {
  trace(g, pts, false);
  strokeP(g, o.w ?? 0.7, o.halo ?? false, o.color);
}

/** Solid fill of the current path (details only: skipped in the halo pass). */
function solid(g: G, color: string): void {
  if (g.halo) return;
  g.c.fillStyle = color;
  g.c.fill();
}

/** Darken the polygon with a translucent ink wash (light comes from the left). */
function shadeFill(g: G, pts: readonly Pt[]): void {
  if (g.halo) return;
  trace(g, pts, true);
  g.c.save();
  g.c.globalAlpha *= 0.22;
  g.c.fillStyle = g.ink;
  g.c.fill();
  g.c.restore();
}

/** Small ink rectangle: door, window, arrow slit. */
function mark(g: G, x: number, y: number, w: number, h: number): void {
  if (g.halo) return;
  g.c.fillStyle = g.ink;
  g.c.fillRect(x, y, w, h);
}

/** Arched doorway filled with a solid colour. */
function arch(g: G, cx: number, by: number, w: number, h: number, color: string): void {
  const c = g.c, r = w / 2;
  c.beginPath();
  c.moveTo(cx - r, by);
  c.lineTo(cx - r, by - h + r);
  c.arc(cx, by - h + r, r, Math.PI, 0);
  c.lineTo(cx + r, by);
  c.closePath();
  solid(g, color);
}

function dot(g: G, x: number, y: number, r: number, color: string): void {
  g.c.beginPath();
  g.c.arc(x, y, r, 0, Math.PI * 2);
  solid(g, color);
}

function wave(g: G, x0: number, x1: number, y: number, n: number, amp: number): void {
  const c = g.c, s = (x1 - x0) / n;
  c.beginPath();
  c.moveTo(x0, y);
  for (let i = 0; i < n; i++) c.quadraticCurveTo(x0 + (i + 0.5) * s, y + (i % 2 ? amp : -amp), x0 + (i + 1) * s, y);
  strokeP(g, 0.7, false);
}

/** Block with a battlemented top: `n` merlons between x0 and x1. */
function crenel(g: G, x0: number, x1: number, top: number, bot: number, n: number, d: number, fill: string = g.paper): void {
  const w = (x1 - x0) / (2 * n - 1);
  const pts: Pt[] = [];
  for (let i = 0; i < 2 * n - 1; i++) {
    const y = i % 2 === 0 ? top - d : top;
    pts.push([x0 + i * w, y], [x0 + (i + 1) * w, y]);
  }
  pts.push([x1, bot], [x0, bot]);
  poly(g, pts, fill);
}

function house(g: G, cx: number, by: number, w: number, h: number, rh: number, roof: string | null = g.paper): void {
  box(g, cx - w / 2, by - h, w, h);
  const o = w * 0.1;
  poly(g, [[cx - w / 2 - o, by - h], [cx, by - h - rh], [cx + w / 2 + o, by - h]], roof, true);
  mark(g, cx - w * 0.09, by - h * 0.5, w * 0.18, h * 0.5);
}

function flag(g: G, x: number, y: number, h: number): void {
  ln(g, [[x, y], [x, y - h]], { w: 0.9, halo: true });
  trace(g, [[x, y - h], [x + h * 0.75, y - h * 0.78], [x, y - h * 0.55]], true);
  paint(g, g.accent, false, 0.5);
}

function flame(g: G, cx: number, by: number, h: number): void {
  const c = g.c;
  c.beginPath();
  c.moveTo(cx - h * 0.34, by);
  c.quadraticCurveTo(cx - h * 0.45, by - h * 0.55, cx, by - h);
  c.quadraticCurveTo(cx + h * 0.05, by - h * 0.5, cx + h * 0.34, by - h * 0.2);
  c.quadraticCurveTo(cx + h * 0.4, by, cx - h * 0.34, by);
  c.closePath();
  paint(g, g.accent, false, 0.5);
}

function spark(g: G, x: number, y: number, r: number): void {
  poly(g, [[x, y - r], [x + r * 0.3, y - r * 0.3], [x + r, y], [x + r * 0.3, y + r * 0.3],
    [x, y + r], [x - r * 0.3, y + r * 0.3], [x - r, y], [x - r * 0.3, y - r * 0.3]], g.accent);
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

function hamlet(g: G): void {
  house(g, -0.2, 0.3, 0.42, 0.28, 0.24);
  house(g, 0.24, 0.34, 0.34, 0.22, 0.2);
}

function village(g: G): void {
  house(g, 0, 0.12, 0.36, 0.26, 0.24);
  house(g, -0.26, 0.4, 0.4, 0.26, 0.22);
  house(g, 0.27, 0.4, 0.36, 0.22, 0.2);
}

function town(g: G): void {
  box(g, -0.08, -0.3, 0.16, 0.4);
  poly(g, [[-0.11, -0.3], [0, -0.5], [0.11, -0.3]], g.paper, true);
  mark(g, -0.025, -0.2, 0.05, 0.09);
  house(g, -0.3, 0.1, 0.34, 0.2, 0.18);
  house(g, 0.3, 0.1, 0.34, 0.2, 0.18);
  house(g, -0.15, 0.42, 0.4, 0.24, 0.2);
  house(g, 0.25, 0.42, 0.38, 0.22, 0.2);
}

function city(g: G): void {
  house(g, -0.28, 0.06, 0.3, 0.16, 0.18);
  house(g, 0.28, 0.06, 0.3, 0.16, 0.18);
  box(g, -0.12, -0.26, 0.24, 0.34);
  poly(g, [[-0.15, -0.26], [0, -0.5], [0.15, -0.26]], g.paper, true);
  crenel(g, -0.36, 0.36, 0.05, 0.42, 4, 0.06);
  crenel(g, -0.5, -0.34, -0.1, 0.42, 2, 0.06);
  crenel(g, 0.34, 0.5, -0.1, 0.42, 2, 0.06);
  arch(g, 0, 0.42, 0.16, 0.24, g.ink);
  mark(g, -0.025, -0.14, 0.05, 0.1);
}

function capital(g: G): void {
  crenel(g, -0.17, 0.17, -0.22, 0.3, 3, 0.07);
  flag(g, 0, -0.29, 0.2);
  mark(g, -0.05, -0.12, 0.04, 0.1);
  mark(g, 0.01, -0.12, 0.04, 0.1);
  crenel(g, -0.5, 0.5, 0.12, 0.42, 6, 0.06);
  for (const x of [-0.33, 0.33]) {
    box(g, x - 0.08, -0.06, 0.16, 0.48);
    poly(g, [[x - 0.11, -0.06], [x, -0.3], [x + 0.11, -0.06]], g.accent, false);
    mark(g, x - 0.02, 0.04, 0.04, 0.09);
  }
  arch(g, 0, 0.42, 0.18, 0.26, g.ink);
}

function camp(g: G): void {
  poly(g, [[-0.5, 0.4], [-0.2, -0.28], [0.1, 0.4]], g.paper, true);
  poly(g, [[-0.2, -0.06], [-0.1, 0.4], [-0.3, 0.4]], g.ink);
  ln(g, [[-0.2, -0.28], [-0.2, -0.42]], { w: 0.8, halo: true });
  ln(g, [[-0.2, -0.42], [-0.08, -0.38], [-0.2, -0.34]], { w: 0.8, color: g.accent });
  flame(g, 0.32, 0.3, 0.26);
  ln(g, [[0.2, 0.42], [0.44, 0.33]], { w: 1.1, halo: true });
  ln(g, [[0.2, 0.33], [0.44, 0.42]], { w: 1.1, halo: true });
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

function inn(g: G): void {
  box(g, -0.24, -0.4, 0.08, 0.2);
  house(g, -0.1, 0.45, 0.6, 0.4, 0.36);
  mark(g, -0.34, 0.14, 0.09, 0.09);
  mark(g, 0.1, 0.14, 0.09, 0.09);
  ln(g, [[0.2, -0.02], [0.44, -0.02]], { w: 0.8, halo: true });
  ln(g, [[0.38, -0.02], [0.38, 0.04]], { w: 0.5 });
  box(g, 0.3, 0.04, 0.16, 0.16, g.accent);
}

function temple(g: G): void {
  poly(g, [[-0.46, -0.12], [0, -0.46], [0.46, -0.12]], g.paper, true);
  box(g, -0.46, -0.12, 0.92, 0.07);
  box(g, -0.4, -0.05, 0.8, 0.37);
  for (const x of [-0.28, -0.09, 0.09, 0.28]) ln(g, [[x, -0.03], [x, 0.3]], { w: 1.2 });
  box(g, -0.5, 0.32, 1, 0.07);
  box(g, -0.44, 0.39, 0.88, 0.07);
}

function shrine(g: G): void {
  box(g, -0.3, 0.32, 0.6, 0.1);
  box(g, -0.24, -0.06, 0.07, 0.38);
  box(g, 0.17, -0.06, 0.07, 0.38);
  poly(g, [[-0.4, -0.04], [0, -0.42], [0.4, -0.04]], g.paper, true);
  flame(g, 0, 0.28, 0.3);
  ln(g, [[-0.14, 0.14], [0.14, 0.14]], { w: 0.4 });
}

function monastery(g: G): void {
  box(g, -0.5, 0.1, 0.58, 0.3);
  poly(g, [[-0.5, 0.1], [-0.4, -0.04], [0.08, -0.04], [0.08, 0.1]], g.paper, true);
  for (const x of [-0.4, -0.26, -0.12]) arch(g, x, 0.4, 0.09, 0.17, g.ink);
  box(g, 0.08, -0.2, 0.36, 0.6);
  poly(g, [[0.04, -0.2], [0.26, -0.4], [0.48, -0.2]], g.paper, true);
  ln(g, [[0.26, -0.4], [0.26, -0.52]], { w: 0.9, halo: true });
  ln(g, [[0.2, -0.47], [0.32, -0.47]], { w: 0.9, halo: true });
  arch(g, 0.26, -0.04, 0.08, 0.16, g.ink);
  arch(g, 0.26, 0.4, 0.12, 0.2, g.ink);
}

function mill(g: G): void {
  house(g, 0.15, 0.4, 0.52, 0.42, 0.3);
  const c = g.c;
  c.beginPath();
  c.arc(-0.27, 0.2, 0.21, 0, Math.PI * 2);
  paint(g, g.paper);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 4;
    ln(g, [[-0.27 - Math.cos(a) * 0.21, 0.2 - Math.sin(a) * 0.21], [-0.27 + Math.cos(a) * 0.21, 0.2 + Math.sin(a) * 0.21]], { w: 0.5 });
  }
  dot(g, -0.27, 0.2, 0.035, g.ink);
  wave(g, -0.5, 0.0, 0.46, 4, 0.04);
}

function windmill(g: G): void {
  poly(g, [[-0.17, 0.44], [-0.11, -0.02], [0.11, -0.02], [0.17, 0.44]]);
  poly(g, [[-0.14, -0.02], [0, -0.14], [0.14, -0.02]], g.paper, true);
  mark(g, -0.04, 0.3, 0.08, 0.14);
  g.c.save();
  g.c.translate(0, -0.1);
  for (let k = 0; k < 4; k++) {
    g.c.save();
    g.c.rotate(Math.PI / 6 + k * Math.PI / 2);
    box(g, 0.05, -0.075, 0.36, 0.075);
    ln(g, [[0, 0], [0.42, 0]], { w: 0.9 });
    g.c.restore();
  }
  g.c.restore();
  dot(g, 0, -0.1, 0.03, g.ink);
}

function farm(g: G): void {
  box(g, -0.46, 0, 0.52, 0.4);
  poly(g, [[-0.5, 0], [-0.44, -0.14], [-0.32, -0.28], [-0.08, -0.28], [0.04, -0.14], [0.1, 0]], g.paper, true);
  box(g, -0.32, 0.14, 0.24, 0.26);
  ln(g, [[-0.32, 0.14], [-0.08, 0.4]], { w: 0.5 });
  ln(g, [[-0.08, 0.14], [-0.32, 0.4]], { w: 0.5 });
  box(g, 0.16, 0.1, 0.34, 0.32);
  for (const x of [0.25, 0.33, 0.41]) ln(g, [[x, 0.14], [x, 0.38]], { w: 0.4 });
}

function mine(g: G): void {
  const c = g.c;
  c.beginPath();
  c.moveTo(-0.5, 0.4);
  c.bezierCurveTo(-0.45, -0.2, -0.2, -0.38, 0, -0.38);
  c.bezierCurveTo(0.2, -0.38, 0.45, -0.2, 0.5, 0.4);
  c.closePath();
  paint(g, g.paper, true);
  box(g, -0.17, 0.02, 0.34, 0.38, g.ink);
  box(g, -0.23, -0.04, 0.46, 0.08);
  for (const s of [-1, 1]) {
    ln(g, [[s * 0.12, -0.3], [-s * 0.12, -0.1]], { w: 0.8 });
    ln(g, [[s * 0.12 - 0.07, -0.34], [s * 0.12 + 0.07, -0.26]], { w: 0.8 });
  }
}

function lighthouse(g: G): void {
  poly(g, [[-0.36, 0.44], [-0.2, 0.3], [0.2, 0.3], [0.38, 0.44]], g.paper, true);
  poly(g, [[-0.14, 0.32], [-0.09, -0.18], [0.09, -0.18], [0.14, 0.32]]);
  const hw = (y: number): number => 0.09 + (y + 0.18) / 0.5 * 0.05;
  poly(g, [[-hw(0), 0], [hw(0), 0], [hw(0.12), 0.12], [-hw(0.12), 0.12]], g.accent);
  poly(g, [[-hw(-0.14), -0.14], [hw(-0.14), -0.14], [hw(-0.04), -0.04], [-hw(-0.04), -0.04]], g.accent);
  box(g, -0.15, -0.25, 0.3, 0.07);
  box(g, -0.07, -0.37, 0.14, 0.12, g.accent);
  poly(g, [[-0.1, -0.37], [0, -0.48], [0.1, -0.37]], g.paper, true);
  for (const s of [-1, 1]) {
    ln(g, [[s * 0.12, -0.34], [s * 0.4, -0.4]], { w: 0.6, color: g.accent });
    ln(g, [[s * 0.12, -0.3], [s * 0.4, -0.26]], { w: 0.6, color: g.accent });
  }
}

function harbour(g: G): void {
  const c = g.c;
  c.beginPath();
  c.arc(0, -0.38, 0.07, 0, Math.PI * 2);
  strokeP(g, 1.4, true);
  ln(g, [[0, -0.31], [0, 0.34]], { w: 1.6, halo: true });
  ln(g, [[-0.15, -0.2], [0.15, -0.2]], { w: 1.4, halo: true });
  c.beginPath();
  c.moveTo(-0.34, 0.1);
  c.quadraticCurveTo(-0.3, 0.36, 0, 0.38);
  c.quadraticCurveTo(0.3, 0.36, 0.34, 0.1);
  strokeP(g, 1.6, true);
  ln(g, [[-0.34, 0.1], [-0.42, 0.16]], { w: 1.4, halo: true });
  ln(g, [[0.34, 0.1], [0.42, 0.16]], { w: 1.4, halo: true });
  wave(g, -0.5, 0.5, 0.47, 6, 0.04);
}

function bridge(g: G): void {
  const c = g.c;
  c.beginPath();
  c.moveTo(-0.5, 0.1);
  c.lineTo(-0.5, -0.3);
  c.lineTo(0.5, -0.3);
  c.lineTo(0.5, 0.1);
  c.lineTo(0.45, 0.1);
  c.arc(0.25, 0.1, 0.2, 0, Math.PI, true);
  c.lineTo(-0.05, 0.1);
  c.arc(-0.25, 0.1, 0.2, 0, Math.PI, true);
  c.lineTo(-0.5, 0.1);
  c.closePath();
  paint(g, g.paper, true);
  ln(g, [[-0.5, -0.2], [0.5, -0.2]], { w: 0.5 });
  wave(g, -0.5, 0.5, 0.24, 6, 0.04);
  wave(g, -0.4, 0.4, 0.36, 5, 0.04);
}

function well(g: G): void {
  const c = g.c;
  ln(g, [[-0.2, 0.02], [-0.2, -0.3]], { w: 1.4, halo: true });
  ln(g, [[0.2, 0.02], [0.2, -0.3]], { w: 1.4, halo: true });
  c.beginPath();
  c.moveTo(-0.24, 0.04);
  c.lineTo(-0.24, 0.28);
  c.quadraticCurveTo(0, 0.46, 0.24, 0.28);
  c.lineTo(0.24, 0.04);
  c.closePath();
  paint(g, g.paper);
  c.beginPath();
  c.ellipse(0, 0.04, 0.24, 0.08, 0, 0, Math.PI * 2);
  paint(g, g.paper, true);
  poly(g, [[-0.34, -0.28], [0, -0.48], [0.34, -0.28]], g.paper, true);
  ln(g, [[0, -0.28], [0, -0.04]], { w: 0.5 });
  mark(g, -0.04, -0.06, 0.08, 0.08);
  ln(g, [[-0.12, 0.16], [-0.12, 0.3]], { w: 0.4 });
  ln(g, [[0.1, 0.16], [0.1, 0.3]], { w: 0.4 });
}

function menhir(g: G, cx: number, w: number, h: number): void {
  const c = g.c, by = 0.42;
  c.beginPath();
  c.moveTo(cx - w / 2, by);
  c.lineTo(cx - w * 0.45, by - h * 0.82);
  c.quadraticCurveTo(cx, by - h * 1.1, cx + w * 0.45, by - h * 0.8);
  c.lineTo(cx + w / 2, by);
  c.closePath();
  paint(g, g.paper, true);
}

function standingStones(g: G): void {
  ln(g, [[-0.5, 0.42], [0.5, 0.42]], { w: 0.6 });
  menhir(g, -0.42, 0.15, 0.4);
  menhir(g, 0.42, 0.15, 0.34);
  menhir(g, -0.14, 0.17, 0.8);
  menhir(g, 0.14, 0.17, 0.8);
  box(g, -0.28, -0.46, 0.56, 0.1, g.paper, true);
}

function barrow(g: G): void {
  const c = g.c;
  c.beginPath();
  c.moveTo(-0.5, 0.3);
  c.bezierCurveTo(-0.42, -0.18, -0.2, -0.28, 0, -0.28);
  c.bezierCurveTo(0.2, -0.28, 0.42, -0.18, 0.5, 0.3);
  c.closePath();
  paint(g, g.paper, true);
  box(g, -0.13, 0.02, 0.26, 0.28, g.ink);
  box(g, -0.2, -0.04, 0.4, 0.07);
  ln(g, [[-0.5, 0.3], [0.5, 0.3]], { w: 0.5 });
  for (const x of [-0.38, 0.34]) ln(g, [[x - 0.04, 0.4], [x, 0.34], [x + 0.04, 0.4]], { w: 0.5 });
}

function ruins(g: G): void {
  poly(g, [[-0.48, 0.4], [-0.48, -0.1], [-0.4, -0.02], [-0.32, -0.22], [-0.22, -0.08], [-0.16, 0.4]], g.paper, true);
  arch(g, -0.32, 0.4, 0.1, 0.2, g.ink);
  poly(g, [[0.02, 0.4], [0.02, -0.34], [0.1, -0.4], [0.14, -0.24], [0.22, -0.3], [0.22, 0.4]], g.paper, true);
  poly(g, [[0.34, 0.4], [0.34, 0.06], [0.4, 0.0], [0.5, 0.12], [0.5, 0.4]], g.paper, true);
  ln(g, [[0.02, 0.0], [0.22, 0.0]], { w: 0.4 });
  ln(g, [[0.02, 0.18], [0.22, 0.18]], { w: 0.4 });
  poly(g, [[-0.12, 0.42], [-0.08, 0.36], [-0.02, 0.42]], g.paper, true);
  poly(g, [[0.24, 0.42], [0.28, 0.37], [0.32, 0.42]], g.paper, true);
}

function sword(g: G, s: number): void {
  const tip: Pt = [s * -0.4, -0.44], guard: Pt = [s * 0.14, 0.1], pommel: Pt = [s * 0.34, 0.32];
  ln(g, [tip, guard], { w: 3.2, halo: true });
  ln(g, [tip, guard], { w: 1.8, color: g.accent });
  ln(g, [[guard[0] - 0.1, guard[1] + 0.1 * s], [guard[0] + 0.1, guard[1] - 0.1 * s]], { w: 1.8, halo: true });
  ln(g, [guard, pommel], { w: 1.8, halo: true });
  dot(g, pommel[0], pommel[1], 0.04, g.ink);
}

function battlefield(g: G): void {
  sword(g, 1);
  sword(g, -1);
  ln(g, [[-0.46, 0.44], [-0.2, 0.44]], { w: 0.5 });
  ln(g, [[0.2, 0.44], [0.46, 0.44]], { w: 0.5 });
}

// ---------------------------------------------------------------------------
// Forts
// ---------------------------------------------------------------------------

function castle(g: G): void {
  crenel(g, -0.17, 0.17, -0.2, 0.3, 3, 0.07);
  flag(g, 0, -0.27, 0.22);
  mark(g, -0.025, -0.1, 0.05, 0.12);
  crenel(g, -0.5, 0.5, 0.05, 0.42, 6, 0.06);
  crenel(g, -0.5, -0.24, -0.14, 0.42, 2, 0.06);
  crenel(g, 0.24, 0.5, -0.14, 0.42, 2, 0.06);
  mark(g, -0.4, -0.02, 0.04, 0.1);
  mark(g, 0.36, -0.02, 0.04, 0.1);
  arch(g, 0, 0.42, 0.16, 0.24, g.ink);
}

function fort(g: G): void {
  const heights = [0.1, 0, 0.08, 0, 0.1, 0, 0.08];
  heights.forEach((dy, i) => {
    const x = -0.45 + i * 0.15;
    poly(g, [[x - 0.07, 0.4], [x - 0.07, 0.02 + dy], [x, -0.1 + dy], [x + 0.07, 0.02 + dy], [x + 0.07, 0.4]]);
  });
  ln(g, [[-0.5, 0.22], [0.5, 0.22]], { w: 0.4 });
  box(g, -0.14, -0.14, 0.28, 0.54);
  poly(g, [[-0.18, -0.14], [0, -0.34], [0.18, -0.14]], g.paper, true);
  flag(g, 0, -0.34, 0.15);
  arch(g, 0, 0.4, 0.14, 0.22, g.ink);
  mark(g, -0.025, -0.06, 0.05, 0.1);
}

function tower(g: G): void {
  poly(g, [[-0.16, 0.46], [-0.14, -0.2], [0.14, -0.2], [0.16, 0.46]]);
  crenel(g, -0.22, 0.22, -0.34, -0.2, 3, 0.08);
  mark(g, -0.025, -0.28, 0.05, 0.07);
  mark(g, -0.025, -0.06, 0.05, 0.12);
  mark(g, -0.025, 0.12, 0.05, 0.12);
  arch(g, 0, 0.46, 0.12, 0.2, g.ink);
}

function wizardTower(g: G): void {
  poly(g, [[-0.15, 0.44], [-0.11, -0.06], [0.11, -0.06], [0.15, 0.44]]);
  box(g, -0.21, -0.12, 0.42, 0.06);
  box(g, -0.17, -0.28, 0.34, 0.16);
  const c = g.c;
  c.beginPath();
  c.moveTo(-0.24, -0.28);
  c.quadraticCurveTo(-0.06, -0.32, 0.14, -0.5);
  c.quadraticCurveTo(0.13, -0.36, 0.24, -0.28);
  c.closePath();
  paint(g, g.accent);
  arch(g, 0, -0.12, 0.08, 0.1, g.accent);
  spark(g, 0, 0.16, 0.07);
  arch(g, 0, 0.44, 0.1, 0.16, g.ink);
  dot(g, -0.36, -0.18, 0.025, g.accent);
  dot(g, 0.34, -0.02, 0.025, g.accent);
  dot(g, 0.36, -0.3, 0.025, g.accent);
}

function motte(g: G): void {
  poly(g, [[-0.5, 0.42], [-0.3, 0], [0.3, 0], [0.5, 0.42]], g.paper, true);
  ln(g, [[-0.4, 0.22], [-0.3, 0.3], [-0.2, 0.22]], { w: 0.4 });
  ln(g, [[0.2, 0.22], [0.3, 0.3], [0.4, 0.22]], { w: 0.4 });
  for (let i = 0; i < 6; i++) {
    const x = -0.28 + i * 0.112;
    poly(g, [[x - 0.04, 0], [x - 0.04, -0.07], [x, -0.12], [x + 0.04, -0.07], [x + 0.04, 0]]);
  }
  box(g, -0.14, -0.34, 0.28, 0.34);
  poly(g, [[-0.18, -0.34], [0, -0.5], [0.18, -0.34]], g.paper, true);
  ln(g, [[-0.14, -0.22], [0.14, -0.22]], { w: 0.4 });
  ln(g, [[-0.14, -0.11], [0.14, -0.11]], { w: 0.4 });
  mark(g, -0.03, -0.1, 0.06, 0.1);
}

function walls(g: G): void {
  crenel(g, -0.5, 0.5, 0.02, 0.4, 7, 0.06);
  crenel(g, -0.36, -0.18, -0.16, 0.4, 2, 0.06);
  crenel(g, 0.18, 0.36, -0.16, 0.4, 2, 0.06);
  arch(g, 0, 0.4, 0.14, 0.24, g.ink);
  ln(g, [[-0.5, 0.18], [-0.38, 0.18]], { w: 0.4 });
  ln(g, [[0.38, 0.18], [0.5, 0.18]], { w: 0.4 });
  ln(g, [[-0.14, 0.12], [-0.2, 0.12]], { w: 0.4 });
  ln(g, [[0.14, 0.12], [0.2, 0.12]], { w: 0.4 });
  mark(g, -0.29, -0.06, 0.04, 0.1);
  mark(g, 0.25, -0.06, 0.04, 0.1);
}

// ---------------------------------------------------------------------------
// Nature
// ---------------------------------------------------------------------------

function peak(g: G, x0: number, x1: number, ax: number, ay: number, by: number): void {
  poly(g, [[x0, by], [ax, ay], [x1, by]]);
  shadeFill(g, [[ax, ay], [x1, by], [ax + 0.05, by]]);
  const yS = ay + (by - ay) * 0.3;
  const xl = ax + (x0 - ax) * 0.3, xr = ax + (x1 - ax) * 0.3, dx = xr - xl;
  ln(g, [[xl, yS], [xl + dx * 0.25, yS + 0.07], [xl + dx * 0.5, yS], [xl + dx * 0.75, yS + 0.07], [xr, yS]], { w: 0.5 });
}

function mountain(g: G): void {
  peak(g, -0.5, 0.3, -0.12, -0.46, 0.4);
  peak(g, 0, 0.5, 0.28, -0.1, 0.4);
}

function volcano(g: G): void {
  const c = g.c;
  poly(g, [[-0.5, 0.42], [-0.16, -0.18], [0.16, -0.18], [0.5, 0.42]], g.paper, true);
  c.beginPath();
  c.ellipse(0, -0.18, 0.16, 0.05, 0, 0, Math.PI * 2);
  paint(g, g.accent);
  ln(g, [[0.02, -0.14], [0.06, -0.04], [0.0, 0.06], [0.1, 0.22], [0.06, 0.36]], { w: 1.2, color: g.accent });
  for (const [x, y, r] of [[-0.06, -0.3, 0.07], [0.06, -0.38, 0.09], [-0.04, -0.44, 0.06]] as const) {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    paint(g, g.paper, false, 0.6);
  }
  dot(g, 0.2, -0.3, 0.02, g.accent);
  dot(g, -0.22, -0.26, 0.02, g.accent);
}

function pine(g: G, cx: number, by: number, w: number, h: number): void {
  ln(g, [[cx, by], [cx, by - h * 0.14]], { w: 1.2, halo: true });
  for (let i = 0; i < 3; i++) {
    const y0 = by - h * 0.12 - i * h * 0.26, hw = w / 2 * (1 - i * 0.22);
    poly(g, [[cx - hw, y0], [cx, y0 - h * 0.38], [cx + hw, y0]], g.paper, true);
  }
}

function oak(g: G, cx: number, by: number, r: number): void {
  ln(g, [[cx, by], [cx, by - r * 1.2]], { w: 1.2, halo: true });
  g.c.beginPath();
  g.c.arc(cx, by - r * 1.6, r, 0, Math.PI * 2);
  paint(g, g.paper, true);
}

function forest(g: G): void {
  pine(g, 0, 0.2, 0.34, 0.7);
  pine(g, -0.3, 0.44, 0.3, 0.56);
  oak(g, 0.3, 0.44, 0.17);
}

function cave(g: G): void {
  poly(g, [[-0.5, 0.4], [-0.46, 0], [-0.32, -0.2], [-0.12, -0.34], [0.1, -0.36], [0.3, -0.22], [0.44, -0.02], [0.5, 0.4]], g.paper, true);
  const c = g.c;
  c.beginPath();
  c.moveTo(-0.2, 0.4);
  c.lineTo(-0.2, 0.12);
  c.quadraticCurveTo(-0.2, -0.1, 0, -0.1);
  c.quadraticCurveTo(0.2, -0.1, 0.2, 0.12);
  c.lineTo(0.2, 0.4);
  c.closePath();
  paint(g, g.ink);
  for (const x of [-0.1, 0.02, 0.12]) {
    trace(g, [[x - 0.03, -0.09], [x, 0.04], [x + 0.03, -0.09]], true);
    solid(g, g.paper);
  }
  ln(g, [[-0.4, 0.05], [-0.3, 0.12]], { w: 0.4 });
  ln(g, [[0.3, 0.08], [0.4, 0.0]], { w: 0.4 });
  ln(g, [[-0.28, -0.1], [-0.2, -0.04]], { w: 0.4 });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const DRAW: Record<StampGlyph, Draw> = {
  hamlet, village, town, city, capital, camp,
  inn, temple, shrine, monastery, mill, windmill, farm, mine, lighthouse, harbour,
  bridge, well, standingStones, barrow, ruins, battlefield,
  castle, fort, tower, wizardTower, motte, walls,
  mountain, volcano, forest, cave,
};

/**
 * Draw a stamp centred at (x, y). `px` is the nominal height in CSS pixels at
 * size M (default 18); `size` scales it by STAMP_SIZES. `ink` = outline/detail
 * colour, `paper` = fill colour, `accent` = flags, fire, lava, swords. With
 * `halo` a wide pale silhouette is drawn first so the glyph reads on dark
 * terrain. Canvas state is saved and restored.
 */
export function drawStamp(
  ctx: Ctx,
  glyph: StampGlyph,
  x: number,
  y: number,
  opts: { px?: number; size?: StampSize; ink?: string; paper?: string; accent?: string; halo?: boolean } = {},
): void {
  const draw = DRAW[glyph];
  if (!draw) return;
  const u = (opts.px ?? 18) * STAMP_SIZES[opts.size ?? 'M'];
  if (!(u > 0)) return;
  const lwPx = Math.min(1.6, Math.max(1.2, 1.4 * u / 18));
  const g: G = {
    c: ctx,
    ink: opts.ink ?? '#2b2118',
    paper: opts.paper ?? '#f2e6c9',
    accent: opts.accent ?? '#9b2f22',
    lw: lwPx / u,
    halo: false,
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(u, u);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  if (opts.halo) {
    g.halo = true;
    draw(g);
    g.halo = false;
  }
  draw(g);
  ctx.restore();
}
