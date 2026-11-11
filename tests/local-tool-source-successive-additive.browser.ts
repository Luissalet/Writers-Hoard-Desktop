import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { localToolConvergenceContext } from '@/engines/local/convergence/context';
import * as Y from 'yjs';
import { convergenceBase64, convergenceBytes, convergenceCanonical, convergenceHash, convergenceIdentity } from '@/engines/local/convergence/format';
import type { LocalToolConvergenceCheckpoint } from '@/engines/local/convergence/types';
import { createLocalToolReplica, exportLocalToolConvergenceCheckpoint } from '@/engines/local/convergence/replica';
import { createSourceToolDocument, readSourceToolDocument } from '@/engines/local/documents/store';
import type { SourceToolDocument } from '@/engines/local/documents/types';
import { forkSourceToolDocument, validateSourceDocumentCheckpoint } from '@/engines/local/documents/portability';
import { registerLocalToolModules } from '@/engines/local/registry';
import { localToolReleaseIdentity, type LocalToolReleaseManifest } from '@/engines/local/releaseFormat.mjs';
import { pinLocalToolRelease } from '@/engines/local/releases';
import { defineLocalTool, type LocalToolJson, type LocalToolStateAction } from '@/engines/local/sdk';
import { createLocalToolClient } from '@/engines/local/storage';
import { createFakeLocalToolHost } from '@/engines/local/testing';
import fixtureSource from './local-tool-source-successive-additive.browser.ts?raw';

type State = Record<string, LocalToolJson>;

