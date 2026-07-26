// ============================================
// Regional sheet — Enclosures and boundaries
// ============================================
// The thing that makes country look FARMED rather than merely green is the
// boundary pattern: hedges, walls, banks and headlands. It is also the thing a
// procedural map almost never has, because parcels are usually generated as a
// tidy grid and a tidy grid reads as an industrial estate.
//
// Two mechanisms here, and they draw different things:
//
//   ENCLOSURES  A jittered lattice anchored to world coordinates, so parcels do
//               not slide when the reader pans. Pitch is measured in SHEET cells
//               rather than in metres, which means the enclosure pattern
//               generalises with scale the way a real map series does: at a wide
//               span you see furlong blocks, and zooming in resolves them into
//               fields without the drawing ever getting denser than it can carry.
//
//   HEAD-DYKE   The boundary between the cultivated in-bye and the open hill.
//               One line, traced round the whole farmed area, and it does more
//               for the sense of a working landscape than any number of parcels.

import { marchingSquares, chaikin, simplify } from '../cartography/contours';
import { Cover, type CoverId, type FieldParcel, type RegionParams, type RegionPlace } from './types';
import type { RegionGeometry, TerrainFields } from './terrain';

function hash2(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const ENCLOSED: Partial<Record<number, boolean>> = {
  [Cover.Arable]: true, [Cover.Pasture]: true, [Cover.Orchard]: true, [Cover.Vineyard]: true,
};

export interface FieldResult {
  fields: FieldParcel[];
  /** Field boundaries: hedge, bank or drystone wall depending on the country. */
  hedges: { x: number; y: number }[][];
  /** The head-dyke — the single line dividing worked ground from open hill. */
  dykes: { x: number; y: number }[][];
}

export function buildFields(
  g: RegionGeometry,
  t: TerrainFields,
  cover: Uint8Array,
  tilth: Float32Array,
  places: RegionPlace[],
  params: RegionParams,
): FieldResult {
  const W = g.width, H = g.height;
  const fields: FieldParcel[] = [];
  const hedges: { x: number; y: number }[][] = [];
  const dykes: { x: number; y: number }[][] = [];
  if (params.settled <= 0) return { fields, hedges, dykes };

  // ---- enclosures ----------------------------------------------------------
  // 7 sheet cells: about 26 px on a sheet drawn at 4 px per cell, which is the
  // smallest a parcel can be and still read as a parcel rather than as noise.
  const pitchCells = 7;
  const pitchWorld = pitchCells * g.worldPerCellX;
  const a0 = Math.floor(g.originX / pitchWorld) - 1;
  const a1 = Math.ceil((g.originX + W * g.worldPerCellX) / pitchWorld) + 1;
  const b0 = Math.floor(g.originY / pitchWorld) - 1;
  const b1 = Math.ceil((g.originY + H * g.worldPerCellY) / pitchWorld) + 1;

  // A lattice VERTEX is jittered once and shared by its four parcels, so the
  // enclosures tile without gaps or overlaps — which is what makes them read as
  // a division of the ground rather than as scattered rectangles.
  const vert = (a: number, b: number): { x: number; y: number } => {
    const jx = (hash2(a, b, 11) - 0.5) * 0.62;
    const jy = (hash2(a, b, 12) - 0.5) * 0.62;
    const wx = (a + jx) * pitchWorld;
    const wy = (b + jy) * pitchWorld;
    return {
      x: (wx - g.originX) / g.worldPerCellX,
      y: (wy - g.originY) / g.worldPerCellY,
    };
  };

  // Which settlement each parcel belongs to decides whether it is a strip or a
  // close, because that was a decision made per village, not per field.
  const stripVillage = new Map<number, boolean>();
  for (const p of places) {
    if (p.kind === 'village' || p.kind === 'town') {
      stripVillage.set(p.id, hash2(Math.round(p.x), Math.round(p.y), 21) < 0.45);
    }
  }
  const nearestVillage = (x: number, y: number): RegionPlace | null => {
    let best: RegionPlace | null = null, bd = Infinity;
    for (const p of places) {
      if (!stripVillage.has(p.id)) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  const AW = a1 - a0, AH = b1 - b0;
  const occupied = new Uint8Array(AW * AH);
  const coverOf = new Uint8Array(AW * AH);
  const at = (a: number, b: number) =>
    (a < a0 || a >= a1 || b < b0 || b >= b1) ? -1 : (b - b0) * AW + (a - a0);

  for (let b = b0; b < b1; b++) {
    for (let a = a0; a < a1; a++) {
      const p00 = vert(a, b), p10 = vert(a + 1, b), p11 = vert(a + 1, b + 1), p01 = vert(a, b + 1);
      const cx = (p00.x + p10.x + p11.x + p01.x) / 4;
      const cy = (p00.y + p10.y + p11.y + p01.y) / 4;
      const xi = Math.round(cx), yi = Math.round(cy);
      if (xi < 0 || xi >= W || yi < 0 || yi >= H) continue;
      const i = yi * W + xi;
      if (!ENCLOSED[cover[i]]) continue;
      // Pasture is enclosed too, but further out and less completely, so it
      // takes a higher bar. Without the split, the whole sheet came out under a
      // uniform mesh of squares that read as graph paper rather than as fields.
      const bar = cover[i] === Cover.Pasture ? 0.5 : 0.32;
      if (tilth[i] < bar) continue;
      // Steep ground is not enclosed in squares; it is grazed.
      if (t.slope[i] > 0.3) continue;

      const k = at(a, b);
      if (k < 0) continue;
      occupied[k] = 1;
      coverOf[k] = cover[i];

      const host = nearestVillage(cx, cy);
      const strip = host ? (stripVillage.get(host.id) ?? false) : false;
      fields.push({ poly: [p00, p10, p11, p01], cover: cover[i] as CoverId, strip });
    }
  }

  // ---- which lattice edges are actually hedges -----------------------------
  //
  // Emitting one closed quadrilateral per lattice square and stroking them all
  // is what produced a sheet under a perfectly uniform net — graph paper, not
  // farmland. Real fields vary in size by an order of magnitude within one
  // parish, and the variation is what the eye reads as a worked landscape.
  //
  // So the shared edges are decided one by one: a boundary between farmed and
  // unfarmed ground is ALWAYS a hedge, and an internal one survives only if its
  // own hash says so. Neighbouring squares whose shared edge is dropped fuse
  // into a bigger close, and a run of them fuses into a furlong — which is how
  // the size distribution comes out ragged without anything having to model it.
  const keepEdge = (a: number, b: number, horiz: boolean): boolean => {
    const me = at(a, b);
    const other = horiz ? at(a, b - 1) : at(a - 1, b);
    const mine = me >= 0 && occupied[me] === 1;
    const theirs = other >= 0 && occupied[other] === 1;
    if (!mine && !theirs) return false;
    if (mine !== theirs) return true;                       // the edge of the in-bye
    if (coverOf[me] !== coverOf[other]) return true;        // arable meets pasture
    return hash2(a * 2 + (horiz ? 1 : 0), b, 31) < 0.52;
  };
  for (let b = b0; b <= b1; b++) {
    for (let a = a0; a <= a1; a++) {
      if (keepEdge(a, b, true)) hedges.push([vert(a, b), vert(a + 1, b)]);
      if (keepEdge(a, b, false)) hedges.push([vert(a, b), vert(a, b + 1)]);
    }
  }

  // ---- the head-dyke -------------------------------------------------------
  // Traced on a smoothed tilth field, because the raw one is a cloud of
  // per-cell decisions and its contour comes out as a lace doily.
  const smooth = boxBlur(tilth, W, H, 3);
  for (const c of marchingSquares(smooth, W, H, 0.3, false)) {
    if (c.pts.length < 14) continue;
    const s = simplify(c.pts, 0.9);
    if (s.length < 6) continue;
    dykes.push(chaikin(s, c.closed, 2));
  }

  return { fields, hedges, dykes };
}

function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = sum / (2 * r + 1);
      sum -= src[y * W + Math.min(W - 1, Math.max(0, x - r))];
      sum += src[y * W + Math.min(W - 1, Math.max(0, x + r + 1))];
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = sum / (2 * r + 1);
      sum -= tmp[Math.min(H - 1, Math.max(0, y - r)) * W + x];
      sum += tmp[Math.min(H - 1, Math.max(0, y + r + 1)) * W + x];
    }
  }
  return out;
}
