import { scopedTableOps } from '@/services/worldEras/tableOps';
import { worldEraToolScope, checkEraLinkedRow } from '@/services/worldEras/toolScope';
// ============================================================================
// AI bridge tools — maps and their pins
// ============================================================================
//
// Pins are scoped by mapId. `MapPin` carries no timestamps of its own, and
// `WorldMap.backgroundImage` is base64 that never leaves the app through here.

import type { MapPathStyle, MapPin, MapPoint, WorldMap } from '@/types';
import { mapPinOps as baseMapPinOps, worldMapOps as baseWorldMapOps } from '@/engines/maps/operations';
import { areaKm2, lineLengthKm, matchMapKey, parseMapKey, pictureAspect, validWidthKm, widthFromKnownDistance, MAP_WIDTH_KM_RANGE } from '@/components/maps/mapScale';
import { travelEstimates } from '@/engines/real-atlas/geo';
import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  optEnum,
  optNumber,
  optString,
  requireString,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const ICONS = [
  'city', 'mountain', 'forest', 'castle', 'port',
  'ruins', 'temple', 'village', 'cave', 'custom',
] as const satisfies readonly MapPin['icon'][];

/** Marker size and icon visibility from the arguments, validated. */
function pinLook(args: ToolArgs): Pick<MapPin, 'size' | 'hideIcon'> {
  const out: Pick<MapPin, 'size' | 'hideIcon'> = {};
  if (args.size !== undefined) {
    if (args.size !== 'S' && args.size !== 'M' && args.size !== 'L') throw new BridgeError('bad-args', 'size must be S, M or L.');
    out.size = args.size;
  }
  if (args.hideIcon !== undefined) {
    if (typeof args.hideIcon !== 'boolean') throw new BridgeError('bad-args', 'hideIcon must be true or false.');
    out.hideIcon = args.hideIcon;
  }
  return out;
}

function clampPercent(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.max(0, Math.min(100, value));
}

export async function whListMaps(args: ToolArgs): Promise<unknown> {
  const scope = worldEraToolScope(args), worldMapOps = scopedTableOps(scope, 'worldMaps', 'projectId', baseWorldMapOps), mapPinOps = scopedTableOps(scope, 'mapPins', 'mapId', baseMapPinOps);
  const projectId = resolveProjectId(args);
  const maps = await worldMapOps.getAll(projectId);
  return {
    projectId,
    maps: await Promise.all(
      maps.map(async (map) => ({
        id: map.id,
        title: map.title,
        source: map.source,
        hasImage: Boolean(map.backgroundImage),
        ...(validWidthKm(map.widthKm) ? { widthKm: map.widthKm } : {}),
        pins: (await mapPinOps.getAll(map.id)).map((pin) => ({
          id: pin.id,
          name: pin.name,
          icon: pin.icon,
          description: pin.description,
          position: pin.position,
          linkedEntryId: pin.linkedEntryId,
        })),
      })),
    ),
  };
}

export async function whAddMapPin(args: ToolArgs): Promise<unknown> {
  const scope = worldEraToolScope(args), worldMapOps = scopedTableOps(scope, 'worldMaps', 'projectId', baseWorldMapOps), mapPinOps = scopedTableOps(scope, 'mapPins', 'mapId', baseMapPinOps);
  const mapId = requireString(args, 'mapId');
  const map = await worldMapOps.getOne(mapId);
  if (!map) throw new BridgeError('not-found', `No map with id "${mapId}".`);
  await assertEngineEnabled(map.projectId, 'maps');
  assertRowInScope(args, map.projectId);
  const linkedEntryId = optString(args, 'linkedEntryId') || undefined;
  await checkEraLinkedRow(args, db.codexEntries, linkedEntryId, map.projectId, 'codex entry');
  const pin: MapPin = {
    id: generateId('pin'),
    projectId: map.projectId,
    mapId,
    name: requireString(args, 'name'),
    icon: optEnum(args, 'icon', ICONS) ?? 'city',
    color: optString(args, 'color'),
    position: {
      x: clampPercent(optNumber(args, 'x'), 50),
      y: clampPercent(optNumber(args, 'y'), 50),
    },
    linkedEntryId,
    description: optString(args, 'description'),
    ...pinLook(args),
  };
  await mapPinOps.create(pin);
  return withAudit(
    { id: pin.id, mapId, position: pin.position, created: true },
    {
      projectId: map.projectId,
      entityId: pin.id,
      summary: `pinned "${pin.name}" on map "${map.title}"`,
    },
  );
}

