import { db } from '../src/db';
import { deleteProject } from '../src/db/operations';
import { runBridgeTool } from '../src/services/aiBridge/dispatch';
import { saveWorldEra } from '../src/services/worldEras/store';
import { worldRuntimeKey } from '../src/engines/worldgen/era';

export const trace: { checks: { name: string; passed: boolean }[]; [key: string]: unknown } = { checks: [] };
function check(value: unknown, name: string): asserts value {
  trace.checks.push({ name, passed: !!value });
  if (!value) throw Error(name);
}
async function call(name: string, args: Record<string, unknown>) {
  const response = await runBridgeTool(name, args);
  check(response.ok, `${name}: ${response.error ?? ''}`);
  return response.result as Record<string, any>;
}
const snapshotValue = (row: unknown) => JSON.stringify(row, (_key, value) => value instanceof Uint8Array ? [...value] : value);

/** Actual Base/era/era-only snapshots, with another project's exact control. */
export async function testWorldgenEraCacheCleanup() {
  const marker = 'Own disposable project era cache cleanup';
  const ids = ['qa-era-cache-a-', 'qa-era-cache-b-'].map(prefix => prefix + crypto.randomUUID());
  const keys = new Set<string>();
  for (const id of ids) await db.projects.add({ id, title: marker, description: marker, mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 });
  try {
    const [projectId, siblingId] = ids, eraId = 'own-cache-past';
    await saveWorldEra(projectId, { id: eraId, name: 'Own cache past', description: marker, revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const create = (owner: string, title: string, era?: string) => call('wh_create_world', { projectId: owner, ...(era ? { eraId: era } : {}), title, preset: 'blankLand', seed: 'own-era-cache-cleanup', sheetSize: { widthKm: 64, heightKm: 32, resolution: 64 } });
    const base = await create(projectId, 'Own Base world');
    keys.add(base.worldId); keys.add(worldRuntimeKey(base.worldId, eraId));
    await call('wh_resize_world', { projectId, eraId, worldId: base.worldId, widthKm: 48, heightKm: 48, anchor: 'north-west', fill: 'sea', expectedRevision: 0 });
    const eraOnly = await create(projectId, 'Own era-only world', eraId);
    keys.add(worldRuntimeKey(eraOnly.worldId, eraId));
    const sibling = await create(siblingId, 'Own sibling control'); keys.add(sibling.worldId);
    check(!await db.generatedWorlds.get(eraOnly.worldId), 'Era-only world has no Base generatedWorlds row');
    const variant = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([projectId, eraId, 'worldgen', eraOnly.worldId]).first();
    check(!!variant, 'Era-only world is an actual project-scoped variant');
    const before = await Promise.all([...keys].map(key => db.worldSnapshots.get(key)));
    check(before.length === 4 && before.every(Boolean), 'Four real snapshots exist before deletion without eviction');
    const siblingBefore = snapshotValue({ project: await db.projects.get(siblingId), world: await db.generatedWorlds.get(sibling.worldId), snapshot: await db.worldSnapshots.get(sibling.worldId) });
    await deleteProject(projectId);
    const retained = (await Promise.all([...keys].filter(key => key !== sibling.worldId).map(key => db.worldSnapshots.get(key)))).filter(Boolean);
    trace.productDeletion = { retained: retained.map(row => row!.worldId), expectedRemoved: [...keys].filter(key => key !== sibling.worldId) };
    // Check the untouched sibling even on the historical causal failure.
    check(snapshotValue({ project: await db.projects.get(siblingId), world: await db.generatedWorlds.get(sibling.worldId), snapshot: await db.worldSnapshots.get(sibling.worldId) }) === siblingBefore, 'Deleting A preserves sibling project/world/snapshot metadata and bytes exactly');
    check(retained.length === 0, 'PROJECT_DELETE_ERA_CACHES: Base, era variant and era-only snapshots must all be deleted');
  } finally {
    for (const id of ids) {
      const project = await db.projects.get(id);
      check(!project || project.description === marker, 'Cleanup owns only marked era-cache fixture');
      if (project) await deleteProject(id);
    }
    // Declared fixture teardown, after the product assertion: removes only the
    // recorded own keys, including the orphan on the retained RED run.
    await db.worldSnapshots.bulkDelete([...keys]);
    const counts: Record<string, number> = {};
    for (const table of db.tables) if (table.schema.idxByName.projectId || table.schema.primKey.name === 'projectId') counts[table.name] = await table.where('projectId').anyOf(ids).count();
    check((await db.projects.bulkGet(ids)).every(row => !row) && Object.values(counts).every(count => count === 0) && (await db.worldSnapshots.bulkGet([...keys])).every(row => !row), 'Own era-cache fixtures and recorded snapshots empty after explicit teardown');
    trace.cleanup = { ids, counts, snapshotKeys: [...keys], empty: true, explicitOwnSnapshotTeardown: true };
  }
}
