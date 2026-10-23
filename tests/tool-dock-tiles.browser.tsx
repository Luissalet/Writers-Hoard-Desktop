// The writing tool dock as tiles: on a wide dock blocks sit in two columns
// and "Fila entera" makes one take the whole row; the add-block list is
// grouped by kind; the span travels through the store and the bridge.
import '@/engines';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import ToolDock from '@/engines/writings/toolDock/ToolDock';
import { readWritingToolDock } from '@/engines/writings/toolDock/store';
import { validateToolDockLayout } from '@/engines/writings/toolDock/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testToolDockTiles(): Promise<string[]> {
  const passed: string[] = [];
  const P = 'tool-dock-tiles';
  let refused = false; try { validateToolDockLayout({ version: 1, revision: 0, generation: 'g', blocks: [{ id: 'a', span: 3, kind: 'document', target: { kind: 'codex', documentId: 'x' } }] }); } catch { refused = true; }
  assert(refused, 'span 3 refused');
  // Seeded as a stored layout, as a saved project holds it.
  const seeded = { version: 1, revision: 0, generation: 'tiles', blocks: [{ id: 'b1', kind: 'document', target: { kind: 'codex', documentId: P + 'c1', label: 'Marta' } }, { id: 'b2', kind: 'document', target: { kind: 'codex', documentId: P + 'c2', label: 'Puerto Sal' } }] };
  validateToolDockLayout(seeded);
  await db.projects.put({ id: P, title: P, description: '', color: '#777777', type: 'standalone', mode: 'custom', status: 'draft', enabledEngines: ['writings', 'codex'], createdAt: 1, updatedAt: 1, writingToolDock: seeded } as never);
  for (const [id, title] of [['c1', 'Marta'], ['c2', 'Puerto Sal']]) await db.codexEntries.put({ id: P + id, projectId: P, type: 'character', title, content: '', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as never);
  const host = document.getElementById('root'); assert(host, 'root');
  host.style.width = '900px';
  let root: Root | null = null;
  try {
    const base = { projectId: P }, owner = { kind: 'project' as const };
    await act(async () => { root = createRoot(host); root.render(<MemoryRouter><ToolDock scope={base} owner={owner} locale="es" /></MemoryRouter>); await pause(400); });
    for (let i = 0; i < 40 && document.querySelectorAll('[data-dock-block]').length < 2; i++) await act(async () => { await pause(100); });
    const box = (id: string) => (document.querySelector(`[data-dock-block="${id}"]`) as HTMLElement).getBoundingClientRect();
    assert(Math.abs(box('b1').top - box('b2').top) < 2 && box('b2').left > box('b1').left, `Two columns: ${JSON.stringify([box('b1'), box('b2')])}`);
    await act(async () => { (document.querySelector('[data-testid="dock-span-b1"]') as HTMLButtonElement).click(); await pause(400); });
    for (let i = 0; i < 30 && (document.querySelector('[data-dock-block="b1"]') as HTMLElement)?.dataset.dockSpan !== '2'; i++) await act(async () => { await pause(100); });
    assert(box('b2').top > box('b1').bottom - 2 && box('b1').width > 800, `Whole row: ${JSON.stringify([box('b1'), box('b2')])}`);
    assert((await readWritingToolDock(base, owner)).layout?.blocks[0].span === 2, 'Stored');
    passed.push('Dock: on a 900 px dock "Marta" and "Puerto Sal" sit side by side; "Fila entera" on Marta makes it span the row and pushes Puerto Sal under it; the span is stored');
    const addButton = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Añadir bloque')) as HTMLButtonElement;
    await act(async () => { addButton.click(); await pause(300); });
    const groups = [...document.querySelectorAll('optgroup')].map(group => group.label);
    assert(groups.includes('Fichas del Códice'), `Groups: ${groups.join()}`);
    passed.push(`Add block: the list is grouped by kind (${groups.join(', ')})`);
    const now = await readWritingToolDock(base, owner);
    const bridged = await runBridgeTool('wh_writing_tool_dock_apply', { projectId: P, owner, expectedVersion: now.version, actions: [{ type: 'span', blockId: 'b1', span: 1 }] });
    assert(bridged.ok && (await readWritingToolDock(base, owner)).layout?.blocks[0].span === undefined, `Bridge: ${JSON.stringify(bridged).slice(0, 200)}`);
    passed.push('Bridge: wh_writing_tool_dock_apply span 1 puts Marta back to half a row');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
    host.style.width = '';
    await deleteProject(P);
  }
  return passed;
}
