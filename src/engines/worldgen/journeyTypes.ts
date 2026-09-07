import type { WorldData, WorldParams } from './core/types';
import type { Settlement } from './core/settlements';
import type { TravelOptions } from './core/travel';

/** Creative intent only: paths, durations and generated geography are recalculated. */
export interface WorldJourney {
  id: string;
  name: string;
  stops: { name: string; u: number; v: number }[];
  options: Omit<TravelOptions, 'via'>;
  recipeKey: string;
  createdAt: number;
  updatedAt: number;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Compact deterministic reference; includes generator version, seed, settings and authored edits. */
export function journeyRecipeKey(recipe: { params: WorldParams; edits?: string }): string {
  const text = JSON.stringify(canonical([recipe.params, recipe.edits || '']));
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `journey-v1:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

export function journeyNormalizedStops(stops: Pick<Settlement, 'name' | 'x' | 'y'>[], world: Pick<WorldData, 'width' | 'height'>): WorldJourney['stops'] {
  return stops.map(stop => ({ name: stop.name, u: (((stop.x + 0.5) / world.width) % 1 + 1) % 1, v: Math.max(0, Math.min(1, (stop.y + 0.5) / world.height)) }));
}

/** Resolve geographic positions in the current grid, even if old settlements no longer exist. */
export function journeyStopsForWorld(journey: WorldJourney, world: Pick<WorldData, 'width' | 'height'>): Settlement[] {
  return journey.stops.map((stop, index) => ({
    // Generated settlements use non-negative IDs. These anchors must never select one by accident.
    id: -1_000_000 - index, name: stop.name,
    x: Math.max(0, Math.min(world.width - 1, stop.u * world.width - 0.5)),
    y: Math.max(0, Math.min(world.height - 1, stop.v * world.height - 0.5)),
    culture: 'latin', rank: 'village', population: 0, port: false, river: false, realm: -1, score: 0,
  }));
}
