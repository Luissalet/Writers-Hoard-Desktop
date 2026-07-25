// Do the landform detectors find real capes, bays, straits and passes?
// Counts and timings tell you nothing about correctness, so this also draws every
// hit onto the map to be looked at.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { findLandforms, type LandformKind } from '../src/engines/worldgen/core/landforms';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const w = getWorld({ seed: 'monstruo', width: 1024 });
const t0 = Date.now();
const lf = findLandforms(w);
const ms = Date.now() - t0;

const byKind = new Map<LandformKind, number>();
for (const f of lf) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
console.log(`${lf.length} accidentes en ${ms} ms`);
for (const [k, v] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${v}`);

const COLOR: Record<string, string> = {
  cape: '#d62828', bay: '#1d3557', fjord: '#4361ee', strait: '#7209b7',
  isthmus: '#f77f00', peninsula: '#006d77', delta: '#2a9d8f',
  pass: '#8b1e3f', valley: '#3a5a40', gorge: '#582f0e',
};

mkdirSync('harness/out', { recursive: true });
function shot(file: string, view: { x: number; y: number; w: number; h: number }, OW: number, OH: number) {
  const c = createCanvas(OW, OH);
  const ctx = c.getContext('2d');
  renderCartography(w, ctx as unknown as Ctx, {
    theme: themeById('wonder'), width: OW, height: OH, view,
    layers: { frame: false, compass: false, scaleBar: false, labels: false },
  });
  const scale = OW / view.w;
  ctx.font = 'bold 11px Lora';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of lf) {
    for (const shift of [-w.width, 0, w.width]) {
      const x = (f.x + shift - view.x) * scale;
      const y = (f.y - view.y) * scale;
      if (x < -30 || y < -30 || x > OW + 30 || y > OH + 30) continue;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = COLOR[f.kind] ?? '#000';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 2.6;
      const t = f.kind[0].toUpperCase() + (f.kind === 'fjord' ? 'j' : f.kind === 'gorge' ? 'g' : '');
      ctx.strokeText(t, x, y - 11);
      ctx.fillText(t, x, y - 11);
    }
  }
  writeFileSync(file, c.toBuffer('image/png'));
}

shot('harness/out/landforms-world.png', { x: 0, y: 0, w: w.width, h: w.height }, 1600, 800);
// A coast worth reading closely: pick the window with the most hits.
let best = { x: 0, y: 0, n: -1 };
for (let y = 0; y < w.height - 120; y += 40) for (let x = 0; x < w.width; x += 40) {
  let n = 0;
  for (const f of lf) {
    let dx = Math.abs(f.x - (x + 110)); if (dx > w.width / 2) dx = w.width - dx;
    if (dx < 110 && Math.abs(f.y - (y + 60)) < 60) n++;
  }
  if (n > best.n) best = { x, y, n };
}
console.log(`ventana más densa en (${best.x}, ${best.y}) con ${best.n}`);
shot('harness/out/landforms-zoom.png', { x: best.x, y: best.y, w: 220, h: 120 }, 1540, 840);
console.log('escritos landforms-world.png y landforms-zoom.png');
