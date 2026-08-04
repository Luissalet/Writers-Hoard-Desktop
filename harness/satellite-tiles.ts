// Does the 2D actually go deep, and does it look like ground?
//
// Counts prove nothing about a picture, so this walks the whole ladder over
// one settlement — continent to roof — writes every rung out to be looked at,
// and reports what each one costs. It also renders the OLD path (the world
// raster magnified) at the deepest rung, which is the thing being replaced.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { renderBase, renderAtlasWindow } from '../src/engines/worldgen/core/render';
import { makeCanonCache, CANON_CACHE_CAP, CANON_CACHE_BYTES } from '../src/engines/worldgen/region/deepTile';
import {
  MAX_SAT_TILE_Z, SAT_DEEP_Z, renderSatelliteDeepTile, renderSatelliteShallowTile,
  satPxPerCanonCell, satelliteDeepSupported, canonCellsPerTile,
} from '../src/engines/worldgen/region/satelliteTile';
import { TILE_PX, tileCountX } from '../src/engines/worldgen/cartography/tiles';
import { kmPerWorldCell } from '../src/engines/worldgen/region/terrain';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

const OUT = 'harness/out/sat';
mkdirSync(OUT, { recursive: true });

const world = getWorld({ seed: 'monstruo', width: 1024 });
const kmCell = kmPerWorldCell(world);
console.log(`mundo ${world.width}×${world.height} · ${kmCell.toFixed(1)} km/celda`);

const t0 = Date.now();
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
console.log(`geografía humana ${Date.now() - t0} ms · ${geo.settlements.length} asentamientos`);

const t1 = Date.now();
const unshaded = renderBase(world, 'atlas', { shade: false });
console.log(`atlas sin sombra ${Date.now() - t1} ms`);

// A town with a river through it if we can find one: the hardest thing to draw.
const byRank = [...geo.settlements].sort((a, b) => b.population - a.population);
// Two of them: the coastal plain the first pass was tuned on, and the highest
// ground we can find — flat country and mountain country fail differently.
const target = byRank[2] ?? byRank[0];
const highest = [...geo.settlements].sort((a, b) =>
  (world.elevation[(b.y | 0) * world.width + (b.x | 0)] ?? 0)
  - (world.elevation[(a.y | 0) * world.width + (a.x | 0)] ?? 0))[0];
console.log(`sierra: ${highest?.name ?? '?'} a ${((world.elevation[(highest.y | 0) * world.width + (highest.x | 0)] ?? 0) * 1000).toFixed(0)} m`);
console.log(`objetivo: ${target.name ?? '(sin nombre)'} en (${target.x.toFixed(1)}, ${target.y.toFixed(1)})`);

const cache = makeCanonCache();
const limits = { cap: CANON_CACHE_CAP, bytes: CANON_CACHE_BYTES };

function tileAtWorld(z: number, wx: number, wy: number) {
  const cells = world.width / tileCountX(z);
  return { z, tx: Math.floor(wx / cells), ty: Math.floor(wy / cells) };
}

const LADDER = [4, 6, 8, 9, 10, 12, 14, 16, 18];
const rows: string[] = [];

for (const z of LADDER) {
  const key = tileAtWorld(z, target.x, target.y);
  const canvas = createCanvas(TILE_PX, TILE_PX);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  const cellsPerTile = world.width / tileCountX(z);
  const groundKm = cellsPerTile * kmCell;
  const mPerPx = (groundKm * 1000) / TILE_PX;

  const t = Date.now();
  let note = '';
  if (z >= SAT_DEEP_Z) {
    if (!satelliteDeepSupported(world, z)) { console.log(`z${z}: NO SOPORTADO`); continue; }
    const r = renderSatelliteDeepTile(world, geo, cache, ctx, key, {
      layers: {}, density: 1,
    }, limits);
    note = `${r.generated} teselas canon nuevas · ${r.places.length} lugares · ${satPxPerCanonCell(world, z).toFixed(1)} px/celda canon`;
  } else {
    renderSatelliteShallowTile(world, unshaded, ctx, key);
    note = mPerPx > 2500 ? 'ráster mundial' : 'mundo amplificado';
  }
  const ms = Date.now() - t;
  writeFileSync(`${OUT}/z${String(z).padStart(2, '0')}.png`, canvas.toBuffer('image/png'));
  const line = `z${String(z).padStart(2, ' ')} · ${groundKm < 1 ? (groundKm * 1000).toFixed(0) + ' m' : groundKm.toFixed(groundKm < 10 ? 2 : 0) + ' km'} de lado · ${mPerPx < 1 ? (mPerPx * 100).toFixed(0) + ' cm/px' : mPerPx.toFixed(mPerPx < 10 ? 2 : 0) + ' m/px'} · ${String(ms).padStart(5)} ms · ${note}`;
  rows.push(line);
  console.log(line);
}

