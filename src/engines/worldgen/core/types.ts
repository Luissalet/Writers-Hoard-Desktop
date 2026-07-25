// ============================================
// World Generator — Core Types
// ============================================
// Pure data definitions shared by the generation pipeline (which runs in a
// Web Worker) and the UI. Nothing in core/ may import React or touch the DOM.

/** User-tunable generation parameters. Deterministic together with `seed`. */
export interface WorldParams {
  /** Free-text seed — hashed into the RNG. Same seed + params ⇒ same world. */
  seed: string;
  /** Grid width in cells. Height is always width / 2 (equirectangular planet). */
  width: number;
  /** Number of tectonic plates (4–24). More plates ⇒ more, smaller continents. */
  plates: number;
  /** Target fraction of the surface that is land (0.1–0.6). */
  landRatio: number;
  /** 0–1: how tightly continental plates cluster. 0 = scattered continents,
   *  1 = everything welds into a pangaea. */
  continentClustering: number;
  /** 0.75–2.5: how BIG the planet feels. Higher = every feature (coastline
   *  wiggles, peninsulas, mountain belts, islands) is smaller relative to
   *  the globe — a more realistic planetary scale. */
  worldScale: number;
  /** 0–1: strength of mountain-building along plate collisions. */
  mountainousness: number;
  /** 0–1: small-scale roughness added on top of the tectonic base. */
  ruggedness: number;
  /** 0–1: how convoluted the coastlines are. This is a real, measurable axis —
   *  it sets the fractal dimension of the shoreline. 0 gives smooth, steep
   *  margins like South Africa (D ≈ 1.02); 0.6 gives Britain (D ≈ 1.25); 1
   *  gives fjord country. Works by domain-warping the landmass field and
   *  raising the fBm gain, not by adding surface noise. */
  coastalComplexity: number;
  /** 0–1: how heavily ice carved the world. Glacial troughs cut BELOW sea level,
   *  which is the only way to get real fjords, hanging valleys and skerries.
   *  0 = an ice-free world; 0.5 = Earth-like; 1 = fjords into the mid-latitudes. */
  glaciation: number;
  /** 0–1: how strongly rivers carve the terrain (erosion iterations). */
  erosion: number;
  /** Global temperature offset in °C (-10 … +10). 0 = Earth-like. */
  temperature: number;
  /** Global rainfall multiplier (0.5 … 1.5). */
  moisture: number;
  /** 0–1: how many rivers are shown (threshold on drainage area). */
  riverDensity: number;
  /** Detect + mark landmarks (volcanoes, caves, waterfalls, gorges, springs). */
  landmarks: boolean;
}

export const DEFAULT_PARAMS: WorldParams = {
  seed: 'new-world',
  width: 2048,
  plates: 12,
  landRatio: 0.32,
  continentClustering: 0.25,
  worldScale: 1.5,
  mountainousness: 0.6,
  ruggedness: 0.5,
  coastalComplexity: 0.68,
  glaciation: 0.55,
  erosion: 0.6,
  temperature: 0,
  moisture: 1.0,
  riverDensity: 0.5,
  landmarks: true,
};

/** Fill any missing fields (worlds saved by older versions of the engine). */
export function normalizeParams(params: Partial<WorldParams>): WorldParams {
  return { ...DEFAULT_PARAMS, ...params };
}

