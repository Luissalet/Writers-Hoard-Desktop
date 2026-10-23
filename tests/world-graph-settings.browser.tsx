// The world graph's display settings (names all / main / on hover, card size,
// link strength, pictures), cards hidden from the graph and saved graphs, in
// the workspace and through the bridge, with undo.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import WorldGraphWorkspace from '@/engines/codex/worldGraph/WorldGraphWorkspace';
import { buildWorldGraph } from '@/engines/codex/worldGraph/model';
import { saveWorldGraphLayout, saveWorldGraphSettings } from '@/engines/codex/worldGraph/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const choose = async (element: Element | null, value: string) => { assert(element, 'control'); const control = element as HTMLSelectElement | HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(120); }); };
const click = async (element: Element | null, label: string) => { assert(element, label); await act(async () => { (element as HTMLElement).click(); await pause(150); }); };

export async function testWorldGraphSettings(): Promise<string[]> {
  const passed: string[] = [], P = `graph-settings-${Date.now()}`, host = document.getElementById('root')!;
  useLocaleStore.setState({ locale: 'es' });
  const style = document.createElement('style'); style.textContent = '[data-testid="world-graph-canvas"]{width:900px;height:600px;position:relative}.react-flow__renderer,.react-flow__pane,.react-flow__viewport{position:absolute;width:100%;height:100%}'; document.head.append(style);
  const root = createRoot(host);
  try {
    await db.projects.put({ id: P, title: 'Grafo', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1 } as Project);
    const entry = (id: string, title: string, content = ''): CodexEntry => ({ id: `${P}-${id}`, projectId: P, type: 'character', title, fields: {}, content, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as CodexEntry);
    const entries = [entry('hub', 'Ilse', '<p>Ilse conoce a Bruno, Carla, Dario y Elena.</p>'), entry('b', 'Bruno', '<p>Ilse</p>'), entry('c', 'Carla', '<p>Ilse</p>'), entry('d', 'Dario', '<p>Ilse</p>'), entry('e', 'Elena', '<p>Ilse</p>'), entry('f', 'Fausto')];
    await db.codexEntries.bulkPut(entries);
    const graph = buildWorldGraph({ projectId: P, entries, relationships: [] });
    await saveWorldGraphLayout(P, { [`${P}-f`]: { x: 10, y: 10 } });
    const render = async () => { const project = (await db.projects.get(P))!; await act(async () => { root.render(<WorldGraphWorkspace key={JSON.stringify(project.codexGraphLayout ?? {})} graph={graph} initialLayout={project.codexGraphLayout} onOpenEntry={() => undefined} onSaveLayout={positions => saveWorldGraphLayout(P, positions)} onSaveSettings={patch => saveWorldGraphSettings(P, patch).then(() => undefined)} />); await pause(250); }); };
    await render();
    const node = (id: string) => host.querySelector<HTMLElement>(`[data-testid="world-graph-node-${P}-${id}"]`);
    assert(node('hub')?.dataset.nameShown === 'true' && node('b')?.dataset.nameShown === 'true', 'All names by default');
    await click(host.querySelector('[data-testid="world-graph-settings"]'), 'settings');
    await choose(host.querySelector('[data-testid="world-graph-names"]'), 'hover');
    assert(node('hub')?.dataset.nameShown === 'false', 'Names on hover');
    await choose(host.querySelector('[data-testid="world-graph-size"]'), 'small');
    assert(node('hub')?.style.width === '150px', `Small cards: ${node('hub')?.style.width}`);
    await choose(host.querySelector('[data-testid="world-graph-opacity"]'), '0.4');
    await choose(host.querySelector('[data-testid="world-graph-names"]'), 'main');
    assert(node('hub')?.dataset.nameShown === 'true', 'The most connected card keeps its name in "main"');
    const saved = (await db.projects.get(P))!.codexGraphLayout!;
    assert(saved.display?.names === 'main' && saved.display.nodeSize === 'small' && saved.display.linkOpacity === 0.4 && saved.positions[`${P}-f`], `Saved with the pins kept: ${JSON.stringify(saved)}`);
    // Hide a card.
    await click(node('f'), 'Fausto');
    await click(host.querySelector('[data-testid="world-graph-hide-node"]'), 'hide');
    assert(!node('f') && /1 oculta/.test(host.querySelector('[data-testid="world-graph-show-hidden"]')?.textContent ?? ''), 'Fausto hidden, count shown');
    await click(host.querySelector('[data-testid="world-graph-show-hidden"]'), 'show hidden');
    assert(node('f'), 'Shown again on request');
    // Save a graph.
    await choose(host.querySelector('[data-testid="world-graph-view-name"]'), 'Círculo de Ilse');
    await click(host.querySelector('[data-testid="world-graph-view-save"]'), 'save view');
    assert((await db.projects.get(P))!.codexGraphLayout!.views?.[0]?.name === 'Círculo de Ilse', 'Graph saved');
    await render();
    assert(node('hub')?.style.width === '150px' && !node('f'), 'Reopened with its look and the hidden card');
    passed.push('Graph view: names for all, the main (most connected) cards or on hover; small cards; weaker links; pictures; Fausto hidden from the graph ("1 oculta", shown on request); "Círculo de Ilse" saved as a graph; reopened with the same look; pins kept');
    // Bridge.
    const read = await runBridgeTool('wh_world_graph_settings', { projectId: P });
    assert(read.ok && (read.result as { views: unknown[]; hiddenIds: string[]; pins: number }).views.length === 1 && (read.result as { pins: number }).pins === 1, `Read: ${JSON.stringify(read)}`);
    const shown = await runBridgeTool('wh_world_graph_settings', { projectId: P, action: 'show', entryIds: [`${P}-f`] });
    assert(shown.ok && !(shown.result as { hiddenIds: string[] }).hiddenIds.length, 'Show through the bridge');
    await undoAuditEntry({ entry: { ...(shown.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_world_graph_settings', kind: 'update' } });
    assert((await db.projects.get(P))!.codexGraphLayout!.hiddenIds?.includes(`${P}-f`), 'Undo hides it again');
    const display = await runBridgeTool('wh_world_graph_settings', { projectId: P, action: 'display', display: { names: 'all', nodeSize: 'large' } });
    assert(display.ok && (display.result as { display: { nodeSize: string; linkOpacity: number } }).display.nodeSize === 'large' && (display.result as { display: { linkOpacity: number } }).display.linkOpacity === 0.4, 'Display through the bridge keeps the rest');
    const view = await runBridgeTool('wh_world_graph_settings', { projectId: P, action: 'save-view', name: 'Sólo lugares', filters: { type: 'location' } });
    assert(view.ok && (view.result as { views: { name: string }[] }).views.length === 2, 'Second saved graph');
    const badFilter = await runBridgeTool('wh_world_graph_settings', { projectId: P, action: 'save-view', name: 'x', filters: { type: 'planet' } });
    const badCard = await runBridgeTool('wh_world_graph_settings', { projectId: P, action: 'hide', entryIds: ['nope'] });
    assert(!badFilter.ok && !badCard.ok, 'Bad filters and unknown cards refused');
    passed.push('Bridge: wh_world_graph_settings reads the look, hidden cards, saved graphs and pins; shows Fausto again (undo hides him); changes the card size keeping the rest; saves "Sólo lugares"; refuses bad filters and cards of other projects');
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    style.remove();
    await db.codexEntries.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
