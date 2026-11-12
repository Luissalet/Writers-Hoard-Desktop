import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { saveWorldEra } from '@/services/worldEras/store';
import { localToolConvergenceContext } from '@/engines/local/convergence/context';
import { convergenceCanonical, convergenceHash } from '@/engines/local/convergence/format';
import { sourceDocumentPreview } from '@/engines/local/documents/preview';
import { archiveSourceToolDocument, createSourceToolDocument, readSourceToolDocument } from '@/engines/local/documents/store';
import { registerLocalToolModules } from '@/engines/local/registry';
import { localToolReleaseIdentity, type LocalToolReleaseManifest } from '@/engines/local/releaseFormat.mjs';
import { pinLocalToolRelease } from '@/engines/local/releases';
import { defineLocalTool, type LocalToolJson } from '@/engines/local/sdk';
import { createLocalToolClient } from '@/engines/local/storage';
import { createFakeLocalToolHost } from '@/engines/local/testing';
import fixtureSource from './local-tool-source-migration.browser.ts?raw';

type State = Record<string, LocalToolJson>;

export async function testSourceMigration(): Promise<string[]> {
  const namespace = 'tests.source-callback-migration', projectId = 'qa-source-callback-' + crypto.randomUUID();
  const otherId = projectId + '-other';
  const scope = { projectId }, own = { projectId, eraId: 'own' }, inherited = { projectId, eraId: 'inherited' };
  const checks: string[] = [];
  const exact = (value: unknown) => convergenceCanonical(JSON.parse(JSON.stringify(value,
    (_key, entry) => entry === undefined ? { fixtureUndefined: true } : entry)));
  function expect(label: string, actual: unknown, expected: unknown) {
    if (exact(actual) !== exact(expected)) throw Error(label + ': ' + JSON.stringify(actual));
    checks.push(label);
  }
  async function rejects(label: string, operation: () => unknown, expected?: string) {
    let failure: string | null = null;
    try { await operation(); } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    expect(label, expected ? failure : Boolean(failure), expected ?? true);
  }

  const label = { en: 'Source migration', es: 'Migración de Source' };
  const common = { namespace, name: label, description: label, document: { defaultTitle: label }, component: () => null };
  const record = (value: LocalToolJson): value is State => !!value && typeof value === 'object' && !Array.isArray(value);
  const scalar = { kind: 'scalar' } as const;
  const old = defineLocalTool<State>({
    ...common, stateSchemaVersion: '1.0.0', codec: { version: 1, fields: { stats: { kind: 'map' }, keep: scalar } },
    initialState: { stats: {}, keep: 'Neighbor' }, preview: { version: 1, fields: [{ key: 'keep' }] },
    validateState: (value): value is State => record(value) && record(value.stats) &&
      Object.values(value.stats).every(item => typeof item === 'number') && typeof value.keep === 'string',
  });
  const other = defineLocalTool<State>({ ...old, stateSchemaVersion: '1.0.1' });
  const from = { namespace, codec: old.codec!, ...localToolConvergenceContext(old)! };
  let callbackCalls = 0, adjustment = 0, failCallback = false;
  const target = {
    ...common, stateSchemaVersion: '2.0.0',
    codec: { version: 1 as const, fields: { stats: { kind: 'list' as const, idKey: 'id' }, keep: scalar, summary: scalar } },
    initialState: { stats: [], keep: 'Neighbor', summary: '0 entries' },
    preview: { version: 1 as const, fields: [{ key: 'summary' }] },
    sourceMigration: { from, migrate(previous: LocalToolJson): State {
      callbackCalls++;
      if (!record(previous) || !record(previous.stats)) throw Error('wrong predecessor fixture');
      const stats = Object.keys(previous.stats).sort().map(id => ({ id, value: Number((previous.stats as State)[id]) + adjustment }));
      previous.stats = stats;
      previous.summary = stats.length + ' entries';
      if (failCallback) throw Error('migration fixture refused');
      return previous;
    } },
    validateState: (value: LocalToolJson): value is State => record(value) && Array.isArray(value.stats) &&
      value.stats.every(item => record(item) && typeof item.id === 'string' && typeof item.value === 'number') &&
      typeof value.keep === 'string' && typeof value.summary === 'string',
  };
  const next = defineLocalTool<State>(target);
  const rejecting = defineLocalTool<State>({
    ...target, stateSchemaVersion: '2.0.1',
    validateState: (value): value is State => target.validateState(value) && value.summary !== '2 entries',
  });
  await rejects('A changed validation version alone does not identify a pre-start migration',
    () => defineLocalTool<State>({ ...old, sourceMigration: target.sourceMigration }), 'local_tool_source_migration_invalid');
  await rejects('A project-wide tool cannot declare a document migration',
    () => defineLocalTool<State>({ ...target, document: undefined }), 'local_tool_source_migration_invalid');
  await rejects('A declaration must have a callable transform',
    () => defineLocalTool<State>({ ...target, sourceMigration: { from, migrate: null! } }), 'local_tool_source_migration_invalid');
  expect('Compiled predecessor metadata is detached and immutable', [
    next.sourceMigration!.from === from, Object.isFrozen(next.sourceMigration!.from.codec.fields.stats),
  ], [false, true]);

  const bytes = new TextEncoder().encode(fixtureSource);
  const sha = async (input: Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), byte => byte.toString(16).padStart(2, '0')).join('');
  const files = [{ path: 'module.tsx', sha256: await sha(bytes), bytes: bytes.length }];
  const releases: LocalToolReleaseManifest[] = await Promise.all(['1.0.0', '2.0.0', '2.0.1', '1.0.1'].map(async version => {
    const identity = { format: 'writers-hoard-local-tool-source/1', apiVersion: 1, namespace, version, files } as const;
    return { ...identity, contentHash: await sha(new TextEncoder().encode(localToolReleaseIdentity(identity))) };
  }));
  const moduleRoot = (hash: string) => './installed/' + namespace + '/versions/' + hash;
  registerLocalToolModules(
    Object.fromEntries(releases.map((release, index) => [moduleRoot(release.contentHash) + '/module.tsx', { default: [old, next, rejecting, other][index] }])),
    Object.fromEntries(releases.map(release => [moduleRoot(release.contentHash) + '/release.json', release])),
  );
  const pin = (id: string, version: number, revision: number | null) => pinLocalToolRelease(id, namespace, releases[version].contentHash, revision);
  const client = (id: string, version: 0 | 1 | 3, documentId: string, eraId?: string) =>
    createLocalToolClient(id, version === 0 ? old : version === 1 ? next : other,
      { documentId, eraId, releaseHash: releases[version].contentHash, requireSelectedRelease: true });
  const read = (id: string, era?: typeof own) => readSourceToolDocument(era ?? scope, id, namespace);
  const history = (id: string) => db.documentHistory.where('projectId').equals(projectId).filter(row => row.kind === 'local-tool' && row.entityId === id).toArray();

  try {
    const project = { id: projectId, title: 'Source migration QA', description: '', mode: 'custom' as const,
      type: 'standalone' as const, status: 'draft' as const, color: '#444444', enabledEngines: ['local-tool-' + namespace], createdAt: 1, updatedAt: 1 };
    await db.projects.bulkAdd([project, { ...project, id: otherId }]);
    const otherPin = await pin(otherId, 3, null);
    const otherDoc = await createSourceToolDocument({ projectId: otherId }, namespace, 'Same map codec, different epoch');
    const otherClient = client(otherId, 3, otherDoc.id);
    await otherClient.convergence!.start(await otherClient.read());
    const otherBefore = await readSourceToolDocument({ projectId: otherId }, otherDoc.id);
    await rejects('Exact predecessor epoch is required for a started document',
      () => pin(otherId, 1, otherPin.revision), 'local_tool_source_migration_origin_mismatch');
    expect('A mismatched origin never executes the callback',
      [callbackCalls, await readSourceToolDocument({ projectId: otherId }, otherDoc.id)], [0, otherBefore]);

    for (const eraId of ['own', 'inherited', 'retained']) {
      await saveWorldEra(projectId, { id: eraId, name: eraId, description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    }
    const first = await pin(projectId, 0, null);
    const doc = await createSourceToolDocument(scope, namespace, 'Authored map');
    const unopened = await createSourceToolDocument(scope, namespace, 'Pre-start map');
    const archived = await createSourceToolDocument(scope, namespace, 'Archived pre-start map');
    const oldArchiveClient = client(projectId, 0, archived.id, inherited.eraId);
    const archivedWorld = (await oldArchiveClient.world.read('local-tool', archived.id))!;
    const archiveBaseline = (await read(archived.id))!;
    await archiveSourceToolDocument(scope, archived.id, namespace, archiveBaseline.document.revision, archiveBaseline.version);
    const oldBase = client(projectId, 0, doc.id);
    await oldBase.convergence!.start(await oldBase.read());
    await oldBase.state!.apply(await oldBase.read(), [
      { type: 'map-set', field: 'stats', key: 'zenith', value: 7 },
      { type: 'map-set', field: 'stats', key: 'aurora', value: 3 },
    ]);
    const oldEra = client(projectId, 0, doc.id, own.eraId);
    await oldEra.state!.apply(await oldEra.read(), [{ type: 'map-set', field: 'stats', key: 'zenith', value: 8 }]);
    const oldPacket = (await oldBase.convergence!.export()).update!;
    const before = (await read(doc.id))!, beforeOwn = (await read(doc.id, own))!, beforeHistory = await history(doc.id);
    expect('The exact old map was authored', before.document.data, { stats: { zenith: 7, aurora: 3 }, keep: 'Neighbor' });

    failCallback = true;
    await rejects('A throwing callback rejects pin', () => pin(projectId, 1, first.revision), 'migration fixture refused');
    failCallback = false;
    await rejects('An invalid projected value rejects pin', () => pin(projectId, 2, first.revision), 'invalid-state');
    expect('Rejected pins preserve root, history and selection', [
      await read(doc.id), await history(doc.id), (await db.projects.get(projectId))!.localToolInstallations![namespace],
    ], [before, beforeHistory, first]);

    const selected = await pin(projectId, 1, first.revision);
    const base = client(projectId, 1, doc.id), era = client(projectId, 1, doc.id, own.eraId);
    const inheritedPre = client(projectId, 1, unopened.id, inherited.eraId);
    const preWorld = (await inheritedPre.world.read('local-tool', unopened.id))!;
    const preProjection = await inheritedPre.read();
    const replacement = { ...preWorld.document, root: { ...preWorld.document.root, data: preProjection.data, codec: next.codec } };
    await rejects('A generic variant save cannot silently migrate the inherited pre-start root',
      () => inheritedPre.world.variants!.save('local-tool', replacement, preWorld.version), 'local_tool_source_migration_required');
    expect('The rejected save keeps inheritance', (await inheritedPre.world.read('local-tool', unopened.id))!.provenance, 'base');
    await inheritedPre.world.variants!.hide('local-tool', unopened.id, preWorld.version);
    await rejects('A hidden predecessor cannot reappear already migrated with a null CAS',
      () => inheritedPre.world.variants!.save('local-tool', replacement, null), 'local_tool_source_migration_required');
    expect('A rejected hidden replacement keeps the root hidden', await inheritedPre.world.read('local-tool', unopened.id), undefined);
    const fork = await inheritedPre.world.variants!.save('local-tool', preWorld.document, null);
    expect('An exact predecessor can still be made into an own variant', [fork.provenance, fork.document.root.data], ['variant', preWorld.document.root.data]);
    const forkMigration = await inheritedPre.convergence!.start(await inheritedPre.read(), { migrate: true });
    expect('The new own variant can migrate with the explicit operation', [forkMigration.changed, forkMigration.snapshot.data], [true, preProjection.data]);
    const archivedClient = client(projectId, 1, archived.id, inherited.eraId);
    const archivedReplacement = { ...archivedWorld.document, root: { ...archivedWorld.document.root, data: preProjection.data, codec: next.codec } };
    await rejects('An archived Base predecessor cannot be recreated already migrated under the same ID',
      () => archivedClient.world.variants!.save('local-tool', archivedReplacement, null), 'local_tool_source_migration_required');
    expect('Rejected replacement preserves the archive and absence',
      [await archivedClient.world.read('local-tool', archived.id), await db.documentArchives.where('sourceId').equals(archived.id).count()],
      [undefined, 1]);
    const archivedFork = await archivedClient.world.variants!.save('local-tool', archivedWorld.document, null);
    expect('An archived predecessor can still be copied in its original codec', archivedFork.document.root.codec, old.codec);
    const projected = await base.read();
    expect('The callback projects a sorted list and keeps the neighboring value',
      projected.data, { stats: [{ id: 'aurora', value: 3 }, { id: 'zenith', value: 7 }], keep: 'Neighbor', summary: '2 entries' });
    const callsBeforeOrdinaryStart = callbackCalls;
    expect('Read and ordinary start preserve the old map root and history',
      [(await base.convergence!.start(projected)).changed, await read(doc.id), await history(doc.id)], [false, before, beforeHistory]);
    expect('Ordinary start projects exactly once', callbackCalls - callsBeforeOrdinaryStart, 1);
    await rejects('Normal writes cannot publish a migration', () => base.state!.apply(projected, [
      { type: 'set', field: 'summary', value: 'Wrong' },
    ]), 'local_tool_source_migration_required');
    await rejects('Migration requires the exact current revision',
      () => base.convergence!.start({ ...projected, revision: projected.revision! - 1 }, { migrate: true }), 'conflict');
    adjustment = 1;
    await rejects('A changed projection cannot be substituted after the caller reads',
      () => base.convergence!.start(projected, { migrate: true }), 'conflict');
    adjustment = 0;
    failCallback = true;
    await rejects('A callback error while applying leaves the old root untouched',
      () => base.convergence!.start(projected, { migrate: true }), 'migration fixture refused');
    failCallback = false;
    const inheritedClient = client(projectId, 1, doc.id, inherited.eraId), inheritedRead = await inheritedClient.read();
    await rejects('A reading inherited era does not create a variant on migration',
      () => inheritedClient.convergence!.start(inheritedRead, { migrate: true }), 'local_tool_source_migration_era_required');
    expect('Rejected writes preserve the Base and own-era roots',
      [await read(doc.id), await read(doc.id, own), await history(doc.id)], [before, beforeOwn, beforeHistory]);

    const retainedClient = client(projectId, 1, doc.id, 'retained');
    const retainedWorld = (await retainedClient.world.read('local-tool', doc.id))!;
    await retainedClient.world.variants!.hide('local-tool', doc.id, retainedWorld.version);
    const withoutCheckpoint = structuredClone(retainedWorld.document);
    delete withoutCheckpoint.root.convergence;
    await retainedClient.world.variants!.save('local-tool', withoutCheckpoint, null);
    const reactivated = await retainedClient.read();
    expect('Reactivating a started root cannot lose its predecessor checkpoint',
      [reactivated.convergence?.validationId, reactivated.convergence?.schemaEpoch,
        reactivated.convergence?.genesisId !== projected.convergence?.genesisId],
      [projected.convergence!.validationId, projected.convergence!.schemaEpoch, true]);
    const reactivatedMigration = await retainedClient.convergence!.start(reactivated, { migrate: true });
    expect('The reactivated predecessor can migrate with a separate operation', reactivatedMigration.snapshot.data, projected.data);

    const preClient = client(projectId, 1, unopened.id), preRead = await preClient.read();
    expect('An unstarted document is projected from its persisted predecessor codec', [preRead.data.stats, preRead.convergence ?? null], [[], null]);
    const pre = await preClient.convergence!.start(preRead, { migrate: true });
    expect('Explicit migration can start an exact unstarted document', [pre.changed, pre.snapshot.revision], [true, preRead.revision! + 1]);

    const applied = await base.convergence!.start(projected, { migrate: true });
    const stored = (await read(doc.id))!, savedHistory = await history(doc.id);
    expect('One revision preserves ID and replaces the genesis with the new codec',
      [applied.changed, applied.snapshot.data, stored.document.id, stored.document.revision,
        stored.document.convergence!.checkpoint.genesisId !== before.document.convergence!.checkpoint.genesisId],
      [true, projected.data, doc.id, before.document.revision + 1, true]);
    expect('Normal history retains the exact previous map root',
      savedHistory.some(row => convergenceHash(row.document.root) === convergenceHash(before.document)), true);
    expect('The root uses the new portable preview and history retains the old one',
      [sourceDocumentPreview(stored.document).fields, sourceDocumentPreview(before.document).fields],
      [[{ label: 'summary', value: '2 entries' }], [{ label: 'keep', value: 'Neighbor' }]]);
    const callsAfterApply = callbackCalls;
    const repeat = await base.convergence!.start(await base.read(), { migrate: true });
    expect('Reopening and retry do not run the callback or write history',
      [repeat.changed, callbackCalls, await read(doc.id), await history(doc.id)], [false, callsAfterApply, stored, savedHistory]);
    await rejects('The new checkpoint rejects predecessor packets', () => base.convergence!.import(oldPacket));
    const migratedEra = await era.convergence!.start(await era.read(), { migrate: true });
    expect('Own-era migration keeps its list independent of Base',
      [migratedEra.snapshot.provenance, migratedEra.snapshot.data.stats, await read(doc.id)],
      ['variant', [{ id: 'aurora', value: 3 }, { id: 'zenith', value: 8 }], stored]);
    const edit = await base.state!.apply(await base.read(), [{ type: 'set', field: 'summary', value: 'Edited' }]);
    expect('A normal edit and Undo use the new checkpoint', (await base.state!.undo(edit.receiptId!)).snapshot.data, projected.data);
    expect('Explicit migration keeps the selected version', (await db.projects.get(projectId))!.localToolInstallations![namespace], selected);

    const host = createFakeLocalToolHost(next, { projects: [{
      id: projectId, updatedAt: 1, worldEras: (await db.projects.get(projectId))!.worldEras,
      sourceToolDocuments: [before.document, unopened],
    }] });
    const memory = host.createClient(scope, false, doc.id);
    const memoryRead = await memory.read();
    const memoryEra = host.createClient(inherited, false, doc.id);
    const memoryEraRead = await memoryEra.read();
    const beforeInvalidMemoryCalls = callbackCalls;
    failCallback = true;
    await rejects('Memory host rejects stale CAS before running the callback',
      () => memory.convergence!.start({ ...memoryRead, revision: memoryRead.revision! - 1 }, { migrate: true }), 'conflict');
    await rejects('Memory host rejects inheritance before running the callback',
      () => memoryEra.convergence!.start(memoryEraRead, { migrate: true }), 'local_tool_source_migration_era_required');
    expect('Memory host did not run the callback for rejected requests', callbackCalls, beforeInvalidMemoryCalls);
    failCallback = false;
    const memoryWorld = (await memoryEra.world.read('local-tool', doc.id))!;
    await memoryEra.world.variants!.hide('local-tool', doc.id, memoryWorld.version);
    const memoryWithoutCheckpoint = structuredClone(memoryWorld.document);
    delete memoryWithoutCheckpoint.root.convergence;
    await memoryEra.world.variants!.save('local-tool', memoryWithoutCheckpoint, null);
    expect('Memory preserves the predecessor checkpoint when a started root reappears',
      (await memoryEra.read()).convergence?.validationId, memoryRead.convergence!.validationId);
    const fakePre = host.createClient(inherited, false, unopened.id);
    const fakeWorld = (await fakePre.world.read('local-tool', unopened.id))!;
    const fakeReplacement = { ...fakeWorld.document, root: { ...fakeWorld.document.root, data: preProjection.data, codec: next.codec } };
    await rejects('Memory generic variants cannot silently migrate the inherited pre-start root',
      () => fakePre.world.variants!.save('local-tool', fakeReplacement, fakeWorld.version), 'local_tool_source_migration_required');
    await fakePre.world.variants!.hide('local-tool', unopened.id, fakeWorld.version);
    await rejects('Memory cannot replace a hidden predecessor by saving the target shape',
      () => fakePre.world.variants!.save('local-tool', fakeReplacement, null), 'local_tool_source_migration_required');
    const fakeFork = await fakePre.world.variants!.save('local-tool', fakeWorld.document, null);
    expect('Memory still accepts a fork in the predecessor codec', fakeFork.provenance, 'variant');
    const changed = await memory.convergence!.start(memoryRead, { migrate: true });
    expect('The testing host projects and migrates through the same SDK contract',
      [memoryRead.data, changed.changed, changed.snapshot.data, changed.snapshot.revision],
      [projected.data, true, projected.data, before.document.revision + 1]);
    return checks;
  } finally {
    for (const id of [projectId, otherId]) if (await db.projects.get(id)) await deleteProject(id);
  }
}
