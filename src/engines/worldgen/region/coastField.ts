// One coastline, at every zoom.
// ============================================
// The world raster, shallow satellite tiles and canon used to invent their own
// shoreline displacement. The differences were individually plausible and
// collectively looked like the country changed while zooming. This field is
// the single geometric authority all three paths now sample.

import type { WorldData } from '../core/types';
import { makeLatticeHash, latticeFbm } from './satelliteInk';
import { kmPerWorldCell, patchBilinear, type WorldPatch } from './terrain';

/** The large-scale coastline may acquire coves, but may not move kilometres
 * just because another LOD is drawing it. Kept physical across world sizes. */
export const COAST_WARP_KM = 1.8;

export interface WorldCoastSample {
  x: number;
  y: number;
  elevation: number;
}

export interface WorldCoastField {
  hash: ReturnType<typeof makeLatticeHash>;
  sample: (worldX: number, worldY: number) => WorldCoastSample;
}

/** Build once per tile/supertile, then sample at arbitrary world coordinates. */
export function createWorldCoastField(world: WorldData, patch: WorldPatch): WorldCoastField {
  const hash = makeLatticeHash(`${world.params.seed}::coast`);
  const amplitude = Math.min(0.16, COAST_WARP_KM / kmPerWorldCell(world));
  const sample = (worldX: number, worldY: number): WorldCoastSample => {
    const x = worldX
      + latticeFbm(hash, worldX, worldY, 3, 1.3, 11, world.width) * amplitude;
    const y = worldY
      + latticeFbm(hash, worldX, worldY, 3, 1.3, 29, world.width) * amplitude;
    // World raster cells occupy [k,k+1) and are centred at k+0.5.  The
    // far-zoom renderer samples that convention explicitly (`gx - 0.5`).
    // Regional patches store sample k at array index k, so compensate here as
    // well; otherwise the entire detailed coastline is translated by half a
    // world cell at the atlas→satellite hand-off.
    return { x, y, elevation: patchBilinear(patch, patch.elev, x - 0.5, y - 0.5) };
  };
  return { hash, sample };
}
