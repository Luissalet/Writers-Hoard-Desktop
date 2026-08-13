// ============================================
// Turning a gesture into an edit
// ============================================
// One brush, three views. The carta, the satellite map and the 3D world all
// have to produce the SAME edit for the same stroke, or the reader discovers
// that a river drawn in one place is not the river they get back — and the
// storage contract (seed + params + edit list) means a divergence here is not a
// display bug, it is a corrupted world.
//
// So the translation from "a list of world cells the pointer passed through"
// to "a WorldEdit" lives here, once, and every view calls it. The views keep
// only what is genuinely theirs: how a screen point becomes a world cell.

import {
  editKey, type BrushTip, type EditTarget, type Falloff, type LandOp, type PaintFilter,
  type Pt, type Stroke, type TerrainOp, type WorldEdit,
} from './edits';
import type { HumanGeography, SettlementRank } from './settlements';
import type { BiomeId, LandmarkType, RuinKind, WorldData } from './types';

/**
 * Everything the commit needs to know about the brush.
 *
 * Structural, not the UI's `PaintTool` type: `core` may not import from
 * `components`, and the brush box is free to carry fields — a colour swatch, a
 * preview — that have nothing to do with what gets stored.
 */
export interface PaintSpec {
  mode: string;
  terrainOp: TerrainOp;
  landOp: LandOp;
  biome: BiomeId;
  radius: number;
  strength: number;
  softness: number;
  /** The shape of the edge: how the paint fades from the middle out. */
  curve: Falloff;
  /** The shape of the head itself. */
  tip: BrushTip;
  /** Degrees. Squares use it; ridges take theirs from the drag. */
  angle: number;
  jitter: number;
  aspect: number;
  taper: number;
  /** Where the stroke is allowed to land. Only the biome brush obeys it. */
  only: PaintFilter;
  riverWidth: number;
  marker: 'settlement' | 'ruin';
  ruin: RuinKind;
  rank: SettlementRank;
  labelStyle: 'region' | 'water' | 'range' | 'settlement' | 'note';
  labelText: string;
  roadMajor: boolean;
  /** What the point tool puts down. */
  point: PointKind;
}

/**
 * The things that are objects rather than paint.
 *
 * A town, a ruin, a name on the map and a pin of the reader's own are all the
 * same gesture — put one here, then edit or delete it — and they were four
 * separate brush modes with four separate erasers. They are one tool with a
 * type, and `waypoint` is handled by the view rather than by an edit because it
 * is the reader's own annotation and lives in its own table.
 */
export type PointKind =
  | 'capital' | 'city' | 'town' | 'village' | 'ruin'
  | LandmarkType
  | 'label' | 'waypoint';

const LANDMARK_POINTS = new Set<PointKind>([
  'volcano', 'cave', 'waterfall', 'gorge', 'hotspring',
]);

const RANK_OF: Partial<Record<PointKind, SettlementRank>> = {
  capital: 'capital', city: 'city', town: 'town', village: 'village',
};

export interface CommitContext {
  /**
   * The stroke is the NEGATIVE of the tool: Ctrl, everywhere, for everything.
   *
   * There used to be a separate eraser mode, an Alt on the road tool and no way
   * at all to take back a biome or a river. One rule beats four exceptions: what
   * "the opposite" means is the tool's business, not the reader's.
   */
  negative?: boolean;
  /** What generated object is under a point, for the negative of the point tool. */
  pickGenerated?: (x: number, y: number) => { target: EditTarget; key: string; name: string } | null;
  /**
   * SIXTEEN SCREEN PIXELS, expressed in world cells — the same number the view
   * already works out for `pickGenerated`'s tolerance, and for the same reason:
   * "close enough to what I clicked" is a distance on the glass, not on the
   * grid, and only the view knows the exchange rate.
   *
   * Optional because a view without a camera (the sculptor) has no exchange
   * rate to give; see `NEGATIVE_REACH_CELLS` for what happens then.
   */
  reachCells?: number;
}

/**
 * The same tool, the other way round.
 *
 * Terrain and coast resolve their negative when the button goes DOWN, not when
 * it comes up, because the 3D view previews the stroke live and the preview has
 * to be the thing that gets committed. Views that have no preview call this at
 * commit time instead. One definition either way.
 */
export function negativeOf(p: PaintSpec): PaintSpec {
  const INVERSE: Record<string, TerrainOp> = {
    raise: 'lower', lower: 'raise', smooth: 'sharpen', sharpen: 'smooth',
    roughen: 'smooth', gully: 'smooth',
  };
  return {
    ...p,
    terrainOp: INVERSE[p.terrainOp] ?? p.terrainOp,
    landOp: p.landOp === 'land' ? 'sea' : 'land',
  };
}

