// ============================================
// Rivers — one physical width contract for every LOD
// ============================================
//
// The atlas and the regional canon must not independently decide how large a
// world river is. `WorldRiver.flow` is global, log-scaled discharge: it is the
// river's identity across the slippy pyramid. Local catchment area is still
// the right measure for streams invented inside the canon, but it must never
// demote a world trunk because only one tile of its basin is in memory.

import type { RegionStream } from './types';

/**
 * Bankfull width used by every renderer, in metres.
 *
 * `flow` is logarithmic discharge at a river's mouth.  The old linear law
 * (120…2220 m) made nearly every important river a multi-kilometre estuary all
 * the way back to its source.  A convex curve leaves brooks narrow, separates
 * the great rivers clearly and reserves Amazon-scale widths for flow≈1.
 */
export function worldRiverWidthMetres(flow: number): number {
  const f = Math.max(0, Math.min(1, flow));
  return 24 + 676 * f * f * f;
}

/** Cartographic hairline for a world river when its physical width is below a
 * pixel. Importance remains legible at overview scale without inventing
 * kilometres of water on the ground. */
export function worldRiverMinimumPixels(flow: number): number {
  const f = Math.max(0, Math.min(1, flow));
  return 0.75 + 1.75 * f * f;
}

/** Empirical bankfull width for a stream known only by its local basin. */
export function localStreamWidthMetres(areaKm2: number): number {
  return Math.min(900, 1.6 * Math.pow(Math.max(0.5, areaKm2), 0.47));
}

/** Stable physical width for the regional ink. */
export function streamWidthMetres(stream: Pick<RegionStream, 'areaKm2' | 'worldFlow'>): number {
  const local = localStreamWidthMetres(stream.areaKm2);
  return stream.worldFlow === undefined
    ? local
    : Math.max(local, worldRiverWidthMetres(stream.worldFlow));
}
