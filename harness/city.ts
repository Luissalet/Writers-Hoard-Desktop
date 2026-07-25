import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { generateCity, DEFAULT_CITY } from '../src/engines/worldgen/city/generate';
import { renderCity } from '../src/engines/worldgen/city/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const seed = process.argv[2] || 'villa-1';
const size = Number(process.argv[3] || 18);
const out = Number(process.argv[4] || 1100);
const t0 = Date.now();
const plan = generateCity({ ...DEFAULT_CITY, seed, size,
  river: process.env.RIVER === '1', coast: process.env.COAST === '1',
  walls: process.env.WALLS !== '0' });
const nb = plan.patches.reduce((a,p)=>a+p.buildings.length,0);
console.log(`plan in ${Date.now()-t0}ms — ${plan.patches.length} patches, ${nb} buildings, ${plan.gates.length} gates, ${plan.towers.length} towers`);
const canvas = createCanvas(out, out);
const ctx = canvas.getContext('2d') as unknown as Ctx;
const t1 = Date.now();
renderCity(plan, ctx, { theme: themeById(process.env.THEME || 'wonder'), width: out, height: out });
console.log(`render in ${Date.now()-t1}ms`);
mkdirSync('harness/out', { recursive: true });
const f = process.env.OUT || `harness/out/city-${seed}.png`;
writeFileSync(f, canvas.toBuffer('image/png'));
console.log('wrote ' + f);
