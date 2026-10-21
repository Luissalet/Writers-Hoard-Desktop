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

function placeShape(place: AtlasPlace, data: WorldData): Record<string, unknown> {
  return {
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
  edit: WorldEdit,
  result: T,
  summary: string,
): Promise<unknown> {
  const { before, delivered } = await applyWorldEdits(world, [edit], worldEraToolScope(args)?.eraId);
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
  const { renderCartoCanvas } = await import('@/engines/worldgen/cartography/texture');
  const { themeById } = await import('@/engines/worldgen/cartography/theme');
  const { DEFAULT_LAYERS } = await import('@/engines/worldgen/cartography/render');
  const canvas = renderCartoCanvas(opened.world.data, { theme: themeById(themeId), width, height, view, geography: opened.world.geo, title: world.title, layers: { ...DEFAULT_LAYERS, ...look.layers }, reliefAmount: look.reliefAmount });
  return { worldId: world.id, theme: themeId, view: view ?? { x: 0, y: 0, w: opened.world.data.width, h: opened.world.data.height }, width: canvas.width, height: canvas.height, mime: 'image/png', filename: `${world.title.replace(/[<>:"/\\|?*]/g, '_') || 'world'}-${themeId}.png`, dataUrl: canvas.toDataURL('image/png') };
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
  return {
    worldId: world.id,
    scope,
    total: matching.length,
    returned: Math.min(limit, matching.length),
    live,
    places: matching.slice(0, limit).map((place) => placeShape(place, data)),
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
  return {
    worldId: world.id,
    query,
    total: ranked.length,
    returned: Math.min(limit, ranked.length),
    live,
    places: ranked.slice(0, limit).map((hit) => placeShape(hit.place, data)),
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
  // `removed`, never `deleted`: the place is hidden by an edit that
  // wh_restore_place (or an undo) reverses, and no row goes anywhere.
  return appendEdit(
    args, world,
    { kind: 'remove', target, key },
    { key, removed: true },
    `removed place ${key} from world "${world.title}"`,
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
    { key: editKey('label', x, y), text, style, x, y, ...labelShapeShown(shape) },
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
    { key: editKey('stamp', x, y), glyph, size, x, y, ...(name ? { name } : {}) },
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
  for (const key of ['theme', 'skin3D', 'reliefAmount', 'layers']) if (args[key] !== undefined) patch[key] = args[key];
  if (!Object.keys(patch).length) throw new BridgeError('bad-args', 'Nothing to change: pass theme, skin3D, reliefAmount or layers.');
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
  const width = optNumber(args, 'width') ?? DEFAULT_PARAMS.width;
  if (![1024, 2048, 3072].includes(width)) throw new BridgeError('bad-args', 'width must be 1024 (fast), 2048 (standard) or 3072 (high).');
  const title = optString(args, 'title')?.trim() || 'World';
  const seed = optString(args, 'seed')?.trim() || generateId('seed').slice(-8);
  const now = Date.now();
  const world: GeneratedWorld = { id: generateId('world'), projectId, title, params: applyWorldPreset({ ...DEFAULT_PARAMS, seed, width }, preset), edits: freshWorldEdits(), createdAt: now, updatedAt: now };
  await worldgenScopeOperations(worldEraToolScope(args)).worlds.create(world);
  return withAudit(
    { id: world.id, worldId: world.id, title, preset: presetId, seed, width, starter: world.params.starter ?? null, created: true },
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
  const reading = measurePolyline(points, width, height);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    worldId: world.id,
    totalKm: round(reading.totalKm),
    legs: reading.legs.map(leg => ({ km: round(leg.km), bearing: Math.round(leg.bearing) })),
    ...(points.length >= 3 ? { areaKm2: Math.round(polygonAreaKm2(points, width, height)), closedPerimeterKm: round(closedPerimeterKm(points, width, height)) } : {}),
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
  const options = { mode, season, ...(pace && pace !== 'steady' ? { pace } : {}), ...(legModes ? { legModes } : {}), ...(Object.keys(profile).length ? { profile } : {}), ...(hoursPerDay ? { hoursPerDay } : {}), via: stops.slice(1, -1).map(({ x, y }) => ({ x, y })) };
  const locale = optEnum(args, 'locale', ['es', 'en'] as const) ?? 'en';
  const route = planRoute(data, geo, stops[0], stops[stops.length - 1], options, locale);
  if (route.impossible) return { worldId: world.id, impossible: route.impossible, stops: stops.map(stop => stop.name) };
  const r = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
  return {
    worldId: world.id,
    stops: stops.map(stop => stop.name),
    mode, season, pace: pace ?? 'steady', legModes: legModes ?? null,
    hoursPerDay: r(effectiveHoursPerDay(options), 2),
    km: r(route.km), directKm: r(route.directKm), hours: r(route.hours), days: r(route.days, 2), restDays: route.restDays ?? 0,
    roadFraction: r(route.roadFraction, 2), ascentM: Math.round(route.ascentM), highestM: Math.round(route.highestM), lowestM: Math.round(route.lowestM),
    crossings: route.crossings.length, realms: route.realms,
    terrain: route.legs.slice(0, 8).map(leg => ({ terrain: leg.terrain, km: r(leg.km), onRoad: leg.onRoad })),
    nights: route.stages.slice(0, 60).map(stage => ({ night: stage.night, x: Math.round(stage.x), y: Math.round(stage.y), rough: stage.rough, terrain: stage.terrain, nearest: stage.nearest ? { name: stage.nearest.name, km: r(stage.nearest.km) } : null })),
  };
}
