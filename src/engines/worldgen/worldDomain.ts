import Dexie from 'dexie';
import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { assertWorldEra } from '@/services/worldEras/store';
import { worldgenScopeOperations, worldRuntimeKey } from './era';
import { worldSettingsScope } from './settingsScope';
import { flushWorldEdits, hasPendingWorldEdits } from './editWriter';
import { cellKmOf, isSheet, worldKmOf } from './core/geoScale';
import { normalizeParams, packWorld, unpackWorld, type WorldParams } from './core/types';
import { domainBounds, readDomainDocument, serializeDomainDocument, undoDomainStep } from './core/domainDocument';
import { domainSourceKey, planSheetSize, resizeBounds, type DomainAnchor, type DomainBounds } from './core/worldDomain';
import { deserializeEdits, worldLevels } from './core/edits';
import { freshWorldEdits } from './recipe';
import { loadSnapshot, saveSnapshot } from './snapshots';
import { paramsKey, getCachedWorld } from './useWorldGeneration';
import { prepareWorldDomain } from './domainPreparationClient';
import type { GeneratedWorld, WorldWaypoint } from './types';
import { rememberDomainWorld, openWorldForReading } from './bridgeAccess';

export type WorldDomainScope = { projectId: string; eraId?: string };
export interface DomainRead {
  worldId: string; revision: number; topology: 'legacy-planet' | 'legacy-sheet' | 'finite';
  bounds: DomainBounds; widthKm: number; heightKm: number; cellKm: number; baseCellKm: number;
  source: { width: number; height: number; widthKm: number; sourceKey: string };
  scaleRevision: number; overridden: boolean; catalogueCount: number;
  scope: WorldDomainScope; requestedScope: WorldDomainScope;
}
export interface ResizeWorldDomainOptions {
  widthKm: number; heightKm: number; anchor: DomainAnchor; fill: 'sea' | 'land'; expectedRevision: number;
  jobId?: string; dryRun?: boolean; onProgress?: (stage: string, progress: number) => void;
}
interface DomainFields { edits?: string; domainRevision?: number; scaleRevision?: number; mapWidthKm?: number; journeys?: GeneratedWorld['journeys'] }
export interface WorldDomainReceipt {
  worldId: string; changed: boolean; domain: DomainRead; scope: WorldDomainScope; recipe: string;
  before?: DomainFields; after?: DomainFields; beforePins?: WorldWaypoint[]; afterPins?: WorldWaypoint[];
  ownerStamp?: string;
}
export class WorldDomainError extends Error {
  readonly code: 'bad-args' | 'not-found' | 'conflict' | 'canceled';
  constructor(code: WorldDomainError['code'], message: string) { super(message); this.code = code; }
}
const jobs = new Map<string, { controller: AbortController; committing: boolean }>();
const jobKey = (scope: WorldDomainScope, jobId: string) => JSON.stringify([scope.projectId, scope.eraId ?? null, jobId]);
export function cancelWorldDomainOperation(scope: WorldDomainScope, jobId: string) {
  const job = jobs.get(jobKey(scope, jobId)), active = !!job && !job.committing;
  if (active) job.controller.abort();
  return { jobId, active, canceled: active };
}
async function ownedJob<T>(scope: WorldDomainScope, id: string | undefined, run: (signal: AbortSignal, commit: () => void) => Promise<T>): Promise<T> {
  const key = jobKey(scope, id ?? crypto.randomUUID());
  if (jobs.has(key)) throw new WorldDomainError('conflict', 'This map operation is already active.');
  const controller = new AbortController(), job = { controller, committing: false }; jobs.set(key, job);
  try { return await run(controller.signal, () => { checkCanceled(controller.signal); job.committing = true; }); }
  catch (error) { if (controller.signal.aborted) throw new WorldDomainError('canceled', 'Map operation canceled.'); throw error; }
  finally { if (jobs.get(key) === job) jobs.delete(key); }
}
const checkCanceled = (signal: AbortSignal) => { if (signal.aborted) throw new WorldDomainError('canceled', 'Map operation canceled.'); };
const fields = (row: GeneratedWorld): DomainFields => ({ edits: row.edits, domainRevision: row.domainRevision, scaleRevision: row.scaleRevision, mapWidthKm: row.mapWidthKm, journeys: row.journeys });
const key = (row: GeneratedWorld) => JSON.stringify([row.params, fields(row)]);
async function ownerStamp(scope: WorldDomainScope, worldId: string) {
  if (!scope.eraId) return 'base';
  const row = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId, scope.eraId, 'worldgen', worldId]).first();
  return JSON.stringify([row?.id, row?.revision, row?.archived, row?.hidden]);
}
export interface WorldDomainHistoryExpectation { recipe: string; domainRevision: number; scaleRevision: number; mapWidthKm: number | null; owner: WorldDomainScope; ownerStamp: string }
export async function captureWorldDomainHistory(scope: WorldDomainScope, row: GeneratedWorld): Promise<WorldDomainHistoryExpectation> {
  return { recipe: JSON.stringify(row.params), domainRevision: row.domainRevision ?? 0, scaleRevision: row.scaleRevision ?? 0, mapWidthKm: row.mapWidthKm ?? null,
    owner: await worldSettingsScope(scope, row.id), ownerStamp: await ownerStamp(scope, row.id) };
}
async function read(scope: WorldDomainScope, id: string) {
  const row = await worldgenScopeOperations(scope).worlds.getOne(id);
  if (!row || row.projectId !== scope.projectId) throw new WorldDomainError('not-found', 'World no longer belongs to this project.');
  return row;
}
function describe(row: GeneratedWorld, scope: WorldDomainScope, requestedScope: WorldDomainScope): DomainRead {
  const document = row.edits ? readDomainDocument(row.edits) : null;
  const bounds = document ? domainBounds(document) : { x: 0, y: 0, width: row.params.width, height: row.params.width / 2 };
  const baseCellKm = cellKmOf(row.params, row.params.width);
  const overridden = typeof row.mapWidthKm === 'number' && row.mapWidthKm > 0 && Number.isFinite(row.mapWidthKm);
  const widthKm = overridden ? row.mapWidthKm! : baseCellKm * bounds.width;
  return { worldId: row.id, revision: row.domainRevision ?? 0, topology: document && (document.initial.topology === 'finite' || document.steps.some(step => step.kind === 'resize')) ? 'finite' : isSheet(row.params) ? 'legacy-sheet' : 'legacy-planet',
    bounds, widthKm, heightKm: widthKm * bounds.height / bounds.width, cellKm: widthKm / bounds.width, baseCellKm,
    source: { width: row.params.width, height: row.params.width / 2, widthKm: worldKmOf(row.params), sourceKey: document?.catalogue.sourceKey ?? domainSourceKey(row.params, row.edits ?? '') },
    scaleRevision: row.scaleRevision ?? 0, overridden, catalogueCount: document?.catalogue.entries.length ?? 0, scope, requestedScope };
}
export async function getWorldDomain(scope: WorldDomainScope, worldId: string): Promise<DomainRead> {
  return db.transaction('r', db.tables, async () => {
    const owner = await worldSettingsScope(scope, worldId);
    return describe(await read(scope, worldId), owner, scope);
  });
}
async function drain(scope: WorldDomainScope, id: string) {
  const owner = await worldSettingsScope(scope, id);
  const ids = new Set([worldRuntimeKey(id, scope.eraId), worldRuntimeKey(id, owner.eraId)]);
  for (const id of ids) for (const writer of [id, `regions:${id}`]) if (!await flushWorldEdits(writer)) throw new WorldDomainError('conflict', 'Pending map edits could not be saved.');
  return ids;
}
const busy = (ids: Set<string>) => [...ids].some(id => hasPendingWorldEdits(id) || hasPendingWorldEdits(`regions:${id}`));
const pinPositions = (pins: WorldWaypoint[]) => JSON.stringify(pins.map(pin => [pin.id, pin.worldId, pin.u, pin.v, pin.cell]));
function proposedBounds(domain: DomainRead, options: ResizeWorldDomainOptions) {
  if (![options.widthKm, options.heightKm].every(value => Number.isFinite(value) && value > 0) || !['sea', 'land'].includes(options.fill)
    || !Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) throw new WorldDomainError('bad-args', 'Use positive finite dimensions, a fill and a current domain revision.');
  try { return resizeBounds(domain.bounds, Math.max(1, Math.round(options.widthKm / domain.cellKm)), Math.max(1, Math.round(options.heightKm / domain.cellKm)), options.anchor); }
  catch (error) { throw new WorldDomainError('bad-args', error instanceof Error ? error.message : String(error)); }
}
export async function createFiniteWorld(scope: WorldDomainScope, options: { title: string; params: WorldParams; sheetSize: { widthKm: number; heightKm: number; resolution?: number }; jobId?: string; onProgress?: (stage: string, progress: number) => void }): Promise<{ world: GeneratedWorld; domain: DomainRead }> {
  if (Dexie.currentTransaction) throw new WorldDomainError('conflict', 'Prepare the map outside a pending database transaction.');
  let plan: ReturnType<typeof planSheetSize>;
  try { plan = planSheetSize(options.sheetSize.widthKm, options.sheetSize.heightKm, options.sheetSize.resolution ?? options.params.width); }
  catch (error) { throw new WorldDomainError('bad-args', String(error)); }
  const params = normalizeParams({ ...options.params, width: plan.sourceWidth, sourceFrame: { version: 1, kind: 'flat-sheet', widthKm: plan.sourceWidthKm, centerLatitudeDeg: options.params.sourceFrame?.centerLatitudeDeg ?? 40 } });
  await assertWorldEra(scope);
  return ownedJob(scope, options.jobId, async (signal, committing) => {
    const prepared = await prepareWorldDomain({ type: 'create', params, initial: plan.bounds, legacy: freshWorldEdits() }, signal, options.onProgress);
    checkCanceled(signal);
    const now = Date.now(), world: GeneratedWorld = { id: generateId('world'), projectId: scope.projectId, title: options.title.trim() || 'World', params, edits: prepared.document, domainRevision: 0, regions: [], createdAt: now, updatedAt: now };
    committing(); options.onProgress?.('saving', 1);
    await db.transaction('rw', db.tables, async () => { await assertWorldEra(scope); checkCanceled(signal); await worldgenScopeOperations(scope).worlds.create(world); });
    const pristine = prepared.source ? unpackWorld(prepared.source) : undefined;
    if (pristine) await saveSnapshot(worldRuntimeKey(world.id, scope.eraId), paramsKey(params), pristine);
    rememberDomainWorld(world, unpackWorld(prepared.world), scope.eraId, pristine);
    notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: world.id, projectId: scope.projectId });
    return { world, domain: describe(world, scope, scope) };
  });
}
export async function resizeWorldDomain(scope: WorldDomainScope, worldId: string, options: ResizeWorldDomainOptions): Promise<WorldDomainReceipt> {
  if (Dexie.currentTransaction) throw new WorldDomainError('conflict', 'Prepare the map outside a pending database transaction.');
  const ids = options.dryRun ? new Set<string>() : await drain(scope, worldId);
  const base = await read(scope, worldId), owner = await worldSettingsScope(scope, worldId), domain = describe(base, owner, scope), bounds = proposedBounds(domain, options);
  if (domain.revision !== options.expectedRevision) throw new WorldDomainError('conflict', 'The map domain changed. Read its revision again.');
  const changed = JSON.stringify(bounds) !== JSON.stringify(domain.bounds);
  const receipt: WorldDomainReceipt = { worldId, changed, scope, recipe: JSON.stringify(base.params), domain: { ...domain, bounds, widthKm: domain.cellKm * bounds.width, heightKm: domain.cellKm * bounds.height, scope: changed ? scope : owner } };
  if (!changed || options.dryRun) return receipt;
  const pins = await worldgenScopeOperations(scope).waypoints.getAll(worldId), captured = key(base), capturedOwner = await ownerStamp(scope, worldId);
  return ownedJob(scope, options.jobId, async (signal, committing) => {
    const runtimeId = worldRuntimeKey(worldId, scope.eraId);
    const pristine = await loadSnapshot(runtimeId, paramsKey(base.params));
    const opened = await openWorldForReading(base, 'places', owner.eraId);
    const cached = opened.ok ? opened.world.data : getCachedWorld(runtimeId, base.params);
    checkCanceled(signal);
    const prepared = await prepareWorldDomain({ type: 'resize', params: base.params, legacy: base.edits ?? '', pristine: pristine ? packWorld(pristine).transfer : undefined,
      current: cached ? packWorld(cached).transfer : undefined, painted: cached?.painted,
      bounds, anchor: options.anchor, fill: options.fill, seaLevelM: worldLevels(deserializeEdits(base.edits ?? '')).seaLevelM, revision: domain.revision + 1 }, signal, options.onProgress);
    checkCanceled(signal);
    const afterFields: DomainFields = { edits: prepared.document, domainRevision: domain.revision + 1, scaleRevision: (base.scaleRevision ?? 0) + 1,
      mapWidthKm: domain.overridden ? domain.cellKm * bounds.width : undefined,
      journeys: base.journeys?.map(journey => ({ ...journey, stops: journey.stops.map(stop => ({ ...stop, cell: stop.cell ?? { x: stop.u * domain.bounds.width - 0.5 + domain.bounds.x, y: stop.v * domain.bounds.height - 0.5 + domain.bounds.y } })) })) };
    committing(); options.onProgress?.('saving', 1);
    const updated = await db.transaction('rw', db.tables, async () => {
      await assertWorldEra(scope); checkCanceled(signal);
      const current = await read(scope, worldId), currentOwner = await worldSettingsScope(scope, worldId), currentPins = await worldgenScopeOperations(scope).waypoints.getAll(worldId);
      if (busy(ids) || currentOwner.eraId !== owner.eraId || await ownerStamp(scope, worldId) !== capturedOwner || key(current) !== captured || pinPositions(currentPins) !== pinPositions(pins)) throw new WorldDomainError('conflict', 'The map, owner, positions or scale changed during preparation.');
      const preparedDocument = readDomainDocument(prepared.document)!;
      receipt.before = { ...fields(current), edits: serializeDomainDocument(undoDomainStep(preparedDocument)) }; receipt.after = afterFields; receipt.beforePins = currentPins;
      receipt.afterPins = currentPins.map(pin => ({ ...pin, cell: pin.cell ?? { x: pin.u * domain.bounds.width + domain.bounds.x, y: pin.v * domain.bounds.height + domain.bounds.y } }));
      for (const pin of receipt.afterPins) if (!currentPins.find(item => item.id === pin.id)?.cell) await worldgenScopeOperations(scope).waypoints.update(pin.id, { cell: pin.cell });
      await worldgenScopeOperations(scope).worlds.update(worldId, { ...afterFields, updatedAt: Date.now() });
      receipt.ownerStamp = await ownerStamp(scope, worldId);
      return { ...current, ...afterFields };
    });
    receipt.domain = describe(updated, scope, scope);
    rememberDomainWorld(updated, unpackWorld(prepared.world), scope.eraId);
    if (!pristine && prepared.source) await saveSnapshot(runtimeId, paramsKey(base.params), unpackWorld(prepared.source));
    notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: worldId, projectId: scope.projectId });
    return receipt;
  });
}
export async function revertWorldDomain(scope: WorldDomainScope, worldId: string, receipt: WorldDomainReceipt): Promise<{ reverted: string[]; kept: string[] }> {
  if (Dexie.currentTransaction) throw new WorldDomainError('conflict', 'Undo the map outside a pending database transaction.');
  if (!receipt.changed || !receipt.before || !receipt.after) return { reverted: [], kept: [] };
  if (receipt.worldId !== worldId || receipt.scope.projectId !== scope.projectId || receipt.scope.eraId !== scope.eraId) throw new WorldDomainError('conflict', 'Receipt belongs to another map or era.');
  const ids = await drain(scope, worldId);
  await db.transaction('rw', db.tables, async () => {
    const row = await read(scope, worldId), pins = await worldgenScopeOperations(scope).waypoints.getAll(worldId);
    if (busy(ids) || await ownerStamp(scope, worldId) !== receipt.ownerStamp || JSON.stringify(row.params) !== receipt.recipe || JSON.stringify(fields(row)) !== JSON.stringify(receipt.after) || pinPositions(pins) !== pinPositions(receipt.afterPins ?? [])) throw new WorldDomainError('conflict', 'Newer map edits, positions or scale are preserved.');
    const restore = { ...receipt.before, domainRevision: (row.domainRevision ?? 0) + 1, scaleRevision: (row.scaleRevision ?? 0) + 1, updatedAt: Date.now() };
    await worldgenScopeOperations(scope).worlds.update(worldId, restore);
    for (const pin of receipt.beforePins ?? []) await worldgenScopeOperations(scope).waypoints.update(pin.id, { cell: pin.cell });
  });
  notifyDataChanged({ source: 'undo', table: 'generatedWorlds', entityId: worldId, projectId: scope.projectId });
  return { reverted: ['edits', 'domainRevision', 'scaleRevision', 'mapWidthKm'], kept: [] };
}

