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
  /**
   * WHERE A COUNTRY REACHES.
   *
   * The generator grows realms by cost-based flood fill from the capitals, so
   * their borders settle onto ridges and wastes the way real ones do — a good
   * first draft and, for a novelist, only ever a first draft. The war that moved
   * the frontier is not in the terrain.
   *
   * Three shapes, because redrawing a border is three different gestures:
   *   · `realm`     a brush, for nudging a frontier a few leagues
   *   · `realmFill` a bucket that stops at real edges, for "this whole peninsula"
   *   · `realmArea` a polygon, for "these provinces, exactly here"
   *
   * `realm` is an INDEX into `geography.realms`, or −1 for unclaimed. The index
   * is what `realmEditKey` already uses for renames, so the two agree; like a
   * rename, a painted border follows the seed, and a world regenerated with
   * different capitals can hand a province to a neighbour.
   */
  | { kind: 'realm'; realm: number; stroke: Stroke }
  /**
   * Bucket fill, stopped by the ground itself.
   *
   * `bounded` says what counts as an edge. `coast` is always an edge — a country
   * does not flow across the sea — and the other two add the features a reader
   * points at when they say "up to the river" or "the far side of the range".
   */
  | { kind: 'realmFill'; realm: number; x: number; y: number;
      bounded: 'coast' | 'river' | 'ridge'; maxCells?: number }
  /** A closed shape. `smooth` rounds the corners first, which is the difference
   *  between the straight-edged and the curved lasso. */
  | { kind: 'realmArea'; realm: number; pts: Pt[]; smooth: boolean }
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
  /**
   * Reveal a previously removed generated object. Kept as an ordered edit so a
   * later remove can hide it again and undo remains a simple list operation.
   */
  | { kind: 'restore'; target: EditTarget; key: string }
  /**
   * Move a generated object without changing its deterministic identity.
   * Coordinates belong to the override, never to the key.
   */
  | { kind: 'move'; target: EditTarget; key: string; x: number; y: number }
  /**
   * How many people live here.
   *
   * A settlement's population is generated from its rank and its ground, and
   * the reader may disagree — a town can be the capital of the story without
   * being the capital of the map. Stored like a rename: against the thing's
   * key, replayed on every rebuild, so it survives a stroke, a reopen and a
   * regeneration of the world from its seed.
   */
  | { kind: 'populate'; target: EditTarget; key: string; population: number }
  /** Change only presentation; semantic `type` remains generator-owned. */
  | {
    kind: 'style';
    target: EditTarget;
    key: string;
    style: import('./spatialEntities').WorldSpatialStyleOverride;
  }
  /** A road drawn by hand between two places. */
  | { kind: 'road'; pts: Pt[]; major: boolean }
  /**
   * EL GRIFO DE LOS LUGARES ALEATORIOS (Luis, 2026-08-12: «no he pedido
   * abadías, casas, monasterios»). El sembrado regional — granjas, aldeas,
   * abadías, molinos, torres, ventas, minas — está APAGADO por defecto en
   * todos los mundos; este edit lo abre para el mundo entero (el tick del
   * menú lateral). Es una edición y no un parámetro a propósito: viaja con
   * la lista (se guarda, se deshace con Ctrl+Z, invalida el canon tocado por
   * el hash de ediciones) sin abrir un segundo canal de persistencia. Los
   * pueblos del MUNDO (capitales, villas…) no pasan por aquí: eso es la
   * geografía humana, no el sembrado de comarca.
   */
  | { kind: 'placesEverywhere'; enabled: boolean }
  /**
   * «Generar lugares en esta zona»: el pincel de lugares. `add` siembra el
   * enrejado regional sólo bajo la pincelada (con el grifo global cerrado);
   * `remove` (Ctrl, el negativo universal) lo vacía aunque el grifo esté
   * abierto. `pts` en celdas del mundo, `radius` en celdas — la geometría
   * exacta de un trazo de calzada, y con su misma invalidación: sólo las
   * superteselas que la pincelada pisa se vuelven a fraguar.
   */
  | { kind: 'placesZone'; mode: 'add' | 'remove'; pts: Pt[]; radius: number }
  /** Erase generated roads passing within a radius. */
  | { kind: 'eraseRoads'; x: number; y: number; radius: number };

