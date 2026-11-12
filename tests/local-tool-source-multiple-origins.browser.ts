import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { saveWorldEra } from '@/services/worldEras/store';
import { localToolConvergenceContext } from '@/engines/local/convergence/context';
import { convergenceCanonical, convergenceHash } from '@/engines/local/convergence/format';
import { createSourceToolDocument, readSourceToolDocument } from '@/engines/local/documents/store';
import { registerLocalToolModules } from '@/engines/local/registry';
import { localToolReleaseIdentity, type LocalToolReleaseManifest } from '@/engines/local/releaseFormat.mjs';
import { pinLocalToolRelease } from '@/engines/local/releases';
import { defineLocalTool, type LocalToolJson, type LocalToolSourceMigration } from '@/engines/local/sdk';
import { createLocalToolClient } from '@/engines/local/storage';
import { createFakeLocalToolHost } from '@/engines/local/testing';

type State = Record<string, LocalToolJson>;

export async function testSourceMultipleMigrationOrigins(): Promise<string[]> {
  const projectId = 'qa-source-multiple-origins-' + crypto.randomUUID(), otherId = projectId + '-other', scope = { projectId };
  const own = { projectId, eraId: 'own' }, inherited = { projectId, eraId: 'inherited' };
  const namespace = 'tests.source-multiple-migration-origins';
  const display = { en: 'Migration origins', es: 'Orígenes de migración' };
  const common = { namespace, name: display, description: display, document: { defaultTitle: display }, component: () => null };
  const checks: string[] = [];
  const exact = (value: unknown) => convergenceCanonical(JSON.parse(JSON.stringify(value,
    (_key, entry) => entry === undefined ? { fixtureUndefined: true } : entry)));
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (exact(actual) !== exact(expected)) throw Error(label + ': ' + JSON.stringify(actual));
    checks.push(label);
  };
  const rejects = async (label: string, action: () => unknown, message: string) => {
    let result: string | null = null;
    try { await action(); } catch (error) { result = error instanceof Error ? error.message : String(error); }
    expect(label, result, message);
  };
  const record = (value: LocalToolJson): value is State => !!value && typeof value === 'object' && !Array.isArray(value);
  const scalar = { kind: 'scalar' } as const;
  const first = defineLocalTool<State>({
    ...common, stateSchemaVersion: '1.0.0', codec: { version: 1, fields: { label: scalar, keep: scalar } },
    initialState: { label: 'none', keep: 'Neighbor' },
    validateState: (value): value is State => record(value) && typeof value.label === 'string' && typeof value.keep === 'string',
  });
  const other = defineLocalTool<State>({ ...first, stateSchemaVersion: '1.0.1' });
  const fromFirst = { namespace, codec: first.codec!, ...localToolConvergenceContext(first)! };
  const middle = defineLocalTool<State>({
    ...common, stateSchemaVersion: '2.0.0', codec: { version: 1, fields: { scores: { kind: 'map' }, keep: scalar } },
    initialState: { scores: {}, keep: 'Neighbor' },
    sourceMigration: { from: fromFirst, migrate(this: void, previous) {
      if (arguments.length !== 1 || this !== undefined) throw Error('single-origin callback invocation changed');
      return { scores: {}, keep: (previous as State).keep };
    } },
    validateState: (value): value is State => record(value) && record(value.scores) && typeof value.keep === 'string' &&
      Object.values(value.scores).every(item => typeof item === 'number'),
  });
  const fromMiddle = { namespace, codec: middle.codec!, ...localToolConvergenceContext(middle)! };
  const seen: string[] = [], metadataFrozen: boolean[] = [];
  const additional = [fromMiddle];
  const migrate: LocalToolSourceMigration<State>['migrate'] = (previous, from) => {
    if (!from || !record(previous)) throw Error('unidentified predecessor in fixture');
    seen.push(from.validationId);
    metadataFrozen.push(Object.isFrozen(from) && Object.isFrozen(from.codec.fields));
    if (from.validationId === fromFirst.validationId && first.validateState(previous)) {
      return { entries: [{ id: 'label', value: previous.label }], keep: previous.keep };
    }
    if (from.validationId !== fromMiddle.validationId || !middle.validateState(previous) || !record(previous.scores)) {
      throw Error('wrong predecessor in fixture');
    }
    const scores = previous.scores;
    return { entries: Object.keys(scores).sort().map(id => ({ id, value: String(scores[id]) })), keep: previous.keep };
  };
  const target = {
    ...common, stateSchemaVersion: '3.0.0', codec: { version: 1 as const, fields: { entries: { kind: 'list' as const, idKey: 'id' }, keep: scalar } },
    initialState: { entries: [], keep: 'Neighbor' },
    sourceMigration: { from: fromFirst, additionalPredecessors: additional, migrate },
    validateState: (value: LocalToolJson): value is State => record(value) && Array.isArray(value.entries) &&
      value.entries.every(item => record(item) && typeof item.id === 'string' && typeof item.value === 'string') &&
      typeof value.keep === 'string',
  };
  await rejects('Duplicate codecs cannot give a pre-start root conflicting origins',
    () => defineLocalTool<State>({ ...target, sourceMigration: { ...target.sourceMigration, additionalPredecessors: [fromFirst] } }),
    'local_tool_source_migration_invalid');
  await rejects('A second origin cannot be from an unrelated namespace',
    () => defineLocalTool<State>({ ...target, sourceMigration: { ...target.sourceMigration,
      additionalPredecessors: [{ ...fromMiddle, namespace: 'tests.other' }] } }), 'local_tool_source_migration_invalid');
  const latest = defineLocalTool<State>(target);
  const rejecting = defineLocalTool<State>({
    ...target, stateSchemaVersion: '3.0.1',
    validateState: (value): value is State => target.validateState(value) &&
      !(value.entries as LocalToolJson[]).some(item => record(item) && item.value === '7'),
  });
  additional.length = 0;
  expect('Compiled origins are independent of the caller array',
    [latest.sourceMigration!.additionalPredecessors!.length, Object.isFrozen(latest.sourceMigration!.additionalPredecessors)], [1, true]);
  const definitions = [first, middle, latest, rejecting, other];
  const encoder = new TextEncoder();
  const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const releases: LocalToolReleaseManifest[] = await Promise.all(['1.0.0', '2.0.0', '3.0.0', '3.0.1', '1.0.1'].map(async version => {
    const source = 'synthetic multiple-origin fixture ' + version;
    const identity = { format: 'writers-hoard-local-tool-source/1', apiVersion: 1, namespace, version,
      files: [{ path: 'module.tsx', sha256: await sha(source), bytes: encoder.encode(source).length }] } as const;
    return { ...identity, contentHash: await sha(localToolReleaseIdentity(identity)) };
  }));
  const moduleRoot = (hash: string) => './installed/' + namespace + '/versions/' + hash;
  registerLocalToolModules(
    Object.fromEntries(releases.map((release, index) => [moduleRoot(release.contentHash) + '/module.tsx', { default: definitions[index] }])),
    Object.fromEntries(releases.map(release => [moduleRoot(release.contentHash) + '/release.json', release])),
  );
  const pin = (version: number, revision: number | null, id = projectId) => pinLocalToolRelease(id, namespace, releases[version].contentHash, revision);
  const client = (version: number, documentId: string, eraId?: string, id = projectId) => createLocalToolClient(id, definitions[version],
    { documentId, eraId, releaseHash: releases[version].contentHash, requireSelectedRelease: true });
  const raw = (id: string, area = scope) => readSourceToolDocument(area, id, namespace);
  const history = () => db.documentHistory.where('projectId').equals(projectId).toArray();

  try {
    const project = { id: projectId, title: 'QA Source migration origins', description: '', mode: 'custom' as const, type: 'standalone' as const,
      status: 'draft' as const, color: '#444444', enabledEngines: ['local-tool-' + namespace], createdAt: 1, updatedAt: 1 };
    await db.projects.bulkAdd([project, { ...project, id: otherId }]);
    const otherPin = await pin(4, null, otherId), wrong = await createSourceToolDocument({ projectId: otherId }, namespace, 'Other epoch');
    const wrongClient = client(4, wrong.id, undefined, otherId);
    await wrongClient.convergence!.start(await wrongClient.read());
    const wrongBefore = await raw(wrong.id, { projectId: otherId });
    await rejects('An unknown epoch with a declared codec fails before the callback',
      () => pin(2, otherPin.revision, otherId), 'local_tool_source_migration_origin_mismatch');
    expect('An unknown epoch leaves its exact data and history authority alone',
      [seen.length, await raw(wrong.id, { projectId: otherId })], [0, wrongBefore]);

    for (const eraId of [own.eraId, inherited.eraId]) {
      await saveWorldEra(projectId, { id: eraId, name: eraId, description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    }
    const v1 = await pin(0, null);
    const docFirst = await createSourceToolDocument(scope, namespace, 'Authored in V1');
    const docMiddle = await createSourceToolDocument(scope, namespace, 'Migrated to V2');
    const preFirst = await createSourceToolDocument(scope, namespace, 'Unstarted V1');
    const old = client(0, docFirst.id), previousMiddle = client(0, docMiddle.id), oldOwn = client(0, docFirst.id, own.eraId);
    await old.convergence!.start(await old.read());
    await old.state!.apply(await old.read(), [{ type: 'set', field: 'label', value: 'Storm' }]);
    await oldOwn.state!.apply(await oldOwn.read(), [{ type: 'set', field: 'label', value: 'Dusk' }]);
    const packetFirst = (await old.convergence!.export()).update!;
    await previousMiddle.convergence!.start(await previousMiddle.read());
    const v2 = await pin(1, v1.revision);
    const newMiddle = client(1, docMiddle.id);
    await newMiddle.convergence!.start(await newMiddle.read(), { migrate: true });
    await newMiddle.state!.apply(await newMiddle.read(), [
      { type: 'map-set', field: 'scores', key: 'zenith', value: 7 },
      { type: 'map-set', field: 'scores', key: 'aurora', value: 3 },
    ]);
    const packetMiddle = (await newMiddle.convergence!.export()).update!;
    const preMiddle = await createSourceToolDocument(scope, namespace, 'Unstarted V2');
    const beforeFirst = (await raw(docFirst.id))!, beforeMiddle = (await raw(docMiddle.id))!;
    const beforeOwn = (await raw(docFirst.id, own))!, beforeHistory = await history();
    const exactSources = () => Promise.all([raw(docFirst.id), raw(docMiddle.id), raw(docFirst.id, own), history()]);
    await rejects('Pin validates the projection of both predecessors before selecting',
      () => pin(3, v2.revision), 'invalid-state');
    expect('A failed selection preserves both roots, their history and the V2 pin',
      [await exactSources(), (await db.projects.get(projectId))!.localToolInstallations![namespace]],
      [[beforeFirst, beforeMiddle, beforeOwn, beforeHistory], v2]);

    seen.length = 0;
    const selected = await pin(2, v2.revision);
    expect('One V3 selects with both active and retained origins without writing',
      await exactSources(), [beforeFirst, beforeMiddle, beforeOwn, beforeHistory]);
    expect('Both exact predecessor metadata objects reached the callback',
      [[...new Set(seen)].sort(), metadataFrozen.every(Boolean)], [[fromFirst.validationId, fromMiddle.validationId].sort(), true]);
    const left = client(2, docFirst.id), right = client(2, docMiddle.id);
    const leftRead = await left.read(), rightRead = await right.read();
    const expectedLeft = { entries: [{ id: 'label', value: 'Storm' }], keep: 'Neighbor' };
    const expectedRight = { entries: [{ id: 'aurora', value: '3' }, { id: 'zenith', value: '7' }], keep: 'Neighbor' };
    expect('Reads apply the correct transform for each shape', [leftRead.data, rightRead.data], [expectedLeft, expectedRight]);
    const ordinary = await right.convergence!.start(rightRead);
    expect('Ordinary start keeps the intermediate checkpoint',
      [ordinary.changed, ordinary.checkpoint], [false, beforeMiddle.document.convergence!.checkpoint]);
    await rejects('The explicit writer still rejects stale observations',
      () => left.convergence!.start({ ...leftRead, revision: leftRead.revision! - 1 }, { migrate: true }), 'conflict');
    const inheritedClient = client(2, docFirst.id, inherited.eraId), inheritedRead = await inheritedClient.read();
    await rejects('The V1 inherited read cannot implicitly create a variant',
      () => inheritedClient.convergence!.start(inheritedRead, { migrate: true }), 'local_tool_source_migration_era_required');

    const preLeft = client(2, preFirst.id), preRight = client(2, preMiddle.id);
    expect('Unique old codecs identify the correct pre-start transformations',
      [(await preLeft.read()).data, (await preRight.read()).data],
      [{ entries: [{ id: 'label', value: 'none' }], keep: 'Neighbor' }, { entries: [], keep: 'Neighbor' }]);
    const preStarted = await preRight.convergence!.start(await preRight.read(), { migrate: true });
    expect('The secondary predecessor can migrate before its first checkpoint', [preStarted.changed, preStarted.snapshot.revision], [true, preMiddle.revision + 1]);

    const leftDone = await left.convergence!.start(leftRead, { migrate: true });
    const rightDone = await right.convergence!.start(rightRead, { migrate: true });
    expect('Both paths keep their document ID and store one new genesis in one revision', [
      leftDone.snapshot.document!.id, leftDone.snapshot.revision, leftDone.checkpoint.genesisId !== leftRead.convergence!.genesisId,
      rightDone.snapshot.document!.id, rightDone.snapshot.revision, rightDone.checkpoint.genesisId !== rightRead.convergence!.genesisId,
    ], [docFirst.id, leftRead.revision! + 1, true, docMiddle.id, rightRead.revision! + 1, true]);
    const savedHistory = await history();
    expect('Historial retains both displaced roots with their authored state',
      [beforeFirst, beforeMiddle].map(prior => savedHistory.some(row => convergenceHash(row.document.root) === convergenceHash(prior.document))), [true, true]);
    const once = seen.length;
    const repeat = await right.convergence!.start(await right.read(), { migrate: true });
    const newDoc = await createSourceToolDocument(scope, namespace, 'Fresh V3'), newClient = client(2, newDoc.id);
    await newClient.convergence!.start(await newClient.read());
    expect('Retry and a new target do not run either callback branch', [repeat.changed, seen.length], [false, once]);
    await rejects('V1 packets remain in their predecessor identity', () => left.convergence!.import(packetFirst), 'local_tool_convergence_identity_mismatch');
    await rejects('V2 packets remain in their predecessor identity', () => right.convergence!.import(packetMiddle), 'local_tool_convergence_identity_mismatch');
    const ownClient = client(2, docFirst.id, own.eraId), ownDone = await ownClient.convergence!.start(await ownClient.read(), { migrate: true });
    expect('An owned era uses the certified V1 callback and keeps Base distinct',
      [ownDone.snapshot.data, (await left.read()).data], [{ entries: [{ id: 'label', value: 'Dusk' }], keep: 'Neighbor' }, expectedLeft]);
    expect('Explicit migration keeps the selected release', (await db.projects.get(projectId))!.localToolInstallations![namespace], selected);

    const fake = createFakeLocalToolHost(latest, { projects: [{ id: projectId, updatedAt: 1, sourceToolDocuments: [beforeFirst.document, beforeMiddle.document] }] });
    const fakeLeft = fake.createClient(scope, false, docFirst.id), fakeRight = fake.createClient(scope, false, docMiddle.id);
    expect('The testing host selects both origins and applies the same transforms',
      [(await fakeLeft.convergence!.start(await fakeLeft.read(), { migrate: true })).snapshot.data,
        (await fakeRight.convergence!.start(await fakeRight.read(), { migrate: true })).snapshot.data],
      [expectedLeft, expectedRight]);
    return checks;
  } finally {
    for (const id of [projectId, otherId]) if (await db.projects.get(id)) await deleteProject(id);
  }
}