export async function whUpdateMapPin(args: ToolArgs): Promise<unknown> {
  const scope = worldEraToolScope(args), mapPinOps = scopedTableOps(scope, 'mapPins', 'mapId', baseMapPinOps);
  const id = requireString(args, 'id');
  const pin = await mapPinOps.getOne(id);
  if (!pin) throw new BridgeError('not-found', `No map pin with id "${id}".`);
  await assertEngineEnabled(pin.projectId, 'maps');
  assertRowInScope(args, pin.projectId);

  const changes: Partial<MapPin> = {};
  const name = optString(args, 'name');
  if (name !== undefined) changes.name = name;
  const description = optString(args, 'description');
  if (description !== undefined) changes.description = description;
  const icon = optEnum(args, 'icon', ICONS);
  if (icon !== undefined) changes.icon = icon;
  const linkedEntryId = optString(args, 'linkedEntryId');
  if (linkedEntryId !== undefined) {
    await checkEraLinkedRow(args, db.codexEntries, linkedEntryId, pin.projectId, 'codex entry');
    changes.linkedEntryId = linkedEntryId;
  }
  Object.assign(changes, pinLook(args));
  const x = optNumber(args, 'x');
  const y = optNumber(args, 'y');
  if (x !== undefined || y !== undefined) {
    changes.position = {
      x: clampPercent(x, pin.position.x),
      y: clampPercent(y, pin.position.y),
    };
  }

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  const before: Record<string, unknown> = {};
  const absent: string[] = [];
  for (const key of Object.keys(changes) as (keyof MapPin)[]) {
    if (pin[key] === undefined) absent.push(key);
    else before[key] = pin[key];
  }
  if (absent.length) before.__absent = absent;
  await mapPinOps.update(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: pin.projectId,
      entityId: id,
      summary: `updated pin "${pin.name}"`,
      before,
    },
  );
}

// ---------------------------------------------------------------------------
// Map eras: dated copies of a map, optionally standing for timeline events
// ---------------------------------------------------------------------------

async function loadMapForEras(args: ToolArgs) {
  const scope = worldEraToolScope(args), worldMapOps = scopedTableOps(scope, 'worldMaps', 'projectId', baseWorldMapOps);
  const mapId = requireString(args, 'mapId');
  const map = await worldMapOps.getOne(mapId);
  if (!map) throw new BridgeError('not-found', `No map with id "${mapId}".`);
  assertRowInScope(args, map.projectId);
  return { map, scope };
}

async function eventsFor(projectId: string, eraId?: string) {
  const { listEraRows } = await import('@/services/worldEras/store');
  return eraId ? (await listEraRows<import('@/types').TimelineEvent>({ projectId, eraId }, 'timelineEvents')) : db.timelineEvents.where('projectId').equals(projectId).toArray();
}

/** Each event's own timeline calendar, falling back to the project's. */
async function timelineCalendars(projectId: string, events: import('@/types').TimelineEvent[], eraId?: string) {
  const { resolveWorldCalendar } = await import('@/engines/timeline/worldCalendarStore');
  const project = (await resolveWorldCalendar(projectId, undefined, eraId).catch(() => null))?.calendar ?? null;
  const byTimeline = new Map<string, import('@/engines/timeline/worldCalendar').WorldCalendar | null>();
  for (const id of new Set(events.map((event) => event.timelineId))) byTimeline.set(id, (await resolveWorldCalendar(projectId, id, eraId).catch(() => null))?.calendar ?? null);
  return (event: import('@/types').TimelineEvent) => byTimeline.get(event.timelineId) ?? project;
}

/** The map's eras in the order a reader travels them, with the events they stand for. */
export async function whListMapVersions(args: ToolArgs): Promise<unknown> {
  const { map, scope } = await loadMapForEras(args);
  const { orderMapVersions } = await import('@/engines/maps/versionTimeline');
  const events = await eventsFor(map.projectId, scope?.eraId);
  const calendarFor = await timelineCalendars(map.projectId, events, scope?.eraId);
  const rows = orderMapVersions(map.versions ?? [], events, calendarFor);
  return { mapId: map.id, eras: rows.map(row => ({ id: row.version.id, name: row.version.name, date: row.dateLabel, typedDate: row.version.date, description: row.version.description ?? null, eventId: row.version.timelineEventId ?? null, eventTitle: row.event?.title ?? null, orphan: row.orphan, features: row.version.features.length, pins: row.version.pins.length, createdAt: row.version.createdAt })) };
}

/** Save the map as it stands now as a new era, optionally linked to a timeline event. */
export async function whCaptureMapVersion(args: ToolArgs): Promise<unknown> {
  const { map, scope } = await loadMapForEras(args);
  await assertEngineEnabled(map.projectId, 'maps');
  const eventId = optString(args, 'eventId') || undefined;
  await checkEraLinkedRow(args, db.timelineEvents, eventId, map.projectId, 'timeline event');
  const { captureMapVersion } = await import('@/engines/maps/operations');
  const { withMomentDate } = await import('@/engines/maps/versionTimeline');
  const events = eventId ? await eventsFor(map.projectId, scope?.eraId) : [];
  const metadata = withMomentDate({ name: requireString(args, 'name'), date: optString(args, 'date') ?? '', description: optString(args, 'description'), eventId }, events, await timelineCalendars(map.projectId, events, scope?.eraId));
  const id = await captureMapVersion(map.id, metadata, scope);
  const { mapVersionFingerprint } = await import('@/engines/maps/operations');
  const fingerprint = mapVersionFingerprint({ name: metadata.name.trim(), date: metadata.date, description: metadata.description, timelineEventId: metadata.eventId ?? undefined });
  const saved = (await loadMapForEras(args)).map.versions?.find(version => version.id === id);
  return withAudit({ mapId: map.id, versionId: id, created: true, date: saved?.date ?? metadata.date }, { projectId: map.projectId, entityId: map.id, summary: `saved an era of map "${map.title}"`, before: { __mapVersionCapture: { mapId: map.id, versionId: id, fingerprint: saved ? mapVersionFingerprint(saved) : fingerprint } } });
}

