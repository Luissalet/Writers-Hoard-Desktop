// Ruins should land on sites the world made valuable and nobody is using.
// This prints where each one came from and draws the busiest corner of the map.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography } from '../src/engines/worldgen/core/settlements';
import { RUIN_SITE_ES, RUIN_KIND_ES, RUIN_CONDITION_ES } from '../src/engines/worldgen/core/ruins';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/EBGaramond-Variable.ttf', 'EB Garamond');

const w = getWorld({ seed: 'monstruo', width: 1024 });
const t0 = Date.now();
const geo = buildHumanGeography(w);
console.log(`geografía humana en ${Date.now() - t0} ms`);
console.log(`${geo.settlements.length} asentamientos, ${geo.ruins.length} ruinas, ${geo.landforms.length} accidentes, ${geo.features.length} topónimos`);

const tally = <T extends string>(list: T[]) => {
  const m = new Map<T, number>();
  for (const k of list) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
console.log('\npor tipo:');
for (const [k, n] of tally(geo.ruins.map((r) => r.kind))) console.log(`  ${RUIN_KIND_ES[k].padEnd(20)} ${n}`);
console.log('por emplazamiento:');
for (const [k, n] of tally(geo.ruins.map((r) => r.site))) console.log(`  ${RUIN_SITE_ES[k].padEnd(20)} ${n}`);
console.log('por estado:');
for (const [k, n] of tally(geo.ruins.map((r) => r.condition))) console.log(`  ${RUIN_CONDITION_ES[k].padEnd(24)} ${n}`);

// How far is each ruin from the nearest living town? If this is small the
// "nobody is using it" filter is not working.
let minD = Infinity, sumD = 0;
for (const r of geo.ruins) {
  let best = Infinity;
  for (const s of geo.settlements) {
    let dx = Math.abs(s.x - r.x); if (dx > w.width / 2) dx = w.width - dx;
    best = Math.min(best, Math.hypot(dx, s.y - r.y));
  }
  minD = Math.min(minD, best); sumD += best;
}
console.log(`\ndistancia al asentamiento más cercano: mín ${minD.toFixed(1)} celdas, media ${(sumD / geo.ruins.length).toFixed(1)}`);

console.log('\nmuestra:');
for (const r of geo.ruins.slice(0, 12)) {
  console.log(`  ${r.name.padEnd(30)} ${RUIN_KIND_ES[r.kind].padEnd(20)} ${RUIN_SITE_ES[r.site].padEnd(20)} ${RUIN_CONDITION_ES[r.condition]}`);
}

const coastal = geo.features.filter((f) => ['cape', 'bay', 'strait', 'valley', 'gorge', 'marsh'].includes(f.kind));
console.log(`\n${coastal.length} topónimos de accidentes; muestra:`);
for (const f of coastal.slice(0, 14)) console.log(`  ${f.kind.padEnd(10)} ${f.name}`);

mkdirSync('harness/out', { recursive: true });
function shot(file: string, view: { x: number; y: number; w: number; h: number }, OW: number, OH: number) {
  const c = createCanvas(OW, OH);
  renderCartography(w, c.getContext('2d') as unknown as Ctx, {
    theme: themeById('wonder'), width: OW, height: OH, view, geography: geo,
    layers: { frame: false, compass: false, scaleBar: false },
  });
  writeFileSync(file, c.toBuffer('image/png'));
}
// The window with the most ruins in it.
let best = { x: 0, y: 0, n: -1 };
for (let y = 0; y < w.height - 110; y += 30) for (let x = 0; x < w.width; x += 30) {
  let n = 0;
  for (const r of geo.ruins) {
    let dx = Math.abs(r.x - (x + 100)); if (dx > w.width / 2) dx = w.width - dx;
    if (dx < 100 && Math.abs(r.y - (y + 55)) < 55) n++;
  }
  if (n > best.n) best = { x, y, n };
}
console.log(`\nventana con más ruinas: (${best.x}, ${best.y}) con ${best.n}`);
shot('harness/out/ruins-zoom.png', { x: best.x, y: best.y, w: 200, h: 110 }, 1560, 858);
console.log('escrito ruins-zoom.png');
