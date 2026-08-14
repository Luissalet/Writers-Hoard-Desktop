// ============================================
// Regional sheet — Generation
// ============================================
// Between the world map (≈20 km per cell) and the town plan (≈5 m) there is a
// gap of four orders of magnitude, and it is exactly the range at which stories
// happen: a day's ride, the next valley, the ford the army has to cross. This
// module fills it.
//
// A sheet is a pure function of (world, window, params). Nothing is stored;
// opening the same window twice produces the same country, and opening the
// window next door produces country that lines up along the shared edge. That
// is the same contract the world itself keeps — seed + params + edits — applied
// one scale down.

import { scaleCount } from '@/utils/capacity';
import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import { buildNaturalCover, applyHabitation } from './cover';
import { buildHabitation, siteAllower } from './places';
import { buildTracks } from './tracks';
import { buildFields } from './fields';
import { buildLandmarks } from './landmarks';
import {
  buildElevation, buildHydrology, carveWorldRivers, erodeSheet, extractStreams,
  patchBilinear, type WorldPatch,
  extractPatch, kmPerWorldCell, regionGeometry, visibleRect, type RegionGeometry,
} from './terrain';
import { DEFAULT_REGION_PARAMS, type RegionData, type RegionParams, type RegionWindow } from './types';
import { canonParams, tileGeometry, tileKey, tileWindow, type TileId } from './tiles';
import { hashEditsString } from './workerProtocol';
import { applyCanonElevationEdits, applyCanonCoverEdits } from './canonEdits';
import { sitesPolicyFrom, type SitesPolicy, type WorldEdit } from '../core/edits';

export interface RegionBuildOptions {
  params?: Partial<RegionParams>;
  /** Stage callback for the progress bar. */
  onProgress?: (stage: string, t: number) => void;
  /**
   * La política de sembrado EXPLÍCITA, para llamantes que no pueden mandar
   * `edits` (la hoja libre viaja con el mundo YA editado — replicar encima
   * los trazos los aplicaría dos veces). Si falta y `params.sites === 'auto'`,
   * se deriva de `edits`; con 'everywhere', ni se mira.
   */
  sitesPolicy?: SitesPolicy;
  /**
   * Use THIS grid instead of deriving one from the window. The canon tiles
   * pass their world-aligned geometry through here, so the whole pipeline —
   * amplifier, erosion, hydrology, cover, habitation, tracks, fields — serves
   * both the freeform export sheet and the canonical layer without a fork.
   */
  geometry?: RegionGeometry;
  /**
   * The world's edit list, to be applied at THIS resolution. Requires the
   * caller to ship a world whose ELEVATION is the pristine snapshot — see
   * canonEdits.ts for why re-rasterising over the edited world is wrong.
   */
  edits?: WorldEdit[];
}

/**
 * Sheets already built, keyed by what actually determines them.
 *
 * The key is the SNAPPED origin, not the requested centre, which is the whole
 * point: dragging the map produces a continuous stream of centres that resolve
 * to the same grid, so a reader who nudges the sheet and comes back gets the
 * previous one instantly instead of paying two seconds to be told the same
 * thing. Keyed per world object and cleared by revision, so a painted stroke
 * cannot leave a stale coastline behind.
 */
interface RegionCache { rev: number; order: string[]; map: Map<string, RegionData> }
const CACHE = new WeakMap<WorldData, RegionCache>();
const CACHE_LIMIT = scaleCount(8);

function cacheKey(g: RegionGeometry, params: RegionParams, policy: SitesPolicy | undefined): string {
  return `${g.originX.toFixed(6)}:${g.originY.toFixed(6)}:${g.worldPerCellX.toFixed(9)}`
    + `:${g.width}x${g.height}:${params.detail}:${params.settled}:${params.habitation}:${params.streamDensity}`
    // La política de sembrado es identidad — LA POLÍTICA, no sólo el modo. En
    // la aplicación cada edición bumpa la revisión y el choque no puede darse,
    // pero un llamante directo (los bancos) pide la misma hoja con ediciones
    // distintas bajo la misma revisión, y con sólo el modo en la clave la
    // segunda petición cobraba la PRIMERA hoja de la caché — el banco de
    // lugares lo retrató (C/D/E clavados en cero).
    + `:${policy ? hashEditsString(JSON.stringify(policy)) : (params.sites ?? 'everywhere')}`;
}

