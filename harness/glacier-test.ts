// Does glaciation actually produce fjord coasts where ice was, and leave the
// rest of the world alone? Measured by latitude band.
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { marchingSquares, pathLength, type Pt } from '../src/engines/worldgen/cartography/contours';
function ruler(pts: Pt[], eps: number, closed: boolean): number {
  let c=0, a=pts[0], i=0, g=0; const n=pts.length, t=closed?n:n-1;
  while (i<t && g++<n*40) { let j=i;
    while (j<t && Math.hypot(pts[(j+1)%n].x-a.x, pts[(j+1)%n].y-a.y)<eps) j++;
    if (j>=t) break; a=pts[(j+1)%n]; i=j+1; c++; }
  return c*eps;
}
function dim(pts: Pt[], closed: boolean): number {
  const eps=[2,3,4.5,6.5,9,13,19,27]; const P:[number,number][]=[];
  for (const e of eps){const L=ruler(pts,e,closed); if(L>0)P.push([Math.log(e),Math.log(L)]);}
  const n=P.length; if(n<3)return NaN; let sx=0,sy=0,sxx=0,sxy=0;
  for(const[x,y]of P){sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}
  return 1-(n*sxy-sx*sy)/(n*sxx-sx*sx);
}
const cal=(r:number)=>1+(r-1.071)/0.28;
// Coastline dimension restricted to a latitude band: split each contour by
// latitude and measure the pieces separately.
function bandDim(w: ReturnType<typeof generateWorld>, lo: number, hi: number): number {
  const H = w.height;
  const y0 = (1 - hi/90) * H/2, y1 = (1 - lo/90) * H/2;   // northern band
  const cs = marchingSquares(w.elevation, w.width, w.height, 0, true);
  let ws=0, wt=0;
  for (const c of cs) {
    // contiguous runs inside the band
    let run: Pt[] = [];
    const flush = () => {
      if (run.length > 40) { const d = dim(run, false); const L = pathLength(run); if (!isNaN(d)) { ws += d*L; wt += L; } }
      run = [];
    };
    for (const p of c.pts) {
      const inN = p.y >= y0 && p.y <= y1;
      const inS = p.y >= H - y1 && p.y <= H - y0;
      if (inN || inS) run.push(p); else flush();
    }
    flush();
  }
  return wt > 0 ? cal(ws/wt) : NaN;
}
for (const gl of [0, 0.55, 1]) {
  const w = generateWorld({ ...DEFAULT_PARAMS, seed: 'glaciar', width: 768, glaciation: gl } as never);
  let iceLand=0, land=0, below=0;
  for (let i=0;i<w.elevation.length;i++){ if(w.elevation[i]>0){land++; if(w.ice[i]>0.05) iceLand++;} }
  const trop = bandDim(w, 5, 25), mid = bandDim(w, 35, 55), high = bandDim(w, 58, 80);
  console.log(`glaciation ${gl.toFixed(2)}  hielo ${(100*iceLand/land).toFixed(0)}% de la tierra   D trópico ${trop.toFixed(3)}  medias ${mid.toFixed(3)}  altas ${high.toFixed(3)}`);
}
