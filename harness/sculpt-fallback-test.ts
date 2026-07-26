// The renderer that cannot fail — proved to actually draw something.
// A safety net nobody has ever seen work is not a safety net.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { drawSculptFallback } from '../src/engines/worldgen/sculpt/fallback';
import { BIOME_COLORS } from '../src/engines/worldgen/core/render';
import { BIOME_COUNT } from '../src/engines/worldgen/core/types';

const world = getWorld({ seed: 'monstruo', width: 1024 });
const palette: [number, number, number][] = [];
for (let i = 0; i < BIOME_COUNT; i++) {
  const c = BIOME_COLORS[i] ?? [128, 128, 128];
  palette.push([c[0] / 255, c[1] / 255, c[2] / 255]);
}

mkdirSync('harness/out', { recursive: true });
const W = 1000, H = 640;
const canvas = createCanvas(W, H);
const t0 = Date.now();
const ok = drawSculptFallback(canvas as unknown as HTMLCanvasElement, {
  world,
  palette,
  view: { x: 560, y: 380, w: 200, h: 128 },
  brush: { x: 640, y: 430, r: 14 },
  contourKm: 0.25,
  shade: 0.85,
});
const ms = Date.now() - t0;

const ctx = canvas.getContext('2d');
const px = ctx.getImageData(0, 0, W, H).data;
let black = 0, uniform = 0;
const first = [px[0], px[1], px[2]];
const seen = new Set<number>();
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  if (px[o] < 6 && px[o + 1] < 6 && px[o + 2] < 6) black++;
  if (px[o] === first[0] && px[o + 1] === first[1] && px[o + 2] === first[2]) uniform++;
  if (i % 37 === 0) seen.add((px[o] >> 3 << 10) | (px[o + 1] >> 3 << 5) | (px[o + 2] >> 3));
}
writeFileSync('harness/out/sculpt-fallback.png', canvas.toBuffer('image/png'));

console.log(`dibujado: ${ok ? 'sí' : 'NO'} en ${ms} ms (${W}×${H})`);
console.log(`negro puro:      ${((black / (W * H)) * 100).toFixed(2)} %`);
console.log(`de un solo tono: ${((uniform / (W * H)) * 100).toFixed(2)} %`);
console.log(`colores distintos: ${seen.size}`);

const checks: [string, boolean][] = [
  ['dibuja', ok],
  ['no es una pantalla negra', black / (W * H) < 0.02],
  ['no es un rectángulo liso', uniform / (W * H) < 0.5],
  ['tiene relieve y biomas (>60 tonos)', seen.size > 60],
  ['es interactivo (<120 ms)', ms < 120],
];
console.log();
for (const [n, p] of checks) console.log(`${p ? '·' : '✗'} ${n}`);
