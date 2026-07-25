// Bench: emit the exact texture the 3D 'carta' skin uses, plus a heightmap,
// so the stylized 3D look can be verified in a real WebGL context.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { encodePng } from './png';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const seed = process.argv[2] || 'monstruo';
const size = Number(process.argv[3] || 2048);
const world = getWorld({ seed, width: 1024 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
const canvas = createCanvas(size, size / 2);
const ctx = canvas.getContext('2d') as unknown as Ctx;
renderCartography(world, ctx, {
  theme: themeById(process.env.THEME || 'wonder'),
  width: size, height: size / 2,
  geography,
  // Same preset as getCartoTexture(): no baked shading, no furniture, no labels.
  layers: { shading: false, frame: false, compass: false, scaleBar: false,
            graticule: false, labels: false, borders: false },
});
mkdirSync('harness/out', { recursive: true });
writeFileSync('harness/out/skin-carta.png', canvas.toBuffer('image/png'));

// heightmap, 16-bit-ish packed into R+G for precision
const { width: W, height: H, elevation } = world;
let min = Infinity, max = -Infinity;
for (let i = 0; i < elevation.length; i++) { if (elevation[i] < min) min = elevation[i]; if (elevation[i] > max) max = elevation[i]; }
const px = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < elevation.length; i++) {
  const t = (elevation[i] - min) / (max - min);
  const v = Math.round(t * 65535);
  px[i*4] = v >> 8; px[i*4+1] = v & 255; px[i*4+2] = 0; px[i*4+3] = 255;
}
writeFileSync('harness/out/skin-height.png', encodePng(W, H, px));
writeFileSync('harness/out/skin-meta.json', JSON.stringify({ W, H, min, max }));
console.log(`ok ${size}x${size/2}  elev ${min.toFixed(2)}..${max.toFixed(2)} km`);
