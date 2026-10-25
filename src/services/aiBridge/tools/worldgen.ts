// ============================================================================
// AI bridge tools — generated worlds: places, edits, waypoints and links
// ============================================================================
//
// A world is stored as seed + parameters + an ordered edit list; its terrain
// and its places are regenerated on demand (engines/worldgen/bridgeAccess.ts
// spells out the reading and writing rules). Two consequences shape every
// tool here:
//
//   • Reading places needs the world in memory. A world never opened on this
//     machine is forged in the background and the tool answers `pending` —
//     a result, not an error, so the model waits and asks again.
//   • Writing is appending an edit to the list, through whichever writer owns
//     the world right now (an open view, or the row). The audit records the
//     list as it stood, and the generic undo puts that list back.
//
// Places are addressed by the position-derived key the app's own rename and
// delete edits use (`settlement:512,201`, `landmark:volcano:12,6`), so a
// rename made from here is exactly the rename the reader could have made by
// hand, and the map, the index and the manuscript links all agree on it.
//
// Waypoints and entity links are ordinary rows and follow the maps.ts pattern.

import { db } from '@/db';
import type { EntityLink } from '@/types/projectTools';
import {
  WAYPOINT_COLORS,
  type GeneratedWorld,
  type WorldWaypoint,
} from '@/engines/worldgen/types';
import { worldgenScopeOperations, worldRuntimeKey, listWorldLinks, saveWorldLink } from '@/engines/worldgen/era';
import { worldEraToolScope } from '@/services/worldEras/toolScope';
import { readEraRow } from '@/services/worldEras/store';
import {
  applyWorldEdits,
  isForging,
  openWorldForReading,
  type OpenWorldResult,
} from '@/engines/worldgen/bridgeAccess';
import {
  deserializeEdits,
  editKey,
  nextPaintedKey,
  targetFromKey,
  type EditTarget,
  type WorldEdit,
} from '@/engines/worldgen/core/edits';
import {
  normalizeParams,
  type LandmarkType,
  type MarkerKind,
  type RuinKind,
  type WorldData,
} from '@/engines/worldgen/core/types';
import { placeAt, type AtlasPlace, type AtlasPlaceKind } from '@/engines/worldgen/core/atlas';
import { normalizeLabelChange, type LabelChange } from '@/engines/worldgen/core/labelShape';
import { landmarkKey } from '@/engines/worldgen/core/spatialEntities';
import { foldForSearch, matchRank } from '@/engines/worldgen/core/searchText';
import { buildGazetteer } from '@/engines/worldgen/core/gazetteer';
import { liveWorld } from '@/engines/worldgen/core/liveWorlds';
import type { GeoDepth } from '@/engines/worldgen/core/settlements';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  clampLimit,
  optEnum,
  optNumber,
  optString,
  requireString,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const ENGINE = 'worldgen';

type MarkerEdit = Extract<WorldEdit, { kind: 'marker' }>;
type LabelEdit = Extract<WorldEdit, { kind: 'label' }>;
type SettlementRank = NonNullable<MarkerEdit['rank']>;

const MARKERS = ['settlement', 'ruin', 'landmark'] as const satisfies readonly MarkerKind[];
const RANKS = ['capital', 'city', 'town', 'village'] as const satisfies readonly SettlementRank[];
const RUINS = [
  'city', 'fort', 'tower', 'temple', 'stones', 'bridge', 'mine', 'wall',
] as const satisfies readonly RuinKind[];
const LANDMARKS = [
  'volcano', 'cave', 'waterfall', 'gorge', 'hotspring',
] as const satisfies readonly LandmarkType[];
const LABEL_STYLES = [
  'region', 'water', 'range', 'settlement', 'note',
] as const satisfies readonly (LabelEdit['style'])[];
const PLACE_KINDS = [
  'settlement', 'ruin', 'realm', 'feature', 'landmark', 'region',
] as const satisfies readonly AtlasPlaceKind[];
const DEPTHS = ['places', 'full'] as const satisfies readonly GeoDepth[];
const LINK_TARGETS = ['codex-entry', 'scene', 'writing', 'timeline-event'] as const;
type LinkTarget = (typeof LINK_TARGETS)[number];

/** Engine each link target lives in — what SpatialEntityInspector writes. */
const LINK_ENGINE: Record<LinkTarget, string> = {
  'codex-entry': 'codex',
  scene: 'dialog-scene',
  writing: 'writings',
  'timeline-event': 'timeline',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadWorld(args: ToolArgs): Promise<GeneratedWorld> {
  const worldId = requireString(args, 'worldId');
  const world = await worldgenScopeOperations(worldEraToolScope(args)).worlds.getOne(worldId);
  if (!world) throw new BridgeError('not-found', `No generated world with id "${worldId}".`);
  assertRowInScope(args, world.projectId);
  return world;
}

function requireNumber(args: ToolArgs, key: string): number {
  const value = optNumber(args, key);
  if (value === undefined) {
    throw new BridgeError('bad-args', `"${key}" is required and must be a finite number.`);
  }
  return value;
}

/**
 * Grid size from the parameters alone, for validating a write before (or
 * without) the terrain being in memory. Height follows from width: the grid
 * is an equirectangular planet (`H = W >> 1` in core/pipeline.ts).
 */
function worldSize(world: GeneratedWorld): { width: number; height: number } {
  const { width } = normalizeParams(world.params);
  return { width, height: Math.max(1, Math.floor(width / 2)) };
}

/** Integer cell coordinates inside the world, or a refusal that says the bounds. */
function cellCoords(
  args: ToolArgs,
  size: { width: number; height: number },
): { x: number; y: number } {
  const x = Math.round(requireNumber(args, 'x'));
  const y = Math.round(requireNumber(args, 'y'));
  if (x < 0 || x >= size.width || y < 0 || y >= size.height) {
    throw new BridgeError(
      'bad-args',
      `Cell ${x},${y} is outside the world: x runs 0..${size.width - 1} west to east and y 0..${size.height - 1} north to south.`,
    );
  }
  return { x, y };
}

/** A place key as `editKey` spells it, or a refusal that shows the shape. */
function placeTarget(key: string): EditTarget {
  const target = targetFromKey(key);
  if (!target) {
    throw new BridgeError(
      'bad-args',
      `"${key}" is not a place key. Keys look like "settlement:512,201" or "landmark:volcano:12,6" and come from wh_list_places, wh_find_place or wh_place_at.`,
    );
  }
  return target;
}

/** The manuscript-link identity of a place — the same spelling the inspector writes. */
function spatialEntityId(worldId: string, key: string): string {
  return `${worldId}::${key}`;
}

/** Elevation in km at a cell of THIS snapshot (its own size indexes its arrays). */
function elevationAt(data: WorldData, x: number, y: number): number | undefined {
  if (x < 0 || y < 0 || x >= data.width || y >= data.height) return undefined;
  return data.elevation[y * data.width + x];
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** u is a longitude and wraps into [0, 1); v is a latitude and clamps to [0, 1]. */
function wrapU(u: number): number {
  return ((u % 1) + 1) % 1;
}

function clampV(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * The answer a not-yet-forged world gets. A result rather than a throw: the
 * world IS there, it is just being generated, and the model should try again
 * in half a minute instead of giving up or apologising.
 */
function pendingResult(
  world: GeneratedWorld,
  result: Extract<OpenWorldResult, { ok: false }>,
): Record<string, unknown> {
  return { worldId: world.id, pending: true, code: result.code, message: result.message };
}

/** The world's edit list as it stands: the open view's (saves are debounced) or the row's. */
function currentEdits(world: GeneratedWorld, args: ToolArgs): WorldEdit[] {
  const live = liveWorld(worldRuntimeKey(world.id, worldEraToolScope(args)?.eraId));
  try { return deserializeEdits(live ? live.snapshot() : world.edits ?? '[]'); } catch { return []; }
}

/** Refused with the bridge's own code when the edit would move or hide a locked place (the engine refuses too). */
async function refuseLocked(world: GeneratedWorld, args: ToolArgs, edit: WorldEdit): Promise<void> {
  const { lockViolation } = await import('@/engines/worldgen/core/edits');
  const key = lockViolation(currentEdits(world, args), [edit]);
  if (key) throw new BridgeError('locked', `Place ${key} is locked; unlock it with wh_lock_place (locked: false) before you move or remove it, and only if the author wants that.`);
}

/** The keys of the world's locked places, from its current edits. */
async function lockedKeysOf(world: GeneratedWorld, args: ToolArgs): Promise<Set<string>> {
  const { lockedPlaceKeys } = await import('@/engines/worldgen/core/edits');
  return lockedPlaceKeys(currentEdits(world, args));
}

function placeShape(place: AtlasPlace, data: WorldData, locked?: ReadonlySet<string>): Record<string, unknown> {
  return {
    ...(locked?.has(place.key) ? { locked: true } : {}),
    key: place.key,
    kind: place.kind,
    type: place.type,
    name: place.name,
    x: round(place.x, 2),
    y: round(place.y, 2),
    u: round(place.x / data.width, 4),
    v: round(place.y / data.height, 4),
    importance: round(place.importance, 2),
    realmKey: place.realmKey,
    source: place.source,
    style: place.style,
  };
}

function waypointShape(waypoint: WorldWaypoint): Record<string, unknown> {
  return {
    id: waypoint.id,
    name: waypoint.name,
    description: waypoint.description,
    color: waypoint.color,
    u: waypoint.u,
    v: waypoint.v,
  };
}

/** How many edits of each kind the world carries. Malformed JSON counts as none. */
function editDigest(world: GeneratedWorld): {
  editCount: number;
  edits: Record<'renames' | 'markers' | 'labels' | 'removed' | 'restored' | 'moves' | 'roads' | 'other', number>;
} {
  let edits: WorldEdit[] = [];
  if (world.edits) {
    try {
      edits = deserializeEdits(world.edits);
    } catch {
      edits = [];
    }
  }
  const counts = { renames: 0, markers: 0, labels: 0, removed: 0, restored: 0, moves: 0, roads: 0, other: 0 };
  for (const edit of edits) {
    switch (edit.kind) {
      case 'rename': counts.renames += 1; break;
      case 'marker': counts.markers += 1; break;
      case 'label': counts.labels += 1; break;
      case 'remove': counts.removed += 1; break;
      case 'restore': counts.restored += 1; break;
      case 'move': counts.moves += 1; break;
      case 'road': counts.roads += 1; break;
      default: counts.other += 1;
    }
  }
  return { editCount: edits.length, edits: counts };
}

function worldDigest(world: GeneratedWorld, waypoints: WorldWaypoint[]): Record<string, unknown> {
  const { width, height } = worldSize(world);
  return {
    id: world.id,
    title: world.title,
    seed: world.params.seed,
    width,
    height,
    // How big the map is: a sheet of worldKm across, or the planet (40075 km round).
    sheet: typeof world.params.worldKm === 'number' && world.params.worldKm < 40075,
    worldKm: typeof world.params.worldKm === 'number' && world.params.worldKm >= 1000 && world.params.worldKm < 40075 ? world.params.worldKm : 40075,
    cellKm: Math.round(((typeof world.params.worldKm === 'number' && world.params.worldKm >= 1000 && world.params.worldKm < 40075 ? world.params.worldKm : 40075) / width) * 1000) / 1000,
    ...editDigest(world),
    regions: (world.regions ?? []).map((region) => ({ id: region.id, title: region.title })),
    waypointCount: waypoints.length,
    updatedAt: world.updatedAt,
  };
}

/**
 * Append one edit through whichever writer owns the world, and wrap the audit.
 *
 * `before` is the serialised list as it stood and `table` names the row, so
 * the generic undo restores the list with an update — which is why no result
 * here ever says `deleted`: hiding a place is an edit, not a row going away.
 */
async function appendEdit<T extends object>(
  args: ToolArgs,
  world: GeneratedWorld,
  edit: WorldEdit | WorldEdit[],
  result: T,
  summary: string,
): Promise<unknown> {
  const { before, delivered } = await applyWorldEdits(world, Array.isArray(edit) ? edit : [edit], worldEraToolScope(args)?.eraId);
  return withAudit(
    { ...result, delivered },
    {
      projectId: world.projectId,
      entityId: world.id,
      table: 'generatedWorlds',
      summary,
      before: { edits: before },
    },
  );
}

// ---------------------------------------------------------------------------
// Reading worlds
// ---------------------------------------------------------------------------

export async function whListWorlds(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const worlds = await worldgenScopeOperations(worldEraToolScope(args)).worlds.getAll(projectId);
  return {
    projectId,
    worlds: await Promise.all(
      worlds.map(async (world) => worldDigest(world, await worldgenScopeOperations(worldEraToolScope(args)).waypoints.getAll(world.id))),
    ),
  };
}

export async function whGetWorld(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const waypoints = await worldgenScopeOperations(worldEraToolScope(args)).waypoints.getAll(world.id);
  return {
    ...worldDigest(world, waypoints),
    params: normalizeParams(world.params),
    // An open view means place reads are instant and edits land on screen.
    live: liveWorld(worldRuntimeKey(world.id, worldEraToolScope(args)?.eraId)) !== undefined,
    // A forge in progress means a place read will answer pending until it ends.
    forging: isForging(worldRuntimeKey(world.id, worldEraToolScope(args)?.eraId)),
    waypoints: waypoints.map(waypointShape),
    // Where the author moved the sea and the snowline (metres; 0 = as generated).
    ...(await import('@/engines/worldgen/core/edits')).worldLevels(currentEdits(world, args)),
  };
}

/** The same material renderer used by the cartographic view and PNG export. */
export async function whRenderWorldMap(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { resolvePresentation } = await import('@/engines/worldgen/presentation');
  const look = resolvePresentation(world.presentation);
  const themeId = optEnum(args, 'theme', ['wonder', 'antique', 'relief', 'survey'] as const) ?? look.theme;
  let view: { x: number; y: number; w: number; h: number } | undefined;
  if (args.view !== undefined) {
    if (!args.view || typeof args.view !== 'object' || Array.isArray(args.view)) throw new BridgeError('bad-args', 'view must be a rectangle in world cells: {x,y,w,h}.');
    const candidate = args.view as Record<string, unknown>;
    if (!['x', 'y', 'w', 'h'].every(key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]))) throw new BridgeError('bad-args', 'view coordinates must be finite numbers.');
    view = { x: Number(candidate.x), y: Number(candidate.y), w: Number(candidate.w), h: Number(candidate.h) };
    if (view.x < 0 || view.y < 0 || view.w <= 0 || view.h <= 0 || view.x + view.w > opened.world.data.width || view.y + view.h > opened.world.data.height) throw new BridgeError('bad-args', 'view must lie within the world grid.');
  }
  const width = optNumber(args, 'width') ?? 1600;
  const height = optNumber(args, 'height') ?? Math.round(width * (view?.h ?? opened.world.data.height) / (view?.w ?? opened.world.data.width));
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) throw new BridgeError('bad-args', 'Image width and height must be positive integers.');
  const { renderCartoCanvas,collectCartoPlaceImageStyles } = await import('@/engines/worldgen/cartography/texture');
  const { themeById } = await import('@/engines/worldgen/cartography/theme');
  const { DEFAULT_LAYERS } = await import('@/engines/worldgen/cartography/render');
  // The reader's-eye map: blank paper where the story has not been yet (up to a chapter, if given).
  let fog: import('@/engines/worldgen/cartography/readerFogLayer').ReaderFogLayer | null = null;
  let story: import('@/engines/worldgen/core/storyEvents').StoryEvent[] | null = null;
  let townDots: { x: number; y: number }[] | null = null;
  let trail: { x: number; y: number; chapter?: number }[] | null = null;
  // readerChapter implies the reader's view unless readerView is explicitly false.
  const readerView = args.readerView === true || (args.readerView === undefined && args.readerChapter !== undefined && args.readerChapter !== null);
  if (args.readerView !== undefined && typeof args.readerView !== 'boolean') throw new BridgeError('bad-args', 'readerView must be true or false.');
  if (readerView) {
    let chapter: number | null = null;
    if (args.readerChapter !== undefined && args.readerChapter !== null) {
      if (typeof args.readerChapter !== 'number' || !Number.isInteger(args.readerChapter) || args.readerChapter < 0) throw new BridgeError('bad-args', 'readerChapter must be a whole number from 0 up.');
      chapter = args.readerChapter;
    }
    const { fogMask } = await import('@/engines/worldgen/core/readerFog');
    const data = opened.world.data;
    fog = { mask: fogMask(deserializeEdits(world.edits ?? '[]'), data.width, data.height, look.readerStart, chapter, data.elevation), width: data.width, height: data.height, mode: 'reader', ...(look.readerTowns === 'dots' ? { townDots: true } : {}) };
    const { storyEventsFrom, storyKnownBy } = await import('@/engines/worldgen/core/storyEvents');
    story = storyKnownBy(storyEventsFrom(deserializeEdits(world.edits ?? '[]')), chapter);
    // Towns as dots and the party's trail, as the look asks.
    if (fog.townDots) {
      const { fogStateAt } = await import('@/engines/worldgen/cartography/readerFogLayer');
      const { FOG_HEARD } = await import('@/engines/worldgen/core/readerFog');
      townDots = (opened.world.geo?.settlements ?? []).filter((s) => fogStateAt(fog, s.x + 0.5, s.y + 0.5) === FOG_HEARD).map((s) => ({ x: s.x, y: s.y }));
    }
    if (look.readerTrail) {
      const done = story.filter((event) => event.status === 'happened');
      if (done.length >= 2) trail = done.map((event) => ({ x: event.x - 0.5, y: event.y - 0.5, ...(event.chapter !== undefined ? { chapter: event.chapter } : {}) }));
    }
  } else if (args.storyEvents === true) {
    const { storyEventsFrom } = await import('@/engines/worldgen/core/storyEvents');
    story = storyEventsFrom(deserializeEdits(world.edits ?? '[]'));
  }
  if (args.storyEvents !== undefined && typeof args.storyEvents !== 'boolean') throw new BridgeError('bad-args', 'storyEvents must be true or false.');
  // The hour: a name from the map's light menu or a clock hour.
  const { MAP_HOURS } = await import('@/engines/worldgen/core/hourLight');
  let hour: number | null = args.hour === undefined && look.mapHour !== 'off' && look.mapHour !== 'journey' ? MAP_HOURS[look.mapHour] : null;
  if (args.hour !== undefined && args.hour !== null) {
    if (typeof args.hour === 'string' && Object.hasOwn(MAP_HOURS, args.hour)) hour = MAP_HOURS[args.hour as keyof typeof MAP_HOURS];
    else if (typeof args.hour === 'number' && Number.isFinite(args.hour) && args.hour >= 0 && args.hour <= 24) hour = args.hour;
    else throw new BridgeError('bad-args', `hour must be a clock hour from 0 to 24 or one of ${Object.keys(MAP_HOURS).join(', ')}.`);
  }
  // The author's zones are part of the author's map, not of what the reader has seen.
  const zones = readerView ? null : (await import('@/engines/worldgen/core/zones')).zonesFrom(deserializeEdits(world.edits ?? '[]'));
  const {preparePlaceImages,webPlaceImageAdapter}=await import('@/engines/worldgen/cartography/placeImages');
  const canvasOptions={theme:themeById(themeId),width,height,view,geography:opened.world.geo,title:world.title,grid:look.grid,fog,story,zones,trail,townDots,layers:{...DEFAULT_LAYERS,...look.layers,...(look.contours===null?{}:{contours:false})},contourIntervalM:typeof look.contours==='number'?look.contours:null,reliefAmount:look.reliefAmount};
  const imageStyles=collectCartoPlaceImageStyles(opened.world.data,canvasOptions);
  const placeImages=await preparePlaceImages(imageStyles,webPlaceImageAdapter(),{strict:true});
  try{
  const canvas = renderCartoCanvas(opened.world.data,{...canvasOptions,placeImages});
  if (hour !== null) {
    const { drawHourLight } = await import('@/engines/worldgen/core/hourLight');
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (ctx) drawHourLight(ctx, 0, 0, canvas.width, canvas.height, hour);
  }
  return { worldId: world.id, theme: themeId, ...(readerView ? { readerView: true } : {}), ...(hour !== null ? { hour } : {}), view: view ?? { x: 0, y: 0, w: opened.world.data.width, h: opened.world.data.height }, width: canvas.width, height: canvas.height, mime: 'image/png', filename: `${world.title.replace(/[<>:"/\\|?*]/g, '_') || 'world'}-${themeId}.png`, dataUrl: canvas.toDataURL('image/png') };
  }finally{placeImages.dispose();}
}

