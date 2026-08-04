// ============================================
// Cartography — the camera's own square of ground
// ============================================
// One piece of arithmetic, shared by the 3D view and by the bench that checks
// it: given the window of the world a camera is looking at, WHICH tiles of the
// pyramid cover it, how big the picture made of them is, and — the part that
// matters — exactly which square of the world that picture then represents.
//
// It lives here rather than inside the view because that last number is the one
// that has to agree with the shader down to a fraction of a cell, and a number
// that has to agree with something else should be computed once, in a place a
// harness can call without mounting a renderer.
//
// THE WHOLE TRICK IS THE SNAP. The plan never covers "the window": it covers a
// whole number of whole tiles containing the window. So the picture is a plain
// mosaic — every tile drawn at its native size, on an integer pixel boundary,
// never resampled — and the square of the world it covers is a tile boundary,
// which `tileView` already defines exactly. There is no fractional origin
// anywhere in the chain, and therefore no half-texel left to get wrong.

import {
  MIN_TILE_Z, TILE_PX, tileCountX, tileCountY, wrapTileX, type TileKey,
} from './tiles';
import type { CartoView } from './render';

/** The piece of world a camera frames: centre and the two sides, in normalized
 *  world coordinates (u wraps, v runs north to south). Two sides and not one
 *  because a square in uv is a 2:1 rectangle on the ground — v covers half the
 *  world u does — and the screen is neither. */
export interface SkinWindow { u: number; v: number; uSize: number; vSize: number }

export interface ZoomSkinPlan {
  z: number;
  /** Tile block, in unwrapped indices: tx0 may be negative or past the last
   *  column when the window straddles the seam. */
  tx0: number;
  ty0: number;
  nx: number;
  ny: number;
  /** Size of the composed picture, in pixels. */
  width: number;
  height: number;
  /** The block's ground, in world cells — what `DisplayTileStore` composes to. */
  view: CartoView;
  /** The same ground in normalized world coordinates — what the shader maps
   *  the picture onto. `u` may fall outside [0,1); the shader takes the nearest
   *  wrapped branch, which is unambiguous while `uSize` stays under a half. */
  window: { u: number; v: number; uSize: number; vSize: number };
  /** Every tile of the block, wrapped, row-major. */
  keys: TileKey[];
}

export interface ZoomSkinOptions {
  /** Deepest level to ask the pyramid for. */
  maxZ: number;
  /** Longest side of the composed picture, in pixels. */
  maxPx?: number;
  /** Most tiles the block may contain. */
  maxTiles?: number;
  /** How much wider than the mesh window to cover, as a fraction of it. The
   *  margin is what lets the picture survive the camera moving without being
   *  recomposed, and what the shader's soft edge fades across. */
  margin?: number;
}

/**
 * A window wider than half the world cannot be addressed by "the nearest
 * wrapped branch" — `round()` sends the far half to the wrong side — and at
 * that framing the world-wide raster is already finer than the screen, so
 * there is nothing to win. Above this, the plan is simply no plan.
 */
export const MAX_ZOOM_SKIN_SPAN = 0.5;

/**
 * Píxeles por celda de mundo por debajo de los cuales no hay plan.
 *
 * La piel de mundo entero ya trae un píxel por celda. Un bloque que sólo dé dos
 * o tres cuesta teselas y no se distingue, y —peor— se queda ATASCADO: un
 * bloque enorme hecho a vista de planeta contiene cualquier encuadre posterior,
 * así que sin este suelo la escalera nunca baja. Ver `zoomSkinCovers`.
 */
export const MIN_PX_PER_CELL = 2.5;

/**
 * Cuánto puede el bloque pasarse de grande respecto al encuadre antes de que
 * merezca la pena rehacerlo.
 *
 * ÉSTA ES LA PRUEBA QUE FALTABA. «¿Sigue el encuadre dentro del bloque?» es
 * verdad para siempre en cuanto te acercas — un bloque de medio mundo contiene
 * cualquier cosa — así que la vista se quedaba en el primer nivel que eligió,
 * a vista de planeta, y acercarse no cambiaba nada. Medido en la máquina de
 * Luis: `suelo z4 · 9,8 km/px` con un encuadre de mil quinientos kilómetros.
 *
 * No hace falta histéresis contra esto: quien llama compara el plan nuevo con
 * el viejo y no hace nada si salen iguales.
 */
export const MAX_BLOCK_RATIO = 1.8;

export function planZoomSkin(
  world: { width: number; height: number },
  mesh: SkinWindow,
  opts: ZoomSkinOptions,
): ZoomSkinPlan | null {
  const maxPx = opts.maxPx ?? 3072;
  const maxTiles = opts.maxTiles ?? 72;
  const margin = opts.margin ?? 0.12;
  const maxZ = Math.max(MIN_TILE_Z, opts.maxZ);

  if (!(mesh.uSize > 0) || !(mesh.vSize > 0)) return null;
  if (mesh.uSize > MAX_ZOOM_SKIN_SPAN) return null;

  // What we would LIKE to cover: the framing plus a margin on every side. The
  // snap to whole tiles adds half a tile a side on average by itself, so this
  // only has to buy the camera a little room to drift before recomposing.
  const wantU = Math.min(MAX_ZOOM_SKIN_SPAN, mesh.uSize * (1 + 2 * margin));
  const wantV = Math.min(1, mesh.vSize * (1 + 2 * margin));

  // Start at the deepest level the picture budget could possibly allow and walk
  // down until a whole block fits. Cheap: it is a handful of divisions.
  let z = Math.floor(Math.log2(maxPx / TILE_PX / Math.max(1e-9, wantU)));
  z = Math.min(maxZ, Math.max(MIN_TILE_Z, z + 1));

  for (; z >= MIN_TILE_Z; z--) {
    const plan = blockAt(world, mesh, wantU, wantV, z);
    if (!plan) continue;
    if (plan.nx * plan.ny > maxTiles || Math.max(plan.width, plan.height) > maxPx) continue;
    // El más hondo que cabe. Si ni siquiera ése aporta nitidez sobre el ráster
    // de mundo, no hay plan: bajar más es ir a peor.
    if (plan.width / plan.view.w < MIN_PX_PER_CELL) return null;
    return plan;
  }
  return null;
}

