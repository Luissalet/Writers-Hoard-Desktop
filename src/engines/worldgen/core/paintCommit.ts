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
import type { BiomeId, RuinKind, WorldData } from './types';

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
  | 'capital' | 'city' | 'town' | 'village' | 'ruin' | 'label' | 'waypoint';

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
function restriction(f: PaintFilter | undefined): PaintFilter | undefined {
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
    case 'river':
      if (ctx.negative) {
        return { kind: 'eraseRivers', x: at.x, y: at.y, radius: Math.max(3, p.riverWidth * 3) };
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
        return { kind: 'eraseMarkers', x: at.x, y: at.y, radius: Math.max(3, p.radius * 0.5) };
      }
      if (p.point === 'label') {
        const text = p.labelText.trim();
        return text ? { kind: 'label', x: at.x, y: at.y, text, style: p.labelStyle } : null;
      }
      if (p.point === 'ruin') {
        return { kind: 'marker', marker: 'ruin', x: at.x, y: at.y, ruin: p.ruin };
      }
      // 'waypoint' never reaches here: the view places it in its own table.
      const rank = RANK_OF[p.point];
      return rank ? { kind: 'marker', marker: 'settlement', x: at.x, y: at.y, rank } : null;
    }
    case 'road':
      // A road is two clicks and an A* between them; the view owns that gesture
      // and hands the routed cells here as points.
      if (ctx.negative) {
        return { kind: 'eraseRoads', x: pts[0].x, y: pts[0].y, radius: Math.max(2, p.radius) };
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
 */
export function pickGeneratedAt(
  world: WorldData,
  geo: HumanGeography | null | undefined,
  wx: number,
  wy: number,
  tolerance: number,
): { target: EditTarget; key: string; name: string } | null {
  if (!geo) return null;
  const tol = Math.max(2, tolerance);
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
    offer('feature', editKey('feature', f.x, f.y, `${f.kind}:`), f.name,
      dist(f.x, f.y), Math.max(tol, f.extent));
  }
  if (best) return best;

  const ix = (((Math.round(wx) % world.width) + world.width) % world.width);
  const iy = Math.min(world.height - 1, Math.max(0, Math.round(wy)));
  const realmId = geo.realmOf[iy * world.width + ix];
  const realm = geo.realms.find((q) => q.id === realmId);
  if (realm) return { target: 'realm', key: editKey('realm', 0, 0, `${realm.id}:`), name: realm.name };
  return null;
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
