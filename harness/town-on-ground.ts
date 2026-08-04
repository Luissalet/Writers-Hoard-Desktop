// ¿Se ve el plano de la ciudad sobre el terreno, en su sitio y a su escala?
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { makeCanonCache, CANON_CACHE_CAP, CANON_CACHE_BYTES } from '../src/engines/worldgen/region/deepTile';
import { renderSatelliteDeepTile, satelliteDeepSupported } from '../src/engines/worldgen/region/satelliteTile';
import { TILE_PX, tileCountX } from '../src/engines/worldgen/cartography/tiles';
import { kmPerWorldCell } from '../src/engines/worldgen/region/terrain';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

mkdirSync('harness/out/city', { recursive: true });
const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
const cache = makeCanonCache();
const limits = { cap: CANON_CACHE_CAP, bytes: CANON_CACHE_BYTES };
const kmCell = kmPerWorldCell(world);

const s = [...geo.settlements].sort((a, b) => b.population - a.population)[0];
console.log(`${s.name} · ${s.rank} · ${s.population} hab · río ${s.river} · puerto ${s.port}`);

for (const z of [15, 16, 17]) {
  if (!satelliteDeepSupported(world, z)) continue;
  const cells = world.width / tileCountX(z);
  const base = { z, tx: Math.floor(s.x / cells), ty: Math.floor(s.y / cells) };
  const N = 3;
  const m = createCanvas(TILE_PX * N, TILE_PX * N);
  const mctx = m.getContext('2d');
  const t = Date.now();
  for (let dy = 0; dy < N; dy++) {
    for (let dx = 0; dx < N; dx++) {
      const c = createCanvas(TILE_PX, TILE_PX);
      renderSatelliteDeepTile(world, geo, cache, c.getContext('2d') as unknown as Ctx,
        { z, tx: base.tx + dx - 1, ty: base.ty + dy - 1 }, { layers: {}, density: 1 }, limits);
      mctx.drawImage(c, dx * TILE_PX, dy * TILE_PX);
    }
  }
  const ground = cells * kmCell * 1000 * N;
  console.log(`z${z} · ${(ground / 1000).toFixed(2)} km de lado · ${(ground / (TILE_PX * N)).toFixed(2)} m/px · ${Date.now() - t} ms`);
  writeFileSync(`harness/out/city/suelo-z${z}.png`, m.toBuffer('image/png'));
}
