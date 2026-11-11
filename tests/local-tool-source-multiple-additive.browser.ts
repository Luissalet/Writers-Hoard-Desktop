import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { defineLocalTool, type LocalToolJson } from '@/engines/local/sdk';
import { registerLocalToolModules } from '@/engines/local/registry';
import { localToolReleaseIdentity, type LocalToolReleaseManifest } from '@/engines/local/releaseFormat.mjs';
import { pinLocalToolRelease } from '@/engines/local/releases';
import { createSourceToolDocument, readSourceToolDocument } from '@/engines/local/documents/store';
import { createLocalToolClient } from '@/engines/local/storage';
import { localToolConvergenceContext } from '@/engines/local/convergence/context';
import * as Y from 'yjs';
import { convergenceBase64, convergenceBytes, convergenceCanonical } from '@/engines/local/convergence/format';
import { createLocalToolReplica, exportLocalToolConvergenceCheckpoint } from '@/engines/local/convergence/replica';
import fixtureSource from './local-tool-source-multiple-additive.browser.ts?raw';

type State = Record<string, LocalToolJson>;
const isState = (value: LocalToolJson): value is State =>
  !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.name === 'string';

export async function testSourceMultipleAdditive(): Promise<string[]> {
  const namespace = 'tests.source-additive-multiple';
  const projectId = 'qa-source-multiple-' + crypto.randomUUID();
  const scope = { projectId };
  const checks: string[] = [];
  const equal = (label: string, actual: unknown, expected: unknown) => {
    if (convergenceCanonical(actual) !== convergenceCanonical(expected)) throw Error(label);
    checks.push(label);
  };
  const rejects = async (label: string, run: () => unknown) => {
    let rejected = false;
    try { await run(); } catch { rejected = true; }
    equal(label, rejected, true);
  };
  const one = defineLocalTool<State>({
    namespace, stateSchemaVersion: '1', name: { en: 'Original', es: 'Original' },
    description: { en: 'Original', es: 'Original' }, document: { defaultTitle: { en: 'Example', es: 'Ejemplo' } },
    codec: { version: 1, fields: { name: { kind: 'scalar' } } },
    initialState: { name: 'Original' }, validateState: isState, component: () => null,
  });
  const from = { namespace, codec: one.codec!, ...localToolConvergenceContext(one)! };
  const defaults = { habitat: 'Coast', threat: 4, traits: [], reserves: [], stats: {}, ratings: {} };
  const two = defineLocalTool<State>({
    ...one, initialState: { name: 'Original', ...defaults },
    codec: { version: 1, fields: {
      name: { kind: 'scalar' }, habitat: { kind: 'scalar' }, threat: { kind: 'scalar' },
      traits: { kind: 'list', idKey: 'key' }, reserves: { kind: 'list', idKey: 'key' },
      stats: { kind: 'map' }, ratings: { kind: 'map' },
    } },
    sourceAdditive: { from, fields: defaults },
    validateState: (value): value is State => isState(value) && typeof value.habitat === 'string' &&
      typeof value.threat === 'number' && Array.isArray(value.traits) && Array.isArray(value.reserves) &&
      !!value.stats && typeof value.stats === 'object' && !Array.isArray(value.stats) &&
      !!value.ratings && typeof value.ratings === 'object' && !Array.isArray(value.ratings),
  });
  equal('the additive release can retain its declared schema version', two.stateSchemaVersion, one.stateSchemaVersion);
  await rejects('an existing field cannot appear among the new defaults', () => defineLocalTool({
    ...two, sourceAdditive: { from, fields: { ...defaults, name: 'Wrong' } },
  }));
  await rejects('a non-empty collection default is refused', () => defineLocalTool({
    ...two, sourceAdditive: { from, fields: { ...defaults, traits: [{ key: 'wrong' }] } },
  }));

  const sha = async (value: Uint8Array<ArrayBuffer>) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(fixtureSource);
  const files = [{ path: 'module.tsx', sha256: await sha(bytes), bytes: bytes.length }];
  const manifest = async (version: string): Promise<LocalToolReleaseManifest> => {
    const identity = { format: 'writers-hoard-local-tool-source/1', apiVersion: 1, namespace, version, files } as const;
    return { ...identity, contentHash: await sha(encoder.encode(localToolReleaseIdentity(identity))) };
  };
  const [v1, v2] = await Promise.all([manifest('1.0.0'), manifest('1.1.0')]);
  const path = (item: LocalToolReleaseManifest) => './installed/' + namespace + '/versions/' + item.contentHash;
  registerLocalToolModules({
    [path(v1) + '/module.tsx']: { default: one }, [path(v2) + '/module.tsx']: { default: two },
  }, { [path(v1) + '/release.json']: v1, [path(v2) + '/release.json']: v2 });
  try {
    await db.projects.add({ id: projectId, title: 'Multiple additive Source QA', description: projectId, mode: 'custom',
      type: 'standalone', status: 'draft', color: '#444444', enabledEngines: ['local-tool-' + namespace], createdAt: 1, updatedAt: 1 });
    const pin = await pinLocalToolRelease(projectId, namespace, v1.contentHash, null);
    const documentId = (await createSourceToolDocument(scope, namespace, 'Source QA')).id;
    const old = createLocalToolClient(projectId, one, { documentId, releaseHash: v1.contentHash, requireSelectedRelease: true });
    await old.convergence!.start(await old.read());
    const previous = { name: 'Edited old document Ω' };
    await old.state!.apply(await old.read(), [{ type: 'set', field: 'name', value: previous.name }]);
    const readRaw = () => readSourceToolDocument(scope, documentId, namespace);
    const original = (await readRaw())!;
    const origin = await old.convergence!.export();
    await pinLocalToolRelease(projectId, namespace, v2.contentHash, pin.revision);
    const current = createLocalToolClient(projectId, two, { documentId, releaseHash: v2.contentHash, requireSelectedRelease: true });
    const projected = await current.read();
    equal('V2 projects both scalars, both lists and both maps', projected.data, { ...previous, ...defaults });
    equal('reading and opening leave the original checkpoint intact', (await current.convergence!.start(projected)).checkpoint, origin.checkpoint);
    equal('reading leaves the durable document and lineage exact', await readRaw(), original);
    const noOp = await current.state!.apply(projected, [{ type: 'map-delete', field: 'ratings', key: 'absent' }]);
    equal('no-op on an absent added map does not promote', [noOp.receiptId, (await readRaw())!.document], [null, original.document]);

    const promoted = await current.state!.apply(await current.read(), [
      { type: 'set', field: 'habitat', value: 'Coast' },
      { type: 'set', field: 'threat', value: 7 },
      { type: 'map-set', field: 'stats', key: 'speed', value: 2 },
      { type: 'list-insert', field: 'traits', item: { key: 'one', title: 'Quiet' }, afterId: null },
    ]);
    const durable = (await readRaw())!, exported = await current.convergence!.export();
    equal('first batch atomically retains origin and promotes to engine 8', [
      durable.lineage, durable.document.generation, durable.document.revision, exported.checkpoint!.genesisId,
      exported.checkpoint!.engine.version, typeof promoted.receiptId,
    ], [original.lineage, original.document.generation, original.document.revision + 1, origin.checkpoint!.genesisId, '8', 'string']);
    equal('only explicit fields acquire durable slots', durable.document.data,
      { ...previous, habitat: 'Coast', threat: 7, stats: { speed: 2 }, traits: [{ key: 'one', title: 'Quiet' }] });
    const undone = await current.state!.undo(promoted.receiptId!);
    equal('one Undo restores the sparse old data and all defaults', [undone.snapshot.data, (await readRaw())!.document.data],
      [{ ...previous, ...defaults }, previous]);
    await rejects('stale baseline cannot overwrite an added field', () =>
      current.state!.apply(promoted.snapshot, [{ type: 'set', field: 'threat', value: 8 }]));

    const contract = { namespace, codec: two.codec!, ...localToolConvergenceContext(two)!, validateState: two.validateState };
    const checkpoint = (await current.convergence!.export()).checkpoint!;
    const a = createLocalToolReplica(checkpoint, { authorId: 'QA-A', contract });
    const b = createLocalToolReplica(checkpoint, { authorId: 'QA-B', contract });
    try {
      const first = a.apply([
        { type: 'map-set', field: 'stats', key: 'shared', value: 10 },
        { type: 'list-insert', field: 'traits', item: { key: 'same-id', title: 'A' }, afterId: null },
      ]);
      const second = b.apply([
        { type: 'map-set', field: 'ratings', key: 'shared', value: 20 },
        { type: 'list-insert', field: 'reserves', item: { key: 'same-id', title: 'B' }, afterId: null },
      ]);
      a.receive(second.update);
      b.receive(first.update);
      equal('two authors converge across distinct new lists and maps', a.read(), b.read());
      b.receive(a.undo(first.receiptId!).update);
      const remaining = { ...previous, ratings: { shared: 20 }, reserves: [{ key: 'same-id', title: 'B' }] };
      equal('author Undo keeps the other two added fields', [a.read(), b.read()], [remaining, remaining]);
      a.receive(b.undo(second.receiptId!).update);
      equal('both Undo converge to sparse absence and a complete export',
        [a.read(), b.read(), a.checkpoint().engine.version], [previous, previous, '8']);
    } finally {
      a.destroy();
      b.destroy();
    }
    const sender = createLocalToolReplica(checkpoint, { authorId: 'QA-sender', contract });
    const receiver = createLocalToolReplica(checkpoint, { authorId: 'QA-receiver', contract });
    const reverse = createLocalToolReplica(checkpoint, { authorId: 'QA-reverse', contract });
    const priorDoc = new Y.Doc({ gc: false }), fullDoc = new Y.Doc({ gc: false }), prefixDoc = new Y.Doc({ gc: false });
    try {
      const split = sender.apply([
        { type: 'list-insert', field: 'traits', item: { key: 'shared', title: 'First list' }, afterId: null },
        { type: 'list-insert', field: 'reserves', item: { key: 'shared', title: 'Second list' }, afterId: null },
      ]);
      const complete = sender.checkpoint();
      const whole = convergenceBytes(complete.checkpointBase64);
      Y.applyUpdate(priorDoc, convergenceBytes(checkpoint.checkpointBase64));
      Y.applyUpdate(fullDoc, whole);
      const before = priorDoc.getMap('causal-transactions'), after = fullDoc.getMap('causal-transactions');
      const added = [...after.keys()].filter(id => !before.has(id));
      equal('the multi-list batch has one actual causal flush', added.length, 1);
      const bodies = [...fullDoc.store.clients.values()].flat().filter(
        item => item instanceof Y.Item && item.parent === after && item.parentSub === added[0] && !item.deleted);
      equal('the writer flush has one physical clock', bodies.length, 1);
      const flush = bodies[0];
      const snapshot = Y.snapshot(fullDoc), vector = new Map(snapshot.sv);
      vector.set(flush.id.client, flush.id.clock);
      Y.createDocFromSnapshot(fullDoc, Y.createSnapshot(snapshot.ds, vector), prefixDoc);
      const order = (field: string) => 'order:' + JSON.stringify(field);
      equal('the fragment includes both actual placements but no new transaction', [
        prefixDoc.getArray(order('traits')).length - priorDoc.getArray(order('traits')).length,
        prefixDoc.getArray(order('reserves')).length - priorDoc.getArray(order('reserves')).length,
        prefixDoc.getMap('causal-transactions').size - before.size,
      ], [1, 1, 0]);
      const packet = (bytes: Uint8Array) => ({ ...split.update, updateBase64: convergenceBase64(bytes) });
      const prefix = packet(Y.encodeStateAsUpdate(prefixDoc, Y.encodeStateVector(priorDoc)));
      const suffix = packet(Y.diffUpdate(whole, Y.encodeStateVector(prefixDoc)));
      equal('both partial orders wait without exposing half of the multi-list batch',
        [receiver.receive(prefix).pending, exportLocalToolConvergenceCheckpoint(receiver.checkpoint()).pending,
          reverse.receive(suffix).pending, receiver.read(), reverse.read()], [true, true, true, previous, previous]);
      equal('both delivery orders close at the exact complete checkpoint', [
        receiver.receive(suffix).pending, reverse.receive(prefix).pending, receiver.checkpoint(), reverse.checkpoint(),
      ], [false, false, complete, complete]);
    } finally {
      sender.destroy();
      receiver.destroy();
      reverse.destroy();
      priorDoc.destroy();
      fullDoc.destroy();
      prefixDoc.destroy();
    }
    db.close();
    await db.open();
    equal('cold reopen keeps both saved lineage and projected defaults', [(await readRaw())!.lineage, (await current.read()).data],
      [original.lineage, { ...previous, ...defaults }]);
    return checks;
  } finally {
    await deleteProject(projectId);
  }
}
