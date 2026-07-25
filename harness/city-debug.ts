// Is that wide pale band the avenue ribbon, or a block that got inset out of
// existence? Overlay the centrelines and find out instead of guessing.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { generateCity, DEFAULT_CITY } from '../src/engines/worldgen/city/generate';
import { renderCity } from '../src/engines/worldgen/city/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import { area, centroid } from '../src/engines/worldgen/city/geometry';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const plan = generateCity({ ...DEFAULT_CITY, seed: 'puerto-vado', size: 26, river: true, coast: true });
const OUT = 1100;
const canvas = createCanvas(OUT, OUT);
const ctx = canvas.getContext('2d');
renderCity(plan, ctx as unknown as Ctx, { theme: themeById('wonder'), width: OUT, height: OUT });

// Reproduce the renderer's transform so the overlay lands on the plan.
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const q of plan.patches) for (const v of q.shape) {
  x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y);
}
console.log(`plan bbox ${(x1-x0).toFixed(0)} x ${(y1-y0).toFixed(0)} unidades, radio ${plan.radius.toFixed(0)}`);
console.log(`escala aprox ${(OUT / (x1 - x0)).toFixed(2)} px por unidad`);

// Empty inner patches: the suspects.
const empties = plan.patches.filter((q) => q.withinCity && !q.buildings.length && !q.courts.length);
console.log(`distritos interiores vacíos: ${empties.length} de ${plan.patches.filter(q=>q.withinCity).length}`);
for (const q of empties.slice(0, 8)) {
  console.log(`  ${q.ward.padEnd(14)} área ${area(q.shape).toFixed(0)} en (${centroid(q.shape).x.toFixed(0)}, ${centroid(q.shape).y.toFixed(0)})`);
}
mkdirSync('harness/out', { recursive: true });
writeFileSync('harness/out/city-debug.png', canvas.toBuffer('image/png'));

// Measure the avenue on screen: walk perpendicular to a mid-segment and count
// contiguous paper-coloured pixels. Guessing widths from a screenshot is how the
// last three "too wide" judgements were made.
const img = ctx.getImageData(0, 0, OUT, OUT);
const at = (x: number, y: number) => {
  const i = ((y | 0) * OUT + (x | 0)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
// Renderer transform: read it back by matching a known plan point to the canvas.
// Instead, re-derive: the renderer fits `plan.radius * 2 * pad` — probe empirically.
function probe(name: string, paths: { x: number; y: number }[][]) {
  for (const [k, path] of paths.entries()) {
    if (path.length < 4) continue;
    const a = path[Math.floor(path.length * 0.45)], b = path[Math.floor(path.length * 0.55)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    // Convert plan → screen with the scale the renderer used.
    // The renderer's own transform, not a guess: extent = radius*(1+margin)*2.
    const sc = OUT / (plan.radius * 1.35 * 2);
    const cx = OUT / 2 + (a.x - plan.center.x) * sc, cy = OUT / 2 + (a.y - plan.center.y) * sc;
    if (cx < 5 || cy < 5 || cx > OUT - 5 || cy > OUT - 5) continue;
    const base = at(cx, cy);
    let w = 0;
    for (let t = -40; t <= 40; t++) {
      const c = at(cx + nx * t, cy + ny * t);
      if (Math.abs(c[0] - base[0]) < 9 && Math.abs(c[1] - base[1]) < 9 && Math.abs(c[2] - base[2]) < 9) w++;
    }
    console.log(`  ${name}[${k}] banda contigua ≈ ${w} px en (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
  }
}
probe('avenida', plan.mainStreets);
probe('calle', plan.streets.slice(0, 3));
