// ============================================
// Regional sheet — Ground cover
// ============================================
// The world map answers "what climate is this". A regional sheet has to answer
// "what would I be walking through", and those are different questions with
// different vocabularies. A single temperate-forest cell of the world map is,
// on the ground, wood and coppice and clearing and pasture and arable and heath
// — and drawing all six as one green wash is most of why a zoomed-in world map
// looks like an empty rug.
//
// Cover is built in TWO passes, in the order the country itself was made:
// first what grows there with nobody present, then what people did to it. The
// order matters because habitation is sited on the natural cover — you settle
// where the ground is good — and then changes it.

import { SphereNoise } from '../core/noise';
import { Biome, type WorldData } from '../core/types';
import { Cover, type CoverId, type RegionParams, type RegionPlace } from './types';
import {
  CoarseField, latticeOffset, patchBilinear, patchNearest,
  type RegionGeometry, type TerrainFields, type WorldPatch,
} from './terrain';

/** Treeline in km by absolute latitude — same curve the world classifier uses. */
function treeline(latAbs: number): number {
  return Math.max(0, 3.9 - Math.pow(latAbs / 90, 1.35) * 4.4);
}

const WOODED = new Set<number>([
  Biome.BorealForest, Biome.TemperateForest, Biome.TemperateRainforest,
  Biome.TropicalForest, Biome.TropicalRainforest, Biome.MonsoonForest,
  Biome.CloudForest, Biome.MontaneForest, Biome.RiparianForest, Biome.Mangrove,
  Biome.Bamboo, Biome.Karst, 41,
]);

const DRY = new Set<number>([
  Biome.Desert, Biome.Erg, Biome.Reg, Biome.Badlands, Biome.ColdDesert,
  Biome.SaltFlat, Biome.FogDesert, Biome.Puna, 40, 42,
]);

/** What a biome looks like on the ground when no one has touched it. */
export function naturalOf(b: number): CoverId {
  switch (b) {
    case Biome.Ocean: return Cover.Sea;
    case Biome.Lake: return Cover.Lake;
    case Biome.IceCap:
    case Biome.Glacier: return Cover.Snow;
    case Biome.Alpine: return Cover.Rock;
    case Biome.AlpineMeadow: return Cover.Grass;
    case Biome.Tundra: return Cover.Moor;
    case Biome.Moor: return Cover.Moor;
    case Biome.PeatBog: return Cover.Moor;
    case Biome.Marsh:
    case Biome.SaltMarsh:
    case 43: return Cover.Marsh;
    case Biome.Mangrove: return Cover.Marsh;
    case Biome.Beach: return Cover.Beach;
    case Biome.Erg: return Cover.Dune;
    case Biome.Desert:
    case Biome.Reg:
    case Biome.SaltFlat:
    case Biome.FogDesert:
    case 42: return Cover.Waste;
    case Biome.Badlands:
    case Biome.Volcanic: return Cover.Rock;
    case Biome.AshPlain:
    case 40: return Cover.Waste;
    case Biome.ColdDesert:
    case Biome.Puna: return Cover.Scrub;
    case Biome.Steppe:
    case Biome.Grassland:
    case Biome.Savanna: return Cover.Grass;
    case Biome.Shrubland:
    case Biome.Chaparral:
    case Biome.ThornScrub: return Cover.Scrub;
    default: return WOODED.has(b) ? Cover.Wood : Cover.Grass;
  }
}

export interface CoverPass {
  biome: Uint8Array;
  cover: Uint8Array;
}

/**
 * Biome and natural cover for every sheet cell.
 *
 * The biome is the world's, CORRECTED for the elevation the sheet invented: a
 * peak the world grid smoothed away is genuinely 800 m higher here, and 800 m is
 * five degrees, which is the difference between conifer and bare rock. Without
 * the correction the invented mountains come out clothed in oak to the summit,
 * which is the single most obvious way a fake zoom gives itself away.
 */
