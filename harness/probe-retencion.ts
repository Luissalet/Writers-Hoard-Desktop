import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import { satelliteDeepSupported, MAX_SAT_TILE_Z, SAT_DEEP_Z } from '../src/engines/worldgen/region/satelliteTile';

let t0 = Date.now();
const m = generateWorld({ ...DEFAULT_PARAMS, seed: 'banco-retencion', width: 512 });
console.log('mundo 512:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
t0 = Date.now();
const g = getGeography(m, 'full');
console.log('geografía full:', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'asentamientos', g.settlements.length);
let top = -1;
for (let z = MAX_SAT_TILE_Z; z >= SAT_DEEP_Z; z--) if (satelliteDeepSupported(m, z)) { top = z; break; }
console.log('topZ satélite:', top);
