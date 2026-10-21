import type {CsvExportOptions} from './csv';
import type { CalculationResultType } from '@/engines/codex/templateTypes';
import type { CodexEntryType } from '@/types';

export type ColumnKind = 'text' | 'number' | 'reference' | 'checkbox';
export interface TableCalculation { formula:string; rowBindings:Record<string,string>; columnBindings:Record<string,string>; resultType:CalculationResultType }
export interface DataColumn { id: string; name: string; kind: ColumnKind; width?: number; field?: string; propertyId?:string; calculation?:TableCalculation }
export interface DataRow { id: string; cells: Record<string, string> }
export interface WorldTable {
  id: string;
  title: string;
  mode: 'table' | 'sheet';
  /** When set, rows are the project's real Codex entries of this type. */
  codexType?: CodexEntryType;
  codexTemplateId?:string;
  hiddenPropertyIds?:string[];
  columns: DataColumn[];
  rows: DataRow[];
}

export const cellKey = (column: number, row: number) => {
  let name = ''; let value = column + 1;
  while (value > 0) { value--; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); }
  return `${name}${row + 1}`;
};

/** RFC4180 values; prefix spreadsheet control text so CSV cannot execute formulas. */
export function tableCsv(columns: DataColumn[], rows: DataRow[], value: (row: DataRow, column: DataColumn) => string = (row, column) => row.cells[column.id] ?? '',options:CsvExportOptions={}): string {
  const delimiter=options.delimiter??',';if(options.decimal===','&&delimiter===',')throw Error('csv_decimal_delimiter_conflict');
  const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const quote = (text: string,isNumber=false) => `"${(!isNumber&&/^[\s]*[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  return '\ufeff' + [columns.map(column => quote(column.name)).join(delimiter), ...rows.map(row => columns.map(column => {const raw=value(row,column),isNumber=(column.kind==='number'||!!column.calculation&&column.calculation.resultType!=='text')&&numeric.test(raw)&&Number.isFinite(Number(raw));return quote(options.decimal===','&&isNumber?raw.replace('.',','):raw,isNumber);}).join(delimiter))].join('\r\n');
}

export function validateCell(column: DataColumn, value: string): boolean {
  if (!value) return true;
  if (column.kind === 'number') return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER;
  if (column.kind === 'checkbox') return value === 'true' || value === 'false';
  return value.length <= 50000;
}