export async function whListPlaces(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const kind = optEnum(args, 'kind', PLACE_KINDS);
  const scope = optEnum(args, 'scope', DEPTHS) ?? 'full';
  const limit = clampLimit(optNumber(args, 'limit'), 200, 1000);

  const opened = await openWorldForReading(world, scope, worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data, atlas, live } = opened.world;

  const matching = atlas.places
    .filter((place) => !kind || place.kind === kind)
    .sort((a, b) => b.importance - a.importance);
  const locked = await lockedKeysOf(world, args);
  return {
    worldId: world.id,
    scope,
    total: matching.length,
    returned: Math.min(limit, matching.length),
    live,
    places: matching.slice(0, limit).map((place) => placeShape(place, data, locked)),
  };
}

export async function whFindPlace(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const query = requireString(args, 'query').trim();
  const limit = clampLimit(optNumber(args, 'limit'), 10, 100);

  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data, atlas, live } = opened.world;

  // matchRank: lower is better, -1 is no match. Ties go to the more important
  // place, so "Río" typed alone lists the great river before the brook.
  const folded = foldForSearch(query);
  const ranked = atlas.places
    .map((place) => ({ place, rank: matchRank(foldForSearch(place.name), folded) }))
    .filter((hit) => hit.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.place.importance - a.place.importance);
  const locked = await lockedKeysOf(world, args);
  return {
    worldId: world.id,
    query,
    total: ranked.length,
    returned: Math.min(limit, ranked.length),
    live,
    places: ranked.slice(0, limit).map((hit) => placeShape(hit.place, data, locked)),
  };
}

export async function whPlaceAt(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const { x, y } = cellCoords(args, worldSize(world));
  const maxCells = Math.max(1, optNumber(args, 'maxCells') ?? 8);

  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data, atlas, live } = opened.world;

  const elevation = elevationAt(data, x, y);
  const place = placeAt(atlas, data, x, y, maxCells);
  return {
    worldId: world.id,
    x,
    y,
    elevation: elevation === undefined ? undefined : round(elevation, 3),
    sea: elevation === undefined ? undefined : elevation <= 0,
    lake: data.lake[y * data.width + x] === 1,
    // The ground there by key (what wh_paint_biome paints), as the classifier or the author left it.
    ground: (await import('@/engines/worldgen/core/biomeKeys')).BIOME_KEY[data.biome[y * data.width + x]] ?? null,
    ...(place && (await lockedKeysOf(world, args)).has(place.key) ? { locked: true } : {}),
    live,
    found: place !== null,
    place: place ? placeShape(place, data) : undefined,
  };
}

export async function whWorldSummary(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data, geo, live } = opened.world;
  return {
    worldId: world.id,
    title: world.title,
    live,
    markdown: buildGazetteer(data, geo, { title: world.title }),
  };
}

// ---------------------------------------------------------------------------
// Editing places
// ---------------------------------------------------------------------------

export async function whAddPlace(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const marker = optEnum(args, 'marker', MARKERS);
  if (!marker) {
    throw new BridgeError('bad-args', `"marker" is required: one of ${MARKERS.join(', ')}.`);
  }
  const { x, y } = cellCoords(args, worldSize(world));
  const edit: MarkerEdit = { kind: 'marker', marker, x, y };
  // Only the fields actually given go into the edit: the engine coins a name
  // for a nameless marker, and an explicit `name: undefined` would not survive
  // the JSON round trip anyway.
  const name = optString(args, 'name')?.trim() || undefined;
  if (name) edit.name = name;

  let key: string;
  if (marker === 'landmark') {
    const landmark = optEnum(args, 'landmark', LANDMARKS);
    if (!landmark) {
      throw new BridgeError(
        'bad-args',
        `A landmark needs "landmark": one of ${LANDMARKS.join(', ')}.`,
      );
    }
    edit.landmark = landmark;
    key = landmarkKey({ type: landmark, x, y });
  } else if (marker === 'ruin') {
    edit.ruin = optEnum(args, 'ruin', RUINS) ?? 'city';
    key = editKey('ruin', x, y);
  } else {
    const rank = optEnum(args, 'rank', RANKS);
    if (rank) edit.rank = rank;
    const population = optNumber(args, 'population');
    if (population !== undefined) edit.population = Math.max(0, Math.round(population));
    // The engine silently skips a town founded in the sea. Refusing here costs
    // one read and saves the model a key that points at nothing; a world still
    // being forged cannot be checked, and the placement goes ahead.
    const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
    if (opened.ok) {
      const elevation = elevationAt(opened.world.data, x, y);
      if (elevation !== undefined && elevation <= 0) {
        throw new BridgeError(
          'bad-args',
          'That cell is sea; settlements need land. Use wh_place_at to check a cell before placing.',
        );
      }
    }
    key = editKey('settlement', x, y);
  }

  return appendEdit(
    args, world,
    edit,
    { key, marker, x, y, name },
    `placed ${marker} "${name ?? key}" at ${x},${y} in world "${world.title}"`,
  );
}

export async function whRenamePlace(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const key = requireString(args, 'key');
  const target = placeTarget(key);
  const name = requireString(args, 'name').trim();
  return appendEdit(
    args, world,
    { kind: 'rename', target, key, name },
    { key, name },
    `renamed place ${key} to "${name}" in world "${world.title}"`,
  );
}

export async function whMovePlace(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const key = requireString(args, 'key');
  const target = placeTarget(key);
  const { x, y } = cellCoords(args, worldSize(world));
  await refuseLocked(world, args, { kind: 'move', target, key, x, y });
  return appendEdit(
    args, world,
    { kind: 'move', target, key, x, y },
    { key, x, y },
    `moved place ${key} to ${x},${y} in world "${world.title}"`,
  );
}

export async function whRemovePlace(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const key = requireString(args, 'key');
  const target = placeTarget(key);
  await refuseLocked(world, args, { kind: 'remove', target, key });
  // `removed`, never `deleted`: the place is hidden by an edit that
  // wh_restore_place (or an undo) reverses, and no row goes anywhere.
  return appendEdit(
    args, world,
    { kind: 'remove', target, key },
    { key, removed: true },
    `removed place ${key} from world "${world.title}"`,
  );
}

/** Lock a place against moving and hiding, or unlock it. */
export async function whLockPlace(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const key = requireString(args, 'key');
  const target = placeTarget(key);
  const locked = args.locked === undefined ? true : args.locked;
  if (typeof locked !== 'boolean') throw new BridgeError('bad-args', 'locked must be true or false.');
  // A lock on a key that names nothing would guard nothing: the place must exist.
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  if (!opened.world.atlas.byKey.has(key)) throw new BridgeError('not-found', `No place "${key}"; use wh_find_place for keys.`);
  return appendEdit(
    args, world,
    { kind: 'lock', target, key, locked },
    { key, locked },
    `${locked ? 'locked' : 'unlocked'} place ${key} in world "${world.title}"`,
  );
}