export type EditTarget =
  | 'settlement' | 'ruin' | 'realm' | 'feature' | 'landmark' | 'region' | 'road'
  // Los rótulos pintados: identidad = posición de ORIGEN (`label:x,y`), como
  // todo lo demás. Sin llave propia no se podían arrastrar — eran el único
  // objeto del mapa que respondía al puntero y no al gesto de mover.
  | 'label';

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

const TARGETS: EditTarget[] = [
  'settlement', 'ruin', 'realm', 'feature', 'landmark', 'region', 'road', 'label',
];

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

/**
 * The one key a realm answers to.
 *
 * A country is the only generated thing with no position of its own — it is
 * ground, not a point — so its key carries its INDEX and a placeholder 0,0.
 * That spelling (`realm:3:0,0`) is what the Índice files a rename under and
 * what the picker returns, and it lives in this function because the readers
 * drifted from it once and nobody noticed: they looked up `realm:3`, matched
 * nothing, and every rename of a country was stored, counted in the badge and
 * persisted forever while the map, the hover readout and the country picker all
 * went on showing the generated name.
 */
export function realmEditKey(id: number): string {
  return editKey('realm', 0, 0, `${id}:`);
}

/**
 * Equivalent persisted keys for an edit action.
 *
 * Landmarks have a historical alias: a legacy `feature:` REMOVE still hides a
 * landmark because the resolver reads it, and a new landmark RESTORE clears both
 * spellings so old worlds can genuinely reveal the object again.
 *
 * Realms have the short `realm:<id>` the readers used to look for. No writer
 * ever produced it, so in principle no saved world carries one — but the cost of
 * accepting it is a string comparison, and a name the reader typed months ago is
 * not something to break on a guess about what old builds shipped.
 */
