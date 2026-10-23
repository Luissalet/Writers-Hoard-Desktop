// Tables: insert and duplicate rows and columns where asked, delete a
// selection of rows, filter by conditions, sort by several columns and step
// through the matches of a search — in the model, the table view and the bridge.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import TablesEngine from '@/engines/tables/TablesEngine';
import { addTable } from '@/engines/tables/operations';
import { duplicateColumn, duplicateRow, filterRows, findMatches, insertColumn, insertRow, removeRows, sortRows, toggleSort } from '@/engines/tables/tableEdits';
import type { WorldTable } from '@/engines/tables/types';
import { readWorldDocument } from '@/services/worldEras/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

function towns(): WorldTable {
  const name = 'c-name', people = 'c-people', port = 'c-port';
  const row = (id: string, a: string, b: string, c: string) => ({ id, cells: { [name]: a, [people]: b, [port]: c } });
  return { id: 'towns', title: 'Pueblos', mode: 'table', columns: [{ id: name, name: 'Nombre', kind: 'text' }, { id: people, name: 'Habitantes', kind: 'number' }, { id: port, name: 'Puerto', kind: 'checkbox' }],
    rows: [row('r1', 'Puerto Sal', '1200', 'true'), row('r2', 'Brezal', '90', 'false'), row('r3', 'Faro Viejo', '300', 'true'), row('r4', 'Salinas', '300', 'false')] };
}

