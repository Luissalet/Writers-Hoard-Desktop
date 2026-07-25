// Bench: measure how rugged the generated coastlines actually are.
//
// The Richardson divider method: walk the coastline with a ruler of length ε
// and count the steps. On a fractal curve  L(ε) ∝ ε^(1-D),  so a log-log fit of
// length against ruler length has slope 1-D. Real reference values:
//
//   South Africa      D ≈ 1.02   (smooth, steep continental margin)
//   Great Britain     D ≈ 1.25   (rugged, broad shelf)
//   Lake shorelines   D ≈ 1.28
//
// A blob has D = 1.00. That is the number to beat.

import { getWorld } from './world-cache';
import { marchingSquares, pathLength, type Pt } from '../src/engines/worldgen/cartography/contours';

function rulerLength(pts: Pt[], eps: number, closed: boolean): number {
  // Walk the polyline placing a foot every ε of straight-line distance.
  let count = 0;
  let anchor = pts[0];
  const n = pts.length;
  const total = closed ? n : n - 1;
  let i = 0;
  let guard = 0;
  while (i < total && guard++ < n * 40) {
    // Advance until we are at least ε from the anchor.
    let j = i;
    while (j < total && Math.hypot(pts[(j + 1) % n].x - anchor.x, pts[(j + 1) % n].y - anchor.y) < eps) j++;
    if (j >= total) break;
    anchor = pts[(j + 1) % n];
    i = j + 1;
    count++;
  }
  return count * eps;
}

/** Least-squares slope of log L against log ε. */
function dimension(pts: Pt[], closed: boolean, epsList: number[]): { D: number; pairs: [number, number][] } {
  const pairs: [number, number][] = [];
  for (const eps of epsList) {
    const L = rulerLength(pts, eps, closed);
    if (L > 0) pairs.push([Math.log(eps), Math.log(L)]);
  }
  const n = pairs.length;
  if (n < 3) return { D: 1, pairs };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { D: 1 - slope, pairs };
}

const seed = process.argv[2] || 'monstruo';
const width = Number(process.argv[3] || 1024);
const world = getWorld({ seed, width });

const contours = marchingSquares(world.elevation, world.width, world.height, 0, true);
// Only landmasses big enough to have a meaningful coastline.
const big = contours
  .map((c) => ({ c, len: pathLength(c.pts, c.closed) }))
  .filter((e) => e.len > world.width * 0.12)
  .sort((a, b) => b.len - a.len)
  .slice(0, 8);

console.log(`${contours.length} contours, ${big.length} measurable coastlines\n`);
const epsList = [2, 3, 4.5, 6.5, 9, 13, 19, 27];
let wsum = 0, wtot = 0;
for (const { c, len } of big) {
  const { D } = dimension(c.pts, c.closed, epsList);
  wsum += D * len;
  wtot += len;
  console.log(`  perímetro ${len.toFixed(0).padStart(5)} celdas   D = ${D.toFixed(3)}`);
}
const raw = wsum / wtot;
// Calibration: measured against fBm fields of known Hurst exponent on this same
// ruler range (harness/calib.ts), the divider method returns
//   1.000 → 1.071,  1.239 → 1.129,  1.401 → 1.183
// i.e. it compresses the range by ~3.5x. Undo that so the printed number can be
// compared with published coastline dimensions.
const calibrated = 1 + (raw - 1.071) / 0.28;
console.log(`\nD cruda (ponderada por perímetro) = ${raw.toFixed(3)}`);
console.log(`D CALIBRADA                       = ${calibrated.toFixed(3)}`);
console.log('referencia: Sudáfrica 1,02 · Gran Bretaña 1,25 · lagos 1,28 · círculo 1,00');

// A second, independent signal: how convoluted the outline is versus a circle.
// A star-shaped blob scores near 1 no matter how lumpy its radius is.
for (const { c, len } of big.slice(0, 4)) {
  let area = 0;
  for (let i = 0, n = c.pts.length; i < n; i++) {
    const a = c.pts[i], b = c.pts[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area) / 2;
  const circ = (4 * Math.PI * area) / (len * len); // 1 = circle
  console.log(`  compacidad ${circ.toFixed(3)}  (1,00 = círculo perfecto; Gran Bretaña ≈ 0,06)`);
}