/**
 * The head, as the stored stroke should carry it — which is: only what differs
 * from the disc.
 *
 * This is not tidiness. A saved world is its edit list, and every field written
 * here is a field that has to be read back the same way for as long as the world
 * exists. A reader who never opened the head panel must produce exactly the
 * stroke the previous version produced, byte for byte, so that upgrading the
 * program cannot change a map that was already finished.
 */
function head(p: PaintSpec): Partial<Stroke> {
  const h: Partial<Stroke> = {};
  if (p.curve && p.curve !== 'smooth') h.curve = p.curve;
  if (p.tip && p.tip !== 'round') {
    h.tip = p.tip;
    // Only the fields the head in question actually reads. A square does not
    // have an aspect ratio and a ridge does not have a jitter.
    if ((p.tip === 'square' || p.tip === 'ridge') && p.angle) h.angle = p.angle;
    if (p.tip === 'ragged') h.jitter = p.jitter;
    if (p.tip === 'ridge') h.aspect = p.aspect;
  }
  if (p.taper > 0.001) h.taper = p.taper;
  return h;
}

/** The filter, or nothing at all if it does not actually rule anything out. */
export function restriction(f: PaintFilter | undefined): PaintFilter | undefined {
  if (!f) return undefined;
  const only: PaintFilter = {};
  if (f.where) only.where = f.where;
  if (f.minElev !== undefined) only.minElev = f.minElev;
  if (f.maxElev !== undefined) only.maxElev = f.maxElev;
  if (f.minSlope !== undefined) only.minSlope = f.minSlope;
  if (f.maxSlope !== undefined) only.maxSlope = f.maxSlope;
  return Object.keys(only).length ? only : undefined;
}

/**
 * The CAP on how far a Punto or Camino erase reaches, in world cells.
 *
 * Deliberately not `p.radius`. The size slider is only rendered for the area
 * brushes (terrain / costa / bioma), so in Punto and Camino mode the brush
 * radius is a number the reader can neither see nor change — and it defaults to
 * 9 cells. Ctrl+click with Camino therefore swept every road within nine cells,
 * which on a 1024-wide world is ~350 km: the reader aimed at one road and lost
 * the whole province's network, with no control anywhere on screen to explain it
 * or turn it down.
 *
 * Two cells is ~78 km on that world — one cell of slack either side of the one
 * the pointer landed on — and it is a CEILING, not a floor. At planetary zoom a
 * cell is under a pixel, so sixteen pixels of aim error is a dozen cells and
 * ~470 km of swept road: something has to hold the reach down, and two cells is
 * still inside the spacing the generator leaves between towns, so the neighbour
 * survives. At every other zoom the screen is the better judge — and as a FLOOR
 * this number was the whole reach at every zoom, which is how the reader flies
 * down to a hamlet, where the screen shows 600 m of ground, Ctrl+clicks to take
 * back a label they just placed, and deletes a generated town sixty kilometres
 * off the edge of the screen instead.
 */
const NEGATIVE_REACH_CELLS = 2;

/**
 * And the floor, which is the storage grid rather than a taste.
 *
 * `serializeEdits` rounds every stored point to 1/256 of a cell, so a mark can
 * sit that far from where the reader put it once the world has been saved and
 * reopened. A reach below that could miss a label the pointer is dead on.
 */
const REACH_FLOOR_CELLS = 1 / 256;

/** The erase reach for this gesture: what the view measured, clamped. */
function negativeReach(ctx: CommitContext): number {
  const r = ctx.reachCells;
  if (typeof r !== 'number' || !Number.isFinite(r)) return NEGATIVE_REACH_CELLS;
  return Math.min(NEGATIVE_REACH_CELLS, Math.max(REACH_FLOOR_CELLS, r));
}

/**
 * Why this gesture is about to do nothing, as a locale key — or null.
 *
 * A commit that returns null is dropped silently by every caller, which is
 * exactly right for "the pointer did not move far enough to be a stroke" and
 * exactly wrong for Rótulo with an empty text box: the reader picks Punto, picks
 * Rótulo, clicks where the name should go, and the map swallows the click. And
 * the next one, and every one after it, with nothing on screen to say why.
 *
 * The refusal lives here because the RULE is the commit's — an empty label is
 * not an edit — while saying so is the view's, and a locale key is the whole of
 * what has to cross between them.
 */
export function commitRefusal(p: PaintSpec, ctx: CommitContext = {}): string | null {
  if (ctx.negative) return null;
  if (p.mode === 'point' && p.point === 'label' && !p.labelText.trim()) {
    return 'worldgen.paint.labelNeedsText';
  }
  return null;
}

