import { makeTableOps } from '@/engines/_shared';
import type { WorldMap, MapPin, MapVersion } from '@/types';
import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { trackPendingWrite } from '@/services/pendingWrites';

export const worldMapOps = makeTableOps<WorldMap>({
  tableName: 'worldMaps',
  scopeField: 'projectId',
});

export const mapPinOps = makeTableOps<MapPin>({
  tableName: 'mapPins',
  scopeField: 'mapId',
});

export interface MapVersionMetadata { name: string; date: string; description?: string }

function makeVersion(map: WorldMap, pins: MapPin[], metadata: MapVersionMetadata): MapVersion {
  if (!metadata.name.trim()) throw new Error('Map version needs a name');
  return {
    id: generateId('map-version'), name: metadata.name.trim(), date: metadata.date.trim(), description: metadata.description?.trim(), createdAt: Date.now(),
    backgroundImage: map.backgroundImage, features: map.features ?? [], pins, layers: map.layers,
    layerVisibility: map.layerVisibility, source: map.source, sourceWorldId: map.sourceWorldId, sourceRevision: map.sourceRevision,
  };
}

async function runMapVersionWrite<T>(mapId: string, action: (map: WorldMap) => Promise<T>): Promise<T> {
  const write = db.transaction('rw', [db.worldMaps, db.mapPins], async () => {
    const map = await db.worldMaps.get(mapId);
    if (!map) throw new Error('Map no longer exists');
    return { result: await action(map), projectId: map.projectId };
  });
  const outcome = await trackPendingWrite(write, undefined, `map-versions:${mapId}`);
  notifyDataChanged({ source: 'other', projectId: outcome.projectId });
  return outcome.result;
}

/** Reads map + marker rows in one transaction; only saved content is captured. */
export function captureMapVersion(mapId: string, metadata: MapVersionMetadata): Promise<string> {
  return runMapVersionWrite(mapId, async map => {
    const version = makeVersion(map, await db.mapPins.where('mapId').equals(mapId).toArray(), metadata);
    await db.worldMaps.update(mapId, { versions: [...(map.versions ?? []), version], updatedAt: Date.now() });
    return version.id;
  });
}

export function updateMapVersion(mapId: string, versionId: string, metadata: MapVersionMetadata): Promise<void> {
  return runMapVersionWrite(mapId, async map => {
    if (!metadata.name.trim() || !map.versions?.some(version => version.id === versionId)) throw new Error('Invalid map version');
    await db.worldMaps.update(mapId, { versions: map.versions.map(version => version.id === versionId ? { ...version, name: metadata.name.trim(), date: metadata.date.trim(), description: metadata.description?.trim() } : version), updatedAt: Date.now() });
  });
}

export function deleteMapVersion(mapId: string, versionId: string): Promise<void> {
  return runMapVersionWrite(mapId, async map => {
    await db.worldMaps.update(mapId, { versions: (map.versions ?? []).filter(version => version.id !== versionId), updatedAt: Date.now() });
  });
}

/** Full restore is atomic. A safety snapshot makes the displaced present recoverable. */
export function restoreMapVersion(mapId: string, versionId: string, recoveryName: string): Promise<void> {
  return runMapVersionWrite(mapId, async map => {
    const version = map.versions?.find(item => item.id === versionId);
    if (!version) throw new Error('Map version no longer exists');
    const currentPins = await db.mapPins.where('mapId').equals(mapId).toArray();
    const recovery = makeVersion(map, currentPins, { name: recoveryName, date: '' });
    const pins: MapPin[] = [];
    const ids = new Set<string>();
    for (const pin of version.pins) {
      const owner = await db.mapPins.get(pin.id);
      let id = owner && (owner.mapId !== mapId || owner.projectId !== map.projectId) ? generateId('pin') : pin.id;
      if (ids.has(id)) id = generateId('pin');
      ids.add(id);
      pins.push({ ...pin, id, mapId, projectId: map.projectId });
    }
    await db.mapPins.where('mapId').equals(mapId).delete();
    if (pins.length) await db.mapPins.bulkAdd(pins);
    await db.worldMaps.update(mapId, {
      backgroundImage: version.backgroundImage, features: version.features, layers: version.layers,
      layerVisibility: version.layerVisibility, source: version.source ?? (version.backgroundImage ? 'uploaded' : undefined),
      sourceWorldId: version.sourceWorldId, sourceRevision: version.sourceRevision,
      versions: [...(map.versions ?? []), recovery], updatedAt: Date.now(),
    });
  });
}
