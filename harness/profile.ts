// Where does a cartographic render actually spend its time?
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { renderPaper } from '../src/engines/worldgen/cartography/paper';
import { computeFields } from '../src/engines/worldgen/cartography/render';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { traceRidgeChains } from '../src/engines/worldgen/cartography/fields';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const W = Number(process.env.OW || 1600), H = W / 2;
const world = getWorld({ seed: 'monstruo', width: 1024 });
const theme = themeById('wonder');
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);

const t = (label: string, fn: () => void) => {
  const t0 = performance.now();
  fn();
  console.log(`  ${label.padEnd(34)} ${(performance.now() - t0).toFixed(0).padStart(6)} ms`);
  return performance.now() - t0;
};

console.log(`salida ${W}x${H}, mundo ${world.width}x${world.height}\n`);
t('computeFields (cacheado)', () => { computeFields(world); });
const paper = t('renderPaper', () => {
  renderPaper({ width: W, height: H, seed: 'x', theme });
});
const chains = t('traceRidgeChains', () => {
  const f = computeFields(world);
  traceRidgeChains(f.ridges, world.elevation, world.width, world.height, 5);
});

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d') as unknown as Ctx;
const full = t('renderCartography COMPLETO', () => {
  renderCartography(world, ctx, { theme, width: W, height: H, geography: geo });
});
// second call: everything cacheable is now warm
const again = t('renderCartography 2ª vez', () => {
  renderCartography(world, ctx, { theme, width: W, height: H, geography: geo });
});
const noSym = t('sin relieve ni bosques', () => {
  renderCartography(world, ctx, { theme, width: W, height: H, geography: geo,
    layers: { relief: false, forests: false } });
});
const noPaperNoSym = t('sin símbolos, mitad de tamaño', () => {
  renderCartography(world, ctx, { theme, width: W >> 1, height: H >> 1, geography: geo,
    layers: { relief: false, forests: false } });
});
console.log(`\nreparto aproximado: papel ${(100*paper/again).toFixed(0)}%  crestas ${(100*chains/again).toFixed(0)}%  símbolos ${(100*(again-noSym)/again).toFixed(0)}%`);
