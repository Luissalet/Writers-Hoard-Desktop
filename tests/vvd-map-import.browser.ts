import { db } from '@/db';
import { exportProjectData, importProjectData, deleteCodexEntry } from '@/db/operations';
import { restoreMapVersion } from '@/engines/maps/operations';
import type { MapPin } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function testVvdMapImport(): Promise<string[]> {
  const P = `vvd-import-${Date.now()}`, E = `${P}-entry`, M = `${P}-map`, PIN = `${P}-pin`;
  let cloned = '';
  try {
    await db.projects.put({ id: P, title: 'Map archive', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['maps', 'codex'], engineOrder: ['codex', 'maps'], createdAt: 1, updatedAt: 1 });
    await db.codexEntries.put({ id: E, projectId: P, type: 'location', title: 'Estuary', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    await db.codexEntries.put({ id: `${P}-outside`, projectId: `${P}-other`, type: 'location', title: 'Other project', fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    const pin: MapPin = { id: PIN, mapId: M, projectId: P, name: 'Harbour', icon: 'port', position: { x: 20, y: 30 }, linkedEntryId: E, layerId: 'places', sourceWaypointId: 'old-waypoint' };
    await db.mapPins.put(pin);
    const features = [{ id: 'border', kind: 'region' as const, name: 'Kingdom', color: '#d5b575', points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 40 }], linkedEntryId: E, layerId: 'places' }, { id: 'outside-label', kind: 'label' as const, name: 'Unimported card', color: '#eeeae2', points: [{ x: 80, y: 30 }], linkedEntryId: `${P}-outside` }];
    await db.worldMaps.put({ id: M, projectId: P, title: 'Coast', source: 'worldgen', sourceWorldId: 'old-world', sourceRevision: 4, features, layers: [{ id: 'places', name: 'Places', visible: true }], versions: [{ id: 'era', name: 'Year 1', date: '1', createdAt: 1, features, pins: [pin, { ...pin, id: `${PIN}-historical`, linkedEntryId: `${P}-outside` }], source: 'worldgen', sourceWorldId: 'old-world', sourceRevision: 1 }], createdAt: 1, updatedAt: 1 });
    cloned = await importProjectData(await exportProjectData(P));
    const map = (await db.worldMaps.where('projectId').equals(cloned).toArray())[0];
    const entry = (await db.codexEntries.where('projectId').equals(cloned).toArray())[0];
    const clonedPin = (await db.mapPins.where('projectId').equals(cloned).toArray())[0];
    assert(map.id !== M && entry.id !== E && clonedPin.id !== PIN, 'Legacy JSON import clones all table-owned identities');
    assert(map.features![0].linkedEntryId === entry.id && map.versions![0].features[0].linkedEntryId === entry.id && clonedPin.linkedEntryId === entry.id, 'Live/snapshot vectors and live markers link only to the cloned card');
    assert(map.features![1].linkedEntryId === undefined && map.versions![0].pins[1].linkedEntryId === undefined, 'Unimported cards cannot preserve navigation to another project');
    assert(map.versions![0].pins.every(item => item.mapId === map.id && item.projectId === cloned) && map.versions![0].pins[0].id === clonedPin.id, 'Snapshot pin owners and identities are consistently remapped');
    assert(map.layers![0].id === map.features![0].layerId && map.versions![0].pins[0].layerId === 'places', 'Nested layer memberships remain consistent');
    assert(!map.sourceWorldId && !map.versions![0].sourceWorldId && !clonedPin.sourceWaypointId, 'Legacy JSON import cannot retain provenance links to unimported Worldgen data');
    await restoreMapVersion(map.id, 'era', 'Imported current before restore');
    assert((await db.mapPins.where('mapId').equals(map.id).toArray()).every(item => item.projectId === cloned && item.mapId === map.id), 'Restoring imported history stays inside its cloned project');
    assert((await db.mapPins.get(PIN))?.projectId === P && (await db.worldMaps.get(M))?.features![0].linkedEntryId === E, 'Import/restore cannot rewrite the source project');
    await deleteCodexEntry(entry.id);
    const unlinked = (await db.worldMaps.get(map.id))!;
    assert(unlinked.features![0].name === 'Kingdom' && !unlinked.features![0].linkedEntryId && unlinked.versions!.every(version => version.features.every(feature => feature.linkedEntryId !== entry.id) && version.pins.every(item => item.linkedEntryId !== entry.id)), 'Codex deletion unlinks live and historical navigation while preserving map text and geometry');
    return ['JSON map clone: consistent remapped map/card/pin ownership across live content and eras', 'JSON map clone: absent cards and Worldgen provenance are detached, named layer memberships retained', 'Imported-era restore and Codex-card deletion preserve source projects and authored map content'];
  } finally {
    for (const projectId of [P, cloned].filter(Boolean)) { await db.worldMaps.where('projectId').equals(projectId).delete(); await db.mapPins.where('projectId').equals(projectId).delete(); await db.codexEntries.where('projectId').equals(projectId).delete(); await db.projects.delete(projectId); }
    await db.codexEntries.delete(`${P}-outside`);
  }
}
