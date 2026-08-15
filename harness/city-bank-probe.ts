// ¿La ciudad de una orilla toca su río, o se queda mirándolo desde lejos?
import { getWorld } from './world-cache';
import { getGeography, cityParamsFor } from '../src/engines/worldgen/cartography/texture';
import { generateCity } from '../src/engines/worldgen/city/generate';
import { centroid, type V } from '../src/engines/worldgen/city/geometry';

const world = getWorld();
const geo = await getGeography(world, 'full');

function segD(p: V, a: V, b: V): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
const lineD = (p: V, l: V[]) => {
  let b = Infinity;
  for (let i = 0; i < l.length - 1; i++) b = Math.min(b, segD(p, l[i], l[i + 1]));
  return b;
};

console.log('nombre        rango     ancho  |  hueco casa→orilla  |  plano medio vs local  |  edif  puentes  molinos  caminos cortados');
let n = 0, gapSum = 0;
for (const s of geo.settlements) {
  const p = cityParamsFor(world, s, geo);
  if (!p.riverCourse) continue;
  const plan = generateCity(p);
  const course = p.riverCourse;
  const half = course.width / 2;

  // hueco: distancia mínima de un edificio a la ORILLA (no al eje)
  let minEdge = Infinity;
  let inChannel = 0, bcount = 0;
  for (const q of plan.patches) {
    for (const b of q.buildings) {
      bcount++;
      const c = centroid(b.shape);
      const d = lineD(c, course.line) - half;
      if (d < minEdge) minEdge = d;
      if (d < 0) inChannel++;
    }
  }
  // el plano de recorte usado por `bank`: proyección MEDIA del cauce
  const l = course.line;
  const dir = { x: l[l.length - 1].x - l[0].x, y: l[l.length - 1].y - l[0].y };
  const m = Math.hypot(dir.x, dir.y) || 1;
  const perp = { x: -dir.y / m, y: dir.x / m };
  let off = 0;
  for (const v of l) off += v.x * perp.x + v.y * perp.y;
  off /= l.length;
  // proyección LOCAL del cauce en el punto más cercano al centro urbano
  const uc = p.urbanCenter ?? { x: 0, y: 0 };
  let best = l[0], bd = Infinity;
  for (let i = 0; i < l.length - 1; i++) {
    const a = l[i], b2 = l[i + 1];
    const dx = b2.x - a.x, dy = b2.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((uc.x - a.x) * dx + (uc.y - a.y) * dy) / l2)) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(q.x - uc.x, q.y - uc.y);
    if (d < bd) { bd = d; best = q; }
  }
  const localOff = best.x * perp.x + best.y * perp.y;

  const mills = plan.patches.reduce((a, q) => a + q.buildings.filter((b) => b.kind === 'mill').length, 0);
  const cut = plan.roads.filter((r) => r.length > 1 && lineD(r[r.length - 1], course.line) < course.width * 1.2).length;

  console.log(
    `${s.name.padEnd(14)}${s.rank.padEnd(9)}${course.width.toFixed(0).padStart(6)}u |`
    + `${minEdge.toFixed(1).padStart(10)}u (${(minEdge / (10 + p.size * 2.5)).toFixed(2)}R0) en canal ${String(inChannel).padStart(3)} |`
    + `${(localOff - off).toFixed(1).padStart(9)}u |`
    + `${String(bcount).padStart(6)}${String(plan.bridges.length).padStart(9)}${String(mills).padStart(9)}${String(cut).padStart(9)}`,
  );
  n++; gapSum += minEdge;
}
console.log(`\n${n} ciudades con cauce; hueco medio ${(gapSum / n).toFixed(1)} unidades (${(gapSum / n * 4).toFixed(0)} m)`);
