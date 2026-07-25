import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { applyEdits, type WorldEdit } from '../src/engines/worldgen/core/edits';
import { Biome } from '../src/engines/worldgen/core/types';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const w = getWorld({ seed: 'monstruo', width: 1024 });
const W = w.width, H = w.height;
// Find the emptiest ocean square to paint into.
let bx = 0, by = 0, bestSea = -1;
for (let y = 90; y < H - 90; y += 6) for (let x = 0; x < W; x += 6) {
  let sea = 0;
  for (let dy = -26; dy <= 26; dy += 3) for (let dx = -40; dx <= 40; dx += 3) {
    const yy = y + dy; if (yy < 0 || yy >= H) continue;
    if (w.elevation[yy*W + ((x+dx+W)%W)] <= 0) sea++;
  }
  if (sea > bestSea) { bestSea = sea; bx = x; by = y; }
}
console.log(`océano abierto en (${bx}, ${by})`);
const view = { x: bx - 62, y: by - 31, w: 124, h: 62 };
const OW = 1300, OH = 650;
const shot = (file: string) => {
  const c = createCanvas(OW, OH);
  renderCartography(w, c.getContext('2d') as unknown as Ctx, {
    theme: themeById('wonder'), width: OW, height: OH, view,
    layers: { frame: false, compass: false, scaleBar: false },
  });
  writeFileSync(file, c.toBuffer('image/png'));
};
mkdirSync('harness/out', { recursive: true });
shot('harness/out/paint-before.png');

// An archipelago drawn by hand: a main island with a mountain spine, a bay bitten
// out of it, a second islet, a desert patch, a river and a ruin.
const edits: WorldEdit[] = [
  { kind: 'land', op: 'land', stroke: { pts: [{x:bx-24,y:by+6},{x:bx-6,y:by-2},{x:bx+12,y:by+2},{x:bx+26,y:by+10}], radius: 13, strength: 1, softness: 0.45 } },
  { kind: 'terrain', op: 'raise', stroke: { pts: [{x:bx-14,y:by+2},{x:bx+2,y:by},{x:bx+16,y:by+6}], radius: 5, strength: 1 } },
  { kind: 'land', op: 'sea', stroke: { pts: [{x:bx+2,y:by+12}], radius: 7, strength: 1, softness: 0.6 } },
  { kind: 'land', op: 'land', stroke: { pts: [{x:bx+40,y:by-10}], radius: 6, strength: 1, softness: 0.4 } },
  { kind: 'biome', biome: Biome.Erg, stroke: { pts: [{x:bx-22,y:by+8}], radius: 8, strength: 1 } },
  { kind: 'river', pts: [{x:bx+2,y:by+1},{x:bx+8,y:by+6},{x:bx+12,y:by+11}], width: 2 },
  { kind: 'marker', marker: 'ruin', x: bx+16, y: by+6, ruin: 'tower', name: 'La Aguja' },
  { kind: 'marker', marker: 'settlement', x: bx-20, y: by+7, rank: 'town', name: 'Puerto Nuevo', population: 3400 },
];
const t0 = Date.now();
const res = applyEdits(w, edits);
console.log(`${edits.length} ediciones en ${Date.now()-t0} ms; ríos ${res.rivers.length}, marcadores ${res.markers.length}`);
let land = 0; for (let i=0;i<W*H;i++) if (w.elevation[i]>0) land++;
console.log(`tierra total ahora ${land}`);
shot('harness/out/paint-after.png');
console.log('escritos paint-before.png y paint-after.png');