// The thing being replaced: the same ground, magnified from the world raster,
// which is all the 2D could ever show before.
{
  const z = MAX_SAT_TILE_Z;
  const cellsPerTile = world.width / tileCountX(z);
  const key = tileAtWorld(z, target.x, target.y);
  const view = {
    x: key.tx * cellsPerTile, y: key.ty * cellsPerTile,
    w: cellsPerTile, h: cellsPerTile,
  };
  const buf = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  renderAtlasWindow(world, unshaded, buf, TILE_PX, TILE_PX, view);
  const canvas = createCanvas(TILE_PX, TILE_PX);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(TILE_PX, TILE_PX);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);
  writeFileSync(`${OUT}/z18-ANTES-raster-mundial.png`, canvas.toBuffer('image/png'));
  console.log('escrito z18-ANTES-raster-mundial.png (el camino viejo, mismo suelo)');
}

// --- detail energy --------------------------------------------------------
// Mean absolute Laplacian of luminance: how much a picture actually SAYS. The
// magnified raster and the canon tile cover identical ground, so the ratio is
// the honest measure of what the ladder bought.
function energy(png: Uint8Array, w: number, h: number): number {
  let sum = 0, n = 0;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299 * png[i * 4] + 0.587 * png[i * 4 + 1] + 0.114 * png[i * 4 + 2];
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      sum += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w]);
      n++;
    }
  }
  return sum / Math.max(1, n);
}

function pixelsOf(draw: (ctx: Ctx) => void): Uint8Array {
  const c = createCanvas(TILE_PX, TILE_PX);
  const x = c.getContext('2d');
  draw(x as unknown as Ctx);
  return new Uint8Array(x.getImageData(0, 0, TILE_PX, TILE_PX).data);
}

for (const z of [12, 15, 18]) {
  if (!satelliteDeepSupported(world, z)) continue;
  const key = tileAtWorld(z, target.x, target.y);
  const cellsPerTile = world.width / tileCountX(z);
  const view = { x: key.tx * cellsPerTile, y: key.ty * cellsPerTile, w: cellsPerTile, h: cellsPerTile };
  const before = pixelsOf((ctx) => {
    const buf = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
    renderAtlasWindow(world, unshaded, buf, TILE_PX, TILE_PX, view);
    const img = ctx.createImageData(TILE_PX, TILE_PX);
    img.data.set(buf);
    ctx.putImageData(img, 0, 0);
  });
  const after = pixelsOf((ctx) => {
    renderSatelliteDeepTile(world, geo, cache, ctx, key, { layers: {}, density: 1 }, limits);
  });
  const eb = energy(before, TILE_PX, TILE_PX);
  const ea = energy(after, TILE_PX, TILE_PX);
  console.log(`energía de detalle z${z}: antes ${eb.toFixed(3)} · ahora ${ea.toFixed(3)} · ×${(ea / Math.max(1e-6, eb)).toFixed(1)}`);
}

