// ============================================
// Regional canon — tile client and compositor
// ============================================
// The renderer-side face of the canonical layer: ask for the countryside under
// a viewport and get ONE RegionData back, composed from the canon tiles that
// cover it. Tiles are requested nearest-the-centre first (the reader is looking
// there), each through the ordinary `regionClient` — same worker sessions, same
// LRU, same cancellation — keyed by their world-aligned geometry, so a tile
// computed for one window is a cache hit for every later window it touches.
//
// The composite copies INTERIOR cells only. Aprons exist so the structural
// passes converge before the interior edge (measured: sub-decimetre); they are
// scaffolding, never content. When the covered span is wider than the output
// budget the copy strides by an integer factor — decimation, not resampling,
// so a cell in the composite is always exactly some canon cell.

import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import { kmPerWorldCell } from './terrain';
import type { RegionData, RegionParams, RegionPlace, RegionStream, RegionTrack } from './types';
import { regionClient, type RegionRequestOptions } from './client';
import { canonTileKey } from './generate';
import {
  canonParams, canonRefinement, tileGeometry, tileInterior, tileWindow,
  tileCountY, wrapTx, TILE_WORLD_CELLS, type TileId,
} from './tiles';

/** Widest window the canon composite serves (km). Wider views belong to the
 *  world raster / the future display pyramid, not to ~150 m ground truth. */
export const CANON_LOD_MAX_KM = 170;
/** Output raster budget for a composite (cells across). */
export const COMPOSITE_MAX = 1024;

export interface CanonCompositeRequest {
  /** Centre, normalized world coordinates. */
  u: number;
  v: number;
  /** Ground width to cover, km. */
  spanKm: number;
  /** height/width of the window (defaults to 1/1.7 like the LOD effect). */
  aspect?: number;
}

export interface CanonCompositeHandle {
  promise: Promise<RegionData>;
  cancel: () => void;
}

/** The tiles whose interiors intersect the window, nearest the centre first. */
export function canonCover(world: WorldData, req: CanonCompositeRequest): TileId[] {
  const W = world.width, H = world.height;
  const kmCell = kmPerWorldCell(world);
  const spanCells = Math.min(W, req.spanKm / kmCell);
  const aspect = req.aspect ?? 1.7;
  const spanYCells = Math.min(H, spanCells / aspect);
  const cx = req.u * W, cy = req.v * H;
  const x0 = cx - spanCells / 2, x1 = cx + spanCells / 2;
  const y0 = Math.max(0, cy - spanYCells / 2), y1 = Math.min(H - 1e-6, cy + spanYCells / 2);
  const out: TileId[] = [];
  const ny = tileCountY(world);
  const ty0 = Math.max(0, Math.floor(y0 / TILE_WORLD_CELLS));
  const ty1 = Math.min(ny - 1, Math.floor(y1 / TILE_WORLD_CELLS));
  const tx0 = Math.floor(x0 / TILE_WORLD_CELLS);
  const tx1 = Math.floor(x1 / TILE_WORLD_CELLS);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) out.push({ tx: wrapTx(world, tx), ty });
  }
  // Nearest the centre first: the ground under the reader's eyes resolves
  // before the corners do.
  const d2 = (id: TileId) => {
    const w = tileWindow(world, id);
    let dx = w.cx - cx;
    while (dx > W / 2) dx -= W;
    while (dx < -W / 2) dx += W;
    return dx * dx + (w.cy - cy) * (w.cy - cy);
  };
  return out.sort((a, b) => d2(a) - d2(b));
}

interface PlacedTile { id: TileId; data: RegionData }

/**
 * Stitch tile interiors into one RegionData covering the window.
 *
 * Raster fields are copied cell-for-cell (with an integer stride when the
 * window exceeds the output budget). Places, streams and tracks come from each
 * tile's interior only — the same feature computed twice in two aprons would
 * otherwise appear twice — and are remapped into composite cells. Fields,
 * hedges and dykes are left empty: no composite consumer draws them today
 * (the live overlay and the 3D patch read rasters; entity dots read places),
 * and the export sheet still renders whole tiles.
 */
