import { db } from '@/db';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { notifyProjectsChanged } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { validateCell, type DataColumn, type WorldTable } from './types';

async function mutate(projectId: string, change: (tables: WorldTable[]) => void): Promise<void> {
  await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('Project not found.');
    const tables = structuredClone(project.dataTables ?? []); change(tables);
    await db.projects.update(projectId, { dataTables: tables, updatedAt: Date.now() });
  });
  notifyProjectsChanged(); notifyDataChanged({ source: 'other', table: 'projects', projectId });
}
export function addTable(projectId: string, table: WorldTable): Promise<void> {
  return mutate(projectId, tables => { if (tables.some(item => item.id === table.id)) throw new Error('Duplicate table.'); tables.push(table); });
}
export function deleteTable(projectId: string, tableId: string): Promise<void> {
  return archiveMetadataWithMutation('tables',projectId,tableId,()=>mutate(projectId, tables => { const index = tables.findIndex(table => table.id === tableId); if (index >= 0) tables.splice(index, 1); }));
}
export function changeTable(projectId: string, tableId: string, change: (table: WorldTable) => void): Promise<void> {
  return mutate(projectId, tables => { const table = tables.find(table => table.id === tableId); if (!table) throw new Error('Table not found.'); change(table); });
}
export function saveCell(projectId: string, tableId: string, rowId: string, columnId: string, value: string, expected: string): Promise<void> {
  return changeTable(projectId, tableId, table => {
    const row = table.rows.find(row => row.id === rowId); const column = table.columns.find(column => column.id === columnId);
    if (!row || !column) throw new Error('Cell not found.');
    if ((row.cells[columnId] ?? '') !== expected) throw new Error('This cell changed. Reopen the table to review its current value.');
    if (table.mode !== 'sheet' && !validateCell(column, value)) throw new Error('Value does not match the column type.');
    row.cells[columnId] = value;
  });
}
export function addColumn(projectId: string, tableId: string, column: DataColumn): Promise<void> {
  return changeTable(projectId, tableId, table => {
    if (column.field && ['__proto__', 'constructor', 'prototype'].includes(column.field.toLowerCase())) throw new Error('Reserved field.');
    if (!column.name.trim() || table.columns.some(item => item.name.trim().toLocaleLowerCase() === column.name.trim().toLocaleLowerCase())) throw new Error('Use a unique column name.');
    if (table.columns.length >= 100) throw new Error('Column limit reached.');
    table.columns.push(column);
  });
}

/** Parse CSV records, including quoted separators/newlines and escaped quotes. */
export function parseCsv(source: string): string[][] {
  if (source.length > 8_000_000) throw new Error('CSV exceeds 8 MB.');
  const records: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let afterQuote = false;
  const commitCell = () => { if (row.length >= 100) throw new Error('More than 100 columns.'); row.push(cell); cell = ''; afterQuote = false; };
  for (let i = source.charCodeAt(0) === 0xfeff ? 1 : 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) { if (char === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; afterQuote = true; } } else cell += char; }
    else if (char === '"' && !cell && !afterQuote) quoted = true;
    else if (char === ',') commitCell();
    else if (char === '\r' || char === '\n') { if (char === '\r' && source[i + 1] === '\n') i++; commitCell(); records.push(row); row = []; if (records.length > 20001) throw new Error('More than 20000 rows.'); }
    else { if (afterQuote || char === '"') throw new Error('Malformed CSV quoting.'); cell += char; }
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  if (cell || row.length || afterQuote) { commitCell(); records.push(row); }
  if (!records.length || !records[0].length || records.some(row => row.length !== records[0].length)) throw new Error('CSV must have a header and equal-width rows.');
  return records;
}

export function importCsv(source: string, title: string): WorldTable {
  const [headers, ...records] = parseCsv(source);
  const used = new Set<string>();
  const columns = headers.map((header, index): DataColumn => {
    let name = header.trim() || `Column ${index + 1}`; const base = name; let suffix = 2;
    while (used.has(name.toLowerCase())) name = `${base} ${suffix++}`;
    used.add(name.toLowerCase());
    return { id: crypto.randomUUID(), name, kind: 'text' };
  });
  return { id: crypto.randomUUID(), title, mode: 'table', columns, rows: records.map(record => ({ id: crypto.randomUUID(), cells: Object.fromEntries(columns.map((column, index) => [column.id, record[index]])) })) };
}