export function compatibleEditKeys(target: EditTarget, key: string): string[] {
  if (target === 'realm') {
    const id = Number(key.slice(key.indexOf(':') + 1).split(':')[0]);
    if (!Number.isFinite(id)) return [key];
    const all = [key, realmEditKey(id), `realm:${id}`];
    return all.filter((k, i) => all.indexOf(k) === i);
  }
  if (target !== 'landmark') return [key];
  if (key.startsWith('landmark:')) {
    return [key, `feature:${key.slice('landmark:'.length)}`];
  }
  if (key.startsWith('feature:')) {
    return [key, `landmark:${key.slice('feature:'.length)}`];
  }
  return [key];
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
  /** La política de sembrado que dicta la lista (grifo + zonas), derivada en
   *  el replay para que TODO consumidor del mundo (geografía humana, hojas)
   *  la lea del propio mundo sin canales aparte. */
  sitesPolicy: SitesPolicy;
  /** True when any edit touched elevation, so callers know the coastline moved. */
  terrainChanged: boolean;
  markers: PaintedMarker[];
  labels: PaintedLabel[];
  /** Rivers drawn by hand, in the same shape the renderer already expects. */
  rivers: { cells: Uint32Array; flow: number }[];
  /** Generated-object key → the name the reader gave it. */
  renames: Record<string, string>;
  /** Reader-set populations, by the same key as `renames`. */
  populations: Record<string, number>;
  /** Keys of generated objects the reader deleted. */
  removed: Set<string>;
  /** Generated-object key → its reader-chosen world-cell coordinates. */
  moves: Record<string, Pt>;
  /** Generated-object key → sparse presentation overrides. */
  styles: Record<string, import('./spatialEntities').WorldSpatialStyleOverride>;
  /** Roads drawn by hand. */
  roads: { cells: number[]; major: boolean }[];
  /** Circles inside which generated roads are erased. */
  roadErasers: { x: number; y: number; radius: number }[];
  /**
   * Realm ownership the reader painted, or null if they never has.
   *
   * `-2` is UNTOUCHED, `-1` is explicitly unclaimed, `>= 0` is a realm index.
   * Untouched needs its own value because "nobody owns this" is a thing a reader
   * can legitimately paint, and it must not read the same as "I never said".
   * Allocated lazily: two bytes a cell is 4 MB on a 2048 world, and most worlds
   * never carry one.
   */
  realmCells: Int16Array | null;
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
export function filterFor(
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
    renames: {}, populations: {}, removed: new Set(), moves: {}, styles: {},
    roads: [], roadErasers: [], realmCells: null,
    sitesPolicy: sitesPolicyFrom(edits),
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
    } else if (e.kind === 'populate') {
      out.populations[e.key] = Math.max(0, Math.round(e.population));
    } else if (e.kind === 'remove') {
      out.removed.add(e.key);
    } else if (e.kind === 'restore') {
      for (const key of compatibleEditKeys(e.target, e.key)) out.removed.delete(key);
    } else if (e.kind === 'move') {
      /**
       * COLLAPSE CHAINS. A second drag of the same object arrives keyed by
       * where the object was DRAWN — its first destination — because that is
       * the position the patched list hands the view. Storing it verbatim
       * builds `{origin→d1, d1→d2}`: the patch (which moves base objects, all
       * of them at their origins) stops at d1, and only a view with its own
       * second correction ever showed d2 — the carta, the globe and the atlas
       * silently disagreed with the 2D from the second drag on. So if this
       * key IS some entry's current destination, redirect: the ORIGIN key is
       * the object's one stable name, and one entry per object is the whole
       * invariant. Replays collapse saved chains the same way, so a world
       * that already has one heals on open. (Edge accepted: an object born on
       * the exact cell another was dropped on inherits its key; a cell is
       * ~19 km of ground, and the drop would have landed on the same spot.)
       */
      let key = e.key;
      const wanted = new Set(compatibleEditKeys(e.target, e.key));
      for (const k0 of Object.keys(out.moves)) {
        const t0 = k0.slice(0, k0.indexOf(':'));
        const p = out.moves[k0];
        if (wanted.has(`${t0}:${Math.round(p.x)},${Math.round(p.y)}`)) { key = k0; break; }
      }
      out.moves[key] = { x: e.x, y: e.y };
    } else if (e.kind === 'style') {
      out.styles[e.key] = { ...out.styles[e.key], ...e.style };
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
    } else if (e.kind === 'realm' || e.kind === 'realmFill' || e.kind === 'realmArea') {
      // In LIST ORDER with each other, like the biome overlay: paint a province,
      // hand a corner of it back, paint over it again. Ordering is the only thing
      // that makes these strokes rather than commands.
      if (!out.realmCells) { out.realmCells = new Int16Array(N); out.realmCells.fill(-2); }
      const cells = out.realmCells;
      const own = Math.max(-1, Math.min(32767, Math.round(e.realm)));
      if (e.kind === 'realm') {
        const m = strokeMask(e.stroke, W, H);
        m?.each((i, c) => {
          // COVERAGE decides, and the dither keeps the rim from reading as a
          // stamp — the same dither the biome brush uses a few sections up. What
          // is deliberately NOT in the test is `strength`, and that is where the
          // frontier brush parts company with the biome one.
          //
          // "How strongly do you own this" is not a question a categorical field
          // can answer: ground belongs to one country or to none. Multiplying
          // coverage by strength did not paint a fainter border, it painted less
          // of one — and since the threshold starts at 0.35, ANY strength at or
          // below 0.35 painted nothing at all, at any coverage, while the slider
          // this tool shows starts at 0.05. From 0.35 to about 0.53 it put down
          // scattered specks. A slider that silently switches the tool off is
          // worse than a slider that does nothing.
          const hsh = Math.sin(i * 45.164 + 11.71) * 27183.13;
          const jitter = (hsh - Math.floor(hsh)) * 0.45;
          if (c <= 0.35 + jitter * 0.4) return;
          cells[i] = own;
        });
      } else if (e.kind === 'realmFill') {
        for (const i of realmFloodCells(world, e)) cells[i] = own;
      } else {
        for (const i of polygonCells(e.pts, e.smooth, W, H)) cells[i] = own;
      }
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

/**
 * Flood fill from a point, stopped by the ground.
 *
 * Four-connected over LAND only — the sea is always an edge, because a realm
 * that leaks across an ocean is never what anyone meant. `river` also stops at
 * any cell carrying real discharge, and `ridge` at any cell steep enough to be
 * a watershed; both are the features a reader is pointing at when they say "up
 * to the river" or "the other side of the mountains".
 *
 * Bounded by `maxCells` so a mis-aimed click on a continent is a mistake you
 * undo, not a wait you sit through — and BREADTH-first so that what the bound
 * cuts off is the far edge of the fill and not the middle of it.
 */
export function realmFloodCells(
  world: WorldData,
  e: { x: number; y: number; bounded: 'coast' | 'river' | 'ridge'; maxCells?: number },
): number[] {
  const W = world.width, H = world.height;
  const { elevation, flow } = world;
  const cap = Math.max(1, Math.min(W * H, e.maxCells ?? Math.round(W * H * 0.25)));
  // FLOOR, like everything else that turns a world coordinate into a cell: cell
  // k is the ground from k to k+1, its centre is at k+0.5, the hover readout
  // floors `mp.u * W` and `polygonCells` scanlines against those same centres.
  // Rounding made the bucket the one tool that disagreed with the grid it was
  // painting on — a click at x = 5.5, the middle of cell 5 as drawn, started the
  // flood in cell 6. At local zoom, where one cell is hundreds of pixels wide,
  // that is the right-hand or lower half of EVERY click; on a coastal cell the
  // neighbour it jumped to is the sea, the guard below fires, and the click did
  // nothing at all while the readout under the cursor promised "gives A to B".
  const sx = ((Math.floor(e.x) % W) + W) % W;
  const sy = Math.min(H - 1, Math.max(0, Math.floor(e.y)));
  const start = sy * W + sx;
  if (elevation[start] <= 0) return [];

  // A ridge is measured the way the eye reads steepness: the fall across one
  // cell, from central differences, in kilometres of elevation units.
  const steep = (i: number): number => {
    const x = i % W, y = (i / W) | 0;
    const l = elevation[y * W + ((x - 1 + W) % W)];
    const r = elevation[y * W + ((x + 1) % W)];
    const u = elevation[Math.max(0, y - 1) * W + x];
    const d = elevation[Math.min(H - 1, y + 1) * W + x];
    return Math.max(Math.abs(r - l), Math.abs(d - u)) * 0.5;
  };
  const blocked = (i: number): boolean => {
    if (elevation[i] <= 0) return true;
    if (e.bounded === 'river' && flow[i] > 0.45) return true;
    if (e.bounded === 'ridge' && steep(i) > 0.28) return true;
    return false;
  };

  // A QUEUE, not a stack: the cap has to cut the fill off at its far edge, not
  // in the middle of it. Popping depth-first meant a capped fill was whatever
  // tendril the last neighbour pushed happened to lead down. Measured at
  // 512×256, capped at 1 200 cells on a 7 818-cell continent, the stack ran 92
  // cells away from the click and left 75 % of the land within a 41-cell disc
  // AROUND the click unclaimed: the reader points at a peninsula and gets a
  // ragged snake with holes right next to the cursor. The queue reaches exactly
  // 41 cells and leaves 36 % of that disc — which is all a 1 200-cell budget can
  // pay for out of 1 881 cells of land. Whatever the cap, the cells come out in
  // rings of growing distance, so the worst it can do is stop short: the compact
  // neighbourhood of the click, which is recognisably the thing pointed at.
  //
  // The head index is not a micro-optimisation. `Array.shift()` is O(n) per pop,
  // which would make a 20 000-cell bucket quadratic — precisely the wait the cap
  // exists to prevent.
  const seen = new Uint8Array(W * H);
  const out: number[] = [];
  const queue = [start];
  let head = 0;
  seen[start] = 1;
  while (head < queue.length && out.length < cap) {
    const i = queue[head++];
    out.push(i);
    const x = i % W, y = (i / W) | 0;
    const around = [
      y * W + ((x + 1) % W),
      y * W + ((x - 1 + W) % W),
      y > 0 ? (y - 1) * W + x : -1,
      y < H - 1 ? (y + 1) * W + x : -1,
    ];
    for (const n of around) {
      if (n < 0 || seen[n]) continue;
      seen[n] = 1;
      if (blocked(n)) continue;
      queue.push(n);
    }
  }
  return out;
}

/**
 * Every cell inside a closed polygon, by scanline.
 *
 * `smooth` runs the ring through Chaikin first, which is the whole difference
 * between the straight-edged lasso and the curved one — the same corner-cutting
 * the coastlines use, so a hand-drawn frontier sits in the same visual language
 * as the generated ones.
 *
 * The ring is un-wrapped as it is read, so a province drawn across the
 * antimeridian is one shape rather than two touching the opposite edges.
 *
 * A cell is in when its CENTRE is in — cell k is the ground from k to k+1 and
 * its centre sits at k+0.5, which is why the scanline samples at y+0.5 and why
 * a crossing pair becomes `ceil(x0 − 0.5) … floor(x1 − 0.5)`. Same convention as
 * flooring a world coordinate to a cell, which is what `realmFloodCells` and the
 * hover readout do: the lasso and the bucket have to agree about which cell the
 * pointer is in, or the two tools disagree about where a frontier was drawn.
 */
export function polygonCells(pts: Pt[], smooth: boolean, W: number, H: number): number[] {
  if (pts.length < 3) return [];
  const ring: Pt[] = [];
  let prev = pts[0].x;
  for (const p of pts) {
    let x = p.x;
    while (x - prev > W / 2) x -= W;
    while (x - prev < -W / 2) x += W;
    prev = x;
    ring.push({ x, y: p.y });
  }
  const shape = smooth ? chaikinRing(ring, 2) : ring;

  let y0 = Infinity, y1 = -Infinity;
  for (const p of shape) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  y0 = Math.max(0, Math.floor(y0));
  y1 = Math.min(H - 1, Math.ceil(y1));
  const out: number[] = [];
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let k = 0; k < shape.length; k++) {
      const a = shape[k], b = shape[(k + 1) % shape.length];
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
        xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.ceil(xs[k] - 0.5), to = Math.floor(xs[k + 1] - 0.5);
      for (let gx = from; gx <= to; gx++) out.push(y * W + (((gx % W) + W) % W));
    }
  }
  return out;
}

