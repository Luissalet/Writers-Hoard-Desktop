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
import type { DomainDocument } from '../core/domainDocument';
import { domainCanonContains, domainCanonEdits, type DomainCanonEdit } from '../core/domainCanon';
import {
  applyLandOp, applyTerrainOp, maskForOp, opBaseRect, snapshotBase, strokeMask, tipOf, tipReach, type Brush,
} from '../sculpt/ops';
import type { RegionGeometry } from './terrain';
import { naturalOf } from './cover';

/**
 * Whether a stroke can touch this sheet at all — the persistence key uses it
 * to decide which edits a supertile's identity depends on, and it MUST be the
 * same answer the replay itself gives, so it simply asks the replay's own
 * converter. A stroke that "touches" but paints nothing is a harmless extra
 * invalidation; the reverse would be a stale supertile served as fresh.
 */
export function strokeTouchesSheet(stroke: Stroke, g: RegionGeometry, worldWidth: number): boolean {
  return toSheetStroke(stroke, g, worldWidth) !== null;
}

/** A stroke re-expressed in sheet cells, or null when it cannot touch the grid. */
function toSheetStroke(stroke: Stroke, g: RegionGeometry, worldWidth: number, wrapX = true): Stroke | null {
  const per = g.worldPerCellX;
  const scale = 1 / per;
  const cx = g.originX + (g.width / 2) * per;
  const pts = stroke.pts.map((p) => {
    // Nearest wrapped branch to the window, so a stroke across the seam maps
    // onto this sheet instead of a copy of it half a world away.
    let dx = p.x - cx;
    if (wrapX) {
      while (dx > worldWidth / 2) dx -= worldWidth;
      while (dx < -worldWidth / 2) dx += worldWidth;
    }
    return { x: (cx + dx - g.originX) * scale, y: (p.y - g.originY) * scale };
  });
  const radius = stroke.radius * scale;
  const reach = radius * tipReach(tipOf({ ...stroke, radius })) + 2;
  const inside = pts.some((p) =>
    p.x > -reach && p.x < g.width + reach && p.y > -reach && p.y < g.height + reach);
  if (!inside) return null;
  return { ...stroke, pts, radius };
}

function entries(world: WorldData, edits: WorldEdit[], document?: DomainDocument): DomainCanonEdit[] {
  return document ? domainCanonEdits(document, {
    x: 0, y: 0, width: world.domain?.source.width ?? world.width, height: world.domain?.source.height ?? world.height,
  }) : edits.map(edit => ({ edit, clip: null }));
}

function entryStroke(stroke: Stroke, entry: DomainCanonEdit, g: RegionGeometry, world: WorldData, document?: DomainDocument): Stroke | null {
  const bounds = document ? world.domain?.bounds : undefined;
  const local = bounds ? { ...stroke, pts: stroke.pts.map(p => ({ x: p.x - bounds.x, y: p.y - bounds.y })) } : stroke;
  return toSheetStroke(local, g, entry.wrapWidth ?? world.width, !document || !!entry.wrapWidth);
}

function survivingBrush(brush: Brush, entry: DomainCanonEdit, g: RegionGeometry, world: WorldData, document?: DomainDocument): Brush {
  if (!document) return brush;
  const ox = world.domain?.bounds.x ?? 0, oy = world.domain?.bounds.y ?? 0;
  const keeps = (x: number, y: number) => domainCanonContains(entry.clip,
    ox + g.originX + (x + 0.5) * g.worldPerCellX, oy + g.originY + (y + 0.5) * g.worldPerCellY);
  return {
    x0: brush.x0, y0: brush.y0, w: brush.w, h: brush.h, empty: brush.empty || !entry.clip,
    cover: i => keeps(i % g.width, Math.floor(i / g.width)) ? brush.cover(i) : 0,
    each: fn => brush.each((i, cov, x, y) => { if (keeps(x, y)) fn(i, cov, x, y); }),
  };
}

/** The sea level the edit list ends at, in the elevation's units (km): what the sheet's coast is pinned against. */
export function canonSeaShift(edits: readonly WorldEdit[] | undefined): number {
  let m = 0;
  for (const e of edits ?? []) if (e.kind === 'seaLevel') m = e.m;
  return m / 1000;
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
  /** Cells whose coast/relief was explicitly touched. The coastline anchor
   *  skips them after erosion so authored land and sea remain authoritative. */
  touchedMask?: Uint8Array,
  document?: DomainDocument,
): boolean {
  const W = g.width, H = g.height;
  let touched = false;
  let seaM = 0;
  for (const entry of entries(world, edits, document)) {
    const e = entry.edit;
    if (document && !entry.clip) continue;
    if (e.kind === 'seaLevel') {
      // The whole world's sea level moves every height of the sheet too, in the
      // list's order, as it does on the world (strokes after it are made on the new shore).
      const d = document ? entry.seaDeltaKm ?? 0 : (e.m - seaM) / 1000;
      seaM = e.m;
      if (!d) continue;
      const ox = world.domain?.bounds.x ?? 0, oy = world.domain?.bounds.y ?? 0;
      for (let i = 0; i < elev.length; i++) {
        if (!document || domainCanonContains(entry.clip,
          ox + g.originX + (i % W + 0.5) * g.worldPerCellX,
          oy + g.originY + (Math.floor(i / W) + 0.5) * g.worldPerCellY)) elev[i] -= d;
      }
      touched = true;
    } else if (e.kind === 'terrain') {
      const stroke = entryStroke(e.stroke, entry, g, world, document);
      if (!stroke) continue;
      const mask = maskForOp(e.op, stroke, W, H, /* sheets do not wrap */ false);
      if (!mask) continue;
      const s = survivingBrush(mask, entry, g, world, document);
      if (s.empty) continue;
      if (touchedMask) s.each((i, cov) => { if (cov > 0) touchedMask[i] = 1; });
      const r = opBaseRect(e.op, stroke, s, W);
      const base = snapshotBase(elev, W, H, r.x0, r.y0, r.w, r.h);
      applyTerrainOp(e.op, elev, base, W, H, s, stroke, world.params.seed, false);
      touched = true;
    } else if (e.kind === 'land') {
      const stroke = entryStroke(e.stroke, entry, g, world, document);
      if (!stroke) continue;
      const mask = strokeMask(stroke, W, H, false);
      if (!mask) continue;
      const s = survivingBrush(mask, entry, g, world, document);
      if (s.empty) continue;
      if (touchedMask) s.each((i, cov) => { if (cov > 0) touchedMask[i] = 1; });
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
  document?: DomainDocument,
): void {
  const relevant = entries(world, edits, document).filter(({ edit }) => edit.kind === 'biome' || edit.kind === 'eraseBiome');
  if (!relevant.length) return;
  const W = g.width, H = g.height;
  let baseBiome: Uint8Array | null = null;
  let baseCover: Uint8Array | null = null;
  for (const entry of relevant) {
    const e = entry.edit;
    if (e.kind !== 'biome' && e.kind !== 'eraseBiome') continue;
    if (document && !entry.clip) continue;
    const stroke = entryStroke(e.stroke, entry, g, world, document);
    if (!stroke) continue;
    const mask = strokeMask(stroke, W, H, false);
    if (!mask) continue;
    const s = survivingBrush(mask, entry, g, world, document);
    if (s.empty) continue;
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