/** Paint history that crosses a resize uses the same document writer and monotonic metadata. */
export async function commitWorldDomainHistory(scope: WorldDomainScope, worldId: string, before: string, after: string, expected: WorldDomainHistoryExpectation) {
  const oldDocument = readDomainDocument(before), nextDocument = readDomainDocument(after);
  if (!oldDocument || !nextDocument || oldDocument.catalogue.sourceKey !== nextDocument.catalogue.sourceKey) throw new WorldDomainError('conflict', 'History belongs to another source.');
  if (Dexie.currentTransaction) throw new WorldDomainError('conflict', 'Commit history outside a pending transaction.');
  const ids = await drain(scope, worldId);
  const result = await db.transaction('rw', db.tables, async () => {
    const row = await read(scope, worldId);
    const owner = await worldSettingsScope(scope, worldId);
    if (busy(ids) || row.edits !== before || JSON.stringify(row.params) !== expected.recipe || (row.domainRevision ?? 0) !== expected.domainRevision
      || (row.scaleRevision ?? 0) !== expected.scaleRevision || (row.mapWidthKm ?? null) !== expected.mapWidthKm || owner.eraId !== expected.owner.eraId || await ownerStamp(scope, worldId) !== expected.ownerStamp) throw new WorldDomainError('conflict', 'Newer authored edits, owner or scale are preserved.');
    const oldBounds = domainBounds(oldDocument), nextBounds = domainBounds(nextDocument);
    const change = { edits: after, domainRevision: (row.domainRevision ?? 0) + 1, scaleRevision: (row.scaleRevision ?? 0) + 1,
      mapWidthKm: row.mapWidthKm === undefined ? undefined : row.mapWidthKm * nextBounds.width / oldBounds.width, updatedAt: Date.now() };
    await worldgenScopeOperations(scope).worlds.update(worldId, change);
    return { ...row, ...change };
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: worldId, projectId: scope.projectId });
  return result;
}
