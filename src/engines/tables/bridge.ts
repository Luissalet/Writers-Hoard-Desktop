import { db } from '@/db';
import { getEraProject, listEraRows, readWorldDocument } from '@/services/worldEras/store';
import { resolveProjectForEngine, requireString, optString, type ToolArgs } from '@/services/aiBridge/tools/shared';
import {projectWorldTable} from './projection';
import {createTypeTable,saveTableCalculation,removeTableColumn,type SaveTableCalculation} from './calculations';
import type { CodexEntry } from '@/types';
import { addTable, changeTable, deleteTable, saveCell, importCsv, previewCsv } from './operations';
import { exportXlsxReport, importXlsx, sheetsToTables } from './xlsx';
import { blankSheet, duplicateSheet, workbookTabs } from './workbook';
import {csvDelimiter,csvEncoding,decodeCsv,encodeCsv,type CsvOptions,type CsvExportOptions} from './csv';
import { sheetValues } from './formulas';
import { cellKey, tableCsv, validateCell, type WorldTable } from './types';
import { CONDITION_OPS, duplicateColumn, duplicateRow, filterRows, insertColumn, insertRow, removeRows, sortRows, type TableCondition, type TableSort } from './tableEdits';
const scope = async (args: ToolArgs) => ({ projectId: await resolveProjectForEngine(args, 'tables'), eraId: optString(args, 'eraId') });
async function read(args: ToolArgs) {
  const target = await scope(args), project = target.eraId ? await getEraProject(target) : await db.projects.get(target.projectId);
  const source = await readWorldDocument(target, 'tables', requireString(args, 'tableId'));
  if (!project || !source) throw Error('table_missing');
  const table = source.document.root as unknown as WorldTable;
  const entries = table.codexAllTypes ? await listEraRows<CodexEntry>(target, 'codexEntries') : table.codexType ? (await listEraRows<CodexEntry>(target, 'codexEntries')).filter(entry => entry.type === table.codexType) : [];
  const projection=projectWorldTable(table,entries,project.codexTemplates??[]);
  return { target, table:{...table,columns:projection.columns}, rows:projection.rows,displayRows:projection.displayRows,calculatedColumnIds:projection.calculatedColumnIds,version:source.version };
}
async function valuesFor(table: WorldTable, values: unknown, target: Awaited<ReturnType<typeof scope>>): Promise<string[]> {
  if (!Array.isArray(values) || values.length !== table.columns.length || values.some(value => typeof value !== 'string')) throw Error('table_row_shape_invalid');
  const entries = new Set(table.mode !== 'sheet' && table.columns.some(column => column.kind === 'reference') ? (await listEraRows<CodexEntry>(target, 'codexEntries')).map(entry => entry.id) : []);
  for (const [index, value] of values.entries()) { const column = table.columns[index];if(column.calculation&&value)throw Error('table_calculated_readonly'); if (table.mode !== 'sheet' && (!validateCell(column, value) || column.kind === 'reference' && value && !entries.has(value))) throw Error('table_cell_invalid'); }
  return values;
}
const stringArg = (args: ToolArgs, key: string) => { if (typeof args[key] !== 'string') throw Error('table_cell_invalid'); return args[key] as string; };
function csvOptions(args:ToolArgs):CsvOptions{const delimiter=csvDelimiter(args.delimiter,true);if(args.decimal!==undefined&&args.decimal!=='.'&&args.decimal!==',')throw Error('csv_decimal_invalid');if(args.mode!==undefined&&args.mode!=='table'&&args.mode!=='sheet')throw Error('csv_mode_invalid');if(args.columnKinds!==undefined&&(!Array.isArray(args.columnKinds)||args.columnKinds.some(kind=>kind!=='text'&&kind!=='number')))throw Error('csv_columns_invalid');return{delimiter,decimal:args.decimal as CsvOptions['decimal'],mode:args.mode as CsvOptions['mode'],columnKinds:args.columnKinds as CsvOptions['columnKinds']};}
function csvSource(args:ToolArgs){if(typeof args.csv==='string'&&args.base64===undefined)return{text:args.csv,encoding:'unicode'};if(typeof args.base64==='string'&&args.csv===undefined){let raw:string;try{raw=atob(args.base64);}catch{throw Error('csv_base64_invalid');}return decodeCsv(Uint8Array.from(raw,char=>char.charCodeAt(0)),csvEncoding(args.encoding));}throw Error('csv_source_required');}
export const TABLE_HANDLERS = {
  async wh_table_preview_csv(args:ToolArgs){await scope(args);const source=csvSource(args),parsed=previewCsv(source.text,csvOptions(args));return{...parsed,encoding:source.encoding,totalRows:parsed.records.length};},
  async wh_table_import_csv(args:ToolArgs){const target=await scope(args),source=csvSource(args),table=importCsv(source.text,requireString(args,'title'),csvOptions(args));await addTable(target.projectId,table,target.eraId);return{table,encoding:source.encoding};},
  async wh_table_create_type_view(args:ToolArgs){const target=await scope(args);return{table:await createTypeTable(target,requireString(args,'title'),requireString(args,'templateId'))};},
  async wh_table_save_calculation(args:ToolArgs){const target=await scope(args);return saveTableCalculation(target,{tableId:requireString(args,'tableId'),columnId:optString(args,'columnId'),name:requireString(args,'name'),formula:requireString(args,'formula'),resultType:requireString(args,'resultType') as SaveTableCalculation['resultType'],expectedVersion:requireString(args,'expectedVersion'),expectedTemplateRevision:typeof args.expectedTemplateRevision==='number'?args.expectedTemplateRevision:undefined});},
  async wh_table_remove_column(args:ToolArgs){await removeTableColumn(await scope(args),requireString(args,'tableId'),requireString(args,'columnId'),requireString(args,'expectedVersion'));return{removed:true};},
  async wh_tables_list(args: ToolArgs) { const target = await scope(args), project = target.eraId ? await getEraProject(target) : await db.projects.get(target.projectId); return { tables: (project?.dataTables ?? []).map(table => ({ id: table.id, title: table.title, mode: table.mode, codexType: table.codexType,codexTemplateId:table.codexTemplateId, columns: table.columns.length, rows: table.codexType ? null : table.rows.length })) }; },
  async wh_table_get(args: ToolArgs) { const { table, rows,displayRows,calculatedColumnIds, version } = await read(args); return { table: { ...table, rows },displayRows,calculatedColumnIds, version, ...(table.mode === 'sheet' ? { computed: Object.fromEntries(sheetValues(table)) } : {}) }; },
  async wh_table_create(args: ToolArgs) {
    const target = await scope(args), columns = args.columns, rows = args.rows ?? [];
    if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows) || args.mode !== undefined && args.mode !== 'table' && args.mode !== 'sheet') throw Error('table_shape_invalid');
    const names = new Set<string>();
    const table: WorldTable = { id: crypto.randomUUID(), title: requireString(args, 'title'), mode: args.mode === 'sheet' ? 'sheet' : 'table', columns: columns.map(column => { if (!column || typeof column !== 'object') throw Error('table_column_invalid'); const value = column as Record<string, unknown>; if (typeof value.name !== 'string' || !value.name.trim() || names.has(value.name.trim().toLowerCase()) || !['text', 'number', 'reference', 'checkbox'].includes(String(value.kind))) throw Error('table_column_invalid'); names.add(value.name.trim().toLowerCase()); return { id: crypto.randomUUID(), name: value.name.trim(), kind: value.kind as WorldTable['columns'][number]['kind'] }; }), rows: [] };
    for (const row of rows) table.rows.push({ id: crypto.randomUUID(), cells: Object.fromEntries((await valuesFor(table, row, target)).map((value, index) => [table.columns[index].id, value])) });
    await addTable(target.projectId, table, target.eraId); return { table };
  },
  async wh_table_append_row(args: ToolArgs) { const { table, target } = await read(args); if (table.codexType || table.codexAllTypes) throw Error('table_live_codex_requires_entry'); const values = await valuesFor(table, args.values, target), row = { id: crypto.randomUUID(), cells: Object.fromEntries(values.map((value, index) => [table.columns[index].id, value])) }; await db.transaction('rw', db.tables, async () => { if ((await readWorldDocument(target, 'tables', table.id))?.version !== requireString(args, 'expectedVersion')) throw Error('table_conflict'); await changeTable(target.projectId, table.id, current => { current.rows.push(row); }, target.eraId); }); return { row }; },
  async wh_table_edit(args: ToolArgs) {
    const { table, target } = await read(args), action = requireString(args, 'action'), expected = requireString(args, 'expectedVersion');
    if (table.codexAllTypes) throw Error('table_all_types_read_only');
    let result: Record<string, unknown> = {};
    await db.transaction('rw', db.tables, async () => {
      if ((await readWorldDocument(target, 'tables', table.id))?.version !== expected) throw Error('table_conflict');
      await changeTable(target.projectId, table.id, current => {
        if (action === 'insert-row') { const at = typeof args.at === 'number' ? args.at : current.rows.length; result = { row: insertRow(current, at) }; }
        else if (action === 'duplicate-row') result = { row: duplicateRow(current, requireString(args, 'rowId')) };
        else if (action === 'remove-rows') { const ids = args.rowIds; if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) throw Error('table_rows_invalid'); result = { removed: removeRows(current, ids as string[]) }; }
        else if (action === 'insert-column') {
          if (current.codexType) throw Error('table_live_codex_column_needs_field');
          const kind = String(args.kind ?? 'text'); if (!['text', 'number', 'reference', 'checkbox'].includes(kind)) throw Error('table_column_invalid');
          result = { column: insertColumn(current, typeof args.at === 'number' ? args.at : current.columns.length, { name: requireString(args, 'name'), kind: kind as WorldTable['columns'][number]['kind'] }) };
        }
        else if (action === 'duplicate-column') { if (current.codexType) throw Error('table_live_codex_column_needs_field'); result = { column: duplicateColumn(current, requireString(args, 'columnId'), typeof args.copyLabel === 'string' ? args.copyLabel : 'copy') }; }
        else throw Error('table_action_invalid');
      }, target.eraId);
    });
    return { ...result, version: (await readWorldDocument(target, 'tables', table.id))!.version };
  },
  async wh_table_create_cards_view(args: ToolArgs) {
    const target = await scope(args);
    const table: WorldTable = { id: crypto.randomUUID(), title: requireString(args, 'title'), mode: 'table', codexAllTypes: true, columns: [{ id: crypto.randomUUID(), name: optString(args, 'nameColumn') ?? 'Nombre', kind: 'text', field: 'title' }, { id: crypto.randomUUID(), name: optString(args, 'typeColumn') ?? 'Tipo', kind: 'text', field: '__type' }], rows: [] };
    await addTable(target.projectId, table, target.eraId);
    return { table };
  },
  async wh_table_query(args: ToolArgs) {
    const { table, rows, displayRows } = await read(args);
    const shown = new Map(displayRows.map(row => [row.id, row]));
    const value = (row: { id: string; cells: Record<string, string> }, columnId: string) => table.columns.some(column => column.id === columnId) ? (shown.get(row.id)?.cells[columnId] ?? row.cells[columnId] ?? '') : undefined;
    const given = Array.isArray(args.conditions) ? args.conditions as Partial<TableCondition>[] : [];
    if (given.some(condition => !condition || typeof condition !== 'object' || typeof condition.columnId !== 'string' || !CONDITION_OPS.includes(condition.op as never))) throw Error('table_condition_invalid');
    const conditions: TableCondition[] = given.map(condition => ({ columnId: condition.columnId!, op: condition.op!, ...(condition.value !== undefined && condition.value !== null ? { value: String(condition.value) } : {}) }));
    const sortArgs = Array.isArray(args.sorts) ? args.sorts as Partial<TableSort>[] : [];
    if (sortArgs.some(sort => !sort || typeof sort !== 'object' || typeof sort.id !== 'string')) throw Error('table_sort_invalid');
    const sorts = sortArgs.map(sort => ({ id: sort.id!, descending: !!sort.descending }));
    const result = sortRows(filterRows(rows, conditions, value), sorts, (row, id) => value(row, id) ?? '', id => table.columns.find(column => column.id === id)?.kind === 'number');
    return { columns: table.columns.map(column => ({ id: column.id, name: column.name, kind: column.kind })), total: rows.length, matched: result.length, rows: result.slice(0, 500).map(row => ({ id: row.id, cells: Object.fromEntries(table.columns.map(column => [column.name, value(row, column.id) ?? ''])) })) };
  },
  async wh_table_save_cell(args: ToolArgs) { const { table, target } = await read(args); if (table.codexType || table.codexAllTypes) throw Error('table_live_codex_requires_entry'); const value = stringArg(args, 'value'), column = table.columns.find(item => item.id === requireString(args, 'columnId')); if (!column) throw Error('table_column_missing'); if (table.mode !== 'sheet' && column.kind === 'reference' && value && !(await listEraRows<CodexEntry>(target, 'codexEntries')).some(entry => entry.id === value)) throw Error('table_reference_invalid'); await saveCell(target.projectId, table.id, requireString(args, 'rowId'), column.id, value, stringArg(args, 'expected'), target.eraId); return { saved: true }; },
  async wh_table_export_csv(args: ToolArgs) { const { table, rows,displayRows } = await read(args), computed = table.mode === 'sheet' ? sheetValues(table) : undefined; const options:CsvExportOptions={delimiter:csvDelimiter(args.delimiter) as CsvExportOptions['delimiter'],decimal:args.decimal as CsvExportOptions['decimal'],encoding:args.encoding as CsvExportOptions['encoding']};if(options.decimal!==undefined&&options.decimal!=='.'&&options.decimal!==',')throw Error('csv_decimal_invalid');const csv=tableCsv(table.columns, rows, (row, column) => computed ? String(computed.get(cellKey(table.columns.indexOf(column), rows.indexOf(row))) ?? '') : displayRows.find(item=>item.id===row.id)?.cells[column.id] ?? row.cells[column.id] ?? '',options),bytes=encodeCsv(csv,options.encoding);let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);return{title:table.title,csv,encoding:options.encoding??'utf-8',base64:btoa(raw)}; },
  async wh_table_import_xlsx(args: ToolArgs) {
    const target = await scope(args); let raw: string; try { raw = atob(requireString(args, 'base64')); } catch { throw Error('xlsx_base64_invalid'); }
    const { sheets, report } = await importXlsx(Uint8Array.from(raw, char => char.charCodeAt(0)));
    const created = sheetsToTables(sheets, optString(args, 'title') ?? 'Libro');
    for (const sheet of created) await addTable(target.projectId, sheet, target.eraId);
    return { workbookId: created[0].workbook!.id, tabs: created.map(sheet => ({ tableId: sheet.id, title: sheet.title, rows: sheet.rows.length, columns: sheet.columns.length, ...(sheet.workbook?.hidden ? { hidden: true } : {}) })), report };
  },
  async wh_table_export_xlsx(args: ToolArgs) {
    const { table: shown, rows, target } = await read(args), project = target.eraId ? await getEraProject(target) : await db.projects.get(target.projectId);
    // A live view has no stored rows: export the projected rows it shows.
    const table = { ...shown, rows };
    const tabs = args.wholeWorkbook === false ? [table] : workbookTabs(project?.dataTables ?? [], table).map(item => item.id === table.id ? table : item);
    const exported = await exportXlsxReport(tabs), bytes = new Uint8Array(await exported.blob.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { fileName: `${(table.workbook?.name ?? table.title).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'libro'}.xlsx`, tabs: tabs.map(item => item.title), bytes: bytes.length, warnings: exported.warnings, base64: btoa(binary) };
  },
  async wh_table_workbook(args: ToolArgs) {
    const { table, target } = await read(args), project = target.eraId ? await getEraProject(target) : await db.projects.get(target.projectId), tables = project?.dataTables ?? [];
    if (table.mode !== 'sheet' || table.codexType || table.codexAllTypes) throw Error('workbook_sheets_only');
    const action = optString(args, 'action') ?? 'list', tabs = workbookTabs(tables, table), nextOrder = Math.max(...tabs.map(item => item.workbook?.order ?? 0)) + 1;
    const ensure = async () => { if (table.workbook) return table.workbook; const workbook = { id: crypto.randomUUID(), name: optString(args, 'workbookName') ?? table.title, order: 0 }; await changeTable(target.projectId, table.id, current => { current.workbook = workbook; }, target.eraId); return workbook; };
    const list = async () => { const fresh = target.eraId ? await getEraProject(target) : await db.projects.get(target.projectId), current = (fresh?.dataTables ?? []).find(item => item.id === table.id) ?? table; return { workbook: current.workbook ? { id: current.workbook.id, name: current.workbook.name } : null, tabs: workbookTabs(fresh?.dataTables ?? [], current).map(item => ({ tableId: item.id, title: item.title, order: item.workbook?.order ?? 0, ...(item.workbook?.color ? { color: item.workbook.color } : {}), ...(item.workbook?.hidden ? { hidden: true } : {}) })) }; };
    if (action === 'list') return list();
    if (action === 'add' || action === 'duplicate') { const workbook = await ensure(); const sheet = action === 'add' ? blankSheet(optString(args, 'title') ?? `Hoja ${tabs.length + 1}`, { id: workbook.id, name: workbook.name, order: table.workbook ? nextOrder : 1 }) : duplicateSheet({ ...table, workbook }, optString(args, 'title') ?? `${table.title} (copia)`, table.workbook ? nextOrder : 1); await addTable(target.projectId, sheet, target.eraId); return { created: sheet.id, ...(await list()) }; }
    if (action === 'rename') { const title = requireString(args, 'title').trim().slice(0, 200); await changeTable(target.projectId, table.id, current => { current.title = title; }, target.eraId); return list(); }
    if (action === 'colour') { const color = optString(args, 'color') ?? ''; if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw Error('workbook_colour_invalid'); const workbook = await ensure(); await changeTable(target.projectId, table.id, current => { current.workbook = { ...(current.workbook ?? workbook) }; if (color) current.workbook.color = color.toLowerCase(); else delete current.workbook.color; }, target.eraId); return list(); }
    if (action === 'hide' || action === 'show') { if (!table.workbook) throw Error('workbook_missing'); if (action === 'hide' && tabs.filter(item => !item.workbook?.hidden && item.id !== table.id).length < 1) throw Error('workbook_needs_visible_tab'); await changeTable(target.projectId, table.id, current => { current.workbook = { ...current.workbook!, hidden: action === 'hide' }; }, target.eraId); return list(); }
    if (action === 'move') { if (!table.workbook) throw Error('workbook_missing'); const to = Math.max(0, Math.min(tabs.length - 1, Math.round(Number(args.position ?? 0)))); const order = tabs.filter(item => item.id !== table.id); order.splice(to, 0, table); for (const [index, item] of order.entries()) if (item.workbook!.order !== index) await changeTable(target.projectId, item.id, current => { current.workbook = { ...current.workbook!, order: index }; }, target.eraId); return list(); }
    if (action === 'remove') { if (tabs.length < 2) throw Error('workbook_needs_a_tab'); if (tabs.filter(item => item.id !== table.id && !item.workbook?.hidden).length < 1) throw Error('workbook_needs_visible_tab'); await deleteTable(target.projectId, table.id, target.eraId); const other = tabs.find(item => item.id !== table.id)!; const fresh = target.eraId ? await getEraProject(target) : await db.projects.get(target.projectId); return { removed: table.id, tabs: workbookTabs(fresh?.dataTables ?? [], other).map(item => ({ tableId: item.id, title: item.title })) }; }
    throw Error('workbook_action_invalid');
  },
};