/** Link an era to a timeline event, or unlink it with eventId null. */
export async function whLinkMapVersion(args: ToolArgs): Promise<unknown> {
  const { map, scope } = await loadMapForEras(args);
  await assertEngineEnabled(map.projectId, 'maps');
  const versionId = requireString(args, 'versionId');
  if (!('eventId' in args)) throw new BridgeError('bad-args', 'eventId is required: an event id, or null to unlink.');
  const eventId = args.eventId === null ? null : requireString(args, 'eventId');
  if (eventId) await checkEraLinkedRow(args, db.timelineEvents, eventId, map.projectId, 'timeline event');
  const version = map.versions?.find(item => item.id === versionId);
  if (!version) throw new BridgeError('not-found', `No era "${versionId}" on this map.`);
  // An undated era takes the moment's date, as the history panel does.
  let stamped = '';
  if (eventId && !version.date.trim()) {
    const events = await eventsFor(map.projectId, scope?.eraId), event = events.find(item => item.id === eventId);
    const { eventDate } = await import('@/engines/maps/versionTimeline');
    stamped = event ? eventDate(event, await timelineCalendars(map.projectId, events, scope?.eraId)) : '';
  }
  const { linkMapVersion } = await import('@/engines/maps/operations');
  const previous = await linkMapVersion(map.id, versionId, eventId, scope, undefined, { stampDate: stamped || undefined });
  return withAudit({ mapId: map.id, versionId, eventId, previousEventId: previous, ...(stamped ? { date: stamped } : {}) }, { projectId: map.projectId, entityId: map.id, summary: `${eventId ? 'linked' : 'unlinked'} an era of map "${map.title}"`, before: { __mapVersionLink: { mapId: map.id, versionId, from: previous, to: eventId, stamped } } });
}

// ---------------------------------------------------------------------------
// Map shapes: regions, routes and lettering on a classic map
// ---------------------------------------------------------------------------

const FEATURE_KINDS = ['region', 'path', 'label'] as const;
const MIN_POINTS: Record<(typeof FEATURE_KINDS)[number], number> = { region: 3, path: 2, label: 1 };

function featurePoints(raw: unknown, kind: (typeof FEATURE_KINDS)[number]): import('@/types').MapPoint[] {
  if (!Array.isArray(raw) || raw.length < MIN_POINTS[kind] || raw.length > 500) throw new BridgeError('bad-args', `points must list ${MIN_POINTS[kind]} to 500 {x,y} positions (0-100) for a ${kind}.`);
  return raw.map((point, index) => {
    const p = point as { x?: unknown; y?: unknown };
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new BridgeError('bad-args', `points[${index}] must be {x,y} numbers.`);
    return { x: clampPercent(p.x, 0), y: clampPercent(p.y, 0) };
  });
}

/** layerId / layerIds from the arguments, each a named layer of this map; undefined when neither is given. */
function featureLayers(args: ToolArgs, map: import('@/types').WorldMap): { layerId?: string; layerIds?: string[] } | undefined {
  let ids: string[] | undefined;
  if (args.layerIds !== undefined) {
    if (!Array.isArray(args.layerIds) || !args.layerIds.every((id) => typeof id === 'string')) throw new BridgeError('bad-args', 'layerIds must be a list of layer ids.');
    ids = [...new Set(args.layerIds as string[])];
  } else if (typeof args.layerId === 'string') ids = args.layerId ? [args.layerId] : [];
  if (!ids) return undefined;
  for (const id of ids) if (!(map.layers ?? []).some((layer) => layer.id === id)) throw new BridgeError('not-found', `No layer "${id}" on this map.`);
  return { layerId: ids[0], layerIds: ids.length > 1 ? ids : undefined };
}

const PATH_STYLES = ['road', 'trail', 'river'] as const satisfies readonly MapPathStyle[];

const LINE_PATTERNS = ['solid', 'dashed', 'dotted'] as const satisfies readonly import('@/types').MapLinePattern[];

