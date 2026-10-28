import {createLocalToolOpenDocumentRegistry, validateLocalToolOpenDocumentQuery, type LocalToolOpenDocumentQuery, type LocalToolOpenDocumentRead} from '@/engines/local/openDocuments';
import {assert, deferred, bounded, group, type RecordEvent} from './local-tool-open-documents.helpers';
const NS = 'tests.open-fields-node', scope = {projectId: 'open-fields-world'};
const fields = {points: {path: '$.score', type: 'number' as const}};
const query: LocalToolOpenDocumentQuery = {namespace: NS, fields};
const row = (id: string, score: number): LocalToolOpenDocumentRead => ({document: {id, namespace: NS, title: id, data: {score, names: ['Nora', '李明'], privateText: 'Do not project this prose'}}, provenance: 'base'});
const ids = (rows: readonly {id: string}[]) => rows.map(row => row.id).sort();

export async function testLocalToolOpenDocumentsCore(record: RecordEvent = () => {}) {
 const groups: string[] = [];
 await group(groups, record, 'Fast A closes/reopens while C waits; old capture cannot recruit new leases', async () => {
  const registry = createLocalToolOpenDocumentRegistry(), held = deferred<LocalToolOpenDocumentRead>(), entered = deferred<void>();
  const stops = [registry.register(scope, 'A', NS), registry.register(scope, 'C', NS)];
  const work = registry.projectCaptured(registry.capture(scope, NS), query, async (_scope, id) => {
   if (id === 'C') {entered.resolve(undefined);return held.promise;}return row(id, 7);
  });
  try {
   await bounded(entered.promise, 'C reader entered');await Promise.resolve();
   stops[0]();stops.push(registry.register(scope, 'A', NS), registry.register(scope, 'D', NS));
   held.resolve(row('C', 11));const result = await bounded(work, 'old capture');
   assert.deepEqual(ids(result), ['C']);assert.equal(result[0].fields.points, 11);
   const fresh = await registry.projectCaptured(registry.capture(scope, NS), query, async (_scope, id) => row(id, id === 'C' ? 11 : 7));
   assert.deepEqual(ids(fresh), ['A', 'C', 'D']);return {old: ids(result), fresh: ids(fresh)};
  } finally {held.resolve(row('C', 11));for (const stop of stops) stop();await work.catch(() => {});}
 });
 await group(groups, record, 'H2 captured before H1 closes survives; final adapter revalidation rejects later reopen', async () => {
  const registry = createLocalToolOpenDocumentRegistry(), held = deferred<LocalToolOpenDocumentRead>(), entered = deferred<void>();
  const h1 = registry.register(scope, 'A', NS), h2 = registry.register(scope, 'A', NS), c = registry.register(scope, 'C', NS);
  const capture = registry.capture(scope, NS), work = registry.projectCaptured(capture, query, async (_scope, id) => {
   if (id === 'C') {entered.resolve(undefined);return held.promise;}return row('A', 7);
  });let reopened = () => {};
  try {
   await bounded(entered.promise, 'captured H2');h1();held.resolve(row('C', 11));
   const result = await bounded(work, 'H2 retained');assert.deepEqual(ids(result), ['A', 'C']);
   // A separate host-adapter await occurs after the projector has returned its rows.
   await Promise.resolve();h2();reopened = registry.register(scope, 'A', NS);
   const final = registry.revalidateCaptured(capture, result);assert.deepEqual(ids(final), ['C']);
   assert.deepEqual(ids(result), ['A', 'C'], 'Filtering must not mutate the earlier returned array');
   return {beforeFinalAwait: ids(result), afterFinalAwait: ids(final)};
  } finally {held.resolve(row('C', 11));h1();h2();c();reopened();await work.catch(() => {});}
 });
 await group(groups, record, 'Caller scope, field selectors and query mutations cannot retarget an in-flight read', async () => {
  const registry = createLocalToolOpenDocumentRegistry(), mutableScope = {projectId: scope.projectId};
  const input = {namespace: NS, fields: {points: {path: '$.score', type: 'number' as const}}};
  const entered = deferred<void>(), held = deferred<LocalToolOpenDocumentRead>(), stop = registry.register(mutableScope, 'A', NS);
  const work = registry.projectCaptured(registry.capture(mutableScope, NS), input, async (readScope, id) => {
   assert.deepEqual(readScope, scope);assert.equal(id, 'A');entered.resolve(undefined);return held.promise;
  });
  try {
   await bounded(entered.promise, 'mutable query read');mutableScope.projectId = 'foreign-world';
   input.namespace = 'tests.foreign';input.fields.points.path = '$.privateText';
   const saved = row('A', 7);held.resolve(saved);const result = await bounded(work, 'detached query');
   assert.equal(result[0].namespace, NS);assert.deepEqual(result[0].fields, {points: 7});
   (saved.document.data as {score: number}).score = 900;
   assert.deepEqual(result[0].fields, {points: 7}, 'Result must detach from injected reader objects');
   return {fields: result[0].fields, readerScope: scope};
  } finally {held.resolve(row('A', 7));stop();await work.catch(() => {});}
 });
 await group(groups, record, 'Typed aliases and array modes return selected immutable data only, with ordinary validation errors', async () => {
  const registry = createLocalToolOpenDocumentRegistry(), stop = registry.register(scope, 'A', NS);
  const saved: LocalToolOpenDocumentRead = {document: {id: 'A', namespace: NS, title: 'Élodie', data: {score: 7, active: false, names: ['Nora', 9, '李明'], privateText: 'Unselected prose'}}, provenance: 'variant'};
  try {
   const selected: LocalToolOpenDocumentQuery = {fields: {
    scoreAlias: {path: '$.score', type: 'number'}, activeAlias: {path: '$.active', type: 'boolean'},
    namesAll: {path: '$.names[*]', type: 'string[]', mode: 'all'}, namesFirst: {path: '$.names[*]', type: 'string[]'},
    missing: {path: '$.absent', type: 'number'}, wrongType: {path: '$.score', type: 'string'},
   }};
   const rows = await registry.projectCaptured(registry.capture(scope), selected, async () => saved);
   assert.deepEqual(rows, [{id: 'A', namespace: NS, title: 'Élodie', provenance: 'variant', fields: {scoreAlias: 7, activeAlias: false, namesAll: ['Nora', '李明'], namesFirst: ['Nora']}}]);
   try {(rows[0].fields as Record<string, unknown>).scoreAlias = 900;} catch {}
   try {(rows[0].fields.namesAll as string[]).push('Mutated');} catch {}
   assert.deepEqual(rows[0].fields, {scoreAlias: 7, activeAlias: false, namesAll: ['Nora', '李明'], namesFirst: ['Nora']});
   (saved.document.data as {names: unknown[]}).names.push('Later');
   assert.deepEqual(rows[0].fields.namesAll, ['Nora', '李明']);
   const empty = await registry.projectCaptured(registry.capture(scope), {fields: {}}, async () => saved);
   assert.deepEqual(empty[0].fields, {});
   for (const invalid of [{}, {fields, limit: 100}, {fields: {bad: {path: '$[0]', type: 'number'}}}, {fields: {bad: {path: '$.score', type: 'integer'}}}, JSON.parse('{"fields":{"constructor":{"path":"$.score","type":"number"}}}')]) {
    assert.throws(() => validateLocalToolOpenDocumentQuery(invalid));
   }
   return {aliases: Object.keys(rows[0].fields), selectedOnly: true};
  } finally {stop();}
 });
 await group(groups, record, '101 open documents are all projected without the durable query default page', async () => {
  const registry = createLocalToolOpenDocumentRegistry(), expected = Array.from({length: 101}, (_value, index) => ({id: 'doc-' + String(index).padStart(3, '0'), score: index}));
  const stops = expected.map(item => registry.register(scope, item.id, NS));
  try {
   const data = new Map(expected.map(item => [item.id, item.score]));
   const rows = await registry.projectCaptured(registry.capture(scope), {fields}, async (_scope, id) => row(id, data.get(id)!));
   assert.equal(rows.length, 101);assert.deepEqual(rows.map(item => ({id: item.id, score: item.fields.points})), expected);
   assert.equal(new Set(rows.map(item => item.id)).size, 101);return {count: rows.length, first: rows[0].id, last: rows.at(-1)!.id};
  } finally {for (const stop of stops) stop();}
 });
 await group(groups, record, 'Factories, project/era scopes and subscription cleanup remain independent', async () => {
  const one = createLocalToolOpenDocumentRegistry(), two = createLocalToolOpenDocumentRegistry();
  let own = 0, foreign = 0, canceled = 0;
  const stopOwn = one.subscribe(scope, () => own++), stopForeign = one.subscribe({projectId: 'foreign-world'}, () => foreign++);
  const stopCanceled = one.subscribe(scope, () => canceled++), close = one.register(scope, 'A', NS);stopCanceled();
  const eraClose = one.register({...scope, eraId: 'past'}, 'C', NS);
  try {
   await Promise.resolve();assert.ok(own > 0);assert.equal(foreign, 0);assert.equal(canceled, 0);
   const a = await one.projectCaptured(one.capture(scope), {fields}, async (_scope, id) => row(id, 7));assert.deepEqual(ids(a), ['A']);
   const past = await one.projectCaptured(one.capture({...scope, eraId: 'past'}), {fields}, async (_scope, id) => row(id, 11));assert.deepEqual(ids(past), ['C']);
   const isolated = await two.projectCaptured(two.capture(scope), {fields}, async () => {throw Error('Empty factory must not read');});assert.deepEqual(isolated, []);
   close();close();const before = own;stopOwn();eraClose();await Promise.resolve();assert.equal(own, before);
   return {base: ids(a), past: ids(past), isolated: isolated.length, noForeignEvents: true};
  } finally {close();eraClose();stopOwn();stopForeign();stopCanceled();}
 });
 return {ok: true, groups};
}
