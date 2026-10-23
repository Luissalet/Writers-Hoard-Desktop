// Deleting several Library documents at once: each kind through the
// operation that deletes it correctly; kinds kept inside the project file stay.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import type { Project } from '@/types';
import WorkspaceLibrary from '@/components/project/workspace/library/WorkspaceLibrary';
import { splitDeletable } from '@/components/project/workspace/library/bulkDelete';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'synthetic-library-bulk-delete';

export async function testLibraryBulkDelete(): Promise<string[]> {
  const split = splitDeletable([{ engineId: 'notes', entityId: 'a', title: 'A', route: '' }, { engineId: 'dictionary', entityId: 'b', title: 'B', route: '' }, { engineId: 'writings', entityId: 'c', title: 'C', route: '' }]);
  assert(split.deletable.map(d => d.entityId).join() === 'a,c' && split.kept.map(d => d.entityId).join() === 'b', 'Split');
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'Biblioteca', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['notes'], createdAt: 1, updatedAt: 1 } satisfies Project);
  for (const [id, title] of [['bd-1', 'Borrador viejo'], ['bd-2', 'Otro borrador'], ['bd-3', 'Plan del libro']]) await db.notes.put({ id, projectId: P, title, content: '', tags: [], pinned: false, createdAt: 1, updatedAt: 1 } as never);
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await act(async () => { root = createRoot(host); root.render(<WorkspaceLibrary projectId={P} enabledEngineIds={['notes']} onOpen={async () => true} onManage={async () => true} />); await pause(200); });
    const rowBox = (title: string) => [...document.querySelectorAll('[data-library-document]')].find(row => row.textContent?.includes(title))?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    for (let i = 0; i < 60 && !rowBox('Otro borrador'); i++) await act(async () => { await pause(80); });
    for (const title of ['Borrador viejo', 'Otro borrador']) await act(async () => { rowBox(title)!.click(); await pause(); });
    await act(async () => { (document.querySelector('[data-testid="library-delete"]') as HTMLButtonElement).click(); await pause(); });
    assert(/Borrar los 2 documentos/.test(document.body.textContent ?? ''), 'Confirmation names the count');
    await act(async () => { ([...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Eliminar').pop() as HTMLButtonElement).click(); await pause(400); });
    const left = (await db.notes.where('projectId').equals(P).toArray()).map(note => note.title);
    assert(left.join() === 'Plan del libro', `Left: ${left.join()}`);
    for (let i = 0; i < 40 && rowBox('Otro borrador'); i++) await act(async () => { await pause(80); });
    assert(!rowBox('Otro borrador') && rowBox('Plan del libro'), 'List updated');
    return ['Library: ticking "Borrador viejo" and "Otro borrador" and "Borrar" asks "¿Borrar los 2 documentos elegidos?…" and deletes both through the notes\' own delete; "Plan del libro" stays; dictionaries, tables, trees and sheets are left to their own tool'];
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
