import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Dexie from 'dexie';
import { db } from '@/db';
import type { Project } from '@/types';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import WorldView from '@/engines/worldgen/components/WorldView';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { renderAtlasPreview } from '@/engines/worldgen/core/render';
import { serializeEdits } from '@/engines/worldgen/core/edits';
import { liveWorld } from '@/engines/worldgen/core/liveWorlds';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot, loadSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey, worldgenScopeOperations } from '@/engines/worldgen/era';
import { createWorldAlternative } from '@/engines/worldgen/recipe';
import { saveWorldRegionChanges } from '@/engines/worldgen/sheets/store';
import { saveWorldEra } from '@/services/worldEras/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { discardPendingOwner, flushPendingWrites, getPendingWritesSnapshot, retryFailedWrites, trackPendingWrite } from '@/services/pendingWrites';
import { ToastHost } from '@/components/common/toast';
import { useLocaleStore } from '@/stores/localeStore';

// Independent contract oracle, prepared without running or importing it.
// No replacement renderer, Worker, persistence function, or global ledger reset.
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const sleep = (ms = 30) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean | Promise<boolean>, message: string, timeout = 20_000) {
  const end = performance.now() + timeout;
  while (!await predicate()) {
    assert(performance.now() < end, message);
    await act(async () => { await sleep(); });
  }
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
type WorldRow = GeneratedWorld & { presentation?: Record<string, unknown>; presentationRevision?: number };
const hourOf = (row: GeneratedWorld | undefined) => (row as WorldRow | undefined)?.presentation?.mapHour;
const revisionOf = (row: GeneratedWorld | undefined) => (row as WorldRow | undefined)?.presentationRevision ?? 0;
type Audit = { before: unknown; entityId: string; projectId: string };
type GetResult = { revision: number; saved?: Record<string, unknown>; effective: Record<string, unknown> };
async function mcpScope(worldId: string, eraId?: string) {
  const row = await db.generatedWorlds.get(worldId); assert(row, 'Missing Base fixture for explicit MCP scope');
  return { projectId: row.projectId, ...(eraId ? { eraId } : {}) };
}
async function readMcp(worldId: string, eraId?: string): Promise<GetResult> {
  const response = await runBridgeTool('wh_get_world_presentation', { worldId, ...await mcpScope(worldId, eraId) });
  assert(response.ok, `Presentation read failed: ${JSON.stringify(response)}`);
  return response.result as GetResult;
}
async function writeMcp(worldId: string, mapHour: string, expectedRevision: number, eraId?: string) {
  const response = await runBridgeTool('wh_set_world_presentation', { worldId, mapHour, expectedRevision, ...await mcpScope(worldId, eraId) });
  assert(response.ok, `Presentation write failed: ${JSON.stringify(response)}`);
  return response.result as { revision: number; __audit: Audit };
}
async function undoMcp(audit: Audit, eraId?: string) {
  const response = await runBridgeTool('__undo', { projectId: audit.projectId, entry: {
    tool: 'wh_set_world_presentation', kind: 'update', entityId: audit.entityId,
    projectId: audit.projectId, before: audit.before, summary: 'Independent hour receipt', ...(eraId ? { eraId } : {}),
  } });
  assert(response.ok, `Presentation Undo failed: ${JSON.stringify(response)}`);
}

let serial = 0;
async function fixture(label: string) {
  const projectId = `review-hour-${label}-${++serial}`, eraId = 'earlier';
  await db.projects.put({ id: projectId, title: projectId, description: '', type: 'standalone', mode: 'custom', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
  const rows: GeneratedWorld[] = [];
  const snapshotIds: string[] = [];
  for (const name of ['a', 'b']) {
    const params = { ...DEFAULT_PARAMS, width: 128, seed: `${projectId}-${name}`, erosion: 0 };
    const row: GeneratedWorld = { id: `${projectId}-${name}`, projectId, title: `Review map ${name}`, params, edits: serializeEdits([]), createdAt: 1, updatedAt: 1 };
    rows.push(row);
    const data = generateWorld(params);
    await db.generatedWorlds.put(row);
    for (const era of name === 'a' ? [undefined, eraId] : [undefined]) {
      const runtimeId = worldRuntimeKey(row.id, era);
      snapshotIds.push(runtimeId);
      await saveSnapshot(runtimeId, paramsKey(params), data);
      assert(await db.worldSnapshots.get(runtimeId), `Real snapshot missing: ${runtimeId}`);
    }
    // Snapshots quantise fields. Build the saved cosmetic thumbnail from the
    // actual decoded snapshot that WorldView will adopt, not pre-encode arrays.
    const restored = await loadSnapshot(worldRuntimeKey(row.id), paramsKey(params));
    assert(restored, 'Real fixture snapshot could not be decoded');
    const preview = renderAtlasPreview(restored, 256, true), thumbnail = document.createElement('canvas');
    thumbnail.width = preview.width; thumbnail.height = preview.height;
    thumbnail.getContext('2d')!.putImageData(new ImageData(preview.pixels, preview.width, preview.height), 0, 0);
    row.thumbnail = thumbnail.toDataURL('image/jpeg', 0.8);
    await db.generatedWorlds.put(row);
  }
  await saveWorldEra(projectId, { id: eraId, name: 'Earlier', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
  const [a, b] = rows;
  return {
    projectId, eraId, a, b,
    row: (id = a.id, era?: string) => worldgenScopeOperations({ projectId, eraId: era }).worlds.getOne(id),
    variants: () => db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([projectId, eraId, 'worldgen', a.id]).count(),
    async cleanup() {
      // Delete only this fixture, including era-keyed derived snapshots.
      for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(projectId).delete();
      for (const id of snapshotIds) await db.worldSnapshots.delete(id);
      await db.projects.delete(projectId);
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

// A real controlled host may read a committed row before publishing new props.
// holdPublication delays that publication only; all reads and writes stay real.
class View {
  host = document.createElement('section');
  root: Root;
  current!: GeneratedWorld;
  eraId?: string;
  visible = true;
  mounted = true;
  holdPublication = false;
  refreshReads = 0;
  writeTrace: { callback: string; changedFromProps?: boolean }[] = [];
  constructor(readonly f: Fixture) {
    this.host.style.cssText = 'width:1100px;height:760px;position:relative';
    this.host.dataset.reviewHourPane = f.projectId;
    document.body.append(this.host);
    this.root = createRoot(this.host);
  }
  select() {
    const field = this.host.querySelector<HTMLSelectElement>('[data-testid="worldgen-map-hour"]');
    assert(field, 'Real WorldView hour selector is missing');
    return field;
  }
  paint() {
    const row = this.current, scope = { projectId: this.f.projectId, eraId: this.eraId };
    const ops = worldgenScopeOperations(scope).worlds;
    this.root.render(<StrictMode><MemoryRouter><EnginePaneContext.Provider value={{ instanceId: this.f.projectId, ...scope, visible: this.visible, primary: true }}>
      <WorldView key={worldRuntimeKey(row.id, scope.eraId)} projectId={scope.projectId} world={row} focusWaypoint={null}
        onRefreshWorld={async () => {
          const fresh = await ops.getOne(row.id);
          assert(fresh, 'Refresh lost the captured row');
          this.refreshReads++;
          if (this.mounted && !this.holdPublication && this.current.id === row.id && this.eraId === scope.eraId) { this.current = fresh; this.paint(); }
        }}
        onSaveEdits={async edits => { this.writeTrace.push({ callback: 'onSaveEdits', changedFromProps: row.edits !== edits }); await ops.update(row.id, { edits }); }}
        onSaveRegions={async (regions, baseline) => { this.writeTrace.push({ callback: 'onSaveRegions' }); await saveWorldRegionChanges(scope.projectId, row.id, baseline ?? row.regions ?? [], regions, undefined, scope.eraId); }}
        onThumbnail={async thumbnail => { this.writeTrace.push({ callback: 'onThumbnail', changedFromProps: row.thumbnail !== thumbnail }); await ops.update(row.id, { thumbnail }); }}
        onCreateAlternative={async params => { this.writeTrace.push({ callback: 'onCreateAlternative' }); await createWorldAlternative(row.id, params, `${row.title} alternative`, scope); }} />
      <ToastHost />
    </EnginePaneContext.Provider></MemoryRouter></StrictMode>);
  }
  async show(id = this.f.a.id, eraId?: string) {
    const row = await this.f.row(id, eraId); assert(row, 'Missing fixture world');
    this.current = row; this.eraId = eraId;
    await act(async () => { this.paint(); await sleep(); });
    await until(() => Boolean(this.host.querySelector('[data-testid="worldgen-map-hour"]')) && Boolean(liveWorld(worldRuntimeKey(id, eraId))), 'Real WorldView did not adopt its persisted snapshot', 45_000);
    assert(Array.from(this.host.querySelectorAll('canvas')).some(canvas => canvas.width > 0 && canvas.height > 0), 'WorldView has no real drawing surface');
  }
  async choose(value: string) {
    await act(async () => {
      const select = this.select();
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep();
    });
  }
  async visibility(visible: boolean) { this.visible = visible; await act(async () => { this.paint(); await sleep(); }); }
  async close() { this.mounted = false; await act(async () => { this.root.unmount(); await sleep(); }); this.host.remove(); }
}

async function holdStore(name: 'generatedWorlds' | 'worldEraVariants') {
  const gate = deferred(); let entered = false;
  const finished = db.transaction('rw', db.table(name), async () => { entered = true; await Dexie.waitFor(gate.promise); });
  await until(() => entered, `Transaction did not acquire ${name}`);
  return { release: gate.release, finished };
}
async function cleanLedger() {
  await until(() => getPendingWritesSnapshot().pending === 0, 'Earlier writes did not settle');
  const state = getPendingWritesSnapshot();
  assert(state.failed === 0 && state.dirty === 0, `Fixture needs a clean ledger, will not reset unrelated owners: ${JSON.stringify(state)}`);
}
async function saved(f: Fixture, value: string, revision: number) {
  await until(async () => { const row = await f.row(); return hourOf(row) === value && revisionOf(row) === revision; }, `Expected ${value} at presentation revision ${revision}`);
  await until(() => getPendingWritesSnapshot().pending === 0, 'Hour write did not settle');
}
async function renderedPixels(worldId: string, hour?: number) {
  const result = await runBridgeTool('wh_render_world_map', { worldId, ...await mcpScope(worldId), width: 256, ...(hour === undefined ? {} : { hour }) });
  assert(result.ok, `Real map render failed: ${JSON.stringify(result)}`);
  const image = new Image(); image.src = (result.result as { dataUrl: string }).dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

async function scopeAndUndo() {
  const f = await fixture('scope');
  try {
    const before = JSON.stringify(await f.row());
    const read = await readMcp(f.a.id, f.eraId);
    assert(read.effective.mapHour === 'off' && !Object.hasOwn(read.saved ?? {}, 'mapHour'), 'Absent preference did not remain absent/default off');
    assert(JSON.stringify(await f.row()) === before && await f.variants() === 0, 'A scoped MCP read wrote or forked the world');
    const first = await writeMcp(f.a.id, 'night', 0, f.eraId);
    assert(hourOf(await f.row()) === 'night' && await f.variants() === 0, 'Inherited hour save created an era fork');
    await worldgenScopeOperations({ projectId: f.projectId, eraId: f.eraId }).worlds.update(f.a.id, { title: 'Actual later era fork' });
    await undoMcp(first.__audit, f.eraId);
    assert(!Object.hasOwn((await f.row())?.presentation ?? {}, 'mapHour'), 'Undo did not restore absence in its recorded Base scope');
    assert(hourOf(await f.row(f.a.id, f.eraId)) === 'night', 'Undo was retargeted to a later era fork');
    const state = await readMcp(f.a.id);
    const older = await writeMcp(f.a.id, 'dawn', state.revision);
    await writeMcp(f.a.id, 'dusk', older.revision);
    const other = await runBridgeTool('wh_set_world_presentation', { projectId: f.projectId, worldId: f.a.id, theme: 'antique' });
    assert(other.ok, JSON.stringify(other));
    await undoMcp(older.__audit);
    assert(hourOf(await f.row()) === 'dusk' && (await f.row())?.presentation?.theme === 'antique', 'Older hour Undo overwrote a newer hour or another presentation field');
    assert((await f.row())?.edits === f.a.edits && (await f.row())?.params.seed === f.a.params.seed, 'Hour operations changed authored recipe data');
    await writeMcp(f.a.id, 'noon', (await readMcp(f.a.id)).revision);
    const renderRow = JSON.stringify(await f.row());
    const noon = await renderedPixels(f.a.id), midnight = await renderedPixels(f.a.id, 0), nextMidnight = await renderedPixels(f.a.id, 24);
    assert(midnight.length === noon.length && midnight.every((value, index) => value === nextMidnight[index]), 'Explicit 0 and 24 did not resolve to the same real pixels');
    let dayLight = 0, nightLight = 0;
    for (let i = 0; i < noon.length; i += 4) { dayLight += noon[i] + noon[i + 1] + noon[i + 2]; nightLight += midnight[i] + midnight[i + 1] + midnight[i + 2]; }
    assert(nightLight < dayLight, 'Explicit numeric midnight was masked by the saved daytime preference');
    assert(JSON.stringify(await f.row()) === renderRow, 'Omitted or explicit render hour wrote the world');
  } finally { await f.cleanup(); }
}

async function conflictAndForeignOwner() {
  for (const hideReturn of [false, true]) {
    await cleanLedger();
    const f = await fixture(hideReturn ? 'conflict-hide' : 'conflict-visible'), view = new View(f);
    const foreignOwner = `${f.projectId}:unrelated-failed-owner`;
    let held: Awaited<ReturnType<typeof holdStore>> | undefined;
    try {
      await view.show(f.a.id, f.eraId);
      if (await f.variants() !== 0) {
        const base = await f.row(), variant = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId, f.eraId, 'worldgen', f.a.id]).first();
        const root = variant?.document?.root ?? {}, original = base as unknown as Record<string, unknown>;
        const changedKeys = Array.from(new Set([...Object.keys(root), ...Object.keys(original)])).filter(key => JSON.stringify(root[key]) !== JSON.stringify(original[key]));
        console.error('PEER_PRE_HOUR_FORK_DIAGNOSTIC ' + JSON.stringify({ callbacks: view.writeTrace, changedKeys, hourBase: hourOf(base), hourVariant: root.presentation, baseThumbnailLength: base?.thumbnail?.length, variantThumbnailLength: typeof root.thumbnail === 'string' ? root.thumbnail.length : null }));
      }
      assert(await f.variants() === 0, 'Inherited-view fixture forked before the hour intent');
      // This ledger-only marker is a control for ownership, not a storage fake.
      await trackPendingWrite(Promise.reject(Error('Independent unrelated failure')), undefined, foreignOwner).catch(() => undefined);
      assert(getPendingWritesSnapshot().failed === 1, 'Unrelated failure control was not registered');
      held = await holdStore('worldEraVariants');
      await view.choose('night');
      assert(view.select().disabled && getPendingWritesSnapshot().pending > 0, 'Hour promise was not registered/busy during a held real transaction');
      if (hideReturn) { await view.visibility(false); await view.visibility(true); }
      // The inherited resolver is held on variants; an actual Base writer can
      // commit to generatedWorlds before the old expected revision is checked.
      await writeMcp(f.a.id, 'morning', 0);
      const noticesBeforeRelease = new Set(view.host.querySelectorAll('[role="alert"]'));
      held.release(); await held.finished; held = undefined;
      await until(() => getPendingWritesSnapshot().pending === 0 && (hideReturn || view.select().value === 'morning'), 'CAS loser did not settle/adopt the committed winner');
      await act(async () => { await sleep(80); });
      assert(hourOf(await f.row()) === 'morning' && revisionOf(await f.row()) === 1 && await f.variants() === 0, 'Conflict retry overwrote the winner or forked the era');
      assert(getPendingWritesSnapshot().failed === 1, 'Hour conflict cleared an unrelated failed owner or kept its own abandoned failure');
      const flushed = await flushPendingWrites();
      assert(!flushed.ok && flushed.failed === 1, 'Foreign failure stopped being truthful after conflict');
      if (hideReturn) {
        assert(Array.from(view.host.querySelectorAll('[role="alert"]')).every(node => noticesBeforeRelease.has(node)), 'An old hidden lease emitted a new conflict notice after returning');
      }
    } finally {
      if (held) { held.release(); await held.finished; }
      await view.close(); discardPendingOwner(foreignOwner); await f.cleanup();
    }
  }
}

async function storageRetryCaptured() {
  for (const retryConflict of [false, true]) {
    await cleanLedger();
    const f = await fixture(retryConflict ? 'retry-conflict' : 'retry-success'), view = new View(f);
    try {
      await view.show();
      const savedAt = getPendingWritesSnapshot().lastSavedAt;
      // Real IndexedDB connection failure, not a mocked persistence method.
      db.close({ disableAutoOpen: true });
      await view.choose('night');
      await until(() => getPendingWritesSnapshot().pending === 0 && getPendingWritesSnapshot().failed === 1, 'Closed IndexedDB save did not remain retryable');
      assert(view.select().value === 'night' && getPendingWritesSnapshot().lastSavedAt === savedAt, 'Failed storage was presented as a successful save');
      await db.open();
      assert(hourOf(await f.row()) === undefined && revisionOf(await f.row()) === 0, 'Failed storage changed the canonical hour');
      if (retryConflict) await writeMcp(f.a.id, 'morning', 0);
      await view.show(f.b.id);
      const beforeNotices = new Set(view.host.querySelectorAll('[role="alert"]'));
      await retryFailedWrites();
      await until(() => getPendingWritesSnapshot().pending === 0, 'Captured retry did not settle');
      assert(hourOf(await f.row()) === (retryConflict ? 'morning' : 'night') && revisionOf(await f.row()) === 1, 'Retry retargeted or rebased instead of using its captured target/revision');
      assert(hourOf(await f.row(f.b.id)) === undefined && revisionOf(await f.row(f.b.id)) === 0 && view.select().value === 'off', 'Retry adopted its old value into the replacement world');
      assert(getPendingWritesSnapshot().failed === 0, 'Successful retry or deliberately abandoned conflict left its owner failed');
      assert(Array.from(view.host.querySelectorAll('[role="alert"]')).every(node => beforeNotices.has(node)), 'Revoked owner emitted a late notice into the replacement world');
    } finally {
      if (!db.isOpen()) await db.open();
      await view.close(); await f.cleanup();
    }
  }
}

async function singleFlightAndAcknowledgement() {
  await cleanLedger();
  const f = await fixture('flight'); let view = new View(f);
  let held: Awaited<ReturnType<typeof holdStore>> | undefined;
  try {
    await view.show();
    assert(revisionOf(await f.row()) === 0, 'StrictMode mount wrote a default hour');
    held = await holdStore('generatedWorlds');
    await view.choose('night');
    assert(view.select().disabled && getPendingWritesSnapshot().pending > 0, 'Single-flight did not register/disable synchronously');
    // Explicit synthetic listener probe; no claim about native select default actions.
    await view.choose('dawn');
    let flushSettled = false;
    const flush = flushPendingWrites().then(value => { flushSettled = true; return value; });
    await sleep(40);
    assert(!flushSettled, 'Navigation flush resolved while the real write was still blocked');
    await view.close(); // Before the unrelated 450ms look debounce could fire.
    held.release(); await held.finished; held = undefined;
    const flushed = await flush;
    assert(flushed.ok && !flushed.timedOut, 'Accepted hour was lost on early unmount');
    await saved(f, 'night', 1);
    view = new View(f); await view.show();
    assert(view.select().value === 'night', 'Fresh StrictMode remount lost the committed preference');
    await sleep(80);
    assert(revisionOf(await f.row()) === 1, 'Remount/default reconciliation echoed a presentation write');
    view.holdPublication = true;
    await view.choose('dawn'); await saved(f, 'dawn', 2);
    await until(() => !view.select().disabled, 'Successful receipt never released single-flight');
    assert(view.select().value === 'dawn' && hourOf(view.current) === 'night', 'Committed optimistic hour was lost while host publication lagged');
    await view.choose('dusk'); await saved(f, 'dusk', 3);
    await until(() => !view.select().disabled, 'Second acknowledged hour did not settle');
    assert(view.select().value === 'dusk', 'Second choice reused stale props revision instead of acknowledged revision');
    view.holdPublication = false; await view.show();
    assert(view.select().value === 'dusk' && revisionOf(await f.row()) === 3, 'Host acknowledgement created an echo write or restored stale props');
  } finally {
    if (held) { held.release(); await held.finished; }
    if (view.host.isConnected) await view.close();
    await f.cleanup();
  }
}

export async function testReviewWorldPersistentHour(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'en' });
  const results: string[] = [];
  await cleanLedger();
  await scopeAndUndo(); results.push('MCP absent defaults stay readonly; inherited save and recorded-scope Undo survive an actual era fork and newer winner');
  await conflictAndForeignOwner(); results.push('Real CAS conflict adopts the winner, preserves a foreign failure and revokes hide-return notices');
  await storageRetryCaptured(); results.push('Real closed-IndexedDB failure keeps a captured retry; replacement world is untouched on retry success and retry conflict');
  await singleFlightAndAcknowledgement(); results.push('StrictMode/single-flight flush survives early unmount and receipt revisions survive delayed host publication without echo writes');
  return results;
}
