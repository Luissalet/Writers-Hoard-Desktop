// ============================================
// Tables — structural edits and views, pure
// ============================================
// Insert and duplicate rows and columns where the person asks, remove a
// selection of rows, and the view of a table: filter conditions, sorts on
// several columns and find-in-table matches. Shared by the table UI and the
// bridge so both do exactly the same thing.

import type { DataColumn, DataRow, WorldTable } from './types';

const MAX_COLUMNS = 100;
const MAX_ROWS = 20000;

// ── sheet references ──────────────────────────────────────────────────────
// A sheet's formulas point at cells by position (B3). Inserting or removing a
// row or a column moves the cells, so every reference past the change moves
// with them; a reference to a removed cell points nowhere and reads #REF!.

const columnIndex = (letters: string) => { let value = 0; for (const char of letters.toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64; return value - 1; };
const columnLetters = (index: number) => { let value = index + 1, text = ''; while (value > 0) { const rest = (value - 1) % 26; text = String.fromCharCode(65 + rest) + text; value = Math.floor((value - 1) / 26); } return text; };
/** No sheet has this many rows, so a reference here reads #REF!. */
const GONE_ROW = 9_999_999;

/** Move a sheet's references: `map` takes a 0-based index on the axis and returns its new index, or null when that row/column was removed. */
export function shiftSheetReferences(table: WorldTable, axis: 'row' | 'column', map: (index: number) => number | null): void {
  if (table.mode !== 'sheet') return;
  for (const row of table.rows) for (const [id, value] of Object.entries(row.cells)) {
    if (typeof value !== 'string' || !value.startsWith('=')) continue;
    // Text in quotes ("A1 is the corner") is left as written; only references move.
    row.cells[id] = '=' + value.slice(1).split(/("(?:[^"]|"")*")/).map((part, index) => index % 2 ? part : part.replace(/(\$?)\b([A-Za-z]{1,3})(\$?)([1-9]\d*)\b/g, (_reference, fixedColumn: string, letters: string, fixedRow: string, digits: string) => {
      const column = columnIndex(letters), rowIndex = Number(digits) - 1;
      const moved = map(axis === 'row' ? rowIndex : column);
      if (moved === null) return `${fixedColumn}${columnLetters(column)}${fixedRow}${GONE_ROW}`;
      return axis === 'row' ? `${fixedColumn}${columnLetters(column)}${fixedRow}${moved + 1}` : `${fixedColumn}${columnLetters(moved)}${fixedRow}${rowIndex + 1}`;
    })).join('');
  }
}
const inserted = (at: number) => (index: number) => (index >= at ? index + 1 : index);

/** A new empty row at `index` (0 = first; past the end appends). */
export function insertRow(table: WorldTable, index: number, cells: Record<string, string> = {}): DataRow {
  if (table.codexType) throw new Error('table_live_codex_requires_entry');
  if (table.rows.length >= MAX_ROWS) throw new Error('Row limit reached.');
  const row: DataRow = { id: crypto.randomUUID(), cells: { ...cells } };
  const at = Math.max(0, Math.min(table.rows.length, Math.floor(index)));
  shiftSheetReferences(table, 'row', inserted(at));
  table.rows.splice(at, 0, row);
  return row;
}

/** A copy of a row, right below it. */
export function duplicateRow(table: WorldTable, rowId: string): DataRow {
  const at = table.rows.findIndex(row => row.id === rowId);
  if (at < 0) throw new Error('Row not found.');
  return insertRow(table, at + 1, table.rows[at].cells);
}

/** Remove the given rows; returns how many went. */
export function removeRows(table: WorldTable, rowIds: readonly string[]): number {
  if (table.codexType) throw new Error('table_live_codex_rows_are_cards');
  const ids = new Set(rowIds), before = table.rows.length;
  const gone = table.rows.map((row, index) => (ids.has(row.id) ? index : -1)).filter(index => index >= 0);
  shiftSheetReferences(table, 'row', index => (gone.includes(index) ? null : index - gone.filter(removed => removed < index).length));
  table.rows = table.rows.filter(row => !ids.has(row.id));
  return before - table.rows.length;
}

function uniqueName(table: WorldTable, wanted: string): string {
  const taken = new Set(table.columns.map(column => column.name.trim().toLocaleLowerCase()));
  let name = wanted.trim() || 'Column', n = 2;
  const base = name;
  while (taken.has(name.toLocaleLowerCase())) name = `${base} ${n++}`;
  return name;
}

/** A new column at `index` (0 = first). Live Codex tables add columns through their type instead. */
export function insertColumn(table: WorldTable, index: number, column: Omit<DataColumn, 'id'> & { id?: string }): DataColumn {
  if (table.columns.length >= MAX_COLUMNS) throw new Error('Column limit reached.');
  const made: DataColumn = { ...column, id: column.id ?? crypto.randomUUID(), name: uniqueName(table, column.name) };
  const at = Math.max(0, Math.min(table.columns.length, Math.floor(index)));
  shiftSheetReferences(table, 'column', inserted(at));
  table.columns.splice(at, 0, made);
  return made;
}

