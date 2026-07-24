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
  /** 0–1: strength of mountain-building along plate collisions. */
  mountainousness: number;
  /** 0–1: small-scale roughness added on top of the tectonic base. */
  ruggedness: number;
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
  width: 1024,
  plates: 9,
  landRatio: 0.32,
  mountainousness: 0.6,
  ruggedness: 0.5,
  erosion: 0.6,
  temperature: 0,
  moisture: 1.0,
  riverDensity: 0.5,
  landmarks: true,
};

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
} as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];
export const BIOME_COUNT = 18;

export type LandmarkType =
  | 'volcano'
  | 'cave'
  | 'waterfall'
  | 'gorge'
  | 'hotspring';

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
}

export type ViewMode =
  | 'atlas'
  | 'elevation'
  | 'temperature'
  | 'precipitation'
  | 'plates'
  | 'flow';

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
  };
}
