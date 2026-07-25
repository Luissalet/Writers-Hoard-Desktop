// A/B: is the current model actually changing the climate at the coasts, or is
// the wind field doing all the work? Same seed, same terrain, sst on and off.
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { computeClimate } from '../src/engines/worldgen/core/climate';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
const w = generateWorld({ ...DEFAULT_PARAMS, seed: 'ab', width: 768 } as never);
const { width: W, height: H, elevation } = w;
const probe = Math.max(4, Math.round(W / 90));
function stats(precip: Float32Array) {
  const bins = new Map<string, { n: number; p: number }>();
  for (let y = 2; y < H - 2; y++) {
    const lat = Math.abs((0.5 - (y + 0.5) / H) * 180);
    const band = lat < 12 ? null : lat < 34 ? 'trópico' : lat < 58 ? 'medias ' : null;
    if (!band) continue;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (elevation[i] <= 0) continue;
      let coastal = false;
      for (const d of [-1, 1]) if (elevation[y*W+((x+d+W)%W)] <= 0) coastal = true;
      if (!coastal) continue;
      let sw=0, se=0;
      for (let k=1;k<=probe;k++){ if(elevation[y*W+((x-k+W)%W)]<=0)sw++; if(elevation[y*W+((x+k)%W)]<=0)se++; }
      const f = sw>probe*0.7&&se<probe*0.3 ? 'oeste' : se>probe*0.7&&sw<probe*0.3 ? 'este ' : null;
      if (!f) continue;
      const k = `${band} ${f}`;
      let b = bins.get(k); if(!b) bins.set(k, b={n:0,p:0});
      b.n++; b.p += precip[i];
    }
  }
  return bins;
}
const withC = stats(w.precipitation);
const noC = stats(computeClimate({ ...DEFAULT_PARAMS, seed:'ab', width:768 } as never, elevation, null).precipitation);
console.log('banda/orientación   sin corrientes   con corrientes   cambio');
for (const k of [...withC.keys()].sort()) {
  const a = noC.get(k)!, b = withC.get(k)!;
  const pa = a.p/a.n, pb = b.p/b.n;
  console.log(`${k}       ${pa.toFixed(0).padStart(8)} mm     ${pb.toFixed(0).padStart(8)} mm    ${((pb/pa-1)*100).toFixed(0).padStart(5)} %`);
}
