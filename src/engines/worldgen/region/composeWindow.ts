// ============================================
// Regional canon — exact-window composition
// ============================================
// The deep display tiles need a RegionData for an EXACT rectangle of the
// global canon lattice — tile edges must land on cell boundaries shared with
// the neighbouring tile, or nothing else about tiling works. The existing
// `composeCanon` answers a looser question ("the countryside under this
// viewport, within a raster budget") and deliberately drops the enclosure
// vectors no composite consumer drew. A deep tile draws EVERYTHING the pliego
// draws, so this variant carries fields, hedges and dykes too.
//
// Pure data → data, no worker client, no DOM: importable from the region
// worker (where deep tiles render) and from harnesses alike.

import type { WorldData } from '../core/types';
import { chaikin } from '../cartography/contours';
import { kmPerWorldCell } from './terrain';
import type { FieldParcel, RegionData, RegionPlace, RegionStream, RegionTrack } from './types';
import {
  canonParams, canonRefinement, tileGeometry, tileInterior,
  tileCountY, wrapTx, TILE_WORLD_CELLS, type TileId,
} from './tiles';

export interface CanonWindowSpec {
  /** Global canon cell indices of the output INTERIOR's top-left. */
  gx0: number;
  gy0: number;
  /** Interior size in canon cells. */
  cw: number;
  ch: number;
  /**
   * Cells composed around the interior on every side. This is feature REACH,
   * not generation apron: a village whose houses straddle the tile edge must
   * be present in this tile's data so its ink can cross in, exactly as the
   * neighbour draws it.
   */
  margin: number;
}