/**
 * The whole gesture as one edit (or none).
 *
 * Returns the edit rather than calling a callback so the caller decides whether
 * it is one undo step or part of a group — a mirrored sculpt stroke is four
 * edits and one Ctrl+Z.
 */
export function commitPaintStroke(
  p: PaintSpec,
  pts: Pt[],
  ctx: CommitContext = {},
): WorldEdit | null {
  if (!pts.length) return null;
  const stroke: Stroke = {
    pts, radius: p.radius, strength: p.strength, softness: p.softness, ...head(p),
  };
  const at = pts[pts.length - 1];

  switch (p.mode) {
    case 'terrain':
      return { kind: 'terrain', op: p.terrainOp, stroke };
    case 'land':
      return { kind: 'land', op: p.landOp, stroke };
    case 'biome': {
      if (ctx.negative) return { kind: 'eraseBiome', stroke };
      // The eraser deliberately does NOT inherit the filter: taking paint off
      // must always be able to reach whatever the brush put on, or a rule you
      // have since changed would leave cells you cannot get at.
      const only = restriction(p.only);
      return only
        ? { kind: 'biome', biome: p.biome, stroke, only }
        : { kind: 'biome', biome: p.biome, stroke };
    }
    case 'places':
      // El pincel de LUGARES escribe permiso, no píxeles: la pincelada entera
      // es UNA edición (`placesZone`) con los puntos y el radio del pincel, y
      // el sembrado regional la consulta al fraguar el canon. Ctrl (el
      // negativo universal) vacía la zona en vez de sembrarla — también con el
      // grifo global abierto.
      return {
        kind: 'placesZone',
        mode: ctx.negative ? 'remove' : 'add',
        pts,
        radius: Math.max(0.5, p.radius),
      };
    case 'river':
      if (ctx.negative) {
        // Alcance de PUNTERÍA, no de anchura: `riverWidth · 3` con el ancho en
        // celdas barría un disco de ~235 km con el mando por defecto (12
        // celdas a 19,6 km/celda en un mundo de 2048) y se llevaba todos los
        // ríos de una comarca por un clic. El borrador alcanza lo que el error
        // de puntería justifica (16 px en celdas, con el mismo techo que el de
        // marcadores) más media anchura del río al que se apunta — que es lo
        // que mide estar «encima» de un cauce gordo.
        return { kind: 'eraseRivers', x: at.x, y: at.y, radius: negativeReach(ctx) + p.riverWidth / 2 };
      }
      return pts.length >= 2 ? { kind: 'river', pts, width: p.riverWidth } : null;
    case 'point': {
      if (ctx.negative) {
        // Deleting a point means deleting whatever is there, and what is there
        // may be the reader's or may be the generator's. Painted marks and
        // labels come off with the eraser; a generated town or sea needs the
        // position-keyed `remove` that survives a regeneration.
        const target = ctx.pickGenerated?.(at.x, at.y);
        if (target) return { kind: 'remove', target: target.target, key: target.key };
        return { kind: 'eraseMarkers', x: at.x, y: at.y, radius: negativeReach(ctx) };
      }
      if (p.point === 'label') {
        const text = p.labelText.trim();
        // No text, no label — and `commitRefusal` above is how the view tells
        // the reader that, because a click that vanishes is indistinguishable
        // from a broken map.
        return text ? { kind: 'label', x: at.x, y: at.y, text, style: p.labelStyle } : null;
      }
      if (p.point === 'ruin') {
        return { kind: 'marker', marker: 'ruin', x: at.x, y: at.y, ruin: p.ruin };
      }
      if (LANDMARK_POINTS.has(p.point)) {
        return {
          kind: 'marker',
          marker: 'landmark',
          x: at.x,
          y: at.y,
          landmark: p.point as LandmarkType,
        };
      }
      // 'waypoint' never reaches here: the view places it in its own table.
      const rank = RANK_OF[p.point];
      return rank ? { kind: 'marker', marker: 'settlement', x: at.x, y: at.y, rank } : null;
    }
    case 'road':
      // A road is two clicks and an A* between them; the view owns that gesture
      // and hands the routed cells here as points.
      if (ctx.negative) {
        return { kind: 'eraseRoads', x: pts[0].x, y: pts[0].y, radius: negativeReach(ctx) };
      }
      return pts.length >= 2 ? { kind: 'road', pts, major: p.roadMajor } : null;
    default:
      return null;
  }
}

