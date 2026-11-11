import { parseCsv } from './operations';
import { insertRow, isNormalTable } from './tableEdits';
import { validateCell, type WorldTable } from './types';

export interface TableCellPaste {
  rowIds: readonly string[];
  columnIds: readonly string[];
  values: readonly (readonly string[])[];
}
export interface TableCellPasteResult {
  rowIds: string[];
  columnIds: string[];
  changedCells: number;
  addedRows: number;
}

export function serializeTableClipboard(values: readonly (readonly string[])[]): string {
  const encode = (value: string) => /["\t\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  return values.map(row => row.length === 1 && row[0] === '' ? '""' : row.map(encode).join('\t')).join('\n');
}

export function parseTableClipboard(text: string): string[][] {
  // A plain one-cell string can contain quotes that do not form TSV syntax.
  if (!/[\t\r\n]/.test(text) && !/^"(?:[^"]|"")*"$/.test(text)) return [[text]];
  return parseCsv(text, '\t');
}

/** Write the given cells in view order, then append any remaining rows. */
export function pasteTableCells(table: WorldTable, paste: TableCellPaste): TableCellPasteResult {
  if (!isNormalTable(table)) throw Error('table_paste_requires_normal_table');
  const { rowIds, columnIds, values } = paste;
  const width = values[0]?.length ?? 0;
  if (!width || columnIds.length < 1 || columnIds.length > width || rowIds.length > values.length ||
      values.some(row => row.length !== width || row.some(value => typeof value !== 'string')) ||
      new Set(rowIds).size !== rowIds.length || new Set(columnIds).size !== columnIds.length) {
    throw Error('table_paste_shape_invalid');
  }

  const rowsById = new Map(table.rows.map(row => [row.id, row]));
  const columnsById = new Map(table.columns.map(column => [column.id, column]));
  const missing = (): never => { throw Error('table_paste_target_missing'); };
  const rows = rowIds.map(id => rowsById.get(id) ?? missing());
  const targetColumns = columnIds.map(id => columnsById.get(id) ?? missing());
  if (targetColumns.some(column => column.calculation)) throw Error('table_paste_readonly');
  for (const row of values) {
    if (targetColumns.some((column, index) => !validateCell(column, row[index]))) throw Error('table_paste_value_invalid');
  }

  const addedRows = values.length - rows.length;
  if (addedRows) {
    const draft = { ...table, rows: [...table.rows] };
    while (rows.length < values.length) rows.push(insertRow(draft, draft.rows.length));
    table.rows = draft.rows;
  }
  let changedCells = 0;
  for (const [rowIndex, cells] of values.entries()) {
    const row = rows[rowIndex];
    for (const [columnIndex, column] of targetColumns.entries()) {
      const value = cells[columnIndex];
      if ((row.cells[column.id] ?? '') === value) continue;
      row.cells[column.id] = value;
      changedCells++;
    }
  }
  return { rowIds: rows.map(row => row.id), columnIds: [...columnIds], changedCells, addedRows };
}
