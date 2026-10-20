import { useRef, useState } from 'react';
import { useDeepLinkParam } from '@/engines/_shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownUp, ChevronLeft, ChevronRight, Download, ExternalLink, Plus, Settings2, Table2, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { saveAs } from 'file-saver';
import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { EngineComponentProps } from '@/engines/_types';
import type { CodexEntry, CodexEntryType } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import Modal from '@/components/common/Modal';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import { saveCodexDraft } from '@/engines/codex/operations';
import { createCodexEntry } from '@/db/operations';
import { cellKey, tableCsv, validateCell, type DataColumn, type DataRow, type WorldTable } from './types';
import { addColumn, addTable, changeTable, deleteTable, importCsv, saveCell } from './operations';
import { sheetValues } from './formulas';
import { tableCopy } from './copy';
import { useDebouncedField } from '@/engines/_shared/useDebouncedField';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
const button = `${control} inline-flex items-center justify-center gap-2 hover:bg-elevated disabled:cursor-not-allowed`;
const codexTypes: CodexEntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];
const kinds = ['text', 'number', 'reference', 'checkbox'] as const;

export default function TablesEngine({ projectId }: EngineComponentProps) {
  const { locale, t } = useTranslation(); const copy = tableCopy[locale]; const navigate = useNavigate();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const entries = useLiveQuery(() => db.codexEntries.where('projectId').equals(projectId).toArray(), [projectId]) ?? [];
  const [selectedId, setSelectedId] = useState(''); const [query, setQuery] = useState('');
  const [group, setGroup] = useState(''); const [sort, setSort] = useState<{ id: string; descending: boolean } | null>(null);
  const [creating, setCreating] = useState(false); const [name, setName] = useState(''); const [mode, setMode] = useState<'table' | 'sheet' | 'live'>('table'); const [sourceType, setSourceType] = useState<CodexEntryType>('character');
  const [columnDraft, setColumnDraft] = useState<DataColumn | null>(null); const [addingColumn, setAddingColumn] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ message: string; work: () => Promise<void> } | null>(null);
  const [entryDraft, setEntryDraft] = useState<CodexEntry | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const tables = project?.dataTables ?? [];
  const deepLink=useDeepLinkParam('entity'); const [appliedLink,setAppliedLink]=useState<string|null>(null);
  if(deepLink&&deepLink!==appliedLink&&tables.some(table=>table.id===deepLink)){setSelectedId(deepLink);setAppliedLink(deepLink);}
  const table = tables.find(item => item.id === selectedId) ?? tables[0];
  const run = async (work: () => Promise<void>, done?: () => void) => { if (busy) return; setBusy(true); setError(''); try { await work(); done?.(); } catch { setError(copy.error); } finally { setBusy(false); } };
  const change = (update: (table: WorldTable) => void) => { if (table) void run(() => changeTable(projectId, table.id, update)); };
  const rows: DataRow[] = table?.codexType ? entries.filter(entry => entry.type === table.codexType).map(entry => ({ id: entry.id, cells: Object.fromEntries(table.columns.map(column => [column.id, column.field === 'title' ? entry.title : entry.fields[column.field ?? column.name] ?? ''])) })) : table?.rows ?? [];
  const values = table?.mode === 'sheet' ? sheetValues(table) : null;
  const rowValue = (row: DataRow, column: DataColumn): string => {
    if (!table || !values) return row.cells[column.id] ?? '';
    return String(values.get(cellKey(table.columns.indexOf(column), table.rows.findIndex(item => item.id === row.id))) ?? '');
  };
  const visible = rows.filter(row => !query.trim() || table?.columns.some(column => {
    const value = rowValue(row, column); return [value, column.kind === 'reference' ? entries.find(entry => entry.id === value)?.title ?? '' : ''].some(text => text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  }));
  const sorting = table?.columns.find(column => column.id === sort?.id);
  visible.sort((a, b) => {
    const groupColumn = table?.columns.find(column => column.id === group);
    const grouping = groupColumn ? rowValue(a, groupColumn).localeCompare(rowValue(b, groupColumn), undefined, { numeric: true }) : 0;
    if (grouping) return grouping;
    return sorting && sort ? rowValue(a, sorting).localeCompare(rowValue(b, sorting), undefined, { numeric: true }) * (sort.descending ? -1 : 1) : 0;
  });
  const saveValue = async (row: DataRow, column: DataColumn, value: string) => {
    if (!table || value === (row.cells[column.id] ?? '')) return;
      if (table.mode !== 'sheet' && !validateCell(column, value)) throw new Error(copy.invalid);
      if (column.kind === 'reference' && value && !entries.some(entry => entry.id === value)) throw new Error('Out-of-project reference');
      if (table.codexType) {
        if (['__proto__', 'constructor', 'prototype'].includes((column.field ?? column.name).toLowerCase())) throw new Error('Reserved field');
        const base = entries.find(entry => entry.id === row.id); if (!base) throw new Error('Entry not found');
        const draft = column.field === 'title' ? { ...base, title: value } : { ...base, fields: { ...base.fields, [column.field ?? column.name]: value } };
        if (!draft.title.trim()) throw new Error('Title required');
        await saveCodexDraft(base, draft); notifyDataChanged({ source: 'other', table: 'codexEntries', projectId, entityId: row.id });
      } else await saveCell(projectId, table.id, row.id, column.id, value, row.cells[column.id] ?? '');
  };
  const createDocument = async () => {
    const columns: DataColumn[] = mode === 'sheet' ? Array.from({ length: 6 }, (_, index) => ({ id: crypto.randomUUID(), name: cellKey(index, 0).replace(/\d+$/, ''), kind: 'text' })) : [{ id: crypto.randomUUID(), name: t('codex.field.name'), kind: 'text', field: 'title' }];
    const document: WorldTable = { id: crypto.randomUUID(), title: name.trim(), mode: mode === 'sheet' ? 'sheet' : 'table', codexType: mode === 'live' ? sourceType : undefined, columns, rows: mode === 'sheet' ? Array.from({ length: 20 }, () => ({ id: crypto.randomUUID(), cells: {} })) : [] };
    await run(() => addTable(projectId, document), () => { setSelectedId(document.id); setCreating(false); setName(''); setQuery(''); setGroup(''); setSort(null); });
  };
  const requestDelete = (message: string, work: () => Promise<void>) => setConfirmation({ message, work });
  if (!project) return <div aria-busy="true" className="p-5 text-text-muted">{copy.title}</div>;
  return <section className="flex h-full min-h-0 flex-col bg-deep" aria-label={copy.title}>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div><h2 className="flex items-center gap-2 font-display text-2xl text-text-primary"><Table2 size={24} />{copy.title}</h2><p className="mt-2 max-w-prose text-sm text-text-muted">{copy.intro}</p></div><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => setCreating(!creating)}><Plus size={16} />{copy.newTable}</button><button className={button} disabled={busy} onClick={() => importRef.current?.click()}><Upload size={16} />{copy.import}</button><input ref={importRef} className="hidden" type="file" accept=".csv,text/csv" aria-label={copy.import} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void run(async () => { if (file.size > 8_000_000) throw new Error('File too large'); const imported = importCsv(await file.text(), file.name.replace(/\.csv$/i, '')); await addTable(projectId, imported); setSelectedId(imported.id); }); }} /></div></header>
    {error && <p role="alert" className="p-4 text-sm text-danger">{error}</p>}
    {creating && <form className="flex flex-wrap items-end gap-3 border-b border-border p-4" onSubmit={event => { event.preventDefault(); void createDocument(); }}><label className="flex flex-col gap-1 text-sm text-text-primary">{copy.name}<input required maxLength={200} autoFocus className={control} value={name} onChange={event => setName(event.target.value)} /></label><select aria-label={copy.newTable} className={control} value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="table">{copy.table}</option><option value="sheet">{copy.sheet}</option><option value="live">{copy.live}</option></select>{mode === 'live' && <select className={control} aria-label={copy.live} value={sourceType} onChange={event => setSourceType(event.target.value as CodexEntryType)}>{codexTypes.map(type => <option key={type} value={type}>{t(`codex.types.${type}`)}</option>)}</select>}<button disabled={busy} className={`${button} bg-accent-gold text-deep`} type="submit">{copy.create}</button><button className={button} type="button" onClick={() => setCreating(false)}>{copy.cancel}</button></form>}
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav className="shrink-0 overflow-auto border-b border-border p-3 md:w-52 md:border-r md:border-b-0" aria-label={copy.title}>{tables.length === 0 && <p className="p-2 text-sm text-text-muted">{copy.empty}</p>}{tables.map(item => <button key={item.id} disabled={busy || Boolean(columnDraft)} aria-current={item.id === table?.id ? 'page' : undefined} className={`mb-1 block w-full break-words rounded-lg p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent-gold ${item.id === table?.id ? 'bg-elevated text-accent-gold' : 'text-text-primary hover:bg-surface'}`} onClick={() => { setSelectedId(item.id); setQuery(''); setGroup(''); setSort(null); }}>{item.title}<span className="mt-1 block text-xs text-text-muted">{item.codexType ? copy.live : item.mode === 'sheet' ? copy.sheet : copy.table}</span></button>)}</nav>
      {table && <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 p-4"><h3 className="mr-auto min-w-0 break-words font-display text-xl text-text-primary">{table.title}</h3><button className={button} disabled={busy} onClick={() => { setAddingColumn(true); setColumnDraft({ id: crypto.randomUUID(), name: '', kind: 'text' }); }}><Plus size={15} />{copy.column}</button><button className={button} onClick={() => saveAs(new Blob([tableCsv(table.columns, rows, rowValue)], { type: 'text/csv;charset=utf-8' }), `${table.title.replace(/[<>:"/\\|?*]/g, '_')}.csv`)}><Download size={15} />{copy.export}</button><button className={button} disabled={busy} aria-label={`${copy.remove} ${table.title}`} onClick={() => requestDelete(copy.removeDocument, () => deleteTable(projectId, table.id))}><Trash2 size={15} /></button></div>
        {columnDraft && <form className="flex flex-wrap items-end gap-3 border-y border-border p-4" onSubmit={event => { event.preventDefault(); void run(async () => {
          if (addingColumn) await addColumn(projectId, table.id, { ...columnDraft, field: table.codexType ? columnDraft.field?.trim() || columnDraft.name.trim() : undefined });
          else await changeTable(projectId, table.id, current => { const column = current.columns.find(item => item.id === columnDraft.id); if (!column) throw new Error('Missing column'); if (!columnDraft.name.trim() || current.columns.some(item => item.id !== column.id && item.name.toLowerCase() === columnDraft.name.trim().toLowerCase())) throw new Error('Duplicate column'); Object.assign(column, { name: columnDraft.name.trim(), width: Math.max(100, Math.min(600, columnDraft.width ?? 180)) }); });
        }, () => setColumnDraft(null)); }}>
          <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.columnName}<input className={control} required value={columnDraft.name} onChange={event => setColumnDraft({ ...columnDraft, name: event.target.value })} /></label>
          {addingColumn && table.mode !== 'sheet' && <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.columnKind}<select className={control} value={columnDraft.kind} onChange={event => setColumnDraft({ ...columnDraft, kind: event.target.value as DataColumn['kind'] })}>{kinds.map(kind => <option key={kind} value={kind}>{copy[kind]}</option>)}</select></label>}
          {addingColumn && table.codexType && <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.field}<input className={control} value={columnDraft.field ?? ''} onChange={event => setColumnDraft({ ...columnDraft, field: event.target.value })} maxLength={200} /></label>}
          {!addingColumn && <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.width}<input type="number" min={100} max={600} className={`${control} w-28`} value={columnDraft.width ?? 180} onChange={event => setColumnDraft({ ...columnDraft, width: Number(event.target.value) })} /></label>}
          <button disabled={busy} type="submit" className={button}>{copy.save}</button><button type="button" className={button} onClick={() => setColumnDraft(null)}>{copy.cancel}</button>
        </form>}
        <div className="flex flex-wrap items-center gap-3 px-4 pb-3"><input className={`${control} min-w-40 flex-1`} aria-label={copy.search} placeholder={copy.search} value={query} onChange={event => setQuery(event.target.value)} /><label className="flex items-center gap-2 text-sm text-text-muted">{copy.group}<select className={control} value={group} onChange={event => setGroup(event.target.value)}><option value="">{copy.none}</option>{table.columns.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><span className="text-sm tabular-nums text-text-muted">{visible.length} {copy.count}</span></div>
        {table.mode === 'sheet' && <p className="px-4 pb-3 text-xs leading-relaxed text-text-muted">{copy.formulaHelp}</p>}
        <div className="min-h-0 flex-1 overflow-auto border-y border-border">
          <table className="w-max min-w-full border-collapse text-sm text-text-primary"><thead className="sticky top-0 z-10 bg-surface"><tr><th className="border-r border-b border-border px-3 py-2 text-text-muted">#</th>{table.columns.map((column, index) => <th key={column.id} style={{ width: column.width ?? 180, minWidth: column.width ?? 180 }} className="border-r border-b border-border p-2 text-left font-medium" aria-sort={sort?.id === column.id ? sort.descending ? 'descending' : 'ascending' : 'none'}>
            <div className="flex items-center justify-between gap-1"><button className="flex min-h-9 items-center gap-2 text-left hover:text-accent-gold" onClick={() => setSort({ id: column.id, descending: sort?.id === column.id ? !sort.descending : false })} title={copy.sort}>{table.mode === 'sheet' ? `${cellKey(index, 0).replace(/\d+$/, '')} · ` : ''}{column.name}<ArrowDownUp size={12} /></button>
              <details className="relative"><summary aria-label={`${copy.columnActions} ${column.name}`} className="flex min-h-9 min-w-9 cursor-pointer list-none items-center justify-center rounded-lg text-text-muted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold"><Settings2 size={15} /></summary>
                <div className="absolute right-0 z-20 mt-1 w-52 space-y-1 rounded-lg border border-border bg-surface p-2 shadow-lg" onClick={event => { if ((event.target as Element).closest('button')) event.currentTarget.parentElement?.removeAttribute('open'); }}>
                  <button aria-label={`${copy.editColumn} ${column.name}`} className={`${button} w-full justify-start`} disabled={busy} onClick={() => { setAddingColumn(false); setColumnDraft({ ...column }); }}><Settings2 size={15} />{copy.editColumn}</button>
                  <button aria-label={`${copy.left} ${column.name}`} disabled={busy || index === 0} className={`${button} w-full justify-start`} onClick={() => change(current => { const from = current.columns.findIndex(item => item.id === column.id); if (from > 0) [current.columns[from - 1], current.columns[from]] = [current.columns[from], current.columns[from - 1]]; })}><ChevronLeft size={15} />{copy.left}</button>
                  <button aria-label={`${copy.right} ${column.name}`} disabled={busy || index === table.columns.length - 1} className={`${button} w-full justify-start`} onClick={() => change(current => { const from = current.columns.findIndex(item => item.id === column.id); if (from >= 0 && from < current.columns.length - 1) [current.columns[from + 1], current.columns[from]] = [current.columns[from], current.columns[from + 1]]; })}><ChevronRight size={15} />{copy.right}</button>
                  <button disabled={busy || table.columns.length <= 1} className={`${button} w-full justify-start text-danger`} aria-label={`${copy.remove} ${column.name}`} onClick={() => requestDelete(copy.removeColumn, () => changeTable(projectId, table.id, current => { current.columns = current.columns.filter(item => item.id !== column.id); for (const row of current.rows) delete row.cells[column.id]; }))}><Trash2 size={15} />{copy.remove}</button>
                </div>
              </details>
            </div>
          </th>)}<th className="border-b border-border px-2" /></tr></thead>
            <tbody>{visible.map((row, index) => {
              const savedIndex = table.codexType ? rows.indexOf(row) : table.rows.findIndex(item => item.id === row.id);
              const groupColumn = table.columns.find(column => column.id === group); const groupValue = groupColumn ? rowValue(row, groupColumn) : '';
              const showGroup = groupColumn && (index === 0 || rowValue(visible[index - 1], groupColumn) !== groupValue);
              return <TableRow key={row.id} row={row} savedIndex={savedIndex} columns={table.columns} entries={entries} sheet={table.mode === 'sheet'} disabled={busy} copy={copy} showGroup={Boolean(showGroup)} groupValue={groupValue} value={rowValue} save={saveValue} openEntry={id => navigate(`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(id)}`)} action={table.codexType ? () => setEntryDraft(entries.find(entry => entry.id === row.id)!) : () => requestDelete(copy.removeRow, () => changeTable(projectId, table.id, current => { current.rows = current.rows.filter(item => item.id !== row.id); }))} live={Boolean(table.codexType)} />;
            })}</tbody>
          </table>
          {visible.length === 0 && <p className="p-5 text-sm text-text-muted">{copy.noRows}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 p-4"><button className={button} disabled={busy || rows.length >= 20000} onClick={() => {
          if (table.codexType) { const now = Date.now(); setEntryDraft({ id: crypto.randomUUID(), projectId, type: table.codexType, title: '', fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now }); }
          else change(current => { current.rows.push({ id: crypto.randomUUID(), cells: {} }); });
        }}><Plus size={16} />{table.codexType ? copy.newCard : copy.addRow}</button><p className="text-xs text-text-muted">{copy.cellHint}</p></footer>
      </div>}
    </div>
    <ConfirmDialog open={Boolean(confirmation)} destructive message={confirmation?.message ?? ''} onCancel={() => setConfirmation(null)} onConfirm={async () => { if (confirmation) await run(confirmation.work, () => setConfirmation(null)); }} />
    <Modal open={Boolean(entryDraft)} title={copy.editCard} onClose={() => setEntryDraft(null)} wide>{entryDraft && <CodexEntryForm key={entryDraft.id} projectId={projectId} entry={entryDraft} onCancel={() => setEntryDraft(null)} onSave={async (draft, base) => { const existing = await db.codexEntries.get(draft.id); if (existing && base) await saveCodexDraft(base, draft); else await createCodexEntry(draft); notifyDataChanged({ source: 'other', table: 'codexEntries', projectId, entityId: draft.id }); setEntryDraft(null); }} />}</Modal>
  </section>;
}

function TableRow({ row, savedIndex, columns, entries, sheet, disabled, copy, showGroup, groupValue, value, save, openEntry, action, live }: {
  row: DataRow; savedIndex: number; columns: DataColumn[]; entries: CodexEntry[]; sheet: boolean; disabled: boolean; copy: typeof tableCopy.en; showGroup: boolean; groupValue: string;
  value: (row: DataRow, column: DataColumn) => string; save: (row: DataRow, column: DataColumn, value: string) => Promise<void>; openEntry: (id: string) => void; action: () => void; live: boolean;
}) {
  return <>{showGroup && <tr><th colSpan={columns.length + 2} className="bg-elevated px-4 py-2 text-left font-medium">{groupValue || copy.none}</th></tr>}<tr className="hover:bg-surface/50"><th className="border-r border-b border-border px-3 text-xs font-normal tabular-nums text-text-muted">{savedIndex + 1}</th>{columns.map((column, columnIndex) => {
    const raw = row.cells[column.id] ?? ''; const computed = value(row, column); const label = `${cellKey(columnIndex, savedIndex)} ${column.name}`;
    return <td key={column.id} className="border-r border-b border-border p-0 align-top" style={{ maxWidth: column.width ?? 180 }}>
      <TableCell raw={raw} label={label} column={column} entries={entries} sheet={sheet} disabled={disabled} copy={copy} save={value => save(row, column, value)} openEntry={openEntry} />
      {sheet && raw.startsWith('=') && <output className={`block px-3 pb-2 text-xs ${computed.startsWith('#') ? 'text-danger' : 'text-accent-gold'}`} aria-label={`${copy.value} ${label}`}>{computed}</output>}
    </td>;
  })}<td className="border-b border-border px-2"><button className="rounded p-2 text-text-muted hover:bg-elevated" disabled={disabled} aria-label={live ? copy.editCard : `${copy.remove} ${savedIndex + 1}`} onClick={action}>{live ? <Settings2 size={15} /> : <Trash2 size={15} />}</button></td></tr></>;
}

function TableCell({ raw, label, column, entries, sheet, disabled, copy, save, openEntry }: { raw: string; label: string; column: DataColumn; entries: CodexEntry[]; sheet: boolean; disabled: boolean; copy: typeof tableCopy.en; save: (value: string) => Promise<void>; openEntry: (id: string) => void }) {
  const field = useDebouncedField(raw, save, { delayMs: 750 });
  return <>
    {!sheet && column.kind === 'checkbox' ? <input className="m-3 accent-accent-gold" type="checkbox" aria-label={label} checked={field.value === 'true'} disabled={disabled} onChange={event => field.onChange(String(event.target.checked))} onBlur={field.onBlur} />
      : !sheet && column.kind === 'reference' ? <div className="flex items-center"><select className="min-w-0 flex-1 bg-transparent p-3 outline-accent-gold" aria-label={label} value={field.value} disabled={disabled} onChange={event => field.onChange(event.target.value)} onBlur={field.onBlur}><option value="">{copy.noLink}</option>{field.value && !entries.some(entry => entry.id === field.value) && <option value={field.value}>{copy.missingLink}</option>}{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select>{entries.some(entry => entry.id === field.value) && <button className="mr-2 rounded p-1 text-accent-gold" aria-label={copy.openCard} onClick={() => openEntry(field.value)}><ExternalLink size={14} /></button>}</div>
        : <input aria-label={label} title={copy.cellHint} className="min-h-11 w-full min-w-0 bg-transparent px-3 py-2 outline-accent-gold focus:bg-elevated" value={field.value} disabled={disabled} onChange={event => field.onChange(event.target.value)} onBlur={field.onBlur} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { field.onChange(raw); event.currentTarget.blur(); } }} />}
    {field.error && <div role="alert" className="px-3 pb-2 text-xs text-danger"><p>{copy.error}</p><button className="mt-2 underline underline-offset-2" onClick={() => { void field.retry(); }}>{copy.retry}</button></div>}
  </>;
}
