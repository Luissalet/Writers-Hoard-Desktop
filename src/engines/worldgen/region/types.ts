// ============================================
// Regional sheet — Types
// ============================================
// The layer between the world map (≈20 km per cell) and the town plan (≈5 m).
// A regional sheet is a WINDOW onto the world drawn at ~200 m per cell: the
// scale at which a day's walk is a measurable distance, a wood is a place
// rather than a texture, and a hamlet has a name.
//
// A sheet is DERIVED, never stored. It is a pure function of
// (world seed, world params, window) plus the world's own fields as boundary
// conditions — which is the same storage contract the rest of the engine keeps:
// seed + params + edits, regenerated on demand. Opening the same window twice
// gives byte-identical country, and two adjacent windows agree along their
// shared edge because every synthesised detail is sampled from world
// coordinates, never from sheet coordinates.

import type { CultureId } from '../core/naming';
import type { RuinKind } from '../core/types';

/** Where on the planet the sheet looks, and how wide. */
export interface RegionWindow {
  /** Centre in world cell coordinates (fractional allowed; x wraps). */
  cx: number;
  cy: number;
  /** Width of the sheet on the ground, in kilometres. */
  spanKm: number;
}

export interface RegionParams {
  /** Grid width in sheet cells. Height follows from `aspect`. */
  res: number;
  /** width / height of the sheet. */
  aspect: number;
  /** 0–1: how much sub-world relief is invented. 0.5 ≈ Earth. */
  detail: number;
  /** 0–1: how far the local people have cleared and enclosed the country. */
  settled: number;
  /** Multiplies the number of hamlets, farms and mills. */
  habitation: number;
  /** 0–1 threshold on flow accumulation for a stream to be drawn. */
  streamDensity: number;
}

export const DEFAULT_REGION_PARAMS: RegionParams = {
  res: 640,
  aspect: 1.5,
  detail: 0.85,
  settled: 0.6,
  habitation: 1,
  streamDensity: 0.5,
};

/**
 * Ground cover at regional scale.
 *
 * Deliberately NOT the world's biome list. A biome answers "what climate is
 * this"; regional cover answers "what would I be walking through", which is a
 * different question with a different vocabulary — a temperate forest biome
 * contains wood, coppice, clearing, pasture, arable and heath, and drawing all
 * six as one green wash is exactly what makes a zoomed-in world map look empty.
 */
export const Cover = {
  Sea: 0,
  Lake: 1,
  Marsh: 2,
  /** Seasonally flooded grass along a watercourse. */
  Meadow: 3,
  Wood: 4,
  /** Managed wood: cut on rotation, so lower and more even. */
  Coppice: 5,
  Scrub: 6,
  Heath: 7,
  Moor: 8,
  Grass: 9,
  Pasture: 10,
  Arable: 11,
  Orchard: 12,
  Vineyard: 13,
  /** Bare rock, above the soil line or scoured. */
  Rock: 14,
  Scree: 15,
  Snow: 16,
  /** Sand, ash, salt — ground that supports nothing. */
  Waste: 17,
  Dune: 18,
  Beach: 19,
} as const;
export type CoverId = (typeof Cover)[keyof typeof Cover];
export const COVER_COUNT = 20;

export const COVER_LABEL_ES: Record<number, string> = {
  0: 'mar', 1: 'lago', 2: 'marisma', 3: 'prado de ribera', 4: 'bosque',
  5: 'monte bajo', 6: 'matorral', 7: 'brezal', 8: 'páramo', 9: 'herbazal',
  10: 'pasto', 11: 'labrantío', 12: 'huerta', 13: 'viñedo', 14: 'roca',
  15: 'pedrera', 16: 'nieve', 17: 'erial', 18: 'dunas', 19: 'playa',
};

/** What a regional place is. World settlements keep their own rank. */
export type PlaceKind =
  | 'town'        // a world settlement that fell inside the window
  | 'village'
  | 'hamlet'
  | 'farm'
  | 'mill'
  | 'abbey'
  | 'shrine'
  | 'tower'       // watchpost
  | 'inn'
  | 'quarry'
  | 'mine'
  | 'bridge'
  | 'ford'
  | 'ruin'
  /** A natural feature worth naming: a fall, a spring, a cave, a crag. */
  | 'landmark';

