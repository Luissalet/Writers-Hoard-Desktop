// Bench: render the cartographic view to a PNG with @napi-rs/canvas.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { renderCartography, DEFAULT_LAYERS } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const seed = process.argv[2] || 'monstruo';
const themeId = process.argv[3] || 'wonder';
const outW = Number(process.argv[4] || 1600);
const gridW = Number(process.env.GRID || 1024);
const zoom = Number(process.env.ZOOM || 0);

const world = getWorld({ seed, width: gridW });
const theme = themeById(themeId);
const tg = Date.now();
const geography = process.env.NOGEO ? undefined : buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
if (geography) console.log(`geography in ${((Date.now()-tg)/1000).toFixed(1)}s — ${geography.settlements.length} settlements, ${geography.roads.length} roads`);

let view = { x: 0, y: 0, w: world.width, h: world.height };
if (zoom > 0) {
  const w = world.width / zoom, h = world.height / zoom;
  const cx = Number(process.env.CX || world.width * 0.18);
  const cy = Number(process.env.CY || world.height * 0.55);
  view = { x: cx - w / 2, y: cy - h / 2, w, h };
}

const outH = Math.round(outW * (view.h / view.w));
const canvas = createCanvas(outW, outH);
const ctx = canvas.getContext('2d') as unknown as Ctx;

const t0 = Date.now();
const res = renderCartography(world, ctx, {
  theme,
  width: outW,
  height: outH,
  view,
  density: Number(process.env.DENSITY || 1),
  geography,
  title: process.env.TITLE || seed,
  subtitle: process.env.SUBTITLE || 'Cartografía del mundo conocido',
  layers: { ...DEFAULT_LAYERS, ...(process.env.LAYERS ? JSON.parse(process.env.LAYERS) : {}) },
});
console.log(`rendered ${outW}x${outH} in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${res.symbolCount} symbols`);

mkdirSync('harness/out', { recursive: true });
const file = process.env.OUT || `harness/out/carto-${themeId}${zoom ? '-z' + zoom : ''}.png`;
writeFileSync(file, canvas.toBuffer('image/png'));
console.log('wrote ' + file);
