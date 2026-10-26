import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { applyWorldPreset, WORLD_PRESETS } from '@/engines/worldgen/core/presets';
import { getGeography } from '@/engines/worldgen/cartography/texture';
import { editKey, serializeEdits } from '@/engines/worldgen/core/edits';
import { landmarkKey } from '@/engines/worldgen/core/spatialEntities';
import { openWorldForReading } from '@/engines/worldgen/bridgeAccess';
import { planRoute, normalizeTravelProfile, effectiveHoursPerDay, type TravelMode, type Season } from '@/engines/worldgen/core/travel';
import { clockText } from '@/engines/worldgen/core/routeWords';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { worldgenScopeOperations, worldRuntimeKey } from '@/engines/worldgen/era';
import { saveWorldEra } from '@/services/worldEras/store';
import { getUndoJournal } from '@/services/undoJournal';
import type { GeneratedWorld } from '@/engines/worldgen/types';

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const P = 'qa-native-directions', W = `${P}-world`, S = `${P}-sibling`, C = `${P}-control`, CW = `${C}-world`, E = 'past';
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function until(test: () => unknown, message: string) { for (let i = 0; i < 8000; i++) { if (await test()) return; await pause(); } throw Error(message); }
async function snapshot() {
  return { project: await db.projects.get(P), control: await db.projects.get(C), world: await db.generatedWorlds.get(W), sibling: await db.generatedWorlds.get(S), controlWorld: await db.generatedWorlds.get(CW), variants: await db.worldEraVariants.where('projectId').equals(P).sortBy('id'), history: await db.documentHistory.where('projectId').anyOf([P, C]).sortBy('id'), links: await db.entityLinks.where('projectId').anyOf([P, C]).sortBy('id'), journal: structuredClone(getUndoJournal()) };
}
interface PlanCase { eraId?: string; selectedEnd: 'from' | 'to'; mode: TravelMode; season: Season; setOffHour: number }