/** The canon tiles whose interiors intersect a window INCLUDING its margin. */
export function canonWindowCover(world: WorldData, spec: CanonWindowSpec): TileId[] {
  // Canon cells per tile interior — exact on the lattice by construction.
  const perTile = tileInterior(world);
  const x0 = spec.gx0 - spec.margin, x1 = spec.gx0 + spec.cw + spec.margin;
  const y0 = spec.gy0 - spec.margin, y1 = spec.gy0 + spec.ch + spec.margin;
  const ny = tileCountY(world);
  const out: TileId[] = [];
  const ty0 = Math.max(0, Math.floor(y0 / perTile));
  const ty1 = Math.min(ny - 1, Math.floor((y1 - 1) / perTile));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = Math.floor(x0 / perTile); tx <= Math.floor((x1 - 1) / perTile); tx++) {
      out.push({ tx: wrapTx(world, tx), ty });
    }
  }
  // Dedup after the wrap (a window straddling the seam covers a tile twice).
  const seen = new Set<string>();
  return out.filter((id) => {
    const k = `${id.tx}:${id.ty}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

interface PlacedTile { id: TileId; data: RegionData }

/** Split a remapped polyline into runs, breaking where source points were
 *  dropped — a stream that leaves the window and returns must not shortcut
 *  across the gap. Each run carries the arc length (cells) travelled along
 *  the SOURCE polyline before the run begins, for dash-phase anchoring. */
function clipRuns(
  pts: { x: number; y: number }[],
  keep: (p: { x: number; y: number }) => boolean,
  map: (p: { x: number; y: number }) => { x: number; y: number },
): { pts: { x: number; y: number }[]; phase: number }[] {
  const runs: { pts: { x: number; y: number }[]; phase: number }[] = [];
  let run: { x: number; y: number }[] = [];
  let phase = 0, arc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0) arc += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    if (keep(p)) {
      if (!run.length) phase = arc;
      run.push(map(p));
    } else if (run.length) {
      if (run.length >= 2) runs.push({ pts: run, phase });
      run = [];
    }
  }
  if (run.length >= 2) runs.push({ pts: run, phase });
  return runs;
}

/**
 * Stitch tile interiors into one RegionData covering EXACTLY
 * `(gx0-margin, gy0-margin) … (gx0+cw+margin, gy0+ch+margin)` on the global
 * canon lattice. Same conventions as a generated tile: `margin` cells of
 * overhang, `originX/Y` at the grid's (0,0) INCLUDING the margin, so every
 * consumer that understands a generated RegionData understands this one.
 */
export function composeCanonWindow(
  world: WorldData,
  tiles: PlacedTile[],
  spec: CanonWindowSpec,
): RegionData {
  const W = world.width;
  const kmCell = kmPerWorldCell(world);
  const per = 1 / canonRefinement(world);
  const interior = tileInterior(world);
  const m = spec.margin;
  const width = spec.cw + m * 2;
  const height = spec.ch + m * 2;
  const n = width * height;
  // Grid (0,0) in global canon indices.
  const ox = spec.gx0 - m;
  const oy = spec.gy0 - m;

  const out: RegionData = {
    window: {
      cx: (spec.gx0 + spec.cw / 2) * per,
      cy: (spec.gy0 + spec.ch / 2) * per,
      spanKm: spec.cw * per * kmCell,
    },
    params: tiles[0]?.data.params ?? canonParams(world),
    width,
    height,
    margin: m,
    metresPerCell: kmCell * 1000 * per,
    originX: ox * per,
    originY: oy * per,
    worldPerCellX: per,
    worldPerCellY: per,
    elevation: new Float32Array(n),
    water: new Uint8Array(n),
    flow: new Float32Array(n),
    slope: new Float32Array(n),
    wet: new Float32Array(n),
    biome: new Uint8Array(n),
    cover: new Uint8Array(n),
    streams: [] as RegionStream[],
    places: [] as RegionPlace[],
    tracks: [] as RegionTrack[],
    fields: [] as FieldParcel[],
    hedges: [],
    dykes: [],
    title: tiles[0]?.data.title ?? '',
    subtitle: tiles[0]?.data.subtitle ?? '',
  };
  // Sea outside the covered rows (polar clamp): matches generated tiles, which
  // never exist past the poles.
  out.water.fill(1);

  const worldCanon = Math.round(W / per);
  const seenPlace = new Set<string>();

  for (const { id, data } of tiles) {
    const g = tileGeometry(world, id);
    const tix0 = Math.round((wrapTx(world, id.tx) * TILE_WORLD_CELLS) / per);
    const tiy0 = Math.round((Math.min(tileCountY(world) - 1, Math.max(0, id.ty)) * TILE_WORLD_CELLS) / per);

    for (const shift of [-worldCanon, 0, worldCanon]) {
      const ax0 = Math.max(ox, tix0 + shift);
      const ax1 = Math.min(ox + width, tix0 + shift + interior);
      const ay0 = Math.max(oy, tiy0);
      const ay1 = Math.min(oy + height, tiy0 + interior);
      if (ax1 <= ax0 || ay1 <= ay0) continue;

      for (let gy = ay0; gy < ay1; gy++) {
        const trow = (gy - tiy0) + g.margin;
        const drow = (gy - oy) * width;
        const srow = trow * data.width;
        for (let gx = ax0; gx < ax1; gx++) {
          const si = srow + (gx - (tix0 + shift)) + g.margin;
          const di = drow + (gx - ox);
          out.elevation[di] = data.elevation[si];
          out.water[di] = data.water[si];
          out.flow[di] = data.flow[si];
          out.slope[di] = data.slope[si];
          out.wet[di] = data.wet[si];
          out.biome[di] = data.biome[si];
          out.cover[di] = data.cover[si];
        }
      }

      // Vectors: from this tile's INTERIOR only (dedup by construction — every
      // canon cell has exactly one owning interior), remapped into grid cells.
      const toGrid = (p: { x: number; y: number }) => ({
        x: (p.x - g.margin) + (tix0 + shift) - ox,
        y: (p.y - g.margin) + tiy0 - oy,
      });
      const inInterior = (p: { x: number; y: number }) =>
        p.x >= g.margin && p.x < g.margin + interior && p.y >= g.margin && p.y < g.margin + interior;
      const inGrid = (p: { x: number; y: number }) => {
        const q = toGrid(p);
        return q.x >= 0 && q.x < width && q.y >= 0 && q.y < height;
      };
      const keepPt = (p: { x: number; y: number }) => inInterior(p) && inGrid(p);

      for (const p of data.places) {
        if (!inInterior(p)) continue;
        const q = toGrid(p);
        if (q.x < 0 || q.x >= width || q.y < 0 || q.y >= height) continue;
        if (seenPlace.has(p.sourceKey)) continue;
        seenPlace.add(p.sourceKey);
        out.places.push({ ...p, x: q.x, y: q.y });
      }
      // Streams and ways are SMOOTHED here, on the whole source polyline in
      // cell space, BEFORE clipping. Smoothing per window would anchor the
      // smoother at the cut (a cusp one window has and the other does not),
      // and dash phases measured on unsmoothed lines drift from the drawn
      // length. Smoothing once, globally, then truncating, keeps the drawn
      // geometry — and the dash odometer — identical in every window.
      for (const s of data.streams) {
        // World trunks were already smoothed once from their authoritative
        // world polyline. Re-smoothing each canon tile/window independently
        // moves the same river differently on either side of a seam.
        const smooth = !s.trunk && s.pts.length >= 3 ? chaikin(s.pts, false, 2) : s.pts;
        for (const run of clipRuns(smooth, keepPt, toGrid)) {
          out.streams.push({ ...s, pts: run.pts });
        }
      }
      for (const tr of data.tracks) {
        const smooth = tr.pts.length >= 3 ? chaikin(tr.pts, false, 2) : tr.pts;
        for (const run of clipRuns(smooth, keepPt, toGrid)) {
          out.tracks.push({ ...tr, pts: run.pts, dashPhase: run.phase });
        }
      }
      for (const h of data.hedges) {
        for (const run of clipRuns(h, keepPt, toGrid)) out.hedges.push(run.pts);
      }
      for (const d of data.dykes) {
        for (const run of clipRuns(d, keepPt, toGrid)) out.dykes.push(run.pts);
      }
      for (const f of data.fields) {
        // A parcel belongs to the tile that owns its centroid (one owner, no
        // doubles), and rides along if any of it can reach the grid.
        let cx = 0, cy = 0;
        for (const p of f.poly) { cx += p.x; cy += p.y; }
        cx /= f.poly.length; cy /= f.poly.length;
        if (!inInterior({ x: cx, y: cy })) continue;
        if (!f.poly.some(inGrid)) continue;
        out.fields.push({ ...f, poly: f.poly.map(toGrid) });
      }
    }
  }
  return out;
}
