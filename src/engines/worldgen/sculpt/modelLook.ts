// The tabletop model's choices that more than one module reads: when the
// painted skin's trees stand up, and how thick a paper sheet of the paper
// block is.

import type { WorldData } from '../core/types';
import type { StageStyle } from './diorama';

/** On the tabletop stage of the plane, the painted skin's trees stand up as little models. */
export function standingTrees(skin: string, shape: string, stage: StageStyle): boolean {
  return skin === 'pintado' && shape === 'plane' && stage === 'maqueta';
}

/**
 * The thickness of one paper sheet for the paper block, in km: about fourteen
 * sheets from the sea to the highest ground, rounded to a figure a model maker
 * would cut (50 m to 1 km).
 */
const PAPER_STEPS = new WeakMap<WorldData, { revision: number; km: number }>();
export const NICE_SHEETS_KM = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1] as const;
export function paperSheetKm(world: WorldData): number {
  const revision = world.revision ?? 0;
  const cached = PAPER_STEPS.get(world);
  if (cached && cached.revision === revision) return cached.km;
  let top = 0;
  for (let i = 0; i < world.elevation.length; i++) if (world.elevation[i] > top) top = world.elevation[i];
  const want = top / 14;
  const km = NICE_SHEETS_KM.find((n) => n >= want) ?? NICE_SHEETS_KM[NICE_SHEETS_KM.length - 1];
  PAPER_STEPS.set(world, { revision, km });
  return km;
}
