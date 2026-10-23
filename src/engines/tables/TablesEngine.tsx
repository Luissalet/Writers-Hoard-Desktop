import { useEraNavigate } from '@/services/worldEras/navigation';
import { readEraRow, mutateEraRows, readWorldDocument } from '@/services/worldEras/store';
import type { EraRow } from '@/services/worldEras/types';
import { bindEraOperation, useWorldEraScope, useEraProject, useEraRows } from '@/services/worldEras/hooks';
import {projectWorldTable,columnCalculation,displayTableFormula} from './projection';
import {createTypeTable,saveTableCalculation,removeTableColumn,updateTableColumn,type SaveTableCalculation} from './calculations';
import TableCalculationEditor from './TableCalculationEditor';
import { projectCodexEntry } from '@/engines/codex/properties';
import { useRef, useState } from 'react';
import { useDeepLinkParam } from '@/engines/_shared';
import { ArrowDownUp, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, ExternalLink, Filter, Plus, Settings2, Table2, Trash2, Upload, X } from 'lucide-react';
import { CONDITION_OPS, duplicateColumn, duplicateRow, filterRows, findMatches, insertRow, removeRows, sortRows, toggleSort, type TableCondition, type TableSort } from './tableEdits';
import CsvDialog from './CsvDialog';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { EngineComponentProps } from '@/engines/_types';
import type { CodexEntry, CodexEntryType } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import Modal from '@/components/common/Modal';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import { saveCodexDraft } from '@/engines/codex/operations';
import { createCodexEntry } from '@/db/operations';
import { cellKey, validateCell, type DataColumn, type DataRow, type WorldTable } from './types';
import { addColumn as addColumnScoped, addTable as addTableScoped, changeTable as changeTableScoped, deleteTable as deleteTableScoped, insertColumnAt as insertColumnAtScoped, saveCell as saveCellScoped } from './operations';
import { sheetValues } from './formulas';
import { tableCopy } from './copy';
import { useDebouncedField } from '@/engines/_shared/useDebouncedField';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
const button = `${control} inline-flex items-center justify-center gap-2 hover:bg-elevated disabled:cursor-not-allowed`;
const codexTypes: CodexEntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];
const kinds = ['text', 'number', 'reference', 'checkbox'] as const;

