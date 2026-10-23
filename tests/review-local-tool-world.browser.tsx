import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defineLocalTool, useLocalToolWorldList, useLocalToolWorldRead, type LocalToolWorldClient, type LocalToolWorldRead } from '@/engines/local/sdk';
import { createFakeLocalToolHost } from '@/engines/local/testing';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
export async function reviewLocalToolWorld(): Promise<string[]> {
  const callbacks: (() => void)[] = [], pending: ((rows: LocalToolWorldRead[]) => void)[] = [];
  let calls = 0, stopped = 0;
  const client: LocalToolWorldClient = { projectId: 'independent-world', world: { list: async () => { calls++; return new Promise(resolve => pending.push(resolve)); }, read: async () => undefined }, subscribe: changed => { callbacks.push(changed); return () => { stopped++; }; } };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  function View() { const result = useLocalToolWorldList(client, 'codex'); return <p>{result.rows.map(row => row.document.root.title).join(',')}</p>; }
  try {
    await act(async () => { root.render(<StrictMode><View/></StrictMode>); await pause(); });
    assert(calls === 2 && stopped === 1, 'StrictMode did not exercise setup-cleanup-setup');
    const row = (title: string): LocalToolWorldRead => ({ document: { root: { id: title, title }, children: {} }, version: title, provenance: 'base', variantRevision: null });
    await act(async () => { pending[1]([row('Current')]); await pause(); });
    await act(async () => { pending[0]([row('Disposed')]); callbacks[0](); await pause(); });
    assert(host.textContent === 'Current' && calls === 2, 'Disposed StrictMode request or observer remained active');
    await act(async () => { root.unmount(); });
    for (const callback of callbacks) callback();
    await pause(); assert(stopped === 2 && calls === 2 && !host.textContent, 'Unmounted observer scheduled another read');
  } finally { host.remove(); }

  const plainHost = document.createElement('div'); document.body.append(plainHost); const plain = createRoot(plainHost);
  // Keep the no-subscribe client stable, as normal public clients are.
  const noSubscribe = { ...client, subscribe: undefined };
  function StableMissing() { const result = useLocalToolWorldRead(noSubscribe, 'codex', 'missing'); return <p>{result.loading ? 'Loading' : result.error || (result.document ? 'Found' : 'Missing')}</p>; }
  try { await act(async () => { plain.render(<StableMissing/>); await pause(); }); assert(plainHost.textContent === 'Missing', 'Optional subscription made the initial missing read fail'); }
  finally { await act(async () => { plain.unmount(); }); plainHost.remove(); }

  const fixture = defineLocalTool({ namespace: 'tests.independent-world', name: { en: 'World', es: 'Mundo' }, description: { en: 'Fixture', es: 'Prueba' }, initialState: { value: 0 }, validateState: (value): value is { value: number } => !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.value === 'number', component: () => null,
    operations: [{ id: 'noop', description: { en: 'No mutation', es: 'Sin cambio' }, writes: true, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, run: async (_input, current) => { await current.read(); return null; } },
      { id: 'two', description: { en: 'Two writes', es: 'Dos escrituras' }, writes: true, inputSchema: { type: 'object', properties: { abort: { type: 'boolean' } }, additionalProperties: false }, run: async (input, current) => { const before = await current.read(); const first = await current.save({ value: before.data.value + 1 }, before.revision); await current.save({ value: first.data.value + 1 }, first.revision); return input.abort ? Number.NaN : null; } }],
  });
  const project: Project = { id: 'independent-world', title: 'World', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#000', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1 };
  const fake = createFakeLocalToolHost(fixture, { projects: [project] }), scope = { projectId: project.id }, current = fake.createClient(scope);
  let events = 0, observed = -1;
  const stop = current.subscribe!(() => { events++; void current.read().then(value => { observed = value.data.value; }); });
  try {
    await fake.runOperation(scope, 'noop', {}, true); await pause(); assert(events === 0, 'No-op operation published an event');
    await fake.runOperation(scope, 'two', {}, true); await pause(); assert(events === 1 && observed === 2, 'Nested saves published intermediate snapshots or duplicate events');
    const before = JSON.stringify(fake.inspect()); let rejected = false;
    try { await fake.runOperation(scope, 'two', { abort: true }, true); } catch { rejected = true; }
    await pause(); assert(rejected && events === 1 && JSON.stringify(fake.inspect()) === before, 'Invalid result committed or announced its two writes');
  } finally { stop(); }
  return ['StrictMode teardown ignores late responses and disposed callbacks; clients without subscribe still read missing documents', 'fake no-op emits nothing; two nested saves emit one committed snapshot; invalid result rolls both writes back with no event'];
}