export interface RegionPlace {
  id: number;
  kind: PlaceKind;
  /** Sheet cell coordinates. */
  x: number;
  y: number;
  name: string;
  /** 0–1, drives symbol size and label priority. */
  importance: number;
  /** Set when this place came from the world map rather than the sheet. */
  worldId?: number;
  /** Households, for the ones small enough to count. */
  households?: number;
  culture?: CultureId;
  ruinKind?: RuinKind;
  /** Set on `landmark` places. */
  landmark?: RegionLandmarkKind;
}

/**
 * Natural features that only exist at regional scale.
 *
 * A waterfall is invisible on a world map — it is a hundred metres of a river
 * twenty kilometres long — and it is the single most namable thing in a valley.
 * The same goes for a spring, a gorge and a crag: they are the landmarks people
 * actually navigate by, and no map above about 1:500 000 can show them.
 */
export type RegionLandmarkKind =
  | 'waterfall' | 'spring' | 'gorge' | 'crag' | 'cave' | 'volcano' | 'hotspring'
  | 'lake' | 'island' | 'moss' | 'pass';

export const LANDMARK_ES: Record<RegionLandmarkKind, string> = {
  waterfall: 'Salto', spring: 'Fuente', gorge: 'Garganta', crag: 'Peña',
  cave: 'Cueva', volcano: 'Monte', hotspring: 'Caldas', lake: 'Laguna',
  island: 'Isla', moss: 'Trampal', pass: 'Puerto',
};

/** A watercourse on the sheet, source → mouth, in sheet cell coordinates. */
export interface RegionStream {
  id: number;
  pts: { x: number; y: number }[];
  /** 0–1 discharge at the mouth. */
  flow: number;
  /** Catchment at the mouth, in km². This is what sets the drawn width, because
   *  a river's width is a function of its catchment and not of where it happens
   *  to rank among the other streams on this particular sheet. */
  areaKm2: number;
  /** Carried down from a named world river. */
  name?: string;
  /** True when this is the continuation of a world river rather than local runoff. */
  trunk: boolean;
}

export type TrackKind = 'road' | 'lane' | 'path';

export interface RegionTrack {
  kind: TrackKind;
  pts: { x: number; y: number }[];
  /** Ends that leave the sheet, for the "continues to…" marginal note. */
  exits: ('n' | 's' | 'e' | 'w')[];
  name?: string;
}

/** A hedged or walled enclosure. The thing that makes country look farmed. */
export interface FieldParcel {
  poly: { x: number; y: number }[];
  cover: CoverId;
  /** Strip fields run in bundles and are drawn without cross-hedges. */
  strip: boolean;
}

export interface RegionData {
  window: RegionWindow;
  params: RegionParams;
  /** FULL grid, including the working margin. */
  width: number;
  height: number;
  /**
   * Cells of overhang generated outside the sheet on every side.
   *
   * The sheet the reader sees is the rectangle
   * `(margin, margin) … (width-margin, height-margin)`. Everything else exists
   * only so that the hydrology, the lanes and the field pattern at the edge of
   * the page were computed with the country beyond it in view.
   */
  margin: number;
  /** Ground distance of one sheet cell, in metres. */
  metresPerCell: number;
  /** World cell coordinates of the sheet's top-left corner. */
  originX: number;
  originY: number;
  /** World cells per sheet cell (the same in x and y on the ground). */
  worldPerCellX: number;
  worldPerCellY: number;

  /** Elevation in km, sea level 0 — agrees with the world at world sample points. */
  elevation: Float32Array;
  /** 0 land · 1 sea · 2 lake. */
  water: Uint8Array;
  /** Log-scaled flow accumulation 0–1. */
  flow: Float32Array;
  /** Slope in metres per metre. */
  slope: Float32Array;
  /** 0–1 topographic wetness. */
  wet: Float32Array;
  /** World biome id per sheet cell, after local correction. */
  biome: Uint8Array;
  cover: Uint8Array;

  streams: RegionStream[];
  places: RegionPlace[];
  tracks: RegionTrack[];
  fields: FieldParcel[];
  /** Field boundaries actually drawn — hedge, bank or drystone wall. */
  hedges: { x: number; y: number }[][];
  /** The head-dyke: worked ground on one side, open hill on the other. */
  dykes: { x: number; y: number }[][];

  /** What to print under the title. */
  title: string;
  subtitle: string;
}
