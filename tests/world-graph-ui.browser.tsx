import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { db } from '@/db';
import CodexEngine from '@/engines/codex/CodexEngine';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
function typeInto(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}
function LaterDeepLink({ projectId, entryId }: { projectId: string; entryId: string }) {
  const navigate = useNavigate();
  return <button data-testid="graph-later-deep-link" onClick={() => navigate(`/project/${projectId}/codex?entry=${entryId}`)}>Deep link</button>;
}
export async function testWorldGraphUi(): Promise<string[]> {
  const P = `world-graph-ui-${Date.now()}`, host = document.getElementById('root'); assert(host, 'Missing root');
  const root = createRoot(host), passed: string[] = [], nativeWorker = window.Worker;
  // The test bundler does not emit worker assets. The separate Vite QA runner
  // exercises the actual module worker; this UI test uses the same pure fallback.
  Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: undefined });
  const style = document.createElement('style'); style.textContent = '[data-testid="world-graph-canvas"]{width:900px;height:600px;position:relative}.react-flow__renderer,.react-flow__pane,.react-flow__viewport{position:absolute;width:100%;height:100%}.react-flow__node{position:absolute}[data-testid^="world-graph-node-"]{width:220px;min-height:74px}'; document.head.append(style);
  useLocaleStore.setState({ locale: 'en' });
  const node = <T extends Element = HTMLElement>(id: string): T => { const found = host.querySelector<T>(`[data-testid="${id}"]`); assert(found, `Missing ${id}`); return found; };
  const click = async (id: string) => act(async () => { node<HTMLElement>(id).click(); await pause(100); });
  const waitFor = async (message: string, test: () => boolean) => { for (let i = 0; i < 150; i++) { if (test()) return; await act(async () => { await pause(); }); } throw new Error(message); };
  try {
    await db.projects.put({ id: P, title: 'Graph UI', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: 1, updatedAt: 1 });
    const entry = (id: string, title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({ id, projectId: P, type: 'concept', title, fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1, ...extra });
    const alvaro = entry(`${P}-alvaro`, 'Álvaro', { type: 'character', fields: { aliases: 'La Sombra' }, content: '<p>Visitó el Puerto de Sal.</p>' }), port = entry(`${P}-port`, 'Puerto de Sal', { type: 'location' }), guild = entry(`${P}-guild`, 'Salt guild', { content: '<p>La Sombra trabaja aquí.</p>', relations: [{ targetId: port.id, targetTitle: port.title, type: 'located_in' }] });
    await db.codexEntries.bulkPut([alvaro, port, guild, ...Array.from({ length: 158 }, (_, i) => entry(`${P}-${i}`, `Isolated concept ${i}`))]);
    await act(async () => { root.render(<StrictMode><MemoryRouter initialEntries={[`/project/${P}/codex`]}><CodexEngine projectId={P} /><LaterDeepLink projectId={P} entryId={guild.id} /></MemoryRouter></StrictMode>); await pause(160); });
    await waitFor('Codex did not mount', () => !!host.querySelector('[data-testid="codex-show-graph"]'));
    await click('codex-show-graph');
    await waitFor('World graph did not analyze/mount', () => !!host.querySelector('[data-testid="world-graph-workspace"]'));
    assert(node('world-graph-counts').textContent?.includes('150/161') && host.textContent?.includes('More content is available'), 'Large graph UI shows exact visual cap and how to explore the remainder');
    await act(async () => { typeInto(node<HTMLSelectElement>('world-graph-node-limit'), '300'); await pause(120); });
    assert(node('world-graph-counts').textContent?.includes('161/161'), 'User can expand the visible limit without reimporting or losing cards');
    await act(async () => { typeInto(node<HTMLInputElement>('world-graph-search'), 'sombra'); await pause(100); });
    assert(node('world-graph-counts').textContent?.includes('1/1') && node(`world-graph-node-${alvaro.id}`), 'Name/alias search filters actual graph nodes');
    await act(async () => { typeInto(node<HTMLInputElement>('world-graph-search'), ''); typeInto(node<HTMLSelectElement>('world-graph-focus'), alvaro.id); await pause(100); });
    assert(node('world-graph-counts').textContent?.includes('3/3'), 'One-hop exploration includes both incoming/outgoing linked cards');
    await click(`world-graph-node-${alvaro.id}`);
    assert(node(`world-graph-node-${alvaro.id}`).closest<HTMLElement>('.react-flow__node')?.style.visibility === 'visible', 'Selecting a recreated controlled node must retain its known dimensions and visibility');
    assert(node('world-graph-inspector').textContent?.includes('This card’s connections') && node('world-graph-open-card'), 'Selected card has contextual provenance connections and direct open');
    const connection = host.querySelector<HTMLElement>('[data-testid^="world-graph-connection-"]'); assert(connection, 'Connection evidence action');
    await act(async () => { connection.click(); });
    assert(node('world-graph-inspector').textContent?.includes('Text evidence') && node('world-graph-inspector').textContent?.includes('Inferred from text'), 'Text connection reveals evidence and identifies inference');
    await act(async () => { typeInto(node<HTMLSelectElement>('world-graph-focus'), ''); typeInto(node<HTMLSelectElement>('world-graph-type'), 'location'); await pause(100); });
    assert(node('world-graph-counts').textContent?.includes('1/1'), 'Card category filter changes graph and reported counts');
    await click(`world-graph-node-${port.id}`); await click('world-graph-open-card');
    await waitFor('Graph card did not open existing Codex details', () => !!document.querySelector('[role="dialog"]'));
    assert(document.querySelector('[role="dialog"]')!.textContent?.includes('Puerto de Sal') && !host.querySelector('[data-testid="world-graph-workspace"]') && node('codex-show-cards').getAttribute('aria-pressed') === 'true', 'Direct graph action reuses the existing card detail/editor route');
    assert((await db.codexEntries.get(port.id))!.content === '', 'Graph analysis/filtering/opening never writes card content');
    await click('graph-later-deep-link');
    assert(document.querySelector('[role="dialog"] h2')?.textContent?.includes('Salt guild'), 'A consumed graph-open request cannot override subsequent search/backlink deep links');
    passed.push('Codex UI: lazy graph view, exact cap/expansion counts, aliases, neighborhoods and category filters operate on the visible graph');
    passed.push('Codex UI: contextual edge evidence distinguishes inference; direct open returns to the existing card detail modal without changing authored content');
    return passed;
  } finally {
    await act(async () => { root.unmount(); }); style.remove(); Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: nativeWorker });
    await db.codexEntries.where('projectId').equals(P).delete(); await db.projects.delete(P);
  }
}
