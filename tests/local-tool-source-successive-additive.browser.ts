import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { localToolConvergenceContext } from '@/engines/local/convergence/context';
import * as Y from 'yjs';
import { convergenceBase64, convergenceBytes, convergenceCanonical, convergenceIdentity } from '@/engines/local/convergence/format';
import type { LocalToolConvergenceCheckpoint } from '@/engines/local/convergence/types';
import { createLocalToolReplica, exportLocalToolConvergenceCheckpoint } from '@/engines/local/convergence/replica';
import { createSourceToolDocument, readSourceToolDocument } from '@/engines/local/documents/store';
import type { SourceToolDocument } from '@/engines/local/documents/types';
import { forkSourceToolDocument } from '@/engines/local/documents/portability';
import { registerLocalToolModules } from '@/engines/local/registry';
import { localToolReleaseIdentity, type LocalToolReleaseManifest } from '@/engines/local/releaseFormat.mjs';
import { pinLocalToolRelease } from '@/engines/local/releases';
import { defineLocalTool, type LocalToolJson, type LocalToolStateAction } from '@/engines/local/sdk';
import { createLocalToolClient } from '@/engines/local/storage';
import fixtureSource from './local-tool-source-successive-additive.browser.ts?raw';

type State = Record<string, LocalToolJson>;

