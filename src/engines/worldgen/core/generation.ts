// ============================================
// World Generator — Generation filters
// ============================================
// What a world is ALLOWED to contain, as data.
//
// The obvious way to let a reader turn a biome off is to delete it from the
// classifier. That is wrong twice: the classifier is a cascade of conditions, so
// removing a branch changes what the branches below it catch, and the reader who
// turns off "sand sea" does not want the ground to become ocean — they want
// whatever that country would have been in a world without sand seas.
//
// So nothing is ever deleted. Every disableable thing has a SUBSTITUTION CHAIN,
// and a disabled result falls down its chain until it reaches something allowed.
// Turning off every desert leaves steppe; turning off steppe as well leaves
// grassland; turning off literally everything leaves the one biome that can never
// be disabled, because a cell has to be something.

import { Biome, EXOTIC_BIOMES, type RuinKind } from './types';
import type { LandformKind } from './landforms';
import type { RuinSite } from './ruins';

export interface GenerationFilters {
  /** Biome id → false to forbid it. Absent means allowed. */
  biomes: Record<number, boolean>;
  /** Ruin structure kinds the world may contain. */
  ruinKinds: Record<string, boolean>;
  /** Why a ruin may exist. Turning off "cumbre" removes hilltop towers. */
  ruinSites: Record<string, boolean>;
  /** Which landforms get extracted and named. */
  landforms: Record<string, boolean>;
  /** Landmark types (volcanoes, caves, waterfalls…). */
  landmarks: Record<string, boolean>;
  /** 0 = strictly plausible ecology; 1 = the strange biomes are on. */
  exotic: number;
  /** Multiplier on how many ruins the world gets. */
  ruinDensity: number;
}

export const DEFAULT_FILTERS: GenerationFilters = {
  biomes: {},
  ruinKinds: {},
  ruinSites: {},
  landforms: {},
  landmarks: {},
  exotic: 0,
  ruinDensity: 1,
};

/**
 * Where each biome falls back to when it is not allowed.
 *
 * Every chain has to terminate somewhere that is always permitted, and the
 * terminator is Grassland on land and Ocean in water — a cell must be something.
 * The chains follow ECOLOGICAL adjacency, not visual similarity: a sand sea
 * without sand is stone waste, a stone waste without stone is plain desert, a
 * desert that is not allowed is the steppe that borders it.
 */
const FALLBACK: Record<number, number> = {
  [Biome.Erg]: Biome.Reg,
  [Biome.Reg]: Biome.Desert,
  [Biome.Badlands]: Biome.Desert,
  [Biome.Desert]: Biome.Steppe,
  [Biome.ColdDesert]: Biome.Steppe,
  [Biome.SaltFlat]: Biome.Desert,
  [Biome.Steppe]: Biome.Grassland,
  [Biome.Shrubland]: Biome.Grassland,
  [Biome.Chaparral]: Biome.Shrubland,
  [Biome.ThornScrub]: Biome.Shrubland,
  [Biome.FogDesert]: Biome.Desert,
  [Biome.Savanna]: Biome.Grassland,

  [Biome.TropicalRainforest]: Biome.TropicalForest,
  [Biome.MonsoonForest]: Biome.TropicalForest,
  [Biome.TropicalForest]: Biome.TemperateForest,
  [Biome.CloudForest]: Biome.MontaneForest,
  [Biome.MontaneForest]: Biome.BorealForest,
  [Biome.TemperateRainforest]: Biome.TemperateForest,
  [Biome.BorealForest]: Biome.TemperateForest,
  [Biome.RiparianForest]: Biome.Grassland,
  [Biome.Bamboo]: Biome.MonsoonForest,
  [Biome.Karst]: Biome.TropicalForest,
  [Biome.TemperateForest]: Biome.Grassland,

  [Biome.Mangrove]: Biome.SaltMarsh,
  [Biome.SaltMarsh]: Biome.Marsh,
  [Biome.GlowMarsh]: Biome.Marsh,
  [Biome.Marsh]: Biome.Grassland,
  [Biome.PeatBog]: Biome.Moor,
  [Biome.Moor]: Biome.Tundra,
  [Biome.Tundra]: Biome.Grassland,

  [Biome.Glacier]: Biome.Alpine,
  [Biome.IceCap]: Biome.Tundra,
  [Biome.AlpineMeadow]: Biome.Alpine,
  [Biome.Alpine]: Biome.Tundra,
  [Biome.Puna]: Biome.ColdDesert,

  [Biome.Volcanic]: Biome.Badlands,
  [Biome.AshPlain]: Biome.Reg,
  [Biome.PetrifiedForest]: Biome.Badlands,
  [Biome.FungalForest]: Biome.TemperateRainforest,
  [Biome.CrystalFlats]: Biome.SaltFlat,

  [Biome.Beach]: Biome.Grassland,
  [Biome.Lake]: Biome.Marsh,
};

