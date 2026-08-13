import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import { generateRegion } from '../src/engines/worldgen/region/generate';
import { canonParams, tileWindow, tileGeometry, canonRefinement } from '../src/engines/worldgen/region/tiles';

for (const width of [256, 512]) {
  const m = generateWorld({ ...DEFAULT_PARAMS, seed: 'banco-retencion', width });
  const g = getGeography(m, 'full');
  const id = { tx: Math.floor((m.width / 4) * 0.658), ty: Math.floor((m.height / 4) * 0.789) };
  const t0 = Date.now();
  const r = generateRegion(m, g, tileWindow(m, id), { params: canonParams(m), geometry: tileGeometry(m, id) });
  console.log(`mundo ${width}: refinamiento ${canonRefinement(m)} · supertesela ${r.width}x${r.height} en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