/** A copy of a column (its kind, width and values), right after it. */
export function duplicateColumn(table: WorldTable, columnId: string, copyLabel = 'copy'): DataColumn {
  const at = table.columns.findIndex(column => column.id === columnId);
  if (at < 0) throw new Error('Column not found.');
  const source = table.columns[at];
  if (source.calculation || source.propertyId) throw new Error('Calculated/live property requires its normal operation.');
  const made = insertColumn(table, at + 1, { name: `${source.name} (${copyLabel})`, kind: source.kind, ...(source.width ? { width: source.width } : {}), ...(source.field && table.codexType ? { field: `${source.field} (${copyLabel})` } : {}) });
  for (const row of table.rows) if (row.cells[source.id] !== undefined) row.cells[made.id] = row.cells[source.id];
  return made;
}

// ── view ──────────────────────────────────────────────────────────────────

export const CONDITION_OPS = ['contains', 'equals', 'notEquals', 'gt', 'lt', 'empty', 'notEmpty', 'checked', 'unchecked'] as const;
export type ConditionOp = typeof CONDITION_OPS[number];
export interface TableCondition { columnId: string; op: ConditionOp; value?: string }
export interface TableSort { id: string; descending: boolean }

const numeric = (text: string) => text.trim() !== '' && Number.isFinite(Number(text));

/** Whether one cell value meets a condition. Comparisons are numeric when both sides are numbers. */
export function meetsCondition(cell: string, condition: TableCondition): boolean {
  // A number from the bridge compares like the text a person types.
  const wanted = String(condition.value ?? ''), value = String(cell ?? '');
  const folded = value.toLocaleLowerCase(), target = wanted.toLocaleLowerCase();
  switch (condition.op) {
    case 'contains': return folded.includes(target);
    case 'equals': return numeric(value) && numeric(wanted) ? Number(value) === Number(wanted) : folded.trim() === target.trim();
    case 'notEquals': return !(numeric(value) && numeric(wanted) ? Number(value) === Number(wanted) : folded.trim() === target.trim());
    case 'gt': return numeric(value) && numeric(wanted) ? Number(value) > Number(wanted) : value.localeCompare(wanted, undefined, { numeric: true }) > 0;
    case 'lt': return numeric(value) && numeric(wanted) ? Number(value) < Number(wanted) : value.localeCompare(wanted, undefined, { numeric: true }) < 0;
    case 'empty': return !value.trim();
    case 'notEmpty': return !!value.trim();
    case 'checked': return value === 'true';
    case 'unchecked': return value !== 'true';
  }
}

/** Rows that meet every condition (an unknown column never matches). */
export function filterRows<T>(rows: readonly T[], conditions: readonly TableCondition[], value: (row: T, columnId: string) => string | undefined): T[] {
  if (!conditions.length) return [...rows];
  return rows.filter(row => conditions.every(condition => { const cell = value(row, condition.columnId); return cell !== undefined && meetsCondition(cell, condition); }));
}

/** Sort by each column in turn: the first decides, the next breaks ties. */
export function sortRows<T>(rows: readonly T[], sorts: readonly TableSort[], value: (row: T, columnId: string) => string, isNumber: (columnId: string) => boolean): T[] {
  if (!sorts.length) return [...rows];
  return [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const left = value(a, sort.id), right = value(b, sort.id);
      const comparison = isNumber(sort.id) && numeric(left) && numeric(right) ? Number(left) - Number(right) : left.localeCompare(right, undefined, { numeric: true });
      if (comparison) return sort.descending ? -comparison : comparison;
    }
    return 0;
  });
}

/** Click on a header: the first click sorts by it; with `add`, it becomes the next sort; again, it turns. */
export function toggleSort(sorts: readonly TableSort[], id: string, add: boolean): TableSort[] {
  const existing = sorts.find(sort => sort.id === id);
  if (add) return existing ? sorts.map(sort => sort.id === id ? { ...sort, descending: !sort.descending } : sort) : [...sorts, { id, descending: false }];
  return [{ id, descending: existing && sorts[0]?.id === id ? !existing.descending : false }];
}

/** Every cell holding the text, in reading order (row by row, left to right). */
export function findMatches<T extends { id: string }>(rows: readonly T[], columns: readonly DataColumn[], query: string, value: (row: T, column: DataColumn) => string): { rowId: string; columnId: string }[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const result: { rowId: string; columnId: string }[] = [];
  for (const row of rows) for (const column of columns) if (value(row, column).toLocaleLowerCase().includes(needle)) result.push({ rowId: row.id, columnId: column.id });
  return result;
}
