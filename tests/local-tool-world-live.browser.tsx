import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import { createCodexEntry, deleteCodexEntry } from '@/db/operations';
import { saveCodexDraft } from '@/engines/codex/operations';
import { createLocalToolClient } from '@/engines/local/storage';
import { defineLocalTool, useLocalToolWorldList, useLocalToolWorldRead, type LocalToolJson, type LocalToolClient, type LocalToolWorldRead } from '@/engines/local/sdk';
import { createFakeLocalToolHost } from '@/engines/local/testing';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import WorldCardList from '@/engines/local/examples/WorldCardList';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { hideEraDocument, readWorldDocument, resetEraDocument, saveEraDocument } from '@/services/worldEras/store';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(done => setTimeout(done, 35));
const P = 'world-live-sdk', Q = 'world-live-other';
const definition = defineLocalTool<LocalToolJson>({ namespace: 'tests.world-live', name: { en: 'World list', es: 'Lista del mundo' }, description: { en: 'Local world read fixture.', es: 'Prueba local de lectura.' }, initialState: null, validateState: (_value): _value is LocalToolJson => true, component: () => null });
const project = (id: string): Project => ({ id, title: id, description: '', mode: 'custom', type: 'standalone', color: '#000', status: 'draft', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: 1, updatedAt: 1, worldEras: [{ id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }] });
const card = (id: string, title: string, projectId = P): CodexEntry => ({ id, projectId, title, type: 'character', content: '', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 });
export async function testWorldCardListLive(): Promise<string[]> {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), passed: string[] = [], frames: string[] = [];
  const client = createLocalToolClient(P, definition), other = createLocalToolClient(Q, definition), scope = { projectId: P, eraId: 'past' };
  function View({ current }: { current: LocalToolClient<LocalToolJson> }) { useLayoutEffect(() => { frames.push(`${current.projectId}:${host.textContent}`); }); return <WorldCardList projectId={current.projectId} client={current}/>; }
  const render = async (current = client) => { await act(async () => { root.render(<View current={current}/>); await pause(); }); };
  const wait = async (check: () => boolean, label: string) => { for (let i = 0; i < 60; i++) { if (check()) return; await act(async () => { await pause(); }); } assert(check(), label); };
  const names = () => [...host.querySelectorAll('li button')].map(node => node.textContent);
  const mcp = async (name: string, args: Record<string, unknown> = {}) => { const result = await runBridgeTool(name, name === 'wh_get_codex_entry' ? args : { projectId: P, ...args }); assert(result.ok, `${name} failed: ${JSON.stringify(result)}`); return result.result; };
  try {
    useLocaleStore.setState({ locale: 'en', loaded: true }); await db.projects.bulkPut([project(P), project(Q)]);
    const first = card('world-live-one', 'Original card'); await createCodexEntry(first); await createCodexEntry(card('world-live-other', 'Other project card', Q));
    await render(); await wait(() => names().includes('Original card'), 'Initial world list missing');
    await act(async () => { await createCodexEntry(card('world-live-two', 'Created normally')); });
    await wait(() => names().includes('Created normally'), 'Stable WorldCardList missed normal Codex create');
    await act(async () => { await saveCodexDraft(first, { ...first, title: 'Renamed normally' }); });
    await wait(() => names().includes('Renamed normally') && !names().includes('Original card'), 'Stable WorldCardList missed normal Codex rename');
    const listed = await mcp('wh_list_codex') as { entries: { title: string }[] };
    const one = await mcp('wh_get_codex_entry', { id: first.id }) as { title: string };
    assert(listed.entries.some(row => row.title === 'Created normally') && one.title === 'Renamed normally', 'World UI and normal MCP disagree');
    await act(async () => { await deleteCodexEntry('world-live-two'); });
    await wait(() => !names().includes('Created normally'), 'Stable WorldCardList missed archive');
    passed.push('real stable-client WorldCardList follows normal Codex create/rename/archive and agrees with registered MCP list/get');
    let events = 0; const stop = client.subscribe!(() => { events++; });
    try { await db.transaction('rw', db.codexEntries, async () => { await createCodexEntry(card('world-aborted', 'Must roll back')); throw Error('rollback fixture'); }); } catch { /* Deliberate failed commit. */ }
    await act(async () => { await pause(); }); assert(events === 0 && !await db.codexEntries.get('world-aborted'), 'Aborted Dexie transaction announced success');
    await act(async () => { await createCodexEntry(card('world-committed', 'One committed event')); notifyDataChanged({ source: 'other', projectId: P }); await pause(); });
    assert(events === 1, `Commit and explicit event did not coalesce: ${events}`); stop();
    await act(async () => { await createCodexEntry(card('world-after-stop', 'After stop')); notifyDataChanged({ source: 'other', projectId: P }); await pause(); });
    assert(events === 1, 'Unsubscribe left Dexie or explicit listener active');
    await deleteCodexEntry('world-committed'); await deleteCodexEntry('world-after-stop');
    passed.push('real subscription publishes confirmed Dexie commits, coalesces duplicate announcements, ignores rollback and removes both event subscriptions');
    const base = JSON.stringify(await db.codexEntries.get(first.id)), era = createLocalToolClient(P, definition, { eraId: 'past' }), original = (await readWorldDocument(scope, 'codex', first.id))!;
    await act(async () => { await saveEraDocument(scope, 'codex', { root: { ...original.document.root, title: 'Past card' }, children: {} }, original.version); });
    await render(era); await wait(() => names().includes('Past card'), 'Era variant missing');
    const variant = (await readWorldDocument(scope, 'codex', first.id))!;
    await act(async () => { await hideEraDocument(scope, 'codex', first.id, variant.version); }); await wait(() => !names().length, 'Hidden era card remained');
    const hidden = (await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([P, 'past', 'codex', first.id]).first())!;
    await act(async () => { await resetEraDocument(scope, 'codex', first.id, hidden.revision); }); await wait(() => names().includes('Renamed normally'), 'Reinherit did not refresh');
    assert(JSON.stringify(await db.codexEntries.get(first.id)) === base, 'Era view changed Base');
    await render(other); await wait(() => names().includes('Other project card'), 'Other scope did not load');
    assert(frames.filter(frame => frame.startsWith(Q + ':')).every(frame => !frame.includes('Renamed normally') && !frame.includes('Past card')), 'Retarget committed a frame of old project titles');
    passed.push('era variant/hide/reinherit refresh through the same client without Base mutation; scope retarget exposes no prior-project frame');
  } finally { await act(async () => root.unmount()); host.remove(); for (const id of [P, Q]) { await db.codexEntries.where('projectId').equals(id).delete(); await db.worldEraVariants.where('projectId').equals(id).delete(); await db.projects.delete(id); } }
  return passed;
}