/** Land-cover / biome classification per cell. */
export const Biome = {
  Ocean: 0,
  Lake: 1,
  IceCap: 2,
  Tundra: 3,
  BorealForest: 4,
  TemperateForest: 5,
  TemperateRainforest: 6,
  Grassland: 7,
  Shrubland: 8,
  Savanna: 9,
  TropicalForest: 10,
  TropicalRainforest: 11,
  Desert: 12,
  ColdDesert: 13,
  Alpine: 14,
  Glacier: 15,
  Beach: 16,
  SaltFlat: 17,
  // --- added with the ecology overhaul; appended so existing indices hold ---
  /** Tidal forest on a sheltered warm coast. */
  Mangrove: 18,
  /** Tidal grassland on a sheltered cool coast. */
  SaltMarsh: 19,
  /** Freshwater wetland: reeds, standing water, no trees. */
  Marsh: 20,
  /** Cold waterlogged flatland: sphagnum, peat, pools. */
  PeatBog: 21,
  /** Semi-arid grassland — drier and shorter than prairie. */
  Steppe: 22,
  /** Mediterranean scrub: dry summers, hard evergreen leaves. */
  Chaparral: 23,
  /** Seasonally deciduous tropical forest. */
  MonsoonForest: 24,
  /** Tropical montane forest, permanently in cloud. */
  CloudForest: 25,
  /** The conifer belt below the treeline. */
  MontaneForest: 26,
  /** Turf above the treeline, below the rock. */
  AlpineMeadow: 27,
  /** Sand sea. */
  Erg: 28,
  /** Stone desert, wind-stripped. */
  Reg: 29,
  /** Arid, eroded, high-relief waste. */
  Badlands: 30,
  /** Gallery forest along a river in dry country. */
  RiparianForest: 31,
} as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];
export const BIOME_COUNT = 32;

export type LandmarkType =
  | 'volcano'
  | 'cave'
  | 'waterfall'
  | 'gorge'
  | 'hotspring';

/**
 * What kind of abandoned structure stands on a site.
 *
 * Lives here rather than beside either the ruin generator or the paint engine
 * because both produce ruins — one from geography, one from the brush — and the
 * renderer must not care which.
 */
export type RuinKind = 'city' | 'fort' | 'tower' | 'temple' | 'stones' | 'bridge' | 'mine' | 'wall';

/** What a hand-placed mark on the map represents. */
export type MarkerKind = 'settlement' | 'ruin' | 'landmark';

export interface Landmark {
  type: LandmarkType;
  /** Cell coordinates. */
  x: number;
  y: number;
  /** Relative prominence 0–1 (for sizing / filtering). */
  strength: number;
}

/** A river as a downstream polyline of cell indices with discharge. */
export interface RiverPath {
  /** Cell indices (y*width+x), source → mouth. */
  cells: Uint32Array;
  /** Drainage area (discharge proxy) at the mouth, normalized 0–1. */
  flow: number;
}

/** Everything the pipeline produces. Typed arrays are width*height. */
export interface WorldData {
  width: number;
  height: number;
  params: WorldParams;
  /** Elevation in km; sea level = 0. Negative = ocean floor. */
  elevation: Float32Array;
  /** Plate id per cell. */
  plateId: Uint8Array;
  /** Convergence at plate boundary (for volcano arcs), 0 elsewhere. */
  boundary: Float32Array;
  /** Mean annual temperature, °C (already lapse-adjusted for altitude). */
  temperature: Float32Array;
  /** Annual precipitation, mm. */
  precipitation: Float32Array;
  /** Biome id per cell (includes Ocean / Lake). */
  biome: Uint8Array;
  /** Log-scaled drainage area 0–1 (for flow map view). */
  flow: Float32Array;
  /** 1 where a lake sits above sea level. */
  lake: Uint8Array;
  rivers: RiverPath[];
  landmarks: Landmark[];
  /** Plate kinematics for the plates view (per plate: sx, sy = seed cell; dx, dy = drift). */
  plateInfo: { seedX: number; seedY: number; driftX: number; driftY: number; oceanic: boolean }[];
  /** Ocean surface current, eastward component (0 on land). */
  currentU: Float32Array;
  /** Ocean surface current, southward component (0 on land). */
  currentV: Float32Array;
  /** Sea-surface temperature anomaly in °C from the zonal mean. */
  sst: Float32Array;
  /** Current speed 0–1, for the currents view. */
  currentSpeed: Float32Array;
  /** Ice thickness proxy 0–1 at the glacial maximum. */
  ice: Float32Array;
  /**
   * Bumped every time the world is mutated by an edit. Downstream caches key on
   * it, so a painted stroke cannot leave a stale coastline, biome tint or symbol
   * layout behind — which it did, until this existed.
   */
  revision: number;
  /**
   * What the last `applyEdits` produced that isn't a raster field: hand-placed
   * markers, hand-written labels, hand-drawn rivers.
   *
   * It lives on the world rather than being threaded through every renderer
   * argument list so that a painted town is indistinguishable from a generated
   * one by the time anything draws it.
   */
  painted?: import('./edits').AppliedEdits;
}

