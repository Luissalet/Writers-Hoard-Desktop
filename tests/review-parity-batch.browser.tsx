import Dexie from 'dexie';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import TablesEngine from '@/engines/tables/TablesEngine';
import type { Project } from '@/types';
import { getUndoJournal, undoLast } from '@/services/undoJournal';
import { useLocaleStore } from '@/stores/localeStore';

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(test: () => boolean | Promise<boolean>, message: string) {
  for (let i = 0; i < 100; i++) { if (await test()) return; await act(async () => { await pause(); }); }
  throw Error(message);
}

/** User intent: a committed row insertion remains undoable after leaving its editor. */
export async function testParityQueuedTableUndo(): Promise<string[]> {
  const projectId = 'review-queued-table-' + crypto.randomUUID(), tableId = projectId + '-table';
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), locale = useLocaleStore.getState().locale;
  let mounted = true, release: (() => void) | undefined, blocker: Promise<unknown> | undefined;
  const savedRows = async () => (await db.projects.get(projectId))?.dataTables?.[0].rows ?? [];
  try {
    await db.projects.put({ id: projectId, title: 'Queued row review', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['tables'], createdAt: 1, updatedAt: 1,
      dataTables: [{ id: tableId, title: 'Rows', mode: 'table', columns: [{ id: 'name', name: 'Name', kind: 'text' }], rows: [{ id: 'A', cells: { name: 'A' } }, { id: 'B', cells: { name: 'B' } }] }],
    } as Project);
    useLocaleStore.setState({ locale: 'en' });
    await act(async () => { root.render(<MemoryRouter><TablesEngine projectId={projectId}/></MemoryRouter>); });
    await until(() => !!host.querySelector<HTMLButtonElement>('button[draggable]:not(:disabled)'), 'Normal row editor never became ready');
    // A different pending database write queues the user's insert. No product
    // function or receipt implementation is replaced by this fixture.
    let acquired!: () => void;
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    blocker = db.transaction('rw', db.tables, () => { acquired(); return Dexie.waitFor(gate); });
    await ready;
    const row = host.querySelector('tr[data-row-id="B"]'); check(row, 'Second row missing');
    const insert = [...row.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Insert row above');
    check(insert && !insert.disabled, 'Normal Insert above action unavailable');
    await act(async () => { insert.click(); });
    check(getUndoJournal().every(entry => entry.projectId !== projectId), 'Queued insertion published Undo before commit');
    await act(async () => { root.unmount(); mounted = false; });
    release(); await blocker; blocker = undefined;
    await until(async () => (await savedRows()).length === 3, 'Queued insertion was lost on editor departure');
    check(getUndoJournal().filter(entry => entry.projectId === projectId).length === 1, 'Committed insertion lost its normal Undo after editor departure');
    check(await undoLast(projectId) === 'undone', 'Departed editor insertion could not be undone normally');
    check((await savedRows()).map(row => row.id).join() === 'A,B', 'Normal Undo failed to restore original row identities');
    return ['Queued normal Insert above commits to captured table after editor departure and retains normal project Undo'];
  } finally {
    release?.(); await blocker?.catch(() => {});
    if (mounted) await act(async () => { root.unmount(); });
    host.remove(); useLocaleStore.setState({ locale }); await deleteProject(projectId);
  }
}
