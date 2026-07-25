// ============================================
// World Generator — Edit layer (painting)
// ============================================
// The engine stores a world as a seed plus parameters and regenerates it on
// demand, which is what keeps a library of worlds cheap. Painting threatens that
// directly: a brush stroke cannot be reconstructed from a seed.
//
// So a painted world is stored as SEED + PARAMS + AN ORDERED LIST OF EDITS. Every
// edit is small, plain JSON, and applying the list to a freshly generated world is
// deterministic, so the storage contract survives intact and undo is just a pop.
//
// The other thing painting has to get right is CONSEQUENCE. Raising ground is not
// a change of colour: it moves the coastline, which changes what is coastal, which
// changes the biome, which changes what the renderer draws there. So after any
// terrain edit the cheap derived fields are recomputed and the biome classifier is
// re-run — the painted terrain gets sensible ecology for free, and an explicit
// biome paint then overrides it. Climate is deliberately NOT re-run: a local
// stroke does not move the jet stream, and a two-second pause per brush stroke
// would make the tool unusable.

import { Biome, type BiomeId, type WorldData } from './types';
import { classifyBiomes } from './biomes';
import { distanceTo, localRelief } from './fields';
import { SphereNoise } from './noise';
import type { LandmarkType, MarkerKind, RuinKind } from './types';

// ---------------------------------------------------------------------------
// The edit vocabulary
// ---------------------------------------------------------------------------

export interface Pt { x: number; y: number }

/** A brush stroke: a polyline plus a radius. One drag is one edit, not one per
 *  pointer event, which keeps the saved list small and undo intuitive. */
export interface Stroke {
  pts: Pt[];
  /** Radius in world cells. */
  radius: number;
  /** 0–1. Terrain ops scale their magnitude by this; masks use it as opacity. */
  strength: number;
  /** 0–1: 0 is a hard edge, 1 is a fully feathered brush. */
  softness?: number;
}

export type TerrainOp = 'raise' | 'lower' | 'smooth' | 'flatten' | 'roughen';
export type LandOp = 'land' | 'sea';

// Both live in ./types: the ruin generator produces the same shapes from
// geography, and nothing downstream should be able to tell a painted ruin from a
// generated one.
export type { MarkerKind, RuinKind } from './types';

export const RUIN_LABEL: Record<RuinKind, string> = {
  city: 'ciudad en ruinas',
  fort: 'fortaleza derruida',
  tower: 'torre solitaria',
  temple: 'templo abandonado',
  stones: 'círculo de piedras',
  bridge: 'puente roto',
  mine: 'mina agotada',
  wall: 'muralla sin dueño',
};

export type WorldEdit =
  | { kind: 'terrain'; op: TerrainOp; stroke: Stroke }
  /** Paint coastline directly: turn sea into land or land into sea. */
  | { kind: 'land'; op: LandOp; stroke: Stroke }
  | { kind: 'biome'; biome: BiomeId; stroke: Stroke }
  /** A hand-drawn watercourse. Carves a shallow channel so it also affects
   *  drainage and the biomes along it, not just the ink. */
  | { kind: 'river'; pts: Pt[]; width: number }
  | {
    kind: 'marker';
    marker: MarkerKind;
    x: number;
    y: number;
    name?: string;
    /** For settlements. */
    rank?: 'capital' | 'city' | 'town' | 'village';
    population?: number;
    /** For ruins. */
    ruin?: RuinKind;
    /** For landmarks. */
    landmark?: LandmarkType;
  }
  | {
    kind: 'label';
    x: number;
    y: number;
    text: string;
    /** Which type style to draw it in. */
    style: 'region' | 'water' | 'range' | 'settlement' | 'note';
    size?: number;
    angle?: number;
  }
  /** Remove painted markers and labels within a radius. Terrain and biome
   *  paints are undone by dropping their edit, not by erasing over them. */
  | { kind: 'eraseMarkers'; x: number; y: number; radius: number };

