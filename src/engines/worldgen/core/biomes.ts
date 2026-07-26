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
import { DEFAULT_FILTERS, resolveBiome, type GenerationFilters } from './generation';

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
  /** Sea-surface temperature anomaly, for fog deserts. Optional. */
  sst?: Float32Array;
  /** Plate-boundary convergence, for volcanic and karst country. Optional. */
  boundary?: Float32Array;
  /** What the world is allowed to contain. */
  filters?: GenerationFilters;
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
  const rock = new SphereNoise(params.seed, 'biome-rock');
  const ws = params.worldScale;
  const filters = inputs.filters ?? DEFAULT_FILTERS;
  const sst = inputs.sst, boundary = inputs.boundary;
  // Every write goes through the filter, so a disabled biome becomes the nearest
  // thing the reader still allows instead of a hole in the map.
  const put = (i: number, b: number) => { biome[i] = resolveBiome(b, filters); };
  const exotic = filters.exotic;

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

      if (e <= 0) { put(i, Biome.Ocean); continue; }
      if (lake[i]) {
        put(i, temperature[i] < -11 ? Biome.IceCap
          : precipitation[i] < 260 && temperature[i] > 12 ? Biome.SaltFlat
            : Biome.Lake);
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
      if (T < -11) { put(i, Biome.IceCap); continue; }

      // --- the mountain sequence --------------------------------------------
      // Read from the top down: each band is defined by being below the one above.
      if (e > tl + 1.15 && T < 2) { put(i, P > 900 ? Biome.Glacier : Biome.Alpine); continue; }
      if (e > tl + 0.45) { put(i, Biome.Alpine); continue; }
      if (e > tl) {
        // Above the trees, below the rock: turf, cushion plants, snowmelt.
        put(i, P > 350 ? Biome.AlpineMeadow : Biome.Alpine);
        continue;
      }
      if (e > tl - 0.75 && e > 0.6 && P > 500) {
        // The montane belt: conifers standing where the broadleaf forest below
        // has already given up.
        put(i, T > 17 && P > 1500 ? Biome.CloudForest : Biome.MontaneForest);
        continue;
      }
      if (T < -2) {
        put(i, P > 520 && rel < 0.12 ? Biome.PeatBog : Biome.Tundra);
        continue;
      }

      // --- water-logged ground ----------------------------------------------
      // Wetland needs water arriving and nowhere for it to go: a big river or
      // heavy rain, on ground flat enough to pond.
      const flat = rel < 0.055;
      if (flat && e < 0.45 && (fl > 0.55 || (P > 1500 && fl > 0.3))) {
        if (coast < 2.5 && T > 19) { put(i, Biome.Mangrove); continue; }
        if (coast < 2.5) { put(i, Biome.SaltMarsh); continue; }
        put(i, T < 6 ? Biome.PeatBog : Biome.Marsh);
        continue;
      }
      // A sheltered warm coast grows mangrove even without a river behind it.
      if (coast < 1.6 && e < 0.06 && T > 20 && P > 1100) { put(i, Biome.Mangrove); continue; }
      if (coast < 1.6 && e < 0.05 && T > 4 && P > 800 && flat) { put(i, Biome.SaltMarsh); continue; }

      // --- riparian corridor -------------------------------------------------
      // A gallery forest along a major river, but ONLY where the surrounding
      // country is too dry to grow one anyway. Anywhere else it is invisible, and
      // painting it regardless would just thicken every river into a green line.
      if (fl > 0.62 && P < 700 && T > 4 && e < 1.4) { put(i, Biome.RiparianForest); continue; }

      // --- beaches: patchy, not a continuous ring ---------------------------
      if (e < 0.03 && T > 9 && P < 1900 && coast < 1.6 && dT > -0.6) { put(i, Biome.Beach); continue; }

      // --- rock, fire and fog: country the climate alone cannot explain -----
      // A limestone belt, a young volcano and a cold current each override the
      // climate rule that would otherwise apply, because the SUBSTRATE decides.
      const bnd = boundary ? boundary[i] : 0;
      if (bnd > 0.42 && e > 0.25 && patch.fbm(u + 0.61, v + 0.17, 6 * ws, 2) > 0.28) {
        put(i, T > 0 ? Biome.Volcanic : Biome.Alpine);
        continue;
      }
      if (bnd > 0.3 && rel < 0.09 && P < 900 && patch.fbm(u + 0.44, v + 0.9, 5 * ws, 2) > 0.34) {
        put(i, Biome.AshPlain);
        continue;
      }
      // Karst: soluble rock needs water to dissolve it, so it only shows in the wet.
      const soluble = rock.fbm(u + 0.23, v + 0.41, 3.1 * ws, 3);
      if (soluble > 0.3 && P > 1200 && T > 8 && e > 0.15 && e < 1.6) {
        put(i, Biome.Karst);
        continue;
      }
      // Fog desert: no rain at all, but a cold current offshore. The Atacama and
      // the Namib both exist for this reason and neither is explicable from
      // rainfall alone.
      if (P < 190 && coast < 5 && sst && sst[i] < -1.2 && T > 8) {
        put(i, Biome.FogDesert);
        continue;
      }
      if (exotic > 0) {
        const weird = patch.fbm(u + 0.77, v + 0.31, 2.6 * ws, 3);
        if (weird > 1.02 - exotic * 0.55) {
          if (P > 1400 && T > 4 && e < 1.2) { put(i, Biome.FungalForest); continue; }
          if (P < 220 && rel < 0.05) { put(i, Biome.CrystalFlats); continue; }
          if (P < 400 && rel > 0.06) { put(i, Biome.PetrifiedForest); continue; }
          if (flat && fl > 0.4) { put(i, Biome.GlowMarsh); continue; }
        }
      }

      // --- the Whittaker grid, split by seasonality and substrate ------------
      if (T > 21) {
        if (P > 2050) put(i, Biome.TropicalRainforest);
        // Monsoon forest: rainforest totals delivered in a season, so the canopy
        // is deciduous and opens out.
        else if (P > 1150) put(i, P < 1650 ? Biome.MonsoonForest : Biome.TropicalForest);
        // Bamboo takes the wet edge of the seasonal belt, where forest cut down
        // grows back faster than anything else can claim the ground. It has to be
        // tested BEFORE savanna: placed after, its P > 900 condition could never
        // be reached, because savanna had already claimed everything above 600.
        else if (P > 900 && patch.fbm(u + 0.2, v + 0.5, 4 * ws, 2) > 0.35) put(i, Biome.Bamboo);
        else if (P > 600) put(i, Biome.Savanna);
        else if (P > 250) put(i, T > 24 ? Biome.ThornScrub : Biome.Shrubland);
        else put(i, desertKind(rel, P, patch, u, v, ws));
      } else if (T > 11) {
        if (P > 1800) put(i, Biome.TemperateRainforest);
        else if (P > 900) put(i, Biome.TemperateForest);
        // Mediterranean scrub: the dry-summer margin of the temperate belt,
        // recognised by warmth with moderate rain within reach of a coast.
        else if (P > 430) put(i, T > 14 && P < 720 && coast < 26 ? Biome.Chaparral : Biome.Grassland);
        else if (P > 220) put(i, Biome.Steppe);
        else put(i, desertKind(rel, P, patch, u, v, ws));
      } else if (T > 3) {
        // Moor: cool, wet, high and acid. Not a forest that failed — a distinct
        // country, and the one most of northern Europe actually looks like.
        if (P > 900 && e > 0.35 && rel < 0.1) put(i, Biome.Moor);
        else if (P > 820) put(i, Biome.TemperateForest);
        else if (P > 430) put(i, Biome.Grassland);
        else if (P > 240) put(i, Biome.Steppe);
        else put(i, Biome.ColdDesert);
      } else {
        // Puna: cold and dry but HIGH and low-latitude — the altiplano, which is
        // neither tundra nor cold desert and reads as neither on a map.
        if (P < 420 && e > 2.6 && latAbs < 35) put(i, Biome.Puna);
        else if (P > 460) put(i, Biome.BorealForest);
        else if (P > 200) put(i, Biome.Tundra);
        else put(i, Biome.ColdDesert);
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
