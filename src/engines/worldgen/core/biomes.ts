// ============================================
// World Generator — Biome Classification
// ============================================
// A Whittaker grid on (temperature, precipitation) is the right skeleton, but on
// its own it produces a world of latitude stripes. Four things break that, and
// all four are what the eye actually reads as "real ecology":
//
//   ELEVATION BANDS    A mountain is not one biome. Climbing it you pass montane
//                      forest, then meadow above the treeline, then bare rock,
//                      then ice — the same sequence you would walk from here to
//                      the pole, compressed into a few kilometres.
//   RIPARIAN CORRIDORS A large river carries its own forest through country far
//                      too dry to support one. The Nile is a green thread across
//                      the Sahara, and that thread is the most legible feature on
//                      any map of Egypt.
//   SUBSTRATE          Desert is not one biome, it is three: a sand sea where the
//                      ground is flat, a stone waste where the wind has stripped
//                      it, and badlands where there is relief to carve. Same
//                      climate, completely different country.
//   SHELTER            Mangrove and salt marsh need warmth AND wet AND a coast
//                      the surf cannot reach. They are why a delta does not look
//                      like a beach.

import { Biome } from './types';
import { SphereNoise } from './noise';
import type { WorldParams } from './types';

export interface BiomeInputs {
  elevation: Float32Array;
  temperature: Float32Array;
  precipitation: Float32Array;
  lake: Uint8Array;
  /** Log-scaled drainage area 0–1 — how big the river through this cell is. */
  flow: Float32Array;
  /** Local relief in km: elevation minus its own neighbourhood average. */
  relief: Float32Array;
  /** Distance in cells from a land cell to the nearest sea cell. */
  seaDist: Float32Array;
}

/**
 * Treeline in km as a function of latitude: about 3.9 km at the equator, falling
 * to sea level near 70°. That shape is not arbitrary — the treeline is a
 * temperature contour, and temperature falls with both latitude and altitude.
 */
function treeline(latAbs: number): number {
  return Math.max(0, 3.9 - Math.pow(latAbs / 90, 1.35) * 4.4);
}

/**
 * A window of the grid, in cells. `x0` may be negative or ≥ width: it is wrapped,
 * so a window straddling the seam is expressed as a single rectangle.
 */
export interface BiomeRect { x0: number; y0: number; w: number; h: number }

/**
 * Classify the whole grid, or just a window of it.
 *
 * The window exists for painting. A brush stroke changes a few hundred cells and
 * re-classifying the planet for it costs ~150 ms of fBm evaluation, which was a
 * sixth of the delay between releasing the mouse and seeing the stroke. Every
 * decision here is per-cell — nothing is global — so restricting the loop bounds
 * is exact, not an approximation.
 */