export function buildNaturalCover(
  world: WorldData,
  g: RegionGeometry,
  patch: WorldPatch,
  t: TerrainFields,
  params: RegionParams,
): CoverPass {
  const W = g.width, H = g.height, n = W * H;
  const biome = new Uint8Array(n);
  const cover = new Uint8Array(n);
  const seed = world.params.seed;
  const grain = new SphereNoise(seed, 'region-cover');
  const patchy = new SphereNoise(seed, 'region-patch');
  const warpA = new SphereNoise(seed, 'region-warp-a');
  const warpB = new SphereNoise(seed, 'region-warp-b');
  const WW = world.width;
  const EARTH_KM = 2 * Math.PI * 6371;
  // Physical wavelengths, like the relief. `fPatch` decides how big a clearing
  // in a wood is, and tying it to the world grid made the finest clearing five
  // kilometres across — which is not a clearing, it is a county, and it is why
  // the woods came out as a uniform green rug with occasional bald patches.
  const cyc = (km: number) => EARTH_KM / km;
  const fGrain = cyc(9);
  const fPatch = cyc(14);
  const fWarp = WW * 0.75;
  const cellKm = g.metresPerCell / 1000;

  // All four of these are far smoother than one sheet cell, so they are built on
  // a coarse lattice. The step comes from each field's own shortest wavelength,
  // never from a guess: alias one of these and the ground grows staircases.
  const uvAt = (x: number, y: number) => {
    const wy = g.originY + (y + 0.5) * g.worldPerCellY;
    const wx = g.originX + (x + 0.5) * g.worldPerCellX;
    return {
      u: ((wx / WW) % 1 + 1) % 1,
      v: Math.min(1, Math.max(0, wy / world.height)),
    };
  };
  // Shortest wavelength present = base wavelength ÷ lacunarity^(octaves-1).
  // Sampling at 2.5 points per shortest wavelength is comfortably above Nyquist
  // for a field that is then bilinearly interpolated.
  const stepFor = (shortestKm: number) => Math.max(1, Math.floor(shortestKm / (2.5 * cellKm)));
  const top = (baseKm: number, octaves: number) => baseKm / Math.pow(2.1, octaves - 1);
  const warpBaseKm = EARTH_KM / fWarp;
  const sWarpBig = stepFor(top(warpBaseKm, 4));
  const sWarpSmall = stepFor(top(warpBaseKm / 7, 3));
  const sGrain = stepFor(top(9, 3));
  const sPatch = stepFor(top(14, 4));

  // Every lattice is anchored to the world, not to the page — otherwise panning
  // re-samples all four fields at new points and the whole ground changes.
  const oWB = latticeOffset(g, sWarpBig), oWS = latticeOffset(g, sWarpSmall);
  const oG = latticeOffset(g, sGrain), oP = latticeOffset(g, sPatch);
  const warpBigU = new CoarseField(W, H, sWarpBig, (x, y) => { const p = uvAt(x, y); return warpA.fbm(p.u, p.v, fWarp, 4, 2.1, 0.55); }, oWB.ox, oWB.oy);
  const warpBigV = new CoarseField(W, H, sWarpBig, (x, y) => { const p = uvAt(x, y); return warpB.fbm(p.u, p.v, fWarp, 4, 2.1, 0.55); }, oWB.ox, oWB.oy);
  const warpSmU = new CoarseField(W, H, sWarpSmall, (x, y) => { const p = uvAt(x, y); return warpB.fbm(p.u, p.v, fWarp * 7, 3, 2.1, 0.5); }, oWS.ox, oWS.oy);
  const warpSmV = new CoarseField(W, H, sWarpSmall, (x, y) => { const p = uvAt(x, y); return warpA.fbm(p.u, p.v, fWarp * 7, 3, 2.1, 0.5); }, oWS.ox, oWS.oy);
  const grainF = new CoarseField(W, H, sGrain, (x, y) => { const p = uvAt(x, y); return grain.fbm(p.u, p.v, fGrain, 3); }, oG.ox, oG.oy);
  const patchF = new CoarseField(W, H, sPatch, (x, y) => { const p = uvAt(x, y); return patchy.fbm(p.u, p.v, fPatch, 4, 2.1, 0.55); }, oP.ox, oP.oy);

  for (let y = 0; y < H; y++) {
    const wy = g.originY + (y + 0.5) * g.worldPerCellY;
    const v = Math.min(1, Math.max(0, wy / world.height));
    const latAbs = Math.abs(90 - v * 180);
    const tl = treeline(latAbs);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const wx = g.originX + (x + 0.5) * g.worldPerCellX;

      // The world's biome grid is 20 km per cell, so a nearest-neighbour lookup
      // paints the sheet in colossal rectangles — on a 120 km sheet that is SIX
      // squares, with hard right-angled joins, and it is the single most
      // obvious tell that the zoom is fake. Warping the sample point by most of
      // a world cell before the lookup turns those joins into an interlocking
      // boundary that reads as ecology. It cannot be fixed by interpolating,
      // because biome ids are categories: halfway between tundra and desert is
      // not a biome.
      //
      // Two scales, because one is not enough: the big warp interlocks the
      // biome blocks, and the small one fringes the join so it does not read as
      // a single confident line drawn by something that knows where the grid is.
      const wu = warpBigU.at(x, y) * 0.58 + warpSmU.at(x, y) * 0.13;
      const wv = warpBigV.at(x, y) * 0.58 + warpSmV.at(x, y) * 0.13;
      let b = patchNearest(patch, patch.biome, wx + wu, wy + wv);
      const elev = t.elevation[i];
      const worldElev = patchBilinear(patch, patch.elev, wx, wy);
      const dz = elev - worldElev;
      const worldT = patchBilinear(patch, patch.temp, wx, wy);
      const localT = worldT - dz * 6.5;
      const prec = patchBilinear(patch, patch.prec, wx, wy);

      if (t.water[i] === 1) { biome[i] = Biome.Ocean; cover[i] = Cover.Sea; continue; }
      if (t.water[i] === 2) { biome[i] = Biome.Lake; cover[i] = Cover.Lake; continue; }
      if (elev <= 0) { biome[i] = Biome.Ocean; cover[i] = Cover.Sea; continue; }

      // ---- elevation correction on the invented relief ---------------------
      const jitter = grainF.at(x, y) * 0.16;
      if (elev > tl + 0.55 + jitter && localT < -6) b = Biome.Glacier;
      else if (elev > tl + 0.22 + jitter) b = Biome.Alpine;
      else if (elev > tl - 0.12 + jitter && !DRY.has(b)) b = Biome.AlpineMeadow;
      else if (dz > 0.34 && WOODED.has(b) && localT < 9) b = Biome.MontaneForest;
      // A valley the world could not see is warmer, wetter and better sheltered
      // than the ridge it was averaged with, so it grows what the ridge cannot.
      else if (dz < -0.22 && DRY.has(b) && t.wet[i] > 0.42) b = Biome.RiparianForest;

      biome[i] = b;
      let c = naturalOf(b);

      // ---- local terrain overrides ----------------------------------------
      const slope = t.slope[i];
      const wet = t.wet[i];

      if (c !== Cover.Snow && c !== Cover.Sea) {
        if (slope > 0.62 && elev > 0.25) c = Cover.Rock;
        else if (slope > 0.44 && elev > 0.2) c = Cover.Scree;
      }
      if (localT < -9 && prec > 250 && elev > tl + 0.3) c = Cover.Snow;

      // Wet hollows go to marsh; wet FLATS beside a watercourse go to meadow —
      // two different places that a single wetness threshold merges into one
      // ugly green stain across every valley floor.
      if (c !== Cover.Sea && c !== Cover.Lake && c !== Cover.Snow && c !== Cover.Rock) {
        if (wet > 0.9 && slope < 0.012 && prec > 400) c = Cover.Marsh;
        else if (wet > 0.66 && slope < 0.05 && !DRY.has(b)) c = Cover.Meadow;
      }

      // Woodland is patchy, not a fill. Break it with clearings on a scale of a
      // few hundred metres so it reads as forest rather than as a colour.
      if (c === Cover.Wood) {
        const p = patchF.at(x, y);
        if (p < -0.42) c = wet > 0.42 ? Cover.Meadow : Cover.Grass;
        else if (p < -0.24) c = Cover.Scrub;
      } else if (c === Cover.Grass || c === Cover.Scrub) {
        const p = patchF.at(x, y);
        // …and the inverse: even open country carries copses in its hollows.
        if (p > 0.46 && wet > 0.3 && !DRY.has(b) && localT > 0) c = Cover.Wood;
        else if (p > 0.3 && prec > 500 && localT > 2 && localT < 16) c = Cover.Heath;
      }

      cover[i] = c;
    }
  }
  void params;
  return { biome, cover };
}

