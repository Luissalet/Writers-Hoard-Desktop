// ============================================================================
// AI bridge tools — real atlas: real-world places and deliberate divergences
// ============================================================================
//
// The opposite of worldgen: nothing here is derived. A place is an
// authoritative row the writer has checked (engines/real-atlas/types.ts says
// why it is its own engine), so every tool follows the maps.ts shape — load,
// gate on the engine, write, audit with `before` so the generic undo works.
// Nothing here ever says `deleted`: wh_delete owns that, with its dialog.
//
// Optional fields are cleared to `undefined`, never '': Dexie's update()
// deletes the key, which is what the app's own editor does, so a cleared
// address does not linger as an empty string in backups.

import { db } from '@/db';
import { getSetting, PROJECT_SETTING_PREFIXES } from '@/db/operations';
import {
  ATLAS_PLACE_KINDS,
  DIVERGENCE_CATEGORIES,
  type AtlasDivergence,
  type AtlasPlace,
  type DivergenceCategory,
} from '@/engines/real-atlas/types';
import { atlasDivergenceOps, atlasPlaceOps } from '@/engines/real-atlas/operations';
import { findPlaceAppearances, loadAppearanceWritings } from '@/engines/real-atlas/appearances';
import {
  bearingDeg,
  compassPoint,
  hasCoordinates,
  haversineKm,
  placesWithin,
  TRAVEL_MODES,
  travelEstimates,
  type LonLat,
} from '@/engines/real-atlas/geo';
import {
  atlasRoutesSettingId,
  loadAtlasRoutes,
  MAX_ROUTE_STOPS,
  parseAtlasRoutes,
  routeTotals,
  saveAtlasRoutes,
  serializeAtlasRoutes,
  type AtlasRoute,
} from '@/engines/real-atlas/routes';
import { foldForSearch, matchRank } from '@/engines/worldgen/core/searchText';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  clampLimit,
  optBoolean,
  optEnum,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const ENGINE = 'real-atlas';

/** Longest reality/fiction/reason text the list tool returns; the get tool is unabridged. */
const LIST_TEXT_LIMIT = 300;
/** Default and ceiling for wh_atlas_places_near. */
const NEAR_DEFAULT_KM = 50;
const NEAR_MAX_KM = 20_000;
/** Names the reality check spells out before it says "+N more". */
const REPORT_NAMES = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drop undefined keys, so a new row carries only the fields it has — as the editor writes them. */
function compact<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
}

