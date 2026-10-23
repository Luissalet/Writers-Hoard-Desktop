// Workbook tabs: sheets that share a workbook id, in order.
import { cellKey, type WorldTable } from './types';

export function workbookTabs(tables: WorldTable[], table: WorldTable): WorldTable[] {
  return table.workbook ? tables.filter(item => item.workbook?.id === table.workbook!.id).sort((a, b) => a.workbook!.order - b.workbook!.order) : [table];
}

export function blankSheet(title: string, workbook: NonNullable<WorldTable['workbook']>): WorldTable {
  const columns = Array.from({ length: 6 }, (_, index) => ({ id: crypto.randomUUID(), name: cellKey(index, 0).replace(/\d+$/, ''), kind: 'text' as const }));
  return { id: crypto.randomUUID(), title, mode: 'sheet', columns, rows: Array.from({ length: 10 }, () => ({ id: crypto.randomUUID(), cells: {} })), workbook };
}

export function duplicateSheet(table: WorldTable, title: string, order: number): WorldTable {
  const ids = new Map(table.columns.map(column => [column.id, crypto.randomUUID()]));
  return { ...structuredClone(table), id: crypto.randomUUID(), title, columns: table.columns.map(column => ({ ...structuredClone(column), id: ids.get(column.id)! })), rows: table.rows.map(row => ({ id: crypto.randomUUID(), cells: Object.fromEntries(Object.entries(row.cells).map(([id, value]) => [ids.get(id) ?? id, value])) })), workbook: { ...table.workbook!, order, hidden: false } };
}