export async function testSourceSuccessiveAdditive(priorList = false, writeAs = false, freshStage = false): Promise<string[]> {
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
    validateState: middle.validateState,
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
      const saved = (await raw(document.id))!, retained = old[index]!;
      expect('Single durable revision ' + document.id,
        [saved.document.revision, saved.lineage, saved.document.convergence!.checkpoint.genesisId],
        [retained.document.revision + 1, retained.lineage, retained.document.convergence!.checkpoint.genesisId]);
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
      const updatedHabitat = 'V3 edits a V2 field';
      const extra = await api.state!.apply(await api.read(), [{ type: 'set', field: 'habitat', value: updatedHabitat }]);
      const beforeProjection = await raw(document.id);
      const selectedBefore = (await db.projects.get(projectId))?.localToolInstallations?.[namespace];
      const older = await api.convergence!.readAs(convergenceHash(metadata(middle)));
      const earliest = await api.convergence!.readAs(convergenceHash(metadata(original)));
      const expectedOlder = Object.fromEntries(Object.keys(middle.codec!.fields)
        .map(field => [field, field === 'habitat' ? updatedHabitat : (after as State)[field]]));
      expect('V2 sees current shared fields without V3 fields ' + document.id, older.data, expectedOlder);
      expect('V1 projects only its own field ' + document.id, earliest.data, { name: 'Edited V1' });
      const fixture = createFakeLocalToolHost(latest, { projects: [
        { id: projectId, updatedAt: 1, sourceToolDocuments: [beforeProjection!.document] },
      ] });
      const fixtureBefore = fixture.inspect();
      const fake = fixture.createClient(scope, true, document.id);
      expect('Memory host projects the same certified fields and keeps fixtures exact ' + document.id,
        [await fake.convergence!.readAs(convergenceHash(metadata(middle))), fixture.inspect()], [older, fixtureBefore]);
      expect('Projection identifies both exact contracts ' + document.id, [older.identity, older.activeIdentity, older.conflicted],
        [convergenceIdentity(metadata(middle), checkpoint.genesisId), convergenceIdentity(metadata(latest), checkpoint.genesisId), false]);
      expect('Projection does not supply a write baseline ' + document.id,
        ['revision', 'document', 'checkpoint', 'lineage'].some(key => Object.hasOwn(older, key)), false);
      let refused = false;
      try { await api.convergence!.readAs('0'.repeat(64)); } catch { refused = true; }
      expect('Unknown projection identity is refused ' + document.id, refused, true);
      expect('Projection preserves saved state and selected release ' + document.id,
        [await raw(document.id), (await db.projects.get(projectId))?.localToolInstallations?.[namespace]], [beforeProjection, selectedBefore]);
      if (!priorList && index === 1) {
        const authentic = beforeProjection!.document;
        const permissive = createLocalToolReplica(authentic.convergence!.checkpoint, {
          authorId: 'untrusted Source sender',
          contract: { ...metadata(latest), validateState: (_value): _value is State => true },
        });
        let forged: SourceToolDocument;
        try {
          permissive.apply([
            { type: 'set', field: 'habitat', value: 'Swamp' },
            { type: 'map-set', field: 'stats', key: 'armor', value: 42 },
          ]);
          forged = { ...authentic, data: permissive.read(), convergence: { checkpoint: permissive.checkpoint() } };
        } finally { permissive.destroy(); }
        expect('Portable validation has no executable release validator', forkSourceToolDocument(forged).data, forged.data);
        const project = (await db.projects.get(projectId))!;
        const originalRows = project.sourceToolDocuments!;
        await db.projects.update(projectId, { sourceToolDocuments: originalRows.map(row => row.id === forged.id ? forged : row) });
        try {
          const hash = convergenceHash(metadata(middle));
          const forgedHost = createFakeLocalToolHost(latest, { projects: [
            { id: projectId, updatedAt: 1, sourceToolDocuments: [forged] },
          ] });
          const results = await Promise.allSettled([
            api.read(), api.convergence!.readAs(hash),
            forgedHost.createClient(scope, true, forged.id).convergence!.readAs(hash),
          ]);
          expect('Browser and memory projections enforce the active validator', results.map(result => result.status),
            ['rejected', 'rejected', 'rejected']);
        } finally { await db.projects.update(projectId, { sourceToolDocuments: originalRows }); }
      }
      if (writeAs) {
        const previous = convergenceHash(metadata(middle));
        const options = { asIdentity: previous };
        const edits: LocalToolStateAction[] = [
          { type: 'set', field: 'habitat', value: 'Swamp' },
          { type: 'map-set', field: 'stats', key: 'armor', value: 10 },
        ];
        const active = await api.read();
        const editedNeighbor = await api.state!.apply(active, [{ type: 'set', field: 'threat', value: 8 }]);
        const latestRead = await api.read();
        const rawBefore = await raw(document.id);
        class EarlierActions extends Array<LocalToolStateAction> {
          override some(): boolean { return false; }
        }
        const derivedArray = new EarlierActions(...edits, { type: 'set', field: 'threat', value: 9 });
        const denied = await Promise.allSettled([
          api.state!.apply(active, edits, options),
          api.state!.apply(latestRead, [...edits, { type: 'set', field: 'threat', value: 9 }], options),
          api.state!.apply(latestRead, edits, { asIdentity: '0'.repeat(64) }),
          api.state!.apply(older as unknown as typeof active, edits, options),
          api.state!.apply({ ...latestRead, data: { ...latestRead.data, threat: 9 } }, edits, options),
          api.state!.apply(latestRead, derivedArray, options),
        ]);
        expect('Earlier stage rejects stale, out-of-stage, unknown or fabricated input ' + document.id,
          denied.map(result => result.status), Array(6).fill('rejected'));
        expect('Rejected earlier edits preserve the exact document ' + document.id, await raw(document.id), rawBefore);
        const observed = structuredClone(latestRead), submitted = structuredClone(edits);
        const writing = api.state!.apply(observed, submitted, options);
        observed.revision = 0;
        submitted.push({ type: 'set', field: 'threat', value: 9 });
        const written = await writing;
        const expectedActive = { ...latestRead.data, habitat: 'Swamp', stats: { ...(latestRead.data.stats as State), armor: 10 } };
        expect('Earlier stage edits shared fields and retains newer fields ' + document.id,
          [written.snapshot.data, written.snapshot.revision, written.snapshot.convergence?.genesisId, !!written.receiptId],
          [expectedActive, latestRead.revision! + 1, latestRead.convergence?.genesisId, true]);
        const afterWrite = await raw(document.id);
        const repeated = await api.state!.apply(await api.read(), edits, options);
        expect('An equal earlier edit has no revision or receipt ' + document.id,
          [repeated.receiptId, await raw(document.id)], [null, afterWrite]);
        expect('Earlier stage reads the new values it wrote ' + document.id,
          (await api.convergence!.readAs(previous)).data,
          { ...expectedOlder, habitat: 'Swamp', stats: expectedActive.stats });
        expect('Undo for an earlier edit preserves the neighboring V3 write ' + document.id,
          (await api.state!.undo(written.receiptId!)).snapshot.data, latestRead.data);
        await api.state!.undo(editedNeighbor.receiptId!);
        const memory = createFakeLocalToolHost(latest, { projects: [
          { id: projectId, updatedAt: 1, sourceToolDocuments: [rawBefore!.document] },
        ] }).createClient(scope, false, document.id);
        const memoryBase = await memory.read();
        const memoryWrite = await memory.state!.apply(memoryBase, edits, options);
        expect('Memory host applies and undoes the same previous-stage edits ' + document.id,
          [memoryWrite.snapshot.data, (await memory.state!.undo(memoryWrite.receiptId!)).snapshot.data],
          [expectedActive, latestRead.data]);
      }
      await api.state!.undo(extra.receiptId!);
      expect('V3 Undo ' + document.id, (await api.state!.undo(change.receiptId!)).snapshot.data, expected[index]);
      if (!priorList && index === 1) {
        const checkpoint = (await raw(document.id))!.document.convergence!.checkpoint;
        const contract = { ...metadata(latest), validateState: latest.validateState };
        const left = createLocalToolReplica(checkpoint, { authorId: 'left V3', contract });
        const right = createLocalToolReplica(checkpoint, { authorId: 'right V3', contract });
        try {
          await api.convergence!.import(left.apply([{ type: 'set', field: 'habitat', value: 'Swamp' }]).update);
          await api.convergence!.import(right.apply([{ type: 'map-set', field: 'stats', key: 'armor', value: 42 }]).update);
          const savedConflict = (await raw(document.id))!.document;
          if (!savedConflict.convergence?.conflict) throw Error('Expected a genuine active conflict');
          const projection = await api.convergence!.readAs(convergenceHash(metadata(middle)));
          const admitted = savedConflict.data as State;
          expect('Projection returns the admitted V2 fields during a V3 conflict',
            [projection.data, projection.conflicted, Object.hasOwn(projection, 'conflict')],
            [{ name: admitted.name, habitat: admitted.habitat, stats: admitted.stats }, true, false]);
        } finally { left.destroy(); right.destroy(); }
      }
    }
    if (freshStage) {
      const fresh = await createSourceToolDocument(scope, namespace, 'Born in V3');
      const api = client(fresh.id, 2), priorHash = convergenceHash(metadata(middle));
      await api.state!.apply(await api.read(), [
        { type: 'set', field: 'name', value: 'Born in V3' },
        { type: 'set', field: 'threat', value: 7 },
        { type: 'list-insert', field: 'traits', item: newItem, afterId: null },
      ]);
      const saved = (await raw(fresh.id))!;
      const histories = (document: SourceToolDocument) => validateSourceDocumentCheckpoint(document)?.map(convergenceHash);
      const activeStages = [convergenceHash(metadata(latest))];
      expect('A new V3 document retains only its own physical stage', histories(saved.document), activeStages);
      const projected = await api.convergence!.readAs(priorHash);
      const olderData = { name: 'Born in V3', ...habitat };
      expect('V2 reads only its declared fields on the fresh V3 document',
        [projected.data, projected.stageInHistory], [olderData, false]);
      expect('Reading a declared stage leaves the physical document unchanged', await raw(fresh.id), saved);
      const active = await api.read();
      const changes: LocalToolStateAction[] = [
        { type: 'set', field: 'habitat', value: 'Swamp' },
        { type: 'map-set', field: 'stats', key: 'armor', value: 10 },
      ];
      const wrote = await api.state!.apply(active, changes, { asIdentity: priorHash });
      const changed = (await raw(fresh.id))!;
      const after = { ...active.data, habitat: 'Swamp', stats: { armor: 10 } };
      expect('V2 writes shared fields without creating a historical stage',
        [wrote.snapshot.data, wrote.snapshot.revision, wrote.snapshot.convergence?.genesisId, histories(changed.document)],
        [after, active.revision! + 1, active.convergence?.genesisId, activeStages]);
      expect('V2 sees its changes and V3 preserves threat and its authored list',
        (await api.convergence!.readAs(priorHash)).data, { ...olderData, habitat: 'Swamp', stats: { armor: 10 } });
      expect('Undo for the declared stage restores the active document',
        (await api.state!.undo(wrote.receiptId!)).snapshot.data, active.data);
      const memory = createFakeLocalToolHost(latest, { projects: [
        { id: projectId, updatedAt: 1, sourceToolDocuments: [saved.document] },
      ] }).createClient(scope, false, fresh.id);
      expect('Memory host identifies the same declared stage', await memory.convergence!.readAs(priorHash), projected);
      expect('Memory host also edits shared fields on a fresh document',
        (await memory.state!.apply(await memory.read(), changes, { asIdentity: priorHash })).snapshot.data, after);
      const promotedProjection = await client(promoted.id, 2).convergence!.readAs(priorHash);
      expect('A genuinely retained stage reports physical history', promotedProjection.stageInHistory, true);
    }
    return checks;
  } finally { await deleteProject(projectId); }
}