/** ¿Son el mismo bloque? Rehacer el que ya está puesto no cambia un píxel. */
export function samePlan(a: ZoomSkinPlan | null, b: ZoomSkinPlan | null): boolean {
  if (!a || !b) return a === b;
  return a.z === b.z && a.tx0 === b.tx0 && a.ty0 === b.ty0
    && a.nx === b.nx && a.ny === b.ny;
}

function blockAt(
  world: { width: number; height: number },
  mesh: SkinWindow,
  wantU: number,
  wantV: number,
  z: number,
): ZoomSkinPlan | null {
  const nTilesX = tileCountX(z);
  const nTilesY = tileCountY(z);
  const cells = world.width / nTilesX;

  // The window we are covering, before snapping. v is pulled inside the world:
  // there are no tiles past the poles to ask for.
  const u0 = mesh.u - wantU / 2;
  const v0 = Math.min(1 - Math.min(1, wantV), Math.max(0, mesh.v - wantV / 2));
  const v1 = Math.min(1, v0 + wantV);

  // Snap outwards to whole tiles. Grid coordinates are in world cells, so the
  // block's edges land exactly where `tileView` puts them.
  const tx0 = Math.floor((u0 * world.width) / cells);
  const tx1 = Math.ceil(((u0 + wantU) * world.width) / cells) - 1;
  const ty0 = Math.max(0, Math.floor((v0 * world.height) / cells));
  const ty1 = Math.min(nTilesY - 1, Math.ceil((v1 * world.height) / cells) - 1);

  const nx = Math.max(1, tx1 - tx0 + 1);
  const ny = Math.max(1, ty1 - ty0 + 1);
  // A block that wraps all the way round is the whole world; the shader cannot
  // address it as a window and the world raster covers it anyway.
  if (nx >= nTilesX) return null;

  const uSize = (nx * cells) / world.width;
  if (uSize > MAX_ZOOM_SKIN_SPAN) return null;

  const keys: TileKey[] = [];
  for (let ty = ty0; ty <= ty0 + ny - 1; ty++) {
    for (let tx = tx0; tx <= tx0 + nx - 1; tx++) {
      keys.push({ z, tx: wrapTileX(z, tx), ty });
    }
  }

  return {
    z,
    tx0,
    ty0,
    nx,
    ny,
    width: nx * TILE_PX,
    height: ny * TILE_PX,
    view: { x: tx0 * cells, y: ty0 * cells, w: nx * cells, h: ny * cells },
    window: {
      u: (tx0 * cells) / world.width,
      v: (ty0 * cells) / world.height,
      uSize,
      vSize: (ny * cells) / world.height,
    },
    keys,
  };
}

/**
 * Is a plan still good for this framing?
 *
 * TWO questions, and forgetting the second one is what made the whole thing
 * look like it barely worked.
 *
 * · Is the framing still INSIDE the picture? Deliberately not "inside the
 *   full-strength region": after snapping, the block is only some 1,4 times the
 *   framing and the shader's soft edge eats a twentieth at each side, so that
 *   stricter test rebuilds on almost every gesture. When the framing reaches
 *   into the soft edge, the last band of screen just fades back toward the
 *   world-wide skin — softer at the rim while moving, sharp again a breath
 *   after stopping.
 *
 * · Is the picture still the RIGHT SIZE for the framing? The first question
 *   alone is satisfied forever the moment you zoom in, because a block covering
 *   half the world contains anything. That is exactly what happened: a plan
 *   made at planet range stuck at z4 — 9,8 km per pixel — no matter how close
 *   the camera got. Zooming in has to be able to invalidate a plan.
 */
export const ZOOM_SKIN_KEEP = 0.02;

export function zoomSkinCovers(
  plan: ZoomSkinPlan,
  mesh: SkinWindow,
  fade = ZOOM_SKIN_KEEP,
): boolean {
  const w = plan.window;
  // Nearest wrapped branch of the mesh centre relative to the plan.
  let du = mesh.u - w.u;
  du -= Math.round(du);
  const lu0 = (du - mesh.uSize / 2) / w.uSize;
  const lu1 = (du + mesh.uSize / 2) / w.uSize;
  const lv0 = (mesh.v - mesh.vSize / 2 - w.v) / w.vSize;
  const lv1 = (mesh.v + mesh.vSize / 2 - w.v) / w.vSize;
  // Off the top or the bottom does not count against the plan: it is already
  // snapped to the last row of tiles there, so no picture could cover further.
  // Demasiado grande para lo que se está mirando: hay nitidez esperando en un
  // nivel más hondo.
  if (w.uSize > mesh.uSize * MAX_BLOCK_RATIO
    && w.vSize > mesh.vSize * MAX_BLOCK_RATIO) return false;
  const atNorthPole = plan.ty0 === 0;
  const atSouthPole = plan.ty0 + plan.ny >= tileCountY(plan.z);
  return lu0 >= fade && lu1 <= 1 - fade
    && (atNorthPole || lv0 >= fade)
    && (atSouthPole || lv1 <= 1 - fade);
}