// --- seams ----------------------------------------------------------------
// Two tiles that share an edge must agree along it. Anything else and the
// ladder shows a grid.
for (const z of [12, 16, 18]) {
  if (!satelliteDeepSupported(world, z)) continue;
  const a = tileAtWorld(z, target.x, target.y);
  const b = { z, tx: a.tx + 1, ty: a.ty };
  const pa = pixelsOf((ctx) => { renderSatelliteDeepTile(world, geo, cache, ctx, a, { layers: {}, density: 1 }, limits); });
  const pb = pixelsOf((ctx) => { renderSatelliteDeepTile(world, geo, cache, ctx, b, { layers: {}, density: 1 }, limits); });
  // Last column of A against first column of B: adjacent ground, so the step
  // between them should be no worse than the step INSIDE either tile.
  let across = 0, within = 0;
  for (let y = 0; y < TILE_PX; y++) {
    const ia = (y * TILE_PX + TILE_PX - 1) * 4;
    const ib = (y * TILE_PX) * 4;
    const iaPrev = (y * TILE_PX + TILE_PX - 2) * 4;
    for (let c = 0; c < 3; c++) {
      across += Math.abs(pa[ia + c] - pb[ib + c]);
      within += Math.abs(pa[ia + c] - pa[iaPrev + c]);
    }
  }
  console.log(`junta z${z}: salto entre teselas ${(across / (TILE_PX * 3)).toFixed(2)} · salto interno ${(within / (TILE_PX * 3)).toFixed(2)}`);
}

console.log(`\ncanon en caché: ${cache.map.size} teselas · ${(cache.bytes / 1e6).toFixed(0)} MB`);
console.log(`celdas canon por tesela: z10=${canonCellsPerTile(world, 10)} z18=${canonCellsPerTile(world, 18)}`);
writeFileSync(`${OUT}/escalera.txt`, rows.join('\n') + '\n');

// --- mosaics --------------------------------------------------------------
// The only honest seam test is the picture: four tiles side by side, at every
// level worth looking at. A join that survives this survives the gesture.
import { createCanvas as mkCanvas } from '@napi-rs/canvas';
for (const z of [8, 10, 12, 14, 16, 18]) {
  const base = tileAtWorld(z, target.x, target.y);
  const m = mkCanvas(512, 512);
  const mctx = m.getContext('2d');
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const k = { z, tx: base.tx + dx, ty: base.ty + dy };
      const c = mkCanvas(TILE_PX, TILE_PX);
      const cx = c.getContext('2d') as unknown as Ctx;
      if (z >= SAT_DEEP_Z && satelliteDeepSupported(world, z)) {
        renderSatelliteDeepTile(world, geo, cache, cx, k, { layers: {}, density: 1 }, limits);
      } else {
        renderSatelliteShallowTile(world, unshaded, cx, k);
      }
      mctx.drawImage(c, dx * TILE_PX, dy * TILE_PX);
    }
  }
  writeFileSync(`${OUT}/mosaico-z${String(z).padStart(2, '0')}.png`, m.toBuffer('image/png'));
  console.log(`mosaico z${z} escrito`);
}

// The same ladder over MOUNTAIN country: relief is the thing that has to read
// there, and a coastal plain proves nothing about it.
for (const z of [8, 12, 16]) {
  const base = tileAtWorld(z, highest.x, highest.y);
  const m = mkCanvas(512, 512);
  const mctx = m.getContext('2d');
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const k = { z, tx: base.tx + dx, ty: base.ty + dy };
      const c = mkCanvas(TILE_PX, TILE_PX);
      const cx = c.getContext('2d') as unknown as Ctx;
      if (z >= SAT_DEEP_Z && satelliteDeepSupported(world, z)) {
        renderSatelliteDeepTile(world, geo, cache, cx, k, { layers: {}, density: 1 }, limits);
      } else {
        renderSatelliteShallowTile(world, unshaded, cx, k);
      }
      mctx.drawImage(c, dx * TILE_PX, dy * TILE_PX);
    }
  }
  writeFileSync(`${OUT}/sierra-z${String(z).padStart(2, '0')}.png`, m.toBuffer('image/png'));
  console.log(`sierra z${z} escrita`);
}