/** Corner cutting on a CLOSED ring — the open-path version lives in
 *  `cartography/contours.ts` and would leave the last corner square. */
function chaikinRing(pts: Pt[], iterations: number): Pt[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const next: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i], b = cur[(i + 1) % cur.length];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    cur = next;
  }
  return cur;
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

/** Compact JSON for storage alongside the seed and parameters.
 *
 *  Coordinates are rounded to 1/256 of a world cell (~76 m). It used to be a
 *  quarter cell — "sub-cell precision is noise" was true when the world grid
 *  was the only canvas — but the canonical tiles rasterise the same list at
 *  ~150 m per cell, where a quarter-cell round-off is five kilometres of slop.
 *  Legacy points already sit on the quarter grid, so the finer rounding is the
 *  identity on every stroke saved before this change.
 *
 *  The lasso's corners go through the same round, and for the same reason every
 *  other kind does: a corner that came off a pointer carries seventeen
 *  significant digits, and a hand-drawn province is easily forty of them —
 *  ~1.5 kB of JSON per shape, kept forever, for precision nothing can see.
 *  Safe because the polygon is filled by testing cell CENTRES: a corner would
 *  have to land within 1/512 of a cell of a crossing exactly on a centre to move
 *  one cell of the border, and that cell is by definition on the edge the reader
 *  drew freehand to ±half a cell. */
