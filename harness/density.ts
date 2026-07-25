import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');
const world = getWorld({ seed: 'monstruo', width: 1024 });
const theme = themeById('wonder');
const W = 1200, H = 600;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d') as unknown as Ctx;
// Centre on a land-rich point so the count reflects density, not luck.
const cx = 170, cy = 300;
console.log('zoom   vista(celdas)   símbolos   ms   símbolos/Mpx');
for (const z of [1, 2, 3, 4.5, 6, 9, 14]) {
  const w = world.width / z, h = w * (H / W);
  const view = { x: cx - w/2, y: Math.max(0, Math.min(world.height - h, cy - h/2)), w, h };
  const t0 = performance.now();
  const r = renderCartography(world, ctx, { theme, width: W, height: H, view });
  const ms = performance.now() - t0;
  console.log(`${String(z).padStart(4)}   ${w.toFixed(0).padStart(6)}x${h.toFixed(0)}   ${String(r.symbolCount).padStart(7)}  ${ms.toFixed(0).padStart(4)}   ${(r.symbolCount/(W*H/1e6)).toFixed(0)}`);
}
