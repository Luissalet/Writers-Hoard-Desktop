// ============================================
// Cartography — Canvas helpers for the app
// ============================================
// Bridges the pure renderer to the browser: builds canvases at a requested
// size, and caches the human geography and the 3D map texture per world so
// panning, switching views and opening the 3D scene never pay for them twice.

import type { WorldData } from '../core/types';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS, type GeoDepth, type HumanGeography, type HumanGeographyParams, type Settlement } from '../core/settlements';
import { renderCartography, type CartoLayers, type CartoView } from './render';
import type { CartoTheme } from './theme';
import type { Ctx } from './symbols';

// A world object is identity-stable for as long as it is loaded, so a WeakMap
// keyed on it is exactly the right cache lifetime.
interface GeoEntry {
  key: string;
  rev: number;
  geo: HumanGeography;
  /** The last FULLY rebuilt geography, and the revision it was built at. */
  base: HumanGeography;
  baseRev: number;
  /** How much of the human world this entry actually contains. */
  depth: GeoDepth;
}

/** A cached entry answers a request when it holds at least as much as it asks for. */
function covers(entry: GeoEntry, depth: GeoDepth): boolean {
  return entry.depth === 'full' || depth === 'places';
}
const GEO_CACHE = new WeakMap<WorldData, GeoEntry>();

/**
 * Human geography for a world.
 *
 * Building it fully costs ~4 s on a 1024-wide world: cultures, a language
 * family with regular sound changes, settlement siting, realms by flood fill,
 * roads by A*, landform extraction, ruin siting and 176 place names. Keying the
 * cache on the world's revision therefore meant that every single brush stroke
 * spent four seconds recomputing the languages of a planet because the reader
 * had raised two hundred cells of ground — which is most of what "va lentillo"
 * was actually made of.
 *
 * So a stroke gets a PATCH, not a rebuild: painted marks appear immediately and
 * anything that drowned disappears, while roads, realms and names stay as they
 * were. `rebuildGeography` forces the full pass when it is genuinely wanted —
 * the caller schedules it once the reader stops painting.
 */
export function getGeography(
  world: WorldData,
  depth: GeoDepth = 'full',
  params: HumanGeographyParams = DEFAULT_HUMAN_PARAMS,
): HumanGeography {
  const key = JSON.stringify(params);
  const rev = world.revision ?? 0;
  const hit = GEO_CACHE.get(world);
  // A deeper entry answers a shallower question, so opening the 3D world after
  // the carta never throws away the expensive half and builds it again.
  if (hit && hit.key === key && covers(hit, depth)) {
    if (hit.rev === rev) return hit.geo;
    const geo = patchGeography(world, hit.base);
    GEO_CACHE.set(world, { ...hit, rev, geo });
    return geo;
  }
  // The base is built WITHOUT the reader's corrections and the patch applies
  // them, so that the patch can also apply none — see `buildHumanGeography`.
  const base = buildHumanGeography(world, params, depth, false);
  const geo = patchGeography(world, base);
  GEO_CACHE.set(world, { key, rev, geo, base, baseRev: rev, depth });
  return geo;
}

/** Force the full pass at this depth and adopt the result as the new base. */
export function rebuildGeography(
  world: WorldData,
  depth: GeoDepth = 'full',
  params: HumanGeographyParams = DEFAULT_HUMAN_PARAMS,
): HumanGeography {
  const key = JSON.stringify(params);
  const rev = world.revision ?? 0;
  // Never downgrade: a rebuild asked for the dots must not discard the roads,
  // the named seas and the ruins if the reader has already paid for them.
  const hit = GEO_CACHE.get(world);
  const want: GeoDepth = hit && hit.key === key && hit.depth === 'full' ? 'full' : depth;
  const base = buildHumanGeography(world, params, want, false);
  const geo = patchGeography(world, base);
  GEO_CACHE.set(world, { key, rev, geo, base, baseRev: rev, depth: want });
  return geo;
}

/**
 * True when what is cached is not good enough for what is being asked.
 *
 * Two ways to fall short: it is a cheap patch of an older revision, or it was
 * built shallow and the caller now wants the whole thing.
 */
export function geographyIsStale(world: WorldData, depth: GeoDepth = 'full'): boolean {
  const hit = GEO_CACHE.get(world);
  if (!hit) return false;
  return hit.baseRev !== (world.revision ?? 0) || !covers(hit, depth);
}

