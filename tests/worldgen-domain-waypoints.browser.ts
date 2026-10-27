import { db } from '../src/db';
import { deleteProject, exportProjectData, importProjectData } from '../src/db/operations';
import { runBridgeTool } from '../src/services/aiBridge/dispatch';
import { readEraRow, saveWorldEra } from '../src/services/worldEras/store';
import type { WorldWaypoint } from '../src/engines/worldgen/types';

export const trace: Record<string, unknown> = { checks: [] };
function check(value: unknown, name: string): asserts value {
  (trace.checks as unknown[]).push({ name, passed: !!value });
  if (!value) throw Error(name);
}
async function call(name: string, args: Record<string, unknown>) {
  const response = await runBridgeTool(name, args);
  check(response.ok, `${name}: ${response.code ?? ''} ${response.error ?? ''}`);
  return response.result as Record<string, any>;
}

// Complements the direct public add/move/list positive with the normal Undo
// handler, era storage and actual JSON clone. No Native/stdio claim here.
export async function testWorldgenDomainWaypoints() {
  const projectId = 'qa-finite-waypoint-extended-' + crypto.randomUUID();
  const marker = 'Own disposable finite waypoint extended test';
  const owned = new Set([projectId]);
  await db.projects.add({ id: projectId, title: marker, description: marker, mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 });
  try {
    const made = await call('wh_create_world', { projectId, title: 'Own pin world', preset: 'blankLand', seed: 'root-waypoint-extended', sheetSize: { widthKm: 64, heightKm: 32, resolution: 64 } });
    const worldId = made.worldId;
    const pin = await call('wh_add_waypoint', { projectId, worldId, name: 'Own retained pin', u: .25, v: .5, description: 'Exact own note' });
    const initialPin = await db.worldWaypoints.get(pin.id);
    check(initialPin?.cell?.x === 16 && initialPin.cell.y === 16, 'Public add persists the absolute cell before any resize');
    await call('wh_resize_world', { projectId, worldId, widthKm: 80, heightKm: 48, anchor: 'center', fill: 'sea', expectedRevision: 0 });
    const beforeRead = JSON.stringify(await db.worldWaypoints.get(pin.id));
    const detail = await call('wh_get_world', { projectId, worldId });
    const listed = detail.waypoints.find((row: { id: string }) => row.id === pin.id);
    check(listed.u === .3 && listed.v === .5 && listed.cell.x === 16 && listed.cell.y === 16, 'World detail uses the same current pin projection');
    check(JSON.stringify(await db.worldWaypoints.get(pin.id)) === beforeRead, 'World detail does not migrate or rewrite a pin');
    const moved = await call('wh_update_waypoint', { projectId, id: pin.id, u: .5 });
    check(moved.__audit?.before.cell.x === 16 && moved.__audit.before.cell.y === 16, 'Actual update receipt retains both absolute coordinates');
    await call('wh_update_waypoint', { projectId, id: pin.id, description: 'Later prose survives Undo' });
    // The test supplies the actual handler envelope and the same kind/tool
    // fields normally added by the native executor; it does not invent before.
    await call('__undo', { entry: { ...moved.__audit, tool: 'wh_update_waypoint', kind: 'update' } });
    const restored = await db.worldWaypoints.get(pin.id);
    check(restored?.cell?.x === 16 && restored.cell.y === 16 && restored.u === .25 && restored.description === 'Later prose survives Undo', 'Normal Undo restores position and preserves later unrelated prose');

    const eraId = 'own-past';
    await saveWorldEra(projectId, { id: eraId, name: 'Own past', description: marker, revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const basePin = JSON.stringify(await db.worldWaypoints.get(pin.id));
    const baseWorld = JSON.stringify(await db.generatedWorlds.get(worldId));
    await call('wh_update_waypoint', { projectId, eraId, id: pin.id, v: .75 });
    const eraPin = await readEraRow<WorldWaypoint>({ projectId, eraId }, 'worldWaypoints', pin.id);
    check(eraPin?.cell?.x === 16 && eraPin.cell.y === 28, 'An inherited pin moves in the requested era with one absolute conversion');
    check(JSON.stringify(await db.worldWaypoints.get(pin.id)) === basePin && JSON.stringify(await db.generatedWorlds.get(worldId)) === baseWorld, 'Era pin editing leaves Base pin and world exact');
    const inEra = await call('wh_list_waypoints', { projectId, eraId, worldId });
    check(inEra.waypoints.find((row: { id: string }) => row.id === pin.id)?.v === .75, 'Requested era pin list uses its own current position');

    const clonedId = await importProjectData(await exportProjectData(projectId));
    owned.add(clonedId);
    const clone = await db.projects.get(clonedId);
    check(clone?.description === marker, 'Actual JSON clone retains the exact own marker');
    const copied = (await db.worldWaypoints.where('projectId').equals(clonedId).toArray()).find(row => row.name === 'Own retained pin');
    check(copied?.id !== pin.id && copied?.worldId !== worldId && copied?.cell?.x === 16 && copied.cell.y === 16 && copied.description === 'Later prose survives Undo', 'Actual JSON clone remaps references and preserves absolute position/prose');
    const copiedDomain = await call('wh_list_waypoints', { projectId: clonedId, worldId: copied!.worldId });
    check(copiedDomain.waypoints.find((row: { id: string }) => row.id === copied!.id)?.u === .3, 'Cloned world projects the retained absolute pin');
    return ['Finite waypoints: readonly world detail, actual update receipt/Undo, inherited era isolation and normal JSON clone.'];
  } finally {
    const cleanup = [];
    for (const id of owned) {
      const project = await db.projects.get(id);
      check(project?.description === marker, 'Cleanup verifies each exact own project');
      const worlds = await db.generatedWorlds.where('projectId').equals(id).primaryKeys();
      await deleteProject(id);
      const counts: Record<string, number> = {};
      for (const table of db.tables) if (table.schema.idxByName.projectId || table.schema.primKey.name === 'projectId') counts[table.name] = await table.where('projectId').equals(id).count();
      check(!await db.projects.get(id) && Object.values(counts).every(n => n === 0) && (await Promise.all(worlds.map(world => db.worldSnapshots.get(world)))).every(row => !row), 'Own project, indexed rows and snapshots are empty');
      cleanup.push({ projectId: id, counts, snapshots: worlds.length });
    }
    trace.cleanup = cleanup;
  }
}
