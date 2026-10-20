import type { MapFeature, MapPin, WorldMap } from '@/types';

/** The legacy JSON format clones project IDs but does not carry Worldgen rows. */
export function remapImportedWorldMap(map: WorldMap, projectId: string, remap: (id: string, prefix: string) => string, codexIds: ReadonlySet<string>): WorldMap {
  const id = remap(map.id, 'map');
  const entry = (entryId?: string) => entryId && codexIds.has(entryId) ? remap(entryId, 'codex') : undefined;
  const feature = (item: MapFeature): MapFeature => ({ ...item, linkedEntryId: entry(item.linkedEntryId) });
  const provenance = (source?: WorldMap['source']) => ({ source: source === 'worldgen' ? 'uploaded' as const : source, sourceWorldId: undefined, sourceRevision: undefined });
  return {
    ...map, id, projectId, ...provenance(map.source), features: map.features?.map(feature),
    versions: map.versions?.map(version => ({
      ...version, ...provenance(version.source), features: version.features.map(feature),
      pins: version.pins.map(pin => remapImportedMapPin(pin, projectId, id, remap, codexIds)),
    })),
  };
}

export function remapImportedMapPin(pin: MapPin, projectId: string, mapId: string, remap: (id: string, prefix: string) => string, codexIds: ReadonlySet<string>): MapPin {
  return {
    ...pin, id: remap(pin.id, 'pin'), projectId, mapId, sourceWaypointId: undefined,
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
