import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import TablesEngine from '@/engines/tables/TablesEngine';
import { parseTableClipboard, pasteTableCells, serializeTableClipboard } from '@/engines/tables/tableClipboard';
import type { WorldTable } from '@/engines/tables/types';
import { readWorldDocument } from '@/services/worldEras/store';
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

export async function testTableCellClipboard(): Promise<string[]> {
  const quoted = [['a "quote"', 'line 1\nline 2'], ['a\tb', '']];
  assert(JSON.stringify(parseTableClipboard(serializeTableClipboard(quoted))) === JSON.stringify(quoted), 'Quoted TSV lost content');
  for (const plain of ['She said "hi"', '"First" and "Second"']) {
    assert(parseTableClipboard(plain)[0][0] === plain, 'Plain one-cell text lost its quotes');
  }
  for (const emptyRows of [[['']], [['x'], ['']], [[''], ['x'], ['']]]) {
    assert(JSON.stringify(parseTableClipboard(serializeTableClipboard(emptyRows))) === JSON.stringify(emptyRows),
      'A one-column TSV range lost an empty cell');
  }
  const projectId = 'qa-table-clipboard-' + crypto.randomUUID();
  const table: WorldTable = { id: 'table', title: 'Clipboard QA', mode: 'table',
    columns: [{ id: 'name', name: 'Name', kind: 'text' }, { id: 'region', name: 'Region', kind: 'text' },
      { id: 'amount', name: 'Amount', kind: 'number' },
      { id: 'total', name: 'Total', kind: 'number',
        calculation: { formula: '=1+2', rowBindings: {}, columnBindings: {}, resultType: 'whole' } }],
    rows: [{ id: 'alfa', cells: { name: 'Alfa', region: 'North', amount: '2' } },
      { id: 'bravo', cells: { name: 'Bravo', region: 'South', amount: '3' } },
      { id: 'charlie', cells: { name: 'Charlie', region: '', amount: '9' } }] };
  const invalid = structuredClone(table);
  let refusal = '';
  try {
    pasteTableCells(invalid, { rowIds: ['alfa', 'bravo'], columnIds: ['region', 'amount'],
      values: [['West', '4'], ['East', 'not numeric']] });
  } catch (error) { refusal = (error as Error).message; }
  assert(refusal === 'table_paste_value_invalid' && JSON.stringify(invalid) === JSON.stringify(table),
    'Invalid typed paste partially changed rows');
  const readonly = structuredClone(table);
  readonly.columns[2].calculation = { formula: '=1', rowBindings: {}, columnBindings: {}, resultType: 'whole' };
  refusal = '';
  try { pasteTableCells(readonly, { rowIds: ['alfa'], columnIds: ['amount'], values: [['4']] }); }
  catch (error) { refusal = (error as Error).message; }
  assert(refusal === 'table_paste_readonly' && readonly.rows[0].cells.amount === '2', 'Paste overwrote a calculated column');

  const host = document.getElementById('root');
  assert(host, 'Missing fixture host');
  const previousLocale = useLocaleStore.getState().locale;
  await db.projects.add({ id: projectId, title: 'QA table clipboard', description: '', color: '#444444', mode: 'custom',
    type: 'standalone', status: 'draft', enabledEngines: ['tables'], dataTables: [table], createdAt: 1, updatedAt: 1 });
  useLocaleStore.setState({ locale: 'en' });
  clearUndoJournal();
  const root = createRoot(host);
  const grid = () => host.querySelector<HTMLTableElement>('table[role="grid"]')!;
  const input = (label: string) => [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
    .find(node => node.getAttribute('aria-label') === label)!;
  const pick = async (label: string, shiftKey = false) => {
    const target = input(label);
    assert(target, 'Missing cell editor');
    await act(async () => { target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', shiftKey })); });
  };
  const key = async (key: string, shiftKey = false, target: Element = grid()) => {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    await act(async () => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  };
  const event = async (name: 'copy' | 'paste', data: DataTransfer, target: Element = grid()) => {
    const event = new ClipboardEvent(name, { clipboardData: data, bubbles: true, cancelable: true });
    await act(async () => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  };
  const read = () => readWorldDocument({ projectId }, 'tables', table.id);
  try {
    await act(async () => { root.render(<MemoryRouter><TablesEngine projectId={projectId} /></MemoryRouter>); });
    await until(() => grid()?.querySelector<HTMLButtonElement>('[data-table-row-handle]')?.disabled === false, 'Grid did not mount');
    const before = await read();
    assert(before, 'Fixture not persisted');

    await pick('A1 Name');
    await key('ArrowRight', true);
    await key('ArrowDown', true);
    const data = new DataTransfer();
    assert(await event('copy', data) && data.getData('text/plain') === 'Alfa\tNorth\nBravo\tSouth', 'Grid did not copy the rectangle');
    assert((await read())?.version === before.version, 'Copy wrote table data');

    await pick('B2 Region');
    await pick('A1 Name', true);
    const reversed = new DataTransfer();
    assert(await event('copy', reversed) && reversed.getData('text/plain') === data.getData('text/plain'),
      'Shift-click did not select the same rectangle in reverse');
    await pick('A3 Name', true);
    const extended = new DataTransfer();
    assert(await event('copy', extended) && extended.getData('text/plain') === 'Bravo\tSouth\nCharlie\t',
      'A second Shift-click lost the anchor');
    await pick('A1 Name');
    const single = new DataTransfer();
    assert(await event('copy', single) && single.getData('text/plain') === 'Alfa', 'Plain click did not reset the range');
    await key('ArrowDown', true);
    await pick('B2 Region', true);
    const mixed = new DataTransfer();
    assert(await event('copy', mixed) && mixed.getData('text/plain') === data.getData('text/plain'),
      'Shift-click and Shift-arrow did not share the anchor');

    await key('Enter');
    assert(document.activeElement === input('B2 Region'), 'Enter did not focus the editor');
    assert(!await event('paste', data, input('B2 Region')), 'The grid intercepted ordinary editor paste');
    await pick('A3 Name');
    await event('paste', data);
    await until(() => grid().querySelectorAll('tbody tr[data-row-id]').length === 4, 'Paste did not append one row');
    const saved = (await read())?.document.root as unknown as WorldTable;
    assert(saved.rows.length === 4 && saved.rows[2].id === 'charlie' && saved.rows[2].cells.amount === '9' &&
      saved.rows[2].cells.name === 'Alfa' && saved.rows[3].cells.name === 'Bravo' && saved.rows[3].cells.region === 'South',
      'Paste changed cells outside the rectangle or lost row identity');
    assert(getUndoJournal().filter(entry => entry.projectId === projectId).length === 1, 'Paste should be one Undo');
    await act(async () => { await undoLast(projectId); });
    await until(() => grid().querySelectorAll('tbody tr[data-row-id]').length === 3, 'Undo did not remove the appended row');
    assert(JSON.stringify((await read())?.document.root) === JSON.stringify(before.document.root), 'Undo did not restore every cell');

    await until(() => grid().querySelector<HTMLButtonElement>('[data-table-row-handle]')?.disabled === false, 'Restored rows not ready');
    await pick('B3 Region');
    const blank = new DataTransfer();
    assert(await event('copy', blank) && blank.getData('text/plain') === '""', 'Copy lost a single empty cell');
    await pick('B2 Region');
    await event('paste', blank);
    await until(() => input('B2 Region').value === '', 'Pasting an empty cell did not clear its destination');
    const cleared = (await read())?.document.root as unknown as WorldTable;
    assert(cleared.rows[1].cells.region === '' && cleared.rows[1].cells.amount === '3', 'Paste cleared unrelated cells');
    await act(async () => { await undoLast(projectId); });
    await until(() => input('B2 Region').value === 'South' &&
      grid().querySelector<HTMLButtonElement>('[data-table-row-handle]')?.disabled === false, 'Blank paste Undo did not settle');

    await pick('C1 Amount');
    await key('ArrowRight', true);
    await key('ArrowDown', true);
    assert(await key('Delete'), 'Delete was not handled by the grid');
    await until(() => input('C1 Amount').value === '' && input('C2 Amount').value === '' &&
      grid().querySelector<HTMLButtonElement>('[data-table-row-handle]')?.disabled === false, 'Delete did not clear the numeric range');
    const range = (await read())?.document.root as unknown as WorldTable;
    assert(range.rows.length === 3 && range.rows[2].cells.amount === '9' && range.rows[0].cells.name === 'Alfa' &&
      range.rows[1].cells.region === 'South' && range.columns[3].calculation?.formula === '=1+2' &&
      host.querySelector('output[aria-label="D2 Total"]')?.textContent === '3', 'Clear changed a cell outside the editable range');
    assert(getUndoJournal().filter(entry => entry.projectId === projectId).length === 1, 'Range clear should be one Undo');
    await act(async () => { await undoLast(projectId); });
    await until(() => input('C1 Amount').value === '2' && input('C2 Amount').value === '3' &&
      grid().querySelector<HTMLButtonElement>('[data-table-row-handle]')?.disabled === false, 'Range Undo did not settle');
    assert(JSON.stringify((await read())?.document.root) === JSON.stringify(before.document.root), 'Clear Undo did not restore the table');

    await pick('A1 Name');
    await key('Enter');
    assert(!await key('Backspace', false, input('A1 Name')), 'Grid intercepted ordinary editor Backspace');
    await key('Escape', false, input('A1 Name'));
    assert(await key('Backspace'), 'Grid did not handle Backspace');
    await until(() => input('A1 Name').value === '', 'Backspace did not clear the single selected cell');
    assert(input('A2 Name').value === 'Bravo' && input('B1 Region').value === 'North', 'Backspace changed a neighboring cell');
    return ['TSV quoting and typed validation', 'Grid copy and paste preserve unrelated cells and row IDs',
      'One Undo restores the whole block', 'Delete and Backspace clear only editable selected cells',
      'Shift-click and Shift-arrow share a visible range'];
  } finally {
    await act(async () => { root.unmount(); });
    clearUndoJournal();
    useLocaleStore.setState({ locale: previousLocale });
    await deleteProject(projectId);
  }
}