/** A copy of a settlement, ruin or landmark as a new hand-placed mark. */
export async function whDuplicatePlace(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const key = requireString(args, 'key');
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data, atlas } = opened.world;
  const place = atlas.byKey.get(key);
  if (!place) throw new BridgeError('not-found', `No place "${key}"; use wh_find_place for keys.`);
  const { duplicatePlaceEdit, duplicateSpot, duplicateName, keysInEdits } = await import('@/engines/worldgen/core/edits');
  if (!['settlement', 'ruin', 'landmark'].includes(place.kind)) throw new BridgeError('bad-args', `A ${place.kind} cannot be duplicated; only settlements, ruins and landmarks can.`);
  // A copy's key is its cell: one already used (a place there, or a rename, move,
  // removal or lock filed under it) would hand the copy that place's history.
  const used = keysInEdits(currentEdits(world, args));
  for (const p of atlas.places) {
    used.add(p.key);
    // A moved place keeps its old key but holds its new cell.
    if (p.kind === 'settlement' || p.kind === 'ruin') used.add(editKey(p.kind, p.x, p.y));
    if (p.kind === 'landmark') used.add(`landmark:${p.type}:${Math.round(p.x)},${Math.round(p.y)}`);
  }
  let at: { x: number; y: number } | null;
  if (args.x === undefined && args.y === undefined) {
    at = duplicateSpot(data, place, used);
    if (!at) throw new BridgeError('bad-args', 'No free land within five cells for the copy; give x and y.');
  } else {
    at = cellCoords(args, worldSize(world));
    const i = at.y * data.width + at.x;
    if (!(data.elevation[i] > 0) || data.lake[i]) throw new BridgeError('bad-args', 'That cell is sea or a lake; give x and y on dry land for the copy.');
    const k = place.kind === 'landmark' ? landmarkKey({ type: place.type as never, x: at.x, y: at.y }) : editKey(place.kind === 'ruin' ? 'ruin' : 'settlement', at.x, at.y);
    if (used.has(k)) throw new BridgeError('bad-args', `Cell ${at.x},${at.y} already has a place (or its history); pick another.`);
  }
  // Hand-placed landmarks carry their kind's name; towns and ruins get a numbered one.
  const name = optString(args, 'name')?.trim() || (place.kind === 'landmark' ? '' : duplicateName(place.name, new Set(atlas.places.map((p) => p.name))));
  const edit = duplicatePlaceEdit(place, at, name);
  if (!edit) throw new BridgeError('bad-args', `A ${place.kind} cannot be duplicated; only settlements, ruins and landmarks can.`);
  const newKey = edit.marker === 'landmark' ? landmarkKey({ type: edit.landmark as NonNullable<typeof edit.landmark>, x: at.x, y: at.y }) : editKey(edit.marker === 'ruin' ? 'ruin' : 'settlement', at.x, at.y);
  return appendEdit(
    args, world,
    edit,
    { key: newKey, from: key, marker: edit.marker, x: at.x, y: at.y, name: edit.name },
    `duplicated place ${key} as "${edit.name ?? newKey}" in world "${world.title}"`,
  );
}

export async function whRestorePlace(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const key = requireString(args, 'key');
  const target = placeTarget(key);
  return appendEdit(
    args, world,
    { kind: 'restore', target, key },
    { key, restored: true },
    `restored place ${key} in world "${world.title}"`,
  );
}

export async function whAddLabel(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { x, y } = cellCoords(args, worldSize(world));
  const text = requireString(args, 'text').trim();
  const style = optEnum(args, 'style', LABEL_STYLES) ?? 'note';
  const shape = labelShapeArgs(args);
  const edit: LabelEdit = { kind: 'label', x, y, text, style, ...shape };
  return appendEdit(
    args, world,
    edit,
    { key: nextPaintedKey(deserializeEdits(world.edits ?? '[]'), 'label', x, y), text, style, x, y, ...labelShapeShown(shape) },
    `labelled ${x},${y} "${text}" in world "${world.title}"`,
  );
}

/** size, angleDegrees, spacing and curve from tool arguments, validated. */
function labelShapeArgs(args: ToolArgs): Omit<LabelChange, 'text' | 'style'> {
  const raw: Record<string, unknown> = {};
  for (const key of ['size', 'spacing', 'curve'] as const) if (args[key] !== undefined) raw[key] = args[key];
  if (args.angleDegrees !== undefined) {
    if (typeof args.angleDegrees !== 'number' || !Number.isFinite(args.angleDegrees) || Math.abs(args.angleDegrees) > 180) throw new BridgeError('bad-args', 'angleDegrees must be a number from -180 to 180.');
    raw.angle = args.angleDegrees * Math.PI / 180;
  }
  try { return normalizeLabelChange(raw); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
}
function labelShapeShown(shape: { size?: number; angle?: number; spacing?: number; curve?: number }) {
  return {
    ...(shape.size !== undefined ? { size: shape.size } : {}),
    ...(shape.angle !== undefined ? { angleDegrees: Math.round(shape.angle * 180 / Math.PI * 10) / 10 } : {}),
    ...(shape.spacing !== undefined ? { spacing: shape.spacing } : {}),
    ...(shape.curve !== undefined ? { curve: shape.curve } : {}),
  };
}

/** Put a pictorial stamp on the map: an inn, shrine, tower, barrow… */
export async function whAddStamp(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { x, y } = cellCoords(args, worldSize(world));
  const { isStampGlyph, STAMPS } = await import('@/engines/worldgen/cartography/stampGlyphs');
  const glyph = requireString(args, 'glyph');
  if (!isStampGlyph(glyph)) throw new BridgeError('bad-args', `glyph must be one of ${STAMPS.map((stamp) => stamp.id).join(', ')}.`);
  const size = optEnum(args, 'size', ['S', 'M', 'L'] as const) ?? 'M';
  if (args.size !== undefined && !['S', 'M', 'L'].includes(String(args.size))) throw new BridgeError('bad-args', 'size must be S, M or L.');
  const name = optString(args, 'name')?.trim().slice(0, 120);
  return appendEdit(
    args, world,
    { kind: 'stamp', x, y, glyph, ...(size !== 'M' ? { size } : {}), ...(name ? { name } : {}) },
    { key: nextPaintedKey(deserializeEdits(world.edits ?? '[]'), 'stamp', x, y), glyph, size, x, y, ...(name ? { name } : {}) },
    `stamped ${glyph} at ${x},${y} in world "${world.title}"`,
  );
}

/** The stamps placed by hand, with keys, glyph, size, name and current cell. */
export async function whListStamps(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const painted = opened.world.data.painted;
  return {
    worldId: world.id,
    stamps: (painted?.stamps ?? []).map((stamp) => {
      const moved = painted?.moves?.[stamp.key];
      return { key: stamp.key, glyph: stamp.glyph, size: stamp.size ?? 'M', name: stamp.name ?? null, x: moved?.x ?? stamp.x, y: moved?.y ?? stamp.y };
    }),
  };
}

/** The reader's painted labels, with their keys, current place and shape. */
export async function whListLabels(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const painted = opened.world.data.painted;
  return {
    worldId: world.id,
    labels: (painted?.labels ?? []).map((label) => {
      const key = label.key ?? editKey('label', label.x, label.y), moved = painted?.moves?.[key];
      return { key, text: label.text, style: label.style, x: moved?.x ?? label.x, y: moved?.y ?? label.y, ...labelShapeShown(label) };
    }),
  };
}

/** Change a painted label's text, style, size, angle, letter spacing or bend. */
export async function whUpdateLabel(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const key = requireString(args, 'key');
  if (!key.startsWith('label:')) throw new BridgeError('bad-args', 'key must be a painted label key (label:x,y) from wh_list_labels.');
  // Only a label that is on the map now: not one removed, erased or never painted.
  const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  if (!(opened.world.data.painted?.labels ?? []).some((label) => label.key === key)) {
    throw new BridgeError('not-found', `No painted label "${key}" on this world; use wh_list_labels.`);
  }
  let change: LabelChange;
  try {
    change = { ...normalizeLabelChange({ text: args.text, style: args.style }), ...labelShapeArgs(args) };
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error));
  }
  if (!Object.keys(change).length) throw new BridgeError('bad-args', 'Give at least one of text, style, size, angleDegrees, spacing, curve.');
  return appendEdit(
    args, world,
    { kind: 'relabel', key, ...change },
    { key, ...(change.text ? { text: change.text } : {}), ...(change.style ? { style: change.style } : {}), ...labelShapeShown(change) },
    `changed label ${key} in world "${world.title}"`,
  );
}

// ---------------------------------------------------------------------------
// Waypoints — rows scoped by worldId
// ---------------------------------------------------------------------------

export async function whListWaypoints(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const waypoints = await worldgenScopeOperations(worldEraToolScope(args)).waypoints.getAll(world.id);
  return { worldId: world.id, waypoints: waypoints.map(waypointShape) };
}

export async function whAddWaypoint(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const name = requireString(args, 'name').trim();
  const u = wrapU(requireNumber(args, 'u'));
  const v = clampV(requireNumber(args, 'v'));
  // Colours cycle through the palette the way the view's own pin tool does.
  const existing = await worldgenScopeOperations(worldEraToolScope(args)).waypoints.getAll(world.id);
  const now = Date.now();
  const waypoint: WorldWaypoint = {
    id: generateId('wpt'),
    projectId: world.projectId,
    worldId: world.id,
    name,
    description: optString(args, 'description'),
    color: optString(args, 'color') ?? WAYPOINT_COLORS[existing.length % WAYPOINT_COLORS.length],
    u,
    v,
    createdAt: now,
    updatedAt: now,
  };
  await worldgenScopeOperations(worldEraToolScope(args)).waypoints.create(waypoint);
  return withAudit(
    { id: waypoint.id, worldId: world.id, u, v, created: true },
    {
      projectId: world.projectId,
      entityId: waypoint.id,
      summary: `added waypoint "${name}" to world "${world.title}"`,
    },
  );
}

export async function whUpdateWaypoint(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const waypoint = await worldgenScopeOperations(worldEraToolScope(args)).waypoints.getOne(id);
  if (!waypoint) throw new BridgeError('not-found', `No world waypoint with id "${id}".`);
  assertRowInScope(args, waypoint.projectId);
  await assertEngineEnabled(waypoint.projectId, ENGINE);

  const changes: Partial<WorldWaypoint> = {};
  const before: Partial<WorldWaypoint> = {};
  const name = optString(args, 'name')?.trim();
  if (name) {
    changes.name = name;
    before.name = waypoint.name;
  }
  const description = optString(args, 'description');
  if (description !== undefined) {
    changes.description = description;
    before.description = waypoint.description;
  }
  const color = optString(args, 'color');
  if (color !== undefined) {
    changes.color = color;
    before.color = waypoint.color;
  }
  const u = optNumber(args, 'u');
  if (u !== undefined) {
    changes.u = wrapU(u);
    before.u = waypoint.u;
  }
  const v = optNumber(args, 'v');
  if (v !== undefined) {
    changes.v = clampV(v);
    before.v = waypoint.v;
  }

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await worldgenScopeOperations(worldEraToolScope(args)).waypoints.update(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: waypoint.projectId,
      entityId: id,
      summary: `updated waypoint "${waypoint.name}"`,
      before,
    },
  );
}

// ---------------------------------------------------------------------------
// Links between a place and the manuscript
// ---------------------------------------------------------------------------

/** The row a link points at, with the title the inspector would file for it. */
async function findLinkTarget(
  type: LinkTarget,
  id: string,
  args: ToolArgs,
): Promise<{ projectId: string; title: string } | undefined> {
  switch (type) {
    case 'codex-entry': {
      const row = worldEraToolScope(args) ? await readEraRow<{ projectId: string; title: string }>(worldEraToolScope(args)!, 'codexEntries', id) : await db.codexEntries.get(id);
      return row && { projectId: row.projectId, title: row.title };
    }
    case 'scene': {
      const row = await db.scenes.get(id);
      return row && {
        projectId: row.projectId,
        title: row.sceneNumber ? `${row.sceneNumber}. ${row.title}` : row.title,
      };
    }
    case 'writing': {
      const row = worldEraToolScope(args) ? await readEraRow<{ projectId: string; title: string }>(worldEraToolScope(args)!, 'writings', id) : await db.writings.get(id);
      return row && { projectId: row.projectId, title: row.title };
    }
    case 'timeline-event': {
      const row = worldEraToolScope(args) ? await readEraRow<{ projectId: string; title: string }>(worldEraToolScope(args)!, 'timelineEvents', id) : await db.timelineEvents.get(id);
      return row && { projectId: row.projectId, title: row.title };
    }
  }
}

export async function whLinkPlace(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const key = requireString(args, 'key');
  placeTarget(key);
  const targetType = optEnum(args, 'targetType', LINK_TARGETS);
  if (!targetType) {
    throw new BridgeError(
      'bad-args',
      `"targetType" is required: one of ${LINK_TARGETS.join(', ')}.`,
    );
  }
  const targetId = requireString(args, 'targetId');
  const target = await findLinkTarget(targetType, targetId, args);
  if (!target) throw new BridgeError('not-found', `No ${targetType} with id "${targetId}".`);
  if (target.projectId !== world.projectId) {
    throw new BridgeError(
      'bad-args',
      `That ${targetType} belongs to a different project than the world.`,
    );
  }

  const sourceEntityId = spatialEntityId(world.id, key);
  const existing = (await listWorldLinks({ projectId: world.projectId, eraId: worldEraToolScope(args)?.eraId }, world.id)).filter(link => link.sourceEntityId === sourceEntityId)
    .find((link) => link.targetEntityType === targetType && link.targetEntityId === targetId);
  if (existing) {
    return { id: existing.id, sourceEntityId, created: false, alreadyLinked: true };
  }

  // The link carries the place's name, as the inspector files it, so a world
  // still being forged answers pending rather than filing a link titled with
  // a bare key. A key the atlas does not know (a regional-sheet hamlet) keeps
  // the key as its title, which is what the inspector would show too.
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const placeName = opened.world.atlas.byKey.get(key)?.name ?? key;

  const now = Date.now();
  const link: EntityLink = {
    id: generateId('entity-link'),
    projectId: world.projectId,
    sourceEngineId: ENGINE,
    sourceEntityType: 'world-spatial',
    sourceEntityId,
    sourceTitle: placeName,
    targetEngineId: LINK_ENGINE[targetType],
    targetEntityType: targetType,
    targetEntityId: targetId,
    targetTitle: target.title,
    relation: targetType === 'codex-entry' ? 'represents' : 'takes-place-at',
    provenance: 'manual',
    createdAt: now,
    updatedAt: now,
  };
  await saveWorldLink({ projectId: world.projectId, eraId: worldEraToolScope(args)?.eraId }, world.id, link);
  return withAudit(
    {
      id: link.id,
      sourceEntityId,
      placeName,
      targetTitle: target.title,
      relation: link.relation,
      created: true,
    },
    {
      projectId: world.projectId,
      entityId: link.id,
      summary: `linked place "${placeName}" to ${targetType} "${target.title}"`,
    },
  );
}

