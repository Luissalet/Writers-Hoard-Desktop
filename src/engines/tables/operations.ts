import { shiftSheetReferences } from './tableEdits';
import {csvNumeric,detectCsvDelimiter,type CsvOptions,type CsvDelimiter} from './csv';
import { getEraProject, updateEraProjectMetadata, listEraRows } from '@/services/worldEras/store';
import { db } from '@/db';
import Dexie from 'dexie';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { notifyProjectsChanged } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { validateCell, type DataColumn, type WorldTable } from './types';

async function mutate(projectId: string, change: (tables: WorldTable[]) => void|Promise<void>, eraId?: string): Promise<void> {
  await db.transaction('rw', eraId ? db.tables : [db.projects,db.codexEntries,db.worldEraVariants,db.worldEraAssets], async () => {
    const project = await (eraId ? getEraProject({ projectId, eraId }) : db.projects.get(projectId)); if (!project) throw new Error('Project not found.');
    const tables = structuredClone(project.dataTables ?? []); await change(tables);
    await updateEraProjectMetadata({ projectId, eraId }, { dataTables: tables, updatedAt: Date.now() });
  });
  const notify=()=>Dexie.ignoreTransaction(()=>{notifyProjectsChanged();notifyDataChanged({source:'other',table:'projects',projectId});});
  let outer=Dexie.currentTransaction;if(outer){while(outer.parent)outer=outer.parent;outer.on('complete',notify);}else notify();
}
export function addTable(projectId: string, table: WorldTable, eraId?: string): Promise<void> {
  return mutate(projectId, async tables => { if (tables.some(item => item.id === table.id)) throw new Error('Duplicate table.'); await validateReferences(projectId,table,eraId);tables.push(table); }, eraId);
}
export function deleteTable(projectId: string, tableId: string, eraId?: string): Promise<void> {
  return (eraId ? async (remove: () => Promise<void>) => remove() : (remove: () => Promise<void>) => archiveMetadataWithMutation('tables',projectId,tableId,remove))(()=>mutate(projectId, tables => { const index = tables.findIndex(table => table.id === tableId); if (index >= 0) tables.splice(index, 1); }, eraId));
}
export function changeTable(projectId: string, tableId: string, change: (table: WorldTable) => void|Promise<void>, eraId?: string): Promise<void> {
  return mutate(projectId, async tables => { const table = tables.find(table => table.id === tableId); if (!table) throw new Error('Table not found.');const before=structuredClone(table); await change(table);await validateReferences(projectId,table,eraId,before); }, eraId);
}
export function saveCell(projectId: string, tableId: string, rowId: string, columnId: string, value: string, expected: string, eraId?: string): Promise<void> {
  return changeTable(projectId, tableId, table => {
    const row = table.rows.find(row => row.id === rowId); const column = table.columns.find(column => column.id === columnId);
    if (!row || !column) throw new Error('Cell not found.');
    if(column.calculation||column.propertyId&&table.codexTemplateId)throw new Error('Calculated/live property requires its normal operation.');
    if ((row.cells[columnId] ?? '') !== expected) throw new Error('This cell changed. Reopen the table to review its current value.');
    if (table.mode !== 'sheet' && !validateCell(column, value)) throw new Error('Value does not match the column type.');
    row.cells[columnId] = value;
  }, eraId);
}
export function addColumn(projectId: string, tableId: string, column: DataColumn, eraId?: string): Promise<void> {
  return changeTable(projectId, tableId, table => {
    if (column.field && ['__proto__', 'constructor', 'prototype'].includes(column.field.toLowerCase())) throw new Error('Reserved field.');
    if (!column.name.trim() || table.columns.some(item => item.name.trim().toLocaleLowerCase() === column.name.trim().toLocaleLowerCase())) throw new Error('Use a unique column name.');
    if (table.columns.length >= 100) throw new Error('Column limit reached.');
    table.columns.push(column);
  }, eraId);
}