export type ViewMode =
  | 'atlas'
  | 'elevation'
  | 'temperature'
  | 'precipitation'
  | 'plates'
  | 'flow'
  | 'currents'
  | 'glaciers';

/** Progress callback: stage key + overall 0–1. */
export type ProgressFn = (stage: string, overall: number) => void;

/** Serializable bundle sent from the worker back to the UI. */
export interface WorldTransfer {
  width: number;
  height: number;
  params: WorldParams;
  elevation: ArrayBuffer;
  plateId: ArrayBuffer;
  boundary: ArrayBuffer;
  temperature: ArrayBuffer;
  precipitation: ArrayBuffer;
  biome: ArrayBuffer;
  flow: ArrayBuffer;
  lake: ArrayBuffer;
  rivers: { cells: ArrayBuffer; flow: number }[];
  landmarks: Landmark[];
  plateInfo: WorldData['plateInfo'];
  currentU: ArrayBuffer;
  currentV: ArrayBuffer;
  sst: ArrayBuffer;
  currentSpeed: ArrayBuffer;
  ice: ArrayBuffer;
  revision: number;
}

export function packWorld(w: WorldData): { transfer: WorldTransfer; buffers: ArrayBuffer[] } {
  const transfer: WorldTransfer = {
    width: w.width,
    height: w.height,
    params: w.params,
    elevation: w.elevation.buffer as ArrayBuffer,
    plateId: w.plateId.buffer as ArrayBuffer,
    boundary: w.boundary.buffer as ArrayBuffer,
    temperature: w.temperature.buffer as ArrayBuffer,
    precipitation: w.precipitation.buffer as ArrayBuffer,
    biome: w.biome.buffer as ArrayBuffer,
    flow: w.flow.buffer as ArrayBuffer,
    lake: w.lake.buffer as ArrayBuffer,
    rivers: w.rivers.map((r) => ({ cells: r.cells.buffer as ArrayBuffer, flow: r.flow })),
    landmarks: w.landmarks,
    plateInfo: w.plateInfo,
    currentU: w.currentU.buffer as ArrayBuffer,
    currentV: w.currentV.buffer as ArrayBuffer,
    sst: w.sst.buffer as ArrayBuffer,
    currentSpeed: w.currentSpeed.buffer as ArrayBuffer,
    ice: w.ice.buffer as ArrayBuffer,
    revision: w.revision,
  };
  const buffers = [
    transfer.elevation,
    transfer.plateId,
    transfer.boundary,
    transfer.temperature,
    transfer.precipitation,
    transfer.biome,
    transfer.flow,
    transfer.lake,
    transfer.currentU,
    transfer.currentV,
    transfer.sst,
    transfer.currentSpeed,
    transfer.ice,
    ...transfer.rivers.map((r) => r.cells),
  ];
  return { transfer, buffers };
}

export function unpackWorld(t: WorldTransfer): WorldData {
  return {
    width: t.width,
    height: t.height,
    params: t.params,
    elevation: new Float32Array(t.elevation),
    plateId: new Uint8Array(t.plateId),
    boundary: new Float32Array(t.boundary),
    temperature: new Float32Array(t.temperature),
    precipitation: new Float32Array(t.precipitation),
    biome: new Uint8Array(t.biome),
    flow: new Float32Array(t.flow),
    lake: new Uint8Array(t.lake),
    rivers: t.rivers.map((r) => ({ cells: new Uint32Array(r.cells), flow: r.flow })),
    landmarks: t.landmarks,
    plateInfo: t.plateInfo,
    currentU: new Float32Array(t.currentU),
    currentV: new Float32Array(t.currentV),
    sst: new Float32Array(t.sst),
    currentSpeed: new Float32Array(t.currentSpeed),
    ice: new Float32Array(t.ice),
    revision: t.revision ?? 0,
  };
}
