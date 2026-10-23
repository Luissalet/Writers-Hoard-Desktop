import type { MapFeature, MapPin, WorldMap } from '@/types';

/** The legacy JSON format clones project IDs but does not carry Worldgen rows. */
export function remapImportedWorldMap(map: WorldMap, projectId: string, remap: (id: string, prefix: string) => string, codexIds: ReadonlySet<string>, eventIds?: ReadonlySet<string>, mediaIds?: ReadonlySet<string>): WorldMap {
  const id = remap(map.id, 'map');
  const entry = (entryId?: string) => entryId && codexIds.has(entryId) ? remap(entryId, 'codex') : undefined;
  const feature = (item: MapFeature): MapFeature => ({ ...item, linkedEntryId: entry(item.linkedEntryId) });
  const provenance = (source?: WorldMap['source']) => ({ source: source === 'worldgen' ? 'uploaded' as const : source, sourceWorldId: undefined, sourceRevision: undefined });
  // A version linked to an imported timeline moment follows that moment; an unknown link stays visible as an orphan.
  const moment = (eventId?: string) => eventId && eventIds?.has(eventId) ? remap(eventId, 'evt') : eventId;
  // Ambience points at a local audio asset: it follows the copy of that asset, or is dropped when the asset is not part of the copy.
  const ambience = map.ambience ? (mediaIds?.has(map.ambience.assetId) ? { ambience: { ...map.ambience, assetId: remap(map.ambience.assetId, 'media') } } : { ambience: undefined }) : {};
  return {
    ...map, id, projectId, ...provenance(map.source), ...ambience, features: map.features?.map(feature),
    versions: map.versions?.map(version => ({
      ...version, ...provenance(version.source), features: version.features.map(feature), timelineEventId: moment(version.timelineEventId),
      pins: version.pins.map(pin => remapImportedMapPin(pin, projectId, id, remap, codexIds, mediaIds)),
    })),
  };
}

export function remapImportedMapPin(pin: MapPin, projectId: string, mapId: string, remap: (id: string, prefix: string) => string, codexIds: ReadonlySet<string>, mediaIds?: ReadonlySet<string>): MapPin {
  const ambience = pin.ambience ? (mediaIds?.has(pin.ambience.assetId) ? { ambience: { ...pin.ambience, assetId: remap(pin.ambience.assetId, 'media') } } : { ambience: undefined }) : {};
  return {
    ...pin, id: remap(pin.id, 'pin'), projectId, mapId, sourceWaypointId: undefined, ...ambience,
    linkedEntryId: pin.linkedEntryId && codexIds.has(pin.linkedEntryId) ? remap(pin.linkedEntryId, 'codex') : undefined,
  };
}

/** Deleting a Codex card removes navigation pointers, preserving authored map content. */
export function unlinkCodexEntryFromMap(map: WorldMap, entryId: string): WorldMap {
  let changed = false;
  const unlink = <T extends { linkedEntryId?: string }>(item: T): T => {
    if (item.linkedEntryId !== entryId) return item;
    changed = true; return { ...item, linkedEntryId: undefined };
  };
  const features = map.features?.map(unlink);
  const versions = map.versions?.map(version => ({ ...version, features: version.features.map(unlink), pins: version.pins.map(unlink) }));
  return changed ? { ...map, features, versions, updatedAt: Date.now() } : map;
}
