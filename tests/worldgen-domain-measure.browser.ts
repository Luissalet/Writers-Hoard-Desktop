import { db } from '../src/db';
import { deleteProject } from '../src/db/operations';
import { runBridgeTool } from '../src/services/aiBridge/dispatch';

export const trace: { checks: { name: string; passed: boolean }[]; [key: string]: unknown } = { checks: [] };
function check(value: unknown, name: string): asserts value {
  trace.checks.push({ name, passed: !!value }); if (!value) throw Error(name);
}
async function call(name: string, args: Record<string, unknown>) {
  const reply = await runBridgeTool(name, args); check(reply.ok, `Public ${name}: ${reply.code ?? ''} ${reply.error ?? ''}`);
  return reply.result as Record<string, any>;
}

/** Public ruler must use the current finite extent and physical cell size. */
export async function testWorldgenDomainMeasure() {
  const projectId = 'qa-domain-measure-' + crypto.randomUUID(), marker = 'Own disposable public finite ruler acceptance';
  await db.projects.add({ id: projectId, title: marker, description: marker, mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 });
  try {
    const made = await call('wh_create_world', { projectId, title: 'Own finite ruler portrait', preset: 'blankLand', seed: 'own-finite-ruler', sheetSize: { widthKm: 320, heightKm: 640, resolution: 64 } });
    const worldId = made.worldId, scope = { projectId, worldId };
    let domain = await call('wh_get_world_domain', scope);
    check(domain.bounds.width === 32 && domain.bounds.height === 64 && domain.source.width === 128 && domain.cellKm === 10, 'Public materialized portrait baseline');
    const measure = (points: { x: number; y: number }[]) => call('wh_measure_world', { ...scope, points });
    const beforeRead = JSON.stringify(await db.generatedWorlds.get(worldId));
    let result = await measure([{ x: 0, y: 10 }, { x: 31, y: 10 }]); trace.initialReading = result;
    check(result.totalKm === 310 && result.legs[0].km === 310 && result.legs[0].bearing === 90, 'FINITE_PUBLIC_RULER_CURRENT_CELL:32x64 at10km per cell must measure31cells as310km');
    result = await measure([{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 64 }, { x: 0, y: 64 }]);
    check(result.totalKm === 1280 && result.areaKm2 === 204800 && result.closedPerimeterKm === 1920, 'Finite boundary coordinates and planar area/perimeter do not wrap');
    check(JSON.stringify(await db.generatedWorlds.get(worldId)) === beforeRead, 'Public finite ruler is readonly');
    for (const point of [{ x: -1, y: 0 }, { x: 32.01, y: 0 }, { x: 0, y: 64.01 }]) {
      const refused = await runBridgeTool('wh_measure_world', { ...scope, points: [{ x: 0, y: 0 }, point] });
      check(!refused.ok && refused.code === 'bad-args', 'Finite points beyond current rectangle are rejected without wrapping');
    }
    await call('wh_set_world_scale', { ...scope, widthKm: 640, expectedRevision: domain.scaleRevision });
    result = await measure([{ x: 0, y: 10 }, { x: 31, y: 10 }]); check(result.totalKm === 620, 'Public ruler uses current calibration at unchanged grid geometry');
    domain = await call('wh_get_world_domain', scope);
    await call('wh_resize_world', { ...scope, widthKm: 640, heightKm: 1920, anchor: 'north-west', fill: 'sea', expectedRevision: domain.revision });
    domain = await call('wh_get_world_domain', scope); check(domain.bounds.height === 96 && domain.cellKm === 20, 'Real grow extends beyond the source height without recalibrating');
    result = await measure([{ x: 0, y: 64 }, { x: 0, y: 95 }]); check(result.totalKm === 620 && result.legs[0].bearing === 180, 'Current finite height accepts the newly added southern cells');
    const legacy = await call('wh_create_world', { projectId, title: 'Own legacy ruler control', preset: 'blankLand', width: 1024, worldKm: 1000, seed: 'own-legacy-ruler' });
    const wrapped = await call('wh_measure_world', { projectId, worldId: legacy.worldId, points: [{ x: 1023, y: 100 }, { x: 1025, y: 100 }] });
    const canonical = await call('wh_measure_world', { projectId, worldId: legacy.worldId, points: [{ x: 1023, y: 100 }, { x: 1, y: 100 }] });
    check(JSON.stringify(wrapped) === JSON.stringify(canonical) && canonical.totalKm === 1.95, 'Legacy sheet seam and normalized wrapping remain exact');
    return { worldId, domain, initialKm: 310, calibratedKm: 620, legacyKm: canonical.totalKm };
  } finally {
    check((await db.projects.get(projectId))?.description === marker, 'Cleanup owns exact ruler fixture marker');
    const worlds = await db.generatedWorlds.where('projectId').equals(projectId).primaryKeys();
    await deleteProject(projectId);
    const counts: Record<string, number> = {};
    for (const table of db.tables) if (table.schema.idxByName.projectId || table.schema.primKey.name === 'projectId') counts[table.name] = await table.where('projectId').equals(projectId).count();
    const snapshots = await Promise.all(worlds.map(id => db.worldSnapshots.get(id)));
    check(!await db.projects.get(projectId) && Object.values(counts).every(count => count === 0) && snapshots.every(row => !row), 'Own ruler project/indexed rows/snapshots removed');
    trace.cleanup = { projectId, counts, snapshots: worlds.length, empty: true };
  }
}
