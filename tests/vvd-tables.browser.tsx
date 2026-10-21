import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { addColumn, addTable, changeTable, importCsv, parseCsv, saveCell } from '@/engines/tables/operations';
import { cellKey, tableCsv, type WorldTable } from '@/engines/tables/types';
import { sheetValues } from '@/engines/tables/formulas';
import TablesEngine from '@/engines/tables/TablesEngine';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
export async function testVvdTables(): Promise<string[]> {
  const passed: string[] = []; const P = `tables-${Date.now()}`, Q = `${P}-other`;
  const root = createRoot(document.getElementById('root')!);
  const rejects = async (operation: () => unknown | Promise<unknown>) => { let rejected = false; try { await operation(); } catch { rejected = true; } assert(rejected, 'Invalid input must be rejected'); };
  const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => { assert(input, 'Input missing'); await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); };
  const click = async (text: string) => { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text); assert(button, `Missing button ${text}`); await act(async () => { button.click(); await pause(180); }); };
  const render = async (key: string) => { await act(async () => { root.render(<StrictMode><MemoryRouter key={key}><TablesEngine projectId={P} /></MemoryRouter></StrictMode>); await pause(150); }); await act(async () => { await pause(250); }); };
  try {
    const project = { id: P, title: 'Synthetic tables test', mode: 'custom' as const, type: 'standalone' as const, color: '#aaa', description: '', status: 'draft' as const, enabledEngines: ['tables'], engineOrder: ['tables'], createdAt: 1, updatedAt: 1 };
    await db.projects.bulkPut([project, { ...project, id: Q }]);
    assert(cellKey(26, 99) === 'AA100', 'Cell addresses beyond Z must work');
    const parsed = parseCsv('\ufeffName,Notes\r\n"A, B","First\nSecond and ""quoted"""\r\nC,D');
    assert(parsed[1][0] === 'A, B' && parsed[1][1].includes('"quoted"') && parsed[1][1].includes('\n'), 'RFC CSV quoting, newlines and BOM');
    await rejects(() => parseCsv('A,B\n1'));
    await rejects(() => parseCsv('A\n"Unclosed'));
    await rejects(() => parseCsv('A\n"x"evil'));
    const imported = importCsv('Name,Cost\nPort,100\nTower,250', 'Economy');
    assert(imported.rows.length === 2 && imported.columns.length === 2, 'CSV table needs all rows');
    assert(tableCsv(imported.columns, [{ id: 'unsafe', cells: { [imported.columns[0].id]: '=HYPERLINK("https://evil.invalid")', [imported.columns[1].id]: 'a,b' } }]).includes("'=HYPERLINK"), 'CSV formula injection must be neutralized');
    passed.push('Tables: RFC CSV import, quoted/newline fields, shape validation, column addresses and safe CSV export');

    const table: WorldTable = { id: 'sheet', title: 'Economy', mode: 'sheet', columns: ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), kind: 'text' })), rows: [
      { id: 'r1', cells: { a: '10', b: '=SUM(A1:A3)', c: '=AVERAGE(A1:A3)' } },
      { id: 'r2', cells: { a: '20', b: '=A1*2+A2', c: '=ROUND(10/3,2)' } },
      { id: 'r3', cells: { a: '30', b: '=MIN(A1:A3)+MAX(A1:A3)', c: '=COUNT(A1:A3)' } },
      { id: 'r4', cells: { a: '=-2^2', b: '=2^-2', c: '=ABS(-5)' } },
      { id: 'r5', cells: { a: '=A6', b: '=1/0', c: '=fetch("https://evil.invalid")' } },
      { id: 'r6', cells: { a: '=A5', b: '=Z99', c: '=2^10000' } },
    ] };
    const values = sheetValues(table);
    for (const [key, expected] of [['B1', 60], ['C1', 20], ['B2', 40], ['C2', 3.33], ['B3', 40], ['C3', 3], ['A4', -4], ['B4', .25], ['C4', 5], ['A5', '#CYCLE!'], ['A6', '#CYCLE!'], ['B5', '#DIV/0!'], ['B6', '#REF!'], ['C5', '#FORMULA!'], ['C6', '#NUM!']] as const) assert(values.get(key) === expected, `${key}: ${values.get(key)} != ${expected}`);
    passed.push('Sheets: ranges, aggregates, dependency arithmetic, exponent precedence, Unicode-free executable grammar, cycles and bounded errors');

    await addTable(P, imported);
    const numberColumn = { id: 'count', name: 'Count', kind: 'number' as const };
    await addColumn(P, imported.id, numberColumn);
    await saveCell(P, imported.id, imported.rows[0].id, numberColumn.id, '42', '');
    await saveCell(P, imported.id, imported.rows[0].id, numberColumn.id, '4.2', '42');
    await saveCell(P, imported.id, imported.rows[0].id, numberColumn.id, '-.125e2', '4.2');
    for (const invalid of ['NaN', 'Infinity', '1e999', '9007199254740993', '4.2.1', '0x10']) await rejects(() => saveCell(P, imported.id, imported.rows[0].id, numberColumn.id, invalid, '-.125e2'));
    await rejects(() => saveCell(P, imported.id, imported.rows[0].id, numberColumn.id, '44', 'stale'));
    await rejects(() => addColumn(P, imported.id, { id: 'bad', name: 'BAD', field: '__proto__', kind: 'text' }));
    await Promise.all([saveCell(P, imported.id, imported.rows[0].id, imported.columns[0].id, 'Harbor', 'Port'), changeTable(P, imported.id, current => { current.title = 'Trade routes'; })]);
    const saved = (await db.projects.get(P))!.dataTables![0];
    assert(saved.rows[0].cells[numberColumn.id] === '-.125e2' && saved.title === 'Trade routes' && !(await db.projects.get(Q))!.dataTables, 'Atomic fields and projects must remain isolated');
    passed.push('Tables: typed decimal/exponent cells, invalid/nonfinite/unsafe numbers, optimistic stale-write rejection, reserved fields, concurrent edits and project isolation');

    useLocaleStore.setState({ locale: 'en' }); await render('standalone');
    let cell = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="A1 Name"]')!;
    assert(cell?.value === 'Harbor', 'Persisted standalone cell must appear');
    await type(cell, 'Citadel'); await act(async () => { cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await pause(250); });
    assert((await db.projects.get(P))!.dataTables![0].rows[0].cells[imported.columns[0].id] === 'Citadel', 'Blur must save cell edits');
    await click('New document');
    const name = document.querySelector<HTMLInputElement>('form input')!; await type(name, 'Supplies'); await click('Create');
    assert((await db.projects.get(P))!.dataTables!.some(table => table.title === 'Supplies'), 'Create UI must persist table');
    passed.push('Tables UI: StrictMode mount, stored cell display, save-on-blur and create-document flow');

    const entryId = `${P}-entry`;
    await db.codexEntries.put({ id: entryId, projectId: P, type: 'character', title: 'Iria', fields: { occupation: 'Navigator' }, tags: [], relations: [], content: '<p>Preserve prose</p>', createdAt: 1, updatedAt: 1 });
    await addTable(P, { id: 'live', title: 'Crew', mode: 'table', codexType: 'character', columns: [{ id: 'name', name: 'Name', kind: 'text', field: 'title' }, { id: 'job', name: 'Occupation', kind: 'text', field: 'occupation' }], rows: [] });
    await render('live'); await click('CrewLive Codex table');
    cell = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="B1 Occupation"]')!;
    assert(cell?.value === 'Navigator', 'Live Codex cells must reflect real fields');
    await type(cell, 'Cartographer'); await act(async () => { cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await pause(250); });
    const updated = (await db.codexEntries.get(entryId))!;
    assert(updated.fields.occupation === 'Cartographer' && updated.content.includes('Preserve prose'), 'Live cell edit must update real Codex preserving unrelated content');
    passed.push('Live Codex tables: actual record fields update through three-way merge without changing prose');
    return passed;
  } finally { await act(async () => { root.unmount(); }); await db.codexEntries.where('projectId').equals(P).delete(); await db.projects.bulkDelete([P, Q]); }
}
