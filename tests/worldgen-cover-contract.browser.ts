import { db } from '@/db';
import { createProject, deleteProject } from '@/db/operations';
import { generatedWorldOps } from '@/engines/worldgen/operations';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

async function testCoverBoundary(mode: 'get' | 'set') {
  const projectId = `qa-cover-${crypto.randomUUID()}`, worldId = `${projectId}-map`;
  const now = Date.now(), failures: string[] = [];
  const evidence: Record<string, unknown> = { mode, projectId, worldId };
  let before = '';
  try {
    await createProject({ id: projectId, title: 'Owned cover QA', type: 'standalone', mode: 'custom', description: '', color: '#777777', status: 'draft', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: now, updatedAt: now });
    await generatedWorldOps.create({ id: worldId, projectId, title: 'Owned map', params: { ...DEFAULT_PARAMS, seed: 'owned-cover', width: 128 }, edits: '[]', createdAt: now, updatedAt: now });
    evidence.before = await db.generatedWorlds.get(worldId);
    before = JSON.stringify(evidence.before);
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext('2d'); if (!context) throw Error('QA canvas unavailable');
    context.fillStyle = '#e03457'; context.fillRect(0, 0, 2, 2);
    const image = canvas.toDataURL('image/png'); evidence.image = image;
    // Source2365 token handshake replaces only the original write precondition; ORACLE-r2.ts remains byteexact in Research.
    const writeRead = mode === 'set' ? await runBridgeTool('wh_get_world_cover', { projectId, worldId }) : undefined;
    if (writeRead && !writeRead.ok) throw Error('Normal cover getter precondition failed');
    const writeState = writeRead?.result as { revision: number; ownerToken: string } | undefined;
    const reply = mode === 'get'
      ? await runBridgeTool('wh_get_world_cover', { projectId, worldId })
      : await runBridgeTool('wh_set_world_cover', { projectId, worldId, coverImage: image, expectedRevision: writeState!.revision, expectedOwnerToken: writeState!.ownerToken });
    evidence.reply = reply;
    if (!reply.ok) failures.push(`public-${mode}-must-exist-and-succeed:${reply.code}`);
    const after = await db.generatedWorlds.get(worldId); evidence.after = after;
    if (!reply.ok && JSON.stringify(after) !== before) failures.push('failed-public-call-changed-world');
    if (reply.ok && mode === 'get' && JSON.stringify(after) !== before) failures.push('getter-wrote-world');
    if (reply.ok && mode === 'set') {
      const raw = { ...after } as unknown as Record<string, unknown>;
      if (raw.coverImage !== image || raw.coverRevision !== 1) failures.push('setter-did-not-save-exact-image-and-revision');
      const expected = JSON.parse(before); delete raw.coverImage; delete raw.coverRevision;
      raw.updatedAt = expected.updatedAt;
      if (JSON.stringify(raw) !== JSON.stringify(expected)) failures.push('setter-changed-unrelated-world-fields');
    }
    evidence.cacheCounts = await Promise.all([db.worldSnapshots.count(), db.canonTiles.count(), db.renderedTiles.count()]);
    if ((evidence.cacheCounts as number[]).some(count => count !== 0)) failures.push('cover-materialized-terrain-cache');
  } catch (error) {
    evidence.runtimeError = error instanceof Error ? error.stack : String(error);
    failures.push('setup-or-runtime-error');
  } finally {
    try {
      await deleteProject(projectId);
      const cleanupCounts = {
        projects: await db.projects.where('id').equals(projectId).count(),
        generatedWorlds: await db.generatedWorlds.where('projectId').equals(projectId).count(),
        worldWaypoints: await db.worldWaypoints.where('projectId').equals(projectId).count(),
        worldEraVariants: await db.worldEraVariants.where('projectId').equals(projectId).count(),
        worldSnapshots: await db.worldSnapshots.where('worldId').equals(worldId).count(),
        canonTiles: await db.canonTiles.where('worldId').equals(worldId).count(),
        renderedTiles: await db.renderedTiles.where('worldId').equals(worldId).count(),
      };
      evidence.cleanupCounts = cleanupCounts;
      evidence.cleaned = Object.values(cleanupCounts).every(count => count === 0);
      if (!evidence.cleaned) failures.push('fixture-not-cleaned');
    } catch (error) {
      evidence.cleanupError = String(error); failures.push('fixture-cleanup-error');
    }
  }
  evidence.failures = failures;
  if (failures.length) throw Error(`WORLD_COVER_RED ${JSON.stringify(evidence)}`);
  return [`WORLD_COVER_PASS ${JSON.stringify(evidence)}`];
}
export const testWorldCoverGetBoundary = () => testCoverBoundary('get');
export const testWorldCoverSetBoundary = () => testCoverBoundary('set');