/** Trimmed, de-duplicated, empties dropped: tags, aliases and sources all want this. */
function cleanList(values: string[] | undefined): string[] {
  if (!values) return [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** Trimmed optional text; blank counts as absent, which is how '' clears a field on update. */
function optTrimmed(args: ToolArgs, key: string): string | undefined {
  return optString(args, key)?.trim() || undefined;
}

function clip(text: string): string {
  return text.length > LIST_TEXT_LIMIT ? `${text.slice(0, LIST_TEXT_LIMIT - 1)}…` : text;
}

/**
 * One WGS84 coordinate, or a refusal that says the range. A value of the
 * wrong type is refused rather than dropped: coordinates are the one thing
 * this engine exists to get right, and silently storing a place without them
 * is worse than a bad-args the model can fix.
 */
function coordinate(args: ToolArgs, key: 'lat' | 'lon'): number | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  const value = optNumber(args, key);
  if (value === undefined) {
    throw new BridgeError('bad-args', `"${key}" must be a number in WGS84 decimal degrees.`);
  }
  const limit = key === 'lat' ? 90 : 180;
  if (Math.abs(value) > limit) {
    throw new BridgeError(
      'bad-args',
      `"${key}" must be between -${limit} and ${limit} (WGS84 decimal degrees, south and west negative); got ${value}.`,
    );
  }
  return value;
}

/** Both coordinates or neither: a latitude alone points at a whole parallel. */
function coordinatePair(
  args: ToolArgs,
  fallback: { lat?: number; lon?: number } = {},
): { lat: number; lon: number } | undefined {
  const givenLat = coordinate(args, 'lat');
  const givenLon = coordinate(args, 'lon');
  if (givenLat === undefined && givenLon === undefined) return undefined;
  const lat = givenLat ?? fallback.lat;
  const lon = givenLon ?? fallback.lon;
  if (lat === undefined || lon === undefined) {
    throw new BridgeError('bad-args', 'Pass both "lat" and "lon", or neither.');
  }
  return { lat, lon };
}

/** The place and everything below it: a place cannot sit inside itself or inside its own child. */
function subtreeOf(rootId: string, places: AtlasPlace[]): Set<string> {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const place of places) {
      if (place.parentId && ids.has(place.parentId) && !ids.has(place.id)) {
        ids.add(place.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** A place of THIS project, for a parentId or a placeId. */
async function placeInProject(projectId: string, placeId: string, role: string): Promise<AtlasPlace> {
  const place = await atlasPlaceOps.getOne(placeId);
  if (!place) throw new BridgeError('not-found', `No atlas place with id "${placeId}" to use as ${role}.`);
  if (place.projectId !== projectId) {
    throw new BridgeError('bad-args', `That ${role} belongs to a different project than the row.`);
  }
  return place;
}

/** A parent for `selfId`: same project, and not the place itself or anything below it. */
async function resolveParent(projectId: string, parentId: string, selfId?: string): Promise<AtlasPlace> {
  const parent = await placeInProject(projectId, parentId, 'parent');
  if (selfId && subtreeOf(selfId, await atlasPlaceOps.getAll(projectId)).has(parentId)) {
    throw new BridgeError('bad-args', 'A place cannot sit inside itself or inside one of its own children.');
  }
  return parent;
}

/** Best match rank over name and aliases (matchRank: lower is better, -1 is none). */
function placeRank(place: AtlasPlace, foldedQuery: string): number {
  let best = -1;
  for (const text of [place.name, ...place.aliases]) {
    const rank = matchRank(foldForSearch(text), foldedQuery);
    if (rank >= 0 && (best < 0 || rank < best)) best = rank;
  }
  return best;
}

async function loadPlace(id: string): Promise<AtlasPlace> {
  const place = await atlasPlaceOps.getOne(id);
  if (!place) throw new BridgeError('not-found', `No atlas place with id "${id}".`);
  return place;
}

/**
 * A place reached by id must belong to the caller's project: the copilot's
 * scope (SCOPE_KEY) and, when the call also named a `projectId`, that one.
 * The second check is what the read tools that take both needed — a
 * `placeId` from project B with `projectId` A (or none) used to answer with
 * B's rows, because the scope only ever travelled in `projectId`.
 */
function assertPlaceInScope(args: ToolArgs, place: AtlasPlace): void {
  assertRowInScope(args, place.projectId);
  const explicit = optTrimmed(args, 'projectId');
  if (explicit && explicit !== place.projectId) {
    throw new BridgeError(
      'scope',
      `The place "${place.name}" belongs to project "${place.projectId}", not to "${explicit}". Pass the place's own projectId, or leave projectId out.`,
    );
  }
}

async function loadDivergence(id: string): Promise<AtlasDivergence> {
  const row = await atlasDivergenceOps.getOne(id);
  if (!row) throw new BridgeError('not-found', `No divergence with id "${id}".`);
  return row;
}

function divergenceShape(row: AtlasDivergence, placeName: string | undefined, full: boolean): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    placeId: row.placeId,
    placeName,
    since: row.since,
    reality: full ? row.reality : clip(row.reality),
    fiction: full ? row.fiction : clip(row.fiction),
    reason: full ? row.reason : clip(row.reason),
    tags: row.tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export async function whListAtlasPlaces(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const kind = optEnum(args, 'kind', ATLAS_PLACE_KINDS);
  const query = optString(args, 'query')?.trim() || undefined;
  const limit = clampLimit(optNumber(args, 'limit'), 100, 500);

  const [places, divergences] = await Promise.all([
    atlasPlaceOps.getAll(projectId),
    atlasDivergenceOps.getAll(projectId),
  ]);
  const divergenceCount = new Map<string, number>();
  for (const row of divergences) {
    if (row.placeId) divergenceCount.set(row.placeId, (divergenceCount.get(row.placeId) ?? 0) + 1);
  }

  // Alphabetical from getAll; a query re-orders by match quality and the
  // stable sort keeps the alphabet within a rank.
  const folded = query ? foldForSearch(query) : '';
  const matching = places
    .filter((place) => !kind || place.kind === kind)
    .map((place) => ({ place, rank: folded ? placeRank(place, folded) : 0 }))
    .filter((hit) => hit.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((hit) => hit.place);

  return {
    projectId,
    kind,
    query,
    total: matching.length,
    returned: Math.min(limit, matching.length),
    places: matching.slice(0, limit).map((place) => ({
      id: place.id,
      name: place.name,
      kind: place.kind,
      aliases: place.aliases,
      country: place.country,
      lat: place.lat,
      lon: place.lon,
      era: place.era,
      fictional: place.fictional,
      parentId: place.parentId,
      tags: place.tags,
      divergenceCount: divergenceCount.get(place.id) ?? 0,
    })),
  };
}

/** Chapters listed under `appearsIn` before the answer says it is cut short. */
const MAX_APPEARS_IN = 20;

export async function whGetAtlasPlace(args: ToolArgs): Promise<unknown> {
  const place = await loadPlace(requireString(args, 'id'));
  assertRowInScope(args, place.projectId);
  const [parent, children, divergences, writings] = await Promise.all([
    place.parentId ? atlasPlaceOps.getOne(place.parentId) : undefined,
    db.atlasPlaces.where('parentId').equals(place.id).toArray(),
    db.atlasDivergences.where('placeId').equals(place.id).toArray(),
    // The engine's own token cache: unchanged chapters are not re-stripped.
    loadAppearanceWritings(place.projectId),
  ]);
  const appearsIn = findPlaceAppearances([place.name, ...place.aliases], writings);
  return {
    ...place,
    parent: parent ? { id: parent.id, name: parent.name } : undefined,
    children: children
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((child) => ({ id: child.id, name: child.name, kind: child.kind })),
    divergences: divergences
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((row) => ({ id: row.id, title: row.title, category: row.category, since: row.since })),
    // The chapters that name the place (name or alias, accents and plurals
    // folded), in manuscript order — the editor's "appears in". Capped: a
    // place named in every chapter of a long book is a list, not an answer.
    appearsIn: appearsIn.slice(0, MAX_APPEARS_IN),
    appearsInTruncated: appearsIn.length > MAX_APPEARS_IN,
  };
}

export async function whCreateAtlasPlace(args: ToolArgs): Promise<unknown> {
  // The engine gate runs before any argument is read: a disabled engine is
  // the answer even when the call is otherwise malformed.
  const projectId = await resolveProjectForEngine(args, ENGINE);
  const name = requireString(args, 'name').trim();
  const coords = coordinatePair(args);
  const parentId = optTrimmed(args, 'parentId');
  if (parentId) await resolveParent(projectId, parentId);

  const now = Date.now();
  const place: AtlasPlace = compact({
    id: generateId('place'),
    projectId,
    name,
    kind: optEnum(args, 'kind', ATLAS_PLACE_KINDS) ?? 'city',
    aliases: cleanList(optStringArray(args, 'aliases')),
    lat: coords?.lat,
    lon: coords?.lon,
    address: optTrimmed(args, 'address'),
    country: optTrimmed(args, 'country'),
    parentId,
    era: optTrimmed(args, 'era'),
    description: optString(args, 'description') ?? '',
    realNotes: optString(args, 'realNotes') ?? '',
    sources: cleanList(optStringArray(args, 'sources')),
    fictional: optBoolean(args, 'fictional') ?? false,
    tags: cleanList(optStringArray(args, 'tags')),
    createdAt: now,
    updatedAt: now,
  });
  await atlasPlaceOps.create(place);
  return withAudit(
    { id: place.id, name: place.name, kind: place.kind, created: true },
    {
      projectId,
      entityId: place.id,
      summary: `created ${place.fictional ? 'fictional ' : ''}atlas place "${place.name}" (${place.kind})`,
    },
  );
}

export async function whUpdateAtlasPlace(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const place = await loadPlace(id);
  await assertEngineEnabled(place.projectId, ENGINE);
  assertRowInScope(args, place.projectId);

  const changes: Partial<AtlasPlace> = {};
  const before: Partial<AtlasPlace> = {};
  const set = <K extends keyof AtlasPlace>(key: K, value: AtlasPlace[K]): void => {
    changes[key] = value;
    before[key] = place[key];
  };

  const name = optString(args, 'name');
  if (name !== undefined) {
    if (!name.trim()) throw new BridgeError('bad-args', 'A place needs a name; pass a non-empty one.');
    set('name', name.trim());
  }
  const kind = optEnum(args, 'kind', ATLAS_PLACE_KINDS);
  if (kind !== undefined) set('kind', kind);
  for (const key of ['aliases', 'sources', 'tags'] as const) {
    const list = optStringArray(args, key);
    if (list !== undefined) set(key, cleanList(list));
  }
  // Optional text: '' clears (stored as undefined, so the key goes away).
  for (const key of ['country', 'address', 'era'] as const) {
    if (optString(args, key) !== undefined) set(key, optTrimmed(args, key));
  }
  for (const key of ['description', 'realNotes'] as const) {
    const text = optString(args, key);
    if (text !== undefined) set(key, text);
  }
  const fictional = optBoolean(args, 'fictional');
  if (fictional !== undefined) set('fictional', fictional);

  if (optString(args, 'parentId') !== undefined) {
    const parentId = optTrimmed(args, 'parentId');
    if (parentId) await resolveParent(place.projectId, parentId, id);
    set('parentId', parentId);
  }

  const coords = coordinatePair(args, place);
  if (optBoolean(args, 'clearCoordinates') === true) {
    if (coords) throw new BridgeError('bad-args', 'Pass either clearCoordinates or lat/lon, not both.');
    set('lat', undefined);
    set('lon', undefined);
  } else if (coords) {
    set('lat', coords.lat);
    set('lon', coords.lon);
  }

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await atlasPlaceOps.update(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: place.projectId,
      entityId: id,
      summary: `updated atlas place "${place.name}"`,
      before,
    },
  );
}

// ---------------------------------------------------------------------------
// Divergences
// ---------------------------------------------------------------------------

export async function whListDivergences(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const placeId = optString(args, 'placeId')?.trim() || undefined;
  const category = optEnum(args, 'category', DIVERGENCE_CATEGORIES);
  const limit = clampLimit(optNumber(args, 'limit'), 100, 500);

  const [rows, places] = await Promise.all([
    atlasDivergenceOps.getAll(projectId),
    atlasPlaceOps.getAll(projectId),
  ]);
  const names = new Map(places.map((place) => [place.id, place.name]));
  const matching = rows.filter(
    (row) => (!placeId || row.placeId === placeId) && (!category || row.category === category),
  );
  return {
    projectId,
    placeId,
    category,
    total: matching.length,
    returned: Math.min(limit, matching.length),
    divergences: matching
      .slice(0, limit)
      .map((row) => divergenceShape(row, row.placeId ? names.get(row.placeId) : undefined, false)),
  };
}

export async function whGetDivergence(args: ToolArgs): Promise<unknown> {
  const row = await loadDivergence(requireString(args, 'id'));
  assertRowInScope(args, row.projectId);
  const place = row.placeId ? await atlasPlaceOps.getOne(row.placeId) : undefined;
  return { projectId: row.projectId, ...divergenceShape(row, place?.name, true) };
}

export async function whCreateDivergence(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, ENGINE);
  const title = requireString(args, 'title').trim();
  const placeId = optTrimmed(args, 'placeId');
  const place = placeId ? await placeInProject(projectId, placeId, 'place') : undefined;

  const now = Date.now();
  const row: AtlasDivergence = compact({
    id: generateId('divergence'),
    projectId,
    placeId,
    title,
    category: optEnum(args, 'category', DIVERGENCE_CATEGORIES) ?? 'other',
    reality: optString(args, 'reality') ?? '',
    fiction: optString(args, 'fiction') ?? '',
    reason: optString(args, 'reason') ?? '',
    since: optTrimmed(args, 'since'),
    tags: cleanList(optStringArray(args, 'tags')),
    createdAt: now,
    updatedAt: now,
  });
  await atlasDivergenceOps.create(row);
  return withAudit(
    { id: row.id, title: row.title, placeId, created: true },
    {
      projectId,
      entityId: row.id,
      summary: `recorded divergence "${row.title}" (${row.category})${place ? ` at "${place.name}"` : ''}`,
    },
  );
}

export async function whUpdateDivergence(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const row = await loadDivergence(id);
  await assertEngineEnabled(row.projectId, ENGINE);
  assertRowInScope(args, row.projectId);

  const changes: Partial<AtlasDivergence> = {};
  const before: Partial<AtlasDivergence> = {};
  const set = <K extends keyof AtlasDivergence>(key: K, value: AtlasDivergence[K]): void => {
    changes[key] = value;
    before[key] = row[key];
  };

  const title = optString(args, 'title');
  if (title !== undefined) {
    if (!title.trim()) throw new BridgeError('bad-args', 'A divergence needs a title; pass a non-empty one.');
    set('title', title.trim());
  }
  const category = optEnum(args, 'category', DIVERGENCE_CATEGORIES);
  if (category !== undefined) set('category', category);
  for (const key of ['reality', 'fiction', 'reason'] as const) {
    const text = optString(args, key);
    if (text !== undefined) set(key, text);
  }
  if (optString(args, 'since') !== undefined) set('since', optTrimmed(args, 'since'));
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) set('tags', cleanList(tags));

  // '' unanchors: the change becomes global, and the row keeps no placeId key.
  if (optString(args, 'placeId') !== undefined) {
    const placeId = optTrimmed(args, 'placeId');
    if (placeId) await placeInProject(row.projectId, placeId, 'place');
    set('placeId', placeId);
  }

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await atlasDivergenceOps.update(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: row.projectId,
      entityId: id,
      summary: `updated divergence "${row.title}"`,
      before,
    },
  );
}

// ---------------------------------------------------------------------------
// Distances — "how far, and how long does my character take"
// ---------------------------------------------------------------------------

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** A place that can be measured from, or a refusal that names the gap. */
function located(place: AtlasPlace, role: string): AtlasPlace & LonLat {
  if (!hasCoordinates(place)) {
    throw new BridgeError(
      'bad-args',
      `The ${role} place "${place.name}" has no coordinates, so there is nothing to measure from. Give it lat/lon with wh_update_atlas_place first.`,
    );
  }
  return place;
}

const TRAVEL_LABELS = {
  walk: 'on foot',
  horse: 'on horseback',
  carriage: 'by carriage',
  rail19: 'by 19th-century train',
  car: 'by car',
  plane: 'by plane',
} as const;

function hoursText(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${round(hours, 1)} h`;
  return `${round(hours / 24, 1)} days (${Math.round(hours)} h)`;
}

export async function whAtlasDistance(args: ToolArgs): Promise<unknown> {
  const from = await loadPlace(requireString(args, 'fromPlaceId'));
  assertPlaceInScope(args, from);
  const to = await loadPlace(requireString(args, 'toPlaceId'));
  assertPlaceInScope(args, to);
  if (from.projectId !== to.projectId) {
    throw new BridgeError('bad-args', 'Both places must belong to the same project.');
  }
  const a = located(from, 'origin');
  const b = located(to, 'destination');

  const km = haversineKm(a, b);
  const bearing = bearingDeg(a, b);
  const estimates = travelEstimates(km).map((estimate) => ({
    mode: estimate.mode,
    hours: round(estimate.hours, 1),
    days: estimate.days,
  }));
  const lines = estimates.map((estimate) =>
    `- ${TRAVEL_LABELS[estimate.mode]}: ${hoursText(estimate.hours)}${estimate.days !== undefined ? ` moving, ${estimate.days} day${estimate.days === 1 ? '' : 's'} in stages` : ''}`);
  return {
    from: { id: a.id, name: a.name, lat: a.lat, lon: a.lon },
    to: { id: b.id, name: b.name, lat: b.lat, lon: b.lon },
    km: round(km, 1),
    bearingDeg: round(bearing, 1),
    compass: compassPoint(bearing),
    estimates,
    markdown: [
      `${a.name} → ${b.name}: ${round(km, 1)} km as the crow flies, bearing ${Math.round(bearing)}° (${compassPoint(bearing)}). Roads add a fifth or more.`,
      ...lines,
    ].join('\n'),
  };
}

export async function whAtlasPlacesNear(args: ToolArgs): Promise<unknown> {
  const placeId = optTrimmed(args, 'placeId');
  const radiusKm = Math.min(NEAR_MAX_KM, Math.max(0, optNumber(args, 'radiusKm') ?? NEAR_DEFAULT_KM));
  const limit = clampLimit(optNumber(args, 'limit'), 50, 500);

  // One centre or the other: a placeId AND coordinates is two questions, and
  // silently answering the first would hide a model's mistake.
  const pair = coordinatePair(args);
  if (placeId && pair) {
    throw new BridgeError('bad-args', 'Pass either "placeId" or "lat"/"lon" as the centre, not both.');
  }

  let projectId: string;
  let center: LonLat;
  let origin: { id: string; name: string } | undefined;
  if (placeId) {
    const place = await loadPlace(placeId);
    assertPlaceInScope(args, place);
    projectId = place.projectId;
    const at = located(place, 'centre');
    center = { lon: at.lon, lat: at.lat };
    origin = { id: place.id, name: place.name };
  } else {
    projectId = resolveProjectId(args);
    if (!pair) throw new BridgeError('bad-args', 'Pass a "placeId" to search around, or both "lat" and "lon".');
    center = pair;
  }

  const places = await atlasPlaceOps.getAll(projectId);
  const hits = placesWithin(places, center, radiusKm).filter((hit) => hit.place.id !== origin?.id);
  return {
    projectId,
    origin,
    center,
    radiusKm,
    total: hits.length,
    returned: Math.min(limit, hits.length),
    places: hits.slice(0, limit).map((hit) => ({
      id: hit.place.id,
      name: hit.place.name,
      kind: hit.place.kind,
      lat: hit.place.lat,
      lon: hit.place.lon,
      fictional: hit.place.fictional,
      km: round(hit.km, 1),
      bearingDeg: round(bearingDeg(center, hit.place), 1),
      compass: compassPoint(bearingDeg(center, hit.place)),
    })),
  };
}

// ---------------------------------------------------------------------------
// Reality check — what the writer has not verified yet
// ---------------------------------------------------------------------------

function nameList(names: string[]): string {
  const shown = names.slice(0, REPORT_NAMES).join(', ');
  return names.length > REPORT_NAMES ? `${shown}, +${names.length - REPORT_NAMES} more` : shown;
}

export async function whRealityCheck(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const [places, divergences] = await Promise.all([
    atlasPlaceOps.getAll(projectId),
    atlasDivergenceOps.getAll(projectId),
  ]);

  const real = places.filter((place) => !place.fictional);
  const fictional = places.filter((place) => place.fictional);
  const withCoordinates = places.filter(hasCoordinates);
  // A real place with an empty realNotes is one nobody has checked yet; an
  // invented place has nothing to check, so it is not counted against them.
  const unverified = real.filter((place) => !place.realNotes.trim());

  const byCategory = Object.fromEntries(
    DIVERGENCE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<DivergenceCategory, number>;
  for (const row of divergences) byCategory[row.category] += 1;
  const incomplete = divergences
    .map((row) => ({
      id: row.id,
      title: row.title,
      missing: (['reality', 'fiction'] as const).filter((key) => !row[key].trim()),
    }))
    .filter((row) => row.missing.length > 0);
  const global = divergences.filter((row) => !row.placeId).length;

  const lines = [
    `# Reality check — ${places.length} place${places.length === 1 ? '' : 's'}, ${divergences.length} divergence${divergences.length === 1 ? '' : 's'}`,
    `- ${real.length} real, ${fictional.length} invented${fictional.length ? ` (${nameList(fictional.map((place) => place.name))})` : ''}`,
    `- ${withCoordinates.length} with coordinates, ${places.length - withCoordinates.length} without`,
    unverified.length
      ? `- ${unverified.length} real place${unverified.length === 1 ? '' : 's'} with nothing verified yet in realNotes: ${nameList(unverified.map((place) => `${place.name} (${place.kind})`))}`
      : '- Every real place has checked notes',
    divergences.length
      ? `- Divergences by category: ${DIVERGENCE_CATEGORIES.filter((category) => byCategory[category]).map((category) => `${category} ${byCategory[category]}`).join(', ')}; ${global} global`
      : '- No divergences recorded: the book follows reality as far as the atlas knows',
    incomplete.length
      ? `- ${incomplete.length} divergence${incomplete.length === 1 ? '' : 's'} missing reality or fiction text: ${nameList(incomplete.map((row) => `"${row.title}" (${row.missing.join(', ')})`))}`
      : divergences.length ? '- Every divergence states both reality and fiction' : '',
  ].filter(Boolean);

  return {
    projectId,
    places: {
      total: places.length,
      real: real.length,
      withCoordinates: withCoordinates.length,
      fictional: fictional.map((place) => ({ id: place.id, name: place.name, kind: place.kind })),
      unverified: unverified.map((place) => ({ id: place.id, name: place.name, kind: place.kind })),
    },
    divergences: {
      total: divergences.length,
      global,
      byCategory,
      incomplete,
    },
    markdown: lines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Routes — an ordered list of places, with the journey's totals
// ---------------------------------------------------------------------------
//
// Routes are not a table: they are one JSON blob per project in `settings`
// (engines/real-atlas/routes.ts says why). So the create tool's audit line
// is an UPDATE of that settings row, with the previous blob as `before` —
// which is exactly what the generic undo needs to put the list back, and
// honest about what happened. There is no delete tool for routes here (the
// panel has one, behind its dialog); wh_delete owns deletion, and a settings
// blob is not a row it can address.

function routeShape(route: AtlasRoute, places: AtlasPlace[]): Record<string, unknown> {
  const names = new Map(places.map((place) => [place.id, place.name]));
  const totals = routeTotals(route, places);
  return {
    id: route.id,
    name: route.name,
    mode: route.mode,
    placeIds: route.placeIds,
    stops: route.placeIds.map((id) => ({ id, name: names.get(id) })),
    km: round(totals.km, 1),
    legs: totals.legs.map((leg) => ({
      fromId: leg.fromId,
      toId: leg.toId,
      km: round(leg.km, 1),
      bearingDeg: round(leg.bearingDeg, 1),
      compass: compassPoint(leg.bearingDeg),
    })),
    missing: totals.missing,
    estimates: totals.estimates.map((estimate) => ({
      mode: estimate.mode,
      hours: round(estimate.hours, 1),
      days: estimate.days,
    })),
  };
}

export async function whListAtlasRoutes(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const [routes, places] = await Promise.all([loadAtlasRoutes(projectId), atlasPlaceOps.getAll(projectId)]);
  return {
    projectId,
    total: routes.length,
    routes: routes.map((route) => routeShape(route, places)),
  };
}

export async function whCreateAtlasRoute(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, ENGINE);
  const name = requireString(args, 'name').trim();
  // Not cleanList: a journey there and back names the same place twice.
  const placeIds = (optStringArray(args, 'placeIds') ?? []).map((id) => id.trim()).filter(Boolean);
  if (placeIds.length < 2) {
    throw new BridgeError('bad-args', 'A route needs at least two place ids in "placeIds", in travelling order.');
  }
  if (placeIds.length > MAX_ROUTE_STOPS) {
    throw new BridgeError('bad-args', `A route may have at most ${MAX_ROUTE_STOPS} stops.`);
  }
  const mode = optEnum(args, 'mode', TRAVEL_MODES);
  const places = await atlasPlaceOps.getAll(projectId);
  const known = new Set(places.map((place) => place.id));
  const unknown = placeIds.filter((id) => !known.has(id));
  if (unknown.length) {
    throw new BridgeError('not-found', `No atlas place of this project with id ${unknown.map((id) => `"${id}"`).join(', ')}.`);
  }

  const previous = await getSetting(`${PROJECT_SETTING_PREFIXES.atlasRoutes}${projectId}`);
  const routes = parseAtlasRoutes(previous);
  const route: AtlasRoute = compact({ id: generateId('route'), name, placeIds, mode });
  await saveAtlasRoutes(projectId, [...routes, route]);
  const shape = routeShape(route, places);
  return withAudit(
    { ...shape, created: true },
    {
      projectId,
      entityId: atlasRoutesSettingId(projectId),
      table: 'settings',
      kind: 'update',
      summary: `created atlas route "${route.name}" (${placeIds.length} stops, ${round(routeTotals(route, places).km, 0)} km)`,
      before: { value: previous ?? serializeAtlasRoutes([]) },
    },
  );
}