/** A column at a position (0 = first), with the same checks as adding one at the end. */
export function insertColumnAt(projectId: string, tableId: string, column: DataColumn, at: number, eraId?: string): Promise<void> {
  return changeTable(projectId, tableId, table => {
    if (column.field && ['__proto__', 'constructor', 'prototype'].includes(column.field.toLowerCase())) throw new Error('Reserved field.');
    if (!column.name.trim() || table.columns.some(item => item.name.trim().toLocaleLowerCase() === column.name.trim().toLocaleLowerCase())) throw new Error('Use a unique column name.');
    if (table.columns.length >= 100) throw new Error('Column limit reached.');
    const index = Math.max(0, Math.min(table.columns.length, Math.floor(at)));
    shiftSheetReferences(table, 'column', column => (column >= index ? column + 1 : column));
    table.columns.splice(index, 0, column);
  }, eraId);
}

/** Parse CSV records, including quoted separators/newlines and escaped quotes. */
export function parseCsv(source: string, delimiter:CsvDelimiter=','): string[][] {
  if (source.length > 8_000_000) throw new Error('CSV exceeds 8 MB.');
  const records: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let afterQuote = false;
  const commitCell = () => { if (row.length >= 100) throw new Error('More than 100 columns.'); row.push(cell); cell = ''; afterQuote = false; };
  for (let i = source.charCodeAt(0) === 0xfeff ? 1 : 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) { if (char === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; afterQuote = true; } } else cell += char; }
    else if (char === '"' && !cell && !afterQuote) quoted = true;
    else if (char === delimiter) commitCell();
    else if (char === '\r' || char === '\n') { if (char === '\r' && source[i + 1] === '\n') i++; commitCell(); records.push(row); row = []; if (records.length > 20001) throw new Error('More than 20000 rows.'); }
    else { if (afterQuote || char === '"') throw new Error('Malformed CSV quoting.'); cell += char; }
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  if (cell || row.length || afterQuote) { commitCell(); records.push(row); }
  if (!records.length || !records[0].length || records.some(row => row.length !== records[0].length)) throw new Error('CSV must have a header and equal-width rows.');
  return records;
}

export function previewCsv(source:string,options:CsvOptions={}){const delimiter=options.delimiter===undefined||options.delimiter==='auto'?detectCsvDelimiter(source):options.delimiter;const [headers,...records]=parseCsv(source,delimiter);return{headers,records,delimiter};}
export function importCsv(source: string, title: string,options:CsvOptions={}): WorldTable {
  const {headers,records,delimiter}=previewCsv(source,options);
  if(options.columnKinds&&(options.columnKinds.length!==headers.length||options.columnKinds.some(kind=>kind!=='text'&&kind!=='number')))throw Error('csv_columns_invalid');
  if(options.decimal!==undefined&&options.decimal!=='.'&&options.decimal!==',')throw Error('csv_decimal_invalid');
  if(options.decimal===','&&delimiter===',')throw Error('csv_decimal_delimiter_conflict');
  const used = new Set<string>();
  const columns = headers.map((header, index): DataColumn => {
    let name = header.trim() || `Column ${index + 1}`; const base = name; let suffix = 2;
    while (used.has(name.toLowerCase())) name = `${base} ${suffix++}`;
    used.add(name.toLowerCase());
    return { id: crypto.randomUUID(), name, kind: options.columnKinds?.[index]??'text' };
  });
  return { id: crypto.randomUUID(), title, mode: options.mode==='sheet'?'sheet':'table', columns, rows: records.map(record => ({ id: crypto.randomUUID(), cells: Object.fromEntries(columns.map((column, index) => [column.id, column.kind==='number'?csvNumeric(record[index],options.decimal??'.',delimiter):record[index]])) })) };
}

/** Validate inside the same mutation transaction, after user/bridge preflight. */
async function validateReferences(projectId:string,table:WorldTable,eraId?:string,previous?:WorldTable):Promise<void>{
 if(table.mode==='sheet'||table.codexType||table.codexAllTypes||table.codexTemplateId||!table.columns.some(column=>column.kind==='reference'))return;
 const entries=new Set((await listEraRows<{id:string}>({projectId,eraId},'codexEntries')).map(row=>row.id));
 for(const column of table.columns.filter(column=>column.kind==='reference'))for(const row of table.rows){const id=row.cells[column.id];if(id&&!entries.has(id)&&!(previous?.columns.some(item=>item.id===column.id&&item.kind==='reference')&&previous.rows.find(item=>item.id===row.id)?.cells[column.id]===id))throw Error('table_reference_invalid');}
}
