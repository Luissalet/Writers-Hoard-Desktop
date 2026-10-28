import {createFakeLocalToolHost, type LocalToolHostFixtures} from '@/engines/local/testing';
import type {LocalToolDefinition, LocalToolJson} from '@/engines/local/sdk';
import type {LocalToolOpenDocuments} from '@/engines/local/openDocuments';
import type {SourceToolDocument} from '@/engines/local/documents/types';
import {assert, bounded, deferred, group, type RecordEvent} from './local-tool-open-documents.helpers';
const P = 'sdk34-node-kit', NS = 'tests.open-fields-node';
type Data = {score: number; active: boolean; names: string[]; notes: string; opaque: {literal: string}};
const initial: Data = {score: 0, active: true, names: ['Nora', '李明'], notes: 'Élodie 🐚', opaque: {literal: 'Keep opaque:id'}};
const definition: LocalToolDefinition<Data> = {
 apiVersion: 1, namespace: NS, name: {en: 'Open fields fixture', es: 'Prueba de campos abiertos'},
 description: {en: 'Memory host only', es: 'Sólo host de memoria'}, document: {defaultTitle: {en: 'Open fields document', es: 'Documento de campos abiertos'}}, component: () => null, initialState: initial,
 codec: {version: 1, fields: {score: {kind: 'scalar'}, active: {kind: 'scalar'}, names: {kind: 'scalar'}, notes: {kind: 'prose'}}},
 index: {version: 1, fields: {points: {path: '$.score', type: 'number'}}},
 validateState: (value: LocalToolJson): value is Data => !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.score === 'number' && typeof value.active === 'boolean' && Array.isArray(value.names) && value.names.every(name => typeof name === 'string') && typeof value.notes === 'string' && !!value.opaque && typeof value.opaque === 'object' && !Array.isArray(value.opaque) && typeof value.opaque.literal === 'string',
};
const query = {namespace: NS, fields: {points: {path: '$.score', type: 'number' as const}, enabled: {path: '$.active', type: 'boolean' as const}, names: {path: '$.names[*]', type: 'string[]' as const, mode: 'all' as const}}};
const ids = (rows: readonly {id: string}[]) => rows.map(row => row.id).sort();
function fixtures(): LocalToolHostFixtures {
 const document = (id: string, score: number): SourceToolDocument => ({id, namespace: NS, title: id, revision: 0, createdAt: 1, updatedAt: 1, data: {...structuredClone(initial), score}, codec: structuredClone(definition.codec!), index: structuredClone(definition.index!)});
 // Own undefined metadata is intentionally present, so deep equality must not use JSON.stringify.
 const project = {id: P, updatedAt: 1, worldEras: [{id: 'past'}], observerOnly: undefined, sourceToolDocuments: [document('A', 7), document('C', 11)]};
 return {projects: [project]};
}
async function announced(port: LocalToolOpenDocuments, action: () => void | Promise<unknown>) {
 const signal = deferred<void>(), stop = port.subscribe(() => signal.resolve(undefined));
 try {await action();await bounded(signal.promise, 'kit public change notification');} finally {stop();}
}

export async function testLocalToolOpenDocumentsKit(record: RecordEvent = () => {}) {
 const groups: string[] = [], scope = {projectId: P}, host = createFakeLocalToolHost(definition, fixtures());
 const a = host.createClient(scope, false, 'A'), c = host.createClient(scope, false, 'C'), readonly = host.createClient(scope, true, 'A');
 const stops: (() => void)[] = [];
 try {
  await group(groups, record, 'Public kit saved queries/read are healthy but createClient/read never mount', async () => {
   const before = host.inspect();
   const durable = await a.queryDocuments({namespace: NS});assert.deepEqual(ids(durable), ['A', 'C']);
   assert.deepEqual(durable.map(row => [row.id, row.fields.points]), [['A', 7], ['C', 11]]);
   assert.equal((await a.read()).data.score, 7);assert.equal((await c.read()).data.score, 11);
   assert.ok(a.openDocuments, 'Public openDocuments is absent after durable/read controls');
   assert.deepEqual(await a.openDocuments.query(query), []);
   host.createClient(scope, false, 'A');await readonly.read();
   assert.deepEqual(await a.openDocuments.query(query), []);
   assert.deepEqual(host.inspect(), before, 'Read/client creation changed memory fixture');
   let closeA = () => {};await announced(a.openDocuments, () => {closeA = host.mountDocument(scope, 'A');stops.push(closeA);});
   const opened = await readonly.openDocuments!.query(query);assert.deepEqual(ids(opened), ['A']);assert.deepEqual(opened[0].fields, {points: 7, enabled: true, names: ['Nora', '李明']});
   assert.deepEqual(host.inspect(), before, 'Mount/read changed inspect');
   return {durable: ids(durable), opened: ids(opened), inspectUnchanged: true};
  });
  await group(groups, record, 'Normal Source Save refreshes public open query; readonly consumers neither write nor mount', async () => {
   const before = await a.read();assert.ok(before.document);
   await announced(readonly.openDocuments!, () => a.save({...before.data, score: 8}, before.revision, before.document!.version));
   const saved = await a.read();assert.equal(saved.revision, before.revision! + 1);
   const afterSave = host.inspect(), opened = await readonly.openDocuments!.query(query), durable = await readonly.queryDocuments({namespace: NS});
   assert.equal(opened[0].fields.points, 8);assert.deepEqual(durable.map(row => [row.id, row.fields.points]), [['A', 8], ['C', 11]]);
   await readonly.read();await readonly.openDocuments!.query(query);
   assert.deepEqual(host.inspect(), afterSave, 'Readonly reads changed saved state/metadata');
   await assert.rejects(async () => readonly.save({...saved.data, score: 90}, saved.revision, saved.document!.version));
   assert.deepEqual(host.inspect(), afterSave, 'Readonly Save refusal changed fixture');
   const opaque = (await a.read()).data;assert.deepEqual(opaque.opaque, initial.opaque);assert.equal(opaque.notes, initial.notes);
   return {saved: 8, closedC: 11, inspectReadonly: true};
  });
  await group(groups, record, 'Explicit duplicate mounts and kit instances isolate open membership without durable changes', async () => {
   const other = createFakeLocalToolHost(definition, fixtures()), otherClient = other.createClient(scope, true, 'A');
   const before = host.inspect(), otherBefore = other.inspect(), closeA2 = host.mountDocument(scope, 'A');stops.push(closeA2);
   assert.deepEqual(ids(await a.openDocuments!.query(query)), ['A']);
   assert.deepEqual(await otherClient.openDocuments!.query(query), []);
   const closeC = other.mountDocument(scope, 'C');
   try {
    assert.deepEqual(ids(await otherClient.openDocuments!.query(query)), ['C']);
    stops[0]();assert.deepEqual(ids(await a.openDocuments!.query(query)), ['A']);
    closeA2();assert.deepEqual(await a.openDocuments!.query(query), []);
    assert.deepEqual(ids(await a.queryDocuments({namespace: NS})), ['A', 'C']);
    assert.deepEqual(host.inspect(), before);assert.deepEqual(other.inspect(), otherBefore);
    return {firstKit: [], secondKit: ['C'], durable: ['A', 'C']};
   } finally {closeC();}
  });
 } finally {for (const stop of stops) stop();}
 return {ok: true, groups};
}
