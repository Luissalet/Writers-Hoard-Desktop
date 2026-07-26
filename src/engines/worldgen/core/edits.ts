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
import type { LandmarkType, MarkerKind, RuinKind } from './types';
// The brushes live in one place and both callers go through it: this replay and
// the live preview in the sculpt view. See sculpt/ops.ts for why.
import {
  strokeMask, maskForOp, applyTerrainOp, applyLandOp, snapshotBase, opBaseRect, grabVector,
  type Falloff,
} from '../sculpt/ops';

export type { Falloff, BrushTip } from '../sculpt/ops';
import type { BrushTip } from '../sculpt/ops';

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
  /**
   * The shape of the edge. Absent means the smoothstep the tool has always used,
   * so every world saved before this existed replays unchanged.
   */
  curve?: Falloff;
  /**
   * The brush head. Every field below is optional for the same reason `curve`
   * is: a stroke saved before they existed must replay as the disc it was.
   */
  tip?: BrushTip;
  /** Degrees. Used by the square head; a ridge takes it from the drag. */
  angle?: number;
  /** 0–1, how broken the rim of a ragged head is. */
  jitter?: number;
  /** How much longer than wide a ridge head is. */
  aspect?: number;
  /** 0–1, how far the stroke fades towards its two ends. */
  taper?: number;
}

/**
 * Where a stroke is ALLOWED to land.
 *
 * The difference between colouring in and building a world. "Tundra above
 * fifteen hundred metres", "marsh only where the ground is flat", "sand only on
 * the seaward side" — every one of those is a rule you would otherwise have to
 * follow by hand, badly, with a small brush. Absent means everywhere, which is
 * what every stroke stored before this did.
 */
export interface PaintFilter {
  /** 'land' skips anything at or below sea level; 'sea' skips anything above. */
  where?: 'land' | 'sea';
  /** Metres. */
  minElev?: number;
  maxElev?: number;
  /** Metres of fall across one cell — the local steepness. */
  minSlope?: number;
  maxSlope?: number;
}

export type TerrainOp =
  | 'raise' | 'lower' | 'smooth' | 'flatten' | 'roughen'
  // Added with the 3D sculpt view. All four are pure functions of the stroke and
  // the pre-stroke field, so they cost the storage contract nothing.
  /** The opposite of smooth: sharpen ridges, deepen valleys. */
  | 'sharpen'
  /** Quantise to benches: mesas, badlands, dry canyon steps. */
  | 'terrace'
  /** Cut ridge-and-gully texture into slopes, proportional to how steep they are. */
  | 'gully'
  /** Take hold of the ground and move it. */
  | 'grab';
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
  | { kind: 'biome'; biome: BiomeId; stroke: Stroke; only?: PaintFilter }
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
  /** Remove painted markers and labels within a radius. */
  | { kind: 'eraseMarkers'; x: number; y: number; radius: number }
  /**
   * Give a patch of ground back to the classifier.
   *
   * The negative of the biome brush, and the one negative that is not simply
   * "the opposite colour": what you want when you regret a stroke of desert is
   * not another colour, it is whatever the world would have decided on its own.
   * Applied in list order with the biome paints, so it undoes only what was
   * painted BEFORE it — which is what makes it a brush stroke rather than a
   * command.
   */
  | { kind: 'eraseBiome'; stroke: Stroke }
  /** The negative of the river brush: unmake the watercourses it crosses. */
  | { kind: 'eraseRivers'; x: number; y: number; radius: number }
  /**
   * Rename something the GENERATOR produced.
   *
   * Identified by a position-derived key rather than by array index: a world is
   * regenerated from its seed every time it is opened, and while the same seed
   * always puts the same city in the same place, nothing guarantees it keeps the
   * same index once a filter or a parameter changes. A rename that survives only
   * until the reader adjusts a slider is not a rename.
   */
  | { kind: 'rename'; target: EditTarget; key: string; name: string }
  /** Delete something the generator produced: a town, a ruin, a road, a name. */
  | { kind: 'remove'; target: EditTarget; key: string }
  /** A road drawn by hand between two places. */
  | { kind: 'road'; pts: Pt[]; major: boolean }
  /** Erase generated roads passing within a radius. */
  | { kind: 'eraseRoads'; x: number; y: number; radius: number };

