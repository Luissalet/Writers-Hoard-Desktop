import * as edits from '../src/engines/tables/tableEdits';
import { sheetValues } from '../src/engines/tables/formulas';
import type { WorldTable } from '../src/engines/tables/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export function testTableRowOrderPure(): string[] {
  const table: WorldTable = { id: 'table', title: 'Order', mode: 'table', columns: [{ id: 'name', name: 'Name', kind: 'text' }], rows: ['Alfa', 'Bravo', 'Charlie'].map(id => ({ id, cells: { name: id } })) };
  const inserted = edits.insertRow(table, 1);
  assert(table.rows.map(row => row.cells.name ?? '').join('|') === 'Alfa||Bravo|Charlie', 'Existing insertion control failed');
  const move = (edits as unknown as { moveRow?: (table: WorldTable, rowId: string, beforeRowId?: string) => boolean }).moveRow;
  assert(typeof move === 'function', 'Missing shared manual row move');
  const cells = JSON.stringify(Object.fromEntries(table.rows.map(row => [row.id, row.cells])));
  assert(move(table, 'Charlie', 'Alfa'), 'Move should change order');
  assert(table.rows.map(row => row.id).join('|') === `Charlie|Alfa|${inserted.id}|Bravo`, 'Move before anchor failed');
  assert(JSON.stringify(Object.fromEntries([...table.rows].sort((a, b) => a.id.localeCompare(b.id)).map(row => [row.id, row.cells]))) === JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(cells)).sort(([a], [b]) => a.localeCompare(b)))), 'Move changed cells or identities');
  assert(!move(table, 'Charlie', 'Alfa') && !move(table, 'Charlie', 'Charlie') && !move(table, 'Bravo'), 'No-op changed order');
  const before = JSON.stringify(table);
  for (const [row, anchor] of [['missing', 'Alfa'], ['Alfa', 'missing']]) { let failed = false; try { move(table, row, anchor); } catch { failed = true; } assert(failed && JSON.stringify(table) === before, 'Invalid move mutated table'); }
  const sheet: WorldTable = { id: 'sheet', title: 'Coordinates', mode: 'sheet', columns: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id, kind: 'text' })), rows: [{ id: 'one', cells: { a: '10' } }, { id: 'two', cells: { a: '20' } }, { id: 'three', cells: { b: '=A1', c: '=$A$1', d: '="A1"' } }] };
  assert(sheetValues(sheet).get('B3') === 10, 'Formula positive control');
  move(sheet, 'two', 'one');
  assert(sheet.rows[2].cells.b === '=A1' && sheetValues(sheet).get('B3') === 20 && sheetValues(sheet).get('C3') === 20 && sheetValues(sheet).get('D3') === 'A1', 'Move must preserve literal coordinate semantics');
  edits.insertRow(sheet, 0);
  assert(sheet.rows[3].cells.b === '=A2' && sheetValues(sheet).get('B4') === 20, 'Insert must retain existing reference shift semantics');
  const filtered: WorldTable = { ...table, rows: ['A', 'H1', 'B', 'H2', 'C'].map(id => ({ id, cells: { name: id } })) };
  move(filtered, 'C', 'B');
  assert(filtered.rows.map(row => row.id).join() === 'A,H1,C,B,H2', 'Hidden row order lost');
  return ['manual row identity, anchors, no-op and invalid moves', 'Sheet coordinate formulas retain literals on move and shift on insertion', 'filtered anchors retain hidden row order'];
}
