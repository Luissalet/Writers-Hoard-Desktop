import '@/services/aiBridge/dispatch';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import WorldView from '@/engines/worldgen/components/WorldView';
import { serializeEdits, editKey } from '@/engines/worldgen/core/edits';
import { landmarkKey } from '@/engines/worldgen/core/spatialEntities';
import { settlementCellCenter } from '@/engines/worldgen/core/settlements';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import { worldgenScopeOperations, worldRuntimeKey } from '@/engines/worldgen/era';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveWorldTravelSettings } from '@/engines/worldgen/journeyOperations';
import { saveWorldEra } from '@/services/worldEras/store';
import { getUndoJournal } from '@/services/undoJournal';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { t } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/stores/localeStore';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { applyWorldPreset, WORLD_PRESETS } from '@/engines/worldgen/core/presets';
import { getGeography } from '@/engines/worldgen/cartography/texture';
import { deleteProject } from '@/db/operations';
import { JourneyWorkerFixture } from './journeyWorkerFixture';

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => unknown, message: string, diagnose?: () => unknown) { for (let i = 0; i < 320; i++) { if (await test()) return; await act(async () => { await pause(); }); } throw Error(message + (diagnose ? `\nDIAGNOSTIC ${JSON.stringify(diagnose())}` : '')); }
async function click(node: HTMLElement | undefined | null) { check(node, 'Missing normal UI control'); await act(async () => { node.click(); await pause(); }); }
async function field(node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  check(node, 'Missing normal field');
  await act(async () => { const proto = node instanceof HTMLInputElement ? HTMLInputElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); });
}
/** Only Journey's URL is replaced; all other real WorldView workers keep their normal transport. */
function journeyTransport() {
  const original = globalThis.Worker;
  JourneyWorkerFixture.instances = []; JourneyWorkerFixture.automatic = true;
  globalThis.Worker = new Proxy(original, { construct(target, args) { return String(args[0]).includes('/journey.worker.ts') ? new JourneyWorkerFixture() : Reflect.construct(target, args); } });
  return () => { globalThis.Worker = original; JourneyWorkerFixture.instances = []; JourneyWorkerFixture.automatic = true; };
}

/** Same actual generated-snapshot pattern as placeIconFixture; independent of unrelated exported test code. */
async function directionsFixture() {
  const projectId = `qa-directions-${crypto.randomUUID()}`, worldId = `${projectId}-world`, now = Date.now();
  const world = generateWorld(applyWorldPreset({ ...DEFAULT_PARAMS, width: 512, seed: 'carto-quality-continents' }, WORLD_PRESETS.find(row => row.id === 'continents')!));
  const geography = getGeography(world), town = geography.settlements.find(row => row.rank === 'capital'); check(town, 'Fixture needs real generated capital');
  await db.projects.add({ id: projectId, title: 'Own Directions QA', mode: 'novelist', type: 'standalone', color: '#34493e', description: '', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: now, updatedAt: now });
  await db.generatedWorlds.add({ id: worldId, projectId, title: 'Own Directions world', params: world.params, createdAt: now, updatedAt: now });
  await saveSnapshot(worldId, paramsKey(world.params), world);
  return { projectId, worldId, world, town, key: editKey('settlement', town.x, town.y), cleanup: () => deleteProject(projectId) };
}

