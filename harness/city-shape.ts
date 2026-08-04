// ¿Dónde cae la catedral, y qué forma tiene la ciudad?
import { generateCity, DEFAULT_CITY } from '../src/engines/worldgen/city/generate';

function centroid(poly: { x: number; y: number }[]) {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

let sum = 0, n = 0, edge = 0;
const elong: number[] = [];
for (let k = 0; k < 40; k++) {
  const plan = generateCity({ ...DEFAULT_CITY, seed: `ciudad-${k}`, size: 18 + (k % 20), walls: true, citadel: true, river: k % 3 === 0, coast: k % 4 === 0 });
  const cath = plan.patches.find((q) => q.ward === 'cathedral');
  if (cath) {
    const d = Math.hypot(centroid(cath.shape).x - plan.center.x, centroid(cath.shape).y - plan.center.y) / plan.radius;
    sum += d; n++;
    if (d > 0.6) edge++;
  }
  // Elongation: the ratio of the two principal extents of the walled outline.
  const ring = plan.wall ?? plan.patches.filter((q) => q.withinCity).flatMap((q) => q.shape);
  let sxx = 0, syy = 0, sxy = 0;
  const c = centroid(ring);
  for (const v of ring) { const dx = v.x - c.x, dy = v.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
  elong.push(Math.sqrt(l1 / Math.max(1e-9, l2)));
}
elong.sort((a, b) => a - b);
console.log(`catedral: distancia media al centro ${(sum / n).toFixed(2)} radios · en el borde (>0,6) ${edge} de ${n}`);
console.log(`alargamiento del contorno: mediana ${elong[20].toFixed(2)} · mín ${elong[0].toFixed(2)} · máx ${elong[39].toFixed(2)} (1,00 = círculo perfecto)`);

// Y ahora mirarlas, que es lo único que decide.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderCity } from '../src/engines/worldgen/city/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
mkdirSync('harness/out/city', { recursive: true });
const theme = themeById('pergamino') ?? themeById('default')!;
const S = 340;
const sheet = createCanvas(S * 4, S * 3);
const sc = sheet.getContext('2d');
sc.fillStyle = '#12100c'; sc.fillRect(0, 0, sheet.width, sheet.height);
const cases = [
  { tag: 'interior', river: false, coast: false },
  { tag: 'interior', river: false, coast: false },
  { tag: 'río E-O', river: true, coast: false, riverDir: { x: 1, y: 0 } },
  { tag: 'río NE', river: true, coast: false, riverDir: { x: 0.7, y: -0.7 } },
  { tag: 'costa S', river: false, coast: true, coastDir: { x: 0, y: 1 } },
  { tag: 'costa O', river: false, coast: true, coastDir: { x: -1, y: 0 } },
  { tag: 'puerto+río', river: true, coast: true, coastDir: { x: 0, y: 1 }, riverDir: { x: 0.2, y: 1 } },
  { tag: 'puerto+río', river: true, coast: true, coastDir: { x: 1, y: 0.3 }, riverDir: { x: 1, y: -0.2 } },
  { tag: 'ladera N', river: false, coast: false, slopeDir: { x: 0, y: -1 }, slopeAmount: 0.9 },
  { tag: 'ladera NE', river: true, coast: false, riverDir: { x: 1, y: 0.3 }, slopeDir: { x: 0.7, y: -0.7 }, slopeAmount: 0.8 },
  { tag: 'valle', river: true, coast: false, riverDir: { x: 1, y: 0 }, slopeDir: { x: 0, y: -1 }, slopeAmount: 0.7 },
  { tag: 'interior grande', river: false, coast: false, size: 44 },
];
cases.forEach((c, i) => {
  const plan = generateCity({ ...DEFAULT_CITY, seed: `forma-${i}`, size: c.size ?? 26, walls: true, citadel: true, ...c });
  const cv = createCanvas(S, S);
  renderCity(plan, cv.getContext('2d') as unknown as Ctx, { theme, width: S, height: S });
  sc.drawImage(cv, (i % 4) * S, Math.floor(i / 4) * S);
  sc.fillStyle = '#e8e5e0'; sc.font = '600 13px sans-serif';
  sc.fillText(c.tag, (i % 4) * S + 8, Math.floor(i / 4) * S + 18);
});
writeFileSync('harness/out/city/formas.png', sheet.toBuffer('image/png'));
console.log('escrito harness/out/city/formas.png');