/** Drop every cached sheet for a world — the paint engine calls this. */
export function clearRegionCache(world: WorldData): void {
  CACHE.delete(world);
}

export function generateRegion(
  world: WorldData,
  geo: HumanGeography,
  win: RegionWindow,
  opts: RegionBuildOptions = {},
): RegionData {
  const params: RegionParams = { ...DEFAULT_REGION_PARAMS, ...opts.params };
  const p = opts.onProgress ?? (() => {});

  p('relieve', 0);
  const g = opts.geometry ?? regionGeometry(world, win, params);

  // Derivada ANTES de mirar la caché: forma parte de la identidad de la hoja.
  const policy = opts.sitesPolicy
    ?? (params.sites === 'auto' ? sitesPolicyFrom(opts.edits) : undefined);

  const rev = world.revision ?? 0;
  let cache = CACHE.get(world);
  if (!cache || cache.rev !== rev) CACHE.set(world, (cache = { rev, order: [], map: new Map() }));
  const key = cacheKey(g, params, policy);
  const hit = cache.map.get(key);
  if (hit) {
    p('listo', 1);
    // The window is part of the returned data and the reader's centre moved
    // even though the grid did not, so hand back a copy with the new window.
    return hit.window.cx === win.cx && hit.window.cy === win.cy ? hit : { ...hit, window: win };
  }
  const patch = extractPatch(world, g);
  const elevation = buildElevation(world, g, patch, params);
  if (opts.edits?.length) applyCanonElevationEdits(elevation, g, world, opts.edits);

  p('agua', 0.22);
  // Carve first, erode second: the world's rivers are a boundary condition, and
  // running the incision over them deepens their valleys rather than inventing
  // rival ones beside them.
  const rivers = carveWorldRivers(world, g, elevation);
  anchorCoastline(world, g, patch, elevation);
  erodeSheet(elevation, g.width, g.height, g.metresPerCell, 3, 0.0055 * params.detail);

  p('cauces', 0.42);
  const t = buildHydrology(world, g, patch, elevation, rivers);
  const streams = extractStreams(g, t, rivers, params);
  nameStreams(streams, world, geo, g);

  p('vegetación', 0.45);
  const natural = buildNaturalCover(world, g, patch, t, params);
  if (opts.edits?.length) {
    applyCanonCoverEdits(natural.biome, natural.cover, t.elevation, g, world, opts.edits);
  }

  p('poblamiento', 0.6);
  // Con `sites: 'auto'` la política (derivada arriba, junto a la caché) sale
  // de las EDICIONES de la petición: cerrado sin nada, el grifo global
  // (`placesEverywhere`) y las pinceladas de zona (`placesZone`). Con
  // 'everywhere' (el defecto de siempre) no hay política y el sembrado es el
  // de toda la vida — bancos intactos.
  const hab = buildHabitation(world, geo, g, patch, t, natural.cover, streams, params, policy);

  p('hitos', 0.7);
  // Landmarks are found AFTER the cover and BEFORE the farming, because a crag
  // is a fact about the natural ground and a village's fields are not going to
  // move it. They join the place list so labels, links and the manuscript index
  // treat a waterfall exactly like a hamlet.
  let nextPlaceId = hab.places.reduce((m, q) => Math.max(m, q.id), 0) + 1;
  // Los hitos naturales NOMBRADOS (Fuente de…, Salto de…) también piden
  // permiso: el accidente es geografía, su nombre es contenido inventado
  // (Luis, 2026-08-13: «lo mismo con fuentes, puentes»). Sin política, todo
  // — el defecto de los bancos.
  const permite = policy ? siteAllower(policy, g, world.width) : null;
  const marks = buildLandmarks(world, geo, g, t, natural.cover, streams, () => nextPlaceId++)
    .filter((m) => !permite || permite(m.x, m.y));
  hab.places.push(...marks);

  p('cultivo', 0.78);
  const farmed = applyHabitation(world, g, t, natural, hab.places, params);

  p('caminos', 0.85);
  const tracks = buildTracks(world, geo, g, t, farmed.cover, hab.places, streams, hab.fields, params);

  p('cercas', 0.94);
  const { fields, hedges, dykes } = buildFields(g, t, farmed.cover, farmed.tilth, hab.places, params);

  const { title, subtitle } = sheetTitle(world, geo, g, win, params);
  p('listo', 1);

  const out: RegionData = {
    window: win,
    params,
    width: g.width,
    height: g.height,
    margin: g.margin,
    metresPerCell: g.metresPerCell,
    originX: g.originX,
    originY: g.originY,
    worldPerCellX: g.worldPerCellX,
    worldPerCellY: g.worldPerCellY,
    elevation: t.elevation,
    water: t.water,
    flow: t.flow,
    slope: t.slope,
    wet: t.wet,
    biome: natural.biome,
    cover: farmed.cover,
    streams,
    places: hab.places,
    tracks,
    fields,
    hedges,
    dykes,
    title,
    subtitle,
  };

  cache.map.set(key, out);
  cache.order.push(key);
  while (cache.order.length > CACHE_LIMIT) {
    const drop = cache.order.shift();
    if (drop) cache.map.delete(drop);
  }
  return out;
}