async function runDirections(eraId?: string): Promise<string[]> {
  const f = await directionsFixture(), restoreWorker = journeyTransport(), scope = { projectId: f.projectId, eraId };
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;overflow:auto;width:1280px;height:800px'; document.body.append(host);
  let root = createRoot(host); const otherId = `${f.worldId}-sibling`;
  useLocaleStore.setState({ locale: 'en', loaded: true });
  const source = { type: 'cave' as const, x: f.town.x + 2, y: f.town.y }, towerKey = landmarkKey(source);
  const dx = [1, -1].find(value => f.world.elevation[Math.floor(f.town.y) * f.world.width + ((Math.floor(f.town.x + value) + f.world.width) % f.world.width)] > 0);
  check(dx !== undefined, 'Fixture needs adjacent land beside its real capital');
  const torre = { name: 'QA Directions Torre', x: f.town.x + dx, y: f.town.y }, faro = { name: 'QA Directions Faro', x: f.town.x, y: f.town.y };
  let record!: GeneratedWorld;
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.trim() === label);
  const labelled = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const paint = () => root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: 'qa-directions', projectId: f.projectId, eraId, visible: true }}><WorldView projectId={f.projectId} world={record} onCreateAlternative={async () => { throw Error('Directions regenerated the world'); }} onRefreshWorld={refresh} onSaveEdits={async () => { throw Error('Directions saved a map edit'); }} onSaveRegions={() => { throw Error('Directions saved a region'); }} onThumbnail={() => {}} focusWaypoint={null} /></EnginePaneContext.Provider></MemoryRouter>);
  // The product awaits this ordinary refresh. It must not open another act() inside the event's act().
  const refresh = async () => { record = (await worldgenScopeOperations(scope).worlds.getOne(f.worldId))!; paint(); };
  const render = async () => { await act(async () => { await refresh(); await pause(); }); };
  const stored = async () => JSON.stringify({ world: await db.generatedWorlds.get(f.worldId), sibling: await db.generatedWorlds.get(otherId), project: await db.projects.get(f.projectId), variants: await db.worldEraVariants.where('projectId').equals(f.projectId).sortBy('id'), history: await db.documentHistory.where('projectId').equals(f.projectId).sortBy('id'), journal: getUndoJournal() });
  const endpoints = () => ({ from: [...host.querySelectorAll('button')].find(node => node.firstElementChild?.textContent === t('worldgen.journey.from')), to: [...host.querySelectorAll('button')].find(node => node.firstElementChild?.textContent === t('worldgen.journey.to')) });
  const inspect = async (name: string) => {
    await click(button(t('worldgen.panel.atlas')));
    await until(() => host.querySelector(`input[placeholder="${t('worldgen.atlas.searchPlaceholder')}"]`), 'WorldView Index did not become ready');
    await field(host.querySelector<HTMLInputElement>(`input[placeholder="${t('worldgen.atlas.searchPlaceholder')}"]`)!, name);
    await until(() => [...host.querySelectorAll('button')].some(node => node.firstElementChild?.textContent === name), `Actual Atlas missing ${name}`);
    await click([...host.querySelectorAll('button')].find(node => node.firstElementChild?.textContent === name));
    await click(host.querySelector<HTMLElement>('[data-testid="atlas-inspect-place"]'));
    await until(() => labelled(t('worldgen.place.nameLabel'))?.value === name, 'Atlas action did not reach actual WorldView inspector');
  };
  const start = async (name: string, destination: boolean) => {
    await inspect(name); await click(button('2D'));
    await click(button(destination ? 'Directions to here' : 'Travel from here'));
    await until(() => endpoints().from && endpoints().to, 'Context action did not open actual JourneyPanel');
    const ends = endpoints(), filled = destination ? ends.to! : ends.from!, empty = destination ? ends.from! : ends.to!;
    check(filled.textContent?.includes(name) && empty.textContent?.includes(t('worldgen.journey.choose')), 'Context action anchored the wrong endpoint or retained its old peer');
    check(empty.className.includes('border-amber-400/70') && !host.querySelector('[data-testid="journey-via-list"]') && !host.querySelector('[data-testid="journey-playback"]'), 'Old route/via/playback survived explicit route reset or opposite picker is not active');
    check(!labelled(t('worldgen.journey.name')), 'Incomplete context route exposed Save itinerary');
  };
  const inputTrace: unknown[] = [], pointerEvent = (event: Event) => { const pointer = event as PointerEvent; inputTrace.push({ type: event.type, trusted: event.isTrusted, target: (event.target as Element)?.tagName, x: pointer.clientX, y: pointer.clientY, button: pointer.button, pointerId: pointer.pointerId }); if (inputTrace.length > 16) inputTrace.shift(); };
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) document.addEventListener(type, pointerEvent, true);
  let pointerPlan: unknown;
  const diagnose = () => ({ endpointFrom: endpoints().from?.textContent, endpointTo: endpoints().to?.textContent, fromActive: endpoints().from?.className, toActive: endpoints().to?.className, inputTrace, pointerPlan, hover: host.querySelector('[data-testid="worldgen-hover-tip"]')?.textContent, workers: JourneyWorkerFixture.instances.map(worker => ({ terminated: worker.terminated, job: worker.job?.type === 'route' ? { type: worker.job.type, from: worker.job.from, to: worker.job.to, stopNames: worker.job.stopNames, options: worker.job.options } : worker.job?.type })), alerts: [...host.querySelectorAll('[role="alert"]')].map(node => node.textContent), playback: host.querySelector('[data-testid="journey-playback"]')?.textContent });
  let inputSequence = 0;
  const native = async (events: unknown[]) => { const channel = window as unknown as { __native?: unknown; __nativeAck?: number }; const n = ++inputSequence; await act(async () => { channel.__native = { n, events }; await until(() => channel.__nativeAck === n, 'Existing native input handshake missing'); }); };
  const mapClick = async (origin: { x: number; y: number; name?: string }, selected: { x: number; y: number }) => {
    const canvas = [...host.querySelectorAll('canvas')].filter(node => node.getBoundingClientRect().width > 300 && node.getBoundingClientRect().height > 180).sort((a, b) => b.width * b.height - a.width * a.height)[0]; check(canvas, 'Actual 2D map canvas missing');
    canvas.scrollIntoView({ block: 'center', behavior: 'instant' }); await act(async () => { await pause(100); });
    const bounds = canvas.getBoundingClientRect(), pxPerCell = bounds.width * 40075 / (400 * f.world.width);
    // The real inspector 2D action centers selected at a 400 km span; equirectangular canvas geometry, not a private setter.
    const centre = settlementCellCenter(origin);
    const x = Math.round(bounds.left + bounds.width / 2 + (centre.x - selected.x) * pxPerCell), y = Math.round(bounds.top + bounds.height / 2 + (centre.y - selected.y) * pxPerCell);
    check(x > bounds.left && x < bounds.right && y > Math.max(0, bounds.top) && y < Math.min(innerHeight, bounds.bottom), 'Fixture map click falls outside visible 400 km frame');
    pointerPlan = { origin, selected, x, y, pxPerCell, canvas: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, domAtPointer: document.elementFromPoint(x, y)?.tagName };
    check(document.elementFromPoint(x, y) === canvas, 'Normal map endpoint pointer is occluded');
    let clickX = x;
    if (origin.name === faro.name) {
      let moves = 0;
      await until(async () => {
        // A repeated identical CDP coordinate may emit no move. One-pixel alternation only delivers the same target; never searches for another target.
        clickX = x + moves++ % 2;
        await native([{ type: 'mouseMove', x: clickX, y }]);
        return host.querySelector('[data-testid="worldgen-hover-tip"]')?.textContent?.includes(faro.name);
      }, 'Normal map never hovered named Faro before settlement click', diagnose);
    }
    await native([{ type: 'mouseMove', x: clickX, y }, { type: 'mouseDown', x: clickX, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: clickX, y, button: 'left', clickCount: 1 }]);
  };
  const currentJob = () => { const job = JourneyWorkerFixture.instances.filter(worker => worker.job?.type === 'route').at(-1)?.job; return job?.type === 'route' ? job : undefined; };
  try {
    await db.generatedWorlds.update(f.worldId, { edits: serializeEdits([{ kind: 'rename', target: 'settlement', key: f.key, name: faro.name }, { kind: 'marker', marker: 'landmark', landmark: source.type, x: source.x, y: source.y }, { kind: 'rename', target: 'landmark', key: towerKey, name: torre.name }, { kind: 'move', target: 'landmark', key: towerKey, x: torre.x, y: torre.y }, { kind: 'lock', target: 'landmark', key: towerKey, locked: true }]) });
    await db.generatedWorlds.add({ ...(await db.generatedWorlds.get(f.worldId))!, id: otherId, title: 'Untouched directions sibling', edits: '[]' });
    if (eraId) { await saveWorldEra(f.projectId, { id: eraId, name: 'Directions era', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null); await saveSnapshot(worldRuntimeKey(f.worldId, eraId), paramsKey(f.world.params), f.world); }
    await render(); await inspect(torre.name);
    // FIRST causal RED must be this assertion after the real Atlas→WorldView→Inspector entry; no product stub.
    check(button('Travel from here') && button('Directions to here'), 'Selected real WorldView inspector lacks Travel from here / Directions to here actions');
    const before = await stored();
    await start(torre.name, true); check(await stored() === before, 'Opening contextual destination wrote world/era/history/journal');
    await mapClick(faro, torre);
    await until(() => endpoints().from?.textContent?.includes(faro.name) && host.querySelector('[data-testid="journey-playback"]'), 'Normal settlement click did not complete Faro→Torre', diagnose);
    check(!endpoints().to!.className.includes('border-amber-400/70'), 'Preselected destination still awaits a redundant third click');
    check(currentJob()?.type === 'route' && currentJob()!.stopNames?.join() === `${faro.name},${torre.name}`, 'Planner received wrong ordered endpoint identities');
    check(currentJob()!.to.x === torre.x && currentJob()!.to.y === torre.y, 'Landmark used source coordinates instead of its resolved move');
    await click(button(t('worldgen.travel.mode.horse'))); await click(button(t('worldgen.travel.season.winter')));
    await click(button(t('worldgen.journey.settings') + ' ▾')); await field(labelled(t('worldgen.journey.setOff')), '9');
    await until(() => currentJob()?.options.mode === 'horse' && currentJob()?.options.season === 'winter', 'Normal travel choices did not reach planner');
    await start(faro.name, true); check(await stored() === before, 'Context reset saved hidden settings or changed saved routes');
    // Clicking open ground beside selected Faro must become the origin, then finish picking.
    const ground = { x: torre.x, y: torre.y };
    await mapClick(ground, faro);
    await until(() => !!host.querySelector('[data-testid="journey-playback"]'), 'Normal open-ground click did not finish destination-anchored route');
    await click(button(t('worldgen.journey.settings') + ' ▾'));
    check(currentJob()?.options.mode === 'horse' && currentJob()?.options.season === 'winter' && labelled(t('worldgen.journey.setOff'))?.value === '9', 'Inspector navigation lost temporary travel choices');
    await start(torre.name, false); await mapClick(faro, torre);
    await until(() => endpoints().to?.textContent?.includes(faro.name) && !!host.querySelector('[data-testid="journey-playback"]'), 'Normal settlement click did not complete Torre→Faro');
    check(currentJob()!.stopNames?.join() === `${torre.name},${faro.name}`, 'From action reversed ordered stops');
    await act(async () => { await saveWorldTravelSettings(scope, f.worldId, { factors: [{ table: 'speed', key: 'horse', value: 1.25 }] }); }); await render();
    await until(() => currentJob()?.options.profile?.speed?.horse === 1.25, 'Retained UI selection masked external travelRevision/profile adoption');
    const planned = currentJob()!;
    const mcp = await runBridgeTool('wh_plan_journey', { projectId: f.projectId, eraId, worldId: f.worldId, stops: [{ place: towerKey }, { place: f.key }], mode: 'horse', season: 'winter', setOffHour: 9, locale: 'en' });
    check(mcp.ok, `Existing ordered-stops MCP failed: ${JSON.stringify(mcp)}`);
    const result = mcp.result as { stops: string[]; path: { x: number; y: number }[]; mode: string; season: string };
    check(result.stops.join() === planned.stopNames!.join() && result.mode === planned.options.mode && result.season === planned.options.season, 'UI and registered MCP disagree on selected endpoint order/options');
    check(result.path[0].x === Math.round(planned.from.x) && result.path.at(-1)!.x === Math.round(planned.to.x), 'MCP path endpoints differ from UI current selected places');
    await field(labelled(t('worldgen.journey.name')), 'Context route saved normally');
    const form = labelled(t('worldgen.journey.name')).form!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await pause(); });
    await until(async () => (await worldgenScopeOperations(scope).worlds.getOne(f.worldId))?.journeys?.some(row => row.name === 'Context route saved normally'), 'Normal Save itinerary did not persist contextual route');
    const saved = (await worldgenScopeOperations(scope).worlds.getOne(f.worldId))!.journeys!.filter(row => row.name === 'Context route saved normally');
    check(saved.length === 1 && saved[0].stops.map(stop => stop.name).join() === `${torre.name},${faro.name}` && saved[0].options.mode === 'horse' && saved[0].options.season === 'winter' && saved[0].options.setOffHour === 9, 'Normal save lost ordered stops/options or duplicated itinerary');
    await until(() => labelled(t('worldgen.journey.name'))?.value === '' && !labelled(t('worldgen.journey.name')).disabled, 'Normal Save itinerary has not finished refreshing its UI');
    await act(async () => { root.unmount(); await pause(); }); root = createRoot(host); await render();
    await until(() => !!button(t('worldgen.journey.title')), 'Reopened WorldView has not mounted the normal Journey tab');
    await click(button(t('worldgen.journey.title')));
    await until(() => host.querySelector(`select[aria-label="${t('worldgen.journey.openSaved')}"]`), 'Reopened actual WorldView Journey panel missing saved selector');
    await field(host.querySelector<HTMLSelectElement>(`select[aria-label="${t('worldgen.journey.openSaved')}"]`)!, saved[0].id);
    await until(() => currentJob()?.stopNames?.join() === `${torre.name},${faro.name}` && !!host.querySelector('[data-testid="journey-playback"]'), 'Normal saved selector failed to restore contextual endpoint order');
    check(currentJob()!.options.mode === 'horse' && currentJob()!.options.season === 'winter', 'Normal remount/reopen lost contextual route options');
    if (eraId) check(!(await db.generatedWorlds.get(f.worldId))!.journeys?.length, 'Era contextual itinerary escaped to Base');
    check((await db.generatedWorlds.get(otherId))!.title === 'Untouched directions sibling' && !(await db.generatedWorlds.get(otherId))!.journeys?.length, 'Context route changed sibling world');
    return ['Real Atlas→WorldView Inspector exposes explicit origin/destination actions; action is read-only', 'Normal native map settlement/ground picks complete ordered anchored routes; resolved landmark coordinates and locks preserved', 'Temporary mode/season/set-off survive Inspector navigation; external world profile revision still adopts', 'Registered ordered-stops MCP and normal explicit itinerary save agree; one save, correct scope and untouched sibling'];
  } finally { await act(async () => { root.unmount(); await pause(); }); host.remove(); for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) document.removeEventListener(type, pointerEvent, true); restoreWorker(); if (eraId) { const runtime = worldRuntimeKey(f.worldId, eraId); await db.worldSnapshots.delete(runtime); await db.canonTiles.where('worldId').equals(runtime).delete(); await db.renderedTiles.where('worldId').equals(runtime).delete(); } await f.cleanup(); }
}
export async function testWorldPlaceDirections(): Promise<string[]> { return runDirections(); }
export async function testWorldPlaceDirectionsEra(): Promise<string[]> { return runDirections('past'); }