/** Biomes that can never be turned off: the world needs somewhere to land. */
const ALWAYS: number[] = [Biome.Ocean, Biome.Grassland];

/**
 * The allowed biome nearest to `b`.
 *
 * Walks the fallback chain with a visited set, because a mis-edited chain that
 * loops must degrade to the terminator rather than hang the generator.
 */
export function resolveBiome(b: number, f: GenerationFilters): number {
  if (ALWAYS.includes(b)) return b;
  const exoticOff = f.exotic <= 0 && EXOTIC_BIOMES.includes(b);
  if (f.biomes[b] !== false && !exoticOff) return b;
  const seen = new Set<number>([b]);
  let cur = b;
  for (let i = 0; i < 24; i++) {
    const next = FALLBACK[cur];
    if (next === undefined || seen.has(next)) return Biome.Grassland;
    seen.add(next);
    cur = next;
    if (ALWAYS.includes(cur)) return cur;
    if (f.biomes[cur] !== false && !(f.exotic <= 0 && EXOTIC_BIOMES.includes(cur))) return cur;
  }
  return Biome.Grassland;
}

export function ruinKindAllowed(k: RuinKind, f: GenerationFilters): boolean {
  return f.ruinKinds[k] !== false;
}

export function ruinSiteAllowed(s: RuinSite, f: GenerationFilters): boolean {
  return f.ruinSites[s] !== false;
}

export function landformAllowed(k: LandformKind, f: GenerationFilters): boolean {
  return f.landforms[k] !== false;
}

export function landmarkAllowed(k: string, f: GenerationFilters): boolean {
  return f.landmarks[k] !== false;
}

/** Spanish labels for the UI, so the option list is not a row of enum names. */
export const BIOME_LABEL_ES: Record<number, string> = {
  [Biome.Ocean]: 'Océano', [Biome.Lake]: 'Lago', [Biome.IceCap]: 'Casquete polar',
  [Biome.Tundra]: 'Tundra', [Biome.BorealForest]: 'Bosque boreal',
  [Biome.TemperateForest]: 'Bosque templado', [Biome.TemperateRainforest]: 'Selva templada',
  [Biome.Grassland]: 'Pradera', [Biome.Shrubland]: 'Matorral', [Biome.Savanna]: 'Sabana',
  [Biome.TropicalForest]: 'Bosque tropical', [Biome.TropicalRainforest]: 'Selva tropical',
  [Biome.Desert]: 'Desierto', [Biome.ColdDesert]: 'Desierto frío', [Biome.Alpine]: 'Roca alpina',
  [Biome.Glacier]: 'Glaciar', [Biome.Beach]: 'Playa', [Biome.SaltFlat]: 'Salar',
  [Biome.Mangrove]: 'Manglar', [Biome.SaltMarsh]: 'Marisma salada', [Biome.Marsh]: 'Marisma',
  [Biome.PeatBog]: 'Turbera', [Biome.Steppe]: 'Estepa', [Biome.Chaparral]: 'Chaparral',
  [Biome.MonsoonForest]: 'Bosque monzónico', [Biome.CloudForest]: 'Bosque nuboso',
  [Biome.MontaneForest]: 'Bosque montano', [Biome.AlpineMeadow]: 'Pradera alpina',
  [Biome.Erg]: 'Mar de arena', [Biome.Reg]: 'Hamada', [Biome.Badlands]: 'Cárcavas',
  [Biome.RiparianForest]: 'Bosque de ribera',
  [Biome.Karst]: 'Karst', [Biome.Bamboo]: 'Bambusal', [Biome.FogDesert]: 'Desierto de niebla',
  [Biome.ThornScrub]: 'Espinar', [Biome.Moor]: 'Páramo', [Biome.Puna]: 'Puna',
  [Biome.Volcanic]: 'Malpaís volcánico', [Biome.AshPlain]: 'Llanura de ceniza',
  [Biome.PetrifiedForest]: 'Bosque petrificado', [Biome.FungalForest]: 'Bosque fúngico',
  [Biome.CrystalFlats]: 'Llanos de cristal', [Biome.GlowMarsh]: 'Marisma luminosa',
};
