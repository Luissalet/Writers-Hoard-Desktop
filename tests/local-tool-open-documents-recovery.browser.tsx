import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import {useLocalToolOpenDocuments} from '@/engines/local/useLocalToolOpenDocuments';
import type {LocalToolDefinition, LocalToolJson} from '@/engines/local/sdk';
import type {LocalToolOpenDocumentQuery} from '@/engines/local/openDocuments';

type Data = {score: number};
type View = {label: string; rows: {id: string; fields: unknown}[]; loading: boolean; error: string};
/** Public memory kit + real React hook; no database, SourceHost or Native claims. */
export async function testLocalToolOpenDocumentsQueryRecovery() {
const events: unknown[] = [];
Reflect.set(window, '__sdk34QueryRecoveryTraces', events);
const record = (event: unknown) => {events.push(event);console.info('PEER_HOOK_RECOVERY ' + JSON.stringify(event));};
const check = (condition: unknown, message: string) => {if (!condition) throw Error(message);};
const NS = 'tests.peer-hook-recovery', P = 'peer-hook-recovery';
const definition: LocalToolDefinition<Data> = {
  apiVersion: 1, namespace: NS, name: {en: 'Hook recovery fixture', es: 'Prueba de recuperación'},
  description: {en: 'Own memory fixture', es: 'Fixture propia en memoria'}, component: () => null,
  initialState: {score: 7},
  validateState: (value: LocalToolJson): value is Data => !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.score === 'number',
};
const normal: LocalToolOpenDocumentQuery = {namespace: NS, fields: {points: {path: '$.score', type: 'number'}}};
const host = createFakeLocalToolHost(definition, {projects: [{id: P, updatedAt: 1, sourceToolDocuments: [{id: 'A', namespace: NS, title: 'Own A', revision: 0, createdAt: 1, updatedAt: 1, data: {score: 7}}]}]});
const client = host.createClient({projectId: P}, true, 'A');
const close = host.mountDocument({projectId: P}, 'A');
const inspectBefore = JSON.stringify(host.inspect()); // Fixture has JSON data and no undefined metadata.
let latest: View | undefined, root: ReturnType<typeof createRoot> | undefined;
const views: View[] = [];
function Consumer({query,label}: {query: LocalToolOpenDocumentQuery; label: string}) {
  const result = useLocalToolOpenDocuments(client, query);
  const view: View = {label, rows: result.rows.map(row => ({id: row.id, fields: row.fields})), loading: result.loading, error: result.error};
  // This observation is made in render, before passive effects can refresh cached state.
  latest = view;views.push(view);record({phase: 'render', ...view});
  return <output data-label={label} data-loading={String(view.loading)}>{JSON.stringify(view)}</output>;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(test: () => boolean, message: string) {
  const end = Date.now() + 3000;
  while (!test()) {if (Date.now() > end) throw Error(message);await act(async () => {await pause();});}
}
async function render(query: LocalToolOpenDocumentQuery, label: string) {await act(async () => {root!.render(<Consumer query={query} label={label}/>);});}
async function refused(name: string, query: unknown) {
  let error: string | undefined;
  try {await client.openDocuments!.query(query as LocalToolOpenDocumentQuery);} catch (reason) {error = String(reason);}
  record({phase: 'validation-control', name, error: error ?? null});check(error, 'EXPECTED_VALIDATION_REFUSAL_' + name);
}
  let firstRecovery: View | undefined, cleanupOk = false;
  try {
    check(!!client.openDocuments, 'CONTROL_PUBLIC_PORT_MISSING');
    const frozen = Object.freeze({namespace: undefined, fields: Object.freeze({points: Object.freeze({path: '$.score', type: 'number' as const, mode: undefined})})});
    const frozenRows = await client.openDocuments!.query(frozen);
    check(frozenRows.length === 1 && frozenRows[0].fields.points === 7, 'FROZEN_DECLARED_OPTIONALS_FAILED');
    check(Object.isFrozen(frozen) && Object.isFrozen(frozen.fields) && Object.isFrozen(frozen.fields.points) && Object.hasOwn(frozen, 'namespace') && Object.hasOwn(frozen.fields.points, 'mode') && frozen.namespace === undefined && frozen.fields.points.mode === undefined, 'FROZEN_INPUT_CHANGED');
    record({phase: 'validation-control', name: 'frozen-declared-optionals', rows: frozenRows, callerUnchanged: true});
    let getters = 0;
    const getterNamespace = {fields: normal.fields};Object.defineProperty(getterNamespace, 'namespace', {enumerable: true, get() {getters++;return NS;}});
    await refused('namespace-getter', getterNamespace);
    const getterField = {path: '$.score', type: 'number'};Object.defineProperty(getterField, 'mode', {enumerable: true, get() {getters++;return 'first';}});
    await refused('mode-getter', {namespace: NS, fields: {points: getterField}});
    check(getters === 0, 'GETTER_WAS_INVOKED');record({phase: 'validation-control', name: 'getters-not-invoked', getters});
    await refused('unknown-root-undefined', {...normal, extra: undefined});
    await refused('unknown-field-undefined', {namespace: NS, fields: {points: {...normal.fields.points, extra: undefined}}});

    root = createRoot(document.getElementById('root')!);
    await render(normal, 'valid-before');
    await until(() => latest?.loading === false && latest.error === '' && latest.rows.length === 1 && latest.rows[0].id === 'A', 'CONTROL_VALID_HOOK_A7_NOT_SETTLED');
    check((latest!.rows[0].fields as {points: number}).points === 7, 'CONTROL_VALID_HOOK_WRONG_VALUE');
    const invalid = {...normal, extra: undefined} as LocalToolOpenDocumentQuery;
    await render(invalid, 'invalid');
    check(latest?.rows.length === 0 && latest.loading === false && !!latest.error, 'INVALID_HOOK_DID_NOT_RETURN_EMPTY_ERROR');
    close();await act(async () => {await pause();});
    check((await client.openDocuments!.query(normal)).length === 0, 'CONTROL_A_NOT_CLOSED');
    const start = views.length;
    await render(normal, 'recovered');
    firstRecovery = views.slice(start).find(view => view.label === 'recovered');
    record({phase: 'first-recovery', view: firstRecovery ?? null});
    await until(() => latest?.label === 'recovered' && latest.loading === false && latest.rows.length === 0 && latest.error === '', 'RECOVERY_DID_NOT_SETTLE_EMPTY');
    record({phase: 'settled-recovery', view: latest});
  } finally {
    if (root) await act(async () => {root!.unmount();});
    close();
    cleanupOk = (await client.openDocuments!.query(normal)).length === 0 && JSON.stringify(host.inspect()) === inspectBefore;
    record({phase: 'cleanup', membershipEmptyAndInspectExact: cleanupOk, rootUnmounted: true, scope: 'RAM fixture only; no DB exists'});
    check(cleanupOk, 'CLEANUP_FAILED');
  }
  check(!!firstRecovery && firstRecovery.rows.length === 0, 'FIRST_RECOVERY_RENDER_REUSED_CLOSED_A');
  return ['Declared undefined optional slots support frozen inputs without changing caller; getters stay uncalled and unknown undefined remains invalid', 'Valid to invalid to close to same-query recovery never republishes closed A in the first render; settled empty and cleanup exact'];

}