export async function testSourceSuccessiveAdditive(priorList = false): Promise<string[]> {
  const namespace = 'tests.source-additive-successive' + (priorList ? '-lists' : '');
  const projectId = 'qa-source-successive-' + crypto.randomUUID();
  const scope = { projectId };
  const checks: string[] = [];
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (convergenceCanonical(actual) !== convergenceCanonical(expected)) throw Error(label);
    checks.push(label);
  };
  const name = { en: 'Source example', es: 'Ejemplo Source' };
  const valid = (value: LocalToolJson): value is State =>
    !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.name === 'string';
  const original = defineLocalTool<State>({
    namespace, stateSchemaVersion: '1', name, description: name, document: { defaultTitle: name },
    codec: { version: 1, fields: { name: { kind: 'scalar' } } },
    initialState: { name: 'Original' }, validateState: valid, component: () => null,
  });
  const metadata = (definition: typeof original) =>
    ({ namespace, codec: definition.codec!, ...localToolConvergenceContext(definition)! });
  const habitat: State = { habitat: 'Coast', stats: {}, ...(priorList ? { relics: [] } : {}) };
  const middle = defineLocalTool<State>({
    ...original, initialState: { ...original.initialState, ...habitat },
    codec: { version: 1, fields: {
      name: { kind: 'scalar' }, habitat: { kind: 'scalar' }, stats: { kind: 'map' },
      ...(priorList ? { relics: { kind: 'list' as const, idKey: 'key' } } : {}),
    } },
    sourceAdditive: { from: metadata(original), fields: habitat },
    validateState: (value): value is State => {
      if (!valid(value)) return false;
      const stats = value.stats;
      return !(value.habitat === 'Swamp' && stats && typeof stats === 'object' &&
        !Array.isArray(stats) && stats.armor === 42);
    },
  });
  const threat = { threat: 4, traits: [] };
  const olderItem = { key: 'shared', title: 'From V2' };
  const newItem = { key: 'shared', title: 'From V3' };
  const newRelic = { key: 'new', title: 'V3 writes an older list' };
  const latest = defineLocalTool<State>({
    ...middle, initialState: { ...middle.initialState, ...threat },
    codec: { version: 1, fields: {
      ...middle.codec!.fields, threat: { kind: 'scalar' }, traits: { kind: 'list', idKey: 'key' },
    } },
    sourceAdditive: { from: metadata(middle), ancestors: [metadata(original)], fields: threat },
    validateState: valid,
  });
  const rejects = (label: string, operation: () => unknown) => {
    let rejected = false;
    try { operation(); } catch { rejected = true; }
    expect(label, rejected, true);
  };
  if (!priorList) {
    rejects('invalid empty ancestor slot', () => defineLocalTool({
      ...latest, sourceAdditive: { from: metadata(middle), ancestors: null, fields: threat } as never,
    }));
    rejects('array is not a field declaration even for a numeric key', () => defineLocalTool({
      ...middle, codec: { version: 1, fields: { ...middle.codec!.fields, '0': { kind: 'scalar' } } },
      sourceAdditive: { from: metadata(middle), fields: ['bad'] } as never,
    }));
    rejects('invalid ancestor identity', () => defineLocalTool({
      ...latest, sourceAdditive: { from: metadata(middle), ancestors: [{ ...metadata(original), validationId: 'different' }], fields: threat },
    }));
  }
  const replaceTransactionWithSameValue = (checkpoint: LocalToolConvergenceCheckpoint) => {
    const copy = new Y.Doc({ gc: false });
    try {
      Y.applyUpdate(copy, convergenceBytes(checkpoint.checkpointBase64));
      const transactions = copy.getMap<string>('causal-transactions');
      const [key, body] = [...transactions.entries()][0];
      transactions.set(key, body);
      const altered = { ...checkpoint, checkpointBase64: convergenceBase64(Y.encodeStateAsUpdate(copy)),
        stateVectorBase64: convergenceBase64(Y.encodeStateVector(copy)) };
      rejects('rewriting a retained transaction is invalid even with identical visible content',
        () => exportLocalToolConvergenceCheckpoint(altered));
    } finally { copy.destroy(); }
  };
  const checkPartialDelivery = (checkpoint: LocalToolConvergenceCheckpoint) => {
    const contract = { ...metadata(latest), validateState: latest.validateState };
    const sender = createLocalToolReplica(checkpoint, { authorId: 'sender', contract });
    const forward = createLocalToolReplica(checkpoint, { authorId: 'forward', contract });
    const reverse = createLocalToolReplica(checkpoint, { authorId: 'reverse', contract });
    const originalDoc = new Y.Doc({ gc: false }), completeDoc = new Y.Doc({ gc: false }), prefixDoc = new Y.Doc({ gc: false });
    try {
      const before = sender.read();
      const authored = sender.apply([
        { type: 'list-insert', field: 'relics', item: { key: 'wire', title: 'Older stage' }, afterId: null },
        { type: 'list-insert', field: 'traits', item: { key: 'wire', title: 'Newer stage' }, afterId: null },
      ]);
      const complete = sender.checkpoint();
      const whole = convergenceBytes(complete.checkpointBase64);
      Y.applyUpdate(originalDoc, convergenceBytes(checkpoint.checkpointBase64));
      Y.applyUpdate(completeDoc, whole);
      const previous = originalDoc.getMap('causal-transactions'), current = completeDoc.getMap('causal-transactions');
      const [added, ...extra] = [...current.keys()].filter(id => !previous.has(id));
      expect('cross-stage list batch has one actual transaction', [Boolean(added), extra.length], [true, 0]);
      const body = [...completeDoc.store.clients.values()].flat().find(
        item => item instanceof Y.Item && item.parent === current && item.parentSub === added && !item.deleted,
      )!;
      const snapshot = Y.snapshot(completeDoc), clock = new Map(snapshot.sv);
      clock.set(body.id.client, body.id.clock);
      Y.createDocFromSnapshot(completeDoc, Y.createSnapshot(snapshot.ds, clock), prefixDoc);
      const packet = (bytes: Uint8Array) => ({ ...authored.update, updateBase64: convergenceBase64(bytes) });
      const prefix = packet(Y.encodeStateAsUpdate(prefixDoc, Y.encodeStateVector(originalDoc)));
      const suffix = packet(Y.diffUpdate(whole, Y.encodeStateVector(prefixDoc)));
      expect('cross-stage partials are invisible before the flush', [
        forward.receive(prefix).pending, exportLocalToolConvergenceCheckpoint(forward.checkpoint()).pending,
        reverse.receive(suffix).pending, forward.read(), reverse.read(),
      ], [true, true, true, before, before]);
      expect('both orders yield the exact portable result', [
        forward.receive(suffix).pending, reverse.receive(prefix).pending, forward.checkpoint(), reverse.checkpoint(),
      ], [false, false, complete, complete]);
    } finally {
      sender.destroy(); forward.destroy(); reverse.destroy();
      originalDoc.destroy(); completeDoc.destroy(); prefixDoc.destroy();
    }
  };
  const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const encoder = new TextEncoder(), bytes = encoder.encode(fixtureSource);
  const files = [{ path: 'module.tsx', sha256: await hash(bytes), bytes: bytes.length }];
  const manifest = async (version: string): Promise<LocalToolReleaseManifest> => {
    const identity = { format: 'writers-hoard-local-tool-source/1', apiVersion: 1, namespace, version, files } as const;
    return { ...identity, contentHash: await hash(encoder.encode(localToolReleaseIdentity(identity))) };
  };
  const releases = await Promise.all(['1.0.0', '1.1.0', '1.2.0'].map(manifest));
  const moduleRoot = (release: LocalToolReleaseManifest) => './installed/' + namespace + '/versions/' + release.contentHash;
  registerLocalToolModules(
    Object.fromEntries(releases.map((release, index) => [moduleRoot(release) + '/module.tsx', { default: [original, middle, latest][index] }])),
    Object.fromEntries(releases.map(release => [moduleRoot(release) + '/release.json', release])),
  );
  const pin = (version: number, expected: number | null) => pinLocalToolRelease(projectId, namespace, releases[version].contentHash, expected);
  const client = (id: string, version: number) => createLocalToolClient(projectId, [original, middle, latest][version],
    { documentId: id, releaseHash: releases[version].contentHash, requireSelectedRelease: true });
  const raw = (id: string) => readSourceToolDocument(scope, id, namespace);
  try {
    await db.projects.add({ id: projectId, title: 'Source successive QA', description: projectId, mode: 'custom',
      type: 'standalone', status: 'draft', color: '#444444', enabledEngines: ['local-tool-' + namespace], createdAt: 1, updatedAt: 1 });
    const firstPin = await pin(0, null);
    const [direct, promoted] = await Promise.all(['Direct', 'Via middle'].map(label => createSourceToolDocument(scope, namespace, label)));
    for (const document of [direct, promoted]) {
      const api = client(document.id, 0);
      await api.convergence!.start(await api.read());
      await api.state!.apply(await api.read(), [{ type: 'set', field: 'name', value: 'Edited V1' }]);
    }

    const middlePin = await pin(1, firstPin.revision);
    const prior = client(promoted.id, 1);
    const middleActions: LocalToolStateAction[] = [
      { type: 'set', field: 'habitat', value: 'Forest' },
      { type: 'map-set', field: 'stats', key: 'armor', value: 9 },
    ];
    if (priorList) middleActions.push({ type: 'list-insert', field: 'relics', item: olderItem, afterId: null });
    await prior.state!.apply(await prior.read(), middleActions);
    const old = await Promise.all([direct, promoted].map(document => raw(document.id)));
    if (!priorList) {
      const source = old[1]!.document;
      const empty = new Y.Doc({ gc: false });
      let wrongHistory: SourceToolDocument;
      try {
        const checkpoint = source.convergence!.checkpoint;
        wrongHistory = { ...source, convergence: { checkpoint: {
          ...checkpoint, checkpointBase64: convergenceBase64(Y.encodeStateAsUpdate(empty)),
          stateVectorBase64: convergenceBase64(Y.encodeStateVector(empty)),
        } } };
      } finally { empty.destroy(); }
      const wrongData = { ...source, data: { ...(source.data as State), name: 'Does not match the checkpoint' } };
      const midContract = { ...metadata(middle), validateState: middle.validateState };
      const left = createLocalToolReplica(source.convergence!.checkpoint, { authorId: 'left', contract: midContract });
      const right = createLocalToolReplica(source.convergence!.checkpoint, { authorId: 'right', contract: midContract });
      let retainedConflict: SourceToolDocument;
      try {
        left.apply([{ type: 'set', field: 'habitat', value: 'Swamp' }]);
        left.receive(right.apply([{ type: 'map-set', field: 'stats', key: 'armor', value: 42 }]).update);
        const view = left.inspect();
        if (!view.conflict) throw Error('Expected a genuine V2 conflict');
        retainedConflict = { ...source, data: view.data, convergence: { checkpoint: left.checkpoint(), conflict: view.conflict } };
      } finally { left.destroy(); right.destroy(); }
      expect('Copy retains the authored snapshot from a genuine conflict',
        forkSourceToolDocument(retainedConflict).data, retainedConflict.data);
      const wrongConflict = { ...retainedConflict, data: { ...(retainedConflict.data as State), name: 'Never authored' } };
      rejects('Copy rejects a snapshot outside the retained history', () => forkSourceToolDocument(wrongConflict));
      for (const [label, document] of [
        ['wrong retained data', wrongData], ['wrong retained history', wrongHistory], ['wrong conflict snapshot', wrongConflict],
      ] as const) {
        const id = 'qa-source-history-' + crypto.randomUUID();
        await db.documentHistory.add({ id, projectId, kind: 'local-tool', entityId: document.id, title: document.title,
          createdAt: 1, version: old[1]!.version, reason: 'manual', document: { root: { ...document }, children: {} }, assetIds: [] });
        try {
          let rejected = false;
          try { await pin(2, middlePin.revision); } catch { rejected = true; }
          expect('Pin rejects ' + label, rejected, true);
          expect('Rejected pin retains the selected release',
            (await db.projects.get(projectId))?.localToolInstallations?.[namespace], middlePin);
        } finally { await db.documentHistory.delete(id); }
      }
    }
    await pin(2, middlePin.revision);
    const expected = [
      { name: 'Edited V1', ...habitat, ...threat },
      { name: 'Edited V1', ...threat, habitat: 'Forest', stats: { armor: 9 }, ...(priorList ? { relics: [olderItem] } : {}) },
    ];
    for (const [index, document] of [direct, promoted].entries()) {
      const api = client(document.id, 2);
      const before = await api.read();
      expect('V3 read ' + document.id, before.data, expected[index]);
      expect('V3 read preserves bytes ' + document.id, await raw(document.id), old[index]);
      expect('V3 read retains old export ' + document.id, (await api.convergence!.export()).checkpoint, old[index]!.document.convergence!.checkpoint);
      const noOp = await api.state!.apply(before, [{ type: 'map-delete', field: 'stats', key: 'missing' }]);
      expect('No-op retains old epoch ' + document.id, [noOp.receiptId, await raw(document.id)], [null, old[index]]);
      const actions: LocalToolStateAction[] = [{ type: 'set', field: 'threat', value: 7 }];
      if (priorList) actions.push(
        { type: 'list-insert', field: 'traits', item: newItem, afterId: null },
        { type: 'list-insert', field: 'relics', item: newRelic, afterId: index ? olderItem.key : null },
      );
      const change = await api.state!.apply(await api.read(), actions);
      const after = { ...expected[index], threat: 7,
        ...(priorList ? { traits: [newItem], relics: index ? [olderItem, newRelic] : [newRelic] } : {}) };
      expect('First V3 write preserves old values ' + document.id, change.snapshot.data, after);
      const saved = (await raw(document.id))!, original = old[index]!;
      expect('Single durable revision ' + document.id,
        [saved.document.revision, saved.lineage, saved.document.convergence!.checkpoint.genesisId],
        [original.document.revision + 1, original.lineage, original.document.convergence!.checkpoint.genesisId]);
      const checkpoint = saved.document.convergence!.checkpoint;
      const cold = createLocalToolReplica(checkpoint, {
        authorId: 'QA cold', contract: { ...metadata(latest), validateState: latest.validateState },
      });
      try {
        expect('Cold replica keeps the complete raw state ' + document.id, cold.read(), saved.document.data);
      } finally { cold.destroy(); }
      if (priorList && index === 1) {
        checkPartialDelivery(checkpoint);
        replaceTransactionWithSameValue(checkpoint);
      }
      const retagged = { ...checkpoint, ...convergenceIdentity(metadata(middle), checkpoint.genesisId) };
      rejects('Reject V3 bytes relabelled as V2 ' + document.id, () => exportLocalToolConvergenceCheckpoint(retagged));
      expect('V3 Undo ' + document.id, (await api.state!.undo(change.receiptId!)).snapshot.data, expected[index]);
    }
    return checks;
  } finally { await deleteProject(projectId); }
}