export default function TablesEngine({ projectId }: EngineComponentProps) {
  const { locale, t } = useTranslation(); const copy = tableCopy[locale]; const navigate = useEraNavigate();
  const scope = useWorldEraScope(projectId);
  const [csvInput,setCsvInput]=useState<{bytes:Uint8Array;title:string}>(),[csvExport,setCsvExport]=useState(false);
  const addColumn = bindEraOperation(addColumnScoped, scope.eraId, 3);
  const addTable = bindEraOperation(addTableScoped, scope.eraId, 2);
  const changeTable = bindEraOperation(changeTableScoped, scope.eraId, 3);
  const deleteTable = bindEraOperation(deleteTableScoped, scope.eraId, 2);
  const saveCell = bindEraOperation(saveCellScoped, scope.eraId, 6);
  const insertColumnAt = bindEraOperation(insertColumnAtScoped, scope.eraId, 4);
  const project = useEraProject(projectId);
  const entries = useEraRows<import('@/types').CodexEntry>('codexEntries', projectId);
  const [selectedId, setSelectedId] = useState(''); const [query, setQuery] = useState('');
  const [group, setGroup] = useState(''); const [sorts, setSorts] = useState<TableSort[]>([]); const setSort = (next: TableSort | null) => { setSorts(next ? [next] : []); if (!next) { setConditions([]); setSelectedRows([]); } };
  const [conditions, setConditions] = useState<TableCondition[]>([]); const [matchAt, setMatchAt] = useState(0); const [selectedRows, setSelectedRows] = useState<string[]>([]); const [insertAt, setInsertAt] = useState<number | null>(null);
  const [creating, setCreating] = useState(false); const [name, setName] = useState(''); const [mode, setMode] = useState<'table' | 'sheet' | 'live'>('table'); const [sourceType, setSourceType] = useState<CodexEntryType>('character'); const [sourceTemplateId,setSourceTemplateId]=useState(''); const [allSources, setAllSources] = useState(false);
  const [columnDraft, setColumnDraft] = useState<DataColumn | null>(null); const [addingColumn, setAddingColumn] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ message: string; work: () => Promise<void> } | null>(null);
  const [entryDraft, setEntryDraft] = useState<CodexEntry | null>(null);
  const importRef = useRef<HTMLInputElement>(null),formulaRef=useRef<HTMLInputElement>(null);
  const [columnVersion,setColumnVersion]=useState(''),[columnTemplateRevision,setColumnTemplateRevision]=useState<number>();
  const [formulaDraft,setFormulaDraft]=useState<SaveTableCalculation|null>(null);
  const tables = project?.dataTables ?? [];
  const deepLink=useDeepLinkParam('entity'); const [appliedLink,setAppliedLink]=useState<string|null>(null);
  if(deepLink&&deepLink!==appliedLink&&tables.some(table=>table.id===deepLink)){setSelectedId(deepLink);setAppliedLink(deepLink);}
  const storedTable = tables.find(item => item.id === selectedId) ?? tables[0];
  const projected=storedTable?projectWorldTable(storedTable,entries,project?.codexTemplates??[]):undefined;
  const table=storedTable?{...storedTable,columns:projected!.columns}:undefined;
  const run = async (work: () => Promise<void>, done?: () => void) => { if (busy) return; setBusy(true); setError(''); try { await work(); done?.(); } catch (reason) { setError(`${copy.error} ${reason instanceof Error?reason.message:''}`); } finally { setBusy(false); } };
  const change = (update: (table: WorldTable) => void) => { if (table) void run(() => changeTable(projectId, table.id, update)); };
  const projectedEntries = new Map(table?.codexType || table?.codexAllTypes ? entries.filter(entry => table.codexAllTypes || entry.type === table.codexType).map(entry => [entry.id, projectCodexEntry(entry, project?.codexTemplates ?? [])]) : []);
  // A live view of Codex cards: of one type, or of every type (read here, edited on the card).
  const live = Boolean(table?.codexType || table?.codexAllTypes), allTypes = Boolean(table?.codexAllTypes);
  const rows:DataRow[]=projected?.rows??[];
  const values = table?.mode === 'sheet' ? sheetValues(table) : null;
  const rowValue = (row: DataRow, column: DataColumn): string => {
    if (!table || !values) return row.cells[column.id] ?? '';
    return String(values.get(cellKey(table.columns.indexOf(column), table.rows.findIndex(item => item.id === row.id))) ?? '');
  };
  const displayValue=(row:DataRow,column:DataColumn)=>column.field==='__type'?t(`codex.types.${rowValue(row,column)}`):table?.mode==='sheet'?rowValue(row,column):projected?.displayRows.find(item=>item.id===row.id)?.cells[column.id]??rowValue(row,column);
  const beginCalculation=async(column?:DataColumn)=>{if(!table)return;await run(async()=>{const read=await readWorldDocument(scope,'tables',table.id);if(!read)throw Error('table_missing');const calc=column?columnCalculation(table,column,project?.codexTemplates??[]):undefined;setFormulaDraft({tableId:table.id,columnId:column?.id,name:column?.name??'',formula:calc?displayTableFormula(calc,table.columns):'=',resultType:calc?.resultType??'decimal',expectedVersion:read.version,expectedTemplateRevision:project?.codexTemplates?.find(item=>item.id===table.codexTemplateId)?.revision});});};
  const insertToken=(token:string)=>{const input=formulaRef.current,start=input?.selectionStart??formulaDraft?.formula.length??0,end=input?.selectionEnd??start;setFormulaDraft(draft=>draft?{...draft,formula:draft.formula.slice(0,start)+token+draft.formula.slice(end)}:draft);requestAnimationFrame(()=>{input?.focus();input?.setSelectionRange(start+token.length,start+token.length);});};
  const visible = rows.filter(row => !query.trim() || table?.columns.some(column => {
    const value = rowValue(row, column); return [value,displayValue(row,column), column.kind === 'reference' ? entries.find(entry => entry.id === value)?.title ?? '' : ''].some(text => text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  }));
  // Conditions narrow the rows; sorts order them column by column; the grouping comes first and keeps that order inside each group.
  const columnById = (id: string) => table?.columns.find(column => column.id === id);
  const shownRows = sortRows(filterRows(visible, conditions, (row, id) => { const column = columnById(id); return column ? displayValue(row, column) : undefined; }), sorts, (row, id) => { const column = columnById(id); return column ? rowValue(row, column) : ''; }, id => columnById(id)?.kind === 'number');
  visible.length = 0; visible.push(...shownRows);
  { const groupColumn = columnById(group); if (groupColumn) visible.sort((a, b) => rowValue(a, groupColumn).localeCompare(rowValue(b, groupColumn), undefined, { numeric: true })); }
  // Find: every cell holding the search text, stepped through with next / previous.
  const matches = table ? findMatches(visible, table.columns, query, displayValue) : [];
  const currentMatch = matches.length ? matches[Math.min(matchAt, matches.length - 1)] : undefined;
  const stepMatch = (by: number) => { if (!matches.length) return; const next = (Math.min(matchAt, matches.length - 1) + by + matches.length) % matches.length; setMatchAt(next); const target = matches[next]; requestAnimationFrame(() => document.querySelector(`[data-cell="${CSS.escape(`${target.rowId}:${target.columnId}`)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })); };
  const saveValue = async (row: DataRow, column: DataColumn, value: string) => {
    if (!table || value === (row.cells[column.id] ?? '')) return;
      if (table.mode !== 'sheet' && !validateCell(column, value)) throw new Error(copy.invalid);
      if (column.kind === 'reference' && value && !entries.some(entry => entry.id === value)) throw new Error('Out-of-project reference');
      if (table.codexType) {
        if (['__proto__', 'constructor', 'prototype'].includes((column.field ?? column.name).toLowerCase())) throw new Error('Reserved field');
        const base = entries.find(entry => entry.id === row.id); if (!base) throw new Error('Entry not found');
        if (projectCodexEntry(base, project?.codexTemplates ?? []).properties[column.field ?? column.name]?.calculated) throw new Error('Calculated property is read-only');
        const draft = column.field === 'title' ? { ...base, title: value } : { ...base, fields: { ...base.fields, [column.field ?? column.name]: value } };
        if (!draft.title.trim()) throw new Error('Title required');
        await saveCodexDraft(base, draft, scope); notifyDataChanged({ source: 'other', table: 'codexEntries', projectId, entityId: row.id });
      } else await saveCell(projectId, table.id, row.id, column.id, value, row.cells[column.id] ?? '');
  };
  const createDocument = async () => {
    if(mode==='live'&&sourceTemplateId&&!allSources){await run(async()=>{const created=await createTypeTable(scope,name,sourceTemplateId);setSelectedId(created.id);},()=>{setCreating(false);setName('');setQuery('');setGroup('');setSort(null);});return;}
    const columns: DataColumn[] = mode === 'sheet' ? Array.from({ length: 6 }, (_, index) => ({ id: crypto.randomUUID(), name: cellKey(index, 0).replace(/\d+$/, ''), kind: 'text' })) : [{ id: crypto.randomUUID(), name: t('codex.field.name'), kind: 'text', field: 'title' }];
    const everyType = mode === 'live' && allSources;
    const document: WorldTable = { id: crypto.randomUUID(), title: name.trim(), mode: mode === 'sheet' ? 'sheet' : 'table', codexType: mode === 'live' && !everyType ? sourceType : undefined, ...(everyType ? { codexAllTypes: true } : {}), columns: everyType ? [...columns, { id: crypto.randomUUID(), name: copy.typeColumn, kind: 'text', field: '__type' }] : columns, rows: mode === 'sheet' ? Array.from({ length: 20 }, () => ({ id: crypto.randomUUID(), cells: {} })) : [] };
    await run(() => addTable(projectId, document), () => { setSelectedId(document.id); setCreating(false); setName(''); setQuery(''); setGroup(''); setSort(null); });
  };
  const requestDelete = (message: string, work: () => Promise<void>) => setConfirmation({ message, work });
  if (!project) return <div aria-busy="true" className="p-5 text-text-muted">{copy.title}</div>;
  return <section className="flex h-full min-h-0 flex-col bg-deep" aria-label={copy.title}>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div><h2 className="flex items-center gap-2 font-display text-2xl text-text-primary"><Table2 size={24} />{copy.title}</h2><p className="mt-2 max-w-prose text-sm text-text-muted">{copy.intro}</p></div><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => setCreating(!creating)}><Plus size={16} />{copy.newTable}</button><button className={button} disabled={busy} onClick={() => importRef.current?.click()}><Upload size={16} />{copy.import}</button><input ref={importRef} className="hidden" type="file" accept=".csv,text/csv" aria-label={copy.import} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void run(async () => { if (file.size > 8_000_000) throw new Error('File too large'); setCsvInput({bytes:new Uint8Array(await file.arrayBuffer()),title:file.name.replace(/\.csv$/i, '')}); }); }} /></div></header>
    {csvInput&&<CsvDialog locale={locale} input={csvInput} onClose={()=>setCsvInput(undefined)} onImport={async imported=>{await addTable(projectId,imported);setSelectedId(imported.id);}}/>}
    {csvExport&&table&&<CsvDialog locale={locale} output={{table,rows,value:displayValue}} onClose={()=>setCsvExport(false)}/>}
    {error && <p role="alert" className="p-4 text-sm text-danger">{error}</p>}
    {creating && <form className="flex flex-wrap items-end gap-3 border-b border-border p-4" onSubmit={event => { event.preventDefault(); void createDocument(); }}><label className="flex flex-col gap-1 text-sm text-text-primary">{copy.name}<input required maxLength={200} autoFocus className={control} value={name} onChange={event => setName(event.target.value)} /></label><select aria-label={copy.newTable} className={control} value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="table">{copy.table}</option><option value="sheet">{copy.sheet}</option><option value="live">{copy.live}</option></select>{mode === 'live' && <select className={control} aria-label={copy.live} data-testid="table-live-source" value={allSources?'__all':sourceTemplateId?`template:${sourceTemplateId}`:sourceType} onChange={event => {if(event.target.value==='__all'){setAllSources(true);setSourceTemplateId('');}else if(event.target.value.startsWith('template:')){setAllSources(false);setSourceTemplateId(event.target.value.slice(9));}else{setAllSources(false);setSourceTemplateId('');setSourceType(event.target.value as CodexEntryType);}}}><option value="__all">{copy.allTypes}</option><optgroup label={locale==='es'?'Tipos del Códice':'Codex types'}>{project.codexTemplates?.map(template=><option key={template.id} value={`template:${template.id}`}>{template.name}</option>)}</optgroup><optgroup label={locale==='es'?'Categorías existentes':'Existing categories'}>{codexTypes.map(type => <option key={type} value={type}>{t(`codex.types.${type}`)}</option>)}</optgroup></select>}<button disabled={busy} className={`${button} bg-accent-gold text-deep`} type="submit">{copy.create}</button><button className={button} type="button" onClick={() => setCreating(false)}>{copy.cancel}</button></form>}
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav className="shrink-0 overflow-auto border-b border-border p-3 md:w-52 md:border-r md:border-b-0" aria-label={copy.title}>{tables.length === 0 && <p className="p-2 text-sm text-text-muted">{copy.empty}</p>}{tables.map(item => <button key={item.id} disabled={busy || Boolean(columnDraft)||Boolean(formulaDraft)} aria-current={item.id === table?.id ? 'page' : undefined} className={`mb-1 block w-full break-words rounded-lg p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent-gold ${item.id === table?.id ? 'bg-elevated text-accent-gold' : 'text-text-primary hover:bg-surface'}`} onClick={() => { setSelectedId(item.id); setQuery(''); setGroup(''); setSort(null); }}>{item.title}<span className="mt-1 block text-xs text-text-muted">{item.codexType ? copy.live : item.mode === 'sheet' ? copy.sheet : copy.table}</span></button>)}</nav>
      {table && <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 p-4"><h3 className="mr-auto min-w-0 break-words font-display text-xl text-text-primary">{table.title}{table.codexTemplateId&&<span className="mt-1 block font-sans text-xs font-normal text-text-muted">{locale==='es'?'Tipo del Códice':'Codex type'} · {project.codexTemplates?.find(item=>item.id===table.codexTemplateId)?.name??table.codexTemplateId}</span>}</h3><button className={button} disabled={busy || allTypes} onClick={() => { setInsertAt(null); setAddingColumn(true); setColumnDraft({ id: crypto.randomUUID(), name: '', kind: 'text' }); }}><Plus size={15} />{copy.column}</button>{table.mode!=='sheet'&&<button className={button} disabled={busy||!!formulaDraft} onClick={()=>void beginCalculation()}>{locale==='es'?'Añadir cálculo':'Add calculation'}</button>}<button className={button} onClick={() => setCsvExport(true)}><Download size={15} />{copy.export}</button><button className={button} disabled={busy} aria-label={`${copy.remove} ${table.title}`} onClick={() => requestDelete(copy.removeDocument, () => deleteTable(projectId, table.id))}><Trash2 size={15} /></button></div>
        {formulaDraft&&<TableCalculationEditor draft={formulaDraft} columns={table.columns} inputRef={formulaRef} sharedType={Boolean(table.codexTemplateId)} busy={busy} locale={locale} onChange={setFormulaDraft} onToken={insertToken} onCancel={()=>setFormulaDraft(null)} onSave={()=>void run(async()=>{await saveTableCalculation(scope,formulaDraft);},()=>setFormulaDraft(null))}/>}
        {columnDraft && <form className="flex flex-wrap items-end gap-3 border-y border-border p-4" onSubmit={event => { event.preventDefault(); void run(async () => {
          if (addingColumn && insertAt !== null) await insertColumnAt(projectId, table.id, { ...columnDraft, field: table.codexType ? columnDraft.field?.trim() || columnDraft.name.trim() : undefined }, insertAt);
          else if (addingColumn) await addColumn(projectId, table.id, { ...columnDraft, field: table.codexType ? columnDraft.field?.trim() || columnDraft.name.trim() : undefined });
          else await updateTableColumn(scope,table.id,columnDraft,columnVersion,columnTemplateRevision);
        }, () => setColumnDraft(null)); }}>
          <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.columnName}<input className={control} required value={columnDraft.name} onChange={event => setColumnDraft({ ...columnDraft, name: event.target.value })} /></label>
          {addingColumn && table.mode !== 'sheet' && <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.columnKind}<select className={control} value={columnDraft.kind} onChange={event => setColumnDraft({ ...columnDraft, kind: event.target.value as DataColumn['kind'] })}>{kinds.map(kind => <option key={kind} value={kind}>{copy[kind]}</option>)}</select></label>}
          {addingColumn && table.codexType && <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.field}<input className={control} value={columnDraft.field ?? ''} onChange={event => setColumnDraft({ ...columnDraft, field: event.target.value })} maxLength={200} /></label>}
          {!addingColumn && <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.width}<input type="number" min={100} max={600} className={`${control} w-28`} value={columnDraft.width ?? 180} onChange={event => setColumnDraft({ ...columnDraft, width: Number(event.target.value) })} /></label>}
          <button disabled={busy} type="submit" className={button}>{copy.save}</button><button type="button" className={button} onClick={() => setColumnDraft(null)}>{copy.cancel}</button>
        </form>}
        <div className="flex flex-wrap items-center gap-3 px-4 pb-3"><input className={`${control} min-w-40 flex-1`} aria-label={copy.search} placeholder={copy.search} value={query} onChange={event => { setQuery(event.target.value); setMatchAt(0); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); stepMatch(event.shiftKey ? -1 : 1); } }} />
          {query.trim() && <span className="flex items-center gap-1 text-xs tabular-nums text-text-muted" data-testid="table-find"><button type="button" className={button} aria-label={copy.findPrevious} disabled={!matches.length} onClick={() => stepMatch(-1)}><ChevronUp size={14} /></button><span data-testid="table-find-count">{matches.length ? `${Math.min(matchAt, matches.length - 1) + 1}/${matches.length}` : '0/0'}</span><button type="button" className={button} aria-label={copy.findNext} disabled={!matches.length} onClick={() => stepMatch(1)}><ChevronDown size={14} /></button></span>}
          <button type="button" data-testid="table-filter-add" className={button} onClick={() => setConditions([...conditions, { columnId: table.columns[0].id, op: 'contains', value: '' }])}><Filter size={14} />{copy.addFilter}</button><label className="flex items-center gap-2 text-sm text-text-muted">{copy.group}<select className={control} value={group} onChange={event => setGroup(event.target.value)}><option value="">{copy.none}</option>{table.columns.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><span className="text-sm tabular-nums text-text-muted">{visible.length} {copy.count}</span></div>
        {conditions.length > 0 && <div className="space-y-2 px-4 pb-3" data-testid="table-filters">{conditions.map((condition, at) => <div key={at} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-text-muted">{at === 0 ? copy.where : copy.and}</span>
          <select data-testid={`table-filter-column-${at}`} className={control} value={condition.columnId} onChange={event => setConditions(conditions.map((item, i) => i === at ? { ...item, columnId: event.target.value } : item))}>{table.columns.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}</select>
          <select data-testid={`table-filter-op-${at}`} className={control} value={condition.op} onChange={event => setConditions(conditions.map((item, i) => i === at ? { ...item, op: event.target.value as TableCondition['op'] } : item))}>{CONDITION_OPS.map(op => <option key={op} value={op}>{copy.ops[op]}</option>)}</select>
          {!['empty', 'notEmpty', 'checked', 'unchecked'].includes(condition.op) && <input data-testid={`table-filter-value-${at}`} className={control} value={condition.value ?? ''} onChange={event => setConditions(conditions.map((item, i) => i === at ? { ...item, value: event.target.value } : item))} />}
          <button type="button" className={button} aria-label={copy.removeFilter} onClick={() => setConditions(conditions.filter((_, i) => i !== at))}><X size={14} /></button>
        </div>)}</div>}
        {selectedRows.length > 0 && !live && <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm" data-testid="table-selection"><span className="text-text-muted">{copy.selected.replace('{count}', String(selectedRows.length))}</span>
          <button type="button" data-testid="table-selection-duplicate" className={button} disabled={busy} onClick={() => change(current => { for (const id of selectedRows) duplicateRow(current, id); })}><Copy size={14} />{copy.duplicateRows}</button>
          <button type="button" data-testid="table-selection-delete" className={`${button} text-danger`} disabled={busy} onClick={() => requestDelete(copy.removeRows.replace('{count}', String(selectedRows.length)), async () => { const ids = [...selectedRows]; await changeTable(projectId, table.id, current => { removeRows(current, ids); }); setSelectedRows([]); })}><Trash2 size={14} />{copy.deleteRows}</button>
          <button type="button" className={button} onClick={() => setSelectedRows([])}>{copy.clearSelection}</button></div>}
        {table.mode === 'sheet' && <p className="px-4 pb-3 text-xs leading-relaxed text-text-muted">{copy.formulaHelp}</p>}
        <div className="min-h-0 flex-1 overflow-auto border-y border-border">
          <table className="w-max min-w-full border-collapse text-sm text-text-primary"><thead className="sticky top-0 z-10 bg-surface"><tr><th className="border-r border-b border-border px-3 py-2 text-text-muted">{!live && <input type="checkbox" data-testid="table-select-all" aria-label={copy.selectAll} className="mr-2 accent-accent-gold" checked={visible.length > 0 && visible.every(row => selectedRows.includes(row.id))} onChange={event => setSelectedRows(event.target.checked ? visible.map(row => row.id) : [])} />}#</th>{table.columns.map((column, index) => <th key={column.id} style={{ width: column.width ?? 180, minWidth: column.width ?? 180 }} className="border-r border-b border-border p-2 text-left font-medium" aria-sort={sorts[0]?.id === column.id ? sorts[0].descending ? 'descending' : 'ascending' : 'none'}>
            <div className="flex items-center justify-between gap-1"><button className="flex min-h-9 items-center gap-2 text-left hover:text-accent-gold" onClick={event => formulaDraft?insertToken(`@[${column.name}]`):setSorts(toggleSort(sorts, column.id, event.shiftKey))} title={copy.sortMore}>{table.mode === 'sheet' ? `${cellKey(index, 0).replace(/\d+$/, '')} · ` : ''}{column.name}<ArrowDownUp size={12} />{sorts.length > 1 && sorts.some(item => item.id === column.id) && <span data-testid={`table-sort-rank-${column.name}`} className="rounded bg-elevated px-1 text-[10px] text-accent-gold">{sorts.findIndex(item => item.id === column.id) + 1}{sorts.find(item => item.id === column.id)!.descending ? '↓' : '↑'}</span>}</button>
              <details className="relative"><summary aria-label={`${copy.columnActions} ${column.name}`} className="flex min-h-9 min-w-9 cursor-pointer list-none items-center justify-center rounded-lg text-text-muted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold"><Settings2 size={15} /></summary>
                <div className="absolute right-0 z-20 mt-1 w-52 space-y-1 rounded-lg border border-border bg-surface p-2 shadow-lg" onClick={event => { if ((event.target as Element).closest('button')) event.currentTarget.parentElement?.removeAttribute('open'); }}>
                  <button aria-label={`${copy.editColumn} ${column.name}`} className={`${button} w-full justify-start`} disabled={busy} onClick={() => {if(columnCalculation(table,column,project.codexTemplates??[]))void beginCalculation(column);else void run(async()=>{const read=await readWorldDocument(scope,'tables',table.id);if(!read)throw Error('table_missing');setColumnVersion(read.version);setColumnTemplateRevision(project.codexTemplates?.find(item=>item.id===table.codexTemplateId)?.revision);setAddingColumn(false);setColumnDraft({...column});});}}><Settings2 size={15} />{copy.editColumn}</button>
                  <button aria-label={`${copy.left} ${column.name}`} disabled={busy || index === 0} className={`${button} w-full justify-start`} onClick={() => change(current => { const from = current.columns.findIndex(item => item.id === column.id); if (from > 0) [current.columns[from - 1], current.columns[from]] = [current.columns[from], current.columns[from - 1]]; })}><ChevronLeft size={15} />{copy.left}</button>
                  <button aria-label={`${copy.right} ${column.name}`} disabled={busy || index === table.columns.length - 1} className={`${button} w-full justify-start`} onClick={() => change(current => { const from = current.columns.findIndex(item => item.id === column.id); if (from >= 0 && from < current.columns.length - 1) [current.columns[from + 1], current.columns[from]] = [current.columns[from], current.columns[from + 1]]; })}><ChevronRight size={15} />{copy.right}</button>
                  <button aria-label={`${copy.insertLeft} ${column.name}`} disabled={busy} className={`${button} w-full justify-start`} onClick={() => { setInsertAt(index); setAddingColumn(true); setColumnDraft({ id: crypto.randomUUID(), name: '', kind: 'text' }); }}><Plus size={15} />{copy.insertLeft}</button>
                  <button aria-label={`${copy.insertRight} ${column.name}`} disabled={busy} className={`${button} w-full justify-start`} onClick={() => { setInsertAt(index + 1); setAddingColumn(true); setColumnDraft({ id: crypto.randomUUID(), name: '', kind: 'text' }); }}><Plus size={15} />{copy.insertRight}</button>
                  {!live && !column.calculation && !column.propertyId && <button aria-label={`${copy.duplicateColumn} ${column.name}`} disabled={busy} className={`${button} w-full justify-start`} onClick={() => change(current => { duplicateColumn(current, column.id, copy.copyLabel); })}><Copy size={15} />{copy.duplicateColumn}</button>}
                  <button disabled={busy || table.columns.length <= 1} className={`${button} w-full justify-start text-danger`} aria-label={`${copy.remove} ${column.name}`} onClick={() => requestDelete(column.propertyId?(locale==='es'?'¿Ocultar esta propiedad en esta tabla? La propiedad compartida y sus valores siguen disponibles en las fichas.':'Hide this property in this table? The shared property and its card values remain available.'):copy.removeColumn, async()=>{const current=await readWorldDocument(scope,'tables',table.id);if(!current)throw Error('table_missing');await removeTableColumn(scope,table.id,column.id,current.version);})}><Trash2 size={15} />{copy.remove}</button>
                </div>
              </details>
            </div>
          </th>)}<th className="border-b border-border px-2" /></tr></thead>
            <tbody>{visible.map((row, index) => {
              const savedIndex = live ? rows.indexOf(row) : table.rows.findIndex(item => item.id === row.id);
              const groupColumn = table.columns.find(column => column.id === group); const groupValue = groupColumn ? displayValue(row, groupColumn) : '';
              const showGroup = groupColumn && (index === 0 || displayValue(visible[index - 1], groupColumn) !== groupValue);
              return <TableRow key={row.id} row={row} savedIndex={savedIndex} columns={table.columns} calculatedColumnIds={allTypes ? table.columns.map(column => column.id) : projected?.calculatedColumnIds??[]} display={displayValue} calculatedFields={live ? Object.entries(projectedEntries.get(row.id)?.properties ?? {}).filter(([, value]) => value.calculated).map(([key]) => key) : []} entries={entries} sheet={table.mode === 'sheet'} disabled={busy || allTypes} copy={copy} showGroup={Boolean(showGroup)} groupValue={groupValue} value={rowValue} save={saveValue} openEntry={id => navigate(`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(id)}`)} selected={selectedRows.includes(row.id)} onSelect={live ? undefined : checked => setSelectedRows(checked ? [...selectedRows, row.id] : selectedRows.filter(id => id !== row.id))} matchColumnId={currentMatch?.rowId === row.id ? currentMatch.columnId : undefined} onDuplicate={live ? undefined : () => change(current => { duplicateRow(current, row.id); })} onInsertBelow={live ? undefined : () => change(current => { const at = current.rows.findIndex(item => item.id === row.id); insertRow(current, at + 1); })} action={live ? () => setEntryDraft(entries.find(entry => entry.id === row.id)!) : () => requestDelete(copy.removeRow, () => changeTable(projectId, table.id, current => { current.rows = current.rows.filter(item => item.id !== row.id); }))} live={live} />;
            })}</tbody>
          </table>
          {visible.length === 0 && <p className="p-5 text-sm text-text-muted">{copy.noRows}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 p-4">{allTypes ? <p className="text-xs text-text-muted" data-testid="table-all-types-note">{copy.allTypesNote}</p> : <button className={button} disabled={busy || rows.length >= 20000} onClick={() => {
          if (table.codexType) { const now = Date.now(); setEntryDraft({ id: crypto.randomUUID(), projectId, type: table.codexType, templateId:table.codexTemplateId, title: '', fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now }); }
          else change(current => { current.rows.push({ id: crypto.randomUUID(), cells: {} }); });
        }}><Plus size={16} />{table.codexType ? copy.newCard : copy.addRow}</button>}<p className="text-xs text-text-muted">{copy.cellHint}</p></footer>
      </div>}
    </div>
    <ConfirmDialog open={Boolean(confirmation)} destructive message={confirmation?.message ?? ''} onCancel={() => setConfirmation(null)} onConfirm={async () => { if (confirmation) await run(confirmation.work, () => setConfirmation(null)); }} />
    <Modal open={Boolean(entryDraft)} title={copy.editCard} onClose={() => setEntryDraft(null)} wide>{entryDraft && <CodexEntryForm key={entryDraft.id} projectId={projectId} entry={entryDraft} onCancel={() => setEntryDraft(null)} onSave={async (draft, base) => { const existing = await readEraRow<CodexEntry>(scope, 'codexEntries', draft.id); if (existing && base) await saveCodexDraft(base, draft, scope); else if (scope.eraId) await mutateEraRows(scope, [{ table: 'codexEntries', id: draft.id, row: draft as unknown as EraRow }]); else await createCodexEntry(draft); notifyDataChanged({ source: 'other', table: 'codexEntries', projectId, entityId: draft.id }); setEntryDraft(null); }} />}</Modal>
  </section>;
}

function TableRow({ row, savedIndex, columns, calculatedColumnIds,display,calculatedFields, entries, sheet, disabled, copy, showGroup, groupValue, value, save, openEntry, action, live, selected, onSelect, matchColumnId, onDuplicate, onInsertBelow }: {
  row: DataRow; savedIndex: number; columns: DataColumn[];calculatedColumnIds:string[];display:(row:DataRow,column:DataColumn)=>string; calculatedFields: string[]; entries: CodexEntry[]; sheet: boolean; disabled: boolean; copy: typeof tableCopy.en; showGroup: boolean; groupValue: string;
  value: (row: DataRow, column: DataColumn) => string; save: (row: DataRow, column: DataColumn, value: string) => Promise<void>; openEntry: (id: string) => void; action: () => void; live: boolean;
  selected?: boolean; onSelect?: (checked: boolean) => void; matchColumnId?: string; onDuplicate?: () => void; onInsertBelow?: () => void;
}) {
  return <>{showGroup && <tr><th colSpan={columns.length + 2} className="bg-elevated px-4 py-2 text-left font-medium">{groupValue || copy.none}</th></tr>}<tr className={selected ? 'bg-accent-gold/10' : 'hover:bg-surface/50'} data-row-id={row.id}><th className="border-r border-b border-border px-3 text-xs font-normal tabular-nums text-text-muted">{onSelect && <input type="checkbox" data-testid={`table-select-row-${savedIndex + 1}`} aria-label={`${copy.selectRow} ${savedIndex + 1}`} className="mr-2 accent-accent-gold" checked={!!selected} onChange={event => onSelect(event.target.checked)} />}{savedIndex + 1}</th>{columns.map((column, columnIndex) => {
    const raw = row.cells[column.id] ?? ''; const computed = value(row, column); const label = `${cellKey(columnIndex, savedIndex)} ${column.name}`;
    return <td key={column.id} data-cell={`${row.id}:${column.id}`} data-match={matchColumnId === column.id ? 'current' : undefined} className="border-r border-b border-border p-0 align-top" style={{ maxWidth: column.width ?? 180, ...(matchColumnId === column.id ? { outline: '2px solid #c4973b', outlineOffset: -2 } : {}) }}>
      {calculatedColumnIds.includes(column.id)?<output className={`block min-h-11 break-words px-3 py-2 ${computed.startsWith('#')?'text-danger':'text-text-primary'}`} aria-label={label}>{display(row,column)||'—'}</output>:<TableCell raw={raw} label={label} column={column} entries={entries} sheet={sheet} disabled={disabled || calculatedFields.includes(column.field ?? column.name)} copy={copy} save={value => save(row, column, value)} openEntry={openEntry} />}
      {sheet && raw.startsWith('=') && <output className={`block px-3 pb-2 text-xs ${computed.startsWith('#') ? 'text-danger' : 'text-accent-gold'}`} aria-label={`${copy.value} ${label}`}>{computed}</output>}
    </td>;
  })}<td className="border-b border-border px-2 whitespace-nowrap">{onInsertBelow && <button className="rounded p-2 text-text-muted hover:bg-elevated" disabled={disabled} aria-label={`${copy.insertBelow} ${savedIndex + 1}`} title={copy.insertBelow} onClick={onInsertBelow}><Plus size={15} /></button>}{onDuplicate && <button className="rounded p-2 text-text-muted hover:bg-elevated" disabled={disabled} aria-label={`${copy.duplicateRow} ${savedIndex + 1}`} title={copy.duplicateRow} onClick={onDuplicate}><Copy size={15} /></button>}<button className="rounded p-2 text-text-muted hover:bg-elevated" disabled={disabled} aria-label={live ? copy.editCard : `${copy.remove} ${savedIndex + 1}`} onClick={action}>{live ? <Settings2 size={15} /> : <Trash2 size={15} />}</button></td></tr></>;
}

function TableCell({ raw, label, column, entries, sheet, disabled, copy, save, openEntry }: { raw: string; label: string; column: DataColumn; entries: CodexEntry[]; sheet: boolean; disabled: boolean; copy: typeof tableCopy.en; save: (value: string) => Promise<void>; openEntry: (id: string) => void }) {
  const field = useDebouncedField(raw, save, { delayMs: 750 });
  return <>
    {!sheet && column.kind === 'checkbox' ? <input className="m-3 accent-accent-gold" type="checkbox" aria-label={label} checked={field.value === 'true'} disabled={disabled} onChange={event => field.onChange(String(event.target.checked))} onBlur={field.onBlur} />
      : !sheet && column.kind === 'reference' ? <div className="flex items-center"><select className="min-w-0 flex-1 bg-transparent p-3 outline-accent-gold" aria-label={label} value={field.value} disabled={disabled} onChange={event => field.onChange(event.target.value)} onBlur={field.onBlur}><option value="">{copy.noLink}</option>{field.value && !entries.some(entry => entry.id === field.value) && <option value={field.value}>{copy.missingLink}</option>}{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select>{entries.some(entry => entry.id === field.value) && <button className="mr-2 rounded p-1 text-accent-gold" aria-label={copy.openCard} onClick={() => openEntry(field.value)}><ExternalLink size={14} /></button>}</div>
        : !sheet && column.kind === 'text' ? <textarea aria-label={label} title={`${copy.cellHint} Shift+Enter: ↵`} rows={Math.min(8, field.value.split('\n').length)} className="block min-h-11 w-full min-w-0 resize-y bg-transparent px-3 py-2 outline-accent-gold focus:bg-elevated" value={field.value} disabled={disabled} onChange={event => field.onChange(event.target.value)} onBlur={field.onBlur} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); field.onChange(raw); event.currentTarget.blur(); } }} />
          : <input aria-label={label} title={copy.cellHint} className="min-h-11 w-full min-w-0 bg-transparent px-3 py-2 outline-accent-gold focus:bg-elevated" value={field.value} disabled={disabled} onChange={event => field.onChange(event.target.value)} onBlur={field.onBlur} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { field.onChange(raw); event.currentTarget.blur(); } }} />}
    {field.error && <div role="alert" className="px-3 pb-2 text-xs text-danger"><p>{copy.error}</p><button className="mt-2 underline underline-offset-2" onClick={() => { void field.retry(); }}>{copy.retry}</button></div>}
  </>;
}