/** linePattern from the arguments, like pathStyle: a pattern, null (update only: back to the style's own) or undefined. */
function linePatternArg(args: ToolArgs, kind: (typeof FEATURE_KINDS)[number], allowNull: boolean): import('@/types').MapLinePattern | null | undefined {
  if (!('linePattern' in args) || args.linePattern === undefined) return undefined;
  if (kind !== 'path') throw new BridgeError('bad-args', `linePattern only applies to paths, not to a ${kind}.`);
  if (args.linePattern === null && allowNull) return null;
  const pattern = optEnum(args, 'linePattern', LINE_PATTERNS);
  if (!pattern) throw new BridgeError('bad-args', `linePattern must be solid, dashed or dotted${allowNull ? ' (or null to follow the path style)' : ''}.`);
  return pattern;
}

/** pathStyle from the arguments: a style, null (update only: remove it) or undefined when absent. Only paths have one. */
function pathStyleArg(args: ToolArgs, kind: (typeof FEATURE_KINDS)[number], allowNull: boolean): MapPathStyle | null | undefined {
  if (!('pathStyle' in args) || args.pathStyle === undefined) return undefined;
  if (kind !== 'path') throw new BridgeError('bad-args', `pathStyle only applies to paths (roads, trails, rivers), not to a ${kind}.`);
  if (args.pathStyle === null && allowNull) return null;
  const style = optEnum(args, 'pathStyle', PATH_STYLES);
  if (!style) throw new BridgeError('bad-args', `pathStyle must be road, trail or river${allowNull ? ' (or null to remove it)' : ''}.`);
  return style;
}

/** Style fields from the arguments, validated by the same rules as the editor. */
async function featureStyle(args: ToolArgs) {
  const { normalizeMapFeatureStyle, MapStyleError } = await import('@/components/maps/mapStyle');
  const raw: Record<string, unknown> = {};
  for (const key of ['color', 'opacity', 'strokeColor', 'strokeWidth', 'pattern', 'patternScale', 'labelStyle']) if (args[key] !== undefined) raw[key] = args[key];
  try { return normalizeMapFeatureStyle(raw); } catch (error) { throw new BridgeError('bad-args', error instanceof MapStyleError ? error.message : String(error)); }
}

/** Write the shapes, keeping the previous list for an undo that refuses if they changed since. */
async function saveFeatures(args: ToolArgs, map: import('@/types').WorldMap, next: import('@/types').MapFeature[], result: Record<string, unknown>, summary: string) {
  const scope = worldEraToolScope(args), worldMapOps = scopedTableOps(scope, 'worldMaps', 'projectId', baseWorldMapOps);
  await worldMapOps.update(map.id, { features: next, updatedAt: Date.now() });
  return withAudit({ mapId: map.id, ...result }, { projectId: map.projectId, entityId: map.id, summary, before: { __mapFeatures: { mapId: map.id, before: map.features ?? [], after: next } } });
}

/** The shapes on a map, in drawing order (last on top). */
export async function whListMapFeatures(args: ToolArgs): Promise<unknown> {
  const { map } = await loadMapForEras(args);
  // With a scale, every route says how long it is and every region how big; the picture's proportions are read once.
  const frame = await scaleFrame(map, args);
  const widthKm = validWidthKm(map.widthKm) ? map.widthKm : undefined;
  return {
    mapId: map.id,
    ...(widthKm !== undefined ? { widthKm } : {}),
    ...(widthKm !== undefined && !frame ? { scaleNote: 'The picture proportions are unknown (no readable image), so lengths and areas are left out; pass aspect (height over width).' } : {}),
    features: (map.features ?? []).map((feature, order) => ({
      ...feature, order,
      ...(frame && feature.kind === 'path' ? { lengthKm: km6(lineLengthKm(feature.points, frame.widthKm, frame.aspect)) } : {}),
      ...(frame && feature.kind === 'region' ? { areaKm2: km6(areaKm2(feature.points, frame.widthKm, frame.aspect)) } : {}),
    })),
  };
}

/** Draw a region, route or label on a map, styled if asked. */
export async function whAddMapFeature(args: ToolArgs): Promise<unknown> {
  const { map } = await loadMapForEras(args);
  await assertEngineEnabled(map.projectId, 'maps');
  const kind = optEnum(args, 'kind', FEATURE_KINDS);
  if (!kind) throw new BridgeError('bad-args', 'kind must be region, path or label.');
  const name = requireString(args, 'name').trim().slice(0, 200);
  const points = featurePoints(args.points, kind);
  const linkedEntryId = optString(args, 'linkedEntryId') || undefined;
  await checkEraLinkedRow(args, db.codexEntries, linkedEntryId, map.projectId, 'codex entry');
  const layers = featureLayers(args, map);
  const style = await featureStyle(args);
  const pathStyle = pathStyleArg(args, kind, false);
  const linePattern = linePatternArg(args, kind, false);
  const feature: import('@/types').MapFeature = {
    id: generateId('map-feature'), kind, name, points,
    color: style.color ?? (kind === 'path' ? '#e4a853' : '#d5b575'), opacity: style.opacity ?? 0.22,
    ...(optString(args, 'description') ? { description: optString(args, 'description') } : {}),
    ...(linkedEntryId ? { linkedEntryId } : {}), ...(layers ?? {}),
    ...(style.strokeColor ? { strokeColor: style.strokeColor } : {}), ...(style.strokeWidth !== undefined ? { strokeWidth: style.strokeWidth } : {}),
    ...(style.pattern ? { pattern: style.pattern } : {}), ...(style.patternScale !== undefined ? { patternScale: style.patternScale } : {}),
    ...(style.labelStyle ? { labelStyle: style.labelStyle } : {}),
    ...(pathStyle ? { pathStyle } : {}),
    ...(linePattern ? { linePattern } : {}),
  };
  return saveFeatures(args, map, [...(map.features ?? []), feature], { id: feature.id, created: true }, `drew ${kind} "${name}" on map "${map.title}"`);
}

