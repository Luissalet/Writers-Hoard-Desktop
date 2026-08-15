// Una ciudad, grande, con su contexto encima. Para mirar un caso concreto.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { getGeography, cityParamsFor } from '../src/engines/worldgen/cartography/texture';
import { generateCity } from '../src/engines/worldgen/city/generate';
import { renderCity } from '../src/engines/worldgen/city/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
import { centroid, type V } from '../src/engines/worldgen/city/geometry';

try { GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora'); } catch { /**/ }

const world = getWorld();
const geo = await getGeography(world, 'full');
const names = (process.env.CIUDADES ?? 'Nasdial').split(',');
const S = 900;
const sheet = createCanvas(S * names.length, S);
const sc = sheet.getContext('2d');

for (const [k, name] of names.entries()) {
  const s = geo.settlements.find((x) => x.name === name);
  if (!s) { console.error(`no existe ${name}`); continue; }
  const p = cityParamsFor(world, s, geo);
  const plan = generateCity(p);
  // Encuadre por la EXTENSIÓN REAL del plano, no por `plan.radius`.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of plan.patches) if (q.withinCity) for (const v of q.shape) {
    x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y);
  }
  const reach = Math.max(x1 - x0, y1 - y0) / 2 * 1.35;
  console.log(`${name}: radio declarado ${plan.radius.toFixed(1)} · extensión real ${reach.toFixed(1)}`
    + ` · centro (${plan.center.x.toFixed(0)},${plan.center.y.toFixed(0)}) · muralla ${plan.wall?.length ?? 0} vértices`
    + ` · manzanas ${plan.patches.filter((q) => q.withinCity).length} · modo ${p.riverMode}`);

  const cell = createCanvas(S, S);
  const cx = cell.getContext('2d');
  renderCity(plan, cx as unknown as Ctx, {
    theme: themeById('wonder') ?? themeById('default')!, width: S, height: S,
    margin: Math.max(0.35, reach / Math.max(1, plan.radius) - 1),
  });
  const extent = plan.radius * (1 + Math.max(0.35, reach / Math.max(1, plan.radius) - 1)) * 2;
  const sk = S / extent;
  const ox = S / 2 - plan.center.x * sk, oy = S / 2 - plan.center.y * sk;
  const P = (v: V) => ({ x: ox + v.x * sk, y: oy + v.y * sk });
  if (p.riverCourse) {
    cx.strokeStyle = 'rgba(20,120,220,0.35)';
    cx.lineWidth = Math.max(1, p.riverCourse.width * sk);
    cx.beginPath();
    p.riverCourse.line.forEach((v, i) => { const q = P(v); i ? cx.lineTo(q.x, q.y) : cx.moveTo(q.x, q.y); });
    cx.stroke();
  }
  // los centroides de las manzanas, para ver si el casco está partido
  cx.fillStyle = 'rgba(200,0,0,0.7)';
  for (const q of plan.patches) if (q.withinCity && q.shape.length >= 3) {
    const c = P(centroid(q.shape));
    cx.fillRect(c.x - 2, c.y - 2, 4, 4);
  }
  cx.fillStyle = 'rgba(0,0,0,0.65)'; cx.fillRect(0, 0, S, 22);
  cx.fillStyle = '#fff'; cx.font = '14px sans-serif';
  cx.fillText(`${name} · ${s.rank} · ${p.riverMode} · radio ${plan.radius.toFixed(0)} · alcance ${reach.toFixed(0)}`, 6, 16);
  sc.drawImage(cell, k * S, 0);
}
mkdirSync('harness/out/city', { recursive: true });
writeFileSync('harness/out/city/one.png', sheet.toBuffer('image/png'));
console.log('→ harness/out/city/one.png');
