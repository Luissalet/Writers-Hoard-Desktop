// ============================================
// Cartography — Canvas helpers for the app
// ============================================
// Bridges the pure renderer to the browser: builds canvases at a requested
// size, and caches the human geography and the 3D map texture per world so
// panning, switching views and opening the 3D scene never pay for them twice.

import { Biome, type WorldData } from '../core/types';
import { applyPaintedRealms, buildHumanGeography, DEFAULT_HUMAN_PARAMS, settlementCellCenter, type GeoDepth, type HumanGeography, type HumanGeographyParams, type Settlement
} from '../core/settlements';
import { compatibleEditKeys, realmEditKey, riverKey } from '../core/edits';
import { BIOME_COLORS } from '../core/render';
import type { CityParams } from '../city/generate';
import type { V } from '../city/geometry';
import { DEFAULT_REGION_PARAMS, type RegionData } from '../region/types';
import {
  buildElevation, extractPatch, kmPerWorldCell, smoothPolyline, type RegionGeometry,
} from '../region/terrain';
import { canonMetresPerCell, canonRefinement } from '../region/tiles';
import { worldRiverWidthMetres } from '../region/riverScale';
import { marchingSquares } from './contours';
import { renderCartography, type CartoLayers, type CartoView } from './render';
import type { CartoTheme } from './theme';
import type { Ctx } from './symbols';
import { geographyContentKey } from '../region/contentIdentity';

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
/**
 * LA PUERTA DE LA APLICACIÓN LLEVA EL GRIFO PUESTO. `sites: 'auto'` hace que
 * la geografía humana lea la política de lugares del propio mundo
 * (`world.painted.sitesPolicy`): sin tick ni zonas, mundo desnudo — Luis,
 * 2026-08-13. Los bancos que quieran país habitado abren el grifo con la
 * edición `placesEverywhere` (o llaman a `buildHumanGeography` a pelo, cuyo
 * defecto sigue siendo 'everywhere'). La política entra en la CLAVE de la
 * caché: el nivel base depende de ella, y un tick que cambia con la misma
 * revisión no puede cobrar la base del otro estado.
 */
function geoKey(world: WorldData, params: HumanGeographyParams): string {
  // Absence is the legacy open policy, exactly as buildHumanGeography treats
  // it. Undoing the last non-policy edit must not become a full cache miss.
  const policy = params.sites === 'auto'
    ? (world.painted?.sitesPolicy ?? { everywhere: true, zones: [] })
    : null;
  return JSON.stringify(params)
    + '|' + JSON.stringify(policy);
}

/** Interaction path: patch an existing base, or report a cold cache. Never
 * generate geography here, including when a places policy actually changed.
 * Keep the base key/revision so the background rebuild remains necessary. */
export function patchCachedGeography(world: WorldData): HumanGeography | null {
  const hit = GEO_CACHE.get(world);
  if (!hit) return null;
  const geo = patchGeography(world, hit.base);
  GEO_CACHE.set(world, { ...hit, rev: world.revision ?? 0, geo });
  return geo;
}

/** Scheduling only: querying cache depth must never build or patch anything. */
export function cachedGeographyDepth(world: WorldData): GeoDepth | null {
  return GEO_CACHE.get(world)?.depth ?? null;
}