import { createInspirationImage, updateProject } from '@/db/operations';
import { worldgenScopeOperations, worldRuntimeKey } from '@/engines/worldgen/era';
import { deleteWorldCascade, worldWaypointOps } from '@/engines/worldgen/operations';
import { getWorldCover, type WorldCoverReceipt } from '@/engines/worldgen/worldCover';
import { createWorldEditWriter, hasPendingWorldEdits } from '@/engines/worldgen/editWriter';
import { getCachedWorld } from '@/engines/worldgen/useWorldGeneration';
import { isForging } from '@/engines/worldgen/bridgeAccess';
import { liveWorld } from '@/engines/worldgen/core/liveWorlds';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { mutateEraRows, readWorldDocument, hideEraDocument, resetEraDocument } from '@/services/worldEras/store';
import { listProjectAssets } from '@/services/assetsLibrary/catalog';
import { findAssetUsage } from '@/services/assetsLibrary/usage';
import { deleteAssets } from '@/services/assetsLibrary/operations';
import { clearUndoJournal, undoLast } from '@/services/undoJournal';
import type { GeneratedWorld } from '@/engines/worldgen/types';

export function coverCheck(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export function coverPng(color: string) {
  const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
  const ctx = canvas.getContext('2d'); coverCheck(ctx, 'QA canvas'); ctx.fillStyle = color; ctx.fillRect(0, 0, 2, 2);
  return canvas.toDataURL('image/png');
}
export async function coverCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (name === 'wh_set_world_cover' && !Object.hasOwn(args, 'expectedOwnerToken')) {
    const read = await runBridgeTool('wh_get_world_cover', { projectId: args.projectId, eraId: args.eraId, worldId: args.worldId });
    coverCheck(read.ok, `Normal owner handshake:${read.code}`);
    args = { ...args, expectedOwnerToken: (read.result as { ownerToken: string }).ownerToken };
  }
  const reply = await runBridgeTool(name, args); coverCheck(reply.ok, `${name}:${reply.code}:${reply.error}`);
  return reply.result as Record<string, unknown>;
}
export async function coverFixture() {
  const projectId = `cover-${crypto.randomUUID()}`, worldId = `${projectId}-world`, now = Date.now();
  await createProject({ id: projectId, title: 'Owned cover fixture', type: 'standalone', mode: 'custom', description: '', color: '#777777', status: 'draft', enabledEngines: ['worldgen', 'gallery'], engineOrder: ['worldgen', 'gallery'], worldEras: ['past', 'future'].map(id => ({ id, name: id, description: '', revision: 0, createdAt: now, updatedAt: now })), createdAt: now, updatedAt: now });
  const world: GeneratedWorld = { id: worldId, projectId, title: 'Owned cover world', params: { ...DEFAULT_PARAMS, seed: 'cover-fixed-seed', width: 128 }, edits: JSON.stringify([{ kind: 'placesEverywhere', enabled: false }, { kind: 'label', x: 8, y: 9, text: 'Exact authored note', style: 'note' }]), thumbnail: coverPng('#777777'), presentation: { theme: 'antique' }, presentationRevision: 4, mapWidthKm: 2048, scaleRevision: 2, regions: [{ id: 'region', title: 'Owned region', x: 8, y: 9, spanKm: 40, params: { res: 640, aspect: 1.55, detail: .8, settled: .6, habitation: 1, streamDensity: .7 }, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now };
  await generatedWorldOps.create(world);
  await generatedWorldOps.create({ ...world, id: worldId+'-control', title: 'Control world' });
  await worldWaypointOps.create({ id: projectId+'-pin', projectId, worldId, name: 'Retained pin', u: .2, v: .4, color: '#777777', createdAt: now, updatedAt: now });
  return { projectId, worldId, world, A: coverPng('#d42b49'), B: coverPng('#246fc1'), scope: { projectId }, past: { projectId, eraId: 'past' }, future: { projectId, eraId: 'future' }, cleanup: async () => { await deleteProject(projectId); await coverCleanTables(); } };
}
function coverAudit(result: Record<string, unknown>, projectId: string, worldId: string) {
  const audit = result.__audit as { before?: { __worldCover?: WorldCoverReceipt } } | undefined;
  coverCheck(audit?.before?.__worldCover, 'Real setter field receipt missing');
  return { entry: { tool: 'wh_set_world_cover', kind: 'update', projectId, entityId: worldId, before: audit.before } };
}
function withoutCover(row: unknown) { const value = { ...row as Record<string, unknown> }; delete value.coverImage; delete value.coverRevision; delete value.updatedAt; return JSON.stringify(value); }
async function coverCachesEmpty() { return !(await db.worldSnapshots.count()) && !(await db.canonTiles.count()) && !(await db.renderedTiles.count()); }

async function runWorldCoverContracts() {
  const f = await coverFixture(), out: string[] = [];
  try {
    for (const name of ['wh_get_world_cover', 'wh_set_world_cover']) {
      const tool = getBridgeTool(name); coverCheck(tool?.schema.properties.projectId && tool.schema.properties.eraId && tool.group === 'visual' && tool.engineId === 'worldgen', 'Normal explicit cover manifest/scope missing');
      coverCheck(!tool.description.includes('eraId selects era; preserves Base.'), 'Inherited Base setter received contradictory generic era wording');
    }
    const control = JSON.stringify(await db.generatedWorlds.get(f.worldId+'-control'));
    const before = (await db.generatedWorlds.get(f.worldId))!, pins = JSON.stringify(await db.worldWaypoints.where('worldId').equals(f.worldId).toArray());
    const initial = await coverCall('wh_get_world_cover', { ...f.scope, worldId: f.worldId });
    coverCheck(initial.coverImage === null && initial.revision === 0 && !Object.hasOwn(before, 'coverImage'), 'Legacy effective absence');
    const absent = await coverCall('wh_set_world_cover', { ...f.scope, worldId: f.worldId, coverImage: null, expectedRevision: 0 });
    coverCheck(!absent.__audit && absent.changed === false && JSON.stringify(await db.generatedWorlds.get(f.worldId)) === JSON.stringify(before), 'Absent no-op wrote timestamp/history/metadata/audit');
    const first = await coverCall('wh_set_world_cover', { ...f.scope, worldId: f.worldId, coverImage: f.A, expectedRevision: 0 });
    const saved = (await db.generatedWorlds.get(f.worldId))!;
    coverCheck(saved.coverImage === f.A && saved.coverRevision === 1 && withoutCover(saved) === withoutCover(before), 'Cover changed unrelated authored fields');
    const same = await coverCall('wh_set_world_cover', { ...f.scope, worldId: f.worldId, coverImage: f.A, expectedRevision: 1 });
    coverCheck(!same.__audit && same.changed === false && JSON.stringify(await db.generatedWorlds.get(f.worldId)) === JSON.stringify(saved), 'Equal bytes no-op wrote');
    const stale = await runBridgeTool('wh_set_world_cover', { ...f.scope, worldId: f.worldId, coverImage: f.B, expectedRevision: 0, expectedOwnerToken: initial.ownerToken });
    coverCheck(!stale.ok && stale.code === 'conflict' && JSON.stringify(await db.generatedWorlds.get(f.worldId)) === JSON.stringify(saved), 'Stale cover overwrote newer choice');
    const pending = JSON.stringify([{ kind: 'label', x: 5, y: 7, text: 'Later terrain note', style: 'note' }]);
    const writer = createWorldEditWriter(f.worldId, edits => generatedWorldOps.update(f.worldId, { edits }), 60_000);
    writer.schedule(pending);
    let second: Record<string, unknown>;
    try {
      second = await coverCall('wh_set_world_cover', { ...f.scope, worldId: f.worldId, coverImage: f.B, expectedRevision: 1 });
      coverCheck(hasPendingWorldEdits(f.worldId) && (await db.generatedWorlds.get(f.worldId))?.edits === before.edits, 'Cover flushed or discarded pending terrain writer');
    } finally { await writer.flush(); }
    await generatedWorldOps.update(f.worldId, { title: 'Later title', thumbnail: f.A });
    await coverCall('wh_set_world_presentation', { ...f.scope, worldId: f.worldId, theme: 'survey', expectedRevision: 4 });
    await undoAuditEntry(coverAudit(second!, f.projectId, f.worldId));
    const reverted = (await db.generatedWorlds.get(f.worldId))!;
    coverCheck(reverted.coverImage === f.A && reverted.coverRevision === 3 && reverted.edits === pending && reverted.title === 'Later title' && reverted.thumbnail === f.A && reverted.presentation?.theme === 'survey', 'Field Undo reverted later map work');
    let earlierRefused = false; try { await undoAuditEntry(coverAudit(first, f.projectId, f.worldId)); } catch { earlierRefused = true; }
    coverCheck(earlierRefused && (await db.generatedWorlds.get(f.worldId))?.coverImage === f.A, 'Earlier receipt accepted after cover returned to same bytes');
    const removed = await coverCall('wh_set_world_cover', { ...f.scope, worldId: f.worldId, coverImage: null, expectedRevision: 3 });
    coverCheck((await getWorldCover(f.scope, f.worldId)).coverImage === null, 'Base removal not absent through real reader');
    await undoAuditEntry(coverAudit(removed, f.projectId, f.worldId));
    coverCheck((await getWorldCover(f.scope, f.worldId)).coverImage === f.A && JSON.stringify(await db.worldWaypoints.where('worldId').equals(f.worldId).toArray()) === pins && JSON.stringify(await db.generatedWorlds.get(f.worldId+'-control')) === control, 'Undo/pins/control identity changed');
    coverCheck(await coverCachesEmpty() && !getCachedWorld(f.worldId, f.world.params) && !liveWorld(f.worldId) && !isForging(f.worldId), 'Cover opened/materialized terrain');
    out.push('Normal cover get/set: exact bytes, legacy/no-op/CAS, explicit schema and no terrain caches');
    out.push('Normal pending edits stay pending; field Undo keeps later terrain/title/thumbnail/presentation/pins and refuses older same-byte receipt');
    return out;
  } finally { await f.cleanup(); }
}

async function runWorldCoverOwners() {
  const f = await coverFixture();
  try {
    const inherited = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    coverCheck(!(inherited.scope as { eraId?: string }).eraId && !await db.worldEraVariants.where('projectId').equals(f.projectId).count(), 'Getter created inherited COW');
    const baseWrite = await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.A, expectedRevision: 0 });
    coverCheck((await getWorldCover(f.scope, f.worldId)).coverImage === f.A && !await db.worldEraVariants.where('projectId').equals(f.projectId).count(), 'Inherited image created a terrain copy');
    await mutateEraRows(f.past, [{ table: 'generatedWorlds', id: f.worldId, changes: { title: 'Own past terrain' } }]);
    await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.B, expectedRevision: 1 });
    coverCheck((await getWorldCover(f.past, f.worldId)).coverImage === f.B && (await getWorldCover(f.future, f.worldId)).coverImage === f.A, 'Own-era write escaped owner');
    const removed = await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: null, expectedRevision: 2 });
    coverCheck((await getWorldCover(f.past, f.worldId)).coverImage === null && (await getWorldCover(f.scope, f.worldId)).coverImage === f.A, 'Own-era null reader/fallback wrong');
    await undoAuditEntry(coverAudit(removed, f.projectId, f.worldId));
    const currentOwnWrite = await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.A, expectedRevision: 4 });
    const onlyId = f.worldId+'-era-only';
    await worldgenScopeOperations(f.past).worlds.create({ ...f.world, id: onlyId, title: 'Era-only cover map' });
    await coverCall('wh_set_world_cover', { ...f.past, worldId: onlyId, coverImage: f.A, expectedRevision: 0 });
    coverCheck(!await db.generatedWorlds.get(onlyId) && (await getWorldCover(f.past, onlyId)).scope.eraId === 'past', 'Era-only cover materialized Base');
    const own = await readWorldDocument(f.past, 'worldgen', f.worldId); coverCheck(own, 'Own root');
    await hideEraDocument(f.past, 'worldgen', f.worldId, own.version);
    const hidden = await runBridgeTool('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.A, expectedRevision: 5, expectedOwnerToken: currentOwnWrite.ownerToken });
    coverCheck(!hidden.ok && hidden.code === 'not-found', 'Hidden world cover edited Base');
    let hiddenUndo = false; try { await undoAuditEntry(coverAudit(currentOwnWrite, f.projectId, f.worldId)); } catch { hiddenUndo = true; }
    coverCheck(hiddenUndo, 'Hidden owner Undo resurrected an era');
    const hiddenVariant = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId, 'past', 'worldgen', f.worldId]).first(); coverCheck(hiddenVariant, 'Hidden variant');
    await resetEraDocument(f.past, 'worldgen', f.worldId, hiddenVariant.revision);
    coverCheck(!(await getWorldCover(f.past, f.worldId)).scope.eraId, 'Reset did not inherit Base');
    let resetUndo = false; try { await undoAuditEntry(coverAudit(currentOwnWrite, f.projectId, f.worldId)); } catch { resetUndo = true; }
    coverCheck(resetUndo && (await db.worldEraVariants.get(hiddenVariant.id))?.archived, 'Reset receipt created COW');
    await mutateEraRows(f.future, [{ table: 'generatedWorlds', id: f.worldId, changes: { title: 'Later own future root' } }]);
    await undoAuditEntry(coverAudit(baseWrite, f.projectId, f.worldId));
    coverCheck((await getWorldCover(f.scope, f.worldId)).coverImage === null && (await getWorldCover(f.future, f.worldId)).coverImage === f.A, 'Base receipt reverted a later era copy');
    const futureWrite = await coverCall('wh_set_world_cover', { ...f.future, worldId: f.worldId, coverImage: f.B, expectedRevision: 1 });
    const missingEra = await runBridgeTool('wh_get_world_cover', { projectId: f.projectId, eraId: 'missing', worldId: f.worldId });
    coverCheck(!missingEra.ok && missingEra.code === 'not-found', 'Missing era getter did not report normal absence');
    await updateProject(f.projectId, { worldEras: (await db.projects.get(f.projectId))!.worldEras!.filter(era => era.id !== 'future') });
    let removedEraUndo = false; try { await undoAuditEntry(coverAudit(futureWrite, f.projectId, f.worldId)); } catch { removedEraUndo = true; }
    coverCheck(removedEraUndo && (await getWorldCover(f.scope, f.worldId)).coverImage === null, 'Removed era receipt fell back to Base');
    coverCheck(await coverCachesEmpty() && !isForging(worldRuntimeKey(f.worldId, 'past')), 'Owner operations generated terrain');
    return ['Inherited Base, own era, era-only, hidden/reset and later-copy Undo follow recorded field ownership without implicit COW'];
  } finally { await f.cleanup(); }
}