export async function testWorldPlaceDirectionsNative(): Promise<string[]> {
  check(await db.projects.count() === 0 && await db.generatedWorlds.count() === 0, 'Native Directions profile must begin empty');
  const world = generateWorld(applyWorldPreset({ ...DEFAULT_PARAMS, width: 512, seed: 'carto-quality-continents' }, WORLD_PRESETS.find(row => row.id === 'continents')!));
  const geography = getGeography(world), town = geography.settlements.find(row => row.rank === 'capital'); check(town, 'Native fixture needs actual generated capital');
  const dx = [1, -1].find(value => world.elevation[Math.floor(town.y) * world.width + ((Math.floor(town.x + value) + world.width) % world.width)] > 0); check(dx !== undefined, 'Native fixture needs adjacent land');
  const faroKey = editKey('settlement', town.x, town.y), source = { type: 'cave' as const, x: town.x + 2, y: town.y }, torreKey = landmarkKey(source), torre = { x: town.x + dx, y: town.y };
  const now = 1, project = { id: P, title: 'Own Native Directions', description: '', mode: 'custom' as const, type: 'standalone' as const, color: '#888888', status: 'draft' as const, enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: now, updatedAt: now };
  let closed = false;
  const cacheIds = [W, S, CW, worldRuntimeKey(W, E)];
  const cleanup = async () => {
    if (!closed) { await deleteProject(P); await deleteProject(C); for (const id of cacheIds) { await db.worldSnapshots.delete(id); await db.canonTiles.where('worldId').equals(id).delete(); await db.renderedTiles.where('worldId').equals(id).delete(); } closed = true; }
    return { projects: await db.projects.count(), worlds: await db.generatedWorlds.count(), variants: await db.worldEraVariants.count(), history: await db.documentHistory.count(), links: await db.entityLinks.count(), ownedSnapshots: await db.worldSnapshots.where('worldId').anyOf(cacheIds).count(), journalEntries: getUndoJournal().length };
  };
  try {
    await db.projects.add(project); await db.projects.add({ ...project, id: C, title: 'Untouched Native Directions control' });
    const edits = [{ kind: 'rename' as const, target: 'settlement' as const, key: faroKey, name: 'Faro Native' }, { kind: 'marker' as const, marker: 'landmark' as const, landmark: source.type, x: source.x, y: source.y }, { kind: 'rename' as const, target: 'landmark' as const, key: torreKey, name: 'Torre Native' }, { kind: 'move' as const, target: 'landmark' as const, key: torreKey, x: torre.x, y: torre.y }, { kind: 'lock' as const, target: 'landmark' as const, key: torreKey, locked: true }];
    const row: GeneratedWorld = { id: W, projectId: P, title: 'Native Directions world', params: world.params, edits: serializeEdits(edits), createdAt: now, updatedAt: now };
    await db.generatedWorlds.add(row); await db.generatedWorlds.add({ ...row, id: S, title: 'Untouched Directions sibling', edits: '[]' }); await db.generatedWorlds.add({ ...row, id: CW, projectId: C, title: 'Untouched Directions control world', edits: '[]' });
    await saveSnapshot(W, paramsKey(world.params), world); await saveSnapshot(worldRuntimeKey(W, E), paramsKey(world.params), world);
    await saveWorldEra(P, { id: E, name: 'Past Native Directions', description: '', revision: 0, createdAt: now, updatedAt: now }, null);
    await worldgenScopeOperations({ projectId: P, eraId: E }).worlds.update(W, { edits: serializeEdits([...edits, { kind: 'rename', target: 'settlement', key: faroKey, name: 'Faro antiguo' }, { kind: 'rename', target: 'landmark', key: torreKey, name: 'Torre antigua' }]), travelPace: 'easy', travelProfile: { speed: { horse: 1.25 } }, travelRevision: 1 });
    const readable = async (eraId?: string) => {
      const record = (await worldgenScopeOperations({ projectId: P, eraId }).worlds.getOne(W))!;
      const opened = await openWorldForReading(record, 'full', eraId); check(opened.ok, `Prepared snapshot not readable: ${JSON.stringify(opened)}`);
      return { record, ...opened.world };
    };
    // Normal reader/cache preparation before readonly baseline; never invoke the tested tool directly.
    await readable(); await readable(E);
    const expected = async (plan: PlanCase) => {
      const current = await readable(plan.eraId), faro = current.atlas.byKey.get(faroKey)!, tower = current.atlas.byKey.get(torreKey)!; check(faro && tower, 'Current normal Atlas lost Faro or Torre');
      check(tower.x === torre.x && tower.y === torre.y, 'Oracle Atlas ignored landmark move');
      const ordered = plan.selectedEnd === 'from' ? [tower, faro] : [faro, tower], profile = normalizeTravelProfile(current.record.travelProfile);
      const options = { mode: plan.mode, season: plan.season, ...(current.record.travelPace ? { pace: current.record.travelPace } : {}), ...(Object.keys(profile).length ? { profile } : {}) };
      const route = planRoute(current.data, current.geo, ordered[0], ordered[1], options, 'en'); check(!route.impossible && route.cells.length > 1, `Real planner fixture is not traversable: ${route.impossible}`);
      const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
      const cell = (value: number) => ({ x: value % current.data.width, y: Math.floor(value / current.data.width) });
      return { stops: ordered.map(row => row.name), mode: plan.mode, season: plan.season, pace: current.record.travelPace ?? 'steady', km: round(route.km), directKm: round(route.directKm), hours: round(route.hours), days: round(route.days, 2), hoursPerDay: round(effectiveHoursPerDay(options), 2), setOff: clockText(plan.setOffHour), first: cell(route.cells[0]), last: cell(route.cells.at(-1)!), resolved: ordered.map(row => ({ x: row.x, y: row.y })), selectedEnd: plan.selectedEnd };
    };
    const cache = async () => {
      const rows = await db.worldSnapshots.where('worldId').anyOf(cacheIds).toArray();
      return Promise.all(rows.map(async row => ({ worldId: row.worldId, key: row.key, version: row.version, savedAt: row.savedAt, bytes: row.bytes.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(row.bytes).buffer))].map(value => value.toString(16).padStart(2, '0')).join('') })));
    };
    Reflect.set(window, '__directionsNativeSnapshot', snapshot); Reflect.set(window, '__directionsNativeExpected', expected); Reflect.set(window, '__directionsNativeCache', cache); Reflect.set(window, '__directionsNativeCleanup', cleanup);
    Reflect.set(window, '__directionsNativeReady', { projectId: P, worldId: W, siblingId: S, controlId: C, controlWorldId: CW, eraId: E, faroKey, torreKey, sourceTorre: { x: source.x, y: source.y }, resolvedTorre: torre, fixture: 'actual generated world and normal Atlas/reader; moved and locked landmark', uiSemantics: { from: 'Torre → Faro', to: 'Faro → Torre' } });
    await until(() => Reflect.get(window, '__directionsNativeComplete') !== undefined, 'Native Directions driver did not complete');
    const result = Reflect.get(window, '__directionsNativeComplete') as { ok: boolean; error?: string }; check(result.ok, result.error ?? 'Native Directions driver failed'); check(closed, 'Driver did not clean owned Native Directions fixtures');
    return ['two real stdio keys → authenticated private Mainbridge HTTP → Native executor/IPC/renderer wh_plan_journey; Base/past and both explicit UI endpoint orders match real planner; readonly business data and cleanup0'];
  } finally { await cleanup(); }
}