export function getGeography(
  world: WorldData,
  depth: GeoDepth = 'full',
  params: HumanGeographyParams = { ...DEFAULT_HUMAN_PARAMS, sites: 'auto' },
): HumanGeography {
  const key = geoKey(world, params);
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
  params: HumanGeographyParams = { ...DEFAULT_HUMAN_PARAMS, sites: 'auto' },
): HumanGeography {
  const key = geoKey(world, params);
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

/** Adopt an immutable geography base built outside the UI thread. Corrections
 * are intentionally applied here, against the current world and revision, so
 * a late worker result cannot resurrect an old rename, move or frontier. */
export function adoptGeographyBase(
  world: WorldData,
  base: HumanGeography,
  params: HumanGeographyParams = { ...DEFAULT_HUMAN_PARAMS, sites: 'auto' },
): HumanGeography {
  const key = geoKey(world, params);
  const rev = world.revision ?? 0;
  const geo = patchGeography(world, base);
  GEO_CACHE.set(world, { key, rev, geo, base, baseRev: rev, depth: base.depth });
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
 * The painted frontier, and the `realmOf` it produced, kept from patch to patch.
 *
 * `realmBorders` and `realmTint` (cartography/realmOverlay) and `realmAnchors`
 * (components/Map2D) all cache on the IDENTITY of `realmOf`, because that array
 * is what changes when the political map changes. A patch that slices a fresh
 * one every time therefore invalidates all three — and a patch runs after EVERY
 * stroke, not only after a frontier one. So on a world carrying any realm paint
 * at all, raising a ridge, dropping a marker or renaming a town was paying, on
 * the first frame after the reader let go and inside a requestAnimationFrame
 * callback: the slice (3,1 ms at 2048×1024), `applyPaintedRealms`' two passes
 * (7,8 ms), the tint fill plus an 8 MB canvas (10,4 ms), the border scan (~60 ms
 * at that size, see `realmOverlay`) and the two-pass anchor scan.
 *
 * The overlay's CONTENT is therefore the key, not its identity: `applyEdits`
 * rebuilds `realmCells` from the whole edit list on every revision, so a terrain
 * stroke hands us a brand-new Int16Array holding byte-identical frontiers.
 * Comparing it word at a time is one pass over two bytes a cell — 1,4 ms at
 * 2048×1024, against the ~80 ms above — and it is EXACT, where a hash could
 * answer "unchanged" for a frontier that did move, which is the one failure this
 * whole cheap path exists to prevent.
 *
 * Nothing extra is retained: at rest the entry holds the same overlay the world
 * itself holds. And undo-then-redo is free in both directions — the undo hands
 * back `base.realmOf`, whose layers are still cached from before the stroke, and
 * the redo hands back this array, whose layers are still cached from during it.
 */
interface RealmPatch {
  /** The overlay `realmOf` was derived from. */
  overlay: Int16Array;
  /** The base it was sliced from; a full rebuild brings a new one. */
  base: Int32Array;
  realmOf: Int32Array;
  /**
   * The per-realm cell counts as `applyPaintedRealms` left them. They have to
   * be restored along with the array: `gazetteer` prints them as km² and
   * `atlas` sizes a label from them, and the realm objects a patch hands out
   * are fresh copies carrying the BASE's counts.
   */
  counts: Int32Array;
}
const REALM_PATCH = new WeakMap<WorldData, RealmPatch>();

/** Word-at-a-time equality: two cells per comparison. */
function sameOverlay(a: Int16Array, b: Int16Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  // Both overlays come straight from `new Int16Array(N)` and so start at byte
  // zero; the guard is what makes a subarray fall through to the element loop
  // instead of throwing on an unaligned Uint32Array view.
  const aligned = ((a.byteOffset | b.byteOffset) & 3) === 0;
  const words = aligned ? a.length >>> 1 : 0;
  if (aligned) {
    const A = new Uint32Array(a.buffer, a.byteOffset, words);
    const B = new Uint32Array(b.buffer, b.byteOffset, words);
    for (let i = 0; i < words; i++) if (A[i] !== B[i]) return false;
  }
  for (let i = words << 1; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * `realmOf` for the patch: the base's own array unless the frontier moved.
 *
 * `realms` must already be the patch's private copies — this writes `cellCount`
 * through them, and writing it through the base's Realm objects is how the
 * per-realm areas came out as [616, 2386] instead of [1060, 1934] after an undo.
 *
 * What it deliberately does not watch is the ELEVATION. `applyPaintedRealms`
 * refuses to claim open water, so a painted province the reader afterwards
 * drowns keeps its flag here until the next full pass. That is precisely the
 * staleness the base already carries about every cell the GENERATOR claimed — a
 * patch never re-grows realms — so the map stays uniformly one rebuild behind
 * about terrain instead of being half-updated, and that rebuild is scheduled the
 * moment the brush leaves the reader's hand.
 */
function patchedRealmOf(
  world: WorldData,
  base: HumanGeography,
  realms: { cellCount: number }[],
): Int32Array {
  const overlay = world.painted?.realmCells;
  // A world nobody has painted pays one property read: no copy, no scan, and
  // every layer keyed on this array stays warm.
  if (!overlay) return base.realmOf;
  const hit = REALM_PATCH.get(world);
  if (hit && hit.base === base.realmOf && sameOverlay(hit.overlay, overlay)) {
    const n = Math.min(realms.length, hit.counts.length);
    for (let r = 0; r < n; r++) realms[r].cellCount = hit.counts[r];
    return hit.realmOf;
  }
  const realmOf = base.realmOf.slice();
  applyPaintedRealms(world, realmOf, realms);
  const counts = new Int32Array(realms.length);
  for (let r = 0; r < realms.length; r++) counts[r] = realms[r].cellCount;
  REALM_PATCH.set(world, { overlay, base: base.realmOf, realmOf, counts });
  return realmOf;
}

/**
 * Cheap update of a geography after an edit.
 *
 * Everything here is O(settlements + ruins), which on any world is a few hundred
 * items. Nothing that costs a pass over the grid is allowed in this function —
 * except the one in `patchedRealmOf`, and only when the frontier actually moved.
 *
 * NOTHING the base owns is written to, ever. The base is the only copy of the
 * world as the generator drew it, and it is what every undo is patched back out
 * of: a patch that mutates it has destroyed the thing it would need to undo.
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
  const pops = world.painted?.populations ?? {};
  /**
   * ALWAYS a copy, even when there is nothing to override.
   *
   * Handing back `o` itself when a place had no rename and no population
   * override was the cheap thing to do and it aliased the base: the realm write
   * below then landed in `base.settlements[k].realm`, i.e. in the only record of
   * the world as the generator drew it. Undo the last frontier edit and the town
   * still flew the deleted overlay's flag in the hover readout, the gazetteer
   * and the atlas — for ever, since the full rebuild that would have cleared it
   * is itself suppressed while a brush is out. A few hundred spreads is nothing;
   * this list is settlements plus ruins.
   */
  /**
   * `moves` TAMBIÉN aquí, no sólo en el 2D. Esta es la única vía que corre
   * tras un gesto (lección #23): sin esto, arrastrar un pueblo se guardaba,
   * se contaba en el badge — y la Carta, el 3D y el atlas seguían dibujando
   * la posición de origen para siempre, porque el pase completo se suprime
   * mientras hay un pincel fuera. La LLAVE sigue siendo la posición de
   * ORIGEN (eso es lo que la hace estable); lo que cambia es dónde se dibuja.
   * Un objeto mudado no se ahoga por la costa de su origen ni por la de su
   * destino: la colocación explícita del lector gana a la marea.
   */
  const mv = world.painted?.moves ?? {};
  const fix = <T extends { x: number; y: number; name: string }>(list: T[], target: 'settlement' | 'ruin'): T[] =>
    list.filter((o) => !gone.has(`${target}:${Math.round(o.x)},${Math.round(o.y)}`))
      .filter((o) => mv[`${target}:${Math.round(o.x)},${Math.round(o.y)}`] || !drowned(o.x, o.y))
      .map((o) => {
        const k = `${target}:${Math.round(o.x)},${Math.round(o.y)}`;
        const n = ren[k];
        const pop = target === 'settlement' ? pops[k] : undefined;
        const m = mv[k];
        return {
          ...o,
          ...(n ? { name: n } : {}),
          ...(pop === undefined ? {} : { population: pop }),
          ...(m ? { x: m.x, y: m.y } : {}),
        };
      });
  const settlements = fix(base.settlements, 'settlement');
  const ruins = fix(base.ruins, 'ruin');
  const haveS = new Set(settlements.map((s) => kOf(s.x, s.y)));
  const haveR = new Set(ruins.map((r) => kOf(r.x, r.y)));

  let nextId = settlements.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  // A los marcadores pintados les valen las MISMAS correcciones que a lo
  // generado — un pueblo pintado es indistinguible de uno generado, ése es el
  // contrato. Antes este bucle ignoraba `gone`, `ren`, `pops` y `mv`: borrar
  // un pueblo pintado a mano no surtía efecto en la vía barata (el marcador
  // volvía a empujarse tras cada parche), y renombrarlo o moverlo tampoco.
  // El pase completo sí lo hacía… 19 s después y suprimido con el pincel fuera,
  // o sea nunca (lección #23).
  for (const m of world.painted?.markers ?? []) {
    const k = kOf(m.x, m.y);
    if (m.marker === 'settlement') {
      const ek = `settlement:${Math.round(m.x)},${Math.round(m.y)}`;
      if (gone.has(ek)) continue;
      const mvd = mv[ek];
      if (haveS.has(k) || (!mvd && drowned(m.x, m.y))) continue;
      haveS.add(k);
      const rank = m.rank ?? 'town';
      settlements.push({
        id: nextId++,
        x: Math.round(mvd?.x ?? m.x), y: Math.round(mvd?.y ?? m.y),
        // Named on the next full pass, when the language machinery is running.
        name: ren[ek] ?? m.name ?? '·',
        culture: settlements[0]?.culture ?? 'imperial',
        rank,
        population: pops[ek] ?? m.population
          ?? (rank === 'capital' ? 42000 : rank === 'city' ? 16000 : rank === 'town' ? 3800 : 700),
        port: false,
        river: false,
        realm: base.realmOf[at(mvd?.x ?? m.x, mvd?.y ?? m.y)] ?? -1,
        score: 1,
        painted: true,
      });
    } else if (m.marker === 'ruin') {
      const ek = `ruin:${Math.round(m.x)},${Math.round(m.y)}`;
      if (gone.has(ek)) continue;
      const mvd = mv[ek];
      if (haveR.has(k) || (!mvd && drowned(m.x, m.y))) continue;
      haveR.add(k);
      ruins.push({
        id: ruins.length,
        kind: m.ruin ?? 'city',
        x: Math.round(mvd?.x ?? m.x), y: Math.round(mvd?.y ?? m.y),
        name: ren[ek] ?? m.name ?? '·',
        condition: 'overgrown',
        site: 'holy',
        importance: 0.72,
        painted: true,
      });
    }
  }

  /**
   * ROADS are left exactly as they were: they are wrong in the painted area
   * until the next full pass, and being wrong for a second beats being right
   * four seconds after every stroke. (The full pass, in turn, routes against
   * the reader's `moves` — `buildHumanGeography` feeds the router the moved
   * positions outside the corrections flag — so "until the next full pass" is
   * now a promise with an ending: `WorldView` schedules that pass as soon as
   * the brush is down, and the road comes to the town's new ground.)
   *
   * FRONTIERS are not, any more. They used to be, for the same reason - but a
   * frontier now has a brush of its own, and "wrong until the next full pass"
   * is a description of a tool that does nothing: the 2D draws its political
   * wash and its border straight off this array, the full pass costs nineteen
   * seconds, and it is suppressed for as long as a brush is in the reader's
   * hand. So a painted overlay is laid on a COPY here, at one pass over the
   * grid - a couple of milliseconds, and only for worlds anyone has painted.
   *
   * The array's identity is the signal: `realmBorders`, `realmTint` and
   * `realmAnchors` all cache on it, so a fresh array means "re-derive the line,
   * the wash and the lettering" and the same array means "nothing about the
   * political map moved". Which is exactly why the copy is made only when the
   * overlay genuinely changed — see `patchedRealmOf`.
   */
  const features = base.features
    .filter((f) => !gone.has(`feature:${f.kind}:${Math.round(f.x)},${Math.round(f.y)}`))
    .map((f) => {
      const fk = `feature:${f.kind}:${Math.round(f.x)},${Math.round(f.y)}`;
      const n = ren[fk];
      // Los accidentes también se mudan por aquí. La llave puede venir escrita
      // como `feature:` o como `landmark:` según qué capa registró el gesto;
      // `compatibleEditKeys` conoce las dos grafías.
      const m = compatibleEditKeys('landmark', fk).map((k) => mv[k]).find(Boolean);
      if (!n && !m) return f;
      return { ...f, ...(n ? { name: n } : {}), ...(m ? { x: m.x, y: m.y } : {}) };
    });
  // Copies for the same reason `fix` copies: `patchedRealmOf` rewrites
  // `cellCount` from the overlay, and through an alias that rewrite lands in the
  // base's own Realm objects — which the gazetteer then prints as km² and the
  // atlas uses as a label extent, both of them a stroke behind for ever.
  const realms = base.realms.map((r) => {
    // THROUGH `compatibleEditKeys`, like the full build. The Indice writes a
    // realm's rename under `realm:<id>:0,0` (the shape `editKey` gives every
    // other target) and this loop used to look for the bare `realm:<id>` — so
    // the reader renamed a country, watched the panel update, switched to the
    // map, and found the old name still lettered across it. Stored, counted in
    // the badge, persisted for good, and read by nobody.
    const n = compatibleEditKeys('realm', realmEditKey(r.id))
      .map((k) => ren[k])
      .find(Boolean);
    return n ? { ...r, name: n } : { ...r };
  });
  const realmOf = patchedRealmOf(world, base, realms);
  /**
   * And the towns go with the ground — UNCONDITIONALLY.
   *
   * A settlement whose province changed hands has to answer the hover readout,
   * the realm name and the gazetteer with its new flag, or the map says one
   * thing and the panel another. Inside the "is there an overlay" test it did
   * that in one direction only: undo the last frontier edit, `realmCells` goes
   * back to null, the write is skipped and the town keeps the flag the deleted
   * overlay gave it. Assigning from `realmOf` every time is the same few hundred
   * writes and it is correct in both directions, because `realmOf` is by then
   * whatever the world actually says — painted or the generator's own.
   *
   * Through `at`, not a raw `y * W + x`: a marker dropped on the second copy of
   * a wrapped map carries an x outside [0, W), which indexes off the end of the
   * array and made the town stateless (-1) instead of wrapping to its own cell.
   */
  for (const s of settlements) s.realm = realmOf[at(s.x, s.y)] ?? -1;
  return { ...base, settlements, ruins, features, realms, realmOf };
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
  visibility: Pick<Partial<CartoLayers>, 'rivers' | 'roads' | 'borders'> = {},
): HTMLCanvasElement {
  const rev = world.revision ?? 0;
  let entry = TEX_CACHE.get(world);
  if (!entry || entry.rev !== rev) TEX_CACHE.set(world, (entry = { rev, map: new Map() }));
  const per = entry.map;
  const key = `${theme.id}:${size}:${geography ? geographyContentKey(geography) : 'bare'}:${visibility.rivers !== false}:${visibility.roads !== false}:${visibility.borders === true}`;
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
      rivers: visibility.rivers !== false,
      roads: visibility.roads !== false,
      borders: visibility.borders === true,
    },
    density: 1,
    typeScale: 1,
  });
  per.set(key, canvas);
  // Layer toggles can produce many full-resolution variants of one world.
  // Retain a small working set instead of every combination until it unloads.
  while (per.size > 4) per.delete(per.keys().next().value!);
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

// ===========================================================================
// El puente entre el MUNDO y el plano de una ciudad
// ===========================================================================
/**
 * LAS ESCALAS, QUE ES DE LO QUE VA TODO ESTE BLOQUE.
 *
 *   · 1 unidad de ciudad = 4 m. Es la escala del propio generador (una calle
 *     mayor son 2 unidades y las llama ~8 m) y la que usa `townPlan.ts` para
 *     posar el plano en el suelo SIN ROTARLO — los ejes del plano son los del
 *     ráster del mundo, x al este e y al sur, así que un rumbo medido aquí ya
 *     está en el marco local de la ciudad y no hay giro que adivinar.
 *   · 1 celda de mundo = 2π·6371 km / width. Medido en el mundo «monstruo» de
 *     1024: 39,09 km, o sea **9 773 unidades de ciudad por celda**.
 *   · 1 celda de canon ≈ 152,7 m = 38,2 unidades: el suelo que dibujan los
 *     tiles satélite sobre los que se posa el plano.
 *   · Un plano de capital mide 95 unidades de radio = 380 m = 2,5 celdas de
 *     canon = **0,0097 celdas de mundo**.
 *
 * Ese último número manda sobre todo lo demás. El pueblo entero cabe en la
 * centésima parte de una celda del ráster, así que DENTRO del plano el ráster
 * no tiene absolutamente nada que decir: su curva de nivel cero lo cruza como
 * una recta, que es exactamente el semiplano infinito que había. Lo que sí se
 * puede leer del mundo, y es lo que se lee aquí, es:
 *   (a) los RUMBOS —caminos, río, mar—, que son exactos a cualquier escala;
 *   (b) la FORMA de la costa, que hay que ir a buscar donde la costa está de
 *       verdad (medido: entre 1,6 y 50 km del pueblo) y traerla comprimida;
 *   (c) el RELIEVE a escala del plano, que hay que amplificar con la misma
 *       retícula fina con la que se amplifica el suelo del tile.
 */
const METRES_PER_CITY_UNIT = 4;

/** Unidades de ciudad por celda de mundo. 9 773 en un mundo de 1024. */
function unitsPerWorldCell(world: WorldData): number {
  return (kmPerWorldCell(world) * 1000) / METRES_PER_CITY_UNIT;
}

/** El tamaño nominal del plano y su radio, que es la vara de medir de todo lo
 *  que se entrega: el generador construye sobre `R0 = 10 + size·2,5`. */
function planSizeFor(s: Settlement): number {
  return s.rank === 'capital' ? 34 : s.rank === 'city' ? 22 : s.rank === 'town' ? 13 : 7;
}

function cellOf(world: WorldData, x: number, y: number): number {
  const W = world.width, H = world.height;
  return Math.min(H - 1, Math.max(0, Math.round(y))) * W + (((Math.round(x) % W) + W) % W);
}

/**
 * EL BIOMA, POR LA ÚNICA PUERTA QUE HAY ABIERTA.
 *
 * `CityParams` no tiene campo de bioma, así que un pueblo del erg y un puerto
 * báltico se dibujaban idénticos. Lo único del bioma que cabe hoy es `farms`,
 * que estaba puesto a `true` a fuego: un anillo de campos de labor alrededor de
 * una caravanera del desierto, de una aldea sobre el permafrost o de un pueblo
 * minero en las badlands.
 *
 * Estos son los suelos en los que no se ara: roca, arena, sal, ceniza y suelo
 * helado. La turbera y el manglar NO están —se drenaron y se diquearon, que es
 * de donde salen los Países Bajos y los Fens—, y son los dos biomas donde más
 * pueblos hay. Medido sobre el mundo «monstruo»: de sus 90 poblaciones, 8 están
 * en tundra y 1 en llanura de cenizas, así que 9 pierden el anillo de granjas y
 * 81 lo conservan.
 */
const BARREN_BIOMES = new Set<number>([
  Biome.IceCap, Biome.Glacier, Biome.Alpine, Biome.Tundra, Biome.Desert,
  Biome.SaltFlat, Biome.Erg, Biome.Reg, Biome.Badlands, Biome.Volcanic,
  Biome.AshPlain, Biome.PetrifiedForest, Biome.CrystalFlats,
]);

// ---------------------------------------------------------------------------
// 1. Los caminos que llegan de verdad
// ---------------------------------------------------------------------------

interface RoadArrival { bearing: number; major: boolean }

/**
 * UNA VEZ POR GEOGRAFÍA, NO UNA VEZ POR PUEBLO.
 *
 * `cityParamsFor` lo llama un memo de React y también, pueblo a pueblo,
 * `townPlan.ts` mientras pinta una pantalla de tiles. Recorrer `geography.roads`
 * entero en cada llamada es cuadrático en el número de caminos: medido, 7 197
 * celdas de camino × 90 poblaciones son 648 000 pasos para averiguar algo que
 * cabe en un índice de 90 entradas. El índice se construye UNA vez por objeto
 * de geografía —O(celdas de camino), 0,2 ms— y cada pueblo lo consulta en O(1).
 */
const ROAD_ARRIVALS = new WeakMap<HumanGeography, Map<number, RoadArrival[]>>();

function roadArrivals(world: WorldData, geo: HumanGeography): Map<number, RoadArrival[]> {
  const hit = ROAD_ARRIVALS.get(geo);
  if (hit) return hit;
  const W = world.width;
  const index = new Map<number, RoadArrival[]>();
  const towns = new Set<number>();
  for (const q of geo.settlements) towns.add(cellOf(world, q.x, q.y));

  /**
   * Tres celdas de mirada adelante, no una.
   *
   * El A* que traza los caminos es de 8 vecinos, así que el PRIMER paso fuera
   * del pueblo sólo puede apuntar a uno de ocho rumbos: una puerta colocada con
   * él queda cuantizada a 45° y no coincide con la carretera que el atlas
   * dibuja curvada. Tres celdas (117 km) es el rumbo con el que la calzada se
   * va de verdad, y sigue siendo local.
   */
  const LOOK = 3;
  for (const r of geo.roads) {
    const n = r.cells.length;
    for (let k = 0; k < n; k++) {
      const c = r.cells[k];
      if (!towns.has(c)) continue;
      const cx = c % W, cy = (c / W) | 0;
      // Los dos sentidos: un camino que TERMINA aquí abre una puerta, uno que
      // PASA abre dos, que es lo que hace de un cruce de caminos un pueblo.
      for (const j of [k + Math.min(LOOK, n - 1 - k), k - Math.min(LOOK, k)]) {
        if (j === k) continue;
        const d = r.cells[j];
        let dx = (d % W) - cx;
        if (dx > W / 2) dx -= W;
        if (dx < -W / 2) dx += W;
        const dy = ((d / W) | 0) - cy;
        if (!dx && !dy) continue;
        const list = index.get(c);
        const arrival = { bearing: Math.atan2(dy, dx), major: r.major };
        if (list) list.push(arrival);
        else index.set(c, [arrival]);
      }
    }
  }
  ROAD_ARRIVALS.set(geo, index);
  return index;
}

/** Rumbos de salida, en radianes y hacia fuera, en el marco del plano. */
function roadBearingsFor(world: WorldData, geo: HumanGeography, s: Settlement): number[] {
  const list = roadArrivals(world, geo).get(cellOf(world, s.x, s.y));
  if (!list?.length) return [];
  // Los troncales primero: el generador sólo abre entre 2 y 6 puertas, y si ha
  // de dejar una fuera que sea la vereda y no la calzada real.
  const sorted = [...list].sort((a, b) => (a.major === b.major ? a.bearing - b.bearing : a.major ? -1 : 1));
  const out: number[] = [];
  for (const r of sorted) {
    /**
     * Dos caminos que salen a menos de 17° son UNA salida.
     *
     * No es un redondeo: el A* de `buildRoads` descuenta las celdas ya usadas
     * («erosión de calzada») para que las rutas se fundan en vez de correr en
     * paralelo, así que las cuatro calzadas troncales de Vaaspool salen las
     * cuatro por la MISMA celda vecina y no se separan hasta bien lejos. En el
     * mundo «monstruo»: 190 llegadas brutas sobre 79 pueblos → 100 rumbos
     * distintos, 1,27 por pueblo. Un pueblo con dos puertas de camino está de
     * verdad en un cruce; abrirle cuatro pegadas sería un boquete, no puertas.
     */
    const clash = out.some((b) => Math.abs(((r.bearing - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.30);
    if (clash) continue;
    out.push(r.bearing);
    if (out.length >= 6) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Polilíneas: el tramo que pasa por delante del pueblo
// ---------------------------------------------------------------------------

/**
 * El tramo de una polilínea que pasa más cerca del origen, remuestreado.
 *
 * Hace falta recortar POR LONGITUD DE ARCO y no filtrando vértices porque los
 * vértices de estas líneas están lejísimos a escala del plano: un paso de río
 * del mundo son 9 773 unidades y el plano mide 190. Filtrando vértices el
 * resultado casi siempre es la lista vacía aunque el río cruce el pueblo por
 * el medio.
 */
function runThroughOrigin(pts: { x: number; y: number }[], halfLen: number, step: number): V[] {
  if (pts.length < 2 || halfLen <= 0) return [];
  // Punto más próximo al origen SOBRE los segmentos, no sobre los vértices.
  let bi = 0, bt = 0, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    const px = a.x + dx * t, py = a.y + dy * t;
    const d = px * px + py * py;
    if (d < bd) { bd = d; bi = i; bt = t; }
  }
  const at = (i: number, t: number) => ({
    x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
    y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
  });
  // Paseo por longitud de arco a ambos lados del punto más próximo.
  const walk = (dir: 1 | -1): V[] => {
    const out: V[] = [];
    let i = bi, t = bt, travelled = 0, emitted = 0;
    let cur = at(i, t);
    for (let guard = 0; guard < 4096 && travelled < halfLen; guard++) {
      const a = pts[i], b = pts[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 1e-9) { i += dir; t = dir > 0 ? 0 : 1; if (i < 0 || i >= pts.length - 1) break; continue; }
      const remain = (dir > 0 ? 1 - t : t) * segLen;
      const want = Math.min(remain, halfLen - travelled);
      const nt = t + dir * (want / segLen);
      const next = at(i, nt);
      travelled += want;
      // Un punto cada `step` a lo largo de lo recorrido.
      while (emitted + step <= travelled) {
        emitted += step;
        const f = (emitted - (travelled - want)) / (want || 1);
        out.push({ x: cur.x + (next.x - cur.x) * f, y: cur.y + (next.y - cur.y) * f });
      }
      cur = next;
      t = nt;
      if (travelled >= halfLen) break;
      i += dir;
      if (i < 0 || i >= pts.length - 1) break;
      t = dir > 0 ? 0 : 1;
    }
    return out;
  };
  const back = walk(-1).reverse();
  const fwd = walk(1);
  const mid = at(bi, bt);
  const line = [...back, mid, ...fwd];
  return line.length >= 2 ? line : [];
}

// ---------------------------------------------------------------------------
// 3. El suelo del pueblo: costa, río y relieve a escala del plano
// ---------------------------------------------------------------------------

interface TownGround {
  coastDir: V | null;
  riverDir: V | null;
  slopeDir: V | null;
  slopeAmount: number;
  shoreLine: V[] | null;
  riverCourse: { line: V[]; width: number } | null;
}

interface RiverPlacement {
  /** City centre relative to the settlement's atlas anchor, in city units. */
  urbanCenter: V;
  riverMode: 'bank' | 'crossing';
}

interface GroundCache { rev: number; map: Map<string, TownGround> }
const GROUND = new WeakMap<WorldData, GroundCache>();

/** Índice celda → (río, vértice), para no recorrer los 102 ríos por pueblo. */
const RIVER_AT = new WeakMap<WorldData, { rev: number; map: Map<number, [number, number][]> }>();

function riverIndex(world: WorldData): Map<number, [number, number][]> {
  const rev = world.revision ?? 0;
  const hit = RIVER_AT.get(world);
  if (hit && hit.rev === rev) return hit.map;
  const map = new Map<number, [number, number][]>();
  const all = riversOf(world);
  for (let ri = 0; ri < all.length; ri++) {
    const cells = all[ri].cells;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const list = map.get(c);
      if (list) list.push([ri, k]);
      else map.set(c, [[ri, k]]);
    }
  }
  RIVER_AT.set(world, { rev, map });
  return map;
}

/** Los ríos que el mundo tiene AHORA: los generados que no se han borrado más
 *  los que el lector ha dibujado. La misma lista que dibujan los dos mapas. */
function riversOf(world: WorldData): { cells: ArrayLike<number>; flow: number }[] {
  const gone = world.painted?.removed;
  const generated = gone?.size
    ? world.rivers.filter((r) => !gone.has(riverKey(r.cells)))
    : world.rivers;
  const painted = world.painted?.rivers;
  return painted?.length ? [...generated, ...painted] : generated;
}

/**
 * EL LITORAL DE VERDAD, TRAÍDO A LA ESCALA DEL PLANO.
 *
 * Medido en el mundo «monstruo»: de los 73 puertos, el mar más cercano está
 * entre 1,6 km (Nut) y 50 km (Viisleu) del punto del pueblo, porque `port`
 * significa «su celda de 39 km toca el océano» y dentro de esa celda el mundo
 * no sabe dónde. En unidades de ciudad eso es entre 412 y 12 476, contra un
 * plano de 95 de radio: una costa entregada a escala métrica cae SIEMPRE fuera
 * de la lámina y el pueblo deja de ser un puerto.
 *
 * Así que se entrega una SEMEJANZA: la curva de nivel cero del mundo alrededor
 * del pueblo, con su rumbo y su curvatura intactos, contraída por
 * `k = min(1, 0,72·R0 / distancia)` hasta que el agua llega al borde del
 * pueblo. La bahía sigue siendo una bahía y el cabo un cabo — que es lo único
 * que el lector puede comprobar contra el atlas a esta escala — y un pueblo que
 * SÍ está en la orilla (k = 1) recibe su costa sin tocar. Medido: k va de 1/6
 * en Nut a 1/182 en Viisleu.
 */
function shoreFor(world: WorldData, s: Settlement, R0: number): { line: V[]; dir: V } | null {
  const W = world.width, H = world.height;
  const anchor = settlementCellCenter(s);
  const REACH = 4;   // celdas de mundo a cada lado: 156 km de vecindad
  const SUB = 4;     // muestras por celda; la bilineal ya suaviza el contorno
  const N = REACH * 2 * SUB + 1;
  const field = new Float32Array(N * N);
  const elev = world.elevation;
  for (let j = 0; j < N; j++) {
    const wy = anchor.y - REACH + j / SUB;
    const y0 = Math.min(H - 2, Math.max(0, Math.floor(wy)));
    const ty = Math.min(1, Math.max(0, wy - y0));
    for (let i = 0; i < N; i++) {
      const wx = anchor.x - REACH + i / SUB;
      const x0 = Math.floor(wx);
      const tx = wx - x0;
      const xa = ((x0 % W) + W) % W, xb = ((x0 + 1) % W + W) % W;
      const a = elev[y0 * W + xa], b = elev[y0 * W + xb];
      const c = elev[(y0 + 1) * W + xa], d = elev[(y0 + 1) * W + xb];
      field[j * N + i] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  const contours = marchingSquares(field, N, N, 0, false);
  if (!contours.length) return null;

  const units = unitsPerWorldCell(world);
  // La rama que pasa más cerca, en unidades de ciudad y relativa al pueblo.
  let best: V[] | null = null, bestD = Infinity;
  for (const c of contours) {
    if (c.pts.length < 2) continue;
    const pts = c.pts.map((p) => ({
      x: (p.x / SUB - REACH) * units,
      y: (p.y / SUB - REACH) * units,
    }));
    for (const p of pts) {
      const d = p.x * p.x + p.y * p.y;
      if (d < bestD) { bestD = d; best = pts; }
    }
  }
  if (!best) return null;
  const dTrue = Math.sqrt(bestD);
  if (!(dTrue > 0)) return null;
  const k = Math.min(1, (R0 * 0.72) / dTrue);
  const scaled = best.map((p) => ({ x: p.x * k, y: p.y * k }));
  // Sólo el tramo de delante: una ría a dos radios de aquí no tiene por qué
  // dar la vuelta al pueblo, y el generador reduce la lista entera con
  // `Math.min(...projs)` — veinticinco puntos, no cuatrocientos.
  const run = runThroughOrigin(scaled, R0 * 2.2, R0 / 6);
  if (run.length < 2) return null;
  let near = run[0], nd = Infinity;
  for (const p of run) {
    const d = p.x * p.x + p.y * p.y;
    if (d < nd) { nd = d; near = p; }
  }
  const m = Math.hypot(near.x, near.y) || 1;
  const dir = { x: near.x / m, y: near.y / m };
  /**
   * Y AHORA SE APOYA EL TRAMO EN LA LÍNEA DE AGUA.
   *
   * El generador resume el litoral en un semiplano tomando la PROYECCIÓN MÍNIMA
   * de sus puntos sobre `coastDir`; en una ensenada que abraza al pueblo esa
   * proyección la da un punto lateral y no el frente, así que el mar se le mete
   * dentro. Se traslada el tramo a lo largo de su propia normal —traslación
   * rígida: la bahía sigue siendo la misma bahía— hasta dejar su punto más
   * adentrado a 0,90·R0.
   *
   * Ese 0,90 está medido sobre los 46 pueblos amurallados del mundo, no
   * elegido: a 0,72·R0 seis se quedaban con muralla de cero vértices y cero
   * puertas (el mar tapando el plano); a 0,90 son DOS —los mismos dos que ya
   * fallaban sin litoral ninguno— y salen 117 puertas contra las 111 de antes.
   * De 1,00·R0 en adelante el número no mejora y el agua deja de morder el
   * pueblo. La cifra tendría que sobrar el día que el generador multiplique la
   * `d` del litoral entregado por su propio `lobeAt(θ)`, como ya hace con la
   * que se inventa — ver el informe.
   */
  let inland = Infinity;
  for (const p of run) inland = Math.min(inland, p.x * dir.x + p.y * dir.y);
  const shift = R0 * 0.90 - inland;
  const line = run.map((p) => ({ x: p.x + dir.x * shift, y: p.y + dir.y * shift }));
  return { line, dir };
}

/**
 * EL RÍO DE VERDAD, EN SU SITIO Y CON SU ANCHO.
 *
 * El río del mundo pasa POR la celda del pueblo, así que aquí sí hay verdad
 * métrica: su eje pasa por el plano donde el atlas dice, con el rumbo que el
 * atlas dibuja. Lo que no hay es meandro — dos vértices consecutivos del cauce
 * están a 9 773 unidades y el plano mide 190, o sea que el tramo visible es un
 * segmento recto, y eso es exactamente lo que el mundo sabe. Inventarle una
 * sinusoide (que es lo que había) no añade información: la cambia de sitio.
 *
 * El ANCHO sale del caudal local y de `worldRiverWidthMetres`, la misma ley
 * física que usa el vector del mapa. No se vuelve a encoger para que quepa en
 * la ciudad: si el cauce es demasiado ancho para cruzarlo, el casco se coloca
 * en una orilla. Ese es precisamente el contexto que el ancho transporta.
 */
function riverFor(world: WorldData, s: Settlement, R0: number): { line: V[]; width: number; dir: V } | null {
  const W = world.width;
  const anchor = settlementCellCenter(s);
  const index = riverIndex(world);
  const all = riversOf(world);
  const sx = Math.round(s.x), sy = Math.round(s.y);
  // La celda propia primero, luego dos anillos: un pueblo «de río» está sobre
  // el cauce por construcción, pero uno pintado a mano puede no estarlo.
  let found: [number, number] | null = null;
  for (let ring = 0; ring <= 2 && !found; ring++) {
    for (let dy = -ring; dy <= ring && !found; dy++) {
      for (let dx = -ring; dx <= ring && !found; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const list = index.get(cellOf(world, sx + dx, sy + dy));
        if (list?.length) found = list[0];
      }
    }
  }
  if (!found) return null;
  const [ri, k] = found;
  const river = all[ri];
  const cells = river.cells;
  const units = unitsPerWorldCell(world);
  // Cuatro vértices a cada lado, suavizados con la misma Catmull-Rom que usa
  // el canon al tallar los ríos del mundo en el pliego: la línea que se
  // entrega es la línea que el tile dibuja debajo.
  const seg: { x: number; y: number }[] = [];
  for (let j = Math.max(0, k - 4); j <= Math.min(cells.length - 1, k + 4); j++) {
    const c = cells[j];
    let dx = (c % W) + 0.5 - anchor.x;
    if (dx > W / 2) dx -= W;
    if (dx < -W / 2) dx += W;
    seg.push({ x: dx * units, y: (((c / W) | 0) + 0.5 - anchor.y) * units });
  }
  if (seg.length < 2) return null;
  const line = runThroughOrigin(smoothPolyline(seg, 12), R0 * 2.8, R0 / 8);
  if (line.length < 2) return null;

  // Caudal LOCAL, no el de la desembocadura: un pueblo en la cabecera de un
  // gran río no tiene un gran río, tiene el arroyo con el que empieza.
  const local = world.flow[cells[k]];
  const flow = Math.max(local, river.flow * 0.35);
  const widthUnits = worldRiverWidthMetres(flow) / METRES_PER_CITY_UNIT;
  // `riverine` is a catchment score, not proof that a published river axis
  // crosses this particular town. Neighbouring world cells are tens of
  // kilometres apart; accepting the first river in a two-cell ring made the
  // modal inherit a random remote river. Keep only a channel that reaches the
  // actual urban sheet. Smaller uncharted streams remain terrain detail.
  const nearest = closestPointToOrigin(line);
  if (Math.hypot(nearest.x, nearest.y) > R0 * 1.8 + widthUnits * 0.5) return null;
  const a = line[0], b = line[line.length - 1];
  const m = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return {
    line,
    width: Math.max(R0 * 0.05, widthUnits),
    dir: { x: (b.x - a.x) / m, y: (b.y - a.y) / m },
  };
}

/**
 * EL RELIEVE QUE TIENE EL PUEBLO, NO EL QUE TIENE LA COMARCA.
 *
 * `slopeDir` era una diferencia central del ráster: el desnivel entre dos
 * celdas separadas 78 km. Medido en los seis pueblos mayores, esa dirección se
 * aparta entre 49° y 179° de la ladera que el pueblo tiene realmente debajo —
 * mediana 92°, o sea perpendicular, que es lo mismo que no saberlo. Con eso la
 * ciudadela se colocaba cuesta abajo tan a menudo como cuesta arriba.
 *
 * Aquí se amplifica el suelo con la MISMA retícula del canon (152,7 m/celda,
 * `buildElevation` con `DEFAULT_REGION_PARAMS`, la retícula anclada al mundo),
 * o sea el mismo relieve que sombrea el tile satélite sobre el que se dibuja
 * el plano, y se ajusta un plano por mínimos cuadrados a las celdas que el
 * pueblo pisa. Cuesta 0,84 ms por pueblo, 76 ms para los 90 del mundo, y se
 * cachea por mundo y revisión.
 */
function reliefFor(world: WorldData, s: Settlement, R0: number): { dir: V | null; amount: number } {
  const ref = canonRefinement(world);
  const anchor = settlementCellCenter(s);
  const per = 1 / ref;
  const N = 24; // 3,67 km: unas quince veces el radio de una capital
  // Origen SNAPEADO a la retícula del canon, que es lo que hace que estas
  // muestras sean los mismos puntos que el tile — ver `latticeOffset`.
  const originX = Math.round(anchor.x * ref) / ref - (N / 2) * per;
  const originY = Math.round(anchor.y * ref) / ref - (N / 2) * per;
  const g: RegionGeometry = {
    width: N, height: N, margin: 0,
    metresPerCell: canonMetresPerCell(world),
    originX, originY,
    worldPerCellX: per, worldPerCellY: per,
  };
  let elev: Float32Array;
  try {
    elev = buildElevation(world, g, extractPatch(world, g), DEFAULT_REGION_PARAMS);
  } catch {
    return { dir: null, amount: 0 };
  }
  const cx = (anchor.x - originX) * ref - 0.5, cy = (anchor.y - originY) * ref - 0.5;
  // El radio del pueblo en celdas de canon; nunca menos de 2 o el ajuste no
  // tiene de dónde agarrarse (una aldea son 0,7 celdas).
  const rCells = Math.max(2, Math.min(N / 2 - 2, (R0 * METRES_PER_CITY_UNIT) / g.metresPerCell));
  let sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, n = 0;
  const i0 = Math.max(0, Math.floor(cx - rCells)), i1 = Math.min(N - 1, Math.ceil(cx + rCells));
  const j0 = Math.max(0, Math.floor(cy - rCells)), j1 = Math.min(N - 1, Math.ceil(cy + rCells));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = i - cx, dy = j - cy;
      if (dx * dx + dy * dy > rCells * rCells) continue;
      const z = elev[j * N + i];
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
      sxz += dx * z; syz += dy * z; n++;
    }
  }
  const det = sxx * syy - sxy * sxy;
  if (n < 4 || Math.abs(det) < 1e-9) return { dir: null, amount: 0 };
  const a = (sxz * syy - syz * sxy) / det;
  const b = (syz * sxx - sxz * sxy) / det;
  const mag = Math.hypot(a, b);
  if (!(mag > 1e-9)) return { dir: null, amount: 0 };
  // `elev` está en km y el paso es una celda de canon: pendiente adimensional.
  const grade = (mag * 1000) / g.metresPerCell;
  // Un 9 % es un pueblo decididamente empinado. Medido, los seis mayores del
  // mundo caen entre el 2 y el 4 %, que da 0,25–0,45 de fuerza.
  return { dir: { x: a / mag, y: b / mag }, amount: Math.min(1, grade / 0.09) };
}

function townGround(world: WorldData, s: Settlement): TownGround {
  const rev = world.revision ?? 0;
  let cache = GROUND.get(world);
  if (!cache || cache.rev !== rev) GROUND.set(world, (cache = { rev, map: new Map() }));
  const key = `${s.id}:${s.x}:${s.y}:${s.rank}:${s.port ? 1 : 0}:${s.river ? 1 : 0}`;
  const hit = cache.map.get(key);
  if (hit) return hit;

  const R0 = 10 + planSizeFor(s) * 2.5;
  const shore = s.port ? shoreFor(world, s, R0) : null;
  const river = s.river ? riverFor(world, s, R0) : null;
  const relief = reliefFor(world, s, R0);

  // El rumbo al mar cuando no ha salido contorno alguno: el barrido de celdas
  // de siempre, para que un puerto raro no se quede sin dirección de agua.
  let coastDir = shore?.dir ?? null;
  if (s.port && !coastDir) {
    const W = world.width, H = world.height;
    const at = (x: number, y: number) => Math.min(H - 1, Math.max(0, y)) * W + (((x % W) + W) % W);
    const sx = Math.round(s.x), sy = Math.round(s.y);
    let best = Infinity;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (!dx && !dy) continue;
        if (world.elevation[at(sx + dx, sy + dy)] > 0) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; coastDir = { x: dx, y: dy }; }
      }
    }
  }

  const ground: TownGround = {
    coastDir,
    riverDir: river?.dir ?? null,
    slopeDir: relief.dir,
    slopeAmount: relief.amount,
    shoreLine: shore ? shore.line : null,
    riverCourse: river ? { line: river.line, width: river.width } : null,
  };
  cache.map.set(key, ground);
  return ground;
}

function closestPointToOrigin(line: V[]): V {
  let best = line[0] ?? { x: 0, y: 0 };
  let bestD = best.x * best.x + best.y * best.y;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 1e-9 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / l2)) : 0;
    const p = { x: a.x + dx * t, y: a.y + dy * t };
    const d = p.x * p.x + p.y * p.y;
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/**
 * Luz máxima que sabe salvar un puente, EN METROS, por rango.
 *
 * El criterio anterior era `ancho ≤ k·R0`: comparaba el río con el TAMAÑO DEL
 * DIBUJO, no con la ingeniería. Como aquí una capital mide 380 m de radio
 * nominal, «0,64·R0» son 243 m — y encima exigía además caminos por las dos
 * márgenes, que casi ninguna población tiene (0–3 caminos por ciudad). Sobre el
 * mundo de Luis el resultado fue exacto: 32 ciudades con cauce, 32 en modo
 * orilla, CERO puentes en todo el planeta. Un mundo sin un solo puente.
 *
 * Un puente es una obra, y las obras tienen luces conocidas: el de Aviñón medía
 * 900 m, el Carlos de Praga 516, el de Londres 270, el Valentré 138. Una villa
 * levanta uno de madera sobre pilas de piedra; una capital, uno de veinte ojos.
 */