/**
 * La política de sembrado regional que una lista de ediciones dicta.
 *
 * Derivada y no almacenada: el estado del grifo es «lo que diga el ÚLTIMO
 * `placesEverywhere` de la lista» (así Ctrl+Z lo revierte como a cualquier
 * otra edición), y las zonas se evalúan en orden de lista — la última
 * pincelada que pisa un punto decide, que es la semántica de pintar encima.
 * Sin ediciones de lugares: todo cerrado, que es el defecto que pidió Luis
 * (2026-08-12) para mundos nuevos Y viejos.
 */
export interface SitesPolicy {
  everywhere: boolean;
  zones: { mode: 'add' | 'remove'; pts: Pt[]; radius: number }[];
}

/**
 * ¿Permite la política sembrar en ESTA celda del mundo? La misma pregunta para
 * el enrejado regional (region/places) y para la geografía humana del mundo
 * (core/settlements): grifo global de base, y la última zona pisada decide.
 * `worldWidth` para la envoltura en x — una pincelada que cruza el
 * antimeridiano es una polilínea continua.
 */
export function zoneAllowsWorld(
  policy: SitesPolicy, wx: number, wy: number, worldWidth: number,
): boolean {
  let ok = policy.everywhere;
  for (const z of policy.zones) {
    if (!z.pts.length) continue;
    const r2 = z.radius * z.radius;
    const wrapNear = (x: number, ref: number): number => {
      let v = x;
      while (v - ref > worldWidth / 2) v -= worldWidth;
      while (v - ref < -worldWidth / 2) v += worldWidth;
      return v;
    };
    let prevX = wrapNear(z.pts[0].x, wx);
    let prevY = z.pts[0].y;
    let dentro = z.pts.length === 1
      && (wx - prevX) * (wx - prevX) + (wy - prevY) * (wy - prevY) <= r2;
    for (let k = 1; k < z.pts.length && !dentro; k++) {
      const x = wrapNear(z.pts[k].x, prevX);
      const y = z.pts[k].y;
      const dx = x - prevX, dy = y - prevY;
      const len2 = dx * dx + dy * dy;
      const u = len2 > 0 ? Math.max(0, Math.min(1, ((wx - prevX) * dx + (wy - prevY) * dy) / len2)) : 0;
      const qx = prevX + u * dx, qy = prevY + u * dy;
      if ((wx - qx) * (wx - qx) + (wy - qy) * (wy - qy) <= r2) dentro = true;
      prevX = x; prevY = y;
    }
    if (dentro) ok = z.mode === 'add';
  }
  return ok;
}