/** Change a shape: only the fields given; order moves it in the drawing order. */
export async function whUpdateMapFeature(args: ToolArgs): Promise<unknown> {
  const { map } = await loadMapForEras(args);
  await assertEngineEnabled(map.projectId, 'maps');
  const id = requireString(args, 'id');
  const features = map.features ?? [];
  const current = features.find((feature) => feature.id === id);
  if (!current) throw new BridgeError('not-found', `No shape "${id}" on this map; use wh_list_map_features.`);
  const style = await featureStyle(args);
  const pathStyle = pathStyleArg(args, current.kind, true);
  const linePattern = linePatternArg(args, current.kind, true);
  const next: import('@/types').MapFeature = { ...current, ...style };
  if (pathStyle === null) delete next.pathStyle; else if (pathStyle) next.pathStyle = pathStyle;
  if (linePattern === null) delete next.linePattern; else if (linePattern) next.linePattern = linePattern;
  // Lettering merges field by field, like the rest: setting the size keeps the italic.
  if (style.labelStyle) next.labelStyle = { ...current.labelStyle, ...style.labelStyle };
  if (args.pattern === 'none' || args.pattern === null) delete next.pattern;
  if (args.labelStyle === null) delete next.labelStyle;
  const name = optString(args, 'name');
  if (name !== undefined) { if (!name.trim()) throw new BridgeError('bad-args', 'name must not be empty.'); next.name = name.trim().slice(0, 200); }
  const description = optString(args, 'description');
  if (description !== undefined) next.description = description;
  if (args.points !== undefined) next.points = featurePoints(args.points, current.kind);
  const linkedEntryId = optString(args, 'linkedEntryId');
  if (linkedEntryId !== undefined) {
    await checkEraLinkedRow(args, db.codexEntries, linkedEntryId || undefined, map.projectId, 'codex entry');
    if (linkedEntryId) next.linkedEntryId = linkedEntryId; else delete next.linkedEntryId;
  }
  const layers = featureLayers(args, map);
  if (layers) { delete next.layerId; delete next.layerIds; Object.assign(next, layers); }
  let list = features.map((feature) => (feature.id === id ? next : feature));
  const order = optEnum(args, 'order', ['front', 'forward', 'backward', 'back'] as const);
  if (args.order !== undefined && !order) throw new BridgeError('bad-args', 'order must be front, forward, backward or back.');
  if (order) { const { reorderFeature } = await import('@/components/maps/mapStyle'); list = reorderFeature(list, id, order); }
  if (JSON.stringify(list) === JSON.stringify(features)) throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides mapId and id.');
  return saveFeatures(args, map, list, { id, updated: true, order: list.findIndex((feature) => feature.id === id) }, `changed ${current.kind} "${next.name}" on map "${map.title}"`);
}

// ---------------------------------------------------------------------------
// Map ground: replacing the image of a classic map
// ---------------------------------------------------------------------------

const GROUND_FITS = ['keep', 'stretch'] as const;
const MAX_GROUND_IMAGE_CHARS = 40_000_000;

/** The candidate image from `galleryAssetId` or `imageDataUrl` (exactly one), with its decoded pixel size. */
async function candidateGround(args: ToolArgs, projectId: string): Promise<{ image: string; size: import('@/components/maps/mapGround').GroundSize }> {
  const assetId = optString(args, 'galleryAssetId')?.trim(), dataUrl = optString(args, 'imageDataUrl');
  if ((assetId ? 1 : 0) + (dataUrl ? 1 : 0) !== 1) throw new BridgeError('bad-args', 'Pass exactly one of galleryAssetId or imageDataUrl.');
  let image: string;
  if (assetId) {
    const asset = await db.inspirationImages.get(assetId);
    if (!asset || asset.projectId !== projectId) throw new BridgeError('not-found', `No gallery image "${assetId}" in this project; use wh_list_images.`);
    image = asset.imageData;
  } else {
    image = dataUrl!;
    if (!/^data:image\/(png|jpe?g|webp|gif|bmp|avif);base64,/i.test(image)) throw new BridgeError('bad-args', 'imageDataUrl must be a base64 data:image/... URL (png, jpeg, webp, gif, bmp or avif).');
    if (image.length > MAX_GROUND_IMAGE_CHARS) throw new BridgeError('bad-args', 'imageDataUrl is too large.');
  }
  const { loadImageSize } = await import('@/components/maps/mapGround');
  try { return { image, size: await loadImageSize(image) }; }
  catch { throw new BridgeError('bad-args', 'That image cannot be read or decoded.'); }
}