function bridgeSpanMetres(rank: Settlement['rank']): number {
  return rank === 'capital' ? 620 : rank === 'city' ? 380 : rank === 'town' ? 190 : 70;
}

/**
 * Decide whether this settlement genuinely spans its river or grows from one
 * bank.
 *
 * NO MIRA LA GEOGRAFÍA HUMANA, a propósito. Antes pesaba `roadBearings`, que
 * sólo existen si la geografía ya está construida: el mismo pueblo salía de
 * cruce desde la tesela (con geografía) y de orilla desde la ficha (sin ella),
 * o al revés según qué pase hubiera terminado. La decisión se toma ahora con lo
 * que el suelo dice siempre — anchura física del cauce, rango y un dado
 * determinista por identidad —, así que el plano es el mismo lo llame quien lo
 * llame y llegue cuando llegue.
 */
function riverPlacementFor(
  s: Settlement,
  R0: number,
  ground: TownGround,
): RiverPlacement {
  const course = ground.riverCourse;
  if (!course || course.line.length < 2) return { urbanCenter: { x: 0, y: 0 }, riverMode: 'bank' };
  const near = closestPointToOrigin(course.line);
  const nearD = Math.hypot(near.x, near.y);
  // A nearby river can explain the site without cutting through its streets.
  if (nearD > R0 * 1.2 + course.width * 0.5) {
    return { urbanCenter: { x: 0, y: 0 }, riverMode: 'bank' };
  }

  const dir = ground.riverDir ?? (() => {
    const a = course.line[0], b = course.line[course.line.length - 1];
    const m = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / m, y: (b.y - a.y) / m };
  })();
  const perp = { x: -dir.y, y: dir.x };
  /**
   * Dos condiciones, y las dos son reales.
   *
   * La INGENIERÍA dice si el puente se puede levantar (luz en metros). La
   * URBANÍSTICA dice si el pueblo puede tragarse el canal: un cauce más ancho
   * que el radio del casco no parte una ciudad en dos, la ahoga. Con sólo la
   * primera condición salieron ciudades de cruce sobre ríos de 334 m con un
   * radio nominal de 260 — medido: 292 edificios donde una ciudad seca del
   * mismo rango tiene 1.500, un pueblo hueco a cada lado de un lago.
   */
  const bridgeable = course.width * METRES_PER_CITY_UNIT <= bridgeSpanMetres(s.rank)
    && course.width <= R0 * (
      s.rank === 'capital' ? 0.85 : s.rank === 'city' ? 0.75 : s.rank === 'town' ? 0.60 : 0.35
    );
  /**
   * Y no todas las que PUEDEN, cruzan.
   *
   * Colonia creció en una orilla del Rin y Viena en una del Danubio; París y
   * Londres se comieron las dos. Un dado por identidad —no un sorteo del
   * generador, que barajaría todos los planos detrás de él— reparte esa
   * variedad sin perder el determinismo, y sube con el rango porque el puente
   * es caro y sólo una ciudad grande arrastra el arrabal de enfrente.
   */
  const die = ((s.id * 2654435761) >>> 0) % 100;
  const appetite = s.rank === 'capital' ? 82 : s.rank === 'city' ? 70 : s.rank === 'town' ? 58 : 0;
  if (bridgeable && die < appetite) {
    return { urbanCenter: { x: 0, y: 0 }, riverMode: 'crossing' };
  }

  // Wide rivers found towns on a bank, not in the channel. At an estuary the
  // side away from open sea wins; otherwise the settlement's own identity
  // decides, never render order or whether the atlas happened to be resident.
  let sign = (s.id & 1) ? 1 : -1;
  /**
   * El casco se aparta del canal LO JUSTO.
   *
   * Estaba en `ancho/2 + 0,58·R0`: el centro urbano se iba a más de medio radio
   * del agua y la ciudad acababa mirando su río desde lejos — medido, 78 m de
   * media entre la última casa y su propia orilla, sin un muelle en 32 ciudades.
   * Una ciudad de orilla ESTÁ en la orilla: la plaza se retira del agua lo que
   * ocupan el muelle y la primera hilera, y no más.
   */
  const clearance = course.width * 0.5 + Math.max(4, R0 * 0.24);
  const candidate = (sgn: number): V => ({
    x: near.x + perp.x * clearance * sgn,
    y: near.y + perp.y * clearance * sgn,
  });
  if (ground.shoreLine?.length && ground.coastDir) {
    const n = ground.coastDir;
    const coastD = Math.min(...ground.shoreLine.map((v) => v.x * n.x + v.y * n.y));
    const a = candidate(1), b = candidate(-1);
    const aSea = a.x * n.x + a.y * n.y - coastD;
    const bSea = b.x * n.x + b.y * n.y - coastD;
    if ((aSea > 0) !== (bSea > 0)) sign = aSea <= 0 ? 1 : -1;
  }
  return { urbanCenter: candidate(sign), riverMode: 'bank' };
}