export async function whListPlaceLinks(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const key = optString(args, 'key');
  const prefix = spatialEntityId(world.id, '');
  const rows = (await listWorldLinks({ projectId: world.projectId, eraId: worldEraToolScope(args)?.eraId }, world.id)).filter(link => !key || link.sourceEntityId === spatialEntityId(world.id, key));
  const links = rows.filter(
    (link) => link.projectId === world.projectId && link.sourceEntityType === 'world-spatial',
  );
  return {
    worldId: world.id,
    key,
    total: links.length,
    links: links.map((link) => ({
      id: link.id,
      key: link.sourceEntityId.slice(prefix.length),
      placeName: link.sourceTitle,
      targetType: link.targetEntityType,
      targetId: link.targetEntityId,
      targetTitle: link.targetTitle,
      relation: link.relation,
      createdAt: link.createdAt,
    })),
  };
}

/** Create the card and its ordinary atlas link together, matching the inspector. */
export async function whCreatePlaceCard(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  await assertEngineEnabled(world.projectId, 'codex');
  const key = requireString(args, 'key');
  placeTarget(key);
  const type = optEnum(args, 'type', ['location', 'character', 'faction', 'item', 'concept', 'magic', 'custom'] as const) ?? 'location';
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const place = opened.world.atlas.byKey.get(key);
  if (!place) throw new BridgeError('not-found', 'No place with that key in this world.');
  const { createPlaceCard } = await import('@/engines/worldgen/placeCards');
  const receipt = await createPlaceCard({ projectId: world.projectId, eraId: worldEraToolScope(args)?.eraId }, world.id, place, type);
  return withAudit({ worldId: world.id, key, created: true, cardId: receipt.card.id, linkId: receipt.link.id, title: receipt.card.title, type: receipt.card.type }, {
    projectId: world.projectId, entityId: receipt.card.id, entityIds: [receipt.card.id, receipt.link.id], kind: 'create',
    summary: `created card "${receipt.card.title}" from an atlas place`, before: { __placeCard: receipt },
  });
}

// ---------------------------------------------------------------------------
// The saved look of a world
// ---------------------------------------------------------------------------

function presentationShape(world: GeneratedWorld, resolved: ReturnType<typeof import('@/engines/worldgen/presentation').resolvePresentation>) {
  return { worldId: world.id, revision: world.presentationRevision ?? 0, saved: world.presentation ?? {}, effective: resolved };
}

/** Read the look everyone who opens the world sees: style, layers, relief density and 3D skin. */
export async function whGetWorldPresentation(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const { resolvePresentation } = await import('@/engines/worldgen/presentation');
  return presentationShape(world, resolvePresentation(world.presentation));
}

/** Change the saved look, field by field, with optional compare-and-swap on the revision. */
export async function whSetWorldPresentation(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { saveWorldPresentation, resolvePresentation, WorldPresentationError } = await import('@/engines/worldgen/presentation');
  const patch: Record<string, unknown> = {};
  for (const key of ['theme', 'skin3D', 'stage3D', 'reliefAmount', 'layers', 'grid', 'readerStart', 'contours', 'clouds', 'block3D', 'readerTowns', 'readerTrail', 'mapHour']) if (args[key] !== undefined) patch[key] = args[key];
  if (!Object.keys(patch).length) throw new BridgeError('bad-args', 'Nothing to change: pass theme, skin3D, stage3D, reliefAmount, layers, grid, readerStart, contours, clouds, block3D, readerTowns, readerTrail or mapHour.');
  const expected = optNumber(args, 'expectedRevision');
  const scope = { projectId: world.projectId, eraId: worldEraToolScope(args)?.eraId };
  try {
    const receipt = await saveWorldPresentation(scope, world.id, patch, expected);
    const resolved = resolvePresentation(receipt.to);
    return withAudit(
      { worldId: world.id, revision: receipt.revision, saved: receipt.to, effective: resolved },
      { projectId: world.projectId, entityId: world.id, summary: `changed the look of world "${world.title}"`, before: { __worldPresentation: receipt } },
    );
  } catch (error) {
    if (error instanceof WorldPresentationError) throw new BridgeError(error.code === 'conflict' ? 'conflict' : error.code === 'not-found' ? 'not-found' : 'bad-args', error.message);
    throw error;
  }
}

/** Create a generated world from a named starting point, the same way the engine's form does. */
export async function whCreateWorld(args: ToolArgs): Promise<unknown> {
  const { resolveProjectId } = await import('./shared');
  const projectId = resolveProjectId(args);
  await assertEngineEnabled(projectId, ENGINE);
  const { WORLD_PRESETS, applyWorldPreset } = await import('@/engines/worldgen/core/presets');
  const { DEFAULT_PARAMS } = await import('@/engines/worldgen/core/types');
  const { freshWorldEdits } = await import('@/engines/worldgen/recipe');
  const presetId = optEnum(args, 'preset', WORLD_PRESETS.map(preset => preset.id) as [string, ...string[]]) ?? 'continents';
  if (args.preset !== undefined && presetId !== args.preset) throw new BridgeError('bad-args', `preset must be one of ${WORLD_PRESETS.map(preset => preset.id).join(', ')}.`);
  const preset = WORLD_PRESETS.find(candidate => candidate.id === presetId)!;
  if (args.landmassKm !== undefined) {
    if (preset.overrides.starter !== 'landmass') throw new BridgeError('bad-args', 'landmassKm goes with the island, country or continent preset.');
    if (typeof args.landmassKm !== 'number' || !Number.isFinite(args.landmassKm) || args.landmassKm < 300 || args.landmassKm > 9000) throw new BridgeError('bad-args', 'landmassKm must be a number of km between 300 and 9000.');
  }
  // How big the map is. A single landmass is laid on a sheet its own size
  // (about 3.2 times the land, so the sea goes round it) unless sheet:false asks
  // for the whole planet; worldKm sets a sheet of any width for any preset.
  const { sheetKmForLandmass, WORLD_KM } = await import('@/engines/worldgen/core/geoScale');
  if (args.sheet !== undefined && typeof args.sheet !== 'boolean') throw new BridgeError('bad-args', 'sheet must be true or false.');
  if (args.worldKm !== undefined) {
    if (typeof args.worldKm !== 'number' || !Number.isFinite(args.worldKm) || args.worldKm < WORLD_KM.min || args.worldKm >= WORLD_KM.max) throw new BridgeError('bad-args', `worldKm must be a sheet width in km from ${WORLD_KM.min} to ${WORLD_KM.max - 1}; leave it out for the whole planet.`);
    if (args.sheet === false) throw new BridgeError('bad-args', 'worldKm makes a sheet; it cannot go with sheet:false.');
  }
  const landKm = typeof args.landmassKm === 'number' ? Math.round(args.landmassKm) : preset.overrides.landmassKm;
  const worldKm = typeof args.worldKm === 'number' ? Math.round(args.worldKm)
    : preset.overrides.starter === 'landmass' && args.sheet !== false && typeof landKm === 'number' ? sheetKmForLandmass(landKm)
      : args.sheet === true ? (() => { throw new BridgeError('bad-args', 'sheet:true needs a landmass preset (island, country, continent) or a worldKm.'); })()
        : undefined;
  const width = optNumber(args, 'width') ?? DEFAULT_PARAMS.width;
  if (![1024, 2048, 3072].includes(width)) throw new BridgeError('bad-args', 'width must be 1024 (fast), 2048 (standard) or 3072 (high).');
  const title = optString(args, 'title')?.trim() || 'World';
  const seed = optString(args, 'seed')?.trim() || generateId('seed').slice(-8);
  const now = Date.now();
  const world: GeneratedWorld = { id: generateId('world'), projectId, title, params: { ...applyWorldPreset({ ...DEFAULT_PARAMS, seed, width }, preset), ...(typeof args.landmassKm === 'number' ? { landmassKm: Math.round(args.landmassKm) } : {}), ...(worldKm !== undefined ? { worldKm } : {}) }, edits: freshWorldEdits(), createdAt: now, updatedAt: now };
  await worldgenScopeOperations(worldEraToolScope(args)).worlds.create(world);
  return withAudit(
    { id: world.id, worldId: world.id, title, preset: presetId, seed, width, starter: world.params.starter ?? null, worldKm: worldKm ?? 40075, cellKm: Math.round(((worldKm ?? 40075) / width) * 1000) / 1000, sheet: worldKm !== undefined, created: true },
    { projectId, entityId: world.id, summary: `created world "${title}" (${presetId})` },
  );
}

