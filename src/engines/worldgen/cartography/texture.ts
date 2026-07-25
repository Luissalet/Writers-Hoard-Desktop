// ============================================
// Cartography — Canvas helpers for the app
// ============================================
// Bridges the pure renderer to the browser: builds canvases at a requested
// size, and caches the human geography and the 3D map texture per world so
// panning, switching views and opening the 3D scene never pay for them twice.

import type { WorldData } from '../core/types';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS, type HumanGeography, type HumanGeographyParams, type Settlement } from '../core/settlements';
import { renderCartography, type CartoLayers, type CartoView } from './render';
import type { CartoTheme } from './theme';
import type { Ctx } from './symbols';

// A world object is identity-stable for as long as it is loaded, so a WeakMap
// keyed on it is exactly the right cache lifetime.
const GEO_CACHE = new WeakMap<WorldData, { key: string; geo: HumanGeography }>();

/** Human geography for a world, computed at most once per parameter set. */
export function getGeography(world: WorldData, params: HumanGeographyParams = DEFAULT_HUMAN_PARAMS): HumanGeography {
  const key = JSON.stringify(params);
  const hit = GEO_CACHE.get(world);
  if (hit && hit.key === key) return hit.geo;
  const geo = buildHumanGeography(world, params);
  GEO_CACHE.set(world, { key, geo });
  return geo;
}

export interface CartoCanvasOptions {
  theme: CartoTheme;
  width: number;
  height: number;
  view?: CartoView;
  layers?: Partial<CartoLayers>;
  density?: number;
  reliefAmount?: number;
  typeScale?: number;
  title?: string;
  subtitle?: string;
  geography?: HumanGeography;
}

/** Render the cartographic map into a fresh canvas. */
export function renderCartoCanvas(world: WorldData, opts: CartoCanvasOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(opts.width));
  canvas.height = Math.max(1, Math.round(opts.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  renderCartography(world, ctx as unknown as Ctx, {
    theme: opts.theme,
    width: canvas.width,
    height: canvas.height,
    view: opts.view,
    layers: opts.layers,
    density: opts.density,
    reliefAmount: opts.reliefAmount,
    typeScale: opts.typeScale,
    title: opts.title,
    subtitle: opts.subtitle,
    geography: opts.geography,
  });
  return canvas;
}

const TEX_CACHE = new WeakMap<WorldData, Map<string, HTMLCanvasElement>>();

/**
 * Whole-world cartographic texture for the 3D view.
 *
 * Raster relief shading is deliberately OFF: the scene's own lights provide the
 * form, and baking a second NW hillshade into the texture would double-shade
 * every slope. The symbol layer keeps its own internal shading, which is what
 * relief-shaded cartography looks like.
 *
 * Furniture is off too — a compass rose and a title cartouche painted onto a
 * globe follow the terrain and read as graffiti.
 */
export function getCartoTexture(
  world: WorldData,
  theme: CartoTheme,
  geography: HumanGeography | undefined,
  size = 2048,
): HTMLCanvasElement {
  let per = TEX_CACHE.get(world);
  if (!per) TEX_CACHE.set(world, (per = new Map()));
  const key = `${theme.id}:${size}:${geography ? 'geo' : 'bare'}`;
  const hit = per.get(key);
  if (hit) return hit;

  const canvas = renderCartoCanvas(world, {
    theme,
    width: size,
    height: size / 2,
    geography,
    layers: {
      shading: false,
      frame: false,
      compass: false,
      scaleBar: false,
      graticule: false,
      labels: false,
      borders: false,
    },
    density: 1,
    typeScale: 1,
  });
  per.set(key, canvas);
  return canvas;
}

/** Nearest settlement to a normalized map coordinate, within `maxCells`. */
export function pickSettlement(
  world: WorldData,
  geo: HumanGeography,
  u: number,
  v: number,
  maxCells = 24,
): Settlement | null {
  const x = u * world.width;
  const y = v * world.height;
  let best: Settlement | null = null;
  let bestD = maxCells * maxCells;
  for (const s of geo.settlements) {
    let dx = Math.abs(s.x - x);
    if (dx > world.width / 2) dx = world.width - dx;
    const dy = s.y - y;
    // Bias the pick toward bigger places: two towns close together should
    // resolve to the one the reader is more likely to have aimed at.
    const rankBonus = s.rank === 'capital' ? 0.45 : s.rank === 'city' ? 0.65 : s.rank === 'town' ? 0.85 : 1;
    const d = (dx * dx + dy * dy) * rankBonus;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/** City parameters derived from a settlement's place in the world. */
export function cityParamsFor(world: WorldData, s: Settlement): {
  seed: string; name: string; size: number; walls: boolean; citadel: boolean;
  river: boolean; coast: boolean; farms: boolean; culture: Settlement['culture'];
  population: number;
} {
  const size = s.rank === 'capital' ? 34 : s.rank === 'city' ? 22 : s.rank === 'town' ? 13 : 7;
  return {
    seed: `${world.params.seed}::city::${s.id}`,
    name: s.name,
    size,
    walls: s.rank !== 'village',
    citadel: s.rank === 'capital' || s.rank === 'city',
    river: s.river,
    coast: s.port,
    farms: true,
    culture: s.culture,
    population: s.population,
  };
}
