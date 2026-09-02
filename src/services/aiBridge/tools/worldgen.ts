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
import { generatedWorldOps, worldWaypointOps } from '@/engines/worldgen/operations';
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
  const world = await generatedWorldOps.getOne(worldId);
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
  world: GeneratedWorld,
  edit: WorldEdit,
  result: T,
  summary: string,
): Promise<unknown> {
  const { before, delivered } = await applyWorldEdits(world, [edit]);
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
  const worlds = await generatedWorldOps.getAll(projectId);
  return {
    projectId,
    worlds: await Promise.all(
      worlds.map(async (world) => worldDigest(world, await worldWaypointOps.getAll(world.id))),
    ),
  };
}

export async function whGetWorld(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const waypoints = await worldWaypointOps.getAll(world.id);
  return {
    ...worldDigest(world, waypoints),
    params: normalizeParams(world.params),
    // An open view means place reads are instant and edits land on screen.
    live: liveWorld(world.id) !== undefined,
    // A forge in progress means a place read will answer pending until it ends.
    forging: isForging(world.id),
    waypoints: waypoints.map(waypointShape),
  };
}

export async function whListPlaces(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const kind = optEnum(args, 'kind', PLACE_KINDS);
  const scope = optEnum(args, 'scope', DEPTHS) ?? 'full';
  const limit = clampLimit(optNumber(args, 'limit'), 200, 1000);

  const opened = await openWorldForReading(world, scope);
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

  const opened = await openWorldForReading(world, 'full');
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

  const opened = await openWorldForReading(world, 'full');
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
  const opened = await openWorldForReading(world, 'full');
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
    const opened = await openWorldForReading(world, 'places');
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
    world,
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
    world,
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
    world,
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
    world,
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
    world,
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
  const edit: LabelEdit = { kind: 'label', x, y, text, style };
  return appendEdit(
    world,
    edit,
    { key: editKey('label', x, y), text, style, x, y },
    `labelled ${x},${y} "${text}" in world "${world.title}"`,
  );
}

// ---------------------------------------------------------------------------
// Waypoints — rows scoped by worldId
// ---------------------------------------------------------------------------

export async function whListWaypoints(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  const waypoints = await worldWaypointOps.getAll(world.id);
  return { worldId: world.id, waypoints: waypoints.map(waypointShape) };
}

export async function whAddWaypoint(args: ToolArgs): Promise<unknown> {
  const world = await loadWorld(args);
  await assertEngineEnabled(world.projectId, ENGINE);
  const name = requireString(args, 'name').trim();
  const u = wrapU(requireNumber(args, 'u'));
  const v = clampV(requireNumber(args, 'v'));
  // Colours cycle through the palette the way the view's own pin tool does.
  const existing = await worldWaypointOps.getAll(world.id);
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
  await worldWaypointOps.create(waypoint);
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
  const waypoint = await worldWaypointOps.getOne(id);
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
  await worldWaypointOps.update(id, changes);
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
): Promise<{ projectId: string; title: string } | undefined> {
  switch (type) {
    case 'codex-entry': {
      const row = await db.codexEntries.get(id);
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
      const row = await db.writings.get(id);
      return row && { projectId: row.projectId, title: row.title };
    }
    case 'timeline-event': {
      const row = await db.timelineEvents.get(id);
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
  const target = await findLinkTarget(targetType, targetId);
  if (!target) throw new BridgeError('not-found', `No ${targetType} with id "${targetId}".`);
  if (target.projectId !== world.projectId) {
    throw new BridgeError(
      'bad-args',
      `That ${targetType} belongs to a different project than the world.`,
    );
  }

  const sourceEntityId = spatialEntityId(world.id, key);
  const existing = (await db.entityLinks.where('sourceEntityId').equals(sourceEntityId).toArray())
    .find((link) => link.targetEntityType === targetType && link.targetEntityId === targetId);
  if (existing) {
    return { id: existing.id, sourceEntityId, created: false, alreadyLinked: true };
  }

  // The link carries the place's name, as the inspector files it, so a world
  // still being forged answers pending rather than filing a link titled with
  // a bare key. A key the atlas does not know (a regional-sheet hamlet) keeps
  // the key as its title, which is what the inspector would show too.
  const opened = await openWorldForReading(world, 'full');
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
  await db.entityLinks.add(link);
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
  const rows = key
    ? await db.entityLinks.where('sourceEntityId').equals(spatialEntityId(world.id, key)).toArray()
    : await db.entityLinks.where('sourceEntityId').startsWith(prefix).toArray();
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
