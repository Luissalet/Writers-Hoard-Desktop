import Dexie, { type DBCore, type DBCoreMutateRequest, type DBCoreTransaction } from 'dexie';
import { installHistoryMutationBoundary } from '@/services/documentHistory/middleware';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
export async function testDocumentHistoryPrototype(): Promise<string[]> {
  const database = new Dexie(`synthetic-history-prototype-${Date.now()}`);
  database.version(1).stores({ documents: 'id,projectId,&unique', parts: 'id,documentId', history: 'id,documentId', assets: 'id,&hash', unrelated: 'id' });
  const seen = new WeakMap<DBCoreTransaction, Set<string>>();
  installHistoryMutationBoundary(database, { stores: ['documents', 'parts', 'history', 'assets'], trackedTables: new Set(['documents', 'parts']), capture: async (name: string, request: DBCoreMutateRequest, core: DBCore) => {
    const table = core.table(name), trans = request.trans;
    const oldRows = request.type === 'deleteRange' ? (await table.query({ trans, values: true, query: { index: table.schema.primaryKey, range: request.range } })).result : await table.getMany({ trans, keys: request.keys ?? ('values' in request ? request.values.map(value => value.id) : []) });
    const touched = seen.get(trans) ?? new Set<string>(); seen.set(trans, touched);
    const values = 'values' in request ? request.values : [];
    const pending = new Map<string, { root?: Record<string, unknown>; parts: unknown[]; operations: number[] }>();
    for (let index = 0; index < Math.max(oldRows.length, values.length); index++) {
      const old = oldRows[index], next = values[index];
      const id = name === 'documents' ? old?.id ?? next?.id : old?.documentId ?? next?.documentId;
      if (!id || touched.has(id)) continue;
      if (old && next && JSON.stringify({ ...old, updatedAt: 0 }) === JSON.stringify({ ...next, updatedAt: 0 })) {
        if (!(old.blob instanceof Blob && next.blob instanceof Blob) || await Dexie.waitFor(hash(await Dexie.waitFor(old.blob.arrayBuffer()))) === await Dexie.waitFor(hash(await Dexie.waitFor(next.blob.arrayBuffer())))) continue;
      }
      const previous = pending.get(id); if (previous) { previous.operations.push(index); continue; }
      const document = await core.table('documents').get({ trans, key: id });
      const childTable = core.table('parts'), parts = document ? (await childTable.query({ trans, values: true, query: { index: childTable.schema.getIndexByKeyPath('documentId')!, range: { type: 1, lower: id, upper: id } } })).result : [];
      pending.set(id, { root: document, parts, operations: [index] });
    }
    return async response => {
      for (const [id, candidate] of pending) {
        if (touched.has(id) || candidate.operations.every(index => !!response.failures[index])) continue;
        touched.add(id);
        const document = candidate.root; if (!document) continue;
        let root = document;
        if (document.blob instanceof Blob) {
          const digest = await Dexie.waitFor(hash(await Dexie.waitFor(document.blob.arrayBuffer())));
          const assets = core.table('assets');
          if (!await assets.get({ trans, key: digest })) {
            const saved = await assets.mutate({ type: 'put', trans, values: [{ id: digest, hash: digest, blob: document.blob }] }); if (saved.numFailures) throw Error('Asset save failed');
          }
          const { blob, ...metadata } = document; void blob; root = { ...metadata, assetId: digest };
        }
        const saved = await core.table('history').mutate({ type: 'add', trans, values: [{ id: crypto.randomUUID(), documentId: id, root, parts: candidate.parts }] }); if (saved.numFailures) throw Error('History save failed');
      }
    };
  } });
  try {
    const documents = database.table('documents'), parts = database.table('parts');
    await database.transaction('rw', documents, parts, async () => { await documents.add({ id: 'one', projectId: 'project', title: 'First', updatedAt: 1 }); await parts.add({ id: 'child', documentId: 'one', text: 'Original child' }); });
    assert(await database.table('history').count() === 0, 'Creation captured a partial aggregate');
    await database.transaction('r', documents, async () => { assert(Dexie.currentTransaction?.storeNames.join() === 'documents', 'Readonly transaction scope expanded'); await documents.get('one'); });
    await database.table('unrelated').put({ id: 'unrelated' }); assert(await database.table('history').count() === 0, 'Unrelated write captured history');
    await database.transaction('rw', documents, parts, async () => { await parts.update('child', { text: 'New child' }); await database.transaction('rw', documents, async () => { await documents.update('one', { title: 'Second' }); }); });
    let history = await database.table('history').toArray(); assert(history.length === 1 && history[0].root.title === 'First' && history[0].parts[0].text === 'Original child', 'Nested mutations retained partial/preorder state');
    try { await database.transaction('rw', documents, async () => { await documents.update('one', { title: 'Rolled back' }); throw Error('Synthetic rollback'); }); } catch { /* Expected */ }
    assert(await database.table('history').count() === 1 && (await documents.get('one')).title === 'Second', 'Rollback leaked history or source write');
    await documents.update('one', { updatedAt: 5 }); assert(await database.table('history').count() === 1, 'Timestamp-only update created history');
    const bytes = new Uint8Array(4 * 1024 * 1024).fill(7), blob = new Blob([bytes], { type: 'audio/wav' });
    await documents.add({ id: 'audio', projectId: 'project', title: 'Audio', blob, updatedAt: 1 });
    await documents.update('audio', { title: 'Annotated' }); await documents.update('audio', { title: 'Annotated twice' });
    history = await database.table('history').where('documentId').equals('audio').toArray();
    assert(history.length === 2 && history.every(row => !row.root.blob && row.root.assetId) && await database.table('assets').count() === 1, 'History duplicated binary bytes');
    assert((await documents.get('audio')).blob.size === bytes.length && (await database.table('assets').toArray())[0].blob.size === bytes.length, 'Blob changed');
    const changedBytes = bytes.slice(); changedBytes[0] = 9; await documents.update('audio', { blob: new Blob([changedBytes], { type: 'audio/wav' }) });
    await documents.update('audio', { title: 'Different audio metadata' });
    assert(await database.table('assets').count() === 2 && (await database.table('history').where('documentId').equals('audio').count()) === 4, 'Equal-size binary replacement was mistaken for a no-op');
    await documents.bulkAdd([{ id: 'good', projectId: 'project', title: 'Good', unique: 'a' }, { id: 'bad', projectId: 'project', title: 'Bad', unique: 'b' }]);
    await database.transaction('rw', documents, async () => {
      try { await documents.bulkPut([{ id: 'good', projectId: 'project', title: 'Good changed', unique: 'a' }, { id: 'bad', projectId: 'project', title: 'Failed candidate', unique: 'a' }]); } catch { /* Caller intentionally retains successful members. */ }
    });
    assert(await database.table('history').where('documentId').equals('good').count() === 1 && await database.table('history').where('documentId').equals('bad').count() === 0 && (await documents.get('bad')).title === 'Bad', 'Caught partial bulk failure created fictitious history');
    await parts.where('documentId').equals('one').delete(); history = await database.table('history').where('documentId').equals('one').toArray(); assert(history.length === 2 && history.some(row => row.parts.length === 1 && row.parts[0].text === 'New child'), 'Child range delete lost preimage');
    return ['DBCore prototype: relevant rw capture, untouched readonly/unrelated transactions, one aggregate preimage across nested child/root writes and atomic rollback', 'DBCore prototype: Blob async bytehash retains live transaction and stores one immutable payload across metadata revisions; equal-size changed bytes stay distinct, timestamps create no version and caught partial bulk failure records only successful edits'];
  } finally { database.close(); await database.delete(); }
}
