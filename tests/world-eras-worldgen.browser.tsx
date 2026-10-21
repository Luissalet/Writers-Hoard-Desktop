import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import type { Project } from '@/types';
import type { GeneratedWorld, WorldWaypoint } from '@/engines/worldgen/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { serializeEdits } from '@/engines/worldgen/core/edits';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { registerLiveWorld, liveWorld } from '@/engines/worldgen/core/liveWorlds';
import { openWorldForReading, applyWorldEdits } from '@/engines/worldgen/bridgeAccess';
import { worldRuntimeKey, worldgenScopeOperations, listWorldLinks, saveWorldLink } from '@/engines/worldgen/era';
import { prepareRegeneration, commitRegeneration, createWorldAlternative } from '@/engines/worldgen/recipe';
import { saveWorldJourney } from '@/engines/worldgen/journeyOperations';
import { saveJourneyCreativeDraft } from '@/engines/worldgen/journeyCreative';
import { resolveWorldgenRoute } from '@/engines/worldgen/navigation';
import { saveWorldEra, readWorldDocument, listEraRows } from '@/services/worldEras/store';
import { exportProjectData, importProjectData } from '@/db/operations';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { useWorldWaypoints } from '@/engines/worldgen/hooks';
import WaypointsPanel from '@/engines/worldgen/components/WaypointsPanel';
import { useLocaleStore } from '@/stores/localeStore';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const P = 'synthetic-era-worldgen', A = { projectId: P, eraId: 'past' }, B = { projectId: P, eraId: 'future' };
const params = { ...DEFAULT_PARAMS, width: 128, seed: 'contextual-planets', erosion: 0 };
const world: GeneratedWorld = { id: 'logical-world', projectId: P, title: 'Shared planet', params, edits: serializeEdits([]), createdAt: 1, updatedAt: 1 };
const pin: WorldWaypoint = { id: 'logical-waypoint', worldId: world.id, projectId: P, name: 'Shared harbour', color: '#c4973b', u: .4, v: .5, createdAt: 1, updatedAt: 1 };
async function setup() {
  useLocaleStore.setState({ locale: 'en' });
  await db.projects.put({ id: P, title: 'Contextual planets', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen', 'notes'], createdAt: 1, updatedAt: 1 } satisfies Project);
  await db.generatedWorlds.put(world); await db.worldWaypoints.put(pin);
  for (const scope of [A, B]) await saveWorldEra(P, { id: scope.eraId, name: scope.eraId, description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
}
async function cleanup(owner = P) { for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(owner).delete(); await db.projects.delete(owner); }
export async function testWorldEraWorldgen(): Promise<string[]> {
  let clone: string | undefined;
  try {
    await setup();
    const data = generateWorld(params);
    for (const scope of [A, B]) await saveSnapshot(worldRuntimeKey(world.id, scope.eraId), paramsKey(params), data);
    await applyWorldEdits(world, [{ kind: 'label', x: 10, y: 10, text: 'Ancient coast', style: 'note' }], A.eraId);
    const own = (await worldgenScopeOperations(A).worlds.getOne(world.id))!;
    const openedA = await openWorldForReading(own, 'places', A.eraId), openedB = await openWorldForReading(world, 'places', B.eraId);
    assert(openedA.ok && openedB.ok && openedA.world.data !== openedB.world.data && (await db.generatedWorlds.get(world.id))?.edits === world.edits, 'Terrain buffers or edits leaked across eras');
    let handledA = 0, handledB = 0;
    const offA = registerLiveWorld(worldRuntimeKey(world.id, A.eraId), { snapshot: () => own.edits!, apply: () => { handledA++; } });
    const offB = registerLiveWorld(worldRuntimeKey(world.id, B.eraId), { snapshot: () => world.edits!, apply: () => { handledB++; } });
    await applyWorldEdits(own, [{ kind: 'label', x: 20, y: 20, text: 'Live only A', style: 'note' }], A.eraId);
    assert(handledA === 1 && handledB === 0 && !liveWorld(world.id), 'Live writer identity leaked'); offA(); offB();
    await saveWorldJourney(world.id, P, { id: 'trip', name: 'Ancient crossing', stops: [{ key: 'a', name: 'A', u: .1, v: .2 }, { key: 'b', name: 'B', u: .4, v: .5 }], options: { mode: 'foot', season: 'summer' }, recipeKey: 'synthetic', createdAt: 1, updatedAt: 1 }, A.eraId);
    await saveWorldLink(A, world.id, { id: 'era-link', projectId: P, sourceEngineId: 'worldgen', sourceEntityType: 'world-spatial', sourceEntityId: `${world.id}::settlement:10,10`, sourceTitle: 'A', targetEngineId: 'worldgen', targetEntityType: 'generated-world', targetEntityId: world.id, targetTitle: world.title, relation: 'represents', provenance: 'manual', createdAt: 1, updatedAt: 1 });
    const current = (await worldgenScopeOperations(A).worlds.getOne(world.id))!;
    const draft = { id: 'journey-note', target: 'note' as const, title: 'Night by the coast', text: 'Ancient voyage prose', location: 'Coast', context: { stops: ['A', 'B'], mode: 'foot', season: 'summer', km: 20, hours: 5 } };
    await saveJourneyCreativeDraft(current, draft, A.eraId);
    await saveJourneyCreativeDraft(current, { ...draft, id: 'era-journey-scene', target: 'scene' }, A.eraId);
    assert((await listEraRows(A, 'scenes')).length === 1 && !await db.scenes.get('era-journey-scene') && !await db.notes.get(draft.id) && (await listEraRows(A, 'notes')).length === 1, 'Creative capture wrote shared Base');
    const plan = await prepareRegeneration(world.id, { ...params, seed: 'past-new' }, 'clear', A);
    await commitRegeneration(plan);
    assert(!(await worldgenScopeOperations(A).waypoints.getAll(world.id)).length && (await db.worldWaypoints.get(pin.id))?.name === pin.name && (await worldgenScopeOperations(B).worlds.getOne(world.id))?.params.seed === params.seed, 'Regeneration removed shared locations or changed sibling');
    const alternative = await createWorldAlternative(world.id, params, 'Past alternative', A);
    assert(!await db.generatedWorlds.get(alternative.id) && (await resolveWorldgenRoute(P, alternative.id, A.eraId))?.includes('era=past'), 'Alternative escaped era/navigation');
    const label = await runBridgeTool('wh_add_label', { ...A, worldId: world.id, x: 11, y: 12, text: 'MCP coast' }); assert(label.ok, JSON.stringify(label));
    const waypoint = await runBridgeTool('wh_add_waypoint', { ...A, worldId: world.id, name: 'MCP harbour', u: .3, v: .4 }); assert(waypoint.ok, JSON.stringify(waypoint));
    assert((await db.generatedWorlds.get(world.id))?.params.seed === params.seed && (await db.worldWaypoints.where('worldId').equals(world.id).count()) === 1 && (await listWorldLinks(B, world.id)).length === 0, 'MCP/local links escaped era');
    clone = await importProjectData(await exportProjectData(P));
    const clonedProject = (await db.projects.get(clone))!, clonedScope = { projectId: clone, eraId: clonedProject.worldEras![0].id };
    const clonedWorld = (await worldgenScopeOperations(clonedScope).worlds.getAll(clone)).find(row => row.title === world.title)!;
    const links = await listWorldLinks(clonedScope, clonedWorld.id);
    assert(links.find(row => row.id === 'era-link')?.sourceEntityId.startsWith(`${clonedWorld.id}::`) && links[0].targetEntityId === clonedWorld.id && links[0].projectId === clone && clonedWorld.journeys?.[0].name === 'Ancient crossing', 'Clone broke logical world links/journeys');
    return ['Contextual terrain caches and live writers use era+logical ID with distinct mutable buffers', 'World recipes, regeneration/location clearing, alternatives, journeys, links and creative notes stay local; journey scenes and notes retain source links', 'Registered Worldgen edits/waypoints and normal JSON clone preserve Base, sibling and semantic link identities'];
  } finally { await cleanup(); if (clone) await cleanup(clone); for (const scope of [A, B]) await db.worldSnapshots.delete(worldRuntimeKey(world.id, scope.eraId)); }
}
export async function testWorldEraWorldgenUi(): Promise<string[]> {
  await setup(); const root = createRoot(document.getElementById('root')!);
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  function WaypointEditor() { const api = useWorldWaypoints(world.id), [selected, select] = useState(pin.id); return <WaypointsPanel waypoints={api.items} selectedId={selected} selected={api.items.find(row => row.id === selected) ?? null} onSelect={id => select(id ?? '')} onEdit={api.editItem} onDelete={api.removeItem} onTogglePlacing={() => {}} onFlyTo={() => {}} placing={false} disabled={false} />; }
  try {
    await act(async () => { root.render(<main>{[A, B].map(scope => <EnginePaneContext.Provider key={scope.eraId} value={{ instanceId: scope.eraId, projectId: P, eraId: scope.eraId, visible: true }}><section data-era={scope.eraId}><WaypointEditor /></section></EnginePaneContext.Provider>)}</main>); await pause(); });
    await act(async () => { await pause(); });
    const field = document.querySelector<HTMLInputElement>('[data-era="past"] input')!; assert(field, 'Waypoint editor did not load');
    await act(async () => { field.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Ancient harbour'); field.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
    await act(async () => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await pause(); });
    for (let attempt = 0; attempt < 30 && (await worldgenScopeOperations(A).waypoints.getOne(pin.id))?.name !== 'Ancient harbour'; attempt++) await act(async () => { await pause(); });
    assert((await worldgenScopeOperations(A).waypoints.getOne(pin.id))?.name === 'Ancient harbour' && document.querySelector<HTMLInputElement>('[data-era="future"] input')?.value === pin.name && (await db.worldWaypoints.get(pin.id))?.name === pin.name, `Normal waypoint form escaped pane: ${JSON.stringify({ own: await worldgenScopeOperations(A).waypoints.getOne(pin.id), sibling: document.querySelector<HTMLInputElement>('[data-era="future"] input')?.value, base: await db.worldWaypoints.get(pin.id) })}`);
    return ['Two normal WaypointsPanel editors and real hooks save one logical waypoint in separate eras without changing Base'];
  } finally { await act(async () => root.unmount()); await cleanup(); }
}