async function runWorldCoverIdentity() {
  const f = await coverFixture();
  try {
    const receipt = await coverCall('wh_set_world_cover', { ...f.scope, worldId: f.worldId, coverImage: f.A, expectedRevision: 0 });
    await deleteWorldCascade(f.worldId);
    await generatedWorldOps.create({ ...f.world, coverImage: f.A, coverRevision: 1, createdAt: f.world.createdAt + 1, updatedAt: f.world.updatedAt + 1 });
    const recreated = JSON.stringify(await db.generatedWorlds.get(f.worldId));
    let refused = false; try { await undoAuditEntry(coverAudit(receipt, f.projectId, f.worldId)); } catch { refused = true; }
    coverCheck(refused && JSON.stringify(await db.generatedWorlds.get(f.worldId)) === recreated, 'Receipt reverted a different root with reused logical ID/revision/bytes');
    return ['A recreated root with the same ID/revision/bytes keeps its new identity against an older cover receipt'];
  } finally { await f.cleanup(); }
}

async function runWorldCoverGalleryUsage() {
  const f = await coverFixture(); clearUndoJournal();
  try {
    await createInspirationImage({ id: f.projectId+'-image', projectId: f.projectId, imageData: f.A, imageDataOriginal: f.B, notes: 'Owned cover source', tags: [], createdAt: Date.now() });
    const asset = (await listProjectAssets(f.projectId)).find(row => row.id === f.projectId+'-image'); coverCheck(asset, 'Real gallery asset');
    await coverCall('wh_set_world_cover', { ...f.scope, worldId: f.worldId, coverImage: f.A, expectedRevision: 0 });
    coverCheck((await findAssetUsage(f.projectId, asset)).filter(place => place.kind === 'world-cover').length === 1, 'Inherited roots double counted');
    await mutateEraRows(f.past, [{ table: 'generatedWorlds', id: f.worldId, changes: { title: 'Own era cover' } }]);
    await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.B, expectedRevision: 1 });
    const usage = (await findAssetUsage(f.projectId, asset)).filter(place => place.kind === 'world-cover');
    coverCheck(usage.length === 2 && usage.some(place => place.name.includes('past')), 'Base/own-era cover byte usage missing');
    const report = await deleteAssets(f.projectId, [asset], { force: true });
    coverCheck(report.deleted.includes(asset.id) && (await getWorldCover(f.scope, f.worldId)).coverImage === f.A && (await getWorldCover(f.past, f.worldId)).coverImage === f.B, 'Deleting source gallery image removed copied cover bytes');
    coverCheck(await undoLast(f.projectId) === 'undone' && !!await db.inspirationImages.get(asset.id), 'Normal gallery delete Undo');
    return ['Gallery usage matches Base/actual own-era bytes once; normal forced asset deletion and its Undo preserve independent covers'];
  } finally { clearUndoJournal(); await f.cleanup(); }
}