export async function testLocalToolWorldQueryRaces(): Promise<string[]> {
  type Deferred<V> = { promise: Promise<V>; resolve: (value: V) => void; reject: (error: Error) => void };
  const deferred = <V,>(): Deferred<V> => { let resolve!: (value: V) => void, reject!: (error: Error) => void; const promise = new Promise<V>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const memory = createFakeLocalToolHost(definition, { projects: [project(P), project(Q)], documents: [{ projectId: Q, kind: 'codex', id: 'other', document: { root: { ...card('other', 'Recovered card', Q) }, children: {} } }] });
  const controlled = (id: string) => {
    const lists: Deferred<LocalToolWorldRead[]>[] = [], reads: Deferred<LocalToolWorldRead | undefined>[] = [], listeners = new Set<() => void>(); let stopped = 0;
    const client = { ...memory.createClient({ projectId: id }), subscribe: (changed: () => void) => { listeners.add(changed); return () => { listeners.delete(changed); stopped++; }; }, world: { list: () => { const request = deferred<LocalToolWorldRead[]>(); lists.push(request); return request.promise; }, read: () => { const request = deferred<LocalToolWorldRead | undefined>(); reads.push(request); return request.promise; } } };
    return { client, lists, reads, listeners, stopped: () => stopped, emit: () => { for (const changed of listeners) changed(); } };
  };
  const row = (id: string, title: string, projectId = P): LocalToolWorldRead => ({ document: { root: { ...card(id, title, projectId) }, children: {} }, version: 'fixture1', provenance: 'base', variantRevision: null });
  const a = controlled(P), b = controlled(Q), host = document.createElement('div'), frames: { project: string; text: string; id: string }[] = []; document.body.append(host); const root = createRoot(host);
  function Probe({ current, id }: { current: typeof a.client; id: string }) {
    const list = useLocalToolWorldList(current, 'codex'), read = useLocalToolWorldRead(current, 'codex', id);
    const text = list.rows.map(value => value.document.root.title).join(',') + '|' + (read.document?.document.root.title ?? '');
    useLayoutEffect(() => { frames.push({ project: current.projectId, text, id }); });
    return <div data-loading={list.loading || read.loading}>{text}<p role="alert">{list.error || read.error}</p><button onClick={() => { list.retry(); read.retry(); }}>Retry</button></div>;
  }
  const render = async (current = a.client, id = 'one') => { await act(async () => { root.render(<Probe current={current} id={id}/>); await pause(); }); };
  try {
    await render(); assert(a.lists.length === 1 && a.reads.length === 1, 'Initial public queries missing');
    await act(async () => { a.emit(); await pause(); });
    await act(async () => { a.lists[1].resolve([row('new', 'Newest')]); a.reads[1].resolve(row('one', 'Newest read')); await pause(); });
    await act(async () => { a.lists[0].resolve([row('old', 'Stale response')]); a.reads[0].resolve(row('one', 'Stale read')); await pause(); });
    assert(host.textContent?.includes('Newest|Newest read') && !host.textContent.includes('Stale'), 'Late result replaced a newer event');
    await render(a.client, 'two'); assert(frames.filter(frame => frame.id === 'two').every(frame => !frame.text.includes('Newest read')), 'Read ID retarget leaked old document for a frame');
    await render(b.client); assert(frames.filter(frame => frame.project === Q).every(frame => !frame.text.includes('Newest')), 'Client retarget leaked previous scope rows');
    await act(async () => { b.lists[0].reject(Error('Read unavailable')); b.reads[0].reject(Error('Read unavailable')); a.reads[2].resolve(row('two', 'Old scope late')); await pause(); });
    assert(host.querySelector('[role="alert"]')?.textContent?.includes('Read unavailable') && !host.textContent?.includes('Old scope'), 'Error/current identity was lost');
    await act(async () => { host.querySelector('button')!.click(); await pause(); });
    await act(async () => { b.lists[1].resolve([row('other', 'Recovered Q', Q)]); b.reads[1].resolve(undefined); await pause(); });
    assert(host.textContent?.includes('Recovered Q|') && !host.querySelector('[role="alert"]')?.textContent && host.querySelector('[data-loading]')?.getAttribute('data-loading') === 'false', 'Retry or missing-document read failed');
    await act(async () => { root.render(<WorldCardList projectId={Q} client={b.client}/>); await pause(); });
    await act(async () => { b.lists[2].reject(Error('List unavailable')); await pause(); });
    const retry = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => /Retry reading|Reintentar lectura/.test(node.textContent ?? '')); assert(retry && host.querySelector('[role="alert"]')?.textContent === 'Error: List unavailable', 'WorldCardList hides its read error/retry action');
    await act(async () => { retry.click(); await pause(); });
    await act(async () => { b.lists[3].resolve([row('other', 'Recovered card', Q)]); await pause(); });
    assert(!host.querySelector('[role="alert"]') && host.querySelector('li button')?.textContent === 'Recovered card', 'WorldCardList retry did not recover its normal card action');
    await act(async () => { host.querySelector<HTMLButtonElement>('li button')!.click(); await pause(); }); assert(memory.commands.some(command => command.kind === 'navigate' && command.documentId === 'other'), 'Recovered world card lost normal navigation');
    await act(async () => root.unmount()); assert(!a.listeners.size && !b.listeners.size && a.stopped() > 0 && b.stopped() > 0, 'Queries retained subscriptions after unmount');
    return ['public world list/read hooks reject stale event and old client/ID results, clear scope frames, expose errors/retry and unsubscribe on cleanup', 'real WorldCardList displays failures, retries the same public client successfully and retains normal source navigation'];
  } finally { if (host.hasChildNodes()) await act(async () => root.unmount()); host.remove(); }
}

