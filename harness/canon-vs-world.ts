// ¿El canon respeta el mundo? Agua, ríos y biomas.
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { generateCanonTile } from '../src/engines/worldgen/region/generate';
import { tileAt, canonRefinement, tileGeometry, TILE_WORLD_CELLS, type TileId } from '../src/engines/worldgen/region/tiles';

const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
const W = world.width, H = world.height;
const per = 1 / canonRefinement(world);
console.log(`${world.rivers.length} ríos en el mundo · ${geo.settlements.length} asentamientos`);

function worldAt(wx: number, wy: number) {
  void 0;
  const fx = wx - 0.5, fy = wy - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const wrap = (x: number) => ((x % W) + W) % W;
  const cl = (y: number) => Math.min(H - 1, Math.max(0, y));
  const e = (xx: number, yy: number) => world.elevation[cl(yy) * W + wrap(xx)];
  const elev = (e(x0, y0) * (1 - tx) + e(x0 + 1, y0) * tx) * (1 - ty)
    + (e(x0, y0 + 1) * (1 - tx) + e(x0 + 1, y0 + 1) * tx) * ty;
  // The engine's convention: `patchNearest` resolves world cell index
  // `round(wx)`, i.e. cell k is CENTRED on integer wx. Rounding (wx − 0.5)
  // instead — the obvious thing — offsets every lookup by half a world cell,
  // which is twenty kilometres and manufactures a disagreement that is not
  // there. This cost one wrong conclusion.
  const biome = world.biome[cl(Math.round(wy)) * W + wrap(Math.round(wx))];
  return { elev, biome };
}

/** Tiles that a world river actually crosses — the only place "does the trunk
 *  survive?" is even a question. */
function tilesWithRiver(limit: number): { id: TileId; cells: number }[] {
  const count = new Map<string, { id: TileId; cells: number }>();
  for (const r of world.rivers) {
    for (let k = 0; k < r.cells.length; k++) {
      const c = r.cells[k];
      const id = tileAt(world, c % W, (c / W) | 0);
      const key = `${id.tx}:${id.ty}`;
      const e = count.get(key);
      if (e) e.cells++; else count.set(key, { id, cells: 1 });
    }
  }
  return [...count.values()].sort((a, b) => b.cells - a.cells).slice(0, limit);
}

/** Is this world point within one cell of a biome boundary? */
function nearBiomeEdge(wx: number, wy: number): boolean {
  const wrap = (x: number) => ((x % W) + W) % W;
  const cl = (y: number) => Math.min(H - 1, Math.max(0, y));
  const x0 = Math.round(wx - 0.5), y0 = Math.round(wy - 0.5);
  const here = world.biome[cl(y0) * W + wrap(x0)];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (world.biome[cl(y0 + dy) * W + wrap(x0 + dx)] !== here) return true;
    }
  }
  return false;
}

const targets = tilesWithRiver(2);
// The coastal tile the first pass measured at 24,4 % water disagreement, so the
// anchor can be checked against a recorded number rather than a feeling.
targets.push({ id: { tx: 60, ty: 33 }, cells: 0 });
console.log(`teselas cruzadas por un río: ${targets.map((t) => `(${t.id.tx},${t.id.ty})×${t.cells}`).join(' ')}`);

for (const { id, cells } of targets) {
  const g = tileGeometry(world, id);
  const t = Date.now();
  const r = generateCanonTile(world, geo, id);
  const m = r.margin;
  let n = 0, waterBad = 0, biomeBad = 0, farWaterBad = 0, nearEdge = 0, land = 0, landNearEdge = 0;
  for (let y = m; y < r.height - m; y += 2) {
    for (let x = m; x < r.width - m; x += 2) {
      const i = y * r.width + x;
      const w = worldAt(g.originX + (x + 0.5) * per, g.originY + (y + 0.5) * per);
      n++;
      if ((w.elev <= 0) !== (r.water[i] === 1)) {
        waterBad++;
        if (Math.abs(w.elev) > 0.05) farWaterBad++;
      }
      if (r.water[i] === 0 && w.elev > 0) {
        land++;
        if (nearBiomeEdge(g.originX + (x + 0.5) * per, g.originY + (y + 0.5) * per)) landNearEdge++;
      }
      if (r.water[i] === 0 && w.elev > 0 && r.biome[i] !== w.biome) {
        biomeBad++;
        if (nearBiomeEdge(g.originX + (x + 0.5) * per, g.originY + (y + 0.5) * per)) nearEdge++;
      }
    }
  }
  const trunks = r.streams.filter((q) => q.trunk);
  console.log(`tesela (${id.tx},${id.ty}) · ${cells} celdas de río · ${Date.now() - t} ms`);
  console.log(`   agua discrepa ${(100 * waterBad / n).toFixed(1)} % (lejos del nivel del mar ${(100 * farWaterBad / n).toFixed(2)} %)`);
  console.log(`   bioma discrepa ${(100 * biomeBad / Math.max(1, land)).toFixed(1)} % de la tierra`);
  console.log(`      · base: el ${(100 * landNearEdge / Math.max(1, land)).toFixed(1)} % de la tierra ya está a menos de una celda de una frontera de bioma del mundo`);
  console.log(`      · de la discrepancia, ${(100 * nearEdge / Math.max(1, biomeBad)).toFixed(0)} % cae en esa franja (deformación del muestreo) y ${(100 * (biomeBad - nearEdge) / Math.max(1, biomeBad)).toFixed(0)} % en pleno bloque (corrección física)`);
  console.log(`   ${r.streams.length} arroyos · ${trunks.length} TRONCALES · ${r.streams.filter((q) => q.name).length} con nombre`);
}