async function coverOwnerReplacedFixture() {
  const f = await coverFixture();
  try {
    await mutateEraRows(f.past, [{ table: 'generatedWorlds', id: f.worldId, changes: { title: 'First own root' } }]);
    const initial = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    const first = await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.A, expectedRevision: initial.revision });
    const oldGetter = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    const oldVariant = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId, 'past', 'worldgen', f.worldId]).first();
    coverCheck(oldVariant, 'Normal own root missing');
    await resetEraDocument(f.past, 'worldgen', f.worldId, oldVariant.revision);
    await mutateEraRows(f.past, [{ table: 'generatedWorlds', id: f.worldId, changes: { title: 'New own root after reset' } }]);
    const newInitial = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.A, expectedRevision: newInitial.revision });
    const freshGetter = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    const replacement = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId, 'past', 'worldgen', f.worldId]).first();
    coverCheck(replacement, 'Normal replacement root missing');
    return { f, first, oldGetter, freshGetter, oldVariant, replacement };
  } catch (error) { await f.cleanup(); throw error; }
}

async function runWorldCoverOwnerUndoABA() {
  const { f, first, oldGetter, freshGetter, oldVariant, replacement } = await coverOwnerReplacedFixture();
  const evidence: Record<string, unknown> = { mode: 'undo', oldGetter, freshGetter, oldVariant, replacement };
  try {
    const before = JSON.stringify(replacement), base = JSON.stringify(await db.generatedWorlds.get(f.worldId));
    let rejected = false;
    try { evidence.undo = await undoAuditEntry(coverAudit(first, f.projectId, f.worldId)); }
    catch (error) { rejected = true; evidence.refusal = String(error); }
    const after = await db.worldEraVariants.get(replacement.id); evidence.after = after;
    evidence.rejected = rejected; evidence.replacementExact = JSON.stringify(after) === before;
    evidence.baseExact = JSON.stringify(await db.generatedWorlds.get(f.worldId)) === base;
    if (!rejected || !evidence.replacementExact || !evidence.baseExact) throw Error(`WORLD_COVER_OWNER_ABA_RED ${JSON.stringify(evidence)}`);
    return [`WORLD_COVER_OWNER_ABA_PASS ${JSON.stringify(evidence)}`];
  } finally { await f.cleanup(); }
}

