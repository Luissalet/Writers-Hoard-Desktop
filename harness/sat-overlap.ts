// The invariant the whole pyramid rests on: the painter is a function of the
// GROUND, not of the window. Two overlapping windows must ink the shared strip
// identically — if they do, no arrangement of tiles can show a seam, and the
// "step across the join" number measured on adjacent tiles is just the country
// changing, which is what country does.
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { generateCanonTile, canonTileKey } from '../src/engines/worldgen/region/generate';
import { canonRefinement, tileAt } from '../src/engines/worldgen/region/tiles';
import { canonWindowCover, composeCanonWindow } from '../src/engines/worldgen/region/composeWindow';
import { renderSatellite } from '../src/engines/worldgen/region/satelliteInk';
import type { RegionData } from '../src/engines/worldgen/region/types';
import type { TileId } from '../src/engines/worldgen/region/tiles';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
const ref = canonRefinement(world);
const wrapX = world.width * ref;

const cache = new Map<string, RegionData>();
function tile(id: TileId): RegionData {
  const k = canonTileKey(id);
  let d = cache.get(k);
  if (!d) { d = generateCanonTile(world, geo, id); cache.set(k, d); }
  return d;
}

// A window over inhabited ground so the test covers crowns, tracks and roofs.
const s = [...geo.settlements].sort((a, b) => b.population - a.population)[2];
const anchor = tileAt(world, s.x, s.y);
const gx0 = anchor.tx * 4 * ref + 100;
const gy0 = anchor.ty * 4 * ref + 100;

function paint(ox: number, cw: number, pxPerCell: number): Uint8Array {
  const spec = { gx0: gx0 + ox, gy0, cw, ch: cw, margin: 16 };
  const placed = canonWindowCover(world, spec).map((id) => ({ id, data: tile(id) }));
  const region = composeCanonWindow(world, placed, spec);
  const W = Math.round(cw * pxPerCell);
  const c = createCanvas(W, W);
  const ctx = c.getContext('2d');
  renderSatellite(region, ctx as unknown as Ctx, {
    width: W, height: W, pxPerCell,
    ink: { seed: `${world.params.seed}::sat`, gx0: spec.gx0 - spec.margin, gy0: spec.gy0 - spec.margin, wrapX },
    density: 1, buildings: true,
  });
  return new Uint8Array(ctx.getImageData(0, 0, W, W).data);
}

for (const pxPerCell of [4, 16, 64]) {
  const cw = 32, shift = 16;
  const W = cw * pxPerCell;
  const a = paint(0, cw, pxPerCell);
  const b = paint(shift, cw, pxPerCell);
  // A's right half is B's left half, on the ground.
  const off = shift * pxPerCell;
  let worst = 0, sum = 0, n = 0, bad = 0;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W - off; x++) {
      const ia = (y * W + (x + off)) * 4;
      const ib = (y * W + x) * 4;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[ia + c] - b[ib + c]));
      worst = Math.max(worst, d); sum += d; n++;
      if (d > 2) bad++;
    }
  }
  console.log(`${String(pxPerCell).padStart(3)} px/celda · media ${(sum / n).toFixed(3)} · peor ${worst} · píxeles que difieren >2: ${bad} de ${n} (${(100 * bad / n).toFixed(3)} %)`);
}
