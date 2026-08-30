// ============================================================================
// AI bridge tools — maps and their pins
// ============================================================================
//
// Pins are scoped by mapId. `MapPin` carries no timestamps of its own, and
// `WorldMap.backgroundImage` is base64 that never leaves the app through here.

import type { MapPin } from '@/types';
import { mapPinOps, worldMapOps } from '@/engines/maps/operations';
import { generateId } from '@/utils/idGenerator';
import {
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
  const mapId = requireString(args, 'mapId');
  const map = await worldMapOps.getOne(mapId);
  if (!map) throw new BridgeError('not-found', `No map with id "${mapId}".`);
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
    linkedEntryId: optString(args, 'linkedEntryId'),
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
  const id = requireString(args, 'id');
  const pin = await mapPinOps.getOne(id);
  if (!pin) throw new BridgeError('not-found', `No map pin with id "${id}".`);

  const changes: Partial<MapPin> = {};
  const name = optString(args, 'name');
  if (name !== undefined) changes.name = name;
  const description = optString(args, 'description');
  if (description !== undefined) changes.description = description;
  const icon = optEnum(args, 'icon', ICONS);
  if (icon !== undefined) changes.icon = icon;
  const linkedEntryId = optString(args, 'linkedEntryId');
  if (linkedEntryId !== undefined) changes.linkedEntryId = linkedEntryId;
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
  await mapPinOps.update(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: pin.projectId,
      entityId: id,
      summary: `updated pin "${pin.name}"`,
      before: { name: pin.name, position: pin.position, icon: pin.icon },
    },
  );
}