/** What replacing the ground would do to a map: shape comparison and what moves with it. */
async function groundPlan(args: ToolArgs) {
  const { map, scope } = await loadMapForEras(args);
  const mapPinOps = scopedTableOps(scope, 'mapPins', 'mapId', baseMapPinOps);
  const candidate = await candidateGround(args, map.projectId);
  const { groundFit, groundCounts, loadImageSize } = await import('@/components/maps/mapGround');
  const oldSize = map.backgroundImage ? await loadImageSize(map.backgroundImage).catch(() => null) : null;
  const fit = oldSize ? groundFit(oldSize, candidate.size) : null;
  const counts = groundCounts(map.features ?? [], await mapPinOps.getAll(map.id));
  return { map, scope, candidate, oldSize, fit, counts };
}

/** Read-only: would this image fit the map's shape, and what moves with the ground. */
export async function whPreviewMapGround(args: ToolArgs): Promise<unknown> {
  const { map, candidate, oldSize, fit, counts } = await groundPlan(args);
  return {
    mapId: map.id, hasImage: Boolean(map.backgroundImage), oldSize, newSize: candidate.size,
    sameShape: fit ? fit.sameShape : null, oldRatio: fit?.oldRatio ?? null, newRatio: fit?.newRatio ?? null,
    counts, suggestedFit: fit && !fit.sameShape ? 'keep' : null,
  };
}

/**
 * Replace a classic map's ground image. Shapes and pins are percentages of the
 * image, so `fit: keep` (default) moves them to stay in proportion and `stretch`
 * leaves them. The map is saved as an era first. Undo restores all of it.
 */
export async function whChangeMapGround(args: ToolArgs): Promise<unknown> {
  const { map } = await loadMapForEras(args);
  await assertEngineEnabled(map.projectId, 'maps');
  if (args.fit !== undefined && !optEnum(args, 'fit', GROUND_FITS)) throw new BridgeError('bad-args', 'fit must be keep or stretch.');
  const fit = optEnum(args, 'fit', GROUND_FITS) ?? 'keep';
  const { map: current, scope, candidate, oldSize, fit: shape, counts } = await groundPlan(args);
  const remap = !!oldSize && !!shape && !shape.sameShape && fit === 'keep';
  const { changeMapGround } = await import('@/engines/maps/operations');
  const { mapGroundCopy } = await import('@/components/maps/mapGroundCopy');
  const { useLocaleStore } = await import('@/stores/localeStore');
  const receipt = await changeMapGround(current.id, { image: candidate.image, oldSize, newSize: candidate.size, mode: remap ? 'keep' : 'stretch', versionName: mapGroundCopy[useLocaleStore.getState().locale === 'es' ? 'es' : 'en'].versionName }, scope);
  return withAudit(
    { mapId: current.id, changed: true, newSize: candidate.size, oldSize, sameShape: shape ? shape.sameShape : null, fit, remapped: remap, moved: remap ? counts : null, versionId: receipt.versionId || null },
    { projectId: current.projectId, entityId: current.id, summary: `changed the ground image of map "${current.title}"`, before: { __mapGround: receipt } },
  );
}

// ---------------------------------------------------------------------------
// Map scale: how many kilometres the picture spans, measuring and a pasted key
// ---------------------------------------------------------------------------

const km6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** The picture's height over width: read from the image, or the `aspect` argument when the map has no readable image. */
async function pictureAspectFor(map: WorldMap, args: ToolArgs): Promise<{ aspect: number; source: 'image' | 'argument' }> {
  const given = args.aspect;
  if (given !== undefined && (typeof given !== 'number' || !Number.isFinite(given) || given < 0.01 || given > 100)) throw new BridgeError('bad-args', 'aspect must be a number from 0.01 to 100: the picture height divided by its width (0.5 for a picture twice as wide as tall).');
  if (map.backgroundImage) {
    const { loadImageSize } = await import('@/components/maps/mapGround');
    try { const size = await loadImageSize(map.backgroundImage); return { aspect: pictureAspect(size.width, size.height), source: 'image' }; }
    catch { /* an unreadable image falls back to the argument, if any */ }
  }
  if (typeof given === 'number') return { aspect: given, source: 'argument' };
  throw new BridgeError('bad-args', map.backgroundImage
    ? 'The map image cannot be decoded, so the picture proportions are unknown. Pass aspect (height divided by width).'
    : 'This map has no image, so the picture proportions are unknown. Pass aspect (height divided by width, 0.5 for a picture twice as wide as tall).');
}

