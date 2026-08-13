// ============================================================================
// SONDA VISUAL: la mancha urbana en el hueco z9→z14
// ============================================================================
// Renderiza la tesela satélite honda que contiene una ciudad, a tres niveles
// del hueco donde antes no había ni punto ni tejados, y escribe los PNG para
// MIRARLOS (lección #31): la mancha tiene que leerse como pueblo, crecer al
// acercarse, y ceder el sitio a los tejados cuando éstos ya miden 1,4 px.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import {
  MAX_SAT_TILE_Z, renderSatelliteDeepTile, satelliteDeepSupported, satelliteTileSpec,
} from '../src/engines/worldgen/region/satelliteTile';
import { makeCanonCache } from '../src/engines/worldgen/region/deepTile';
import { tileCountX, tileCountY } from '../src/engines/worldgen/cartography/tiles';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 'consume-probe', width: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);
const town = geography.settlements.find((s) => s.rank === 'town' || s.rank === 'city')
  ?? geography.settlements[0];
console.log(`pueblo: ${town.name} (${town.rank}) en (${town.x},${town.y})`);

const cache = makeCanonCache();

// ¿Dónde pone el canon el sitio 'town' de esta ciudad? Genera la supertesela
// que cubre su celda y lee sus places con coordenadas de mundo.
{
  const c2 = createCanvas(8, 8);
  const r2 = renderSatelliteDeepTile(
    world, geography, cache, c2.getContext('2d') as never,
    { z: 9, tx: Math.floor(((town.x + 0.5) / world.width) * tileCountX(9)),
      ty: Math.max(0, Math.min(tileCountY(9) - 1, Math.floor(((town.y + 0.5) / world.height) * tileCountY(9)))) },
    { layers: { rivers: false, roads: false, fields: false }, density: 1 },
    { cap: 64, bytes: 512 * 1024 * 1024 },
  );
  console.log('places de la z9 que cubre la celda de la ciudad:');
  for (const p of r2.places) console.log(`  ${p.kind} ${p.name} en mundo (${p.worldX.toFixed(2)}, ${p.worldY.toFixed(2)})`);
}
for (const z of [10, 12, 13]) {
  if (z > MAX_SAT_TILE_Z || !satelliteDeepSupported(world, z)) { console.log(`z${z}: no soportado`); continue; }
  // El canon emite el pueblo en la ESQUINA de su celda — toSheet(s.x, s.y)
  // sin +0,5 — así que la tesela correcta sale del floor exacto sobre s.x.
  const tx = Math.max(0, Math.floor((town.x / world.width) * tileCountX(z)));
  const ty = Math.max(0, Math.min(tileCountY(z) - 1, Math.floor((town.y / world.height) * tileCountY(z))));
  // 2x2 alrededor de la esquina del pueblo: el sitio cae en el vértice de
  // cuatro teselas y una sola enseña un cuarto de mancha en su pixel (0,0).
  const canvas = createCanvas(512, 512);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const t0 = performance.now();
  let res = { places: [] as { kind: string; name: string }[], generated: 0 };
  for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const sub = createCanvas(256, 256);
    const r2 = renderSatelliteDeepTile(
      world, geography, cache, sub.getContext('2d') as never,
      { z, tx: Math.max(0, tx + di), ty: Math.max(0, Math.min(tileCountY(z) - 1, ty + dj)) },
      { layers: { rivers: true, roads: true, fields: true }, density: 1 },
      { cap: 64, bytes: 512 * 1024 * 1024 },
    );
    if (di === 0 && dj === 0) res = r2 as never;
    ctx.drawImage(sub as never, (di + 1) * 256, (dj + 1) * 256);
  }
  console.log(`  sitios en la tesela: ${res.places.map((p) => `${p.kind}:${p.name}`).slice(0, 10).join(' · ') || 'NINGUNO'}`);
  const spec = satelliteTileSpec(world, { z, tx, ty });
  console.log(`z${z}: ${Math.round(performance.now() - t0)} ms · ${res.generated} superteselas nuevas · ${(spec.metresPerCell ?? 0)} m/celda`);
  writeFileSync(`/tmp/stain-z${z}.png`, canvas.toBuffer('image/png'));
}
console.log('escritos /tmp/stain-z10.png /tmp/stain-z12.png /tmp/stain-z13.png');
