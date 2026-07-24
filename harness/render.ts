// Dev harness: generate worlds and dump PNGs for visual iteration.
// Usage: npx tsx harness/render.ts [seed] [width] [modes...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { renderComposite, renderBase } from '../src/engines/worldgen/core/render';
import { DEFAULT_PARAMS, type ViewMode, type WorldParams } from '../src/engines/worldgen/core/types';
import { encodePng } from './png';

const seed = process.argv[2] || 'harness-1';
const width = Number(process.argv[3] || 1024);
const modes = (process.argv.slice(4).length ? process.argv.slice(4) : ['atlas', 'elevation', 'precipitation', 'plates']) as ViewMode[];

const overrides: Partial<WorldParams> = process.env.PARAMS ? JSON.parse(process.env.PARAMS) : {};
const params: WorldParams = { ...DEFAULT_PARAMS, seed, width, ...overrides };

console.log(`Generating "${seed}" at ${width}×${width / 2}…`);
const t0 = Date.now();
let lastStage = '';
const world = generateWorld(params, (stage, overall) => {
  if (stage !== lastStage) {
    console.log(`  [${(Date.now() - t0) / 1000}s] ${stage} (${Math.round(overall * 100)}%)`);
    lastStage = stage;
  }
});
console.log(`Done in ${(Date.now() - t0) / 1000}s — rivers: ${world.rivers.length}, landmarks: ${world.landmarks.length}`);

mkdirSync('harness/out', { recursive: true });
for (const mode of modes) {
  const px = mode === 'atlas' ? renderComposite(world, mode, true) : renderBase(world, mode);
  // Landmarks as simple dots on atlas for the harness.
  if (mode === 'atlas') {
    for (const lm of world.landmarks) {
      const color = lm.type === 'volcano' ? [200, 40, 30] : lm.type === 'cave' ? [40, 30, 30] : lm.type === 'waterfall' ? [240, 250, 255] : lm.type === 'gorge' ? [160, 90, 40] : [230, 140, 180];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = (lm.x + dx + world.width) % world.width;
        const y = lm.y + dy;
        if (y < 0 || y >= world.height) continue;
        const o = (y * world.width + x) * 4;
        px[o] = color[0]; px[o + 1] = color[1]; px[o + 2] = color[2]; px[o + 3] = 255;
      }
    }
  }
  const file = `harness/out/${seed}-${mode}.png`;
  writeFileSync(file, encodePng(world.width, world.height, px));
  console.log(`  wrote ${file}`);
}

// Quick stats to sanity-check realism.
const { elevation, biome, temperature, precipitation } = world;
let land = 0, maxE = -99, minE = 99;
const biomeCounts = new Map<number, number>();
for (let i = 0; i < elevation.length; i++) {
  if (elevation[i] > 0) land++;
  if (elevation[i] > maxE) maxE = elevation[i];
  if (elevation[i] < minE) minE = elevation[i];
  biomeCounts.set(biome[i], (biomeCounts.get(biome[i]) || 0) + 1);
}
let tMin = 99, tMax = -99, pMax = 0;
for (let i = 0; i < temperature.length; i++) {
  if (temperature[i] < tMin) tMin = temperature[i];
  if (temperature[i] > tMax) tMax = temperature[i];
  if (precipitation[i] > pMax) pMax = precipitation[i];
}
console.log(`land: ${(100 * land / elevation.length).toFixed(1)}%  elev: ${minE.toFixed(2)}..${maxE.toFixed(2)} km  T: ${tMin.toFixed(0)}..${tMax.toFixed(0)}°C  P max: ${pMax.toFixed(0)}mm`);
const names = ['Ocean','Lake','IceCap','Tundra','Boreal','TempForest','TempRain','Grass','Shrub','Savanna','TropForest','TropRain','Desert','ColdDesert','Alpine','Glacier','Beach','SaltFlat'];
console.log('biomes: ' + [...biomeCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>`${names[k]}:${(100*v/elevation.length).toFixed(1)}%`).join(' '));