export type EditTarget = 'settlement' | 'ruin' | 'realm' | 'feature' | 'road';

/**
 * Identity for a generated river: the cell it ends at.
 *
 * A river is regenerated from the seed every time the world is opened, so it has
 * no id worth storing. Its mouth is the one cell that does not move while the
 * river exists, which makes it the natural name for "this river".
 */
export function riverKey(cells: ArrayLike<number>): string {
  return `river:${cells[cells.length - 1]}`;
}

/** Stable identity for a generated object, derived from where it is. */
export function editKey(target: EditTarget, x: number, y: number, extra = ''): string {
  return `${target}:${extra}${Math.round(x)},${Math.round(y)}`;
}

const TARGETS: EditTarget[] = ['settlement', 'ruin', 'realm', 'feature', 'road'];

/**
 * Read the target back out of a key.
 *
 * The alternative is a table mapping every place kind the atlas knows to an
 * edit target, kept in step by hand. The key already carries the answer —
 * `editKey` put it there — so ask the key.
 */
export function targetFromKey(key: string): EditTarget | null {
  const head = key.slice(0, key.indexOf(':'));
  return (TARGETS as string[]).includes(head) ? head as EditTarget : null;
}

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
  /** Generated-object key → the name the reader gave it. */
  renames: Record<string, string>;
  /** Keys of generated objects the reader deleted. */
  removed: Set<string>;
  /** Roads drawn by hand. */
  roads: { cells: number[]; major: boolean }[];
  /** Circles inside which generated roads are erased. */
  roadErasers: { x: number; y: number; radius: number }[];
}

// ---------------------------------------------------------------------------
// Brush rasterisation
// ---------------------------------------------------------------------------

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
      // `grab` moves ground from outside its own disc, so the window has to cover
      // where the material came from as well as where it went.
      const g = e.kind === 'terrain' && e.op === 'grab' ? grabVector(e.stroke, W) : { dx: 0, dy: 0 };
      for (const p of e.stroke.pts) {
        note(p.x, p.y, e.stroke.radius);
        if (g.dx || g.dy) note(p.x - g.dx, p.y - g.dy, e.stroke.radius);
      }
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
/**
 * A test for "may this cell be painted", compiled once per stroke.
 *
 * Slope is the fall across one cell in metres, from central differences — the
 * same quantity the eye reads as steepness, and cheap enough to evaluate per
 * cell without anybody noticing.
 */
function filterFor(
  f: PaintFilter, elev: Float32Array, W: number, H: number,
): (i: number) => boolean {
  const needSlope = f.minSlope !== undefined || f.maxSlope !== undefined;
  return (i: number): boolean => {
    const e = elev[i];
    if (f.where === 'land' && e <= 0) return false;
    if (f.where === 'sea' && e > 0) return false;
    const m = e * 1000;
    if (f.minElev !== undefined && m < f.minElev) return false;
    if (f.maxElev !== undefined && m > f.maxElev) return false;
    if (needSlope) {
      const x = i % W, y = (i / W) | 0;
      const xl = y * W + ((x - 1 + W) % W), xr = y * W + ((x + 1) % W);
      const yu = Math.max(0, y - 1) * W + x, yd = Math.min(H - 1, y + 1) * W + x;
      const s = (Math.abs(elev[xr] - elev[xl]) + Math.abs(elev[yd] - elev[yu])) * 500;
      if (f.minSlope !== undefined && s < f.minSlope) return false;
      if (f.maxSlope !== undefined && s > f.maxSlope) return false;
    }
    return true;
  };
}