async function runWorldCoverOwnerSetterABA() {
  const { f, oldGetter, freshGetter, oldVariant, replacement } = await coverOwnerReplacedFixture();
  const evidence: Record<string, unknown> = { mode: 'setter', oldGetter, freshGetter, oldVariant, replacement };
  try {
    const before = JSON.stringify(replacement), base = JSON.stringify(await db.generatedWorlds.get(f.worldId));
    const reply = await runBridgeTool('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.B, expectedRevision: oldGetter.revision, expectedOwnerToken: oldGetter.ownerToken });
    const after = await db.worldEraVariants.get(replacement.id);
    evidence.reply = reply; evidence.after = after; evidence.replacementExact = JSON.stringify(after) === before;
    evidence.baseExact = JSON.stringify(await db.generatedWorlds.get(f.worldId)) === base;
    if (reply.ok || reply.code !== 'conflict' || !evidence.replacementExact || !evidence.baseExact) throw Error(`WORLD_COVER_OWNER_ABA_RED ${JSON.stringify(evidence)}`);
    return [`WORLD_COVER_OWNER_ABA_PASS ${JSON.stringify(evidence)}`];
  } finally { await f.cleanup(); }
}

import { restoreEraVersion } from '@/services/worldEras/store';

/** All private tables are actually counted after normal fixture deletion; no claim about unobserved rows. */
export async function coverCleanTables() {
  const counts = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.count()])));
  cleanupLedger.push(counts);
  coverCheck(Object.values(counts).every(count => count === 0), 'Private cover fixture rows remain after normal deletion');
}