/** Distance along clicked points and, for three or more, the enclosed area — the map's own ruler. */
export async function whMeasureWorld(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const { measurePolyline, polygonAreaKm2, closedPerimeterKm } = await import('@/engines/worldgen/core/measure');
  const { normalizeParams } = await import('@/engines/worldgen/core/types');
  const width = normalizeParams(world.params).width, height = width >> 1;
  const raw = args.points;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 500) throw new BridgeError('bad-args', 'points must be an array of 2 to 500 {x,y} world cells.');
  const points = raw.map((point, index) => {
    const p = point as Record<string, unknown>;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new BridgeError('bad-args', `points[${index}] must be {x,y} numbers.`);
    if (p.y < 0 || p.y > height) throw new BridgeError('bad-args', `points[${index}].y must be within 0..${height}.`);
    return { x: ((p.x % width) + width) % width, y: p.y };
  });
  const sheet = normalizeParams(world.params);
  const reading = measurePolyline(points, width, height, sheet);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    worldId: world.id,
    totalKm: round(reading.totalKm),
    legs: reading.legs.map(leg => ({ km: round(leg.km), bearing: Math.round(leg.bearing) })),
    ...(points.length >= 3 ? { areaKm2: Math.round(polygonAreaKm2(points, width, height, undefined, sheet)), closedPerimeterKm: round(closedPerimeterKm(points, width, height, sheet)) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Travel: the world's physics and the planner
// ---------------------------------------------------------------------------

/** The world's travel physics and usual pace. */
export async function whGetWorldTravelSettings(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  return { worldId: world.id, revision: world.travelRevision ?? 0, profile: world.travelProfile ?? {}, pace: world.travelPace ?? 'steady' };
}

/** Change the world's travel physics or usual pace, with optional compare-and-swap. */
export async function whSetWorldTravelSettings(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const change: { profile?: unknown; pace?: unknown } = {};
  if (args.profile !== undefined) change.profile = args.profile;
  if (args.pace !== undefined) change.pace = args.pace === 'steady' ? undefined : args.pace;
  if (!('profile' in change) && !('pace' in change)) throw new BridgeError('bad-args', 'Nothing to change: pass profile or pace.');
  const { saveWorldTravelSettings } = await import('@/engines/worldgen/journeyOperations');
  try {
    const receipt = await saveWorldTravelSettings({ projectId: world.projectId, eraId: worldEraToolScope(args)?.eraId }, world.id, change, optNumber(args, 'expectedRevision'));
    return withAudit(
      { worldId: world.id, revision: receipt.revision, profile: receipt.to.profile ?? {}, pace: receipt.to.pace ?? 'steady' },
      { projectId: world.projectId, entityId: world.id, summary: `changed travel settings of world "${world.title}"`, before: { __worldTravelSettings: receipt } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BridgeError(/changed \(revision/.test(message) ? 'conflict' : /no longer belongs/.test(message) ? 'not-found' : 'bad-args', message);
  }
}

/**
 * Plan a journey with the same least-time model as the Travel panel: modes,
 * seasons, pace, per-leg modes and the world's own travel physics.
 */
export async function whPlanJourney(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const { planRoute, normalizeTravelProfile, TRAVEL_PACES, effectiveHoursPerDay } = await import('@/engines/worldgen/core/travel');
  const modes = ['foot', 'horse', 'cart', 'boat', 'ship'] as const, seasons = ['spring', 'summer', 'autumn', 'winter'] as const;
  const mode = optEnum(args, 'mode', modes) ?? 'foot', season = optEnum(args, 'season', seasons) ?? 'summer';
  if (args.mode !== undefined && args.mode !== mode) throw new BridgeError('bad-args', `mode must be one of ${modes.join(', ')}.`);
  if (args.season !== undefined && args.season !== season) throw new BridgeError('bad-args', `season must be one of ${seasons.join(', ')}.`);
  const pace = args.pace === undefined ? world.travelPace : optEnum(args, 'pace', TRAVEL_PACES);
  if (args.pace !== undefined && args.pace !== pace) throw new BridgeError('bad-args', `pace must be one of ${TRAVEL_PACES.join(', ')}.`);
  let profile;
  try { profile = normalizeTravelProfile(args.profile !== undefined ? args.profile : world.travelProfile); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  const raw = args.stops;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12) throw new BridgeError('bad-args', 'stops must be 2 to 12 items: {place: key} or {x, y} world cells.');
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data, atlas, geo } = opened.world;
  const stops = raw.map((stop, index) => {
    const s = stop as Record<string, unknown>;
    if (typeof s?.place === 'string') {
      const place = atlas.byKey.get(s.place);
      if (!place) throw new BridgeError('not-found', `stops[${index}]: no place "${s.place}"; use wh_find_place for keys.`);
      return { x: place.x, y: place.y, name: place.name };
    }
    if (typeof s?.x === 'number' && typeof s?.y === 'number' && Number.isFinite(s.x) && Number.isFinite(s.y)) {
      if (Math.round(s.y) < 0 || Math.round(s.y) >= data.height) throw new BridgeError('bad-args', `stops[${index}].y must be within the world grid.`);
      return { x: ((Math.round(s.x) % data.width) + data.width) % data.width, y: Math.round(s.y), name: `${Math.round(s.x)},${Math.round(s.y)}` };
    }
    throw new BridgeError('bad-args', `stops[${index}] must be {place} or {x, y}.`);
  });
  let legModes: (typeof modes[number])[] | undefined;
  if (args.legModes !== undefined) {
    if (!Array.isArray(args.legModes) || args.legModes.length !== stops.length - 1 || !args.legModes.every(item => (modes as readonly unknown[]).includes(item))) throw new BridgeError('bad-args', `legModes must list ${stops.length - 1} modes, one per leg.`);
    legModes = args.legModes as (typeof modes[number])[];
  }
  const hoursPerDay = optNumber(args, 'hoursPerDay');
  if (hoursPerDay !== undefined && (hoursPerDay <= 0 || hoursPerDay > 24)) throw new BridgeError('bad-args', 'hoursPerDay must be more than 0 and at most 24.');
  // One of the world's own ways, instead of a mode.
  let way: import('@/engines/worldgen/core/travel').TravelWay | undefined;
  if (args.way !== undefined) {
    way = typeof args.way === 'string' ? profile.ways?.find(candidate => candidate.id === args.way) : undefined;
    if (!way) throw new BridgeError('bad-args', `way must be one of the world's own ways: ${(profile.ways ?? []).map(candidate => candidate.id).join(', ') || 'none yet (wh_set_world_travel_settings profile.ways)'}.`);
    if (args.mode !== undefined || args.legModes !== undefined) throw new BridgeError('bad-args', 'Give way or mode/legModes, not both.');
  }
  const options = { mode: way ? way.base : mode, season, ...(way ? { way: way.id } : {}), ...(pace && pace !== 'steady' ? { pace } : {}), ...(legModes && !way ? { legModes } : {}), ...(Object.keys(profile).length ? { profile } : {}), ...(hoursPerDay ? { hoursPerDay } : {}), via: stops.slice(1, -1).map(({ x, y }) => ({ x, y })) };
  // Where the party is on a given day, as the journey player shows it.
  const setOffArg = optNumber(args, 'setOffHour');
  if (setOffArg !== undefined && !(Number.isInteger(setOffArg) && setOffArg >= 0 && setOffArg <= 23)) throw new BridgeError('bad-args', 'setOffHour must be a whole hour from 0 to 23.');
  const atDay = optNumber(args, 'atDay');
  if (atDay !== undefined && (atDay < 0 || !Number.isFinite(atDay))) throw new BridgeError('bad-args', 'atDay must be 0 or more.');
  const locale = optEnum(args, 'locale', ['es', 'en'] as const) ?? 'en';
  const route = planRoute(data, geo, stops[0], stops[stops.length - 1], options, locale);
  if (route.impossible) return { worldId: world.id, impossible: route.impossible, stops: stops.map(stop => stop.name) };
  const r = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
  const { travellerAt } = await import('@/engines/worldgen/core/journeyPlayback');
  const at = atDay !== undefined ? travellerAt(route, data.width, atDay) : null;
  const words = await import('@/engines/worldgen/core/routeWords');
  const setOffHour = setOffArg ?? words.DEFAULT_SET_OFF_HOUR;
  const perDay = effectiveHoursPerDay(way?.night ? { ...options, hoursPerDay: 22 } : options);
  const { HARD_PACE_REST_EVERY } = await import('@/engines/worldgen/core/travel');
  const restEvery = options.pace === 'hard' ? HARD_PACE_REST_EVERY : 0;
  const clocks = words.legClocks(route, perDay, setOffHour, restEvery);
  const arrival = words.clockAt(route.hours, perDay, setOffHour, true, restEvery);
  return {
    worldId: world.id,
    stops: stops.map(stop => stop.name),
    mode: way ? way.base : mode, ...(way ? { way: { id: way.id, name: way.name, flies: !!way.flies, night: !!way.night } } : {}), season, pace: pace ?? 'steady', legModes: way ? null : legModes ?? null,
    hoursPerDay: r(perDay, 2),
    km: r(route.km), directKm: r(route.directKm), hours: r(route.hours), days: r(route.days, 2), restDays: route.restDays ?? 0,
    roadFraction: r(route.roadFraction, 2), ascentM: Math.round(route.ascentM), highestM: Math.round(route.highestM), lowestM: Math.round(route.lowestM),
    crossings: route.crossings.length, fords: route.crossings.filter(c => c.kind === 'river' && !c.bridge && !c.frozen).length, frozenRivers: route.crossings.filter(c => c.kind === 'river' && c.frozen).length, bridges: route.crossings.filter(c => c.kind === 'river' && c.bridge).length, realms: route.realms,
    ...(at ? { atDay: { day: r(at.day, 2), x: r(at.x), y: r(at.y), phase: at.phase, night: at.stage?.night ?? null, nearest: at.stage?.nearest?.name ?? null } } : {}),
    terrain: route.legs.slice(0, 8).map(leg => ({ terrain: leg.terrain, km: r(leg.km), onRoad: leg.onRoad })),
    // The same ground in travel order, each stretch with the day and hour it begins.
    stretches: words.routeStretches(route).slice(0, 30).map((leg, index) => ({ terrain: leg.terrain, km: r(leg.km), onRoad: leg.onRoad, day: clocks[index].day, partOfDay: clocks[index].part, startsAt: words.clockText(clocks[index].hour) })),
    passes: words.placesPassed(data, geo, route, { limit: 20, ends: [stops[0].name, stops[stops.length - 1].name] }).map(place => ({ name: place.name, rank: place.rank, atKm: r(place.atKm), offKm: r(place.offKm) })),
    roads: words.roadsTaken(data, geo, route).map(road => ({ from: road.from, to: road.to, km: r(road.km) })),
    grounds: words.groundsCrossed(route, 6),
    kmOnWater: r(words.kmOnWater(route)),
    clock: { setsOff: words.clockText(setOffHour), makesCamp: words.clockText(setOffHour + perDay), arrives: { day: arrival.day, at: words.clockText(arrival.hour), partOfDay: arrival.part } },
    nights: route.stages.slice(0, 60).map(stage => ({ night: stage.night, x: Math.round(stage.x), y: Math.round(stage.y), rough: stage.rough, terrain: stage.terrain, nearest: stage.nearest ? { name: stage.nearest.name, km: r(stage.nearest.km) } : null, ...(stage.shelter ? { shelter: { name: stage.shelter.name, kind: stage.shelter.kind === 'ruina' || stage.shelter.kind === 'ruin' ? 'ruin' : 'inn' } } : {}) })),
    // The route's cells, at most 400 of them evenly spaced (ends kept): ready to
    // pass as `points` to wh_paint_reader_fog to mark the way as seen.
    path: (() => {
      const step = Math.max(1, Math.ceil(route.cells.length / 400));
      const out = route.cells.filter((_, index) => index % step === 0 || index === route.cells.length - 1);
      return out.map(cell => ({ x: cell % data.width, y: Math.floor(cell / data.width) }));
    })(),
  };
}

// ---------------------------------------------------------------------------
// The reader's-eye map
// ---------------------------------------------------------------------------

/** Mark ground on the reader's-eye map as seen, heard of or hidden, optionally from a chapter on. */
export async function whPaintReaderFog(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const size = worldSize(world);
  const op = optEnum(args, 'op', ['seen', 'heard', 'hide'] as const);
  if (!op) throw new BridgeError('bad-args', 'op must be seen, heard or hide.');
  if (!Array.isArray(args.points) || !args.points.length || args.points.length > 500) throw new BridgeError('bad-args', 'points must be a list of 1 to 500 {x,y} world cells along the stroke.');
  const pts = (args.points as unknown[]).map((point, index) => {
    if (!point || typeof point !== 'object') throw new BridgeError('bad-args', `points[${index}] must be {x,y}.`);
    const { x, y } = cellCoords(point as ToolArgs, size);
    return { x: x + 0.5, y: y + 0.5 };
  });
  const radius = optNumber(args, 'radiusCells') ?? 6;
  if (!Number.isFinite(radius) || radius < 0.5 || radius > size.width / 2) throw new BridgeError('bad-args', `radiusCells must be from 0.5 to ${size.width / 2}.`);
  let chapter: number | undefined;
  if (args.chapter !== undefined && args.chapter !== null) {
    if (typeof args.chapter !== 'number' || !Number.isInteger(args.chapter) || args.chapter < 0) throw new BridgeError('bad-args', 'chapter must be a whole number from 0 up, or omitted for "from the start".');
    chapter = args.chapter;
  }
  // A line longer than a quarter of the world is stored as several strokes, or it would fold across the sheet.
  const { fogStrokeEdits } = await import('@/engines/worldgen/core/readerFog');
  const edits = fogStrokeEdits(pts, size.width, op, radius, chapter ?? null);
  return appendEdit(
    args, world,
    edits,
    { op, points: pts.length, strokes: edits.length, radiusCells: radius, chapter: chapter ?? null },
    `marked the reader's map ${op} in world "${world.title}"`,
  );
}

/** The land the 'land' start inks (the world opened for its ground), or nothing for the other starts. */
async function readerLand(args: ToolArgs, world: GeneratedWorld, start: string): Promise<{ elevation: Float32Array } | { pending: unknown } | null> {
  if (start !== 'land') return null;
  const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return { pending: pendingResult(world, opened) };
  return { elevation: opened.world.data.elevation };
}

/** What the reader knows of the map up to a chapter: shares, chapters and the state of given cells. */
export async function whReaderView(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const size = worldSize(world);
  const { fogMask, fogShares, fogChapters, FOG_SEEN, FOG_HEARD } = await import('@/engines/worldgen/core/readerFog');
  const { resolvePresentation } = await import('@/engines/worldgen/presentation');
  const start = resolvePresentation(world.presentation).readerStart;
  let chapter: number | null = null;
  if (args.chapter !== undefined && args.chapter !== null) {
    if (typeof args.chapter !== 'number' || !Number.isInteger(args.chapter) || args.chapter < 0) throw new BridgeError('bad-args', 'chapter must be a whole number from 0 up.');
    chapter = args.chapter;
  }
  const edits = deserializeEdits(world.edits ?? '[]').filter((edit) => edit.kind === 'fog');
  const land = await readerLand(args, world, start);
  if (land && 'pending' in land) return land.pending;
  const mask = fogMask(edits, size.width, size.height, start, chapter, land?.elevation);
  const shares = fogShares(mask);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  let cells: { x: number; y: number; state: 'seen' | 'heard' | 'hidden' }[] | undefined;
  if (args.cells !== undefined) {
    if (!Array.isArray(args.cells) || args.cells.length > 200) throw new BridgeError('bad-args', 'cells must be a list of up to 200 {x,y} world cells.');
    cells = (args.cells as unknown[]).map((cell, index) => {
      if (!cell || typeof cell !== 'object') throw new BridgeError('bad-args', `cells[${index}] must be {x,y}.`);
      const { x, y } = cellCoords(cell as ToolArgs, size);
      const v = mask[y * size.width + x];
      return { x, y, state: v === FOG_SEEN ? 'seen' : v === FOG_HEARD ? 'heard' : 'hidden' };
    });
  }
  return {
    worldId: world.id, readerStart: start, chapter, strokes: edits.length, chapters: fogChapters(edits),
    shares: { seen: round(shares.seen), heard: round(shares.heard), hidden: round(shares.hidden) },
    ...(cells ? { cells } : {}),
  };
}

// ---------------------------------------------------------------------------
// Story events on the map
// ---------------------------------------------------------------------------

/**
 * The story chapter by chapter, as the reader's-view playback steps through
 * it: what happens and what is planned in each chapter, and how much of the
 * map the reader has seen or heard of by its end.
 */
export async function whRollName(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const { ROLL_STYLES, rollLabelName, paintedNames } = await import('@/engines/worldgen/core/rollName');
  const style = optEnum(args, 'style', ROLL_STYLES);
  if (!style) throw new BridgeError('bad-args', `style must be one of ${ROLL_STYLES.join(', ')}.`);
  const count = Math.max(1, Math.min(10, Math.floor(optNumber(args, 'count') ?? 5)));
  const x = optNumber(args, 'x'), y = optNumber(args, 'y');
  if ((x === undefined) !== (y === undefined)) throw new BridgeError('bad-args', 'Give both x and y, or neither.');
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data, geo } = opened.world;
  const at = x === undefined || y === undefined ? undefined : { x, y };
  const seen = new Set<string>(), names: { text: string; language: string; etymology: string }[] = [];
  for (let roll = 0; names.length < count && roll < count * 4; roll++) {
    const rolled = rollLabelName(geo, String(data.params.seed), style, roll, at, { painted: paintedNames(data.painted), width: data.width });
    if (seen.has(rolled.text)) continue;
    seen.add(rolled.text);
    names.push({ text: rolled.text, language: rolled.language, etymology: rolled.etymology });
  }
  return { worldId: world.id, style, ...(at ? { at } : {}), names };
}

export async function whStoryChapters(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const size = worldSize(world);
  const { storyEventsFrom, storyChapterFrames } = await import('@/engines/worldgen/core/storyEvents');
  const { fogMask, fogShares, fogChapters } = await import('@/engines/worldgen/core/readerFog');
  const { resolvePresentation } = await import('@/engines/worldgen/presentation');
  const edits = deserializeEdits(world.edits ?? '[]');
  const fog = edits.filter((edit) => edit.kind === 'fog');
  const start = resolvePresentation(world.presentation).readerStart;
  const land = await readerLand(args, world, start);
  if (land && 'pending' in land) return land.pending;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const events = storyEventsFrom(edits);
  const names = await codexNames(args, world, events.flatMap((event) => event.who ?? []));
  const brief = (event: { id: string; type: string; title: string; x: number; y: number; who?: string[] }) => ({ id: event.id, type: event.type, title: event.title, x: Math.round(event.x * 10) / 10, y: Math.round(event.y * 10) / 10, ...(event.who?.length ? { who: event.who.map((id) => names.get(id) ?? id) } : {}) });
  const frames = storyChapterFrames(events, fogChapters(fog)).map((frame) => {
    const shares = fogShares(fogMask(fog, size.width, size.height, start, frame.chapter, land?.elevation));
    return { chapter: frame.chapter, happened: frame.happened.map(brief), planned: frame.planned.map(brief), map: { seen: round(shares.seen), heard: round(shares.heard), hidden: round(shares.hidden) } };
  });
  return { worldId: world.id, readerStart: start, chapters: frames };
}

async function storyModule() { return import('@/engines/worldgen/core/storyEvents'); }

/** Where an event goes: a place key or world cells (cell centre). */
async function storyPosition(args: ToolArgs, world: GeneratedWorld): Promise<{ x: number; y: number } | null> {
  if (typeof args.place === 'string') {
    const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
    if (!opened.ok) throw new BridgeError('generating', 'The world is still being generated; wait about 30 seconds and call again.');
    const place = opened.world.atlas.byKey.get(args.place);
    if (!place) throw new BridgeError('not-found', `No place "${args.place}"; use wh_find_place for keys.`);
    return { x: place.x + 0.5, y: place.y + 0.5 };
  }
  if (args.x === undefined && args.y === undefined) return null;
  const { x, y } = cellCoords(args, worldSize(world));
  return { x: x + 0.5, y: y + 0.5 };
}

/**
 * A river from a spring: from the given spot the water steps downhill until the
 * sea, another river or a hollow, and the path is drawn as an ordinary river.
 */
export async function whAddSpringRiver(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const at = await storyPosition(args, world);
  if (!at) throw new BridgeError('bad-args', 'Give place (a key from wh_find_place) or x and y world cells for the spring.');
  const width = optNumber(args, 'width') ?? 2;
  if (!(width >= 0.5 && width <= 12)) throw new BridgeError('bad-args', 'width must be between 0.5 and 12 cells.');
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { traceSpring } = await import('@/engines/worldgen/core/spring');
  const { riverCellsAfterEdits } = await import('@/engines/worldgen/core/edits');
  const run = traceSpring(opened.world.data, at.x, at.y, { riverCells: riverCellsAfterEdits(opened.world.data, deserializeEdits(world.edits ?? '[]')) });
  if (run.end === 'nowhere') throw new BridgeError('bad-args', 'From there the water has nowhere to run (it is sea, a lake, or a hollow already); pick higher ground.');
  const summary = { end: run.end, cells: run.cells, from: { x: Math.floor(at.x), y: Math.floor(at.y) }, to: { x: ((Math.floor(run.pts[run.pts.length - 1].x) % opened.world.data.width) + opened.world.data.width) % opened.world.data.width, y: Math.floor(run.pts[run.pts.length - 1].y) } };
  if (args.dryRun === true) return { worldId: world.id, dryRun: true, ...summary, points: run.pts };
  return appendEdit(args, world, { kind: 'river', pts: run.pts, width }, summary, `added a river from a spring (${run.cells} cells to the ${run.end}) to world "${world.title}"`);
}

/** Cells given by an agent, as the points of a stroke or a line: inside the grid, round the seam, at cell centres. */
/**
 * Points of a stroke in world cells. `snap`: 'cell' takes each point at the
 * centre of its cell (brush strokes), 'whole' at the nearest whole cell (a
 * drawn river's points), 'exact' keeps the fractions (a zone's corners).
 */
function strokeCells(args: ToolArgs, size: { width: number; height: number }, min: number, snap: 'cell' | 'whole' | 'exact' = 'cell'): { x: number; y: number }[] {
  const raw = args.points;
  if (!Array.isArray(raw) || raw.length < min || raw.length > 400) throw new BridgeError('bad-args', `points must be ${min} to 400 {x, y} world cells.`);
  return raw.map((point, index) => {
    const p = point as Record<string, unknown>;
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new BridgeError('bad-args', `points[${index}] must be {x, y} inside the world grid.`);
    if (p.y < 0 || p.y >= size.height) throw new BridgeError('bad-args', `points[${index}] must be {x, y} inside the world grid.`);
    const wrap = (x: number) => ((x % size.width) + size.width) % size.width;
    if (snap === 'exact') return { x: wrap(p.x), y: p.y };
    if (snap === 'whole') return { x: wrap(Math.round(p.x)), y: Math.min(size.height - 1, Math.round(p.y)) };
    return { x: wrap(Math.floor(p.x)) + 0.5, y: Math.floor(p.y) + 0.5 };
  });
}

/**
 * Shape the ground with the Brush's terrain operations: raise, lower, smooth,
 * sharpen, flatten, terrace, roughen, gully, a volcano where the stroke starts,
 * or the ground set to a height in metres. One undoable edit.
 */
export async function whShapeTerrain(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const OPS = ['raise', 'lower', 'smooth', 'sharpen', 'flatten', 'terrace', 'roughen', 'gully', 'volcano', 'height'] as const;
  const op = args.op as (typeof OPS)[number];
  if (!OPS.includes(op)) throw new BridgeError('bad-args', `op must be one of ${OPS.join(', ')}.`);
  const size = worldSize(world);
  const pts = strokeCells(args, size, 1);
  const radius = optNumber(args, 'radius') ?? 4;
  if (!(radius >= 0.5 && radius <= 60)) throw new BridgeError('bad-args', 'radius must be between 0.5 and 60 cells.');
  const strength = optNumber(args, 'strength') ?? 0.75;
  if (!(strength >= 0.05 && strength <= 1)) throw new BridgeError('bad-args', 'strength must be between 0.05 and 1.');
  const { TERRAIN_HEIGHT_M } = await import('@/engines/worldgen/core/edits');
  let heightM: number | undefined;
  if (op === 'height') {
    heightM = optNumber(args, 'heightM');
    if (heightM === undefined || !(heightM >= TERRAIN_HEIGHT_M.min && heightM <= TERRAIN_HEIGHT_M.max)) throw new BridgeError('bad-args', `op "height" needs heightM, metres from ${TERRAIN_HEIGHT_M.min} to ${TERRAIN_HEIGHT_M.max}.`);
    heightM = Math.round(heightM);
  } else if (args.heightM !== undefined) throw new BridgeError('bad-args', 'heightM is only for op "height".');
  const stroke = { pts, radius, strength, softness: 0.5, ...(heightM !== undefined ? { heightM } : {}) };
  const summary = { op, points: pts.length, radius, strength, ...(heightM !== undefined ? { heightM } : {}) };
  return appendEdit(args, world, { kind: 'terrain', op, stroke }, summary, `shaped the ground (${op}) on world "${world.title}"`);
}

/** Draw a river through world cells, from its spring (the first point) to its mouth (the last), like the River tool. */
export async function whDrawRiver(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const size = worldSize(world);
  // A river's line runs through whole cells (its points are rounded to cells as it is drawn).
  const pts = strokeCells(args, size, 2, 'whole');
  const width = optNumber(args, 'width') ?? 2;
  if (!(width >= 0.5 && width <= 12)) throw new BridgeError('bad-args', 'width must be between 0.5 and 12 cells.');
  const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data } = opened.world;
  const spring = Math.floor(pts[0].y) * data.width + Math.floor(pts[0].x) % data.width;
  if (!(data.elevation[spring] > 0)) throw new BridgeError('bad-args', 'The first point is the spring and must be on land.');
  return appendEdit(args, world, { kind: 'river', pts, width }, { points: pts.length, width, spring: { x: Math.floor(pts[0].x), y: Math.floor(pts[0].y) } }, `drew a river on world "${world.title}"`);
}

/** Turn round a river drawn by hand (its spring becomes its mouth). Generated rivers run downhill and are refused. */
export async function whReverseRiver(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { x, y } = cellCoords(args, worldSize(world));
  const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data } = opened.world;
  const { drawnRiverNear } = await import('@/engines/worldgen/core/edits');
  const rivers = (data.painted?.rivers ?? []).map((r) => r.cells);
  const k = drawnRiverNear(rivers, data.width, x, y);
  if (k < 0) throw new BridgeError('bad-args', `No river drawn by hand within two cells of ${x},${y}. Only drawn rivers (wh_draw_river, wh_add_spring_river, the River tool) can be turned round; generated rivers run downhill.`);
  const cells = rivers[k];
  const end = (c: number) => ({ x: c % data.width, y: Math.floor(c / data.width) });
  return appendEdit(args, world, { kind: 'reverseRiver', x: Math.floor(x), y: Math.floor(y) }, { springNow: end(cells[cells.length - 1]), mouthNow: end(cells[0]), cells: cells.length }, `turned a river round on world "${world.title}"`);
}

/**
 * Move the whole world's sea level and/or snowline, in metres against the
 * generated ones (absolute: 0 puts it back). One undoable edit each.
 */
export async function whSetWorldLevels(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { SEA_LEVEL_MAX_M, SNOWLINE_MAX_M, worldLevels } = await import('@/engines/worldgen/core/edits');
  for (const key of ['seaLevelM', 'snowlineM'] as const) if (args[key] !== undefined && (typeof args[key] !== 'number' || !Number.isFinite(args[key]))) throw new BridgeError('bad-args', `${key} must be a number of metres.`);
  const sea = optNumber(args, 'seaLevelM'), snow = optNumber(args, 'snowlineM');
  if (sea === undefined && snow === undefined) throw new BridgeError('bad-args', 'Give seaLevelM and/or snowlineM.');
  if (sea !== undefined && !(Math.abs(sea) <= SEA_LEVEL_MAX_M)) throw new BridgeError('bad-args', `seaLevelM must be between -${SEA_LEVEL_MAX_M} and ${SEA_LEVEL_MAX_M}.`);
  if (snow !== undefined && !(Math.abs(snow) <= SNOWLINE_MAX_M)) throw new BridgeError('bad-args', `snowlineM must be between -${SNOWLINE_MAX_M} and ${SNOWLINE_MAX_M}.`);
  const before = worldLevels(currentEdits(world, args));
  const edits: WorldEdit[] = [];
  if (sea !== undefined && Math.round(sea) !== before.seaLevelM) edits.push({ kind: 'seaLevel', m: Math.round(sea) });
  if (snow !== undefined && Math.round(snow) !== before.snowlineM) edits.push({ kind: 'snowline', m: Math.round(snow) });
  const after = { seaLevelM: sea !== undefined ? Math.round(sea) : before.seaLevelM, snowlineM: snow !== undefined ? Math.round(snow) : before.snowlineM };
  if (!edits.length) return { worldId: world.id, ...after, unchanged: true };
  return appendEdit(args, world, edits, { ...after, before }, `set sea level ${after.seaLevelM} m and snowline ${after.snowlineM} m in world "${world.title}"`);
}

/**
 * A lake that fills its hollow from a place or cell, like the River tool's Lake
 * mode; `dryRun` only says how big it would be. Re-derived from the ground on
 * every replay, so it follows later terrain edits.
 */
export async function whAddLake(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const at = await storyPosition(args, world);
  if (!at) throw new BridgeError('bad-args', 'Give place (a key from wh_find_place) or x and y world cells for the lake.');
  const maxCells = optNumber(args, 'maxCells');
  if (maxCells !== undefined && !(Number.isInteger(maxCells) && maxCells >= 1 && maxCells <= 20000)) throw new BridgeError('bad-args', 'maxCells must be a whole number from 1 to 20000.');
  const minCells = optNumber(args, 'size');
  if (minCells !== undefined && !(Number.isInteger(minCells) && minCells >= 1 && minCells <= 20000)) throw new BridgeError('bad-args', 'size must be a whole number of cells from 1 to 20000.');
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') throw new BridgeError('bad-args', 'dryRun must be true or false.');
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { fillLake } = await import('@/engines/worldgen/core/lake');
  // The cap is never below the size asked for.
  const run = fillLake(opened.world.data, at.x, at.y, { ...(maxCells ? { maxCells } : {}), ...(minCells ? { minCells } : {}) });
  if (!run.cells.length) throw new BridgeError('bad-args', run.end === 'nowhere' ? 'That spot is sea or already a lake.' : 'That lake would touch another one; pick a spot away from it.');
  const x = Math.floor(at.x), y = Math.floor(at.y);
  const summary = { x, y, cells: run.cells.length, end: run.end, dammed: run.dammed };
  if (args.dryRun === true) return { worldId: world.id, dryRun: true, ...summary };
  return appendEdit(args, world, { kind: 'lake', op: 'fill', x: x + 0.5, y: y + 0.5, ...(maxCells ? { maxCells } : {}), ...(minCells ? { minCells } : {}) }, summary, `filled a lake of ${run.cells.length} cells at ${x},${y} in world "${world.title}"`);
}

/** Drain the lake under a place or cell (a painted one or the world's own). */
export async function whDrainLake(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const at = await storyPosition(args, world);
  if (!at) throw new BridgeError('bad-args', 'Give place or x and y world cells on the lake.');
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { lakeAt } = await import('@/engines/worldgen/core/lake');
  const cells = lakeAt(opened.world.data, at.x, at.y);
  if (!cells.length) throw new BridgeError('bad-args', 'There is no lake at that spot.');
  const x = Math.floor(at.x), y = Math.floor(at.y);
  return appendEdit(args, world, { kind: 'lake', op: 'drain', x: x + 0.5, y: y + 0.5 }, { x, y, cells: cells.length, drained: true }, `drained a lake of ${cells.length} cells at ${x},${y} in world "${world.title}"`);
}

/**
 * Lay a road by hand between two places (or cells), routed like the Road tool:
 * the cart route over the real ground, through passes and around marshes. Its
 * line may be thicker or thinner than its class's and solid, dashed or dotted.
 */
export async function whPaintBiome(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { BIOME_KEY } = await import('@/engines/worldgen/core/biomeKeys');
  const erase = args.erase === undefined ? false : args.erase;
  if (typeof erase !== 'boolean') throw new BridgeError('bad-args', 'erase must be true or false.');
  let biome = -1;
  if (!erase) {
    biome = typeof args.biome === 'string' ? BIOME_KEY.indexOf(args.biome) : -1;
    // Sea and lake are not painted: the coast and lake tools make water.
    if (biome < 2) throw new BridgeError('bad-args', `biome must be one of ${BIOME_KEY.slice(2).join(', ')} (or erase: true).`);
  }
  const raw = args.points;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 400) throw new BridgeError('bad-args', 'points must be 1 to 400 {x, y} world cells.');
  const size = worldSize(world);
  const pts = raw.map((point, index) => {
    const p = point as Record<string, unknown>;
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y < 0 || p.y >= size.height) throw new BridgeError('bad-args', `points[${index}] must be {x, y} inside the world grid.`);
    return { x: ((p.x % size.width) + size.width) % size.width, y: p.y };
  });
  const radius = optNumber(args, 'radius') ?? 3;
  if (!(radius >= 0.5 && radius <= 60)) throw new BridgeError('bad-args', 'radius must be between 0.5 and 60 cells.');
  const stroke = { pts, radius, strength: 1, softness: 0.4 };
  // How much land the stroke really takes: the brush leaves the sea alone and a thin stroke's edge is dithered away.
  const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { strokeMask } = await import('@/engines/worldgen/sculpt/ops');
  const mask = strokeMask(stroke, size.width, size.height);
  let cells = 0;
  // The same rule the replay uses: coverage against a threshold dithered by cell, so the count is the cells painted.
  mask?.each((i, cover) => {
    const hsh = Math.sin(i * 45.164 + 11.71) * 27183.13;
    const jitter = (hsh - Math.floor(hsh)) * 0.45;
    // Painting keeps to land; erasing clears whatever it covers, as the replay does.
    if (cover * stroke.strength > 0.35 + jitter * 0.4 && (erase || opened.world.data.elevation[i] > 0)) cells++;
  });
  if (!cells) throw new BridgeError('bad-args', erase ? 'The stroke covers no cell (too thin): use a larger radius.' : 'The stroke covers no land cell (it is over the sea, or too thin): use a larger radius or another place.');
  const edit = erase ? { kind: 'eraseBiome' as const, stroke } : { kind: 'biome' as const, biome: biome as import('@/engines/worldgen/core/types').BiomeId, stroke };
  const summary = { erase, ...(erase ? {} : { biome: BIOME_KEY[biome] }), points: pts.length, radius, cells };
  return appendEdit(args, world, edit, summary, erase ? `rubbed out painted ground on world "${world.title}"` : `painted ${BIOME_KEY[biome]} ground on world "${world.title}"`);
}