export interface PaintedMarker {
  marker: MarkerKind;
  x: number;
  y: number;
  name?: string;
  rank?: 'capital' | 'city' | 'town' | 'village';
  population?: number;
  ruin?: RuinKind;
  landmark?: LandmarkType;
}

export interface PaintedLabel {
  x: number;
  y: number;
  text: string;
  style: 'region' | 'water' | 'range' | 'settlement' | 'note';
  size?: number;
  angle?: number;
}

export interface AppliedEdits {
  /** True when any edit touched elevation, so callers know the coastline moved. */
  terrainChanged: boolean;
  markers: PaintedMarker[];
  labels: PaintedLabel[];
  /** Rivers drawn by hand, in the same shape the renderer already expects. */
  rivers: { cells: Uint32Array; flow: number }[];
}

// ---------------------------------------------------------------------------
// Brush rasterisation
// ---------------------------------------------------------------------------

/**
 * Rasterise a stroke into a 0–1 coverage mask over its own bounding box.
 *
 * The mask is the MAXIMUM of the per-sample falloffs rather than their sum. That
 * distinction is the whole difference between a brush and a stain: summing makes
 * the paint darker wherever the pointer happened to move slowly, and every
 * hand-rolled paint tool has that bug once.
 */
function strokeMask(
  stroke: Stroke,
  W: number,
  H: number,
): { mask: Float32Array; x0: number; y0: number; w: number; h: number } | null {
  const r = Math.max(0.5, stroke.radius);
  const soft = Math.min(1, Math.max(0, stroke.softness ?? 0.6));
  if (!stroke.pts.length) return null;

  // Bounding box in unwrapped coordinates around the first point, so a stroke
  // across the seam stays contiguous.
  const ax = stroke.pts[0].x;
  const un = stroke.pts.map((p) => {
    let x = p.x;
    while (x - ax > W / 2) x -= W;
    while (x - ax < -W / 2) x += W;
    return { x, y: p.y };
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of un) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const pad = Math.ceil(r) + 2;
  const x0 = Math.floor(minX) - pad;
  const y0 = Math.max(0, Math.floor(minY) - pad);
  const x1 = Math.ceil(maxX) + pad;
  const y1 = Math.min(H - 1, Math.ceil(maxY) + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w <= 0 || h <= 0 || w > W * 2) return null;
  const mask = new Float32Array(w * h);

  const inner = r * (1 - soft);
  for (let k = 0; k < un.length; k++) {
    const a = un[k];
    const b = un[Math.min(un.length - 1, k + 1)];
    // Walk the segment at half-cell steps so a fast drag leaves no gaps.
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(segLen * 2));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.y + (b.y - a.y) * t;
      const gx0 = Math.max(x0, Math.floor(cx - r));
      const gx1 = Math.min(x1, Math.ceil(cx + r));
      const gy0 = Math.max(y0, Math.floor(cy - r));
      const gy1 = Math.min(y1, Math.ceil(cy + r));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const d = Math.hypot(gx - cx, gy - cy);
          if (d > r) continue;
          const f = d <= inner ? 1 : 1 - (d - inner) / Math.max(1e-6, r - inner);
          const sm = f * f * (3 - 2 * f);
          const mi = (gy - y0) * w + (gx - x0);
          if (sm > mask[mi]) mask[mi] = sm;
        }
      }
    }
  }
  return { mask, x0, y0, w, h };
}


/**
 * Bounding window of every raster edit in the list, padded, or null for "all of
 * it" when the edits are spread widely enough that a window buys nothing.
 *
 * Expressed with a possibly-negative x0 and a width, so a stroke across the seam
 * stays one rectangle instead of two.
 */
