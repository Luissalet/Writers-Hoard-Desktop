import { listEraRows, readEraRow, mutateEraRows } from '@/services/worldEras/store';
import type { EraRow, WorldEraScope } from '@/services/worldEras/types';
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

async function runMapVersionWrite<T>(mapId: string, action: (map: WorldMap) => Promise<T>, scope?: WorldEraScope): Promise<T> {
  const write = db.transaction('rw', scope?.eraId ? db.tables : [db.worldMaps, db.mapPins], async () => {
    const map = scope?.eraId ? await readEraRow<WorldMap>(scope, 'worldMaps', mapId) : await db.worldMaps.get(mapId);
    if (!map) throw new Error('Map no longer exists');
    return { result: await action(map), projectId: map.projectId };
  });
  const outcome = await trackPendingWrite(write, undefined, `map-versions:${mapId}`);
  notifyDataChanged({ source: 'other', projectId: outcome.projectId });
  return outcome.result;
}

/** Reads map + marker rows in one transaction; only saved content is captured. */
export function captureMapVersion(mapId: string, metadata: MapVersionMetadata, scope?: WorldEraScope): Promise<string> {
  return runMapVersionWrite(mapId, async map => {
    const version = makeVersion(map, await scopedPins(mapId, scope), metadata);
    await scopedMapUpdate(mapId, scope, { versions: [...(map.versions ?? []), version], updatedAt: Date.now() });
    return version.id;
  }, scope);
}

export function updateMapVersion(mapId: string, versionId: string, metadata: MapVersionMetadata, scope?: WorldEraScope): Promise<void> {
  return runMapVersionWrite(mapId, async map => {
    if (!metadata.name.trim() || !map.versions?.some(version => version.id === versionId)) throw new Error('Invalid map version');
    await scopedMapUpdate(mapId, scope, { versions: map.versions.map(version => version.id === versionId ? { ...version, name: metadata.name.trim(), date: metadata.date.trim(), description: metadata.description?.trim() } : version), updatedAt: Date.now() });
  }, scope);
}

export function deleteMapVersion(mapId: string, versionId: string, scope?: WorldEraScope): Promise<void> {
  return runMapVersionWrite(mapId, async map => {
    await scopedMapUpdate(mapId, scope, { versions: (map.versions ?? []).filter(version => version.id !== versionId), updatedAt: Date.now() });
  }, scope);
}

/** Full restore is atomic. A safety snapshot makes the displaced present recoverable. */
export function restoreMapVersion(mapId: string, versionId: string, recoveryName: string, scope?: WorldEraScope): Promise<void> {
  return runMapVersionWrite(mapId, async map => {
    const version = map.versions?.find(item => item.id === versionId);
    if (!version) throw new Error('Map version no longer exists');
    const currentPins = await scopedPins(mapId, scope);
    const recovery = makeVersion(map, currentPins, { name: recoveryName, date: '' });
    const pins: MapPin[] = [];
    const ids = new Set<string>();
    for (const pin of version.pins) {
      const owner = await (scope?.eraId ? readEraRow<MapPin>(scope, 'mapPins', pin.id) : db.mapPins.get(pin.id));
      let id = owner && (owner.mapId !== mapId || owner.projectId !== map.projectId) ? generateId('pin') : pin.id;
      if (ids.has(id)) id = generateId('pin');
      ids.add(id);
      pins.push({ ...pin, id, mapId, projectId: map.projectId });
    }
    if (scope?.eraId) await mutateEraRows(scope, [...currentPins.map(pin => ({ table: 'mapPins', id: pin.id, remove: true })), ...pins.map(pin => ({ table: 'mapPins', id: pin.id, row: pin as unknown as EraRow }))]);
    else { await db.mapPins.where('mapId').equals(mapId).delete(); if (pins.length) await db.mapPins.bulkAdd(pins); }
    await scopedMapUpdate(mapId, scope, {
      backgroundImage: version.backgroundImage, features: version.features, layers: version.layers,
      layerVisibility: version.layerVisibility, source: version.source ?? (version.backgroundImage ? 'uploaded' : undefined),
      sourceWorldId: version.sourceWorldId, sourceRevision: version.sourceRevision,
      versions: [...(map.versions ?? []), recovery], updatedAt: Date.now(),
    });
  }, scope);
}

async function scopedPins(mapId: string, scope?: WorldEraScope): Promise<MapPin[]> { return scope?.eraId ? (await listEraRows<MapPin>(scope, 'mapPins')).filter(pin => pin.mapId === mapId) : db.mapPins.where('mapId').equals(mapId).toArray(); }
async function scopedMapUpdate(mapId: string, scope: WorldEraScope | undefined, changes: Partial<WorldMap>): Promise<void> { if (scope?.eraId) await mutateEraRows(scope, [{ table: 'worldMaps', id: mapId, changes }]); else await db.worldMaps.update(mapId, changes); }