export async function whSetRiverCrossing(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { x, y } = cellCoords(args, worldSize(world));
  if (typeof args.blocked !== 'boolean') throw new BridgeError('bad-args', 'blocked must be true (no way across here) or false (open again).');
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data } = opened.world;
  const { riverCellNear } = await import('@/engines/worldgen/core/travel');
  const cell = riverCellNear(data, x + 0.5, y + 0.5);
  if (cell < 0) throw new BridgeError('bad-args', `No river within a cell of ${x},${y}; wh_place_at and the map show where rivers run.`);
  const at = { x: cell % data.width, y: Math.floor(cell / data.width) };
  if (!args.blocked) {
    // Opening clears the closed spots within a cell; with none there, nothing to record.
    const near = (data.painted?.blockedCrossingMarks ?? []).filter((m) => {
      const dx = Math.abs(m.x - at.x);
      return Math.min(dx, data.width - dx) <= 1 && Math.abs(m.y - at.y) <= 1;
    });
    if (!near.length) return { unchanged: true, x: at.x, y: at.y, blocked: false, note: 'No closed crossing within a cell of here.' };
  }
  return appendEdit(args, world, { kind: 'crossing', x: at.x, y: at.y, blocked: args.blocked }, { ...at, blocked: args.blocked }, `${args.blocked ? 'closed' : 'opened'} the river crossing at ${at.x},${at.y} on world "${world.title}"`);
}

