import type { CodexEntryType } from '@/types';

export type ColumnKind = 'text' | 'number' | 'reference' | 'checkbox';
export interface DataColumn { id: string; name: string; kind: ColumnKind; width?: number; field?: string }
export interface DataRow { id: string; cells: Record<string, string> }
export interface WorldTable {
  id: string;
  title: string;
  mode: 'table' | 'sheet';
  /** When set, rows are the project's real Codex entries of this type. */
  codexType?: CodexEntryType;
  columns: DataColumn[];
  rows: DataRow[];
}

export const cellKey = (column: number, row: number) => {
  let name = ''; let value = column + 1;
  while (value > 0) { value--; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); }
  return `${name}${row + 1}`;
};

/** RFC4180 values; prefix spreadsheet control text so CSV cannot execute formulas. */
export function tableCsv(columns: DataColumn[], rows: DataRow[], value: (row: DataRow, column: DataColumn) => string = (row, column) => row.cells[column.id] ?? ''): string {
  const quote = (text: string) => `"${(/^[\s]*[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  return '\ufeff' + [columns.map(column => quote(column.name)).join(','), ...rows.map(row => columns.map(column => quote(value(row, column))).join(','))].join('\r\n');
}

export function validateCell(column: DataColumn, value: string): boolean {
  if (!value) return true;
  if (column.kind === 'number') return /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value));
  if (column.kind === 'checkbox') return value === 'true' || value === 'false';
  return value.length <= 50000;
}