export function composeCanon(
  world: WorldData,
  tiles: PlacedTile[],
  req: CanonCompositeRequest,
): RegionData {
  const W = world.width, H = world.height;
  const kmCell = kmPerWorldCell(world);
  const per = 1 / canonRefinement(world);
  const interior = tileInterior(world);
  const aspect = req.aspect ?? 1.7;
  const spanCells = Math.min(W, req.spanKm / kmCell);
  const spanYCells = Math.min(H, spanCells / aspect);
  const cx = req.u * W, cy = req.v * H;

  // Window in canon cell indices (global canon lattice), clamped in latitude.
  const gx0 = Math.floor((cx - spanCells / 2) / per);
  const gx1 = Math.ceil((cx + spanCells / 2) / per);
  const gy0 = Math.floor(Math.max(0, cy - spanYCells / 2) / per);
  let gy1 = Math.ceil(Math.min(H, cy + spanYCells / 2) / per);
  if (gy1 <= gy0) gy1 = gy0 + 1;

  const stride = Math.max(1, Math.ceil((gx1 - gx0) / COMPOSITE_MAX));
  const cw = Math.max(1, Math.floor((gx1 - gx0) / stride));
  const ch = Math.max(1, Math.floor((gy1 - gy0) / stride));
  const n = cw * ch;

  const out: RegionData = {
    window: { cx, cy, spanKm: req.spanKm },
    params: tiles[0]?.data.params ?? canonParams(world),
    width: cw,
    height: ch,
    margin: 0,
    metresPerCell: kmCell * 1000 * per * stride,
    originX: gx0 * per,
    originY: gy0 * per,
    worldPerCellX: per * stride,
    worldPerCellY: per * stride,
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
    fields: [],
    hedges: [],
    dykes: [],
    title: tiles[0]?.data.title ?? '',
    subtitle: tiles[0]?.data.subtitle ?? '',
  };

  const canonPerTile = interior; // interior cells per tile edge
  const seen = new Set<string>();

  for (const { id, data } of tiles) {
    const g = tileGeometry(world, id);
    // The tile's interior in global canon indices. tx*TILE_WORLD_CELLS is exact
    // on the lattice, so this is an integer by construction.
    const tix0 = Math.round((wrapTx(world, id.tx) * TILE_WORLD_CELLS) / per);
    const tiy0 = Math.round((Math.min(tileCountY(world) - 1, Math.max(0, id.ty)) * TILE_WORLD_CELLS) / per);

    // Overlap of [gx0, gx1) with this tile's interior, allowing the x wrap by
    // testing the tile at its unwrapped positions around the window.
    const worldCanon = Math.round(W / per);
    for (const shift of [-worldCanon, 0, worldCanon]) {
      const ax0 = Math.max(gx0, tix0 + shift);
      const ax1 = Math.min(gx1, tix0 + shift + canonPerTile);
      const ay0 = Math.max(gy0, tiy0);
      const ay1 = Math.min(gy1, tiy0 + canonPerTile);
      if (ax1 <= ax0 || ay1 <= ay0) continue;

      // Copy rasters on the stride lattice anchored at gx0/gy0.
      const sx0 = Math.ceil((ax0 - gx0) / stride);
      const sx1 = Math.floor((ax1 - 1 - gx0) / stride);
      const sy0 = Math.ceil((ay0 - gy0) / stride);
      const sy1 = Math.floor((ay1 - 1 - gy0) / stride);
      for (let sy = sy0; sy <= sy1; sy++) {
        const gy = gy0 + sy * stride;
        const trow = (gy - tiy0) + g.margin; // tile grid row
        for (let sx = sx0; sx <= sx1; sx++) {
          const gx = gx0 + sx * stride;
          const tcol = (gx - (tix0 + shift)) + g.margin;
          const si = trow * data.width + tcol;
          const di = sy * cw + sx;
          out.elevation[di] = data.elevation[si];
          out.water[di] = data.water[si];
          out.flow[di] = data.flow[si];
          out.slope[di] = data.slope[si];
          out.wet[di] = data.wet[si];
          out.biome[di] = data.biome[si];
          out.cover[di] = data.cover[si];
        }
      }

      // Vector content from the interior, remapped into composite cells.
      const toComposite = (x: number, y: number) => ({
        x: ((x - g.margin) + tix0 + shift - gx0) / stride,
        y: ((y - g.margin) + tiy0 - gy0) / stride,
      });
      const inInterior = (x: number, y: number) =>
        x >= g.margin && x < g.margin + canonPerTile && y >= g.margin && y < g.margin + canonPerTile;

      for (const p of data.places) {
        if (!inInterior(p.x, p.y)) continue;
        const q = toComposite(p.x, p.y);
        if (q.x < 0 || q.x >= cw || q.y < 0 || q.y >= ch) continue;
        if (seen.has(p.sourceKey)) continue;
        seen.add(p.sourceKey);
        out.places.push({ ...p, x: q.x, y: q.y });
      }
      for (const s of data.streams) {
        const pts = s.pts
          .filter((pt) => inInterior(pt.x, pt.y))
          .map((pt) => toComposite(pt.x, pt.y))
          .filter((pt) => pt.x >= 0 && pt.x < cw && pt.y >= 0 && pt.y < ch);
        if (pts.length >= 2) out.streams.push({ ...s, pts });
      }
      for (const tr of data.tracks) {
        const pts = tr.pts
          .filter((pt) => inInterior(pt.x, pt.y))
          .map((pt) => toComposite(pt.x, pt.y))
          .filter((pt) => pt.x >= 0 && pt.x < cw && pt.y >= 0 && pt.y < ch);
        if (pts.length >= 2) out.tracks.push({ ...tr, pts });
      }
    }
  }
  return out;
}

/**
 * Request the canonical countryside under a window: cover → generate (nearest
 * first, worker-backed, cached) → compose. Progress reports tiles completed.
 */
export function requestCanonComposite(
  world: WorldData,
  geography: HumanGeography,
  req: CanonCompositeRequest,
  options: Pick<RegionRequestOptions, 'onProgress' | 'signal' | 'workerFactory' | 'edits'>
    & { params?: Partial<RegionParams> } = {},
): CanonCompositeHandle {
  const ids = canonCover(world, req);
  const handles = ids.map((id) => regionClient.request(world, geography, tileWindow(world, id), {
    params: canonParams(world, options.params),
    geometry: tileGeometry(world, id),
    edits: options.edits,
    // La identidad canónica: con ella la sábana siembra del almacén, responde
    // de la residencia del worker, y lo que genere se guarda — antes el
    // composite era el único productor de canon cuyo trabajo moría con la
    // petición (PENDIENTE §2b, el «detalle regional» de 49 s).
    canonKey: canonTileKey(id),
    signal: options.signal,
    workerFactory: options.workerFactory,
  }));
  const cancel = () => { for (const h of handles) h.cancel(); };
  let done = 0;
  const promise = Promise.all(handles.map((h, i) => h.promise.then((data) => {
    done++;
    options.onProgress?.('comarca', done / handles.length);
    return { id: ids[i], data };
  }))).then((tiles) => composeCanon(world, tiles, req));
  return { promise, cancel };
}
