import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
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
function dim(pts: Pt[], closed: boolean): number {
  const eps = [2,3,4.5,6.5,9,13,19,27];
  const P: [number,number][] = [];
  for (const e of eps) { const L = ruler(pts,e,closed); if (L>0) P.push([Math.log(e), Math.log(L)]); }
  const n = P.length; if (n<3) return 1;
  let sx=0,sy=0,sxx=0,sxy=0;
  for (const [x,y] of P) { sx+=x; sy+=y; sxx+=x*x; sxy+=x*y; }
  return 1 - (n*sxy - sx*sy)/(n*sxx - sx*sx);
}
function measure(over: Record<string, number>): string {
  const w = generateWorld({ ...DEFAULT_PARAMS, seed: 'probe', width: 768, ...over } as never);
  const cs = marchingSquares(w.elevation, w.width, w.height, 0, true)
    .map((c) => ({ c, len: pathLength(c.pts, c.closed) }))
    .filter((e) => e.len > w.width * 0.12).sort((a,b)=>b.len-a.len).slice(0,6);
  let ws=0, wt=0, cs2=0;
  for (const {c,len} of cs) {
    ws += dim(c.pts, c.closed)*len; wt += len;
    let a=0; for (let i=0,n=c.pts.length;i<n;i++){const p=c.pts[i],q=c.pts[(i+1)%n];a+=p.x*q.y-q.x*p.y;}
    cs2 += (4*Math.PI*Math.abs(a)/2)/(len*len);
  }
  return `D=${(ws/wt).toFixed(3)}  compacidad=${(cs2/cs.length).toFixed(3)}  (${cs.length} costas)`;
}
for (const [label, over] of [
  ['erosion 0.0            ', { erosion: 0 }],
  ['erosion 0.6 (por defecto)', { erosion: 0.6 }],
  ['erosion 0.6 + cc 1.0   ', { erosion: 0.6, coastalComplexity: 1 }],
  ['erosion 0.0 + cc 1.0   ', { erosion: 0, coastalComplexity: 1 }],
] as [string, Record<string,number>][]) {
  console.log(`${label}  ${measure(over)}`);
}