function touchedRect(edits: WorldEdit[], W: number, H: number, pad: number) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let anchor: number | null = null;
  const note = (x: number, y: number, r: number) => {
    if (anchor === null) anchor = x;
    let ux = x;
    while (ux - anchor > W / 2) ux -= W;
    while (ux - anchor < -W / 2) ux += W;
    minX = Math.min(minX, ux - r); maxX = Math.max(maxX, ux + r);
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
  };
  for (const e of edits) {
    if (e.kind === 'terrain' || e.kind === 'land') {
      for (const p of e.stroke.pts) note(p.x, p.y, e.stroke.radius);
    } else if (e.kind === 'river') {
      for (const p of e.pts) note(p.x, p.y, Math.max(1, e.width));
    }
  }
  if (anchor === null) return undefined;
  const x0 = Math.floor(minX) - pad;
  const w = Math.ceil(maxX) + pad - x0 + 1;
  const y0 = Math.max(0, Math.floor(minY) - pad);
  const h = Math.min(H, Math.ceil(maxY) + pad + 1) - y0;
  if (w >= W || h >= H) return undefined;
  return { x0, y0, w, h };
}

/** Iterate a stroke mask, handing the caller a wrapped world index and coverage. */
function forEachMasked(
  s: ReturnType<typeof strokeMask>,
  W: number,
  H: number,
  fn: (i: number, cover: number) => void,
): void {
  if (!s) return;
  for (let gy = 0; gy < s.h; gy++) {
    const wy = s.y0 + gy;
    if (wy < 0 || wy >= H) continue;
    for (let gx = 0; gx < s.w; gx++) {
      const cover = s.mask[gy * s.w + gx];
      if (cover <= 0.002) continue;
      const wx = ((s.x0 + gx) % W + W) % W;
      fn(wy * W + wx, cover);
    }
  }
}

// ---------------------------------------------------------------------------
// Applying edits
// ---------------------------------------------------------------------------

/**
 * Apply an edit list to a freshly generated world, in place.
 *
 * Order is fixed and matters: terrain and coastline first (they change what
 * everything else means), then the derived fields and the biome classifier, then
 * explicit biome paints on top, then rivers, then markers and labels.
 */