export async function whAddWorldRoad(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { ROAD_PATTERNS, ROAD_WIDTH, roadLook } = await import('@/engines/worldgen/core/edits');
  const major = args.major === undefined ? false : args.major;
  if (typeof major !== 'boolean') throw new BridgeError('bad-args', 'major must be true (a royal road) or false (a track).');
  const width = optNumber(args, 'width');
  if (width !== undefined && !(width >= ROAD_WIDTH.min && width <= ROAD_WIDTH.max)) throw new BridgeError('bad-args', `width must be between ${ROAD_WIDTH.min} and ${ROAD_WIDTH.max} (a multiple of the class's line).`);
  const pattern = optEnum(args, 'pattern', ROAD_PATTERNS);
  if (args.pattern !== undefined && !pattern) throw new BridgeError('bad-args', 'pattern must be solid, dashed or dotted.');
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') throw new BridgeError('bad-args', 'dryRun must be true or false.');
  const opened = await openWorldForReading(world, 'full', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return pendingResult(world, opened);
  const { data, atlas, geo } = opened.world;
  const end = (value: unknown, label: 'from' | 'to') => {
    const s = value as Record<string, unknown> | undefined;
    if (typeof s?.place === 'string') {
      const place = atlas.byKey.get(s.place);
      if (!place) throw new BridgeError('not-found', `${label}: no place "${s.place}"; use wh_find_place for keys.`);
      return { x: place.x, y: place.y, name: place.name };
    }
    if (typeof s?.x === 'number' && typeof s?.y === 'number' && Number.isFinite(s.x) && Number.isFinite(s.y)) {
      if (Math.round(s.y) < 0 || Math.round(s.y) >= data.height) throw new BridgeError('bad-args', `${label}.y must be within the world grid.`);
      return { x: ((Math.round(s.x) % data.width) + data.width) % data.width, y: Math.round(s.y), name: `${Math.round(s.x)},${Math.round(s.y)}` };
    }
    throw new BridgeError('bad-args', `${label} must be {place} or {x, y}.`);
  };
  const from = end(args.from, 'from'), to = end(args.to, 'to');
  const { planRoute } = await import('@/engines/worldgen/core/travel');
  const route = planRoute(data, geo, from, to, { mode: 'cart', season: 'summer', building: true }, 'en');
  if (route.impossible || route.cells.length < 2) throw new BridgeError('bad-args', `No land route between ${from.name} and ${to.name} for a road${route.impossible ? ` (${route.impossible})` : ''}.`);
  const W = data.width;
  const look = roadLook({ roadWidth: width, roadPattern: pattern });
  const summary = { from: from.name, to: to.name, cells: route.cells.length, km: Math.round(route.km), major, ...look };
  if (args.dryRun === true) return { worldId: world.id, dryRun: true, ...summary };
  return appendEdit(args, world, { kind: 'road', pts: route.cells.map((c) => ({ x: c % W, y: Math.floor(c / W) })), major, ...look }, summary, `laid a ${major ? 'royal road' : 'track'} from ${from.name} to ${to.name} on world "${world.title}"`);
}

function storyFields(args: ToolArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['type', 'title', 'note', 'chapter', 'status', 'order', 'who', 'writingId'] as const) if (args[key] !== undefined) out[key] = args[key];
  if (args.chapter === null) out.chapter = undefined;
  if (args.writingId === null) out.writingId = undefined;
  if (args.order === null) out.order = undefined;
  return out;
}

/** Names of the Codex entries marked as there, by id (deleted ones are left out). */
async function codexNames(args: ToolArgs, world: GeneratedWorld, ids: Iterable<string>): Promise<Map<string, string>> {
  const eraId = worldEraToolScope(args)?.eraId, names = new Map<string, string>();
  for (const id of new Set(ids)) {
    const entry = eraId ? await readEraRow<{ projectId: string; title: string }>({ projectId: world.projectId, eraId }, 'codexEntries', id).catch(() => undefined) : await db.codexEntries.get(id);
    if (entry && entry.projectId === world.projectId) names.set(id, entry.title);
  }
  return names;
}

/**
 * Who was there must name real characters or factions of this project (and
 * era), as the editor offers them. The ids are tidied (trimmed, once each) and
 * the list capped before any is looked up.
 */
async function checkStoryWho(args: ToolArgs, world: GeneratedWorld): Promise<void> {
  if (args.who === undefined) return;
  const { STORY_WHO_MAX } = await storyModule();
  if (!Array.isArray(args.who) || !args.who.every((id) => typeof id === 'string')) throw new BridgeError('bad-args', 'who must be a list of Codex entry ids.');
  const ids = [...new Set((args.who as string[]).map((id) => id.trim()))];
  if (ids.length > STORY_WHO_MAX) throw new BridgeError('bad-args', `who takes up to ${STORY_WHO_MAX} Codex entries.`);
  const eraId = worldEraToolScope(args)?.eraId;
  for (const id of ids) {
    if (!id) throw new BridgeError('bad-args', 'who must not hold empty ids.');
    const entry = eraId ? await readEraRow<{ projectId: string; type: string }>({ projectId: world.projectId, eraId }, 'codexEntries', id).catch(() => undefined) : await db.codexEntries.get(id);
    if (!entry || entry.projectId !== world.projectId) throw new BridgeError('not-found', `No Codex entry "${id}" in this project; use wh_list_codex.`);
    if (entry.type !== 'character' && entry.type !== 'faction') throw new BridgeError('bad-args', `"${id}" is a ${entry.type}; who was there takes characters and factions.`);
  }
  args.who = ids;
}

/**
 * Where it is told must be a chapter or scene of this project's manuscript (and
 * era). Returns the writing's chapter number, so an event with no chapter can
 * take it, as the editor does.
 */
async function checkStoryWriting(args: ToolArgs, world: GeneratedWorld): Promise<number | undefined> {
  if (args.writingId === undefined || args.writingId === null) return undefined;
  if (typeof args.writingId !== 'string' || !args.writingId.trim()) throw new BridgeError('bad-args', 'writingId must be the id of a manuscript chapter or scene (wh_list_writings / the Writings list).');
  const id = args.writingId.trim();
  const eraId = worldEraToolScope(args)?.eraId;
  const writing = eraId ? await readEraRow<{ projectId: string; chapter?: number }>({ projectId: world.projectId, eraId }, 'writings', id).catch(() => undefined) : await db.writings.get(id);
  if (!writing || writing.projectId !== world.projectId) throw new BridgeError('not-found', `No manuscript chapter or scene "${id}" in this project.`);
  args.writingId = id;
  return typeof writing.chapter === 'number' ? writing.chapter : undefined;
}

/** Titles of the linked chapters and scenes, by id (deleted ones are left out). */
async function writingTitles(args: ToolArgs, world: GeneratedWorld, ids: Iterable<string>): Promise<Map<string, string>> {
  const eraId = worldEraToolScope(args)?.eraId, titles = new Map<string, string>();
  for (const id of new Set(ids)) {
    const writing = eraId ? await readEraRow<{ projectId: string; title: string }>({ projectId: world.projectId, eraId }, 'writings', id).catch(() => undefined) : await db.writings.get(id);
    if (writing && writing.projectId === world.projectId) titles.set(id, writing.title);
  }
  return titles;
}

/** An event with an `order` takes that place in its chapter and the others move along: every changed record. */
async function placedStory(world: GeneratedWorld, event: import('@/engines/worldgen/core/storyEvents').StoryEvent): Promise<WorldEdit[]> {
  const { storyEventsFrom, placeInChapter } = await storyModule();
  if (event.order === undefined) return [{ kind: 'story', ...event }];
  const events = storyEventsFrom([...deserializeEdits(world.edits ?? '[]'), { kind: 'story', ...event }]);
  return placeInChapter(events, event.id, event.order).map((record) => ({ kind: 'story' as const, ...record }));
}