// ---------------------------------------------------------------------------
// Pass two: what people did to it
// ---------------------------------------------------------------------------

/** Cover that can be cleared for crops, and how willingly. */
const CLEARABLE: Partial<Record<number, number>> = {
  [Cover.Wood]: 0.85,
  [Cover.Coppice]: 0.9,
  [Cover.Scrub]: 1,
  [Cover.Heath]: 0.7,
  [Cover.Grass]: 1,
  [Cover.Meadow]: 0.55,
  [Cover.Moor]: 0.22,
  [Cover.Marsh]: 0.12,
};

export interface FarmedResult {
  cover: Uint8Array;
  /** 0–1 intensity of cultivation, for drawing field density. */
  tilth: Float32Array;
}

/**
 * Clear, enclose and plant the ground around every inhabited place.
 *
 * The pattern this produces is the one every historical map of settled country
 * shows and no procedural map ever seems to: a bright ring of open field around
 * each village, thinning with distance until it gives out into wood or waste,
 * with the wood surviving exactly where the plough could not go — too steep, too
 * wet, too high, too poor. The wood is not decoration; it is the negative space
 * of the farming, which is why placing trees and fields independently always
 * looks wrong.
 */
export function applyHabitation(
  world: WorldData,
  g: RegionGeometry,
  t: TerrainFields,
  natural: CoverPass,
  places: RegionPlace[],
  params: RegionParams,
): FarmedResult {
  const W = g.width, H = g.height, n = W * H;
  const cover = natural.cover.slice();
  const tilth = new Float32Array(n);
  const settled = params.settled;
  if (settled <= 0 || places.length === 0) return { cover, tilth };

  const seed = world.params.seed;
  const grain = new SphereNoise(seed, 'region-farm');
  const WW = world.width;
  const fFarm = WW * 1.4;

  // Reach of cultivation: a medieval village works its land within about an
  // hour's walk, which is 4–5 km. Scale from that, in sheet cells.
  const kmPerCell = g.metresPerCell / 1000;
  for (const p of places) {
    const reachKm = p.kind === 'town' ? 7.5 + p.importance * 7
      : p.kind === 'village' ? 4.6
        : p.kind === 'hamlet' ? 2.9
          : p.kind === 'farm' ? 1.5
            : p.kind === 'abbey' ? 3.4 : 0;
    if (reachKm <= 0) continue;
    const R = reachKm / kmPerCell;
    const x0 = Math.max(0, Math.floor(p.x - R)), x1 = Math.min(W - 1, Math.ceil(p.x + R));
    const y0 = Math.max(0, Math.floor(p.y - R)), y1 = Math.min(H - 1, Math.ceil(p.y + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - p.x, y - p.y) / R;
        if (d >= 1) continue;
        const i = y * W + x;
        const w = (1 - d * d) * (0.55 + p.importance * 0.75);
        if (w > tilth[i]) tilth[i] = w;
      }
    }
  }

  for (let y = 0; y < H; y++) {
    const wy = g.originY + (y + 0.5) * g.worldPerCellY;
    const v = Math.min(1, Math.max(0, wy / world.height));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const base = tilth[i];
      if (base <= 0.01) continue;
      const c = cover[i];
      const ease = CLEARABLE[c];
      if (ease === undefined) { tilth[i] = 0; continue; }

      // What the plough actually cares about.
      const slope = t.slope[i];
      const slopePenalty = slope < 0.08 ? 1 : slope < 0.18 ? 0.72 : slope < 0.3 ? 0.34 : 0.05;
      const wetPenalty = t.wet[i] > 0.78 ? 0.25 : 1;
      const wx = g.originX + (x + 0.5) * g.worldPerCellX;
      const u = ((wx / WW) % 1 + 1) % 1;
      // Ragged edges: a farmed/wild boundary that follows a smooth radius is the
      // giveaway of a generator drawing circles.
      const edge = grain.fbm(u, v, fFarm, 4, 2.05, 0.55) * 0.34;

      const score = base * ease * slopePenalty * wetPenalty * settled + edge;
      tilth[i] = Math.max(0, Math.min(1, score));
      if (score < 0.22) {
        // Untouched, but close enough to a village that the wood is worked.
        if (c === Cover.Wood && score > 0.1) cover[i] = Cover.Coppice;
        continue;
      }
      if (score > 0.62 && slope < 0.14) cover[i] = Cover.Arable;
      else if (score > 0.36) cover[i] = slope > 0.2 || t.wet[i] > 0.55 ? Cover.Pasture : Cover.Arable;
      else cover[i] = Cover.Pasture;
    }
  }

  // Orchards and vines want warmth and a slope facing the sun, and they sit
  // right against the settlement rather than out in the open field.
  const warmEnough = (i: number, wy: number): boolean => {
    const north = wy < world.height / 2;
    const y = (i / W) | 0, x = i % W;
    const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
    const dzdy = t.elevation[yp * W + x] - t.elevation[ym * W + x];
    // In the north the sunny slope faces south, i.e. downhill toward +y.
    return north ? dzdy < -0.0008 : dzdy > 0.0008;
  };
  for (const p of places) {
    if (p.kind !== 'town' && p.kind !== 'village' && p.kind !== 'abbey') continue;
    const R = Math.max(3, (1.4 / kmPerCell));
    const wy = g.originY + p.y * g.worldPerCellY;
    const worldT = patchTempAt(world, g, p.x, p.y);
    for (let y = Math.max(0, Math.floor(p.y - R)); y <= Math.min(H - 1, Math.ceil(p.y + R)); y++) {
      for (let x = Math.max(0, Math.floor(p.x - R)); x <= Math.min(W - 1, Math.ceil(p.x + R)); x++) {
        const i = y * W + x;
        if (cover[i] !== Cover.Arable && cover[i] !== Cover.Pasture) continue;
        if (Math.hypot(x - p.x, y - p.y) > R) continue;
        if (t.slope[i] > 0.35) continue;
        if (worldT > 11 && worldT < 21 && t.slope[i] > 0.06 && warmEnough(i, wy)) cover[i] = Cover.Vineyard;
        else if (worldT > 6 && Math.hypot(x - p.x, y - p.y) < R * 0.55) cover[i] = Cover.Orchard;
      }
    }
  }

  return { cover, tilth };
}

function patchTempAt(world: WorldData, g: RegionGeometry, x: number, y: number): number {
  const wx = g.originX + x * g.worldPerCellX;
  const wy = g.originY + y * g.worldPerCellY;
  const ix = (((Math.round(wx) % world.width) + world.width) % world.width);
  const iy = Math.min(world.height - 1, Math.max(0, Math.round(wy)));
  return world.temperature[iy * world.width + ix];
}