/**
 * Cheap update of a geography after an edit.
 *
 * Everything here is O(settlements + ruins), which on any world is a few hundred
 * items. Nothing that costs a pass over the grid is allowed in this function.
 */
function patchGeography(world: WorldData, base: HumanGeography): HumanGeography {
  const W = world.width, H = world.height;
  const at = (x: number, y: number) => {
    const yy = Math.min(H - 1, Math.max(0, Math.round(y)));
    return yy * W + (((Math.round(x) % W) + W) % W);
  };
  const drowned = (x: number, y: number) => world.elevation[at(x, y)] <= 0;
  const kOf = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;

  // The reader's renames and deletions apply on the cheap path too, or a rename
  // would visibly disappear for two seconds after every brush stroke and come
  // back when the full rebuild landed.
  const ren = world.painted?.renames ?? {};
  const gone = world.painted?.removed ?? new Set<string>();
  const fix = <T extends { x: number; y: number; name: string }>(list: T[], target: 'settlement' | 'ruin'): T[] =>
    list.filter((o) => !gone.has(`${target}:${Math.round(o.x)},${Math.round(o.y)}`))
      .map((o) => {
        const n = ren[`${target}:${Math.round(o.x)},${Math.round(o.y)}`];
        return n ? { ...o, name: n } : o;
      });
  const settlements = fix(base.settlements.filter((s) => !drowned(s.x, s.y)), 'settlement');
  const ruins = fix(base.ruins.filter((r) => !drowned(r.x, r.y)), 'ruin');
  const haveS = new Set(settlements.map((s) => kOf(s.x, s.y)));
  const haveR = new Set(ruins.map((r) => kOf(r.x, r.y)));

  let nextId = settlements.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  for (const m of world.painted?.markers ?? []) {
    const k = kOf(m.x, m.y);
    if (m.marker === 'settlement') {
      if (haveS.has(k) || drowned(m.x, m.y)) continue;
      haveS.add(k);
      const rank = m.rank ?? 'town';
      settlements.push({
        id: nextId++,
        x: Math.round(m.x), y: Math.round(m.y),
        // Named on the next full pass, when the language machinery is running.
        name: m.name ?? '·',
        culture: settlements[0]?.culture ?? 'imperial',
        rank,
        population: m.population
          ?? (rank === 'capital' ? 42000 : rank === 'city' ? 16000 : rank === 'town' ? 3800 : 700),
        port: false,
        river: false,
        realm: base.realmOf[at(m.x, m.y)] ?? -1,
        score: 1,
        painted: true,
      });
    } else if (m.marker === 'ruin') {
      if (haveR.has(k) || drowned(m.x, m.y)) continue;
      haveR.add(k);
      ruins.push({
        id: ruins.length,
        kind: m.ruin ?? 'city',
        x: Math.round(m.x), y: Math.round(m.y),
        name: m.name ?? '·',
        condition: 'overgrown',
        site: 'holy',
        importance: 0.72,
        painted: true,
      });
    }
  }

  // Roads and realm borders are left exactly as they were: they are wrong in the
  // painted area until the next full pass, and being wrong for a second beats
  // being right four seconds after every stroke.
  const features = base.features
    .filter((f) => !gone.has(`feature:${f.kind}:${Math.round(f.x)},${Math.round(f.y)}`))
    .map((f) => {
      const n = ren[`feature:${f.kind}:${Math.round(f.x)},${Math.round(f.y)}`];
      return n ? { ...f, name: n } : f;
    });
  const realms = base.realms.map((r) => {
    const n = ren[`realm:${r.id}`];
    return n ? { ...r, name: n } : r;
  });
  return { ...base, settlements, ruins, features, realms };
}

export interface CartoCanvasOptions {
  /** GPU base pass, when the caller has one. */
  drawBase?: (w: number, h: number, view: CartoView) => CanvasImageSource | null;
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
    drawBase: opts.drawBase,
  });
  return canvas;
}

const TEX_CACHE = new WeakMap<WorldData, { rev: number; map: Map<string, HTMLCanvasElement> }>();

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
  const rev = world.revision ?? 0;
  let entry = TEX_CACHE.get(world);
  if (!entry || entry.rev !== rev) TEX_CACHE.set(world, (entry = { rev, map: new Map() }));
  const per = entry.map;
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
