import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import TablesEngine from '@/engines/tables/TablesEngine';
import type { WorldTable } from '@/engines/tables/types';
import { readWorldDocument } from '@/services/worldEras/store';
import { flushPendingWrites } from '@/services/pendingWrites';
import { clearUndoJournal, getUndoJournal, undoLast } from '@/services/undoJournal';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const wait = () => new Promise(resolve => setTimeout(resolve, 35));
async function until(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await act(async () => { await wait(); });
  }
  throw Error(message);
}

export async function testTableCellKeyboard(): Promise<string[]> {
  const projectId = 'qa-table-cell-keyboard-' + crypto.randomUUID();
  const table: WorldTable = { id: 'table', title: 'Cell navigation QA', mode: 'table',
    columns: [{ id: 'name', name: 'Name', kind: 'text' }, { id: 'score', name: 'Score', kind: 'number' }],
    rows: [{ id: 'alfa', cells: { name: 'Alfa', score: '2' } }, { id: 'bravo', cells: { name: 'Bravo', score: '3' } }] };
  const host = document.getElementById('root');
  assert(host, 'Missing fixture host');
  const previousLocale = useLocaleStore.getState().locale;
  await db.projects.add({ id: projectId, title: 'QA cell navigation', description: '', color: '#444444', mode: 'custom',
    type: 'standalone', status: 'draft', enabledEngines: ['tables'], dataTables: [table], createdAt: 1, updatedAt: 1 });
  useLocaleStore.setState({ locale: 'en' });
  clearUndoJournal();
  const root = createRoot(host);
  const grid = () => host.querySelector<HTMLTableElement>('table[role="grid"]')!;
  const input = (label: string) => [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
    .find(node => node.getAttribute('aria-label') === label)!;
  const active = () => {
    const id = grid().getAttribute('aria-activedescendant');
    const cell = id ? document.getElementById(id) : undefined;
    return cell ? [cell.dataset.keyboardCellRow, cell.dataset.keyboardCellColumn] : [];
  };
  const pick = async (label: string) => {
    const target = input(label);
    assert(target, 'Missing cell editor');
    await act(async () => { target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' })); });
  };
  const press = async (key: string, shiftKey = false, target: Element = grid()) => {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    await act(async () => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  };
  const read = () => readWorldDocument({ projectId }, 'tables', table.id);
  const settleSavedCell = async () => {
    await act(async () => {
      const flushed = await flushPendingWrites();
      assert(flushed.ok, 'The cell write did not settle');
      await wait();
    });
    await until(() => grid().querySelector<HTMLButtonElement>('[data-table-row-handle]')?.disabled === false,
      'The refreshed row version never became ready');
  };
  const fillInput = async (target: HTMLInputElement, value: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(target, value);
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  try {
    await act(async () => { root.render(<MemoryRouter><TablesEngine projectId={projectId} /></MemoryRouter>); });
    await until(() => grid()?.querySelector<HTMLButtonElement>('[data-table-row-handle]')?.disabled === false, 'Grid did not mount');
    const before = await read();
    assert(before, 'Fixture not persisted');
    await pick('A1 Name');
    assert(document.activeElement === grid() && active().join() === 'alfa,name', 'Pointer did not select the first cell');
    await press('ArrowRight', true);
    await press('ArrowDown', true);
    assert(active().join() === 'bravo,score' && grid().querySelectorAll('[aria-selected="true"]').length === 4,
      'Shift-arrow did not select a rectangle');
    await press('Shift'); // A standalone modifier must not move or collapse the range.
    assert(grid().querySelectorAll('[aria-selected="true"]').length === 4, 'Unrelated key changed the range');
    await press('Enter');
    assert(document.activeElement === input('B2 Score'), 'Enter did not focus the editor');
    await press('Escape', false, input('B2 Score'));
    assert(document.activeElement === grid() && active().join() === 'bravo,score', 'Escape did not restore the grid cursor');
    await press('Tab', true);
    assert(active().join() === 'bravo,name', 'Shift+Tab did not move to the preceding cell');
    assert((await read())?.version === before.version, 'Navigation wrote table data');

    await press('ArrowRight');
    await press('Enter');
    await fillInput(input('B2 Score') as HTMLInputElement, '4');
    await press('Tab', false, input('B2 Score'));
    await settleSavedCell();
    const edited = await read();
    const editedRows = (edited?.document.root as unknown as WorldTable).rows;
    assert(editedRows.length === 2 && editedRows[1].cells.score === '4', 'Tab from the last editor did not only save the cell');

    await press('Enter');
    await fillInput(input('B2 Score') as HTMLInputElement, '5');
    await act(async () => {
      input('B2 Score').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      grid().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    await settleSavedCell();
    const beforeAppend = await read();
    const committedRows = (beforeAppend?.document.root as unknown as WorldTable).rows;
    assert(committedRows.length === 2 && committedRows[1].cells.score === '5', 'Fast commit and Tab raced with each other');
    await press('Tab');
    await until(() => grid().querySelectorAll('tbody tr[data-row-id]').length === 3, 'Tab did not append a row');
    const after = await read();
    const rows = (after?.document.root as unknown as WorldTable).rows;
    assert(rows.length === 3 && rows[2].id !== 'alfa' && rows[2].id !== 'bravo', 'Appended row has no new identity');
    await until(() => active().join() === rows[2].id + ',name', 'Cursor missed the appended row');
    assert(getUndoJournal().filter(entry => entry.projectId === projectId).length === 1, 'Append did not use the row journal');
    await act(async () => { await undoLast(projectId); });
    await until(() => grid().querySelectorAll('tbody tr[data-row-id]').length === 2, 'Undo did not remove the appended row');
    assert(JSON.stringify((await read())?.document.root) === JSON.stringify(beforeAppend?.document.root), 'Undo changed the saved cell');

    const filter = input('Filter rows') as HTMLInputElement;
    await fillInput(filter, 'Alfa');
    await until(() => grid().querySelectorAll('tbody tr[data-row-id]').length === 1, 'Search did not constrain the view');
    await pick('B1 Score');
    await press('Tab');
    await press('Tab');
    await act(async () => { await wait(); });
    assert(JSON.stringify((await read())?.document.root) === JSON.stringify(beforeAppend?.document.root), 'Tab added rows that the filter would hide');
    await fillInput(filter, '');
    await until(() => grid().querySelectorAll('tbody tr[data-row-id]').length === 2, 'Clearing search lost the original rows');
    assert(active().join() === 'alfa,score', 'Clearing search moved to a hidden append');
    await press('Escape');
    assert(!grid().getAttribute('aria-activedescendant') && !await press('Tab'), 'Escape did not allow Tab to leave the grid');
    return ['Grid selection, arrow rectangle, editor focus, serial save and Tab append with Undo, filtered edge, and keyboard exit'];
  } finally {
    await act(async () => { root.unmount(); });
    clearUndoJournal();
    useLocaleStore.setState({ locale: previousLocale });
    await deleteProject(projectId);
  }
}
