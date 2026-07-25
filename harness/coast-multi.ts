import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { marchingSquares, pathLength, type Pt } from '../src/engines/worldgen/cartography/contours';
import { labelLandmasses } from '../src/engines/worldgen/cartography/fields';
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
const cal = (raw:number)=>1+(raw-1.071)/0.28;
console.log('semilla     tierra  masas>1%  mayor%   D calib  compacidad');
for (const seed of ['monstruo','aetheria','v-alpha','norte','k9','terra-2']) {
  const w = generateWorld({ ...DEFAULT_PARAMS, seed, width: 768 } as never);
  const total = w.width*w.height;
  let land=0; for(let i=0;i<total;i++) if(w.elevation[i]>0) land++;
  const { sizes } = labelLandmasses(w.elevation, w.width, w.height);
  sizes.sort((a,b)=>b-a);
  const big = sizes.filter((s)=>s/total>0.01).length;
  const largest = sizes.length ? sizes[0]/land*100 : 0;
  const cs = marchingSquares(w.elevation,w.width,w.height,0,true)
    .map((c)=>({c,len:pathLength(c.pts,c.closed)}))
    .filter((e)=>e.len>w.width*0.12).sort((a,b)=>b.len-a.len).slice(0,8);
  let ws=0,wt=0,cp=0;
  for(const{c,len}of cs){const d=dim(c.pts,c.closed); if(!isNaN(d)){ws+=d*len;wt+=len;}
    let a=0; for(let i=0,n=c.pts.length;i<n;i++){const p=c.pts[i],q=c.pts[(i+1)%n];a+=p.x*q.y-q.x*p.y;}
    cp+=(4*Math.PI*Math.abs(a)/2)/(len*len);}
  console.log(`${seed.padEnd(11)} ${(100*land/total).toFixed(1).padStart(5)}%  ${String(big).padStart(7)}  ${largest.toFixed(0).padStart(5)}%   ${cal(ws/wt).toFixed(3).padStart(6)}   ${(cp/cs.length).toFixed(3)}`);
}
