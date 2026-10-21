import { scopedTableOps } from '@/services/worldEras/tableOps';
import { worldEraToolScope, checkEraLinkedRow } from '@/services/worldEras/toolScope';
// ============================================================================
// AI bridge tools — maps and their pins
// ============================================================================
//
// Pins are scoped by mapId. `MapPin` carries no timestamps of its own, and
// `WorldMap.backgroundImage` is base64 that never leaves the app through here.

import type { MapPin } from '@/types';
import { mapPinOps as baseMapPinOps, worldMapOps as baseWorldMapOps } from '@/engines/maps/operations';
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

/** The map's eras in the order a reader travels them, with the events they stand for. */
export async function whListMapVersions(args: ToolArgs): Promise<unknown> {
  const { map, scope } = await loadMapForEras(args);
  const { orderMapVersions } = await import('@/engines/maps/versionTimeline');
  const { resolveWorldCalendar } = await import('@/engines/timeline/worldCalendarStore');
  const calendar = await resolveWorldCalendar(map.projectId, undefined, scope?.eraId).catch(() => null);
  const rows = orderMapVersions(map.versions ?? [], await eventsFor(map.projectId, scope?.eraId), calendar?.calendar ?? null);
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
  const { resolveWorldCalendar } = await import('@/engines/timeline/worldCalendarStore');
  const calendar = eventId ? (await resolveWorldCalendar(map.projectId, undefined, scope?.eraId).catch(() => null))?.calendar ?? null : null;
  const metadata = withMomentDate({ name: requireString(args, 'name'), date: optString(args, 'date') ?? '', description: optString(args, 'description'), eventId }, eventId ? await eventsFor(map.projectId, scope?.eraId) : [], calendar);
  const id = await captureMapVersion(map.id, metadata, scope);
  return withAudit({ mapId: map.id, versionId: id, created: true }, { projectId: map.projectId, entityId: map.id, summary: `saved an era of map "${map.title}"`, before: { __mapVersionCapture: { mapId: map.id, versionId: id } } });
}

/** Link an era to a timeline event, or unlink it with eventId null. */
export async function whLinkMapVersion(args: ToolArgs): Promise<unknown> {
  const { map, scope } = await loadMapForEras(args);
  await assertEngineEnabled(map.projectId, 'maps');
  const versionId = requireString(args, 'versionId');
  if (!('eventId' in args)) throw new BridgeError('bad-args', 'eventId is required: an event id, or null to unlink.');
  const eventId = args.eventId === null ? null : requireString(args, 'eventId');
  if (eventId) await checkEraLinkedRow(args, db.timelineEvents, eventId, map.projectId, 'timeline event');
  if (!map.versions?.some(version => version.id === versionId)) throw new BridgeError('not-found', `No era "${versionId}" on this map.`);
  const { linkMapVersion } = await import('@/engines/maps/operations');
  const previous = await linkMapVersion(map.id, versionId, eventId, scope);
  return withAudit({ mapId: map.id, versionId, eventId, previousEventId: previous }, { projectId: map.projectId, entityId: map.id, summary: `${eventId ? 'linked' : 'unlinked'} an era of map "${map.title}"`, before: { __mapVersionLink: { mapId: map.id, versionId, from: previous, to: eventId } } });
}
