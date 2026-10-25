import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project } from '@/types';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import WorldView from '@/engines/worldgen/components/WorldView';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { serializeEdits } from '@/engines/worldgen/core/edits';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import { flushPendingWrites } from '@/services/pendingWrites';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 30));
async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 20000;
  while (!check() && Date.now() < deadline) await act(async () => { await pause(); });
  assert(check(), message);
}
async function settle() {
  await act(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await pause();
  });
}

function mapCanvas(host: HTMLElement): HTMLCanvasElement | undefined {
  return [...host.querySelectorAll<HTMLCanvasElement>('canvas')]
    .filter(canvas => canvas.width > 200 && canvas.height > 200 && canvas.getBoundingClientRect().height > 200)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
}
function mapPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  // Sample the actual painted map, avoiding the edge and the HUD. The separate
  // sampler only downsizes its real raster; it never paints an expected wash.
  const sample = document.createElement('canvas');
  sample.width = 48; sample.height = 32;
  const context = sample.getContext('2d')!;
  context.drawImage(canvas, canvas.width * .15, canvas.height * .15, canvas.width * .7, canvas.height * .7, 0, 0, sample.width, sample.height);
  return context.getImageData(0, 0, sample.width, sample.height).data;
}
function meanChannels(pixels: Uint8ClampedArray) {
  const totals = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) totals[channel] += pixels[i + channel];
  return totals.map(total => total / (pixels.length / 4));
}