export function applyEdits(world: WorldData, edits: WorldEdit[]): AppliedEdits {
  const W = world.width, H = world.height, N = W * H;
  const out: AppliedEdits = { terrainChanged: false, markers: [], labels: [], rivers: [] };
  if (!edits.length) return out;
  // Any consumer that caches something derived from this world keys on the
  // revision, so bumping it here is what makes a stroke actually appear.
  world.revision = (world.revision ?? 0) + 1;

  const elev = world.elevation;

  // ---- 1. terrain and coastline ------------------------------------------
  for (const e of edits) {
    if (e.kind === 'terrain') {
      const s = strokeMask(e.stroke, W, H);
      const amp = 0.9 * e.stroke.strength;
      if (e.op === 'smooth' || e.op === 'flatten') {
        // Both need a reference height, so collect first and write after.
        const idx: number[] = [];
        const cov: number[] = [];
        forEachMasked(s, W, H, (i, c) => { idx.push(i); cov.push(c); });
        if (!idx.length) continue;
        if (e.op === 'flatten') {
          // Level to the mean under the brush: a plateau, a terrace, a plaza.
          let mean = 0;
          for (const i of idx) mean += elev[i];
          mean /= idx.length;
          for (let k = 0; k < idx.length; k++) {
            elev[idx[k]] += (mean - elev[idx[k]]) * cov[k] * e.stroke.strength;
          }
        } else {
          const before = new Float32Array(idx.length);
          for (let k = 0; k < idx.length; k++) before[k] = elev[idx[k]];
          for (let k = 0; k < idx.length; k++) {
            const i = idx[k];
            const x = i % W, y = (i / W) | 0;
            let sum = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++) {
              const yy = y + dy;
              if (yy < 0 || yy >= H) continue;
              for (let dx = -1; dx <= 1; dx++) {
                sum += elev[yy * W + ((x + dx + W) % W)];
                n++;
              }
            }
            elev[i] = before[k] + (sum / n - before[k]) * cov[k] * e.stroke.strength;
          }
        }
      } else if (e.op === 'roughen') {
        // Deterministic per-cell jitter: the same stroke always roughens the
        // same way, which matters because the edit list is replayed.
        forEachMasked(s, W, H, (i, c) => {
          const hsh = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
          const n = (hsh - Math.floor(hsh)) * 2 - 1;
          elev[i] += n * amp * 0.35 * c;
        });
      } else {
        const sign = e.op === 'raise' ? 1 : -1;
        forEachMasked(s, W, H, (i, c) => { elev[i] += sign * amp * c; });
      }
      out.terrainChanged = true;
    } else if (e.kind === 'land') {
      const s = strokeMask(e.stroke, W, H);
      // Painting coastline is a MAX/MIN against a dome, not a lerp toward a
      // target. The lerp version read plausibly and did not work: over 4 km of
      // ocean floor, one full-strength pass moved the sea bed to −330 m and
      // created twenty-one cells of land out of a stroke the width of a country.
      //
      // As a max against a dome it also becomes idempotent — painting the same
      // land twice is the same land — and existing higher ground is left alone.
      const coast = new SphereNoise(world.params.seed, 'paint-coast');
      // New land comes out LOW. This brush draws a coastline; the relief brush
      // makes mountains. At the old amplitude a single coast stroke produced a
      // range of peaks, which took the choice away from the reader.
      const amp = e.op === 'land'
        ? 0.05 + 0.22 * e.stroke.strength
        : 0.1 + 0.5 * e.stroke.strength;
      forEachMasked(s, W, H, (i, c) => {
        const x = ((i % W) + 0.5) / W, y = (((i / W) | 0) + 0.5) / H;
        // Roughen the dome so the new 0-contour is ragged. A clean dome gives a
        // painted island the silhouette of a coin, which no amount of good ink
        // downstream can disguise.
        const n = 0.72 + 0.62 * coast.fbm(x, y, 34, 4);
        const h = amp * c * n;
        if (e.op === 'land') elev[i] = Math.max(elev[i], h);
        else elev[i] = Math.min(elev[i], -h);
      });
      out.terrainChanged = true;
    } else if (e.kind === 'river') {
      // Carve a shallow channel so the drawn river also shows up in drainage,
      // relief and the biomes along its banks.
      const s = strokeMask({ pts: e.pts, radius: Math.max(0.8, e.width), strength: 1, softness: 0.9 }, W, H);
      forEachMasked(s, W, H, (i, c) => {
        if (elev[i] > 0) elev[i] = Math.max(0.004, elev[i] - 0.055 * c);
      });
      out.terrainChanged = true;
    }
  }

  // ---- 2. re-derive what the terrain decides -----------------------------
  if (out.terrainChanged) {
    const seaMask = new Uint8Array(N);
    for (let i = 0; i < N; i++) seaMask[i] = elev[i] <= 0 ? 1 : 0;
    const seaDist = distanceTo(seaMask, W, H);
    const reliefR = Math.max(3, Math.round(W / 150));
    const relief = localRelief(elev, W, H, reliefR);
    // Lakes are a hydrology product; a painted basin below sea level should read
    // as sea, not as a lake, so clear any lake flag the edit drowned.
    for (let i = 0; i < N; i++) if (elev[i] <= 0) world.lake[i] = 0;
    // Re-classify only the window the edits could have reached. Classification is
    // strictly per-cell, so restricting the loop is exact rather than an
    // approximation — and it is the difference between 150 ms and a few ms per
    // brush stroke. The distance and relief fields above stay global: they are
    // cheaper, and an exact windowed EDT needs its border seeded from outside the
    // window, which is a different and much easier thing to get wrong.
    classifyBiomes(world.params, {
      elevation: elev,
      temperature: world.temperature,
      precipitation: world.precipitation,
      lake: world.lake,
      flow: world.flow,
      relief,
      seaDist,
    }, touchedRect(edits, W, H, reliefR + 3), world.biome);
  }

  // ---- 3. explicit biome paint, which wins over the classifier -----------
  for (const e of edits) {
    if (e.kind !== 'biome') continue;
    const s = strokeMask(e.stroke, W, H);
    forEachMasked(s, W, H, (i, c) => {
      // A soft edge on a categorical field cannot blend, so coverage becomes a
      // threshold. Dithering it by cell index keeps the border ragged instead of
      // drawing a hard circle.
      const hsh = Math.sin(i * 45.164 + 11.71) * 27183.13;
      const jitter = (hsh - Math.floor(hsh)) * 0.45;
      if (c * e.stroke.strength <= 0.35 + jitter * 0.4) return;
      // Painting a land biome onto sea would be a contradiction; lift it first.
      if (elev[i] <= 0 && e.biome !== Biome.Ocean && e.biome !== Biome.Lake) return;
      world.biome[i] = e.biome;
    });
  }

  // ---- 4. hand-drawn rivers as polylines ---------------------------------
  for (const e of edits) {
    if (e.kind !== 'river' || e.pts.length < 2) continue;
    const cells: number[] = [];
    for (let k = 1; k < e.pts.length; k++) {
      const a = e.pts[k - 1], b = e.pts[k];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = ((Math.round(a.x + (b.x - a.x) * t) % W) + W) % W;
        const y = Math.min(H - 1, Math.max(0, Math.round(a.y + (b.y - a.y) * t)));
        const i = y * W + x;
        if (cells[cells.length - 1] !== i) cells.push(i);
      }
    }
    if (cells.length >= 2) {
      out.rivers.push({ cells: Uint32Array.from(cells), flow: Math.min(1, e.width / 3) });
    }
  }

  // ---- 5. markers and labels ---------------------------------------------
  for (const e of edits) {
    if (e.kind === 'marker') {
      out.markers.push({
        marker: e.marker, x: e.x, y: e.y, name: e.name, rank: e.rank,
        population: e.population, ruin: e.ruin, landmark: e.landmark,
      });
    } else if (e.kind === 'label') {
      out.labels.push({ x: e.x, y: e.y, text: e.text, style: e.style, size: e.size, angle: e.angle });
    }
  }
  // Erasers apply to everything painted before them, in order.
  for (const e of edits) {
    if (e.kind !== 'eraseMarkers') continue;
    const hit = (p: { x: number; y: number }) => {
      let dx = Math.abs(p.x - e.x);
      if (dx > W / 2) dx = W - dx;
      return dx * dx + (p.y - e.y) ** 2 <= e.radius * e.radius;
    };
    out.markers = out.markers.filter((m) => !hit(m));
    out.labels = out.labels.filter((l) => !hit(l));
  }

  // Hand-placed content is parked on the world, not just returned: the human
  // geography merges painted towns into the road network and the renderer draws
  // painted rivers alongside the generated ones. A caller that only gets a return
  // value has to remember to plumb it through five layers, and won't.
  world.painted = out;
  return out;
}

/** Rough cost estimate, so the UI can warn before a stroke that will take a
 *  visible moment. Terrain edits pay for the distance transform and a full
 *  reclassification; everything else is local. */
export function editCostClass(edits: WorldEdit[]): 'local' | 'global' {
  return edits.some((e) => e.kind === 'terrain' || e.kind === 'land' || e.kind === 'river')
    ? 'global'
    : 'local';
}

/** Compact JSON for storage alongside the seed and parameters. Coordinates are
 *  rounded: sub-cell precision in a saved stroke is noise. */
export function serializeEdits(edits: WorldEdit[]): string {
  const round = (p: Pt) => ({ x: Math.round(p.x * 4) / 4, y: Math.round(p.y * 4) / 4 });
  return JSON.stringify(edits.map((e) => {
    if ('stroke' in e) return { ...e, stroke: { ...e.stroke, pts: e.stroke.pts.map(round) } };
    if (e.kind === 'river') return { ...e, pts: e.pts.map(round) };
    return e;
  }));
}

export function deserializeEdits(json: string): WorldEdit[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as WorldEdit[]) : [];
  } catch {
    return [];
  }
}