/**
 * Todo lo que el mundo le dice a un plano de ciudad.
 *
 * `geo` es opcional a propósito y NO se construye si falta: `getGeography` es
 * un pase de cuatro segundos en un mundo de 1024 y de diecinueve en uno de
 * 2048, y esta función la llama un memo de React y el pintor de tiles. Si no
 * llega una geografía se mira la caché de este módulo, y si tampoco hay nada
 * el plano se queda sin rumbos de camino y el generador vuelve a sus puertas
 * repartidas — que es una degradación, no una parada.
 */
export function cityParamsFor(
  world: WorldData,
  s: Settlement,
  geo?: HumanGeography,
): CityParams & { name: string; population: number } {
  const size = planSizeFor(s);
  const ground = townGround(world, s);
  const known = geo ?? GEO_CACHE.get(world)?.geo;
  const roadBearings = known ? roadBearingsFor(world, known, s) : [];
  const placement = riverPlacementFor(s, 10 + size * 2.5, ground);
  return {
    seed: `${world.params.seed}::city::${s.id}`,
    name: s.name,
    size,
    walls: s.rank !== 'village',
    citadel: s.rank === 'capital' || s.rank === 'city',
    // Flags explain why the settlement was selected; geometry decides what is
    // actually present on this sheet. Never synthesize a second, unrelated
    // river merely because the gazetteer says "river".
    river: !!ground.riverCourse,
    coast: !!ground.shoreLine,
    farms: !BARREN_BIOMES.has(world.biome[cellOf(world, s.x, s.y)]),
    culture: s.culture,
    population: s.population,
    coastDir: ground.coastDir,
    riverDir: ground.riverDir,
    slopeDir: ground.slopeDir,
    slopeAmount: ground.slopeAmount,
    roadBearings,
    shoreLine: ground.shoreLine,
    riverCourse: ground.riverCourse,
    urbanCenter: placement.urbanCenter,
    riverMode: placement.riverMode,
    // A little per-town variation in how lobed it is: a planned bastide and a
    // village that grew where the tracks crossed are not the same shape.
    irregularity: 0.38 + ((s.id * 2654435761) % 1000) / 1000 * 0.34,
  };
}

/**
 * The regional patch as a colour raster over its FULL grid — margin included,
 * because the 3D drape addresses the same uv space the height patch does, and
 * a cropped canvas would land the colours a gutter's width off the relief.
 * Biome tint, water, and a one-cell slope shade; deliberately the same palette
 * the 2D overlay draws, so the two views agree about what the ground is.
 */
export function regionAlbedoCanvas(region: RegionData): HTMLCanvasElement {
  const w = region.width, h = region.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let color = BIOME_COLORS[region.biome[i]] ?? [116, 120, 105];
      if (region.water[i] === 1) color = [48, 90, 126];
      else if (region.water[i] === 2) color = [67, 112, 142];
      const left = region.elevation[y * w + Math.max(0, x - 1)];
      const up = region.elevation[Math.max(0, y - 1) * w + x];
      const here = region.elevation[i];
      const shade = Math.min(1.24, Math.max(0.68, 0.98 + (left + up - here * 2) * 18));
      const o = i * 4;
      rgba[o] = Math.round(color[0] * shade);
      rgba[o + 1] = Math.round(color[1] * shade);
      rgba[o + 2] = Math.round(color[2] * shade);
      rgba[o + 3] = 255;
    }
  }
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas;
}