/**
 * One canonical tile of countryside.
 *
 * Same pipeline as the freeform sheet, but the grid comes from the tile id and
 * from nothing else — no span, no resolution, no snapping, no free variables.
 * Two requests for the same id are byte-identical (also cached, keyed by the
 * geometry like any other sheet), and neighbouring tiles agree on their shared
 * apron because every synthesized detail is sampled in world coordinates on
 * world-aligned lattices.
 *
 * Content knobs (detail, settled, habitation, streamDensity) still apply — a
 * reader's world has ONE canon per choice of knobs, and the cache key carries
 * them the same way it always has.
 */
export function generateCanonTile(
  world: WorldData,
  geo: HumanGeography,
  id: TileId,
  opts: Omit<RegionBuildOptions, 'geometry'> = {},
): RegionData {
  return generateRegion(world, geo, tileWindow(world, id), {
    ...opts,
    params: canonParams(world, opts.params),
    geometry: tileGeometry(world, id),
  });
}

/** Stable identity of a canon tile's cached RegionData. */
export function canonTileKey(id: TileId): string {
  return tileKey(id);
}

/**
 * Carry the world's river names down onto the sheet.
 *
 * The trunk on a regional sheet is not "a river" — it is the SAME river the
 * world map names, and printing a different name on it (or none) is the fastest
 * way to make the two scales feel like two unrelated maps.
 */
function nameStreams(
  streams: RegionData['streams'], world: WorldData, geo: HumanGeography,
  g: { originX: number; originY: number; worldPerCellX: number; worldPerCellY: number },
): void {
  const WW = world.width;
  const named = geo.features.filter((f) => f.kind === 'river');
  if (!named.length) return;
  const toSheet = (wx: number, wy: number) => {
    let dx = wx - g.originX;
    while (dx < -WW / 2) dx += WW;
    while (dx > WW / 2) dx -= WW;
    return { x: dx / g.worldPerCellX, y: (wy - g.originY) / g.worldPerCellY };
  };
  for (const s of streams) {
    if (!s.trunk) continue;
    let best: string | undefined;
    let bd = Infinity;
    for (const f of named) {
      for (const c of f.cells ?? []) {
        const p = toSheet(c % WW, (c / WW) | 0);
        for (const q of [s.pts[0], s.pts[s.pts.length >> 1], s.pts[s.pts.length - 1]]) {
          const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
          if (d < bd) { bd = d; best = f.name; }
        }
      }
    }
    // A world river's cells are 20 km apart, so "close" has to be generous —
    // but not so generous that every brook borrows the Danube's name.
    if (best && bd < 900) s.name = best;
  }
}