/** The scale and proportions to measure with, or null when the map has no scale or no known proportions. */
async function scaleFrame(map: WorldMap, args: ToolArgs): Promise<{ widthKm: number; aspect: number } | null> {
  if (!validWidthKm(map.widthKm)) return null;
  try { return { widthKm: map.widthKm, aspect: (await pictureAspectFor(map, args)).aspect }; }
  catch (error) { if (args.aspect !== undefined && error instanceof BridgeError && /aspect must be/.test(error.message)) throw error; return null; }
}

function unitPoint(raw: unknown, label: string): MapPoint {
  const p = raw as { x?: unknown; y?: unknown } | null;
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) throw new BridgeError('bad-args', `${label} must be {x,y} numbers from 0 to 100 (percent of the picture).`);
  return { x: p.x, y: p.y };
}

function rangeText(): string { return `${MAP_WIDTH_KM_RANGE.min} to ${MAP_WIDTH_KM_RANGE.max} km`; }

/** Set, derive from a known distance, or clear the scale of a classic map. Undo restores the previous scale while this one stands. */
export async function whSetMapScale(args: ToolArgs): Promise<unknown> {
  const { map, scope } = await loadMapForEras(args);
  await assertEngineEnabled(map.projectId, 'maps');
  const given = (['widthKm', 'knownDistance', 'clear'] as const).filter((key) => args[key] !== undefined);
  if (given.length !== 1) throw new BridgeError('bad-args', 'Pass exactly one of widthKm, knownDistance or clear.');
  let next: number | null;
  let aspect: number | undefined;
  if (given[0] === 'clear') {
    if (args.clear !== true) throw new BridgeError('bad-args', 'clear must be true.');
    if (map.widthKm === undefined) throw new BridgeError('bad-args', 'This map has no scale to clear.');
    next = null;
  } else if (given[0] === 'widthKm') {
    if (!validWidthKm(args.widthKm)) throw new BridgeError('bad-args', `widthKm must be a number from ${rangeText()}: the distance the picture spans from left to right.`);
    next = args.widthKm;
  } else {
    const known = args.knownDistance as { from?: unknown; to?: unknown; km?: unknown } | null;
    if (!known || typeof known !== 'object' || Array.isArray(known)) throw new BridgeError('bad-args', 'knownDistance must be {from:{x,y}, to:{x,y}, km}.');
    const from = unitPoint(known.from, 'knownDistance.from'), to = unitPoint(known.to, 'knownDistance.to');
    if (typeof known.km !== 'number' || !Number.isFinite(known.km) || known.km <= 0) throw new BridgeError('bad-args', 'knownDistance.km must be a positive number of kilometres.');
    if (from.x === to.x && from.y === to.y) throw new BridgeError('bad-args', 'knownDistance.from and knownDistance.to are the same point, so they say nothing about the scale.');
    aspect = (await pictureAspectFor(map, args)).aspect;
    const width = Math.round(widthFromKnownDistance(from, to, known.km, aspect) * 1e4) / 1e4;
    if (!validWidthKm(width)) throw new BridgeError('bad-args', `That distance puts the picture at ${width} km wide, outside ${rangeText()}.`);
    next = width;
  }
  if (next === (map.widthKm ?? null)) throw new BridgeError('bad-args', next === null ? 'This map has no scale to clear.' : `Nothing to change: the map is already ${next} km wide.`);
  const { setMapScale } = await import('@/engines/maps/operations');
  const previous = await setMapScale(map.id, next, scope);
  return withAudit(
    { mapId: map.id, widthKm: next, previousWidthKm: previous, ...(aspect !== undefined ? { aspect } : {}), updated: true },
    { projectId: map.projectId, entityId: map.id, summary: next === null ? `removed the scale of map "${map.title}"` : `set the scale of map "${map.title}" to ${next} km across`, before: { __mapScale: { mapId: map.id, from: previous, to: next } } },
  );
}

/** Show or hide what a classic map draws: pins, regions, routes, labels, pins as their entries' portraits, and pin names always in view. */
export async function whSetMapLayers(args: ToolArgs): Promise<unknown> {
  const { map, scope } = await loadMapForEras(args);
  await assertEngineEnabled(map.projectId, 'maps');
  const keys = ['pins', 'region', 'path', 'label', 'portraits', 'names'] as const;
  const patch: Partial<Record<typeof keys[number], boolean>> = {};
  for (const key of keys) {
    if (args[key] === undefined) continue;
    if (typeof args[key] !== 'boolean') throw new BridgeError('bad-args', `${key} must be true or false.`);
    patch[key] = args[key] as boolean;
  }
  // projectId and eraId choose an era (the era wrapper of the manifest adds them).
  const unknown = Object.keys(args).filter((key) => !['mapId', 'projectId', 'eraId', ...keys].includes(key) && !key.startsWith('__'));
  if (unknown.length) throw new BridgeError('bad-args', `Unknown field ${unknown.join(', ')}. Pass any of ${keys.join(', ')}.`);
  if (!Object.keys(patch).length) throw new BridgeError('bad-args', `Nothing to change: pass any of ${keys.join(', ')} as true or false.`);
  const { DEFAULT_MAP_LAYERS } = await import('@/components/maps/mapGeometry');
  const current = { ...DEFAULT_MAP_LAYERS, ...(map.layerVisibility ?? {}) };
  if (Object.entries(patch).every(([key, value]) => current[key as typeof keys[number]] === value)) throw new BridgeError('bad-args', `Nothing to change: the map already shows ${Object.entries(patch).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')}.`);
  const { setMapLayers } = await import('@/engines/maps/operations');
  const receipt = await setMapLayers(map.id, patch, scope);
  return withAudit(
    { mapId: map.id, layers: receipt.to, updated: true },
    { projectId: map.projectId, entityId: map.id, summary: `changed what map "${map.title}" shows (${Object.entries(patch).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')})`, before: { __mapLayers: receipt } },
  );
}

