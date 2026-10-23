// ============================================
// World Generator — the painted ground (the 3D "Pintado" skin)
// ============================================
// A hand-painted relief map of the whole world, made for draping over the 3D
// relief: colours that melt into each other instead of one flat tile per cell,
// a sea that is pale over the shelf and deep further out, light rings along the
// coast, ground shaded from the north-west and turning to rock and snow on the
// heights, forests painted as crowds of small trees (broadleaf, conifer, jungle,
// fungal), and dunes combed into the sand seas.
//
// Everything is drawn here, in code: no image assets. Deterministic for a given
// world (the jitter and the grain come from a hash of the seed), so the same
// world always paints the same picture, and cached on the world and its revision.

import { Biome, type WorldData } from '../core/types';
import { atlasCellColor } from '../core/render';

type RGB = [number, number, number];
export type TreeKind = 'broad' | 'conifer' | 'jungle' | 'fungal' | 'dead';

/** Trees per unit of forest, by ground; the kind of tree; how big, relative to the base size. */
export const FORESTS: Partial<Record<number, { kind: TreeKind; density: number; mixed?: TreeKind; size?: number }>> = {
  [Biome.BorealForest]: { kind: 'conifer', density: 0.95 },
  [Biome.MontaneForest]: { kind: 'conifer', density: 0.9 },
  [Biome.TemperateForest]: { kind: 'broad', density: 0.9 },
  [Biome.TemperateRainforest]: { kind: 'conifer', density: 1, mixed: 'broad' },
  [Biome.TropicalForest]: { kind: 'jungle', density: 0.9 },
  [Biome.TropicalRainforest]: { kind: 'jungle', density: 1, size: 1.1 },
  [Biome.MonsoonForest]: { kind: 'broad', density: 0.75, mixed: 'jungle' },
  [Biome.CloudForest]: { kind: 'jungle', density: 0.85, mixed: 'broad' },
  [Biome.RiparianForest]: { kind: 'broad', density: 0.8 },
  [Biome.Mangrove]: { kind: 'jungle', density: 0.7, size: 0.8 },
  [Biome.Bamboo]: { kind: 'jungle', density: 0.65, size: 0.8 },
  [Biome.FungalForest]: { kind: 'fungal', density: 0.85 },
  [Biome.PetrifiedForest]: { kind: 'dead', density: 0.45 },
  [Biome.Savanna]: { kind: 'broad', density: 0.07, size: 0.9 },
  [Biome.Shrubland]: { kind: 'broad', density: 0.05, size: 0.7 },
  [Biome.Chaparral]: { kind: 'broad', density: 0.06, size: 0.7 },
};

export const PALETTES: Record<TreeKind, RGB[]> = {
  broad: [[78, 122, 64], [96, 136, 70], [70, 110, 72]],
  conifer: [[52, 92, 70], [62, 102, 72], [46, 84, 66]],
  jungle: [[54, 120, 66], [70, 136, 70], [44, 108, 70]],
  fungal: [[142, 102, 170], [170, 112, 150], [118, 96, 168]],
  dead: [[150, 138, 120], [132, 122, 108], [166, 152, 130]],
};

const SEA_SHALLOW: RGB = [120, 178, 196];
const SEA_MID: RGB = [74, 140, 176];
const SEA_DEEP: RGB = [40, 92, 140];
const LAKE: RGB = [96, 160, 190];
const ROCK: RGB = [128, 120, 110];

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 32-bit hash of integers, the seed folded in. */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

/** A tileable value-noise grid, so the grain costs a lookup per octave and not a hash. */
function noiseTile(seed: number, size = 256): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = hash2(i % size, Math.floor(i / size), seed);
  return out;
}
/**
 * Value noise that repeats every `period` lattice cells across, so the picture
 * joins without a step where the world wraps at the date line.
 */