async function testCoverRestoreABA(mode: 'undo' | 'setter') {
  const f = await coverFixture();
  const evidence: Record<string, unknown> = { mode: `restore-${mode}` };
  try {
    await mutateEraRows(f.past, [{ table: 'generatedWorlds', id: f.worldId, changes: { title: 'Own restore root' } }]);
    const first = await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.A, expectedRevision: 0 });
    const oldGetter = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    const versionA = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId, 'past', 'worldgen', f.worldId]).first();
    coverCheck(versionA, 'Own A version missing');
    await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.B, expectedRevision: 1 });
    const versionB = await db.worldEraVariants.get(versionA.id); coverCheck(versionB, 'Own B version missing');
    await restoreEraVersion(f.past, 'worldgen', f.worldId, versionB.revision, versionA.revision);
    const freshGetter = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    const replacement = await db.worldEraVariants.get(versionA.id), before = JSON.stringify(replacement), base = JSON.stringify(await db.generatedWorlds.get(f.worldId));
    evidence.oldGetter = oldGetter; evidence.freshGetter = freshGetter; evidence.replacement = replacement;
    coverCheck(freshGetter.coverImage === f.A && freshGetter.revision === 1, 'Normal restore did not reproduce the A1 cover state');
    let rejected = false;
    if (mode === 'undo') {
      try { evidence.undo = await undoAuditEntry(coverAudit(first, f.projectId, f.worldId)); }
      catch (error) { rejected = true; evidence.refusal = String(error); }
    } else {
      const reply = await runBridgeTool('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.B, expectedRevision: oldGetter.revision, expectedOwnerToken: oldGetter.ownerToken });
      evidence.reply = reply; rejected = !reply.ok && reply.code === 'conflict';
    }
    evidence.after = await db.worldEraVariants.get(versionA.id); evidence.rejected = rejected;
    evidence.replacementExact = JSON.stringify(evidence.after) === before;
    evidence.baseExact = JSON.stringify(await db.generatedWorlds.get(f.worldId)) === base;
    if (!rejected || !evidence.replacementExact || !evidence.baseExact) throw Error(`WORLD_COVER_RESTORE_ABA_RED ${JSON.stringify(evidence)}`);
    return [`WORLD_COVER_RESTORE_ABA_PASS ${JSON.stringify(evidence)}`];
  } finally { await f.cleanup(); }
}
export const testWorldCoverRestoreUndoABA = () => coverObserved(() => testCoverRestoreABA('undo'));
export const testWorldCoverRestoreSetterABA = () => coverObserved(() => testCoverRestoreABA('setter'));