export function sitesPolicyFrom(edits: readonly WorldEdit[] | undefined): SitesPolicy {
  // SIN EDICIÓN DE LUGARES, EL GRIFO ESTÁ ABIERTO. La primera versión hacía
  // lo contrario (ausencia = cerrado) y con ello VACIÓ todos los mundos que
  // Luis ya tenía: sus ciudades y caminos existían porque el mundo se generó
  // cuando no había política, y una lista de ediciones antigua no lleva
  // ninguna edición de lugares (Luis, 2026-08-13: «había mapas con ciudades
  // y caminos ya. Los has borrado. Una cosa es lo que te pedí para NUEVOS
  // mundos… pero no te pedí que borrases lo existente»). La ausencia
  // significa LEGADO, no negativa: el mundo conserva exactamente el país con
  // el que nació. El «desnudo por defecto» de los mundos nuevos lo pone el
  // FLUJO DE CREACIÓN escribiendo `placesEverywhere:false` como primera
  // edición — explícito, visible en el tick, y reversible con Ctrl+Z.
  const policy: SitesPolicy = { everywhere: true, zones: [] };
  if (!edits) return policy;
  for (const e of edits) {
    if (e.kind === 'placesEverywhere') policy.everywhere = e.enabled;
    else if (e.kind === 'placesZone' && e.pts.length) {
      policy.zones.push({ mode: e.mode, pts: e.pts, radius: e.radius });
    }
  }
  return policy;
}

export function serializeEdits(edits: WorldEdit[]): string {
  const round = (p: Pt) => ({ x: Math.round(p.x * 256) / 256, y: Math.round(p.y * 256) / 256 });
  return JSON.stringify({
    v: 2,
    edits: edits.map((e) => {
      if ('stroke' in e) return { ...e, stroke: { ...e.stroke, pts: e.stroke.pts.map(round) } };
      if (e.kind === 'river' || e.kind === 'realmArea' || e.kind === 'placesZone') {
        return { ...e, pts: e.pts.map(round) };
      }
      return e;
    }),
  });
}

/**
 * A bare array is the v1 format, and v1 stroke points speak the OLD stamp
 * convention: `stampDisc` measured cells by their index, so a stroke's painted
 * ground sat half a cell south-east of its points. The formula now measures
 * cell CENTRES; shifting v1 points by that same half cell reproduces the old
 * masks bit for bit, so a saved world's ground does not move by a single cell.
 * Only kinds carrying a `stroke` migrate: `river`/`realmArea`/`road` points
 * are curve geometry, not stamp centres — a v1 river's carved channel settles
 * half a cell north-west, which ALIGNS it with its own ink (the channel was
 * the one consumer of the stroke mask that had no compensating ring).
 */
export function deserializeEdits(json: string): WorldEdit[] {
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) {
      // One malformed element must cost one element, not the reader's whole
      // edit history — hence the object filter before the migration touches
      // anything.
      return (v as WorldEdit[])
        .filter((e): e is WorldEdit => !!e && typeof e === 'object')
        .map((e) => ('stroke' in e
          ? {
            ...e,
            stroke: { ...e.stroke, pts: e.stroke.pts.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })) },
          }
          : e));
    }
    if (v && typeof v === 'object' && Array.isArray((v as { edits?: unknown }).edits)) {
      return (v as { edits: WorldEdit[] }).edits;
    }
    return [];
  } catch {
    return [];
  }
}