function sampleNoise(tile: Float32Array, size: number, x: number, y: number, period: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = size - 1;
  const xa = (((x0 % period) + period) % period) & m, xb = ((((x0 + 1) % period) + period) % period) & m;
  const a = tile[(y0 & m) * size + xa], b = tile[(y0 & m) * size + xb];
  const c = tile[((y0 + 1) & m) * size + xa], d = tile[((y0 + 1) & m) * size + xb];
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

// ---------------------------------------------------------------------------
// The little trees
// ---------------------------------------------------------------------------
const SPRITES = new Map<string, HTMLCanvasElement>();

function rgba(c: RGB, k = 1, a = 1): string {
  return `rgba(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))},${a})`;
}

/** One tree, drawn at `size` px wide, lit from the north-west, with its shadow to the south-east. */
function treeSprite(kind: TreeKind, hue: number, size: number): HTMLCanvasElement {
  const key = `${kind}:${hue}:${size}`;
  const hit = SPRITES.get(key);
  if (hit) return hit;
  const S = Math.max(4, size);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(S * 1.5); canvas.height = Math.ceil(S * 1.6);
  const ctx = canvas.getContext('2d')!;
  const c = PALETTES[kind][hue % 3];
  const cx = S * 0.7, base = S * 1.35;
  // The shadow on the ground.
  ctx.fillStyle = 'rgba(20,30,20,0.28)';
  ctx.beginPath(); ctx.ellipse(cx + S * 0.22, base - S * 0.05, S * 0.48, S * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  if (kind === 'conifer' || kind === 'dead') {
    const tiers = 3, top = base - S * 1.25;
    if (kind === 'dead') {
      ctx.strokeStyle = rgba(c, 0.7); ctx.lineWidth = Math.max(1, S * 0.09);
      ctx.beginPath(); ctx.moveTo(cx, base); ctx.lineTo(cx, top + S * 0.2);
      ctx.moveTo(cx, base - S * 0.6); ctx.lineTo(cx - S * 0.3, base - S * 0.9);
      ctx.moveTo(cx, base - S * 0.45); ctx.lineTo(cx + S * 0.28, base - S * 0.75); ctx.stroke();
    } else {
      for (let t = 0; t < tiers; t++) {
        const y0 = top + (t * S * 0.32), y1 = y0 + S * 0.62, w = S * (0.26 + t * 0.12);
        const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
        g.addColorStop(0, rgba(c, 1.25)); g.addColorStop(0.5, rgba(c, 1)); g.addColorStop(1, rgba(c, 0.62));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx + w, y1); ctx.lineTo(cx - w, y1); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = rgba(c, 0.45, 0.6); ctx.lineWidth = Math.max(0.6, S * 0.04);
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx + S * 0.5, base - S * 0.08); ctx.lineTo(cx - S * 0.5, base - S * 0.08); ctx.closePath(); ctx.stroke();
    }
  } else {
    // Round crowns: three or four overlapping blobs, each shaded from the north-west.
    const blobs = kind === 'jungle'
      ? [[-0.24, -0.62, 0.34], [0.22, -0.66, 0.34], [0, -0.86, 0.36], [0.02, -0.5, 0.3]]
      : kind === 'fungal'
        ? [[0, -0.8, 0.46]]
        : [[-0.18, -0.6, 0.32], [0.2, -0.62, 0.32], [0, -0.86, 0.36]];
    if (kind === 'fungal') {
      ctx.fillStyle = 'rgba(226,214,196,0.95)';
      ctx.fillRect(cx - S * 0.07, base - S * 0.62, S * 0.14, S * 0.62);
    }
    for (const [dx, dy, r] of blobs) {
      const x = cx + dx * S, y = base + dy * S, R = r * S;
      const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
      g.addColorStop(0, rgba(c, 1.35)); g.addColorStop(0.55, rgba(c, 1)); g.addColorStop(1, rgba(c, 0.6));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    }
    if (kind === 'fungal') {
      ctx.fillStyle = 'rgba(255,240,250,0.7)';
      for (const [dx, dy] of [[-0.18, -0.9], [0.14, -0.84], [0, -1.02]]) { ctx.beginPath(); ctx.arc(cx + dx * S, base + dy * S, S * 0.05, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  SPRITES.set(key, canvas);
  return canvas;
}

// ---------------------------------------------------------------------------
// The ground
// ---------------------------------------------------------------------------
export interface PaintedGroundOptions {
  /** The longest side of the picture, in pixels (default 3072; at least one pixel a cell). */
  maxWidth?: number;
  /** Draw the rivers into the picture (they are part of the painting). */
  rivers?: boolean;
  /** Draws the rivers on the scaled canvas; passed in so this file stays free of the tile code. */
  drawRivers?: (ctx: CanvasRenderingContext2D, width: number) => void;
  /** Paint the little trees (default true). Off when the tabletop model stands its trees up in 3D. */
  trees?: boolean;
}

export interface PaintedGround { canvas: HTMLCanvasElement; pxPerCell: number; trees: number }

// Two pictures a world: with its trees and without (the tabletop model stands them up), so going between the two is a lookup.
const CACHE = new WeakMap<WorldData, Map<string, PaintedGround>>();

export function renderPaintedGround(world: WorldData, options: PaintedGroundOptions = {}): PaintedGround {
  const maxWidth = options.maxWidth ?? 3072;
  const key = `${world.revision ?? 0}:${maxWidth}:${options.rivers !== false}:${options.trees !== false}`;
  const hit = CACHE.get(world)?.get(key);
  if (hit) return hit;

  const { width: W, height: H, elevation, biome } = world;
  const s = Math.max(1, Math.min(16, Math.floor(maxWidth / W)));
  const Wc = W * s, Hc = H * s;
  const seed = seedOf(world.params?.seed ?? 'world');
  const tile = noiseTile(seed), TS = 256;
  // Each octave has a whole number of lattice cells across the picture (and at
  // most the tile's 256, so the period is exact): scale k of pixels per cell
  // becomes a period P, and a pixel x reads the lattice at x * P / Wc.
  const octave = (pxPerCell: number) => { const P = Math.max(1, Math.min(TS, Math.round(Wc / pxPerCell))); return { P, k: P / Wc }; };
  const O48 = octave(48), O14 = octave(14), O4 = octave(4), O90 = octave(90);
  const grain = (x: number, y: number) =>
    0.55 * sampleNoise(tile, TS, x * O48.k, y * O48.k, O48.P) + 0.3 * sampleNoise(tile, TS, x * O14.k + 31, y * O14.k + 17, O14.P) + 0.15 * sampleNoise(tile, TS, x * O4.k + 7, y * O4.k + 93, O4.P);
  const wanderX = (x: number, y: number) => (sampleNoise(tile, TS, x * O90.k + 51, y * O90.k + 3, O90.P) - 0.5) * 1.1;
  const wanderY = (x: number, y: number) => (sampleNoise(tile, TS, x * O90.k + 7, y * O90.k + 61, O90.P) - 0.5) * 1.1;

  // Each cell's own colour, unshaded; the pixels blend between them.
  const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = atlasCellColor(world, i);
    R[i] = r; G[i] = g; B[i] = b;
  }
  const lake = world.lake;
  const at = (x: number, y: number) => {
    const xx = ((x % W) + W) % W, yy = Math.min(H - 1, Math.max(0, y));
    return yy * W + xx;
  };

  // Slopes per cell (central differences, x wraps), so a pixel reads its light
  // from a blend of four numbers instead of sampling the field four times.
  const GX = new Float32Array(W * H), GY = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    GX[i] = (elevation[at(x + 1, y)] - elevation[at(x - 1, y)]) * 0.5;
    GY[i] = (elevation[at(x, y + 1)] - elevation[at(x, y - 1)]) * 0.5;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Wc; canvas.height = Hc;
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  const img = ctx.createImageData(Wc, Hc);
  const px = img.data;
  const inv = 1 / s;
  const elevAt = (cx: number, cy: number) => {
    const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
    const a = elevation[at(x0, y0)], b = elevation[at(x0 + 1, y0)], c = elevation[at(x0, y0 + 1)], d = elevation[at(x0 + 1, y0 + 1)];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  const [sr, sg, sb] = SEA_SHALLOW, [mr, mg, mb] = SEA_MID, [dr, dg, db] = SEA_DEEP;
  const [kr, kg, kb] = ROCK, [lr, lg, lb] = LAKE;
  const Z = 9, LX = 0.55 * Z, LZ = 0.63;
  for (let py = 0; py < Hc; py++) {
    const cy = (py + 0.5) * inv - 0.5;
    const y0 = Math.floor(cy), fy = cy - y0;
    const ya = Math.min(H - 1, Math.max(0, y0)) * W, yb = Math.min(H - 1, Math.max(0, y0 + 1)) * W;
    for (let pxx = 0; pxx < Wc; pxx++) {
      const cx = (pxx + 0.5) * inv - 0.5;
      const x0 = Math.floor(cx), fx = cx - x0;
      const xa = ((x0 % W) + W) % W, xb = xa + 1 === W ? 0 : xa + 1;
      const a00 = ya + xa, a10 = ya + xb, a01 = yb + xa, a11 = yb + xb;
      const v00 = (1 - fx) * (1 - fy), v10 = fx * (1 - fy), v01 = (1 - fx) * fy, v11 = fx * fy;
      const e = elevation[a00] * v00 + elevation[a10] * v10 + elevation[a01] * v01 + elevation[a11] * v11;
      // The grain: three octaves of the same tile.
      const n = grain(pxx, py);
      let r: number, g: number, b: number;
      const nearest = (fy < 0.5 ? ya : yb) + (fx < 0.5 ? xa : xb);
      if (lake && lake[nearest] && biome[nearest] === Biome.Lake) {
        const t = 0.2 + 0.3 * n;
        r = lr + (mr - lr) * t; g = lg + (mg - lg) * t; b = lb + (mb - lb) * t;
      } else {
        // The colours are read a little off the grid, pushed by a slow noise, so
        // the boundary between two grounds wanders like a brush stroke instead of
        // following the cells' square edges.
        const wcx = cx + wanderX(pxx, py);
        const wcy = cy + wanderY(pxx, py);
        const wx0 = Math.floor(wcx), wy0 = Math.floor(wcy), wfx = wcx - wx0, wfy = wcy - wy0;
        const i00 = at(wx0, wy0), i10 = at(wx0 + 1, wy0), i01 = at(wx0, wy0 + 1), i11 = at(wx0 + 1, wy0 + 1);
        const w00 = (1 - wfx) * (1 - wfy), w10 = wfx * (1 - wfy), w01 = (1 - wfx) * wfy, w11 = wfx * wfy;
        let lr2 = R[i00] * w00 + R[i10] * w10 + R[i01] * w01 + R[i11] * w11;
        let lg2 = G[i00] * w00 + G[i10] * w10 + G[i01] * w01 + G[i11] * w11;
        let lb2 = B[i00] * w00 + B[i10] * w10 + B[i01] * w01 + B[i11] * w11;
        // The light of the slope, and rock where it is steep and high.
        const ex = GX[a00] * v00 + GX[a10] * v10 + GX[a01] * v01 + GX[a11] * v11;
        const ey = GY[a00] * v00 + GY[a10] * v10 + GY[a01] * v01 + GY[a11] * v11;
        const slope = Math.sqrt(ex * ex + ey * ey);
        const rock = smooth(0.25, 0.9, slope) * smooth(0.6, 1.6, e) * 0.55 * (lr2 + lg2 + lb2 > 640 ? 0.3 : 1);
        if (rock > 0) { lr2 += (kr - lr2) * rock; lg2 += (kg - lg2) * rock; lb2 += (kb - lb2) * rock; }
        const len = Math.sqrt((ex * ex + ey * ey) * Z * Z + 1);
        const dot = (ex * LX + ey * LX + LZ) / len;
        const k = (0.76 + 0.4 * Math.max(0, dot)) * (0.93 + 0.14 * n);
        lr2 *= k; lg2 *= k; lb2 *= k;
        // The sea: pale over the shelf, deep offshore, mottled, with light rings along the coast.
        const d = -e;
        const t1 = smooth(0.0, 0.35, d), t2 = smooth(0.35, 2.4, d);
        let sr2 = sr + (mr - sr) * t1, sg2 = sg + (mg - sg) * t1, sb2 = sb + (mb - sb) * t1;
        sr2 += (dr - sr2) * t2; sg2 += (dg - sg2) * t2; sb2 += (db - sb2) * t2;
        const mottle = 0.94 + 0.12 * n;
        sr2 *= mottle; sg2 *= mottle; sb2 *= mottle;
        const ring = d > 0 && d < 0.3 ? (0.5 + 0.5 * Math.cos(d * 70)) * (1 - d / 0.3) * 0.22 : 0;
        if (ring > 0) { sr2 += (214 - sr2) * ring; sg2 += (232 - sg2) * ring; sb2 += (236 - sb2) * ring; }
        // A soft edge between the two, and a thin pale beach where they meet.
        const t = smooth(-0.012, 0.012, e);
        r = sr2 + (lr2 - sr2) * t; g = sg2 + (lg2 - sg2) * t; b = sb2 + (lb2 - sb2) * t;
        const beach = (1 - Math.abs(t - 0.5) * 2) * 0.35;
        if (beach > 0) { r += (232 - r) * beach; g += (222 - g) * beach; b += (188 - b) * beach; }
      }
      const o = (py * Wc + pxx) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Dunes combed into the sand seas.
  ctx.lineCap = 'round';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, b = biome[i];
    if (elevation[i] <= 0 || (b !== Biome.Erg && b !== Biome.Desert)) continue;
    const count = b === Biome.Erg ? 2 : 1;
    for (let k = 0; k < count; k++) {
      if (b === Biome.Desert && hash2(x, y, seed + 5 + k) > 0.45) continue;
      const hx = (x + 0.15 + 0.7 * hash2(x, y, seed + 11 + k)) * s, hy = (y + 0.2 + 0.6 * hash2(x, y, seed + 23 + k)) * s;
      const w = s * (0.45 + 0.3 * hash2(x, y, seed + 37 + k));
      ctx.strokeStyle = 'rgba(120,88,52,0.28)'; ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.beginPath(); ctx.moveTo(hx - w, hy + s * 0.04); ctx.quadraticCurveTo(hx, hy - s * 0.2, hx + w, hy + s * 0.04); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,244,214,0.4)'; ctx.lineWidth = Math.max(0.8, s * 0.06);
      ctx.beginPath(); ctx.moveTo(hx - w, hy - s * 0.02); ctx.quadraticCurveTo(hx, hy - s * 0.26, hx + w, hy - s * 0.02); ctx.stroke();
    }
  }

  if (options.rivers !== false && options.drawRivers) options.drawRivers(ctx, Wc);

  // The trees, back to front so the ones further south overlap the ones behind.
  // A big world gets one or two pixels a cell: its trees are smaller and
  // sparser, so the forests still read and the stamping stays quick.
  const small = s < 3;
  const treeSize = small ? Math.max(4, s * 2) : Math.max(6, Math.round(s * 0.62));
  const thin = small ? 0.45 : 1;
  const spacing = treeSize * 0.62;
  const perSide = Math.max(1, Math.round(s / spacing));
  const stamps: { x: number; y: number; kind: TreeKind; hue: number; size: number }[] = [];
  for (let y = 0; y < H && options.trees !== false; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (elevation[i] <= 0) continue;
    for (let gy = 0; gy < perSide; gy++) for (let gx = 0; gx < perSide; gx++) {
      const jx = hash2(x * 7 + gx, y * 13 + gy, seed + 3), jy = hash2(x * 11 + gx, y * 5 + gy, seed + 9);
      const tx = (x + (gx + 0.15 + 0.7 * jx) / perSide) * s, ty = (y + (gy + 0.15 + 0.7 * jy) / perSide) * s;
      // Which forest this spot is in is read at a wandering position, the same
      // brush-stroke wander the colours use, so a wood's edge is ragged.
      const wx = tx * inv - 0.5 + wanderX(tx, ty);
      const wy = ty * inv - 0.5 + wanderY(tx, ty);
      const f = FORESTS[biome[at(Math.round(wx), Math.round(wy))]];
      if (!f) continue;
      const h = hash2(x * perSide + gx, y * perSide + gy, seed);
      if (h > f.density * thin) continue;
      // Not into the sea at the forest's coastal edge.
      if (elevAt(tx * inv - 0.5, ty * inv - 0.5) <= 0.01) continue;
      const kind = f.mixed && hash2(x + gx, y + gy, seed + 41) < 0.4 ? f.mixed : f.kind;
      const size = Math.round(treeSize * (f.size ?? 1) * (0.82 + 0.36 * hash2(x + gy, y + gx, seed + 77)));
      stamps.push({ x: tx, y: ty, kind, hue: Math.floor(hash2(x - gx, y - gy, seed + 53) * 3), size });
    }
  }
  stamps.sort((a, b) => a.y - b.y);
  for (const t of stamps) {
    const sprite = treeSprite(t.kind, t.hue, t.size);
    // The sprite's foot is at 70% across and 135/160 down.
    const dx = t.x - sprite.width * (0.7 / 1.5), dy = t.y - sprite.height * (1.35 / 1.6);
    ctx.drawImage(sprite, dx, dy);
    // Trees by the date line show on both sides of the seam.
    if (t.x < s * 2) ctx.drawImage(sprite, dx + Wc, dy);
    else if (t.x > Wc - s * 2) ctx.drawImage(sprite, dx - Wc, dy);
  }

  const result = { canvas, pxPerCell: s, trees: stamps.length };
  const kept = CACHE.get(world) ?? new Map<string, PaintedGround>();
  // Only the latest revision is kept, at most two pictures of it.
  for (const k of [...kept.keys()]) if (!k.startsWith(`${world.revision ?? 0}:`) || kept.size >= 2) kept.delete(k);
  kept.set(key, result);
  CACHE.set(world, kept);
  return result;
}
