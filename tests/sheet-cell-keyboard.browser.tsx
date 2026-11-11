import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import TablesEngine from '@/engines/tables/TablesEngine';
import { readWorldDocument } from '@/services/worldEras/store';
import { clearUndoJournal, getUndoJournal, undoLast } from '@/services/undoJournal';
import { useLocaleStore } from '@/stores/localeStore';
import type { WorldTable } from '@/engines/tables/types';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
async function until(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); });
  }
  throw Error(message);
}

export async function testSheetCellKeyboard(): Promise<string[]> {
  const projectId = 'qa-sheet-keyboard-' + crypto.randomUUID();
  const table: WorldTable = {
    id: 'sheet', title: 'Sheet keyboard QA', mode: 'sheet',
    columns: [{ id: 'name', name: 'Name', kind: 'text' }, { id: 'amount', name: 'Amount', kind: 'number' }],
    rows: [{ id: 'first', cells: { name: 'First', amount: '2' } },
      { id: 'second', cells: { name: 'Second', amount: '6' } },
      { id: 'sum', cells: { name: 'Total', amount: '=SUM(B1:B2)' } }],
  };
  const host = document.getElementById('root');
  assert(host, 'Missing fixture host');
  const previousLocale = useLocaleStore.getState().locale;
  await db.projects.add({ id: projectId, title: 'QA sheet keyboard', description: '', mode: 'custom',
    type: 'standalone', status: 'draft', color: '#444444', enabledEngines: ['tables'], dataTables: [table], createdAt: 1, updatedAt: 1 });
  useLocaleStore.setState({ locale: 'en' });
  clearUndoJournal();
  const root = createRoot(host);
  const grid = () => host.querySelector<HTMLTableElement>('table[role="grid"]');
  const cell = (label: string) => host.querySelector<HTMLInputElement>('input[aria-label="' + label + '"]')!;
  const active = () => host.querySelector('[data-keyboard-active="true"] input')?.getAttribute('aria-label');
  const pick = async (label: string, shiftKey = false) => {
    await act(async () => { cell(label).dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerType: 'mouse', shiftKey,
    })); });
  };
  const key = async (key: string, target: Element = grid()!) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await act(async () => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  };
  const clipboard = async (name: 'copy' | 'paste', data: DataTransfer, target: Element = grid()!) => {
    const event = new ClipboardEvent(name, { clipboardData: data, bubbles: true, cancelable: true });
    await act(async () => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  };
  const ready = () => grid()?.querySelector<HTMLButtonElement>('[data-table-row-handle]')?.disabled === false;
  const undo = async () => {
    assert(getUndoJournal().filter(entry => entry.projectId === projectId).length === 1, 'Expected one Undo for the sheet block');
    await act(async () => { await undoLast(projectId); });
  };
  try {
    await act(async () => { root.render(<MemoryRouter><TablesEngine projectId={projectId} /></MemoryRouter>); });
    await until(() => !!grid() && !!cell('B3 Amount'), 'Sheet did not expose a grid');
    await pick('A1 Name');
    assert(document.activeElement === grid() && active() === 'A1 Name', 'Click did not focus the sheet grid');
    await key('Tab');
    assert(active() === 'B1 Amount', 'Tab did not advance across the row');
    await pick('A2 Name', true);
    assert(host.querySelectorAll('[role="gridcell"][aria-selected="true"]').length === 4, 'Shift-click did not extend the Tab anchor');

    await pick('B1 Amount');
    assert(await key('7') && document.activeElement === cell('B1 Amount') && cell('B1 Amount').value === '7',
      'Typing into the grid did not replace the selected cell draft');
    await key('Enter', cell('B1 Amount'));
    assert(document.activeElement === grid() && active() === 'B2 Amount', 'Editor Enter did not move down');
    const total = () => host.querySelector('output[aria-label="Calculated value B3 Amount"]')?.textContent;
    await until(() => total() === '13', 'Formula did not recalculate after saving');
    const saved = (await readWorldDocument({ projectId }, 'tables', table.id))?.document.root as unknown as WorldTable;
    assert(saved.rows[0].cells.amount === '7' && saved.rows[2].cells.amount === '=SUM(B1:B2)',
      'Saving changed the formula or missed the selected row');

    await pick('B3 Amount');
    await key('Enter');
    assert(document.activeElement === cell('B3 Amount') && cell('B3 Amount').value === '=SUM(B1:B2)',
      'Enter did not open the raw formula in the editor');
    await key('Escape', cell('B3 Amount'));
    assert(document.activeElement === grid() && active() === 'B3 Amount', 'Escape did not return to the grid');
    await key('Tab');
    assert(active() === 'B3 Amount' && grid()!.querySelectorAll('tbody tr[data-row-id]').length === 3,
      'Tab at the last cell changed the sheet extent');
    await until(ready, 'Sheet did not settle after editing');
    const copied = new DataTransfer();
    assert(await clipboard('copy', copied) && copied.getData('text/plain') === '=SUM(B1:B2)',
      'Sheet clipboard did not copy the raw formula');
    const edge = new DataTransfer();
    edge.setData('text/plain', '=SUM(B1:B2)+1\tClipped\n99\tClipped');
    assert(await clipboard('paste', edge), 'The sheet did not handle grid paste');
    await until(() => total() === '14' && ready(), 'Formula paste did not recalculate');
    assert(cell('B3 Amount').value === '=SUM(B1:B2)+1' && cell('A3 Name').value === 'Total' &&
      grid()!.querySelectorAll('tbody tr[data-row-id]').length === 3 &&
      grid()!.querySelectorAll('thead th').length === 4, 'Paste extended the sheet or changed a neighbor');
    await undo();
    await until(() => total() === '13' && ready(), 'Undo did not restore the original formula');
    assert(cell('B3 Amount').value === '=SUM(B1:B2)', 'Undo changed the raw formula');

    await pick('A1 Name');
    const block = new DataTransfer();
    block.setData('text/plain', 'East\t10\nWest\t20');
    await key('Enter');
    assert(!await clipboard('paste', block, cell('A1 Name')), 'Grid intercepted editor paste');
    await key('Escape', cell('A1 Name'));
    await clipboard('paste', block);
    await until(() => total() === '30' && ready(), 'Block paste did not recalculate');
    assert(cell('A1 Name').value === 'East' && cell('A2 Name').value === 'West' &&
      cell('A3 Name').value === 'Total', 'Block paste lost its destination or changed an unrelated cell');
    await undo();
    await until(() => total() === '13' && ready(), 'Block Undo did not settle');

    await pick('B1 Amount');
    await pick('B2 Amount', true);
    assert(await key('Delete'), 'Grid Delete was not handled');
    await until(() => cell('B1 Amount').value === '' && cell('B2 Amount').value === '' && ready(),
      'Delete did not clear the selected sheet cells');
    assert(cell('A1 Name').value === 'First' && cell('B3 Amount').value === '=SUM(B1:B2)',
      'Delete changed a neighbor or the formula outside its range');
    await undo();
    await until(() => total() === '13' && ready(), 'Clear Undo did not restore both cells');
    return ['Grid selection and navigation', 'Direct typing and Enter save', 'Raw formulas and fixed final Tab',
      'Raw formula copy, rectangular paste, edge clipping and Undo', 'Sheet range clearing and Undo'];
  } finally {
    await act(async () => { root.unmount(); });
    useLocaleStore.setState({ locale: previousLocale });
    clearUndoJournal();
    await deleteProject(projectId);
  }
}
