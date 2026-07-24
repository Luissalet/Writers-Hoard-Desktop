// ============================================
// World Generator — Biome Classification
// ============================================
// Whittaker-style classification from (temperature, precipitation), with
// altitude/latitude specials (alpine, glacier, ice cap), coastal beaches and
// arid salt flats. A touch of noise dithers thresholds so borders feel like
// ecotones instead of contour lines.

import { Biome } from './types';
import { CylinderNoise } from './noise';
import type { WorldParams } from './types';

export function classifyBiomes(
  params: WorldParams,
  elevation: Float32Array,
  temperature: Float32Array,
  precipitation: Float32Array,
  lake: Uint8Array,
): Uint8Array {
  const W = params.width, H = W >> 1, N = W * H;
  const biome = new Uint8Array(N);
  const dither = new CylinderNoise(params.seed, 'biome-dither');

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const yW = y * W;
    for (let x = 0; x < W; x++) {
      const i = yW + x;
      const e = elevation[i];

      if (e <= 0) { biome[i] = Biome.Ocean; continue; }
      if (lake[i]) {
        // Frozen solid in polar cold; evaporated to salt flats in hot drylands.
        biome[i] = temperature[i] < -11 ? Biome.IceCap
          : precipitation[i] < 260 && temperature[i] > 12 ? Biome.SaltFlat
          : Biome.Lake;
        continue;
      }

      const u = (x + 0.5) / W;
      // Two dither scales: a broad wobble that bends zone borders and a fine
      // one that feathers them — kills the "ruler-straight latitude band" look.
      const dT = 3.2 * dither.fbm(u, v, 5, 2) + 1.2 * dither.fbm(u, v, 26, 2);
      const dP = 300 * dither.fbm(u + 0.5, v + 0.25, 5, 2) + 90 * dither.fbm(u + 0.31, v + 0.62, 27, 2);
      const T = temperature[i] + dT;
      const P = precipitation[i] + dP;

      // --- Cold & high specials ---
      if (T < -13) { biome[i] = Biome.IceCap; continue; }
      if (e > 2.2 && T < -2) { biome[i] = P > 900 ? Biome.Glacier : Biome.Alpine; continue; }
      if (e > 1.7 && T < 3) { biome[i] = Biome.Alpine; continue; }
      if (T < -2) { biome[i] = Biome.Tundra; continue; }

      // --- Beaches: warm low coastland next to the sea (patchy, not a ring) ---
      if (e < 0.03 && T > 9 && P < 1900 && dT > -0.6) {
        let coastal = false;
        for (let d = 0; d < 4 && !coastal; d++) {
          const nx = d === 0 ? (x + 1 < W ? i + 1 : i + 1 - W)
            : d === 1 ? (x > 0 ? i - 1 : i - 1 + W)
            : d === 2 ? (y + 1 < H ? i + W : -1)
            : (y > 0 ? i - W : -1);
          if (nx >= 0 && elevation[nx] <= 0) coastal = true;
        }
        if (coastal) { biome[i] = Biome.Beach; continue; }
      }

      // --- Whittaker grid ---
      if (T > 21) {
        biome[i] =
          P > 2050 ? Biome.TropicalRainforest :
          P > 1150 ? Biome.TropicalForest :
          P > 600 ? Biome.Savanna :
          P > 250 ? Biome.Shrubland :
          Biome.Desert;
      } else if (T > 11) {
        biome[i] =
          P > 1800 ? Biome.TemperateRainforest :
          P > 900 ? Biome.TemperateForest :
          P > 430 ? Biome.Grassland :
          P > 200 ? Biome.Shrubland :
          Biome.Desert;
      } else if (T > 3) {
        biome[i] =
          P > 820 ? Biome.TemperateForest :
          P > 360 ? Biome.Grassland :
          Biome.ColdDesert;
      } else {
        biome[i] =
          P > 460 ? Biome.BorealForest :
          P > 200 ? Biome.Tundra :
          Biome.ColdDesert;
      }
    }
  }
  return biome;
}
