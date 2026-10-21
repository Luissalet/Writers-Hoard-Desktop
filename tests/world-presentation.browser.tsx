import { db } from '@/db';
import type { Project } from '@/types';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { serializeEdits } from '@/engines/worldgen/core/edits';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey, worldgenScopeOperations } from '@/engines/worldgen/era';
import { normalizePresentationPatch, resolvePresentation, revertWorldPresentation, saveWorldPresentation, WorldPresentationError, PRESENTATION_DEFAULTS } from '@/engines/worldgen/presentation';
import { saveWorldEra } from '@/services/worldEras/store';
import { exportProjectData, importProjectData } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const P = 'synthetic-world-presentation', ERA = { projectId: P, eraId: 'past' };
const params = { ...DEFAULT_PARAMS, width: 128, seed: 'presentation-planet', erosion: 0 };
const world: GeneratedWorld = { id: 'presentation-world', projectId: P, title: 'Look planet', params, edits: serializeEdits([]), createdAt: 1, updatedAt: 1 };
async function setup() {
  useLocaleStore.setState({ locale: 'en' });
  await db.projects.put({ id: P, title: 'Presentation', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
  await db.generatedWorlds.put(world);
  await saveWorldEra(P, { id: ERA.eraId, name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
}
async function cleanup(owner = P) { for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(owner).delete(); await db.projects.delete(owner); }
const rejects = async (fn: () => Promise<unknown> | unknown, code: string) => { try { await fn(); } catch (error) { return error instanceof WorldPresentationError && error.code === code; } return false; };

export async function testWorldPresentationCore(): Promise<string[]> {
  let clone: string | undefined;
  try {
    await setup();
    // Legacy rows: no field means the old defaults, unchanged.
    const legacy = resolvePresentation(undefined);
    assert(legacy.theme === 'wonder' && legacy.skin3D === 'satelite' && legacy.reliefAmount === 1 && legacy.layers.borders === false && legacy.layers.roads === true, 'Legacy defaults changed');
    assert(JSON.stringify(resolvePresentation({ theme: 'nope' } as never)) === JSON.stringify(legacy), 'A corrupt stored look must fall back to defaults instead of throwing');
    for (const bad of [{ theme: 'neon' }, { reliefAmount: 9 }, { layers: { roads: 'yes' } }, { layers: { lava: true } }, { colour: 'red' }, null, []])
      assert(await rejects(() => normalizePresentationPatch(bad), 'bad-value'), `Accepted invalid presentation ${JSON.stringify(bad)}`);

    // Field merge, revisions and compare-and-swap.
    const first = await saveWorldPresentation({ projectId: P }, world.id, { theme: 'antique', layers: { roads: false } });
    assert(first.revision === 1 && first.from === undefined, 'First save did not start revisions');
    const second = await saveWorldPresentation({ projectId: P }, world.id, { layers: { borders: true } }, 1);
    let row = (await db.generatedWorlds.get(world.id))!;
    assert(second.revision === 2 && row.presentation?.theme === 'antique' && row.presentation.layers?.roads === false && row.presentation.layers.borders === true, `Layers did not merge: ${JSON.stringify(row.presentation)}`);
    assert(await rejects(() => saveWorldPresentation({ projectId: P }, world.id, { theme: 'survey' }, 1), 'conflict'), 'Stale revision was accepted');
    assert((await db.generatedWorlds.get(world.id))!.presentation?.theme === 'antique', 'Refused write changed the row');
    const same = await saveWorldPresentation({ projectId: P }, world.id, { theme: 'antique' });
    assert(same.revision === 2, 'Saving an identical look created a new revision');
    assert(row.params.seed === params.seed && row.edits === world.edits, 'Presentation touched the recipe');

    // Era scope: while the era inherits the world, a look change is shared with
    // Base and never copies the world into the era (later Base edits still show).
    const shared = await saveWorldPresentation(ERA, world.id, { skin3D: 'arcilla' });
    row = (await db.generatedWorlds.get(world.id))!;
    const variants = () => db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([P, ERA.eraId, 'worldgen', world.id]).count();
    assert(row.presentation?.skin3D === 'arcilla' && await variants() === 0, `Look change forked the world into the era: ${JSON.stringify(row.presentation)}`);
    await db.generatedWorlds.update(world.id, { title: 'Look planet renamed' });
    assert((await worldgenScopeOperations(ERA).worlds.getOne(world.id))!.title === 'Look planet renamed', 'The era stopped following Base after a look change');
    await db.generatedWorlds.update(world.id, { title: world.title });
    // Once the era holds its own copy (an authoring change there), its look is its own.
    await worldgenScopeOperations(ERA).worlds.update(world.id, { title: 'Look planet in the past' });
    await saveWorldPresentation(ERA, world.id, { theme: 'survey' });
    const past = (await worldgenScopeOperations(ERA).worlds.getOne(world.id))!;
    row = (await db.generatedWorlds.get(world.id))!;
    assert(await variants() === 1 && past.presentation?.theme === 'survey' && past.presentation.layers?.roads === false && row.presentation?.theme === 'antique', `Era look leaked: ${JSON.stringify({ past: past.presentation, base: row.presentation })}`);
    // Undo of the shared change still reverts Base after the era made its own copy.
    await revertWorldPresentation(ERA, world.id, shared);
    row = (await db.generatedWorlds.get(world.id))!;
    assert(!row.presentation?.skin3D && row.presentation?.theme === 'antique', `Undo after the era forked missed Base: ${JSON.stringify(row.presentation)}`);
    // One damaged stored field falls back alone.
    const partial = resolvePresentation({ theme: 'neon', skin3D: 'arcilla', layers: { roads: false, lava: true } } as never);
    assert(partial.theme === 'wonder' && partial.skin3D === 'arcilla' && partial.layers.roads === false, `A bad field reset the whole look: ${JSON.stringify(partial)}`);

    // Undo puts back only what still holds the undone value.
    const change = await saveWorldPresentation({ projectId: P }, world.id, { theme: 'relief', reliefAmount: 1.6 });
    await saveWorldPresentation({ projectId: P }, world.id, { reliefAmount: 0.5 });
    const reverted = await revertWorldPresentation({ projectId: P }, world.id, change);
    row = (await db.generatedWorlds.get(world.id))!;
    assert(row.presentation?.theme === 'antique' && row.presentation.reliefAmount === 0.5 && reverted.kept.includes('reliefAmount') && reverted.reverted.includes('theme'), `Undo overwrote a later change: ${JSON.stringify({ row: row.presentation, reverted })}`);

    // Bridge: get, set with CAS, undo through the generic undo entry.
    const read = await runBridgeTool('wh_get_world_presentation', { worldId: world.id });
    assert(read.ok, JSON.stringify(read));
    const readShape = read.result as { revision: number; effective: { theme: string } };
    assert(readShape.effective.theme === 'antique', 'Bridge read wrong look');
    const stale = await runBridgeTool('wh_set_world_presentation', { worldId: world.id, theme: 'wonder', expectedRevision: readShape.revision - 1 });
    assert(!stale.ok && stale.code === 'conflict', `Bridge accepted stale CAS: ${JSON.stringify(stale)}`);
    const bad = await runBridgeTool('wh_set_world_presentation', { worldId: world.id, layers: { lava: true } });
    assert(!bad.ok && bad.code === 'bad-args', 'Bridge accepted unknown layer');
    const set = await runBridgeTool('wh_set_world_presentation', { worldId: world.id, theme: 'wonder', layers: { labels: false }, expectedRevision: readShape.revision });
    assert(set.ok, JSON.stringify(set));
    const audit = (set.result as { __audit: { before: unknown; entityId: string; projectId: string } }).__audit;
    await saveWorldPresentation({ projectId: P }, world.id, { skin3D: 'dibujado' });
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_set_world_presentation', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'look' } });
    row = (await db.generatedWorlds.get(world.id))!;
    assert(undone.ok && row.presentation?.theme === 'antique' && row.presentation.layers?.labels === undefined && row.presentation.skin3D === 'dibujado', `Bridge undo wrong: ${JSON.stringify({ undone, look: row.presentation })}`);

    // Render without a theme uses the saved look; an explicit theme still wins.
    const data = generateWorld(params);
    await saveSnapshot(worldRuntimeKey(world.id), paramsKey(params), data);
    const saved = await runBridgeTool('wh_render_world_map', { worldId: world.id, width: 256 });
    const explicit = await runBridgeTool('wh_render_world_map', { worldId: world.id, width: 256, theme: 'wonder' });
    assert(saved.ok && explicit.ok, JSON.stringify({ saved: saved.error, explicit: explicit.error }));
    const savedShape = saved.result as { theme: string; dataUrl: string }, explicitShape = explicit.result as { theme: string; dataUrl: string };
    assert(savedShape.theme === 'antique' && explicitShape.theme === 'wonder' && savedShape.dataUrl !== explicitShape.dataUrl, 'Render ignored the saved look or the explicit theme');

    // Portable JSON clone carries both Base and era looks.
    clone = await importProjectData(await exportProjectData(P));
    const clonedProject = (await db.projects.get(clone))!;
    const clonedWorld = (await worldgenScopeOperations({ projectId: clone }).worlds.getAll(clone)).find(candidate => candidate.title === world.title)!;
    const clonedPast = (await worldgenScopeOperations({ projectId: clone, eraId: clonedProject.worldEras![0].id }).worlds.getOne(clonedWorld.id))!;
    assert(clonedWorld.presentation?.theme === 'antique' && clonedPast.presentation?.theme === 'survey' && (clonedWorld.presentationRevision ?? 0) > 0, `Clone lost the look: ${JSON.stringify({ base: clonedWorld.presentation, past: clonedPast.presentation })}`);
    assert(PRESENTATION_DEFAULTS.theme === 'wonder', 'Defaults moved');
    return [
      'Legacy worlds keep the old defaults; invalid looks are refused and corrupt stored looks fall back safely',
      'Look changes field-merge with revisions and compare-and-swap; identical saves create no revision; recipe untouched',
      'An era that inherits a world shares its look with Base without copying the world; an era with its own copy keeps its own look; damaged fields fall back one by one',
      'Undo (direct and bridge __undo) reverts only fields still holding the undone value',
      'wh_get/wh_set_world_presentation validate, refuse stale revisions and unknown layers',
      'wh_render_world_map uses the saved look by default and an explicit theme when given',
      'JSON export/import clones Base and era looks',
    ];
  } finally { await cleanup(); if (clone) await cleanup(clone); await db.worldSnapshots.delete(worldRuntimeKey(world.id)); }
}
