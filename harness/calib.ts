// Calibrate the divider measurement against fields of KNOWN Hurst exponent.
// A level set of 2-D fBm with Hurst H has fractal dimension D = 2 - H, and for
// lacunarity 2 the fBm gain g gives H = -log2(g). So the expected D is known in
// advance and the measurement can be checked instead of trusted.
import { SphereNoise } from '../src/engines/worldgen/core/noise';
import { marchingSquares, pathLength, type Pt } from '../src/engines/worldgen/cartography/contours';

function ruler(pts: Pt[], eps: number, closed: boolean): number {
  let count = 0, anchor = pts[0], i = 0, guard = 0;
  const n = pts.length, total = closed ? n : n - 1;
  while (i < total && guard++ < n * 40) {
    let j = i;
    while (j < total && Math.hypot(pts[(j+1)%n].x-anchor.x, pts[(j+1)%n].y-anchor.y) < eps) j++;
    if (j >= total) break;
    anchor = pts[(j+1)%n]; i = j+1; count++;
  }
  return count * eps;
}
function dim(pts: Pt[], closed: boolean, eps: number[]): number {
  const P: [number,number][] = [];
  for (const e of eps) { const L = ruler(pts,e,closed); if (L>0) P.push([Math.log(e), Math.log(L)]); }
  const n = P.length; if (n<3) return NaN;
  let sx=0,sy=0,sxx=0,sxy=0;
  for (const [x,y] of P) { sx+=x; sy+=y; sxx+=x*x; sxy+=x*y; }
  return 1 - (n*sxy - sx*sy)/(n*sxx - sx*sx);
}

const W = 1024, H = 512;
const epsSets: [string, number[]][] = [
  ['ε 2…27  ', [2,3,4.5,6.5,9,13,19,27]],
  ['ε 4…54  ', [4,6,9,13,19,27,38,54]],
  ['ε 1.5…12', [1.5,2,2.8,4,5.6,8,12]],
];
for (const gain of [0.50, 0.59, 0.66]) {
  const expected = 2 + Math.log2(gain);
  const n = new SphereNoise('calib', `g${gain}`);
  const f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    f[y*W+x] = n.fbm((x+0.5)/W, (y+0.5)/H, 6, 9, 2, gain);
  }
  const cs = marchingSquares(f, W, H, 0, true)
    .map((c) => ({ c, len: pathLength(c.pts, c.closed) }))
    .filter((e) => e.len > 120).sort((a,b)=>b.len-a.len).slice(0,10);
  const out: string[] = [];
  for (const [label, eps] of epsSets) {
    let ws=0, wt=0;
    for (const {c,len} of cs) { const d = dim(c.pts, c.closed, eps); if (!isNaN(d)) { ws += d*len; wt += len; } }
    out.push(`${label} → ${(ws/wt).toFixed(3)}`);
  }
  console.log(`gain ${gain.toFixed(2)}  D esperada ${expected.toFixed(3)}   medida:  ${out.join('   ')}`);
}
