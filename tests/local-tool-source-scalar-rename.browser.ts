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
import fixtureSource from './local-tool-source-scalar-rename.browser.ts?raw';

type State = Record<string, LocalToolJson>;

export async function testSourceScalarRename(): Promise<string[]> {
  const namespace = 'tests.source-scalar-rename', projectId = 'qa-scalar-rename-' + crypto.randomUUID();
  const otherProjectId = projectId + '-other-epoch';
  const scope = { projectId }, variantScope = { projectId, eraId: 'own' }, inheritedScope = { projectId, eraId: 'inherited' };
  const checks: string[] = [];
  const exact = (value: unknown) => convergenceCanonical(JSON.parse(JSON.stringify(value,
    (_key, entry) => entry === undefined ? { fixtureUndefined: true } : entry)));
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (exact(actual) !== exact(expected)) throw Error(label + ': ' + JSON.stringify(actual));
    checks.push(label);
  };
  const rejects = async (label: string, operation: () => Promise<unknown>, error?: string) => {
    let result: string | null = null;
    try { await operation(); } catch (failure) { result = failure instanceof Error ? failure.message : String(failure); }
    expect(label, error === undefined ? Boolean(result) : result, error ?? true);
  };
  const label = { en: 'Source rename', es: 'Renombrado de Source' };
  const common = { namespace, name: label, description: label, document: { defaultTitle: label }, component: () => null };
  const valid = (value: LocalToolJson, field: string, optional = false): value is State =>
    !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.keep === 'string' &&
    (typeof value[field] === 'string' || optional && !Object.hasOwn(value, field));
  const scalar = { kind: 'scalar' } as const;
  const old = defineLocalTool<State>({
    ...common, stateSchemaVersion: '1.0.0',
    codec: { version: 1, fields: { name: scalar, keep: scalar } },
    preview: { version: 1, fields: [{ key: 'name' }] },
    initialState: { name: 'Default', keep: 'Keep' }, validateState: (value): value is State => valid(value, 'name'),
  });
  const otherOld = defineLocalTool<State>({
    ...old, stateSchemaVersion: '1.0.1', initialState: { keep: 'Keep' },
    validateState: (value): value is State => valid(value, 'name', true),
  });
  const earlier = { namespace, codec: old.codec!, ...localToolConvergenceContext(old)! };
  const rename = { from: earlier, oldField: 'name', newField: 'title' };
  const target = {
    ...common, stateSchemaVersion: '1.1.0', codec: { version: 1 as const, fields: { title: scalar, keep: scalar } },
    initialState: { title: 'New default', keep: 'Keep' }, sourceScalarRename: rename,
    preview: { version: 1 as const, fields: [{ key: 'title' }] },
    validateState: (value: LocalToolJson): value is State => valid(value, 'title', true),
  };
  const latest = defineLocalTool<State>(target);
  const rejecting = defineLocalTool<State>({
    ...target, stateSchemaVersion: '1.1.1',
    validateState: (value): value is State => valid(value, 'title') && value.title !== 'V1 authored name',
  });
  let badDeclaration = false;
  try { defineLocalTool<State>({ ...target, sourceScalarRename: { ...rename, newField: 'keep' } }); }
  catch { badDeclaration = true; }
  expect('Reject a rename into an existing field', badDeclaration, true);

  const bytes = new TextEncoder().encode(fixtureSource);
  const sha = async (input: Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), byte => byte.toString(16).padStart(2, '0')).join('');
  const files = [{ path: 'module.tsx', sha256: await sha(bytes), bytes: bytes.length }];
  const releases: LocalToolReleaseManifest[] = await Promise.all(['1.0.0', '1.1.0', '1.1.1', '1.0.1'].map(async version => {
    const identity = { format: 'writers-hoard-local-tool-source/1', apiVersion: 1, namespace, version, files } as const;
    return { ...identity, contentHash: await sha(new TextEncoder().encode(localToolReleaseIdentity(identity))) };
  }));
  const moduleRoot = (hash: string) => './installed/' + namespace + '/versions/' + hash;
  registerLocalToolModules(
    Object.fromEntries(releases.map((release, index) => [moduleRoot(release.contentHash) + '/module.tsx', { default: [old, latest, rejecting, otherOld][index] }])),
    Object.fromEntries(releases.map(release => [moduleRoot(release.contentHash) + '/release.json', release])),
  );
  const pin = (version: number, revision: number | null) => pinLocalToolRelease(projectId, namespace, releases[version].contentHash, revision);
  const api = (id: string, version: 0 | 1, eraId?: string) => createLocalToolClient(projectId, version ? latest : old,
    { documentId: id, eraId, releaseHash: releases[version].contentHash, requireSelectedRelease: true });
  const roots = (id: string) => db.documentHistory.where('projectId').equals(projectId).filter(row => row.kind === 'local-tool' && row.entityId === id).toArray();

  try {
    await db.projects.add({ id: projectId, title: 'Source scalar rename QA', description: '', mode: 'custom',
      type: 'standalone', status: 'draft', color: '#444444', enabledEngines: ['local-tool-' + namespace], createdAt: 1, updatedAt: 1 });
    const project = (await db.projects.get(projectId))!;
    await db.projects.add({ ...project, id: otherProjectId });
    const wrongPin = await pinLocalToolRelease(otherProjectId, namespace, releases[3].contentHash, null);
    const otherScope = { projectId: otherProjectId };
    const otherDocument = await createSourceToolDocument(otherScope, namespace, 'Same codec, other epoch');
    const otherApi = createLocalToolClient(otherProjectId, otherOld, { documentId: otherDocument.id,
      releaseHash: releases[3].contentHash, requireSelectedRelease: true });
    await otherApi.convergence!.start(await otherApi.read());
    const otherBefore = await readSourceToolDocument(otherScope, otherDocument.id);
    await rejects('Pin rejects the same old codec with an incompatible started epoch',
      () => pinLocalToolRelease(otherProjectId, namespace, releases[1].contentHash, wrongPin.revision), 'local_tool_source_migration_origin_mismatch');
    expect('An incompatible origin preserves the source root and release',
      [await readSourceToolDocument(otherScope, otherDocument.id), (await db.projects.get(otherProjectId))!.localToolInstallations![namespace]],
      [otherBefore, wrongPin]);
    for (const id of ['own', 'inherited']) {
      await saveWorldEra(projectId, { id, name: id, description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    }
    const first = await pin(0, null), document = await createSourceToolDocument(scope, namespace, 'Rename in Base and era');
    const unopened = await createSourceToolDocument(scope, namespace, 'Unstarted predecessor');
    const oldBase = api(document.id, 0);
    await oldBase.convergence!.start(await oldBase.read());
    await oldBase.state!.apply(await oldBase.read(), [
      { type: 'set', field: 'name', value: 'V1 authored name' }, { type: 'set', field: 'keep', value: 'Retained' },
    ]);
    const oldVariant = api(document.id, 0, 'own');
    await oldVariant.state!.apply(await oldVariant.read(), [{ type: 'set', field: 'name', value: 'V1 era name' }]);
    const beforeBase = (await readSourceToolDocument(scope, document.id))!;
    const beforeVariant = (await readSourceToolDocument(variantScope, document.id))!;
    const beforeRoots = await roots(document.id);
    const oldPacket = (await oldBase.convergence!.export()).update!;
    await rejects('Pin rejects a projected value forbidden by the target validator', () => pin(2, first.revision), 'invalid-state');
    expect('Invalid pin changes neither root nor selection', [
      await readSourceToolDocument(scope, document.id), (await db.projects.get(projectId))!.localToolInstallations![namespace],
    ], [beforeBase, first]);
    const second = await pin(1, first.revision);
    const base = api(document.id, 1), variant = api(document.id, 1, 'own'), inherited = api(document.id, 1, 'inherited');
    const unopenedApi = api(unopened.id, 1), unopenedRead = await unopenedApi.read();
    expect('Pre-start roots retain their exact codec and project without a checkpoint',
      [unopenedRead.data, unopenedRead.convergence ?? null], [{ title: 'Default', keep: 'Keep' }, null]);
    await rejects('A pre-start predecessor cannot initialize without explicit migration',
      () => unopenedApi.convergence!.start(unopenedRead), 'local_tool_source_migration_required');
    await rejects('A pre-start predecessor cannot write through ordinary save',
      () => unopenedApi.state!.apply(unopenedRead, [{ type: 'set', field: 'title', value: 'Wrong' }]), 'local_tool_source_migration_required');
    const newlyStarted = await unopenedApi.convergence!.start(unopenedRead, { migrate: true });
    expect('Explicit migration can initialize an exact pre-start predecessor',
      [newlyStarted.changed, newlyStarted.snapshot.data, newlyStarted.snapshot.revision], [true, unopenedRead.data, unopenedRead.revision! + 1]);
    const projected = await base.read();
    expect('Selected release projects the authored scalar and neighboring field', projected.data, { title: 'V1 authored name', keep: 'Retained' });
    expect('Pin and read preserve the predecessor root and history', [await readSourceToolDocument(scope, document.id), await roots(document.id)], [beforeBase, beforeRoots]);
    const options = { migrate: false };
    const ordinaryStart = base.convergence!.start(projected, options);
    options.migrate = true;
    expect('Ordinary start keeps the predecessor even if the caller later changes the opt-in',
      [await ordinaryStart, await readSourceToolDocument(scope, document.id)],
      [{ snapshot: projected, checkpoint: beforeBase.document.convergence!.checkpoint, changed: false }, beforeBase]);
    await rejects('Pending migration rejects ordinary state writes',
      () => base.state!.apply(projected, [{ type: 'set', field: 'title', value: 'Wrong' }]), 'local_tool_source_migration_required');
    await rejects('Explicit migration rejects a stale revision', () => base.convergence!.start({ ...projected, revision: projected.revision! - 1 }, { migrate: true }), 'conflict');
    await rejects('Explicit migration rejects a fabricated projection',
      () => base.convergence!.start({ ...projected, data: { title: 'Forged', keep: 'Retained' } }, { migrate: true }), 'conflict');
    const inheritedBefore = await readSourceToolDocument(inheritedScope, document.id);
    const inheritedSnapshot = await inherited.read();
    await rejects('Explicit migration does not materialize an inherited era',
      () => inherited.convergence!.start(inheritedSnapshot, { migrate: true }), 'local_tool_source_migration_era_required');
    expect('Rejections preserve exact Base and inherited roots',
      [await readSourceToolDocument(scope, document.id), await readSourceToolDocument(inheritedScope, document.id)], [beforeBase, inheritedBefore]);

    const observed = structuredClone(projected);
    const started = base.convergence!.start(observed, { migrate: true });
    observed.revision = 0;
    const migrated = await started;
    const stored = (await readSourceToolDocument(scope, document.id))!;
    expect('Migration saves one revision with the same document ID and new genesis',
      [migrated.changed, migrated.snapshot.data, stored.document.id, stored.document.revision,
        stored.document.convergence!.checkpoint.genesisId !== beforeBase.document.convergence!.checkpoint.genesisId],
      [true, projected.data, document.id, beforeBase.document.revision + 1, true]);
    expect('Displaced complete root is in normal document history',
      (await roots(document.id)).some(row => convergenceHash(row.document.root) === convergenceHash(beforeBase.document)), true);
    expect('Portable previews use the new field and retain the old preview in history',
      [sourceDocumentPreview(stored.document).fields, sourceDocumentPreview(beforeBase.document).fields],
      [[{ label: 'title', value: 'V1 authored name' }], [{ label: 'name', value: 'V1 authored name' }]]);
    const once = await roots(document.id);
    const repeated = await base.convergence!.start(await base.read(), { migrate: true });
    expect('Repeating with the fresh baseline leaves bytes and history unchanged',
      [repeated.changed, await readSourceToolDocument(scope, document.id), await roots(document.id)], [false, stored, once]);
    await rejects('A packet of the predecessor identity does not write into the new checkpoint', () => base.convergence!.import(oldPacket));
    expect('The rejected packet leaves the target checkpoint exact', await readSourceToolDocument(scope, document.id), stored);

    const eraMigrated = await variant.convergence!.start(await variant.read(), { migrate: true });
    expect('Own-era migration preserves its own scalar and leaves Base exact',
      [eraMigrated.snapshot.provenance, eraMigrated.snapshot.data, eraMigrated.snapshot.revision, await readSourceToolDocument(scope, document.id)],
      ['variant', { title: 'V1 era name', keep: 'Retained' }, beforeVariant.document.revision + 1, stored]);
    const edit = await base.state!.apply(await base.read(), [{ type: 'set', field: 'title', value: 'After migration' }]);
    expect('Normal edits and Undo use the migrated codec', (await base.state!.undo(edit.receiptId!)).snapshot.data, projected.data);
    expect('Migration keeps the selected release', (await db.projects.get(projectId))!.localToolInstallations![namespace], second);

    const fake = createFakeLocalToolHost(latest, { projects: [{ id: projectId, updatedAt: 1, sourceToolDocuments: [beforeBase.document] }] });
    const memory = fake.createClient(scope, false, document.id);
    const memoryRead = await memory.read();
    expect('Memory host projects the same state', memoryRead.data, projected.data);
    const memoryOptions = { migrate: false };
    const memoryStart = memory.convergence!.start(memoryRead, memoryOptions);
    memoryOptions.migrate = true;
    expect('Memory host captures the start opt-in when called', (await memoryStart).changed, false);
    const memoryObserved = structuredClone(memoryRead);
    const memoryPending = memory.convergence!.start(memoryObserved, { migrate: true });
    memoryObserved.revision = 0;
    const memoryMigrated = await memoryPending;
    expect('Memory host performs the same one-revision migration',
      [memoryMigrated.changed, memoryMigrated.snapshot.data, memoryMigrated.snapshot.revision], [true, projected.data, beforeBase.document.revision + 1]);
    expect('Memory host keeps the new portable preview',
      sourceDocumentPreview(fake.inspect().projects[0].sourceToolDocuments![0]).fields, [{ label: 'title', value: 'V1 authored name' }]);
    return checks;
  } finally {
    if (await db.projects.get(otherProjectId)) await deleteProject(otherProjectId);
    await deleteProject(projectId);
  }
}
