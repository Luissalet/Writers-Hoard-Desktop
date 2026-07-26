// ============================================
// Regional sheet — Natural landmarks
// ============================================
// The features people actually navigate by, and which no map above about
// 1:500 000 can show: the fall, the spring, the gorge, the crag, the pass.
//
// Some come down from the world, which already detects volcanoes and caves at
// its own scale. The interesting ones are found HERE, because they are made of
// exactly the sub-world detail the sheet invented: a waterfall is a hundred
// metres of a river the world map draws as one pixel wide, a gorge is a valley
// narrower than a world cell, and a crag is a slope the world averaged away.
//
// This is the payoff of inventing the relief rather than merely upscaling it.
// A generator that smoothed the world map would have nothing to find.

import { createRng } from '../core/rng';
import { coinName, type LanguageFamily } from '../core/language';
import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import { Cover, LANDMARK_ES, type RegionLandmarkKind, type RegionPlace, type RegionStream } from './types';
import type { RegionGeometry, TerrainFields } from './terrain';

const WORLD_KIND: Record<string, RegionLandmarkKind> = {
  volcano: 'volcano', cave: 'cave', waterfall: 'waterfall',
  gorge: 'gorge', hotspring: 'hotspring',
};

export function buildLandmarks(
  world: WorldData,
  geo: HumanGeography,
  g: RegionGeometry,
  t: TerrainFields,
  cover: Uint8Array,
  streams: RegionStream[],
  nextId: () => number,
): RegionPlace[] {
  const W = g.width, H = g.height;
  const cellKm = g.metresPerCell / 1000;
  const out: RegionPlace[] = [];
  const fam: LanguageFamily = geo.languages;
  const WW = world.width;

  const name = (kind: RegionLandmarkKind, x: number, y: number): string => {
    const key = `lm:${kind}:${Math.round(g.originX / g.worldPerCellX) + Math.round(x)}:${Math.round(g.originY / g.worldPerCellY) + Math.round(y)}`;
    const heads = kind === 'waterfall' ? ['water', 'river', 'white'] as const
      : kind === 'spring' ? ['spring', 'water', 'holy'] as const
        : kind === 'gorge' ? ['rock', 'cliff', 'dark'] as const
          : kind === 'crag' ? ['rock', 'stone', 'eagle'] as const
            : kind === 'cave' ? ['dark', 'stone', 'grave'] as const
              : kind === 'pass' ? ['pass', 'high', 'cold'] as const
                : ['rock', 'water'] as const;
    const coined = coinName(fam.living[0], fam.proto, key, world.params.seed, {
      heads: [...heads], modifiers: ['old', 'black', 'white', 'high', 'wild', 'quiet'],
    });
    return `${LANDMARK_ES[kind]} de ${coined.text}`;
  };

  const taken: { x: number; y: number; k: RegionLandmarkKind }[] = [];
  const free = (x: number, y: number, k: RegionLandmarkKind, minKm: number): boolean => {
    for (const q of taken) {
      if (q.k === k && Math.hypot(q.x - x, q.y - y) * cellKm < minKm) return false;
    }
    taken.push({ x, y, k });
    return true;
  };
  const push = (kind: RegionLandmarkKind, x: number, y: number, importance: number, minKm: number) => {
    if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) return;
    if (!free(x, y, kind, minKm)) return;
    out.push({ id: nextId(), kind: 'landmark', landmark: kind, x, y, name: name(kind, x, y), importance });
  };

  // ---- the world's own landmarks, brought down ------------------------------
  const toSheet = (wx: number, wy: number) => {
    let dx = wx - g.originX;
    while (dx < -WW / 2) dx += WW;
    while (dx > WW / 2) dx -= WW;
    return { x: dx / g.worldPerCellX, y: (wy - g.originY) / g.worldPerCellY };
  };
  for (const l of world.landmarks) {
    const k = WORLD_KIND[l.type];
    if (!k) continue;
    const p = toSheet(l.x, l.y);
    if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) continue;
    // The world put it in a 20 km cell; put it on the most plausible spot inside
    // that cell rather than at the cell's corner, or a volcano ends up in a bog.
    const spot = refine(k, p.x, p.y, Math.max(3, 8 / cellKm), g, t, cover);
    push(k, spot.x, spot.y, 0.45 + l.strength * 0.4, 6);
  }

  // ---- waterfalls: where a stream loses height fast ------------------------
  //
  // Measured over about 400 m of channel, because that is what a fall is. Over a
  // kilometre every mountain stream looks like a waterfall; over one cell the
  // measurement is just noise in the elevation.
  const winCells = Math.max(2, Math.round(0.4 / cellKm));
  const fallWant = Math.max(1, Math.round((W * H * cellKm * cellKm) / 700));
  const falls: { x: number; y: number; s: number }[] = [];
  for (const s of streams) {
    if (s.areaKm2 < 8 || s.pts.length < winCells * 2 + 4) continue;
    for (let k = winCells; k < s.pts.length - winCells; k += winCells) {
      const a = s.pts[k - winCells], b = s.pts[k + winCells];
      const ea = sample(t.elevation, W, H, a.x, a.y);
      const eb = sample(t.elevation, W, H, b.x, b.y);
      const dropM = (ea - eb) * 1000;
      const runM = Math.hypot(b.x - a.x, b.y - a.y) * g.metresPerCell;
      if (runM < 1) continue;
      const grade = dropM / runM;
      if (grade < 0.16 || dropM < 18) continue;
      const imp = Math.min(1, (dropM / 90) * 0.6 + Math.min(1, s.areaKm2 / 400) * 0.5);
      falls.push({ x: s.pts[k].x, y: s.pts[k].y, s: imp });
    }
  }
  falls.sort((a, b) => b.s - a.s);
  for (let k = 0, placed = 0; k < falls.length && placed < fallWant; k++) {
    const before = out.length;
    push('waterfall', falls[k].x, falls[k].y, Math.min(1, falls[k].s), 6);
    if (out.length > before) placed++;
  }

  // ---- springs -------------------------------------------------------------
  //
  // A NAMED spring is a rare thing — the one the village is named after, the one
  // on the pilgrim road — and the first version of this treated every stream
  // head as one. On a sixty-kilometre sheet that produced dozens of "Fuente
  // de…" labels, which crowded out the villages and made the sheet unreadable.
  // Rarity is the feature: ranked, capped by area, and widely spaced.
  const springWant = Math.max(0, Math.round((W * H * cellKm * cellKm) / 900));
  const springs: { x: number; y: number; s: number }[] = [];
  for (const s of streams) {
    if (s.areaKm2 < 10) continue;
    const h = s.pts[0];
    const i = idx(W, H, h.x, h.y);
    // Wet ground on a break of slope is a spring line; the top of a bare scree
    // is where the water went in, not where it comes out.
    if (t.wet[i] < 0.45 || cover[i] === Cover.Rock || cover[i] === Cover.Scree) continue;
    springs.push({ x: h.x, y: h.y, s: t.wet[i] + Math.min(1, s.areaKm2 / 60) });
  }
  springs.sort((a, b) => b.s - a.s);
  for (let k = 0, placed = 0; k < springs.length && placed < springWant; k++) {
    const before = out.length;
    push('spring', springs[k].x, springs[k].y, 0.18, 9);
    if (out.length > before) placed++;
  }

  // ---- gorges: a channel with steep ground on both sides ---------------------
  const gorgeStep = Math.max(3, Math.round(1.2 / cellKm));
  const gorges: { x: number; y: number; s: number }[] = [];
  for (const s of streams) {
    if (s.areaKm2 < 20) continue;
    for (let k = gorgeStep; k < s.pts.length - gorgeStep; k += gorgeStep) {
      const p = s.pts[k];
      const i = idx(W, H, p.x, p.y);
      const e0 = t.elevation[i];
      // Look across the valley perpendicular to the channel.
      const a = s.pts[k - 1], b = s.pts[k + 1];
      const tx = b.x - a.x, ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len, ny = tx / len;
      const reach = Math.max(2, Math.round(0.5 / cellKm));
      const left = sample(t.elevation, W, H, p.x + nx * reach, p.y + ny * reach);
      const right = sample(t.elevation, W, H, p.x - nx * reach, p.y - ny * reach);
      const wall = Math.min(left, right) - e0;
      // Both sides at least 60 m above the water within half a kilometre.
      if (wall * 1000 < 60) continue;
      gorges.push({ x: p.x, y: p.y, s: wall });
    }
  }
  gorges.sort((a, b) => b.s - a.s);
  const gorgeWant = Math.max(0, Math.round((W * H * cellKm * cellKm) / 1400));
  for (let k = 0, placed = 0; k < gorges.length && placed < gorgeWant; k++) {
    const before = out.length;
    push('gorge', gorges[k].x, gorges[k].y, Math.min(1, gorges[k].s * 1000 / 220), 9);
    if (out.length > before) placed++;
  }

  // ---- crags: prominent bare rock ------------------------------------------
  const crags: { i: number; s: number }[] = [];
  for (let i = 0; i < W * H; i += 3) {
    if (cover[i] !== Cover.Rock) continue;
    if (t.slope[i] < 0.5) continue;
    crags.push({ i, s: t.slope[i] + t.elevation[i] * 0.3 });
  }
  crags.sort((a, b) => b.s - a.s);
  const cragWant = Math.max(0, Math.round((W * H * cellKm * cellKm) / 2200));
  for (let k = 0, placed = 0; k < crags.length && placed < cragWant; k++) {
    const i = crags[k].i;
    const before = out.length;
    push('crag', (i % W) + 0.5, ((i / W) | 0) + 0.5, 0.3, 8);
    if (out.length > before) placed++;
  }

  // ---- passes: the low way over a ridge ------------------------------------
  const passWant = Math.max(0, Math.round((W * H * cellKm * cellKm) / 3000));
  const reach = Math.max(3, Math.round(2.5 / cellKm));
  const passes: { x: number; y: number; s: number }[] = [];
  for (let y = reach; y < H - reach; y += 2) {
    for (let x = reach; x < W - reach; x += 2) {
      const i = y * W + x;
      if (t.water[i] !== 0 || t.elevation[i] < 0.35) continue;
      const e = t.elevation[i];
      // A saddle: higher on two opposite sides, lower on the other two.
      const n = t.elevation[(y - reach) * W + x], sS = t.elevation[(y + reach) * W + x];
      const w = t.elevation[y * W + (x - reach)], eE = t.elevation[y * W + (x + reach)];
      const ns = Math.min(n, sS) - e, we = Math.min(w, eE) - e;
      const up = Math.max(ns, we), down = Math.min(ns, we);
      if (up * 1000 < 140 || down * 1000 > -60) continue;
      passes.push({ x: x + 0.5, y: y + 0.5, s: up - down });
    }
  }
  passes.sort((a, b) => b.s - a.s);
  for (let k = 0, placed = 0; k < passes.length && placed < passWant; k++) {
    const before = out.length;
    push('pass', passes[k].x, passes[k].y, 0.42, 9);
    if (out.length > before) placed++;
  }

  // ---- named lakes ---------------------------------------------------------
  const lakeSeen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const rng = createRng(world.params.seed, `region-lakes:${Math.round(g.originX)}`);
  for (let s0 = 0; s0 < W * H; s0++) {
    if (t.water[s0] !== 2 || lakeSeen[s0]) continue;
    let sp = 0, cn = 0, sx = 0, sy = 0;
    stack[sp++] = s0; lakeSeen[s0] = 1;
    while (sp > 0) {
      const i = stack[--sp];
      cn++; sx += i % W; sy += (i / W) | 0;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const j = ny * W + nx;
        if (t.water[j] === 2 && !lakeSeen[j]) { lakeSeen[j] = 1; stack[sp++] = j; }
      }
    }
    const areaKm2 = cn * cellKm * cellKm;
    // Only the ones a person would give a name to. A tarn you can throw a stone
    // across is drawn, not labelled.
    if (areaKm2 < 3.5) continue;
    push('lake', sx / cn, sy / cn, Math.min(0.7, 0.3 + areaKm2 / 60), 3);
  }
  void rng;

  return out;
}

