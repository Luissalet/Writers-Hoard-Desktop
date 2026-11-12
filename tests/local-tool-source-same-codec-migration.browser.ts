import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { saveWorldEra } from '@/services/worldEras/store';
import { localToolConvergenceContext } from '@/engines/local/convergence/context';
import { convergenceCanonical, convergenceHash } from '@/engines/local/convergence/format';
import { sourceDocumentPreview } from '@/engines/local/documents/preview';
import { createSourceToolDocument, readSourceToolDocument } from '@/engines/local/documents/store';
import { registerLocalToolModules } from '@/engines/local/registry';
import { localToolReleaseIdentity, type LocalToolReleaseManifest } from '@/engines/local/releaseFormat.mjs';
import { pinLocalToolRelease } from '@/engines/local/releases';
import { defineLocalTool, type LocalToolJson } from '@/engines/local/sdk';
import { createLocalToolClient } from '@/engines/local/storage';
import { createFakeLocalToolHost } from '@/engines/local/testing';
import fixtureSource from './local-tool-source-same-codec-migration.browser.ts?raw';

type State = Record<string, LocalToolJson>;

export async function testSourceSameCodecMigration(): Promise<string[]> {
  const namespace = 'tests.source-same-codec-migration', projectId = 'qa-source-same-codec-' + crypto.randomUUID();
  const otherId = projectId + '-other';
  const scope = { projectId }, own = { projectId, eraId: 'own' }, inherited = { projectId, eraId: 'inherited' };
  const checks: string[] = [];
  const exact = (value: unknown) => convergenceCanonical(JSON.parse(JSON.stringify(value,
    (_key, entry) => entry === undefined ? { fixtureUndefined: true } : entry)));
  function expect(label: string, actual: unknown, expected: unknown) {
    if (exact(actual) !== exact(expected)) throw Error(label + ': ' + JSON.stringify(actual));
    checks.push(label);
  }
  async function rejects(label: string, operation: () => unknown, expected: string) {
    let failure: string | null = null;
    try { await operation(); } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    expect(label, failure, expected);
  }

  const label = { en: 'Source codec migration', es: 'Migración de codec Source' };
  const valid = (value: LocalToolJson): value is State => !!value && typeof value === 'object' &&
    !Array.isArray(value) && typeof value.name === 'string' && typeof value.keep === 'string';
  const old = defineLocalTool<State>({
    namespace, name: label, description: label, document: { defaultTitle: label }, component: () => null,
    stateSchemaVersion: '1.0.0', codec: { version: 1, fields: { name: { kind: 'scalar' }, keep: { kind: 'scalar' } } },
    initialState: { name: 'default', keep: 'Neighbor' }, preview: { version: 1, fields: [{ key: 'keep' }] },
    validateState: valid,
  });
  const other = defineLocalTool<State>({ ...old, stateSchemaVersion: '1.0.1' });
  const from = { namespace, codec: old.codec!, ...localToolConvergenceContext(old)! };
  let calls = 0;
  const sourceMigration = { from, migrate(previous: LocalToolJson): State {
    calls++;
    if (!valid(previous)) throw Error('unexpected predecessor in fixture');
    return { ...previous, name: String(previous.name).replace(/^Draft: /, '') };
  } };
  await rejects('Same codec requires a different validation version',
    () => defineLocalTool<State>({ ...old, sourceMigration }), 'local_tool_source_migration_invalid');
  const next = defineLocalTool<State>({
    ...old, stateSchemaVersion: '2.0.0', sourceMigration,
    preview: { version: 1, fields: [{ key: 'name' }] },
    validateState: (value): value is State => valid(value) && !String(value.name).startsWith('Draft: '),
  });
  const destination = localToolConvergenceContext(next)!;

  const bytes = new TextEncoder().encode(fixtureSource);
  const sha = async (input: Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), byte => byte.toString(16).padStart(2, '0')).join('');
  const files = [{ path: 'module.tsx', sha256: await sha(bytes), bytes: bytes.length }];
  const releases: LocalToolReleaseManifest[] = await Promise.all(['1.0.0', '2.0.0', '1.0.1'].map(async version => {
    const identity = { format: 'writers-hoard-local-tool-source/1', apiVersion: 1, namespace, version, files } as const;
    return { ...identity, contentHash: await sha(new TextEncoder().encode(localToolReleaseIdentity(identity))) };
  }));
  const moduleRoot = (hash: string) => './installed/' + namespace + '/versions/' + hash;
  const definitions = [old, next, other];
  registerLocalToolModules(
    Object.fromEntries(releases.map((release, index) => [moduleRoot(release.contentHash) + '/module.tsx', { default: definitions[index] }])),
    Object.fromEntries(releases.map(release => [moduleRoot(release.contentHash) + '/release.json', release])),
  );
  const pin = (id: string, version: number, revision: number | null) => pinLocalToolRelease(id, namespace, releases[version].contentHash, revision);
  const client = (id: string, version: number, documentId: string, eraId?: string) =>
    createLocalToolClient(id, definitions[version], { documentId, eraId, releaseHash: releases[version].contentHash, requireSelectedRelease: true });
  const raw = (documentId: string, era?: typeof own) => readSourceToolDocument(era ?? scope, documentId, namespace);
  const history = (id: string) => db.documentHistory.where('projectId').equals(projectId).filter(row => row.kind === 'local-tool' && row.entityId === id).toArray();

  try {
    const project = { id: projectId, title: 'Source codec migration QA', description: '', mode: 'custom' as const,
      type: 'standalone' as const, status: 'draft' as const, color: '#444444', enabledEngines: ['local-tool-' + namespace], createdAt: 1, updatedAt: 1 };
    await db.projects.bulkAdd([project, { ...project, id: otherId }]);
    const otherPin = await pin(otherId, 2, null);
    const otherScope = { projectId: otherId };
    const wrong = await createSourceToolDocument(otherScope, namespace, 'Other validation version');
    const wrongClient = client(otherId, 2, wrong.id);
    await wrongClient.convergence!.start(await wrongClient.read());
    const wrongRoot = await readSourceToolDocument(otherScope, wrong.id);
    await rejects('A same-codec checkpoint with neither identity rejects the pin',
      () => pin(otherId, 1, otherPin.revision), 'local_tool_source_migration_origin_mismatch');
    expect('Unknown epochs never call the transform or mutate the root',
      [calls, await readSourceToolDocument(otherScope, wrong.id)], [0, wrongRoot]);

    for (const eraId of ['own', 'inherited']) {
      await saveWorldEra(projectId, { id: eraId, name: eraId, description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    }
    const first = await pin(projectId, 0, null);
    const doc = await createSourceToolDocument(scope, namespace, 'Authored Base text');
    const unopened = await createSourceToolDocument(scope, namespace, 'Unstarted predecessor');
    const oldBase = client(projectId, 0, doc.id);
    await oldBase.convergence!.start(await oldBase.read());
    await oldBase.state!.apply(await oldBase.read(), [{ type: 'set', field: 'name', value: 'Draft: Storm' }]);
    const oldOwn = client(projectId, 0, doc.id, own.eraId);
    await oldOwn.state!.apply(await oldOwn.read(), [{ type: 'set', field: 'name', value: 'Draft: Dusk' }]);
    const oldPacket = (await oldBase.convergence!.export()).update!;
    const before = (await raw(doc.id))!, beforeOwn = (await raw(doc.id, own))!, beforeHistory = await history(doc.id);

    await pin(projectId, 1, first.revision);
    const base = client(projectId, 1, doc.id);
    const projection = await base.read();
    expect('Earlier validation projects the changed value with unchanged field shape',
      [projection.data, projection.convergence!.validationId, projection.convergence!.schemaEpoch],
      [{ name: 'Storm', keep: 'Neighbor' }, from.validationId, from.schemaEpoch]);
    const oldExport = await base.convergence!.export();
    expect('Export retains the previous data and checkpoint until migration',
      [oldExport.snapshot.data, oldExport.checkpoint], [{ name: 'Draft: Storm', keep: 'Neighbor' }, before.document.convergence!.checkpoint]);
    const ordinary = await base.convergence!.start(projection);
    expect('Ordinary start returns the old checkpoint and preserves bytes',
      [ordinary.changed, ordinary.checkpoint, await raw(doc.id), await history(doc.id)],
      [false, before.document.convergence!.checkpoint, before, beforeHistory]);
    await rejects('Pending same-codec migration blocks ordinary writes',
      () => base.state!.apply(projection, [{ type: 'set', field: 'name', value: 'Wrong' }]), 'local_tool_source_migration_required');
    await rejects('Explicit migration checks exact revision even with an unchanged codec',
      () => base.convergence!.start({ ...projection, revision: projection.revision! - 1 }, { migrate: true }), 'conflict');
    const inheritedClient = client(projectId, 1, doc.id, inherited.eraId);
    const inheritedRead = await inheritedClient.read();
    await rejects('An inherited document cannot be migrated into a new variant implicitly',
      () => inheritedClient.convergence!.start(inheritedRead, { migrate: true }), 'local_tool_source_migration_era_required');

    const preClient = client(projectId, 1, unopened.id);
    const callsBeforePre = calls, pre = await preClient.read();
    expect('A matching codec alone never executes the callback on an unstarted root',
      [pre.data, pre.convergence ?? null, calls], [{ name: 'default', keep: 'Neighbor' }, null, callsBeforePre]);
    await rejects('An ambiguous unstarted root cannot migrate by request',
      () => preClient.convergence!.start(pre, { migrate: true }), 'local_tool_source_migration_unavailable');
    const startedPre = await preClient.convergence!.start(pre);
    expect('Ordinary start assigns the selected validation to the unstarted root',
      [startedPre.checkpoint.validationId, startedPre.snapshot.data, calls], [destination.validationId, pre.data, callsBeforePre]);
    const fresh = await createSourceToolDocument(scope, namespace, 'New destination document');
    const freshClient = client(projectId, 1, fresh.id), freshStart = await freshClient.convergence!.start(await freshClient.read());
    expect('A newly authored destination never executes the predecessor callback',
      [freshStart.checkpoint.validationId, freshStart.snapshot.data, calls], [destination.validationId, next.initialState, callsBeforePre]);

    const migrated = await base.convergence!.start(projection, { migrate: true });
    const stored = (await raw(doc.id))!, savedHistory = await history(doc.id);
    expect('Explicit migration changes one revision, validation and genesis with identical codec hash',
      [migrated.changed, stored.document.id, stored.document.revision, migrated.checkpoint.codecHash,
        migrated.checkpoint.validationId, migrated.checkpoint.schemaEpoch, migrated.checkpoint.genesisId !== projection.convergence!.genesisId],
      [true, doc.id, before.document.revision + 1, projection.convergence!.codecHash, destination.validationId, destination.schemaEpoch, true]);
    expect('History preserves the exact authored predecessor',
      savedHistory.some(row => convergenceHash(row.document.root) === convergenceHash(before.document)), true);
    expect('Portable preview switches to the migrated value', sourceDocumentPreview(stored.document).fields, [{ label: 'name', value: 'Storm' }]);
    const callsAfterMigration = calls;
    const reopened = client(projectId, 1, doc.id), repeated = await reopened.convergence!.start(await reopened.read(), { migrate: true });
    expect('Reopen and retry preserve bytes and never call the callback again',
      [repeated.changed, calls, await raw(doc.id), await history(doc.id)], [false, callsAfterMigration, stored, savedHistory]);
    await rejects('The previous validation cannot send updates to the target checkpoint',
      () => base.convergence!.import(oldPacket), 'local_tool_convergence_identity_mismatch');

    const ownClient = client(projectId, 1, doc.id, own.eraId);
    const ownChange = await ownClient.convergence!.start(await ownClient.read(), { migrate: true });
    expect('Own-era migration changes only its value and revision',
      [ownChange.snapshot.data.name, ownChange.snapshot.revision, await raw(doc.id)],
      ['Dusk', beforeOwn.document.revision + 1, stored]);
    const edit = await base.state!.apply(await base.read(), [{ type: 'set', field: 'name', value: 'Revised' }]);
    expect('A new edit and Undo use the destination epoch',
      (await base.state!.undo(edit.receiptId!)).snapshot.data, projection.data);

    const fake = createFakeLocalToolHost(next, { projects: [{ id: projectId, updatedAt: 1, sourceToolDocuments: [before.document, unopened] }] });
    const memory = fake.createClient(scope, false, doc.id);
    const fakeResult = await memory.convergence!.start(await memory.read(), { migrate: true });
    const fakePre = fake.createClient(scope, false, unopened.id);
    expect('The testing host distinguishes matching origin, destination and ambiguous pre-start',
      [fakeResult.snapshot.data, fakeResult.checkpoint.validationId,
        (await memory.convergence!.start(await memory.read(), { migrate: true })).changed, (await fakePre.read()).data],
      [projection.data, destination.validationId, false, pre.data]);
    return checks;
  } finally {
    for (const id of [projectId, otherId]) if (await db.projects.get(id)) await deleteProject(id);
  }
}