async function runWorldCoverOwnerTokenHandshake() {
  const f = await coverFixture();
  try {
    const inherited = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    const other = await coverCall('wh_get_world_cover', { ...f.scope, worldId: f.worldId+'-control' });
    const base = JSON.stringify(await db.generatedWorlds.get(f.worldId));
    for (const [label, expectedOwnerToken] of [['missing', undefined], ['wrong', 'wrong-owner'], ['other-world', other.ownerToken]] as const) {
      const args: Record<string, unknown> = { ...f.scope, worldId: f.worldId, coverImage: f.A, expectedRevision: 0 };
      if (expectedOwnerToken !== undefined) args.expectedOwnerToken = expectedOwnerToken;
      const reply = await runBridgeTool('wh_set_world_cover', args);
      coverCheck(!reply.ok && (label === 'missing' ? reply.code === 'bad-args' : reply.code === 'conflict') && JSON.stringify(await db.generatedWorlds.get(f.worldId)) === base, `Invalid owner token wrote or returned wrong result:${label}`);
    }
    await mutateEraRows(f.past, [{ table: 'generatedWorlds', id: f.worldId, changes: { title: 'Copied while selection pending' } }]);
    const own = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    coverCheck(inherited.revision === own.revision && inherited.ownerToken !== own.ownerToken, 'Owner transition must be distinguishable with the same cover revision');
    const ownBefore = JSON.stringify(await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId, 'past', 'worldgen', f.worldId]).first());
    const stale = await runBridgeTool('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.B, expectedRevision: inherited.revision, expectedOwnerToken: inherited.ownerToken });
    coverCheck(!stale.ok && stale.code === 'conflict' && JSON.stringify(await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId, 'past', 'worldgen', f.worldId]).first()) === ownBefore, 'Old inherited owner token edited the new own root');
    const first = await coverCall('wh_set_world_cover', { ...f.past, worldId: f.worldId, coverImage: f.A, expectedRevision: own.revision, expectedOwnerToken: own.ownerToken });
    const changedParams = { ...f.world.params, seed: 'Later unrelated own terrain edit' };
    await mutateEraRows(f.past, [{ table: 'generatedWorlds', id: f.worldId, changes: { params: changedParams } }]);
    const afterTerrain = await coverCall('wh_get_world_cover', { ...f.past, worldId: f.worldId });
    coverCheck(afterTerrain.ownerToken === own.ownerToken, 'Unrelated terrain edit changed cover owner identity');
    await undoAuditEntry(coverAudit(first, f.projectId, f.worldId));
    const undone = await worldgenScopeOperations(f.past).worlds.getOne(f.worldId);
    coverCheck(undone?.coverImage == null && JSON.stringify(undone.params) === JSON.stringify(changedParams) && JSON.stringify(await db.generatedWorlds.get(f.worldId)) === base, 'Cover Undo lost later own terrain or changed Base');
    return ['Mandatory owner handshake rejects absent/wrong/other owner tokens and equal-revision inheritance transitions; own Undo preserves later terrain'];
  } finally { await f.cleanup(); }
}

export const testWorldCoverContracts = () => coverObserved(runWorldCoverContracts);

export const testWorldCoverOwners = () => coverObserved(runWorldCoverOwners);

export const testWorldCoverIdentity = () => coverObserved(runWorldCoverIdentity);

export const testWorldCoverGalleryUsage = () => coverObserved(runWorldCoverGalleryUsage);

export const testWorldCoverOwnerUndoABA = () => coverObserved(runWorldCoverOwnerUndoABA);

export const testWorldCoverOwnerSetterABA = () => coverObserved(runWorldCoverOwnerSetterABA);

export const testWorldCoverOwnerTokenHandshake = () => coverObserved(runWorldCoverOwnerTokenHandshake);

const cleanupLedger: Record<string, number>[] = [];
export async function coverObserved(run: () => Promise<string[]>) {
  cleanupLedger.length = 0;
  try {
    const rows = await run();
    return [...rows, `WORLD_COVER_CLEANUP ${JSON.stringify(cleanupLedger)}`];
  } catch (error) {
    throw Error(`${error instanceof Error ? error.stack : String(error)}\nWORLD_COVER_CLEANUP ${JSON.stringify(cleanupLedger)}`);
  }
}