/**
 * The distance-to-sea field, recomputed only when the sea actually moved.
 *
 * The exact EDT is 230 ms of the ~410 ms a brush stroke costs, and it depends on
 * ONE thing: which cells are below sea level. Raising a ridge inland does not
 * move a single coastline cell — measured, exactly zero — so the whole transform
 * was being recomputed to produce the array it had already produced. Comparing
 * the two masks costs three milliseconds a word at a time.
 *
 * The cache hangs off the world in a WeakMap, so it lives exactly as long as the
 * world object does and never has to be invalidated by hand.
 */
interface SeaCache { mask: Uint8Array; dist: Float32Array }
const SEA_CACHE = new WeakMap<WorldData, SeaCache>();

function sameMask(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  // Both are freshly allocated, so both start at byte offset zero and the
  // 32-bit view is safe.
  const words = a.length >>> 2;
  const A = new Uint32Array(a.buffer, 0, words);
  const B = new Uint32Array(b.buffer, 0, words);
  for (let i = 0; i < words; i++) if (A[i] !== B[i]) return false;
  for (let i = words << 2; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function seaDistanceFor(world: WorldData, elev: Float32Array, W: number, H: number): Float32Array {
  const N = W * H;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = elev[i] <= 0 ? 1 : 0;
  const hit = SEA_CACHE.get(world);
  if (hit && sameMask(hit.mask, mask)) return hit.dist;
  const dist = distanceTo(mask, W, H);
  SEA_CACHE.set(world, { mask, dist });
  return dist;
}

export function applyEdits(world: WorldData, edits: WorldEdit[]): AppliedEdits {
  const W = world.width, H = world.height, N = W * H;
  const out: AppliedEdits = {
    terrainChanged: false, markers: [], labels: [], rivers: [],
    renames: {}, removed: new Set(), roads: [], roadErasers: [],
  };
  if (!edits.length) return out;
  // Any consumer that caches something derived from this world keys on the
  // revision, so bumping it here is what makes a stroke actually appear.
  world.revision = (world.revision ?? 0) + 1;

  const elev = world.elevation;

  // ---- 1. terrain and coastline ------------------------------------------
  //
  // Both go through sculpt/ops.ts, which is also what the sculpt view runs while
  // you are dragging. That is the point of the module: the preview and the replay
  // are not two implementations that were written to agree, they are one.
  for (const e of edits) {
    if (e.kind === 'terrain') {
      const s = maskForOp(e.op, e.stroke, W, H);
      if (!s || s.empty) continue;
      // The ops that read cells other than the one they write need the heights as
      // they were before this edit; `opBaseRect` says exactly which ones.
      const r = opBaseRect(e.op, e.stroke, s, W);
      const base = snapshotBase(elev, W, H, r.x0, r.y0, r.w, r.h);
      applyTerrainOp(e.op, elev, base, W, H, s, e.stroke, world.params.seed);
      out.terrainChanged = true;
    } else if (e.kind === 'land') {
      const s = strokeMask(e.stroke, W, H);
      if (!s || s.empty) continue;
      // Painting coastline is a MAX/MIN against a dome, not a lerp toward a
      // target. The lerp version read plausibly and did not work: over 4 km of
      // ocean floor, one full-strength pass moved the sea bed to −330 m and
      // created twenty-one cells of land out of a stroke the width of a country.
      //
      // As a max against a dome it also becomes idempotent — painting the same
      // land twice is the same land — and existing higher ground is left alone.
      applyLandOp(e.op, elev, { at: (i) => elev[i] }, W, H, s, e.stroke, world.params.seed);
      out.terrainChanged = true;
    } else if (e.kind === 'river') {
      // Carve a shallow channel so the drawn river also shows up in drainage,
      // relief and the biomes along its banks.
      const s = strokeMask({ pts: e.pts, radius: Math.max(0.8, e.width), strength: 1, softness: 0.9 }, W, H);
      s?.each((i, c) => {
        if (elev[i] > 0) elev[i] = Math.max(0.004, elev[i] - 0.055 * c);
      });
      out.terrainChanged = true;
    }
  }

  // ---- 2. re-derive what the terrain decides -----------------------------
  if (out.terrainChanged) {
    const seaDist = seaDistanceFor(world, elev, W, H);
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
  //
  // Resolved into an OVERLAY first rather than written straight into the world,
  // because the eraser has to be able to take a painted cell back off — and it
  // can only do that if what the classifier decided is still sitting underneath.
  // Order matters and is the list's order: paint, erase, paint again.
  let overlay: Int16Array | null = null;
  for (const e of edits) {
    if (e.kind !== 'biome' && e.kind !== 'eraseBiome') continue;
    if (!overlay) { overlay = new Int16Array(N); overlay.fill(-1); }
    const s = strokeMask(e.stroke, W, H);
    const painting = e.kind === 'biome';
    const allow = painting && e.only ? filterFor(e.only, elev, W, H) : null;
    s?.each((i, c) => {
      if (allow && !allow(i)) return;
      // A soft edge on a categorical field cannot blend, so coverage becomes a
      // threshold. Dithering it by cell index keeps the border ragged instead of
      // drawing a hard circle.
      const hsh = Math.sin(i * 45.164 + 11.71) * 27183.13;
      const jitter = (hsh - Math.floor(hsh)) * 0.45;
      if (c * e.stroke.strength <= 0.35 + jitter * 0.4) return;
      if (!painting) { overlay![i] = -1; return; }
      // Painting a land biome onto sea would be a contradiction; lift it first.
      if (elev[i] <= 0 && e.biome !== Biome.Ocean && e.biome !== Biome.Lake) return;
      overlay![i] = e.biome;
    });
  }
  if (overlay) {
    for (let i = 0; i < N; i++) if (overlay[i] >= 0) world.biome[i] = overlay[i];
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

  // ---- 4b. and unmaking them --------------------------------------------
  //
  // Both kinds, because "erase the river I am dragging over" has to mean the
  // river the reader can SEE, and half the rivers they can see came from the
  // generator. A generated one cannot be deleted from `world.rivers` — that
  // array is rebuilt from the seed every time — so it is marked, by the cell it
  // ends at, and the two renderers skip what is marked.
  for (const e of edits) {
    if (e.kind !== 'eraseRivers') continue;
    const r2 = Math.max(1, e.radius) ** 2;
    const near = (cell: number): boolean => {
      const x = cell % W, y = (cell / W) | 0;
      let dx = Math.abs(x - e.x);
      if (dx > W / 2) dx = W - dx;
      return dx * dx + (y - e.y) ** 2 <= r2;
    };
    for (let k = out.rivers.length - 1; k >= 0; k--) {
      if (out.rivers[k].cells.some(near)) out.rivers.splice(k, 1);
    }
    for (const r of world.rivers) {
      if (r.cells.length && r.cells.some(near)) out.removed.add(riverKey(r.cells));
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
    } else if (e.kind === 'rename') {
      out.renames[e.key] = e.name;
    } else if (e.kind === 'remove') {
      out.removed.add(e.key);
    } else if (e.kind === 'road' && e.pts.length >= 2) {
      // Rasterised to cells so it draws through exactly the same road layer the
      // generated ones use — a hand-drawn road must not be distinguishable.
      const cells: number[] = [];
      for (let k = 1; k < e.pts.length; k++) {
        const a = e.pts[k - 1], b = e.pts[k];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
        for (let t = 0; t <= steps; t++) {
          const f = t / steps;
          const x = ((Math.round(a.x + (b.x - a.x) * f) % W) + W) % W;
          const y = Math.min(H - 1, Math.max(0, Math.round(a.y + (b.y - a.y) * f)));
          const i = y * W + x;
          if (cells[cells.length - 1] !== i) cells.push(i);
        }
      }
      if (cells.length >= 2) out.roads.push({ cells, major: e.major });
    } else if (e.kind === 'eraseRoads') {
      out.roadErasers.push({ x: e.x, y: e.y, radius: e.radius });
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
  return edits.some((e) => e.kind === 'terrain' || e.kind === 'land' || e.kind === 'river'
    || e.kind === 'eraseBiome')
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
