// Verify the edit layer: strokes change the world, the changes are consequential
// (a raised stroke becomes land AND gets a sensible biome), and replaying the
// same list twice gives an identical world.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { applyEdits, serializeEdits, deserializeEdits, type WorldEdit } from '../src/engines/worldgen/core/edits';
import { Biome } from '../src/engines/worldgen/core/types';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const seed = 'monstruo';
const w0 = getWorld({ seed, width: 1024 });
const W = w0.width, H = w0.height;

// An island painted into open ocean, a bay bitten out of a coast, a desert
// painted over grassland, a hand-drawn river, a ruin and a label.
const cx = 640, cy = 250;
const edits: WorldEdit[] = [
  { kind: 'land', op: 'land', stroke: { pts: [{x:cx,y:cy},{x:cx+22,y:cy+10},{x:cx+34,y:cy+2}], radius: 11, strength: 1, softness: 0.5 } },
  { kind: 'terrain', op: 'raise', stroke: { pts: [{x:cx+14,y:cy+6}], radius: 7, strength: 0.9 } },
  { kind: 'biome', biome: Biome.Erg, stroke: { pts: [{x:200,y:300},{x:240,y:315}], radius: 14, strength: 1 } },
  { kind: 'river', pts: [{x:cx+30,y:cy+4},{x:cx+18,y:cy+14},{x:cx+4,y:cy+18}], width: 2 },
  { kind: 'marker', marker: 'ruin', x: cx+16, y: cy+4, ruin: 'tower', name: 'La Aguja' },
  { kind: 'marker', marker: 'settlement', x: cx+30, y: cy+2, rank: 'town', name: 'Puerto Nuevo', population: 3400 },
  { kind: 'label', x: cx+16, y: cy-14, text: 'Islas Pintadas', style: 'region', size: 15 },
];

const count = (w: typeof w0) => {
  let land = 0; const b = new Map<number, number>();
  for (let i = 0; i < W*H; i++) { if (w.elevation[i] > 0) { land++; b.set(w.biome[i], (b.get(w.biome[i])??0)+1); } }
  return { land, erg: b.get(Biome.Erg) ?? 0, mang: b.get(Biome.Mangrove) ?? 0 };
};
const before = count(w0);
const t0 = Date.now();
const res = applyEdits(w0, edits);
const ms = Date.now() - t0;
const after = count(w0);
console.log(`aplicar ${edits.length} ediciones: ${ms} ms`);
console.log(`  tierra ${before.land} → ${after.land}  (${after.land - before.land} celdas nuevas)`);
console.log(`  erg    ${before.erg} → ${after.erg}`);
console.log(`  ríos pintados ${res.rivers.length}, marcadores ${res.markers.length}, etiquetas ${res.labels.length}`);
console.log(`  terreno alterado: ${res.terrainChanged}`);

// Determinism: same list on a fresh world gives byte-identical elevation.
const w1 = getWorld({ seed, width: 1024 });
applyEdits(w1, deserializeEdits(serializeEdits(edits)));
let diff = 0;
for (let i = 0; i < W*H; i++) if (w1.elevation[i] !== w0.elevation[i]) diff++;
console.log(`  reproducible tras serializar: ${diff === 0 ? 'sí' : `NO (${diff} celdas)`}`);
console.log(`  tamaño serializado: ${serializeEdits(edits).length} bytes`);

// Render the painted region so the result can be seen.
mkdirSync('harness/out', { recursive: true });
const OW = 1300, OH = 650;
const canvas = createCanvas(OW, OH);
const ctx = canvas.getContext('2d') as unknown as Ctx;
renderCartography(w0, ctx, {
  theme: themeById('wonder'), width: OW, height: OH,
  view: { x: cx - 70, y: cy - 40, w: 180, h: 90 },
  layers: { frame: false, compass: false, scaleBar: false },
});
writeFileSync('harness/out/paint-test.png', canvas.toBuffer('image/png'));
console.log('  harness/out/paint-test.png');