export async function testLocalToolWorldFakeCommits(): Promise<string[]> {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(done => { enter = done; }), gate = new Promise<void>(done => { release = done; });
  const source = defineLocalTool({ ...definition, operations: [
    { id: 'hold', description: { en: 'Hold a write.', es: 'Retener escritura.' }, writes: true, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, run: async (_input, client) => { await client.world.variants!.save('codex', { root: { ...card('fake-held', 'Committed after gate') }, children: {} }, null); enter(); await gate; return null; } },
    { id: 'abort', description: { en: 'Abort a write.', es: 'Abortar escritura.' }, writes: true, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, run: async (_input, client) => { await client.world.variants!.save('codex', { root: { ...card('fake-abort', 'Never visible') }, children: {} }, null); throw Error('abort fixture'); } },
  ] });
  const memory = createFakeLocalToolHost(source, { projects: [project(P), project(Q)], documents: [{ projectId: P, kind: 'codex', id: 'fake-base', document: { root: { ...card('fake-base', 'Inherited card') }, children: {} } }] });
  const scope = { projectId: P, eraId: 'past' }, client = memory.createClient(scope), host = document.createElement('div'); document.body.append(host); const root = createRoot(host); let events = 0, otherEvents = 0;
  const stop = client.subscribe!(() => { events++; }), stopOther = memory.createClient({ projectId: Q }).subscribe!(() => { otherEvents++; });
  const names = () => [...host.querySelectorAll('li button')].map(node => node.textContent);
  try {
    await act(async () => { root.render(<WorldCardList projectId={P} client={client}/>); await pause(); });
    assert(names().includes('Inherited card'), 'Memory client did not feed real component');
    const before = JSON.stringify(memory.inspect()); await client.world.list('codex'); await client.world.read('codex', 'fake-base'); assert(events === 0 && JSON.stringify(memory.inspect()) === before, 'Memory read emitted a mutation');
    const pending = memory.runOperation(scope, 'hold', {}, true); await entered;
    assert(events === 0 && !(await client.world.list('codex')).some(row => row.document.root.id === 'fake-held'), 'Unconfirmed draft emitted or became visible');
    await act(async () => { release(); await pending; await pause(); }); assert(events === 1 && names().includes('Committed after gate') && otherEvents === 0, 'Confirmed scoped commit was not published exactly once');
    await act(async () => { try { await memory.runOperation(scope, 'abort', {}, true); } catch { /* Deliberate rollback. */ } await pause(); });
    assert(events === 1 && !names().includes('Never visible'), 'Aborted memory write published success');
    const read = (await client.world.read('codex', 'fake-base'))!;
    await act(async () => { await client.world.variants!.save('codex', { ...read.document, root: { ...read.document.root, title: 'Renamed memory variant' } }, read.version); await pause(); });
    assert(names().includes('Renamed memory variant') && events === 2, 'Real component missed memory variant change');
    const variant = (await client.world.read('codex', 'fake-base'))!;
    await act(async () => { await client.world.variants!.hide('codex', 'fake-base', variant.version); await pause(); }); assert(!names().includes('Renamed memory variant') && events === 3, 'Memory hidden variant did not refresh');
    await act(async () => root.unmount()); stop(); stopOther(); const count = events;
    await client.save({ notes: 'After unsubscribe' }, null); await pause(); assert(events === count && otherEvents === 0, 'Memory subscriptions survived stop');
    return ['author memory client drives the same WorldCardList, publishes only confirmed scoped mutations (never reads/pending/abort), follows variant/hide and cleans subscriptions'];
  } finally { stop(); stopOther(); if (host.hasChildNodes()) await act(async () => root.unmount()); host.remove(); }
}