export async function testWorldPersistentHourSource(): Promise<string[]> {
  const projectId = `synthetic-hour-${crypto.randomUUID()}`, worldId = `${projectId}-world`;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;width:1100px;height:800px;overflow:auto';
  document.body.append(host);
  const root = createRoot(host), previousLocale = useLocaleStore.getState().locale;
  const params = { ...DEFAULT_PARAMS, width: 128, erosion: 0, seed: 'persistent-hour-source' };
  const generated = generateWorld(params);
  const row: GeneratedWorld = {
    id: worldId, projectId, title: 'Own persistent light', params: generated.params,
    edits: serializeEdits([]), createdAt: 1, updatedAt: 1,
  };
  const select = () => host.querySelector<HTMLSelectElement>('[data-testid="worldgen-map-hour"]');
  function WorldHarness({ initial }: { initial: GeneratedWorld }) {
    const [record, setRecord] = useState(initial);
    const refresh = async () => {
      const current = await db.generatedWorlds.get(worldId);
      assert(current, 'Own world vanished while refreshing'); setRecord(current);
    };
    return <MemoryRouter><EnginePaneContext.Provider value={{ instanceId: `${projectId}-pane`, projectId, visible: true, primary: true }}>
      <WorldView projectId={projectId} world={record}
        onCreateAlternative={async () => { throw new Error('The hour test must not regenerate its world'); }}
        onRefreshWorld={refresh}
        onSaveEdits={async edits => { await db.generatedWorlds.update(worldId, { edits }); await refresh(); }}
        onSaveRegions={async regions => { await db.generatedWorlds.update(worldId, { regions }); await refresh(); }}
        onThumbnail={async thumbnail => { await db.generatedWorlds.update(worldId, { thumbnail }); }}
        focusWaypoint={null} />
    </EnginePaneContext.Provider></MemoryRouter>;
  }
  async function show(current: GeneratedWorld) {
    await act(async () => { root.render(<WorldHarness initial={current} />); });
    await until(() => Boolean(select() && mapCanvas(host)), 'The real legacy WorldView did not load its map and lighting control');
    await settle();
  }
  try {
    useLocaleStore.setState({ locale: 'en', loaded: true });
    await db.projects.add({
      id: projectId, title: 'Own persistent lighting fixture', description: '', mode: 'custom', type: 'standalone',
      color: '#34493e', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1,
    } satisfies Project);
    await db.generatedWorlds.add(row);
    await saveSnapshot(worldRuntimeKey(worldId), paramsKey(generated.params), generated);
    assert(await db.worldSnapshots.get(worldRuntimeKey(worldId)), 'Real generated-world snapshot was not saved');
    await show((await db.generatedWorlds.get(worldId))!);
    assert(select()!.value === 'off', 'A legacy world did not start with the existing daylight choice');
    const daylight = mapPixels(mapCanvas(host)!);
    assert(meanChannels(daylight).some(channel => channel > 40), 'The positive legacy control has no real map pixels');
    const before = await db.generatedWorlds.get(worldId);
    assert(before && !Object.hasOwn(before, 'presentation') && !Object.hasOwn(before, 'presentationRevision'), 'Reading the legacy world wrote presentation defaults');
    console.log('HOUR_CONTROL legacy map visible, choice off, no presentation materialized', JSON.stringify({ mean: meanChannels(daylight) }));

    await act(async () => {
      select()!.value = 'night';
      select()!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(() => select()!.value === 'night', 'The normal Night selection did not update the real control');
    await settle();
    const night = mapPixels(mapCanvas(host)!), dayMean = meanChannels(daylight), nightMean = meanChannels(night);
    let changed = 0;
    for (let i = 0; i < night.length; i += 4) if (Math.abs(night[i] - daylight[i]) + Math.abs(night[i + 1] - daylight[i + 1]) + Math.abs(night[i + 2] - daylight[i + 2]) > 18) changed++;
    assert(changed > night.length / 4 * .5 && nightMean[0] < dayMean[0] * .8 && nightMean[2] / Math.max(1, nightMean[0]) > dayMean[2] / Math.max(1, dayMean[0]),
      `Night did not visibly darken and blue the actual map: ${JSON.stringify({ dayMean, nightMean, changed })}`);
    console.log('HOUR_CONTROL actual Night canvas changed', JSON.stringify({ dayMean, nightMean, changed, sampled: night.length / 4 }));

    // Use the existing normal pending-write close seam. It must await an
    // accepted selection; this does not replace or stub its persistence.
    assert((await flushPendingWrites()).ok, 'Normal close could not settle the accepted lighting selection');
    await act(async () => { root.render(null); });
    const reread = await db.generatedWorlds.get(worldId);
    assert(reread, 'The own world disappeared on close');
    await show(reread);
    console.log('HOUR_REOPEN', JSON.stringify({ value: select()!.value, savedPresentation: reread.presentation, revision: reread.presentationRevision ?? 0 }));
    assert(select()!.value === 'night', 'Accepted Night choice was lost after normal close, fresh database read and real WorldView remount');
    const reopened = meanChannels(mapPixels(mapCanvas(host)!));
    assert(reopened[0] < dayMean[0] * .8, 'Reopened Night choice no longer lights the real map at night');
    return ['Real WorldView legacy map and Night wash work; accepted lighting survives normal pending-write close, fresh read and remount'];
  } finally {
    await act(async () => { root.unmount(); }); host.remove();
    useLocaleStore.setState({ locale: previousLocale });
    await deleteProject(projectId);
  }
}


// Further causal coverage, added only after the byte-identical first GREEN.
import { StrictMode } from 'react';
import { normalizePresentationPatch, resolvePresentation, saveWorldPresentation, revertWorldPresentation } from '@/engines/worldgen/presentation';
import { worldgenScopeOperations } from '@/engines/worldgen/era';
import { saveWorldEra, resetEraDocument, restoreEraVersion, readWorldDocument } from '@/services/worldEras/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { previewProjectDuplicate, duplicateProject } from '@/services/projectDuplicate/service';
import { getPendingWritesSnapshot, retryFailedWrites, trackPendingWrite, discardPendingOwner } from '@/services/pendingWrites';
import { ToastHost } from '@/components/common/toast';

async function hourFixture(suffix: string, raster = false) {
  const projectId = `synthetic-hour-${suffix}-${crypto.randomUUID()}`, worldId = `${projectId}-world`;
  const params = { ...DEFAULT_PARAMS, width: 128, erosion: 0, seed: 'persistent-hour-matrix' };
  await db.projects.add({ id: projectId, title: 'Own hour fixture', description: '', mode: 'custom', type: 'standalone', color: '#34493e', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
  const world: GeneratedWorld = { id: worldId, projectId, title: 'Own hour world', params, edits: serializeEdits([]), createdAt: 1, updatedAt: 1 };
  await db.generatedWorlds.add(world);
  if (raster) { const data = generateWorld(params); world.params = data.params; await db.generatedWorlds.put(world); await saveSnapshot(worldRuntimeKey(worldId), paramsKey(data.params), data); }
  return { projectId, worldId, world, scope: { projectId }, read: () => db.generatedWorlds.get(worldId), cleanup: () => deleteProject(projectId) };
}
async function savePast(projectId: string) {
  await saveWorldEra(projectId, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
  return { projectId, eraId: 'past' };
}
function equal(actual: unknown, expected: unknown, message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify({ actual, expected })}`);
}

export async function testWorldPersistentHourCore(): Promise<string[]> {
  const f = await hourFixture('core');
  try {
    equal(resolvePresentation(undefined).mapHour, 'off', 'Legacy default');
    equal(resolvePresentation({ mapHour: 'broken', clouds: true } as never).mapHour, 'off', 'Corrupt hour fallback');
    assert(resolvePresentation({ mapHour: 'broken', clouds: true } as never).clouds, 'Damaged hour reset another field');
    for (const invalid of [null, false, 23, '23', '', '__proto__', 'Night']) {
      let rejected = false; try { normalizePresentationPatch({ mapHour: invalid }); } catch { rejected = true; }
      assert(rejected, `Invalid hour accepted: ${String(invalid)}`);
    }
    for (const mode of ['off', 'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night', 'journey'] as const) equal(normalizePresentationPatch({ mapHour: mode }), { mapHour: mode }, 'Named selection contract');
    const before = (await f.read())!;
    const first = await saveWorldPresentation(f.scope, f.worldId, { mapHour: 'night' }, 0);
    assert(first.revision === 1 && first.from === undefined, 'First hour receipt lost absence');
    const same = await saveWorldPresentation(f.scope, f.worldId, { mapHour: 'night' }, 1);
    assert(same.revision === 1, 'Identical hour created a revision');
    await saveWorldPresentation(f.scope, f.worldId, { clouds: true }, 1);
    await revertWorldPresentation(f.scope, f.worldId, first);
    let current = (await f.read())!;
    assert(!Object.hasOwn(current.presentation!, 'mapHour') && current.presentation!.clouds, 'Undo did not restore absence or discarded another field');
    const night = await saveWorldPresentation(f.scope, f.worldId, { mapHour: 'night' });
    await saveWorldPresentation(f.scope, f.worldId, { mapHour: 'dawn' });
    const kept = await revertWorldPresentation(f.scope, f.worldId, night);
    assert(kept.kept.includes('mapHour') && (await f.read())!.presentation!.mapHour === 'dawn', 'Undo overwrote a later hour');
    const era = await savePast(f.projectId);
    const inherited = await saveWorldPresentation(era, f.worldId, { mapHour: 'night' });
    assert(!inherited.scope?.eraId && await db.worldEraVariants.where('projectId').equals(f.projectId).count() === 0, 'Inherited selection forked the world');
    await worldgenScopeOperations(era).worlds.update(f.worldId, { title: 'Past own world' });
    const own = await saveWorldPresentation(era, f.worldId, { mapHour: 'dusk' });
    assert(own.scope?.eraId === 'past', 'Own variant wrote Base');
    await revertWorldPresentation(era, f.worldId, inherited);
    assert((await f.read())!.presentation!.mapHour === 'dawn' && (await worldgenScopeOperations(era).worlds.getOne(f.worldId))!.presentation!.mapHour === 'dusk', 'Undo after fork went to the wrong scope');
    const variant = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId, 'past', 'worldgen', f.worldId]).first();
    assert(variant, 'Own variant missing');
    await resetEraDocument(era, 'worldgen', f.worldId, variant.revision);
    equal((await worldgenScopeOperations(era).worlds.getOne(f.worldId))!.presentation!.mapHour, 'dawn', 'Archived variant did not inherit Base');
    await restoreEraVersion(era, 'worldgen', f.worldId, variant.revision + 1, variant.revision);
    equal((await worldgenScopeOperations(era).worlds.getOne(f.worldId))!.presentation!.mapHour, 'dusk', 'Variant history lost mapHour');
    const eraOnly: GeneratedWorld = { ...f.world, id: `${f.worldId}-era-only` };
    await worldgenScopeOperations(era).worlds.create(eraOnly);
    await saveWorldPresentation(era, eraOnly.id, { mapHour: 'journey' });
    assert(!await db.generatedWorlds.get(eraOnly.id) && (await worldgenScopeOperations(era).worlds.getOne(eraOnly.id))!.presentation!.mapHour === 'journey', 'Era-only hour leaked into Base');
    current = (await f.read())!;
    equal(current.params, before.params, 'Hour changed generator params'); equal(current.edits, before.edits, 'Hour changed authored geography');
    return ['Hour validation/defaults/no-op and field-level Undo preserve absence, later winners and recipes', 'Effective Base/inherited/own/era-only scope and receipt Undo survive fork; archived variant history restores its hour'];
  } finally { await f.cleanup(); }
}

export async function testWorldPersistentHourRender(): Promise<string[]> {
  const f = await hourFixture('render', true);
  try {
    const render = async (extra: Record<string, unknown> = {}) => { const result = await runBridgeTool('wh_render_world_map', { projectId: f.projectId, worldId: f.worldId, width: 256, ...extra }); assert(result.ok, JSON.stringify(result)); return result.result as { dataUrl: string }; };
    const initial = (await f.read())!, legacy = await render();
    const update = await runBridgeTool('wh_set_world_presentation', { projectId: f.projectId, worldId: f.worldId, mapHour: 'night', expectedRevision: 0 }); assert(update.ok, JSON.stringify(update));
    const saved = await render(), explicit = await render({ hour: 'night' });
    assert(saved.dataUrl === explicit.dataUrl && saved.dataUrl !== legacy.dataUrl, 'Saved hour default or named explicit render mismatch');
    const png = async (url: string) => { const bitmap = await createImageBitmap(await (await fetch(url)).blob()); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close(); return meanChannels(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data); };
    const day = await png(legacy.dataUrl), night = await png(saved.dataUrl); assert(night[0] < day[0] * .8, 'Real PNG night pixels did not darken');
    const zero = await render({ hour: 0 }), fullDay = await render({ hour: 24 }), noon = await render({ hour: 'noon' });
    assert(zero.dataUrl === fullDay.dataUrl && noon.dataUrl === legacy.dataUrl, 'Explicit zero/24/noon compatibility changed');
    const bad = await runBridgeTool('wh_set_world_presentation', { projectId: f.projectId, worldId: f.worldId, mapHour: 'invalid' }); assert(!bad.ok && bad.code === 'bad-args', 'Invalid MCP hour accepted');
    const stale = await runBridgeTool('wh_set_world_presentation', { projectId: f.projectId, worldId: f.worldId, mapHour: 'dawn', expectedRevision: 0 }); assert(!stale.ok && stale.code === 'conflict', 'MCP stale CAS accepted');
    await saveWorldPresentation(f.scope, f.worldId, { mapHour: 'journey' });
    const beforeRead = (await f.read())!, journey = await render(); equal(journey.dataUrl, legacy.dataUrl, 'Headless journey invented a clock');
    const read = await runBridgeTool('wh_get_world_presentation', { projectId: f.projectId, worldId: f.worldId }); assert(read.ok && (read.result as { effective: { mapHour: string } }).effective.mapHour === 'journey', 'MCP getter omitted mode');
    await render(); await render(); equal(await f.read(), beforeRead, 'Getter/render wrote authored world data');
    const audit = (update.result as { __audit: { before: unknown; projectId: string; entityId: string } }).__audit;
    assert(audit && audit.projectId === f.projectId, 'Dispatcher hour audit missing');
    equal((await f.read())!.edits, initial.edits, 'Rendering touched edits');
    return ['Real dispatcher get/set/CAS and PNG pixels honor saved versus explicit hour (including 0/24); legacy and headless journey render unchanged without writes'];
  } finally { await f.cleanup(); }
}

export async function testWorldPersistentHourPortability(): Promise<string[]> {
  const f = await hourFixture('portable'); const clones: string[] = [];
  try {
    await saveWorldPresentation(f.scope, f.worldId, { mapHour: 'night', clouds: true });
    const era = await savePast(f.projectId); await worldgenScopeOperations(era).worlds.update(f.worldId, { title: 'Own past' }); await saveWorldPresentation(era, f.worldId, { mapHour: 'journey' });
    const expected = (await f.read())!, expectedPast = (await worldgenScopeOperations(era).worlds.getOne(f.worldId))!;
    const normalized = (world: GeneratedWorld) => { const { id: _id, projectId: _owner, createdAt: _created, updatedAt: _updated, ...content } = world; void _id; void _owner; void _created; void _updated; return content; };
    const verify = async (projectId: string) => {
      const project = (await db.projects.get(projectId))!, worlds = await worldgenScopeOperations({ projectId }).worlds.getAll(projectId); assert(worlds.length === 1, 'Portable world count changed');
      const world = worlds[0], past = await worldgenScopeOperations({ projectId, eraId: project.worldEras![0].id }).worlds.getOne(world.id); assert(past, 'Portable era world absent');
      equal(normalized(world), normalized(expected), 'Portable complete Base world changed'); equal(normalized(past), normalized(expectedPast), 'Portable complete own-era world changed');
    };
    const clone = await importProjectData(await exportProjectData(f.projectId)); clones.push(clone); await verify(clone);
    const preview = await previewProjectDuplicate({ projectId: f.projectId }); assert(preview.canDuplicate, 'Own no-external-resource duplicate cannot run');
    const duplicate = await duplicateProject({ projectId: f.projectId, title: 'Own hour duplicate', operationId: `hour-${crypto.randomUUID()}`, expectedSourceVersion: preview.sourceVersion }); clones.push(duplicate.projectId); assert(duplicate.complete, 'Real duplicate incomplete'); await verify(duplicate.projectId);
    const zip = await createProjectZipArchive(f.projectId), file = new File([zip.blob], zip.fileName, { type: 'application/zip' });
    await db.generatedWorlds.update(f.worldId, { presentation: { mapHour: 'off' } });
    await importProjectZip(file, { replaceProjectIds: [f.projectId] }); await verify(f.projectId);
    return ['Real JSON clone, ZIP replacement and project Duplicate preserve complete Base/era documents and literal lighting modes'];
  } finally { await f.cleanup(); for (const id of clones) await deleteProject(id); }
}

export async function testWorldPersistentHourNative(): Promise<string[]> {
  const native = (window as unknown as { __worldHourNative?: { execute(payload: unknown): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: unknown; code?: string; auditIndex?: number }>; undo(index: number): Promise<unknown> } }).__worldHourNative;
  assert(native, 'ROOT Native wrapper is required');
  const f = await hourFixture('native');
  try {
    const read = await native.execute({ tool: 'wh_get_world_presentation', args: { projectId: f.projectId, worldId: f.worldId } }); assert(read.ok, JSON.stringify(read));
    const set = await native.execute({ tool: 'wh_set_world_presentation', args: { projectId: f.projectId, worldId: f.worldId, mapHour: 'night', expectedRevision: 0 } }); assert(set.ok, JSON.stringify(set));
    assert((await f.read())!.presentation!.mapHour === 'night', 'Native executor/IPC did not write its own world');
    const stale = await native.execute({ tool: 'wh_set_world_presentation', args: { projectId: f.projectId, worldId: f.worldId, mapHour: 'dawn', expectedRevision: 0 } }); assert(!stale.ok && stale.code === 'conflict', 'Native stale hour accepted');
    const invalid = await native.execute({ tool: 'wh_set_world_presentation', args: { projectId: f.projectId, worldId: f.worldId, mapHour: 'invalid' } }); assert(!invalid.ok, 'Native schema accepted invalid hour');
    assert(typeof set.auditIndex === 'number', 'Native write did not return an audit index');
    const undo = await native.undo(set.auditIndex); assert(undo && (undo as { ok: boolean }).ok, JSON.stringify(undo));
    assert(!Object.hasOwn((await f.read())!.presentation!, 'mapHour'), 'Normal Native audit Undo did not restore absence');
    return ['Native actual executor→IPC→renderer writes/read/CAS/schema and audit/RPC Undo restore the captured hour preimage; no socket/stdio server', ...await testWorldPersistentHourJourney()];
  } finally { await f.cleanup(); }
}


async function hourUi(f: Awaited<ReturnType<typeof hourFixture>>) {
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;width:1100px;height:800px;overflow:auto'; document.body.append(host);
  const root = createRoot(host);
  const show = async (record: GeneratedWorld = f.world, visible = true, eraId?: string) => {
    // Every actual mount has its own public runtime snapshot (including era
    // and retargeted worlds); the isolated CSS harness is not a Vite Worker server.
    const runtimeId = worldRuntimeKey(record.id, eraId);
    if (!await db.worldSnapshots.get(runtimeId)) { const data = generateWorld(record.params); await saveSnapshot(runtimeId, paramsKey(data.params), data); }
    await act(async () => { root.render(<StrictMode><MemoryRouter><EnginePaneContext.Provider value={{ instanceId: `${f.projectId}-pane`, projectId: f.projectId, eraId, visible }}>
      <WorldView projectId={f.projectId} world={record} onCreateAlternative={async () => { throw new Error('No regeneration expected'); }} onRefreshWorld={async () => {}}
        onSaveEdits={async edits => { await db.generatedWorlds.update(record.id, { edits }); }} onSaveRegions={async regions => { await db.generatedWorlds.update(record.id, { regions }); }}
        onThumbnail={async thumbnail => { await db.generatedWorlds.update(record.id, { thumbnail }); }} focusWaypoint={null} /><ToastHost />
    </EnginePaneContext.Provider></MemoryRouter></StrictMode>); });
    await until(() => Boolean(host.querySelector('[data-testid="worldgen-map-hour"]') && mapCanvas(host)), 'Hour matrix real WorldView did not become usable'); await settle();
  };
  const select = () => host.querySelector<HTMLSelectElement>('[data-testid="worldgen-map-hour"]')!;
  const choose = async (value: string) => { await act(async () => { select().value = value; select().dispatchEvent(new Event('change', { bubbles: true })); }); };
  const chooseNow = (value: string) => { act(() => { select().value = value; select().dispatchEvent(new Event('change', { bubbles: true })); }); };
  return { host, root, show, select, choose, chooseNow, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

// Actual IDB table lock without a Dexie transaction zone spanning React work.
// Keep requests in the native transaction until the fixture releases its gate.
function holdTable(table: string, key: string, entered: ReturnType<typeof deferred>, gate: ReturnType<typeof deferred>): Promise<void> {
  const transaction = db.backendDB().transaction(table, 'readwrite'); let released = false;
  void gate.promise.then(() => { released = true; });
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('Own table hold aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Own table hold failed'));
    const keep = () => { const request = transaction.objectStore(table).get(key); request.onsuccess = () => { entered.release(); if (!released) keep(); }; };
    keep();
  });
}


export async function testWorldPersistentHourPending(): Promise<string[]> {
  const f = await hourFixture('pending', true), ui = await hourUi(f), entered = deferred(), gate = deferred(); let hold: Promise<unknown> | undefined;
  const mark = (step: string) => { (window as unknown as { __testStage: string }).__testStage = 'pending:' + step; };
  let holdExpired = false; let safety: ReturnType<typeof setTimeout> | undefined;
  const watchdog = setTimeout(() => { gate.release(); const view = window as unknown as { __result: unknown; __testStage: string }; view.__result = { ok: false, error: 'Pending fixture watchdog at ' + view.__testStage }; }, 15000);
  try {
    mark('show'); useLocaleStore.setState({ locale: 'en', loaded: true }); await ui.show(); mark('shown');
    hold = holdTable('generatedWorlds', f.worldId, entered, gate);
    mark('hold-requested'); await entered.promise; mark('hold-entered'); safety = setTimeout(() => { holdExpired = true; gate.release(); }, 4000); ui.chooseNow('night'); mark('chosen');
    mark('assert-first'); assert(ui.select().disabled && getPendingWritesSnapshot().pending === 1, 'Accepted discrete choice was not an immediate single pending write');
    mark('second'); ui.chooseNow('dawn'); mark('assert-second'); assert(getPendingWritesSnapshot().pending === 1, 'Busy control accepted a second write');
    mark('closing'); let closed = false; let closeResult: unknown; const closeStart = Date.now(); const closing = flushPendingWrites().then(value => { closed = true; closeResult = value; return value; }); await pause(); assert(Date.now() - closeStart < 4000, 'Fixture pause exceeded its bounded observation window: ' + JSON.stringify({ elapsed: Date.now() - closeStart, closeResult })); assert(!closed, 'Normal close ran ahead of the pending commit: ' + JSON.stringify(closeResult));
    mark('release'); gate.release(); await hold; if (safety) clearTimeout(safety); assert(!holdExpired, 'The fixture could not reach its release while holding the real transaction'); mark('await-close'); assert((await closing).ok, 'Normal close failed after commit'); await until(() => !ui.select().disabled, 'Hour control stayed busy after success');
    assert((await f.read())!.presentation!.mapHour === 'night' && (await f.read())!.presentationRevision === 1 && ui.select().value === 'night', 'Single-flight/ack did not preserve first choice against the stale host prop');
    await ui.choose('off'); await until(() => !ui.select().disabled, 'Second explicit choice did not finish');
    assert((await f.read())!.presentation!.mapHour === 'off' && (await f.read())!.presentationRevision === 2, 'Next explicit choice reused the stale host revision');
    await saveWorldPresentation(f.scope, f.worldId, { mapHour: 'dusk' }); const external = (await f.read())!; await ui.show(external);
    equal(ui.select().value, 'dusk', 'Idle view did not adopt external setting');
    const revision = external.presentationRevision; await settle(); assert((await f.read())!.presentationRevision === revision, 'External adoption echoed another save');
    return ['Real IndexedDB-held single-flight starts immediately; pending close waits, confirmed revision survives stale props and external adoption does not echo writes'];
  } catch (error) { mark('caught:' + String(error)); throw error; } finally { if (safety) clearTimeout(safety); gate.release(); if (hold) await hold; await ui.close(); await f.cleanup(); clearTimeout(watchdog); }
}

export async function testWorldPersistentHourConflict(): Promise<string[]> {
  const f = await hourFixture('conflict', true), era = await savePast(f.projectId), ui = await hourUi(f), gate = deferred(), entered = deferred();
  const foreignOwner = `hour-unrelated-${crypto.randomUUID()}`; let hold: Promise<unknown> | undefined;
  try {
    await ui.show(f.world, true, era.eraId);
    await trackPendingWrite(Promise.reject(new Error('Own unrelated failure control')), undefined, foreignOwner).catch(() => {});
    const previousFailed = getPendingWritesSnapshot().failed;
    hold = holdTable('worldEraVariants', 'own-table-hold', entered, gate);
    await entered.promise; ui.chooseNow('night');
    assert(getPendingWritesSnapshot().pending === 1, 'The pending conflict fixture did not block its real scope read');
    await saveWorldPresentation(f.scope, f.worldId, { clouds: true }, 0); gate.release(); await hold;
    await until(() => !ui.select().disabled, 'Conflict reconciliation did not finish');
    equal(ui.select().value, 'off', 'Conflict did not adopt the saved winner');
    assert((await f.read())!.presentation!.clouds && !Object.hasOwn((await f.read())!.presentation!, 'mapHour'), 'Losing CAS overwrote the other presentation field');
    assert(getPendingWritesSnapshot().failed === previousFailed, 'Conflict left its failed intention or erased the unrelated owner');
    assert(ui.host.textContent?.includes('Map settings changed while the lighting was being saved'), 'Conflict copy falsely reported a lighting-only or other-view change');
    assert(await db.worldEraVariants.where('projectId').equals(f.projectId).count() === 0, 'Conflict created an inherited era fork');
    await ui.choose('dawn'); await until(() => !ui.select().disabled, 'Explicit choice after conflict failed');
    assert((await f.read())!.presentation!.mapHour === 'dawn' && (await f.read())!.presentation!.clouds, 'Fresh explicit choice did not use the adopted revision');
    return ['Real inherited-era scope read race loses full-presentation CAS, adopts saved winner with precise copy, preserves unrelated failed owner and allows a fresh explicit choice'];
  } finally { gate.release(); if (hold) await hold; discardPendingOwner(foreignOwner); await ui.close(); await f.cleanup(); }
}

export async function testWorldPersistentHourStorageOwner(): Promise<string[]> {
  const f = await hourFixture('storage-owner', true), ui = await hourUi(f);
  const beforeLedger = getPendingWritesSnapshot();
  try {
    await ui.show(); const savedBefore = (await f.read())!;
    db.close({ disableAutoOpen: true }); await ui.choose('night');
    await until(() => !ui.select().disabled && getPendingWritesSnapshot().failed === beforeLedger.failed + 1, 'Real closed storage did not retain its failed lighting intention');
    assert(ui.select().value === 'night' && getPendingWritesSnapshot().lastSavedAt === beforeLedger.lastSavedAt, 'Storage error discarded the draft or marked a successful save');
    assert(ui.host.textContent?.includes('Could not save. Your changes are still here'), 'Storage failure lacks its ordinary localized recovery copy');
    await db.open(); equal((await f.read())!.presentation, savedBefore.presentation, 'Failed write mutated stored presentation');
    await act(async () => { await retryFailedWrites(); });
    await until(() => !ui.select().disabled && getPendingWritesSnapshot().failed === beforeLedger.failed, 'Captured Retry did not settle its own failure');
    assert((await f.read())!.presentation!.mapHour === 'night', 'Captured Retry did not persist the original intention');

    // Keep the old failed owner, then retarget A→B→A before its Retry. The
    // old captured operation can commit to A but cannot paint the new lease.
    await ui.show((await f.read())!);
    db.close({ disableAutoOpen: true }); await ui.choose('dusk');
    await until(() => !ui.select().disabled && getPendingWritesSnapshot().failed === beforeLedger.failed + 1, 'Second storage failure was not retained'); await db.open();
    const second: GeneratedWorld = { ...f.world, id: `${f.worldId}-B`, title: 'Independent B' }; await db.generatedWorlds.add(second);
    await ui.show(second); equal(ui.select().value, 'off', 'A failed optimistic choice leaked into B');
    await ui.show((await f.read())!); equal(ui.select().value, 'night', 'A→B→A adopted the obsolete local draft');
    await act(async () => { await retryFailedWrites(); }); await settle();
    assert((await f.read())!.presentation!.mapHour === 'dusk', 'Retargeted Retry lost its fixed original destination');
    assert(ui.select().value === 'night' && !(await db.generatedWorlds.get(second.id))!.presentation, 'Old owner Retry adopted a newer lease or retargeted B');
    await ui.show((await f.read())!); equal(ui.select().value, 'dusk', 'Canonical reread did not adopt the committed retry');
    return ['Actual closed IndexedDB retains failure and captured Retry; irreversible A→B→A owner prevents stale UI adoption while committing only the original destination'];
  } finally { if (!db.isOpen()) await db.open(); await ui.close(); await f.cleanup(); }
}

// Journey playback stays strict in the Native export: its production Worker
// asset is served by the ROOT-owned wrapper, not by the ordinary CSS runner.
export async function testWorldPersistentHour(): Promise<string[]> {
  const results: string[] = [];
  for (const test of [testWorldPersistentHourSource, testWorldPersistentHourCore, testWorldPersistentHourPending, testWorldPersistentHourConflict, testWorldPersistentHourStorageOwner, testWorldPersistentHourRender, testWorldPersistentHourPortability]) {
    (window as unknown as { __testStage: string }).__testStage = test.name; results.push(...await test());
  }
  return results;
}


import { journeyRecipeKey } from '@/engines/worldgen/journeyTypes';

export async function testWorldPersistentHourJourney(): Promise<string[]> {
  const f = await hourFixture('journey', true), ui = await hourUi(f), initialLocale = useLocaleStore.getState().locale;
  try {
    useLocaleStore.setState({ locale: 'en', loaded: true });
    const data = generateWorld(f.world.params), cell = data.elevation.findIndex((height, i) => height > 0 && i % data.width < data.width - 1 && data.elevation[i + 1] > 0);
    assert(cell >= 0, 'Own journey needs two adjacent real land cells'); const x = cell % data.width, y = Math.floor(cell / data.width);
    const journey = { id: 'own-clock-trip', name: 'Own clock route', stops: [{ name: 'Start', u: (x + .5) / data.width, v: (y + .5) / data.height }, { name: 'Finish', u: (x + 1.5) / data.width, v: (y + .5) / data.height }], options: { mode: 'foot' as const, season: 'spring' as const }, recipeKey: journeyRecipeKey(f.world), createdAt: 1, updatedAt: 1 };
    await db.generatedWorlds.update(f.worldId, { journeys: [journey] }); await ui.show((await f.read())!);
    await ui.choose('journey'); await until(() => !ui.select().disabled, 'Journey mode was not saved');
    const before = (await f.read())!; const button = [...ui.host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === 'Journey'); assert(button, 'Normal Journey tab missing'); await act(async () => button.click());
    await until(() => Boolean(ui.host.querySelector('select[aria-label="Open itinerary"]')), 'Real Journey panel did not acquire generated places');
    await act(async () => { const select = ui.host.querySelector<HTMLSelectElement>('select[aria-label="Open itinerary"]')!; select.value = journey.id; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(() => Boolean(ui.host.querySelector('[data-testid="journey-play"]')), 'Own saved itinerary did not produce a real route/playback').catch(error => { throw new Error(String(error) + '\nTerminal normal Journey DOM: ' + ui.host.textContent?.slice(-6500)); });
    const play = () => ui.host.querySelector<HTMLButtonElement>('[data-testid="journey-play"]')!;
    await act(async () => { play().click(); });
    await until(() => Number(ui.host.querySelector<HTMLInputElement>('[data-testid="journey-play-day"]')!.value) > 0, 'Real playback clock did not advance beyond its initial frame');
    assert(play().getAttribute('aria-pressed') === 'true' && ui.host.querySelector('[data-testid="journey-play-caption"]')!.textContent, 'Real Journey playback did not tick');
    assert(Number(ui.host.querySelector<HTMLInputElement>('[data-testid="journey-play-day"]')!.value) > 0, 'Real playback clock did not advance beyond its initial frame');
    await act(async () => play().click());
    const range = ui.host.querySelector<HTMLInputElement>('[data-testid="journey-play-day"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, range.max); range.dispatchEvent(new Event('input', { bubbles: true })); });
    assert(play().getAttribute('aria-pressed') === 'false' && Number(range.max) - Number(range.value) >= 0 && Number(range.max) - Number(range.value) <= Number(range.step) && ui.host.querySelector('[data-testid="journey-play-caption"]')!.textContent?.startsWith('Arrived at Finish'), 'Normal Journey scrub did not reach its paused arrival within the native range step');
    equal((await f.read())!.presentation, before.presentation, 'Journey ticks/pause/end wrote the lighting mode');
    equal((await f.read())!.presentationRevision, before.presentationRevision, 'Journey ticks/pause/end created presentation revisions');
    equal((await f.read())!.journeys, before.journeys, 'Playback rewrote its itinerary');
    await ui.show((await f.read())!, false); await ui.show((await f.read())!, true); equal(ui.select().value, 'journey', 'Hide/reopen lost the journey selection');
    return ['Real WorldView Journey itinerary playback ticks, pauses and reaches its end without writing frames/revisions; only journey mode persists across hide/reopen'];
  } finally { await ui.close(); await f.cleanup(); useLocaleStore.setState({ locale: initialLocale }); }
}

export async function testWorldPersistentHourVisual(): Promise<string[]> {
  const f = await hourFixture('visual', true), ui = await hourUi(f), initialLocale = useLocaleStore.getState().locale;
  const view = window as unknown as { __want: { n: number; w: number; h: number } | null; __sizeAck: number; __shot: { name: string; forcePaint: boolean } | null; __shotDone: string };
  let ticket = 0;
  try {
    useLocaleStore.setState({ locale: 'en', loaded: true }); await ui.show(); await ui.choose('night'); await until(() => !ui.select().disabled, 'Visual saved mode did not finish');
    ui.host.style.width = '100%'; ui.host.style.height = '100%';
    for (const locale of ['en', 'es'] as const) for (const width of [1280, 390]) {
      const n = ++ticket; view.__want = { n, w: width, h: 800 }; await until(() => view.__sizeAck === n, 'Existing viewport handshake did not complete');
      await act(async () => { useLocaleStore.setState({ locale, loaded: true }); }); await document.fonts.ready; await settle();
      ui.host.scrollTop = 0; const rect = ui.select().getBoundingClientRect(); assert(rect.left >= 0 && rect.right <= width && getComputedStyle(ui.select()).opacity === '1', 'Existing lighting control does not fit its settled viewport');
      const name = `world-hour-${locale}-${width}`; view.__shot = { name, forcePaint: true }; await until(() => view.__shotDone === name, 'Existing settled screenshot handshake did not complete');
    }
    return ['Four settled originals EN/ES at 1280/390 show the existing saved Night selector/map; warm first frames are excluded'];
  } finally { useLocaleStore.setState({ locale: initialLocale }); await ui.close(); await f.cleanup(); }
}