/** Read-only: the length of a line, a route or a region's outline in kilometres, its area for a region, and how long a journey of that length takes. */
export async function whMeasureMap(args: ToolArgs): Promise<unknown> {
  const { map } = await loadMapForEras(args);
  const hasPoints = args.points !== undefined, featureId = optString(args, 'featureId');
  if ((hasPoints ? 1 : 0) + (featureId !== undefined ? 1 : 0) !== 1) throw new BridgeError('bad-args', 'Pass exactly one of points or featureId.');
  let points: MapPoint[], kind: 'line' | 'path' | 'region', feature: import('@/types').MapFeature | undefined;
  if (hasPoints) {
    if (!Array.isArray(args.points) || args.points.length < 2 || args.points.length > 500) throw new BridgeError('bad-args', 'points must list 2 to 500 {x,y} positions (0-100).');
    points = args.points.map((point, index) => unitPoint(point, `points[${index}]`));
    kind = 'line';
  } else {
    feature = (map.features ?? []).find((item) => item.id === featureId);
    if (!feature) throw new BridgeError('not-found', `No shape "${featureId}" on this map; use wh_list_map_features.`);
    if (feature.kind === 'label') throw new BridgeError('bad-args', `"${feature.name}" is a label, which has no length or area. Measure a path or a region.`);
    points = feature.points;
    kind = feature.kind;
  }
  if (!validWidthKm(map.widthKm)) throw new BridgeError('bad-args', 'This map has no scale, so nothing can be measured. Set one with wh_set_map_scale (widthKm, or knownDistance from two points).');
  const { aspect, source } = await pictureAspectFor(map, args);
  const km = km6(lineLengthKm(points, map.widthKm, aspect));
  const region = kind === 'region';
  const travelKm = region ? km6(lineLengthKm(points, map.widthKm, aspect, true)) : km;
  return {
    mapId: map.id, kind, ...(feature ? { featureId: feature.id, name: feature.name } : {}),
    km, ...(region ? { perimeterKm: travelKm, areaKm2: km6(areaKm2(points, map.widthKm, aspect)) } : {}),
    widthKm: map.widthKm, aspect, aspectSource: source,
    travel: travelEstimates(travelKm).map((estimate) => ({ mode: estimate.mode, hours: Math.round(estimate.hours * 100) / 100, ...(estimate.days !== undefined ? { days: estimate.days } : {}) })),
    travelFor: region ? 'perimeter' : 'length',
  };
}

/** Name the pins still called by a letter or number from a pasted map key ("A. The Old Mill"). dryRun only reports. Undo restores each old name where it still carries the new one. */
export async function whNameMapPinsFromKey(args: ToolArgs): Promise<unknown> {
  const { map, scope } = await loadMapForEras(args);
  await assertEngineEnabled(map.projectId, 'maps');
  const key = requireString(args, 'key');
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') throw new BridgeError('bad-args', 'dryRun must be true or false.');
  const dryRun = args.dryRun === true;
  const lines = parseMapKey(key);
  if (!lines.length) throw new BridgeError('bad-args', 'No key lines found. Write one per line (or split by " / " or ";"): a letter or number, then ".", ")", ":" or a dash, then the name, e.g. "A. The Old Mill".');
  const mapPinOps = scopedTableOps(scope, 'mapPins', 'mapId', baseMapPinOps);
  const { matches, unmatched } = matchMapKey(await mapPinOps.getAll(map.id), lines);
  const result = { mapId: map.id, dryRun, matches, unmatched: unmatched.map((line) => ({ key: line.key, name: line.name })) };
  if (dryRun || !matches.length) return { ...result, renamed: 0 };
  const { renameMapPins } = await import('@/engines/maps/operations');
  const applied = await renameMapPins(map.id, matches.map((match) => ({ pinId: match.pinId, from: match.from, to: match.to })), scope);
  return withAudit(
    { ...result, renamed: applied.length },
    { projectId: map.projectId, entityId: map.id, summary: `named ${applied.length} pin${applied.length === 1 ? '' : 's'} on map "${map.title}" from its key`, before: { __mapPinNames: { mapId: map.id, renames: applied } } },
  );
}