/** Put a story event on the map: what happens, where, in which chapter, planned or happened. */
export async function whAddStoryEvent(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { normalizeStoryEvent, newStoryId } = await storyModule();
  const at = await storyPosition(args, world);
  if (!at) throw new BridgeError('bad-args', 'Give place (a key from wh_find_place) or x and y world cells.');
  await checkStoryWho(args, world);
  const toldIn = await checkStoryWriting(args, world);
  let event: import('@/engines/worldgen/core/storyEvents').StoryEvent;
  try { event = normalizeStoryEvent({ id: newStoryId(), ...at, type: 'custom', ...(args.chapter === undefined && toldIn !== undefined ? { chapter: toldIn } : {}), ...storyFields(args) }); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  const written = await placedStory(world, event);
  event = (written.find((edit) => edit.kind === 'story' && edit.id === event.id) as typeof event | undefined) ?? event;
  return appendEdit(args, world, written, { event }, `added story event "${event.title}" to world "${world.title}"`);
}

/** Change a story event: only the fields given, position included. */
export async function whUpdateStoryEvent(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { normalizeStoryEvent, storyEventsFrom } = await storyModule();
  const id = requireString(args, 'id');
  const current = storyEventsFrom(deserializeEdits(world.edits ?? '[]')).find((event) => event.id === id);
  if (!current) throw new BridgeError('not-found', `No story event "${id}" on this world; use wh_list_story_events.`);
  const at = await storyPosition(args, world);
  await checkStoryWho(args, world);
  const toldIn = await checkStoryWriting(args, world);
  const merged: Record<string, unknown> = { ...current, ...(at ?? {}), ...(args.chapter === undefined && current.chapter === undefined && toldIn !== undefined ? { chapter: toldIn } : {}), ...storyFields(args) };
  if (args.chapter === null) delete merged.chapter;
  if (args.writingId === null) delete merged.writingId;
  if (args.order === null) delete merged.order;
  // Moved to another chapter without a place in it: it goes to the end there, not to its old place number.
  if (args.chapter !== undefined && (merged.chapter ?? null) !== (current.chapter ?? null) && args.order === undefined) delete merged.order;
  if (Array.isArray(args.who) && !args.who.length) delete merged.who;
  let event: import('@/engines/worldgen/core/storyEvents').StoryEvent;
  try { event = normalizeStoryEvent(merged); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  const written = typeof args.order === 'number' ? await placedStory(world, event) : [{ kind: 'story' as const, ...event }];
  event = (written.find((edit) => edit.kind === 'story' && edit.id === event.id) as typeof event | undefined) ?? event;
  return appendEdit(args, world, written, { event }, `changed story event "${event.title}" in world "${world.title}"`);
}

/** Take a story event off the map. */
export async function whRemoveStoryEvent(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { storyEventsFrom } = await storyModule();
  const id = requireString(args, 'id');
  const current = storyEventsFrom(deserializeEdits(world.edits ?? '[]')).find((event) => event.id === id);
  if (!current) throw new BridgeError('not-found', `No story event "${id}" on this world; use wh_list_story_events.`);
  return appendEdit(args, world, { kind: 'storyRemove', id }, { id, removed: true }, `removed story event "${current.title}" from world "${world.title}"`);
}

/** The story events on a world, by chapter; optionally only what the reader knows by a chapter. */
export async function whListStoryEvents(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const { storyEventsFrom, storyKnownBy, STORY_STATUSES } = await storyModule();
  let events = storyEventsFrom(deserializeEdits(world.edits ?? '[]'));
  const status = optEnum(args, 'status', STORY_STATUSES);
  if (args.status !== undefined && !status) throw new BridgeError('bad-args', 'status must be planned or happened.');
  if (args.knownByChapter !== undefined) {
    if (typeof args.knownByChapter !== 'number' || !Number.isInteger(args.knownByChapter) || args.knownByChapter < 0) throw new BridgeError('bad-args', 'knownByChapter must be a whole number from 0 up.');
    events = storyKnownBy(events, args.knownByChapter);
  }
  if (status) events = events.filter((event) => event.status === status);
  const names = await codexNames(args, world, events.flatMap((event) => event.who ?? []));
  const told = await writingTitles(args, world, events.flatMap((event) => event.writingId ? [event.writingId] : []));
  return { worldId: world.id, events: events.map((event) => ({ ...event, x: Math.round(event.x * 10) / 10, y: Math.round(event.y * 10) / 10, ...(event.who?.length ? { whoNames: event.who.map((id) => names.get(id) ?? null) } : {}), ...(event.writingId ? { writingTitle: told.get(event.writingId) ?? null } : {}) })) };
}

// ---------------------------------------------------------------------------
// The author's named zones
// ---------------------------------------------------------------------------

/** The zones drawn on a world: name, colour, fill, outline, size and where their label sits. */
export async function whListZones(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const { zonesFrom, zoneShape } = await import('@/engines/worldgen/core/zones');
  const size = worldSize(world);
  const { polygonAreaKm2 } = await import('@/engines/worldgen/core/measure');
  const { unwrapRing } = await import('@/engines/worldgen/core/zones');
  return {
    worldId: world.id,
    zones: zonesFrom(deserializeEdits(world.edits ?? '[]')).map((zone) => {
      const shape = zoneShape(zone, size.width);
      // The ruler's own area: on the sphere (shrinking toward the poles), or flat on a sheet.
      const areaKm2 = Math.round(polygonAreaKm2(unwrapRing(zone.pts, size.width), size.width, size.height, undefined, world.params));
      return { ...zone, points: zone.pts.length, pts: zone.pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })), areaKm2, center: { x: Math.round(shape.cx * 10) / 10, y: Math.round(shape.cy * 10) / 10 } };
    }),
  };
}

/** Draw a named zone on a world, corner by corner, like the Zones tool. */
export async function whAddZone(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { normalizeZone, zoneShape } = await import('@/engines/worldgen/core/zones');
  const size = worldSize(world);
  const raw = args.points;
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 400) throw new BridgeError('bad-args', 'points must be 3 to 400 corners {x, y} in world cells.');
  const pts = strokeCells(args, size, 3, 'exact');
  let zone: import('@/engines/worldgen/core/zones').WorldZone;
  try { zone = normalizeZone({ id: `zone-${Date.now().toString(36)}${(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10))}`, name: args.name, pts, color: args.color, pattern: args.pattern, opacity: args.opacity }); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  if (zoneShape(zone, size.width).cells < 0.5) throw new BridgeError('bad-args', 'The corners enclose no ground: give at least three corners that are not in a line.');
  return appendEdit(args, world, { kind: 'zone', ...zone }, { zone }, `drew the zone "${zone.name}" on world "${world.title}"`);
}

/** Rename, recolour, refill or reshape a zone. */
export async function whUpdateZone(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { normalizeZone, zonesFrom, zoneShape } = await import('@/engines/worldgen/core/zones');
  const id = requireString(args, 'id');
  const current = zonesFrom(deserializeEdits(world.edits ?? '[]')).find((zone) => zone.id === id);
  if (!current) throw new BridgeError('not-found', `No zone "${id}" on this world; use wh_list_zones.`);
  const merged: Record<string, unknown> = { ...current };
  for (const key of ['name', 'color', 'pattern', 'opacity'] as const) if (args[key] !== undefined) merged[key] = args[key];
  if (args.points !== undefined) merged.pts = strokeCells(args, worldSize(world), 3, 'exact');
  let zone: import('@/engines/worldgen/core/zones').WorldZone;
  try { zone = normalizeZone(merged); } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  if (args.points !== undefined && zoneShape(zone, worldSize(world).width).cells < 0.5) throw new BridgeError('bad-args', 'The corners enclose no ground: give at least three corners that are not in a line.');
  return appendEdit(args, world, { kind: 'zone', ...zone }, { zone }, `changed the zone "${zone.name}" on world "${world.title}"`);
}

/** Take a zone off the map (undoable). */
export async function whRemoveZone(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const { zonesFrom } = await import('@/engines/worldgen/core/zones');
  const id = requireString(args, 'id');
  const current = zonesFrom(deserializeEdits(world.edits ?? '[]')).find((zone) => zone.id === id);
  if (!current) throw new BridgeError('not-found', `No zone "${id}" on this world; use wh_list_zones.`);
  return appendEdit(args, world, { kind: 'zoneRemove', id }, { id, removed: true }, `removed the zone "${current.name}" from world "${world.title}"`);
}

// ---------------------------------------------------------------------------
// The trade lens
// ---------------------------------------------------------------------------

/** The economy of a world as the Trade tab shows it, from its settlements and the author's sites. */
async function economyOf(args: ToolArgs, world: GeneratedWorld) {
  const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
  if (!opened.ok) return { pending: pendingResult(world, opened) } as const;
  const economy = await import('@/engines/worldgen/core/economy');
  const { manual, removed } = economy.tradeSitesFrom(deserializeEdits(world.edits ?? '[]'));
  const input = { world: opened.world.data, places: economy.placesFromSettlements(opened.world.geo.settlements), seed: String(opened.world.data.params.seed), manualSites: manual, removedSites: removed };
  return { economy, input, sites: economy.autoSites(input), atlas: opened.world.atlas, size: { width: opened.world.data.width, height: opened.world.data.height } } as const;
}

/** Who is fed, who will go short, prices against the usual and what is moving, for a month. */
export async function whWorldEconomy(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const month = optNumber(args, 'month') ?? 1;
  if (!Number.isInteger(month) || month < 1 || month > 240) throw new BridgeError('bad-args', 'month must be a whole number from 1 to 240.');
  const limit = clampLimit(optNumber(args, 'limit'), 30, 400);
  const state = await economyOf(args, world);
  if ('pending' in state) return state.pending;
  const { economy, input, sites } = state;
  const snapshots = economy.simulateEconomy(input, month, 0, sites);
  const snap = snapshots[snapshots.length - 1];
  const r = (v: number) => Math.round(v * 100) / 100;
  const names = new Map(input.places.map((place) => [place.id, place]));
  const wanted = typeof args.place === 'string' ? args.place.trim().toLocaleLowerCase() : null;
  const rows = snap.places
    .filter((p) => !wanted || p.name.toLocaleLowerCase() === wanted)
    .map((p) => ({
      id: p.id, name: p.name, population: names.get(p.id)?.population ?? 0, fed: p.fed,
      shortIn: Object.fromEntries(Object.entries(p.shortIn).map(([good, months]) => [good, r(months ?? 0)])),
      price: Object.fromEntries(economy.GOODS.map((good) => [good, r(p.price[good])])),
      stock: Object.fromEntries(economy.GOODS.map((good) => [good, Math.round(p.stock[good])])),
      // The port's sea trade so far (only in a single place's detail).
      ...(wanted ? (() => {
        const sea = economy.portTrade(snapshots, { id: p.id, port: names.get(p.id)?.port ?? false }, snapshots.length - 1);
        const round = (goods: Partial<Record<string, number>>) => Object.fromEntries(Object.entries(goods).filter(([, v]) => (v ?? 0) >= 0.05).map(([good, v]) => [good, r(v ?? 0)]));
        return { port: sea.port, landedBySea: round(sea.landed), shippedBySea: round(sea.shipped), tradesWith: sea.partners.slice(0, 8).map((q) => names.get(q.id)?.name ?? q.id) };
      })() : {}),
    }))
    .sort((a, b) => Number(a.fed) - Number(b.fed) || economy.STAPLES.filter((g) => g in b.shortIn).length - economy.STAPLES.filter((g) => g in a.shortIn).length || b.population - a.population)
    .slice(0, limit);
  if (wanted && !rows.length) throw new BridgeError('not-found', `No settlement named "${args.place}"; use wh_find_place.`);
  return {
    worldId: world.id, month, fedPlaces: snap.places.filter((p) => p.fed).length, places: snap.places.length,
    onTheMove: snap.onTheMove, sites: { generated: sites.filter((site) => site.auto).length, yours: sites.filter((site) => !site.auto).length },
    goods: economy.goodsSummary(snap, sites).map((g) => ({ ...g, priceMin: r(g.priceMin), priceMax: r(g.priceMax) })),
    movements: await (async () => {
      // routes: the way each shipment goes, in world cells — round bays by
      // land, along rivers, round headlands by sea — as the lens draws it.
      if (args.routes !== undefined && typeof args.routes !== 'boolean') throw new BridgeError('bad-args', 'routes must be true or false.');
      const ways = args.routes === true ? await import('@/engines/worldgen/core/tradeRoutes') : null;
      const cache = new Map<string, { x: number; y: number }[]>();
      const { mapDistanceKm } = await import('@/engines/worldgen/core/geoScale');
      const W = input.world.width, H = input.world.height;
      const km = (path: { x: number; y: number }[]) => path.reduce((sum, q, i) => i ? sum + mapDistanceKm(input.world.params, W, H, path[i - 1].x + 0.5, path[i - 1].y + 0.5, q.x + 0.5, q.y + 0.5) : 0, 0);
      return snap.movements.slice(0, 40).map((m) => {
        const a = names.get(m.from), b = names.get(m.to);
        let path: { x: number; y: number }[] | undefined;
        if (ways && a && b) {
          const key = `${m.from}>${m.to}:${m.bySea}`;
          path = cache.get(key) ?? ways.shipmentPath(input.world, a, b, m.bySea);
          cache.set(key, path);
        }
        return { good: m.good, from: a?.name ?? m.from, to: b?.name ?? m.to, amount: Math.round(m.amount), bySea: m.bySea,
          ...(path ? { path: path.map((q) => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 })), lengthKm: Math.round(km(path)) } : {}) };
      });
    })(),
    placesDetail: rows,
  };
}

/** The production sites: generated near each settlement and placed by the author. */
export async function whListTradeSites(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const state = await economyOf(args, world);
  if ('pending' in state) return state.pending;
  const names = new Map(state.input.places.map((place) => [place.id, place.name]));
  const onlyYours = args.onlyYours === true;
  return {
    worldId: world.id,
    sites: state.sites.filter((site) => !onlyYours || !site.auto).slice(0, 1000).map((site) => ({ ...site, place: site.placeId !== null ? names.get(site.placeId) ?? null : null })),
  };
}

/** Place a production site (farm, fishery, pasture, logging camp, quarry, mine, saltworks). */
export async function whAddTradeSite(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const economy = await import('@/engines/worldgen/core/economy');
  let at: { x: number; y: number };
  if (typeof args.place === 'string') {
    const opened = await openWorldForReading(world, 'places', worldEraToolScope(args)?.eraId);
    if (!opened.ok) return pendingResult(world, opened);
    const place = opened.world.atlas.byKey.get(args.place);
    if (!place) throw new BridgeError('not-found', `No place "${args.place}"; use wh_find_place for keys.`);
    at = { x: Math.floor(place.x), y: Math.floor(place.y) };
  } else at = cellCoords(args, worldSize(world));
  let site;
  try {
    site = economy.normalizeTradeSite({ id: `site-${generateId()}`.slice(0, 60), kind: args.kind, size: args.size, x: at.x, y: at.y, placeId: null });
  } catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  return appendEdit(args, world, economy.tradeSiteEdit(site), { site }, `placed a ${site.kind} in world "${world.title}"`);
}

/** Remove the author's site, or switch off a generated one. Not a deletion: an undoable edit. */
export async function whRemoveTradeSite(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const id = requireString(args, 'id');
  const state = await economyOf(args, world);
  if ('pending' in state) return state.pending;
  if (!state.sites.some((site) => site.id === id)) throw new BridgeError('not-found', `No trade site "${id}" on this world; use wh_list_trade_sites.`);
  return appendEdit(args, world, state.economy.tradeSiteRemoveEdit(id), { id, removed: true }, `removed trade site ${id} from world "${world.title}"`);
}

/** Switch a generated site back on after it was switched off. Undoable. */
export async function whRestoreTradeSite(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const id = requireString(args, 'id');
  const economy = await import('@/engines/worldgen/core/economy');
  const { removed } = economy.tradeSitesFrom(deserializeEdits(world.edits ?? '[]'));
  if (!removed.includes(id)) throw new BridgeError('not-found', `"${id}" is not a switched-off generated site on this world.`);
  return appendEdit(args, world, economy.tradeSiteRestoreEdit(id), { id, restored: true }, `switched trade site ${id} back on in world "${world.title}"`);
}
