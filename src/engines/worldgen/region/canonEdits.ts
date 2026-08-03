// ============================================
// Regional canon — the edit list, one scale down
// ============================================
// A world is seed + params + ONE ordered list of edits, and the canonical
// tiles honour that contract at their own resolution: the tile starts from the
// PRISTINE world (the caller ships pristine elevation — re-rasterising strokes
// on top of the already-edited world would apply every stroke twice, and the
// non-linear ops make "subtract it first" ill-defined), amplifies it, and then
// runs the SAME strokes through the SAME sculpt ops on the canon grid. A 300 m
// brush that is a rounding error on the world grid is a hill here.
//
// Hand-drawn rivers are deliberately NOT handled here: they live on
// `world.painted.rivers` in exactly the shape the world's own rivers have, and
// `carveWorldRivers` carves both lists as boundary conditions — channel,
// injected discharge, a name. Painted roads reach the sheet through
// `geo.roads` (the settlement pass has always merged them).

import type { WorldData } from '../core/types';
import type { WorldEdit, Stroke } from '../core/edits';
import {
  applyLandOp, applyTerrainOp, maskForOp, opBaseRect, snapshotBase, strokeMask, tipOf, tipReach,
} from '../sculpt/ops';
import type { RegionGeometry } from './terrain';
import { naturalOf } from './cover';

/** A stroke re-expressed in sheet cells, or null when it cannot touch the grid. */
function toSheetStroke(stroke: Stroke, g: RegionGeometry, worldWidth: number): Stroke | null {
  const per = g.worldPerCellX;
  const scale = 1 / per;
  const cx = g.originX + (g.width / 2) * per;
  const pts = stroke.pts.map((p) => {
    // Nearest wrapped branch to the window, so a stroke across the seam maps
    // onto this sheet instead of a copy of it half a world away.
    let dx = p.x - cx;
    while (dx > worldWidth / 2) dx -= worldWidth;
    while (dx < -worldWidth / 2) dx += worldWidth;
    return { x: (cx + dx - g.originX) * scale, y: (p.y - g.originY) * scale };
  });
  const radius = stroke.radius * scale;
  const reach = radius * tipReach(tipOf({ ...stroke, radius })) + 2;
  const inside = pts.some((p) =>
    p.x > -reach && p.x < g.width + reach && p.y > -reach && p.y < g.height + reach);
  if (!inside) return null;
  return { ...stroke, pts, radius };
}

/**
 * Terrain, coastline and the rivers' channels, applied to the amplified sheet
 * BEFORE erosion and hydrology — the same order the world pipeline keeps, so
 * drainage and biomes downstream of a painted ridge respect it.
 */
export function applyCanonElevationEdits(
  elev: Float32Array,
  g: RegionGeometry,
  world: WorldData,
  edits: WorldEdit[],
): boolean {
  const W = g.width, H = g.height;
  let touched = false;
  for (const e of edits) {
    if (e.kind === 'terrain') {
      const stroke = toSheetStroke(e.stroke, g, world.width);
      if (!stroke) continue;
      const s = maskForOp(e.op, stroke, W, H, /* sheets do not wrap */ false);
      if (!s || s.empty) continue;
      const r = opBaseRect(e.op, stroke, s, W);
      const base = snapshotBase(elev, W, H, r.x0, r.y0, r.w, r.h);
      applyTerrainOp(e.op, elev, base, W, H, s, stroke, world.params.seed);
      touched = true;
    } else if (e.kind === 'land') {
      const stroke = toSheetStroke(e.stroke, g, world.width);
      if (!stroke) continue;
      const s = strokeMask(stroke, W, H, false);
      if (!s || s.empty) continue;
      applyLandOp(e.op, elev, { at: (i) => elev[i] }, W, H, s, stroke, world.params.seed);
      touched = true;
    }
    // 'river' edits: carved by carveWorldRivers via world.painted.rivers.
  }
  return touched;
}

/**
 * Biome paint at canon resolution, resolved onto the derived cover.
 *
 * Same contract as the world's Int16 overlay, one scale down: strokes replay
 * IN ORDER, and the eraser restores what the generator decided — which at this
 * scale is the natural cover the tile derived a moment ago, snapshotted before
 * the first painted patch lands on it.
 */
export function applyCanonCoverEdits(
  biome: Uint8Array,
  cover: Uint8Array,
  elev: Float32Array,
  g: RegionGeometry,
  world: WorldData,
  edits: WorldEdit[],
): void {
  const relevant = edits.filter((e) => e.kind === 'biome' || e.kind === 'eraseBiome');
  if (!relevant.length) return;
  const W = g.width, H = g.height;
  let baseBiome: Uint8Array | null = null;
  let baseCover: Uint8Array | null = null;
  for (const e of relevant) {
    const stroke = toSheetStroke(e.stroke, g, world.width);
    if (!stroke) continue;
    const s = strokeMask(stroke, W, H, false);
    if (!s || s.empty) continue;
    if (!baseBiome) { baseBiome = biome.slice(); baseCover = cover.slice(); }
    if (e.kind === 'biome') {
      const b = e.biome;
      const c = naturalOf(b);
      // The stroke's own placement rule, at THIS resolution — the altitude and
      // land/sea limits are physical and carry across scales unchanged. Slope
      // is expressed in metres per WORLD cell and deliberately not translated:
      // the world-scale gate already shaped where the stroke landed at all.
      const f = e.only;
      s.each((i, cov) => {
        if (cov < 0.5) return;
        if (cover[i] === 0 /* sea stays sea; coast is the land brush's job */) return;
        if (f) {
          const m = elev[i] * 1000;
          if (f.where === 'land' && elev[i] <= 0) return;
          if (f.where === 'sea' && elev[i] > 0) return;
          if (f.minElev !== undefined && m < f.minElev) return;
          if (f.maxElev !== undefined && m > f.maxElev) return;
        }
        biome[i] = b;
        cover[i] = c;
      });
    } else {
      s.each((i, cov) => {
        if (cov < 0.5) return;
        biome[i] = baseBiome![i];
        cover[i] = baseCover![i];
      });
    }
  }
}