function sheetTitle(
  world: WorldData, geo: HumanGeography, g: RegionGeometry,
  win: RegionWindow, params: RegionParams,
): { title: string; subtitle: string } {
  const WW = world.width;
  const vis = visibleRect(g);
  const cx = g.originX + (vis.x0 + vis.w / 2) * g.worldPerCellX;
  const cy = g.originY + (vis.y0 + vis.h / 2) * g.worldPerCellY;
  const wrap = (dx: number) => { while (dx < -WW / 2) dx += WW; while (dx > WW / 2) dx -= WW; return dx; };

  // The biggest place on the sheet gives it its name, the way a county is named
  // for its town. Failing that, the realm; failing that, the nearest feature.
  let bestTown: { name: string; rank: string; d: number } | null = null;
  for (const s of geo.settlements) {
    const dx = wrap(s.x - cx) / g.worldPerCellX, dy = (s.y - cy) / g.worldPerCellY;
    if (Math.abs(dx) > vis.w / 2 || Math.abs(dy) > vis.h / 2) continue;
    const w = s.rank === 'capital' ? 0.25 : s.rank === 'city' ? 0.45 : s.rank === 'town' ? 0.8 : 1.6;
    const d = Math.hypot(dx, dy) * w;
    if (!bestTown || d < bestTown.d) bestTown = { name: s.name, rank: s.rank, d };
  }

  let title: string;
  if (bestTown) {
    title = bestTown.rank === 'capital' || bestTown.rank === 'city'
      ? `Contorno de ${bestTown.name}` : `Tierras de ${bestTown.name}`;
  } else {
    const ix = (((Math.round(cx) % WW) + WW) % WW);
    const iy = Math.min(world.height - 1, Math.max(0, Math.round(cy)));
    const realm = geo.realmOf[iy * WW + ix];
    const r = geo.realms.find((x) => x.id === realm);
    let nearest: { name: string; d: number } | null = null;
    for (const f of geo.features) {
      const d = Math.hypot(wrap(f.x - cx), f.y - cy);
      if (!nearest || d < nearest.d) nearest = { name: f.name, d };
    }
    title = r ? `Marca de ${r.name}` : nearest ? `Cercanías de ${nearest.name}` : 'Hoja regional';
  }

  const kmCell = kmPerWorldCell(world);
  const spanY = (vis.h * g.worldPerCellY) * kmCell;
  const scale = Math.round(g.metresPerCell / 0.28e-3 / 1000) * 1000; // 0.28 mm per cell on paper
  const subtitle = `${Math.round(win.spanKm)} × ${Math.round(spanY)} km · ${Math.round(g.metresPerCell)} m por celda · ≈ 1:${scale.toLocaleString('es-ES')}`;
  void params;
  return { title, subtitle };
}

/**
 * Keep the sheet's shoreline where the world put it.
 *
 * The amplifier invents ±60 m of relief, which near sea level is enough to
 * decide sea or land on its own — and it did. Measured on a coastal tile: the
 * canon disagreed with the world about water on 24 % of the ground. Every one
 * of those disagreements sat within 50 m of sea level, so none of them was
 * absurd; but a wide estuary that the whole-world map draws, and that the
 * reader has been looking at, must not evaporate when they zoom into it. That
 * discontinuity is what makes regional detail read as a different planet.
 *
 * The rule is the same one the shallow tiles keep: the world decides sea or
 * land, the amplification decides exactly where the line runs. "Exactly where"
 * is bounded — the shoreline may wander within about half a world cell of the
 * world's own zero contour, measured through the local gradient (|h| / |∇h| is
 * the distance to the contour, in cells). Beyond that band the sign is pinned,
 * by the smallest correction that pins it, so relief everywhere else is
 * untouched and no flat pan appears at the boundary.
 *
 * Inland this does nothing at all: a tile a thousand metres up has no cell
 * within half a cell of the coast. Measured: 0,0 % change on inland tiles.
 */
function anchorCoastline(
  world: WorldData, g: RegionGeometry, patch: WorldPatch, elevation: Float32Array,
): void {
  const W = g.width, H = g.height;
  /** How far the shoreline may wander from the world's contour, in world cells. */
  const BAND = 0.5;
  for (let y = 0; y < H; y++) {
    const wy = g.originY + (y + 0.5) * g.worldPerCellY;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elevation[i];
      const wx = g.originX + (x + 0.5) * g.worldPerCellX;
      const h = patchBilinear(patch, patch.elev, wx, wy);
      // Same sign: nothing to decide.
      if ((h > 0) === (e > 0)) continue;
      // Distance to the world's own coastline, in world cells. A flat shelf has
      // a tiny gradient and therefore a huge band, which is right: there the
      // world genuinely does not know, and the amplifier should be free.
      const gx = (patchBilinear(patch, patch.elev, wx + 0.5, wy)
        - patchBilinear(patch, patch.elev, wx - 0.5, wy));
      const gy = (patchBilinear(patch, patch.elev, wx, wy + 0.5)
        - patchBilinear(patch, patch.elev, wx, wy - 0.5));
      const grad = Math.hypot(gx, gy);
      if (grad < 1e-6) continue;
      if (Math.abs(h) / grad <= BAND) continue; // inside the band: let it wander
      // Outside it: pin the sign with the smallest possible nudge.
      elevation[i] = h > 0 ? 0.0006 : -0.0006;
    }
  }
  void world;
}