export function classifyBiomes(
  params: WorldParams,
  inputs: BiomeInputs,
  rect?: BiomeRect,
  out?: Uint8Array,
): Uint8Array {
  const W = params.width, H = W >> 1, N = W * H;
  const { elevation, temperature, precipitation, lake, flow, relief, seaDist } = inputs;
  const biome = out ?? new Uint8Array(N);
  const dither = new SphereNoise(params.seed, 'biome-dither');
  const patch = new SphereNoise(params.seed, 'biome-patch');
  const ws = params.worldScale;

  const y0 = rect ? Math.max(0, rect.y0) : 0;
  const y1 = rect ? Math.min(H, rect.y0 + rect.h) : H;
  const x0 = rect ? rect.x0 : 0;
  const xn = rect ? Math.min(W, rect.w) : W;

  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5) / H;
    const latAbs = Math.abs((0.5 - v) * 180);
    const tl = treeline(latAbs);
    const yW = y * W;
    for (let xi = 0; xi < xn; xi++) {
      const x = ((x0 + xi) % W + W) % W;
      const i = yW + x;
      const e = elevation[i];

      if (e <= 0) { biome[i] = Biome.Ocean; continue; }
      if (lake[i]) {
        biome[i] = temperature[i] < -11 ? Biome.IceCap
          : precipitation[i] < 260 && temperature[i] > 12 ? Biome.SaltFlat
            : Biome.Lake;
        continue;
      }

      const u = (x + 0.5) / W;
      // Two dither scales: a broad wobble that bends zone borders and a fine one
      // that feathers them. Without this every boundary is a contour line.
      const dT = 3.2 * dither.fbm(u, v, 5 * ws, 2) + 1.2 * dither.fbm(u, v, 26, 2);
      const dP = 300 * dither.fbm(u + 0.5, v + 0.25, 5 * ws, 2) + 90 * dither.fbm(u + 0.31, v + 0.62, 27, 2);
      const T = temperature[i] + dT;
      const P = precipitation[i] + dP;
      const rel = relief[i];
      const coast = seaDist[i];
      const fl = flow[i];

      // --- ice ---------------------------------------------------------------
      if (T < -11) { biome[i] = Biome.IceCap; continue; }

      // --- the mountain sequence --------------------------------------------
      // Read from the top down: each band is defined by being below the one above.
      if (e > tl + 1.15 && T < 2) { biome[i] = P > 900 ? Biome.Glacier : Biome.Alpine; continue; }
      if (e > tl + 0.45) { biome[i] = Biome.Alpine; continue; }
      if (e > tl) {
        // Above the trees, below the rock: turf, cushion plants, snowmelt.
        biome[i] = P > 350 ? Biome.AlpineMeadow : Biome.Alpine;
        continue;
      }
      if (e > tl - 0.75 && e > 0.6 && P > 500) {
        // The montane belt: conifers standing where the broadleaf forest below
        // has already given up.
        biome[i] = T > 17 && P > 1500 ? Biome.CloudForest : Biome.MontaneForest;
        continue;
      }
      if (T < -2) {
        biome[i] = P > 520 && rel < 0.12 ? Biome.PeatBog : Biome.Tundra;
        continue;
      }

      // --- water-logged ground ----------------------------------------------
      // Wetland needs water arriving and nowhere for it to go: a big river or
      // heavy rain, on ground flat enough to pond.
      const flat = rel < 0.055;
      if (flat && e < 0.45 && (fl > 0.55 || (P > 1500 && fl > 0.3))) {
        if (coast < 2.5 && T > 19) { biome[i] = Biome.Mangrove; continue; }
        if (coast < 2.5) { biome[i] = Biome.SaltMarsh; continue; }
        biome[i] = T < 6 ? Biome.PeatBog : Biome.Marsh;
        continue;
      }
      // A sheltered warm coast grows mangrove even without a river behind it.
      if (coast < 1.6 && e < 0.06 && T > 20 && P > 1100) { biome[i] = Biome.Mangrove; continue; }
      if (coast < 1.6 && e < 0.05 && T > 4 && P > 800 && flat) { biome[i] = Biome.SaltMarsh; continue; }

      // --- riparian corridor -------------------------------------------------
      // A gallery forest along a major river, but ONLY where the surrounding
      // country is too dry to grow one anyway. Anywhere else it is invisible, and
      // painting it regardless would just thicken every river into a green line.
      if (fl > 0.62 && P < 700 && T > 4 && e < 1.4) { biome[i] = Biome.RiparianForest; continue; }

      // --- beaches: patchy, not a continuous ring ---------------------------
      if (e < 0.03 && T > 9 && P < 1900 && coast < 1.6 && dT > -0.6) { biome[i] = Biome.Beach; continue; }

      // --- the Whittaker grid, split by seasonality and substrate ------------
      if (T > 21) {
        if (P > 2050) biome[i] = Biome.TropicalRainforest;
        // Monsoon forest: rainforest totals delivered in a season, so the canopy
        // is deciduous and opens out.
        else if (P > 1150) biome[i] = P < 1650 ? Biome.MonsoonForest : Biome.TropicalForest;
        else if (P > 600) biome[i] = Biome.Savanna;
        else if (P > 250) biome[i] = Biome.Shrubland;
        else biome[i] = desertKind(rel, P, patch, u, v, ws);
      } else if (T > 11) {
        if (P > 1800) biome[i] = Biome.TemperateRainforest;
        else if (P > 900) biome[i] = Biome.TemperateForest;
        // Mediterranean scrub: the dry-summer margin of the temperate belt,
        // recognised by warmth with moderate rain within reach of a coast.
        else if (P > 430) biome[i] = T > 14 && P < 720 && coast < 26 ? Biome.Chaparral : Biome.Grassland;
        else if (P > 220) biome[i] = Biome.Steppe;
        else biome[i] = desertKind(rel, P, patch, u, v, ws);
      } else if (T > 3) {
        if (P > 820) biome[i] = Biome.TemperateForest;
        else if (P > 430) biome[i] = Biome.Grassland;
        else if (P > 240) biome[i] = Biome.Steppe;
        else biome[i] = Biome.ColdDesert;
      } else {
        if (P > 460) biome[i] = Biome.BorealForest;
        else if (P > 200) biome[i] = Biome.Tundra;
        else biome[i] = Biome.ColdDesert;
      }
    }
  }
  return biome;
}

/**
 * Which kind of desert. Relief carves badlands; flat ground lets sand collect
 * into a sand sea; everything between is stone the wind has stripped. Real
 * deserts are mostly the last kind — only about a fifth of the Sahara is dune —
 * so the erg test is strict and masked by patchy noise, which makes sand seas
 * discrete regions instead of a uniform wash.
 */
function desertKind(
  rel: number,
  P: number,
  patch: SphereNoise,
  u: number,
  v: number,
  ws: number,
): number {
  if (rel > 0.13) return Biome.Badlands;
  const sandy = patch.fbm(u + 0.13, v + 0.71, 3.4 * ws, 3);
  if (rel < 0.05 && sandy > 0.12 && P < 170) return Biome.Erg;
  return Biome.Reg;
}