/**
 * What generated object is at a world point, and its stable key.
 *
 * Ordered smallest-target-first: a settlement sits inside a realm and often
 * inside a named plain as well, and the reader who clicked on a dot meant the
 * dot. Areas are only offered when nothing pointlike is close.
 *
 * `tolerance` is in world cells and is the caller's job, because "close enough"
 * means sixteen screen pixels and only the view knows how many cells that is.
 * It is taken AS GIVEN — the two-cell floor that used to sit here made this the
 * other half of the delete-at-high-zoom failure `NEGATIVE_REACH_CELLS`
 * describes: at a zoom where sixteen pixels is a fiftieth of a cell, a floor of
 * two cells is a reach of seventy-eight kilometres, so a Ctrl+click aimed at a
 * label the reader had just placed found a generated town far off the screen
 * and deleted that instead. The only floor left is the storage grid, so a mark
 * that has been saved and reloaded is still reachable where it is drawn.
 */
export function pickGeneratedAt(
  world: WorldData,
  geo: HumanGeography | null | undefined,
  wx: number,
  wy: number,
  tolerance: number,
): { target: EditTarget; key: string; name: string } | null {
  if (!geo) return null;
  const tol = Number.isFinite(tolerance)
    ? Math.max(REACH_FLOOR_CELLS, tolerance)
    : NEGATIVE_REACH_CELLS;
  const dist = (ax: number, ay: number): number => {
    let dx = Math.abs(ax - wx);
    if (dx > world.width / 2) dx = world.width - dx;
    return Math.hypot(dx, ay - wy);
  };

  let best: { target: EditTarget; key: string; name: string; d: number } | null = null;
  const offer = (target: EditTarget, key: string, name: string, d: number, reach: number): void => {
    if (d > reach) return;
    if (!best || d < best.d) best = { target, key, name, d };
  };

  for (const st of geo.settlements) {
    offer('settlement', editKey('settlement', st.x, st.y), st.name, dist(st.x, st.y), tol);
  }
  for (const ru of geo.ruins) {
    offer('ruin', editKey('ruin', ru.x, ru.y), ru.name, dist(ru.x, ru.y), tol);
  }
  if (best) return best;
  for (const f of geo.features) {
    // Con `tol`, NO con `f.extent`: extent es el TAMAÑO del accidente (celdas
    // de la región, o del cauce en un río), no un radio de puntería. Usarlo de
    // alcance hacía que un Ctrl+clic en suelo vacío devolviera el continente a
    // 32 celdas del clic — y como este picker responde antes que el borrador de
    // marcadores, `eraseMarkers` era inalcanzable: nunca se podía borrar una
    // marca propia sin llevarse un accidente generado. El lector que borra
    // apunta al RÓTULO, y el rótulo se dibuja en el ancla — que es exactamente
    // lo que `tol` (16 px en celdas) sabe medir a cualquier zoom.
    offer('feature', editKey('feature', f.x, f.y, `${f.kind}:`), f.name,
      dist(f.x, f.y), tol);
  }
  // And nothing after this. The REALM under the pointer used to be offered here
  // as a last resort, which meant that a Ctrl+click on empty ground — where
  // there is always a country, that being what a country is — produced
  // `{kind:'remove', target:'realm'}`: an undo step, a number on the badge and a
  // line in the saved edit list for an edit that no consumer honours. Only realm
  // RENAMES are read back.
  //
  // Honouring it instead would be worse. The realms are grown from the capitals
  // every time the world is opened, so a deleted country would be back on the
  // next rebuild; and "delete this country" is not a gesture anyone makes — what
  // the reader means is that its ground belongs to someone else or to nobody,
  // which is the frontier brush, with Ctrl, which they already have.
  return best;
}

/**
 * Is this gesture a pin?
 *
 * The pin is the one point that is not part of the world. A town, a ruin and a
 * name on the map are all the reader's edits to a place that will be
 * regenerated from the seed; a pin is a note the reader stuck to the glass, with
 * a colour and a description, and it lives in its own table so that a deep link
 * to it keeps working and so that regenerating the world does not touch it.
 *
 * It is still the same TOOL — Luis asked for that: "los rótulos, waypoints, etc.
 * deberían ser variantes de tipo de punto". So the gesture is shared and only
 * the destination differs, and the view is the only thing that can know that,
 * because the edit list is exactly what a pin must stay out of.
 */
export function isWaypointTool(p: { mode: string; point: PointKind }): boolean {
  return p.mode === 'point' && p.point === 'waypoint';
}

/**
 * Does this brush move ground?
 *
 * The distinction matters to every 3D view: a terrain or coast stroke is
 * previewed live on the height texture and committed on release, while a biome,
 * river or marker stroke is only a list of cells until the button comes up.
 */
export function isSculptMode(mode: string): boolean {
  return mode === 'terrain' || mode === 'land';
}