function idx(W: number, H: number, x: number, y: number): number {
  return Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)));
}

function sample(f: Float32Array, W: number, H: number, x: number, y: number): number {
  return f[idx(W, H, x, y)];
}

/**
 * Move a world-scale landmark onto the spot in its cell where it belongs.
 *
 * The world says "there is a volcano in this 20 km square". At 200 m per cell
 * that square is a hundred cells across, and putting the symbol at its corner is
 * how a volcano ends up in a lake. Each kind knows what ground it wants.
 */
function refine(
  kind: RegionLandmarkKind, cx: number, cy: number, r: number,
  g: RegionGeometry, t: TerrainFields, cover: Uint8Array,
): { x: number; y: number } {
  const W = g.width, H = g.height;
  let best = { x: cx, y: cy }, bestScore = -Infinity;
  const step = Math.max(1, Math.round(r / 8));
  for (let dy = -r; dy <= r; dy += step) {
    for (let dx = -r; dx <= r; dx += step) {
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
      if (Math.hypot(dx, dy) > r) continue;
      const i = y * W + x;
      if (t.water[i] !== 0) continue;
      let sc: number;
      switch (kind) {
        case 'volcano': sc = t.elevation[i] * 3 + t.slope[i]; break;
        case 'cave': sc = (cover[i] === Cover.Rock ? 1 : 0) + t.slope[i] * 2; break;
        case 'hotspring': sc = -t.slope[i] + t.wet[i]; break;
        case 'waterfall': sc = t.flow[i] * 2 + t.slope[i]; break;
        case 'gorge': sc = t.flow[i] + t.slope[i] * 2; break;
        default: sc = -Math.hypot(dx, dy);
      }
      if (sc > bestScore) { bestScore = sc; best = { x: x + 0.5, y: y + 0.5 }; }
    }
  }
  return best;
}
