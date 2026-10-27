import { db } from '../src/db';
import { deleteProject } from '../src/db/operations';
import { runBridgeTool } from '../src/services/aiBridge/dispatch';

export const trace: { checks: { name: string; passed: boolean }[]; [key: string]: unknown } = { checks: [] };
function check(value: unknown, name: string): asserts value {
  trace.checks.push({ name, passed: !!value }); if (!value) throw Error(name);
}
async function call(name: string, args: Record<string, unknown>) {
  const reply = await runBridgeTool(name, args);
  check(reply.ok, `${name}: ${reply.error ?? ''}`);
  return reply.result as Record<string, any>;
}

export async function testWorldgenDomainWaypointAxis() {
  const projectId = 'qa-waypoint-axis-' + crypto.randomUUID(), marker = 'Own disposable exact untouched waypoint axis';
  await db.projects.add({ id: projectId, title: marker, description: marker, mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 });
  try {
    const failures: string[] = [], observations: unknown[] = [];
    for (const axis of ['u', 'v'] as const) {
      const made = await call('wh_create_world', { projectId, title: `Own ${axis} partial move`, preset: 'blankLand', seed: 'own-waypoint-axis', sheetSize: { widthKm: 64, heightKm: axis === 'u' ? 49 : 32, resolution: 64 } });
      const scope = { projectId, worldId: made.worldId };
      const pin = await call('wh_add_waypoint', { ...scope, name: 'Exact retained coordinate', u: axis === 'u' ? .5 : 1 / 64, v: axis === 'u' ? 0 : .5 });
      const original = (await db.worldWaypoints.get(pin.id))!;
      check(original.cell?.[axis === 'u' ? 'y' : 'x'] === 1, `${axis} fixture starts at exact absolute untouched coordinate1`);
      let domain = await call('wh_get_world_domain', scope);
      let resized = await call('wh_resize_world', { ...scope, widthKm: axis === 'u' ? 64 : 66, heightKm: axis === 'u' ? 53 : 32, anchor: 'center', fill: 'sea', expectedRevision: domain.revision });
      resized = await call('wh_resize_world', { ...scope, widthKm: axis === 'u' ? 64 : 49, heightKm: axis === 'u' ? 49 : 32, anchor: 'north-west', fill: 'sea', expectedRevision: resized.domain.revision });
      domain = resized.domain;
      check(domain.bounds[axis === 'u' ? 'y' : 'x'] === -1 && domain.bounds[axis === 'u' ? 'height' : 'width'] === 49, `${axis} actual finite49 extent and negative origin reached`);
      const before = (await db.worldWaypoints.get(pin.id))!;
      await call('wh_update_waypoint', { projectId, id: pin.id, [axis]: .6 });
      const after = (await db.worldWaypoints.get(pin.id))!, untouched = axis === 'u' ? 'y' : 'x', changed = axis === 'u' ? 'x' : 'y';
      observations.push({ axis, bounds: domain.bounds, before: before.cell, after: after.cell });
      check(after.cell?.[changed] !== before.cell?.[changed], `${axis} actual requested axis changes`);
      const exact = after.cell?.[untouched] === before.cell?.[untouched];
      trace.checks.push({ name: `${axis}-only move preserves untouched ${untouched} ABS exactly`, passed: exact });
      if (!exact) failures.push(`${axis}-only: ${untouched} ${before.cell?.[untouched]} -> ${after.cell?.[untouched]}`);
    }
    trace.observations = observations;
    check(!failures.length, 'Partial coordinate update must not round-trip an untouched stored ABS axis: ' + failures.join('; '));
  } finally {
    check((await db.projects.get(projectId))?.description === marker, 'Cleanup owns exact waypoint-axis fixture');
    const worlds = await db.generatedWorlds.where('projectId').equals(projectId).primaryKeys();
    await deleteProject(projectId);
    const counts: Record<string, number> = {};
    for (const table of db.tables) if (table.schema.idxByName.projectId || table.schema.primKey.name === 'projectId') counts[table.name] = await table.where('projectId').equals(projectId).count();
    check(!await db.projects.get(projectId) && Object.values(counts).every(n => !n) && (await Promise.all(worlds.map(id => db.worldSnapshots.get(id)))).every(row => !row), 'Own waypoint-axis rows and snapshots empty');
    trace.cleanup = { projectId, counts, snapshots: worlds.length, empty: true };
  }
}