export async function testTableEdits(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const t = towns();
  insertRow(t, 1, { 'c-name': 'Nuevo' });
  duplicateRow(t, 'r3');
  assert(t.rows.map(r => r.cells['c-name']).join() === 'Puerto Sal,Nuevo,Brezal,Faro Viejo,Faro Viejo,Salinas', `Rows: ${t.rows.map(r => r.cells['c-name']).join()}`);
  assert(removeRows(t, [t.rows[1].id, t.rows[4].id]) === 2 && t.rows.length === 4, 'Remove a selection');
  const left = insertColumn(t, 0, { name: 'Nombre', kind: 'text' });
  const copy = duplicateColumn(t, 'c-people', 'copia');
  assert(t.columns[0].id === left.id && left.name === 'Nombre 2' && t.columns.map(c => c.name).join() === 'Nombre 2,Nombre,Habitantes,Habitantes (copia),Puerto' && t.rows[0].cells[copy.id] === '1200', `Columns: ${t.columns.map(c => c.name).join()}`);
  const value = (row: WorldTable['rows'][number], id: string) => row.cells[id] ?? '';
  const filtered = filterRows(t.rows, [{ columnId: 'c-people', op: 'gt', value: '100' }, { columnId: 'c-port', op: 'checked' }], value);
  assert(filtered.map(r => r.cells['c-name']).join() === 'Puerto Sal,Faro Viejo', `Filter: ${filtered.map(r => r.cells['c-name']).join()}`);
  const sorted = sortRows(t.rows, toggleSort(toggleSort([], 'c-people', false), 'c-name', true), value, id => id === 'c-people');
  assert(sorted.map(r => r.cells['c-name']).join() === 'Brezal,Faro Viejo,Salinas,Puerto Sal', `Sort: ${sorted.map(r => r.cells['c-name']).join()}`);
  assert(findMatches(t.rows, t.columns, 'sal', (row, column) => row.cells[column.id] ?? '').length === 2, 'Find');
  passed.push('Model: a row inserted second and a copy under "Faro Viejo"; two rows removed at once; a column inserted first becomes "Nombre 2"; "Habitantes (copia)" keeps the values; Habitantes > 100 and Puerto marked leaves Puerto Sal and Faro Viejo; sorting by Habitantes then Nombre orders the two 300s by name');

  const P = 'table-edits-project';
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  const q = (selector: string) => document.querySelector(selector) as HTMLElement | null;
  const names = () => [...document.querySelectorAll('tbody tr[data-row-id]')].map(row => (row.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? '');
  const setValue = async (element: HTMLInputElement | HTMLSelectElement, value: string) => { await act(async () => { const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); }); };
  const until = async (check: () => unknown, what: string) => { for (let i = 0; i < 100; i++) { if (check()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${what}`); };
  try {
    await db.projects.put({ id: P, title: 'Puerto', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['tables'], createdAt: 1, updatedAt: 1 } as Project);
    await addTable(P, towns());
    await act(async () => { root = createRoot(host); root.render(<MemoryRouter><TablesEngine projectId={P} /></MemoryRouter>); await pause(400); });
    await until(() => names().length === 4, 'table shown');
    // Filter: Habitantes greater than 100.
    await act(async () => { q('[data-testid="table-filter-add"]')!.click(); await pause(); });
    await setValue(q('[data-testid="table-filter-column-0"]') as HTMLSelectElement, 'c-people');
    await setValue(q('[data-testid="table-filter-op-0"]') as HTMLSelectElement, 'gt');
    await setValue(q('[data-testid="table-filter-value-0"]') as HTMLInputElement, '100');
    assert(names().join() === 'Puerto Sal,Faro Viejo,Salinas', `Filtered: ${names().join()}`);
    // Sort by Habitantes, then Shift+click Nombre.
    const header = (text: string) => [...document.querySelectorAll('thead th button')].find(button => button.textContent?.startsWith(text)) as HTMLButtonElement;
    await act(async () => { header('Habitantes').click(); await pause(); });
    await act(async () => { header('Nombre').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); await pause(); });
    assert(names().join() === 'Faro Viejo,Salinas,Puerto Sal' && q('[data-testid="table-sort-rank-Nombre"]')?.textContent === '2↑', `Sorted: ${names().join()} ${q('[data-testid="table-sort-rank-Nombre"]')?.textContent}`);
    passed.push('Table view: "Filtro" Habitantes · mayor que · 100 leaves three towns; a click on Habitantes and a Shift+click on Nombre sort by both (Nombre shows "2↑")');
    // Find: "sal" in two cells (Salinas, Puerto Sal); next goes to the second.
    await act(async () => { q('[data-testid="table-filter-op-0"]')!.closest('div')!.querySelector('button')!.click(); await pause(); });
    const search = document.querySelector('input[placeholder="Filtrar filas"]') as HTMLInputElement ?? document.querySelector('input[aria-label="Filtrar filas"]') as HTMLInputElement;
    await setValue(search, 'sal');
    assert(q('[data-testid="table-find-count"]')?.textContent === '1/2' && document.querySelectorAll('[data-match="current"]').length === 1, `Find: ${q('[data-testid="table-find-count"]')?.textContent}`);
    const first = q('[data-match="current"]')!.dataset.cell;
    await act(async () => { (document.querySelector('button[aria-label="Siguiente coincidencia"]') as HTMLButtonElement).click(); await pause(); });
    assert(q('[data-testid="table-find-count"]')?.textContent === '2/2' && q('[data-match="current"]')!.dataset.cell !== first, 'Next match');
    await setValue(search, '');
    passed.push('Find: "sal" finds 2 cells, shows "1/2" with the first outlined, and "Siguiente coincidencia" moves to "2/2"');
    // Select two rows and delete them.
    await until(() => names().length === 4, 'all rows back');
    await act(async () => { (q('[data-testid="table-select-row-2"]') as HTMLInputElement).click(); (q('[data-testid="table-select-row-4"]') as HTMLInputElement).click(); await pause(); });
    assert(/2 seleccionadas/.test(q('[data-testid="table-selection"]')?.textContent ?? ''), 'Selection bar');
    await act(async () => { q('[data-testid="table-selection-delete"]')!.click(); await pause(); });
    const confirm = [...document.querySelectorAll('button')].filter(button => button.textContent?.trim() === 'Eliminar').pop() as HTMLButtonElement | undefined;
    assert(confirm, 'Confirm dialog');
    await act(async () => { confirm.click(); await pause(300); });
    await until(() => names().length === 2, 'two rows deleted');
    assert(names().join() === 'Faro Viejo,Puerto Sal', `After delete (still sorted by Habitantes): ${names().join()}`);
    // Duplicate a column from its menu.
    await act(async () => { (document.querySelector('button[aria-label="Duplicar columna Habitantes"]') as HTMLButtonElement).click(); await pause(300); });
    await until(() => [...document.querySelectorAll('thead th button')].some(button => button.textContent?.startsWith('Habitantes (copia)')), 'duplicated column');
    passed.push('Rows and columns: ticking rows 2 and 4 shows "2 seleccionadas" and "Borrar" removes both after confirming; "Duplicar columna" adds "Habitantes (copia)"');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  try {
    const read = await readWorldDocument({ projectId: P }, 'tables', 'towns');
    const inserted = await runBridgeTool('wh_table_edit', { projectId: P, tableId: 'towns', expectedVersion: read!.version, action: 'insert-column', name: 'Región', kind: 'text', at: 1 });
    assert(inserted.ok, JSON.stringify(inserted));
    const stale = await runBridgeTool('wh_table_edit', { projectId: P, tableId: 'towns', expectedVersion: read!.version, action: 'insert-row' });
    assert(!stale.ok, 'Stale refused');
    const query = await runBridgeTool('wh_table_query', { projectId: P, tableId: 'towns', conditions: [{ columnId: 'c-people', op: 'gt', value: '500' }], sorts: [{ id: 'c-name' }] });
    const rows = (query.result as { rows: Array<{ cells: Record<string, string> }>; matched: number }).rows;
    assert(query.ok && rows.length === 1 && rows[0].cells.Nombre === 'Puerto Sal' && 'Región' in rows[0].cells, `Query: ${JSON.stringify(query.result).slice(0, 300)}`);
    passed.push('Bridge: wh_table_edit inserts "Región" second (a stale version is refused); wh_table_query with Habitantes > 500 returns Puerto Sal with its cells by column name');
  } finally {
    await db.projects.delete(P);
  }
  return passed;
}
