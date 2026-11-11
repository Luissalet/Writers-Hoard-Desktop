import { useEraNavigate } from '@/services/worldEras/navigation';
import { readEraRow, mutateEraRows, readWorldDocument } from '@/services/worldEras/store';
import type { EraRow } from '@/services/worldEras/types';
import { bindEraOperation, useWorldEraScope, useEraProject, useEraRows } from '@/services/worldEras/hooks';
import {projectWorldTable,columnCalculation,displayTableFormula,liveTableEntries} from './projection';
import {createTypeTable,saveTableCalculation,removeTableColumn,updateTableColumn,type SaveTableCalculation} from './calculations';
import TableCalculationEditor from './TableCalculationEditor';
import { projectCodexEntry } from '@/engines/codex/properties';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useDeepLinkParam } from '@/engines/_shared';
import { ArrowDownUp, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, ExternalLink, Filter, GripVertical, Pencil, Plus, Settings2, Table2, Trash2, Upload, X } from 'lucide-react';
import { editTableRows, undoTableRows, type TableRowAction } from './rowActions';
import { WorldEraConflict } from '@/services/worldEras/types';
import { recordUndoable, UndoStaleError } from '@/services/undoJournal';
import { canChangeTableColumnKind, CONDITION_OPS, DEFAULT_TABLE_COLUMN_WIDTH, duplicateColumn, duplicateRow, duplicateRows, filterRows, findMatches, insertRow, isLiveTable, isNormalTable, moveTableColumn, removeRows, renameTableColumn, resizeTableColumn, sortRows, TABLE_COLUMN_KINDS, tableColumnWidthLimits, toggleSort, type TableCondition } from './tableEdits';
import { useTableColumnDrag } from './useTableColumnDrag';
import { useTableCellNavigation } from './useTableCellNavigation';
import { parseTableClipboard, pasteTableCells } from './tableClipboard';
import TableColumnHeader from './TableColumnHeader';
import CsvDialog from './CsvDialog';
import WorkbookTabs from './WorkbookTabs';
import { workbookTabs } from './workbook';
import { XlsxError, exportXlsxReport, importXlsx, sheetsToTables, type XlsxReport } from './xlsx';
import { FileSpreadsheet } from 'lucide-react';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { EngineComponentProps } from '@/engines/_types';
import type { CodexEntry, CodexEntryType } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import Modal from '@/components/common/Modal';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import { saveCodexDraft } from '@/engines/codex/operations';
import { createCodexEntry } from '@/db/operations';
import { cellKey, validateCell, type DataColumn, type DataRow, type TableViewSettings, type WorldTable } from './types';
import { addColumn as addColumnScoped, addTable as addTableScoped, changeTable as changeTableScoped, deleteTable as deleteTableScoped, insertColumnAt as insertColumnAtScoped, saveCell as saveCellScoped, saveTableView } from './operations';
import { sheetValues } from './formulas';
import { tableCopy } from './copy';
import { confirmedTableFilters, effectiveTableView, filterStamp, projectTableGroups, storedTableView, tableViewParts } from './viewGroups';
import { useDebouncedField } from '@/engines/_shared/useDebouncedField';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
const button = `${control} inline-flex items-center justify-center gap-2 hover:bg-elevated disabled:cursor-not-allowed`;
const codexTypes: CodexEntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];
const emptyFolds: ReadonlySet<string> = new Set();
const emptyRowSelection: ReadonlySet<string> = new Set();
type RowSelection = { epoch: number; rows: ReadonlySet<string>; anchor?: string };
type InlineColumnRename = { owner: string; columnId: string; name: string };

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
  const [groupFolds, setGroupFolds] = useState<{ key: string; folded: ReadonlySet<string> }>();
  const [filterEpoch, setFilterEpoch] = useState(0);
  const filterFlush = useRef<(() => Promise<boolean>) | null>(null);
  const registerFilterFlush = useCallback((flush: () => Promise<boolean>) => {
    filterFlush.current = flush;
    return () => { if (filterFlush.current === flush) filterFlush.current = null; };
  }, []);
  const [matchAt, setMatchAt] = useState(0); const [rowSelection, setRowSelection] = useState<RowSelection>(); const [insertAt, setInsertAt] = useState<number | null>(null);
  const [creating, setCreating] = useState(false); const [name, setName] = useState(''); const [mode, setMode] = useState<'table' | 'sheet' | 'live'>('table'); const [sourceType, setSourceType] = useState<CodexEntryType>('character'); const [sourceTemplateId,setSourceTemplateId]=useState(''); const [allSources, setAllSources] = useState(false);
  const [columnDraft, setColumnDraft] = useState<DataColumn | null>(null); const [addingColumn, setAddingColumn] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<{ message: string; work: () => Promise<void> } | null>(null);
  const [entryDraft, setEntryDraft] = useState<CodexEntry | null>(null);
  const importRef = useRef<HTMLInputElement>(null),formulaRef=useRef<HTMLInputElement>(null);
  const [columnVersion,setColumnVersion]=useState(''),[columnTemplateRevision,setColumnTemplateRevision]=useState<number>();
  const [formulaDraft,setFormulaDraft]=useState<SaveTableCalculation|null>(null);
  const tables = project?.dataTables ?? [];
  // A workbook shows once in the list (its first visible tab); its other tabs are under the sheet.
  const navTables = tables.filter(item => !item.workbook || item.id === [...tables.filter(other => other.workbook?.id === item.workbook!.id)].sort((a, b) => Number(!!a.workbook!.hidden) - Number(!!b.workbook!.hidden) || a.workbook!.order - b.workbook!.order)[0]?.id);
  const deepLink=useDeepLinkParam('entity'); const [appliedLink,setAppliedLink]=useState<string|null>(null);
  if(deepLink&&deepLink!==appliedLink&&tables.some(table=>table.id===deepLink)){setSelectedId(deepLink);setAppliedLink(deepLink);}
  const storedTable = tables.find(item => item.id === selectedId) ?? tables[0];
  const rowKey = JSON.stringify([scope.projectId, scope.eraId, storedTable?.id]);
  const [inlineRename, setInlineRename] = useState<InlineColumnRename>();
  if (inlineRename && (inlineRename.owner !== rowKey || !storedTable?.columns.some(column => column.id === inlineRename.columnId))) {
    setInlineRename(undefined);
  }
  const tableRef = useRef<HTMLTableElement>(null);
  const renameFocus = useRef<InlineColumnRename>(undefined);
  useLayoutEffect(() => {
    const edit = renameFocus.current;
    if (!edit || inlineRename || busy) return;
    renameFocus.current = undefined;
    if (edit.owner !== rowKey) return;
    const id = CSS.escape(edit.columnId);
    tableRef.current?.querySelector<HTMLButtonElement>(`th[data-table-column-id="${id}"] [data-table-column-sort]`)?.focus({ preventScroll: true });
  }, [inlineRename, busy, rowKey]);
  const [findTarget, setFindTarget] = useState<{ owner: string; rowId: string; columnId: string }>();
  const lastFindTarget = useRef<typeof findTarget>(undefined);
  useEffect(() => {
    if (findTarget?.owner !== rowKey || lastFindTarget.current === findTarget) return;
    lastFindTarget.current = findTarget;
    const cell = CSS.escape(`${findTarget.rowId}:${findTarget.columnId}`);
    const row = CSS.escape(findTarget.rowId);
    tableRef.current?.querySelector(`tr[data-row-id="${row}"]`)?.querySelector(`[data-cell="${cell}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [findTarget, rowKey]);
  const rowOwner = useRef({ key: rowKey, epoch: 0, mounted: true });
  if (rowOwner.current.key !== rowKey) rowOwner.current = { key: rowKey, epoch: rowOwner.current.epoch + 1, mounted: true };
  const selectionEpoch = rowOwner.current.epoch;
  const selectedRows = rowSelection?.epoch === selectionEpoch ? rowSelection.rows : emptyRowSelection;
  const clearRowSelection = () => setRowSelection(current => current?.epoch === selectionEpoch ? undefined : current);
  const [rowRead, setRowRead] = useState<{ key: string; table: WorldTable; version: string }>();
  const [rowPending, setRowPending] = useState<number | null>(null);
  const draggedRow = useRef<{ id: string; epoch: number; version: string; pointerId: number; x: number; y: number; moved: boolean; handle: HTMLButtonElement; table: HTMLTableElement; end: Element | null } | undefined>(undefined);
  const [rowDrop, setRowDrop] = useState<{ epoch: number; id: string | undefined }>();
  useEffect(() => { rowOwner.current.mounted = true; return () => { rowOwner.current.mounted = false; }; }, []);
  useEffect(() => () => {
    const dragged = draggedRow.current; draggedRow.current = undefined;
    if (dragged?.handle.hasPointerCapture(dragged.pointerId)) dragged.handle.releasePointerCapture(dragged.pointerId);
  }, [rowKey]);
  useEffect(() => {
    let active = true;
    if (storedTable) void readWorldDocument(scope, 'tables', storedTable.id).then(read => {
      if (active && read && JSON.stringify(read.document.root) === JSON.stringify(storedTable)) setRowRead({ key: rowKey, table: storedTable, version: read.version });
    }).catch(() => {});
    return () => { active = false; };
  }, [storedTable, scope, rowKey]);
  const rowReady = rowRead?.key === rowKey && rowRead.table === storedTable;
  const rowWorking = rowPending === rowOwner.current.epoch;
  async function changeRows(action: TableRowAction, version = rowReady ? rowRead!.version : undefined, undoLabel?: string) {
    if (!storedTable || !version || rowWorking || busy) return;
    const owner = rowOwner.current, epoch = owner.epoch, target = { ...scope }, tableId = storedTable.id;
    const current = () => rowOwner.current === owner && owner.mounted && owner.epoch === epoch;
    setRowPending(epoch); setError('');
    try {
      return await editTableRows(target, tableId, action, version, result => {
        if (!result.receiptId) return;
        const receiptId = result.receiptId;
        const label = undoLabel ?? { 'move-row': copy.rowMoved, 'insert-row': copy.rowInserted, 'paste-cells': copy.cellsPasted }[action.action];
        recordUndoable({ projectId: target.projectId, kind: 'asset', label, notice: label, undo: async () => {
          try { await undoTableRows(target, receiptId); }
          catch (failure) { if (failure instanceof WorldEraConflict || failure instanceof Error && failure.message === 'table_row_receipt_missing') throw new UndoStaleError(); throw failure; }
        } });
        if (current()) setNotice(action.action !== 'paste-cells' && (sorts.length || groupRules.length) ? copy.manualOrderNotice : label);
      });
    } catch (failure) {
      if (current()) {
        const reason = failure instanceof WorldEraConflict ? copy.rowConflict
          : action.action === 'paste-cells' ? copy.cellPasteInvalid : failure instanceof Error ? failure.message : '';
        setError(`${copy.error} ${reason}`);
      }
    } finally { if (current()) setRowPending(null); }
  }
  const beginRowDrag = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || !rowReady || rowWorking || busy) return;
    const handle = event.currentTarget, table = handle.closest('table');
    if (!table) return;
    event.preventDefault(); handle.focus({ preventScroll: true });
    try { handle.setPointerCapture(event.pointerId); } catch { return; }
    draggedRow.current = { id, epoch: rowOwner.current.epoch, version: rowRead!.version, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, handle, table, end: table.closest('section')?.querySelector('[data-table-row-end]') ?? null };
  };
  const pointerRowTarget = (event: ReactPointerEvent<HTMLButtonElement>, dragged: NonNullable<typeof draggedRow.current>): { id: string | undefined } | undefined => {
    const hit = document.elementFromPoint(event.clientX, event.clientY), row = hit?.closest<HTMLElement>('tr[data-row-id]');
    if (row?.closest('table') === dragged.table) return { id: row.dataset.rowId! };
    if (dragged.end && hit?.closest('[data-table-row-end]') === dragged.end) return { id: undefined };
    return undefined;
  };
  const moveRowPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragged = draggedRow.current;
    if (!dragged || dragged.pointerId !== event.pointerId || dragged.epoch !== rowOwner.current.epoch) return;
    if (!dragged.moved && Math.hypot(event.clientX - dragged.x, event.clientY - dragged.y) < 5) return;
    dragged.moved = true; event.preventDefault();
    const target = pointerRowTarget(event, dragged);
    setRowDrop(previous => target ? previous?.epoch === dragged.epoch && previous.id === target.id ? previous : { epoch: dragged.epoch, id: target.id } : undefined);
  };
  const endRowPointer = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const dragged = draggedRow.current;
    if (!dragged || dragged.pointerId !== event.pointerId) return;
    draggedRow.current = undefined; setRowDrop(undefined);
    if (dragged.handle.hasPointerCapture(event.pointerId)) dragged.handle.releasePointerCapture(event.pointerId);
    if (cancelled || !dragged.moved || dragged.epoch !== rowOwner.current.epoch) return;
    const target = pointerRowTarget(event, dragged);
    if (target) void changeRows({ action: 'move-row', rowId: dragged.id, beforeRowId: target.id }, dragged.version);
  };
  const projected=storedTable?projectWorldTable(storedTable,entries,project?.codexTemplates??[]):undefined;
  const table=storedTable?{...storedTable,columns:projected!.columns}:undefined;
  const editedColumnWidth = table?.columns.find(column => column.id === columnDraft?.id)?.width;
  const editedWidthLimits = tableColumnWidthLimits(editedColumnWidth);
  const run = async (work: () => Promise<void>, done?: () => void) => { if (busy) return; setBusy(true); setError(''); try { await work(); done?.(); } catch (reason) { setError(`${copy.error} ${reason instanceof Error?reason.message:''}`); } finally { setBusy(false); } };
  const change = (update: (table: WorldTable) => void) => { if (table) void run(() => changeTable(projectId, table.id, update)); };
  // All-type views still edit card values on the Codex entry.
  const live = Boolean(table && isLiveTable(table)), allTypes = Boolean(table?.codexAllTypes);
  const projectedEntries = new Map(table && live ? liveTableEntries(table, entries).map(entry => [entry.id, projectCodexEntry(entry, project?.codexTemplates ?? [])]) : []);
  const canResizeColumns = table !== undefined && isNormalTable(table);
  const columnsBusy = busy || rowWorking || Boolean(columnDraft || formulaDraft || inlineRename);
  const columnDragEnabled = Boolean(canResizeColumns && table.columns.length > 1 && !columnsBusy);
  const columnDrag = useTableColumnDrag(rowKey, table?.columns ?? [], columnDragEnabled, (id, target, expectedOrder) => {
    if (!table) return;
    void run(async () => {
      try {
        await changeTable(projectId, table.id, current => { moveTableColumn(current, id, target.id, target.side, expectedOrder); });
      } catch (reason) {
        if (reason instanceof Error && reason.message === 'table_column_order_conflict') throw new Error(copy.columnOrderConflict);
        throw reason;
      }
    });
  });
  const resizeColumn = (id: string, width: number, expectedWidth?: number) => {
    if (!table) return;
    void run(async () => {
      try {
        await changeTable(projectId, table.id, current => { resizeTableColumn(current, id, width, expectedWidth); });
      } catch (reason) {
        if (reason instanceof Error && reason.message === 'table_column_width_conflict') throw new Error(copy.columnWidthConflict);
        throw reason;
      }
    });
  };
  const beginInlineRename = (column: DataColumn) => {
    if (columnDrag.hasActivePointer()) return;
    setError('');
    setInlineRename({ owner: rowKey, columnId: column.id, name: column.name });
  };
  const closeInlineRename = (edit: InlineColumnRename) => {
    if (rowOwner.current.key !== edit.owner) return;
    renameFocus.current = edit;
    setError('');
    setInlineRename(current => current === edit ? undefined : current);
  };
  const submitInlineRename = (edit: InlineColumnRename, name: string) => {
    if (!table || busy || edit.owner !== rowKey) return;
    if (name.trim() === edit.name) { closeInlineRename(edit); return; }
    void run(async () => {
      try {
        await changeTable(projectId, table.id, current => { renameTableColumn(current, edit.columnId, name, edit.name); });
      } catch (reason) {
        if (reason instanceof Error && reason.message === 'table_column_name_conflict') throw new Error(copy.columnNameConflict);
        if (reason instanceof Error && reason.message === 'table_column_name_invalid') throw new Error(copy.columnNameInvalid);
        throw reason;
      }
    }, () => closeInlineRename(edit));
  };
  const rows:DataRow[]=projected?.rows??[];
  const values = table?.mode === 'sheet' ? sheetValues(table) : null;
  const displayById = new Map(projected?.displayRows.map(row => [row.id, row]) ?? []);
  const entryTitles = new Map(entries.map(entry => [entry.id, entry.title]));
  const rowPosition = new Map((live ? rows : table?.rows ?? []).map((row, index) => [row.id, index]));
  const columnPosition = new Map(table?.columns.map((column, index) => [column.id, index]) ?? []);
  const rowValue = (row: DataRow, column: DataColumn): string => {
    if (!table || !values) return row.cells[column.id] ?? '';
    return String(values.get(cellKey(columnPosition.get(column.id) ?? -1, rowPosition.get(row.id) ?? -1)) ?? '');
  };
  const displayValue=(row:DataRow,column:DataColumn)=>column.field==='__type'?t(`codex.types.${rowValue(row,column)}`):table?.mode==='sheet'?rowValue(row,column):displayById.get(row.id)?.cells[column.id]??rowValue(row,column);
  const beginCalculation=async(column?:DataColumn)=>{if(!table)return;await run(async()=>{const read=await readWorldDocument(scope,'tables',table.id);if(!read)throw Error('table_missing');const calc=column?columnCalculation(table,column,project?.codexTemplates??[]):undefined;setFormulaDraft({tableId:table.id,columnId:column?.id,name:column?.name??'',formula:calc?displayTableFormula(calc,table.columns):'=',resultType:calc?.resultType??'decimal',expectedVersion:read.version,expectedTemplateRevision:project?.codexTemplates?.find(item=>item.id===table.codexTemplateId)?.revision});});};
  const insertToken=(token:string)=>{const input=formulaRef.current,start=input?.selectionStart??formulaDraft?.formula.length??0,end=input?.selectionEnd??start;setFormulaDraft(draft=>draft?{...draft,formula:draft.formula.slice(0,start)+token+draft.formula.slice(end)}:draft);requestAnimationFrame(()=>{input?.focus();input?.setSelectionRange(start+token.length,start+token.length);});};
  const columnById = (id: string) => table?.columns.find(column => column.id === id);
  const savedView = storedTableView(project?.tableGroupingViews, storedTable?.id ?? '', scope.eraId);
  const view = effectiveTableView(savedView, table?.columns ?? []);
  const { conditions, sorts, rules: groupRules } = view;
  const groupedColumns = new Set(groupRules.map(rule => rule.columnId));
  const groupControlCount = Math.min(table?.columns.length ?? 0, groupRules.length + 1);
  const candidates = filterRows(rows, conditions, (row, id) => { const column = columnById(id); return column ? displayValue(row, column) : undefined; });
  const matchesByRow = new Map<string, { rowId: string; columnId: string }[]>();
  const hasSearch = Boolean(query.trim());
  const matchSearch = (source: DataRow[], raw = rowValue, shown = displayValue) =>
    findMatches(source, table?.columns ?? [], query, (row, column) => {
      const value = raw(row, column);
      return [value, shown(row, column), column.kind === 'reference' ? entryTitles.get(value) ?? '' : ''];
    });
  if (table && hasSearch) for (const match of matchSearch(candidates)) {
    const rowMatches = matchesByRow.get(match.rowId);
    if (rowMatches) rowMatches.push(match);
    else matchesByRow.set(match.rowId, [match]);
  }
  const filteredRows = sortRows(hasSearch ? candidates.filter(row => matchesByRow.has(row.id)) : candidates, sorts, (row, id) => {
    const column = columnById(id); return column ? rowValue(row, column) : '';
  }, id => columnById(id)?.kind === 'number');
  const foldKey = JSON.stringify([rowKey, groupRules.map(rule => rule.columnId)]);
  const foldedGroups = groupFolds?.key === foldKey ? groupFolds.folded : emptyFolds;
  const resetFolds = () => setGroupFolds(undefined);
  const resetLocalView = () => { setQuery(''); setMatchAt(0); clearRowSelection(); resetFolds(); };
  const flushFilters = async () => {
    if (filterFlush.current && !await filterFlush.current()) throw new Error(copy.reloadFilters);
  };
  const selectTable = (id: string) => { if (id !== table?.id) void run(flushFilters, () => { setSelectedId(id); resetLocalView(); }); };
  const saveView = (patch: Partial<TableViewSettings>, done?: () => void) => {
    if (!storedTable) return;
    const epoch = rowOwner.current.epoch;
    const expected = Object.fromEntries(tableViewParts.filter(key => patch[key] !== undefined).map(key => [key, JSON.stringify(savedView[key])]));
    void run(async () => { await saveTableView(projectId, storedTable.id, patch, expected, scope.eraId); }, () => {
      if (rowOwner.current.mounted && rowOwner.current.epoch === epoch) done?.();
    });
  };
  const setGroupColumn = (depth: number, columnId: string) => {
    const rules = columnId
      ? [...groupRules.slice(0, depth), { columnId, direction: groupRules[depth]?.direction ?? 'asc' as const }, ...groupRules.slice(depth + 1)]
      : groupRules.filter((_, index) => index !== depth);
    saveView({ rules }, resetFolds);
  };
  const groupValue = (row: DataRow, id: string, rawValue = rowValue, shownValue = displayValue) => {
    const column = columnById(id)!;
    const raw = rawValue(row, column), identity = raw.trim() ? raw : '';
    const number = identity && column.kind === 'number' ? Number(identity) : undefined;
    const title = column.kind === 'reference' ? entryTitles.get(raw) : undefined;
    return { identity, label: identity ? title ?? shownValue(row, column) : '', number: Number.isFinite(number) ? number : undefined };
  };
  const { orderedRows: visible, expandedRows, items: groupItems, pathsByRow } =
    projectTableGroups(filteredRows, groupRules, groupValue, foldedGroups, locale);
  const selectRow = (rowId: string, checked: boolean, extend: boolean) => setRowSelection(current => {
    const previous = current?.epoch === selectionEpoch ? current : undefined;
    const rows = new Set(previous?.rows);
    const anchor = previous?.anchor;
    const first = extend && anchor ? expandedRows.findIndex(row => row.id === anchor) : -1;
    const last = first >= 0 ? expandedRows.findIndex(row => row.id === rowId) : -1;
    if (first >= 0 && last >= 0) {
      for (const row of expandedRows.slice(Math.min(first, last), Math.max(first, last) + 1)) rows.add(row.id);
      return { epoch: selectionEpoch, rows, anchor };
    }
    if (checked) rows.add(rowId);
    else rows.delete(rowId);
    return { epoch: selectionEpoch, rows, anchor: rowId };
  });
  const selectShownRows = (checked: boolean) => setRowSelection(current => {
    const previous = current?.epoch === selectionEpoch ? current : undefined;
    const rows = new Set(groupRules.length ? previous?.rows : undefined);
    for (const row of expandedRows) {
      if (checked) rows.add(row.id);
      else rows.delete(row.id);
    }
    return { epoch: selectionEpoch, rows, anchor: previous?.anchor };
  });
  const restrictRows = hasSearch || conditions.length > 0 || foldedGroups.size > 0;
  const rowsVisibleInView = (source: WorldTable, rowIds: readonly string[]) => {
    if (!restrictRows) return true;
    const wanted = new Set(rowIds);
    const probe = projectWorldTable(source, []);
    const subset = probe.rows.filter(row => wanted.has(row.id));
    const display = new Map(probe.displayRows.filter(row => wanted.has(row.id)).map(row => [row.id, row]));
    const raw = (item: DataRow, column: DataColumn) => item.cells[column.id] ?? '';
    const shown = (item: DataRow, column: DataColumn) => display.get(item.id)?.cells[column.id] ?? raw(item, column);
    const matching = filterRows(subset, conditions, (item, id) => {
      const column = columnById(id);
      return column ? shown(item, column) : undefined;
    });
    const searched = hasSearch ? new Set(matchSearch(matching, raw, shown).map(match => match.rowId)) : undefined;
    const shownRows = searched ? matching.filter(row => searched.has(row.id)) : matching;
    return projectTableGroups(shownRows, groupRules, (item, id) => groupValue(item, id, raw, shown),
      foldedGroups, locale).expandedRows.length === rowIds.length;
  };
  const appendKeyboardRow = async () => {
    if (!storedTable) return;
    if (restrictRows) {
      const blank: DataRow = { id: crypto.randomUUID(), cells: {} };
      if (!rowsVisibleInView({ ...storedTable, rows: [...storedTable.rows, blank] }, [blank.id])) return;
    }
    return (await changeRows({ action: 'insert-row' }))?.row?.id;
  };
  const pasteFrom = (text: string, row: number, column: number) => {
    if (!table || !storedTable || !rowReady || rowWorking || busy) return;
    try {
      const values = parseTableClipboard(text);
      const rowIds = expandedRows.slice(row, row + values.length).map(item => item.id);
      const columnIds = table.columns.slice(column, column + values[0].length).map(item => item.id);
      const paste = { rowIds, columnIds, values };
      if (restrictRows && rowIds.length < values.length) {
        const draft = structuredClone(storedTable);
        const predicted = pasteTableCells(draft, paste);
        if (!rowsVisibleInView(draft, predicted.rowIds.slice(rowIds.length))) throw Error('table_paste_hidden_rows');
      }
      void changeRows({ action: 'paste-cells', ...paste });
    } catch {
      setError(copy.cellPasteInvalid);
    }
  };
  const sheetKeyboard = table?.mode === 'sheet' && !live;
  const normalKeyboard = !!table && isNormalTable(table);
  const keyboard = useTableCellNavigation({
    enabled: normalKeyboard || sheetKeyboard,
    sheet: sheetKeyboard,
    owner: rowOwner.current.epoch,
    viewKey: JSON.stringify([query, conditions, sorts, groupRules, [...foldedGroups]]),
    tableRef, rows: expandedRows, columns: table?.columns ?? [], appendRow: normalKeyboard ? appendKeyboardRow : undefined,
    readCell: normalKeyboard ? (row, column) => rowValue(expandedRows[row], table!.columns[column]) : undefined,
    pasteFrom: normalKeyboard ? pasteFrom : undefined,
    clearRange: normalKeyboard ? ({ firstRow, lastRow, firstColumn, lastColumn }) => {
      const columnIds = table!.columns.slice(firstColumn, lastColumn + 1)
        .filter(column => !projected?.calculatedColumnIds.includes(column.id))
        .map(column => column.id);
      if (!columnIds.length) return;
      const rowIds = expandedRows.slice(firstRow, lastRow + 1).map(row => row.id);
      const values = rowIds.map(() => columnIds.map(() => ''));
      void changeRows({ action: 'paste-cells', rowIds, columnIds, values }, undefined, copy.cellsCleared);
    } : undefined,
  });
  const visiblePosition = new Map(visible.map((row, index) => [row.id, index]));
  const updateFolded = (update: (folded: Set<string>) => void) => setGroupFolds(previous => {
    const folded = new Set(previous?.key === foldKey ? previous.folded : emptyFolds);
    update(folded); return { key: foldKey, folded };
  });
  // Find: every cell holding the search text, stepped through with next / previous.
  const matches = hasSearch ? visible.flatMap(row => matchesByRow.get(row.id) ?? []) : [];
  const currentMatch = matches.length ? matches[Math.min(matchAt, matches.length - 1)] : undefined;
  const stepMatch = (by: number) => {
    if (!matches.length) return;
    const next = (Math.min(matchAt, matches.length - 1) + by + matches.length) % matches.length;
    setMatchAt(next);
    const target = matches[next], ancestors = pathsByRow.get(target.rowId);
    if (ancestors?.some(key => foldedGroups.has(key))) updateFolded(folded => ancestors.forEach(key => folded.delete(key)));
    setFindTarget({ ...target, owner: rowKey });
  };
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
    if(mode==='live'&&sourceTemplateId&&!allSources){await run(async()=>{const created=await createTypeTable(scope,name,sourceTemplateId);setSelectedId(created.id);},()=>{setCreating(false);setName('');resetLocalView();});return;}
    const columns: DataColumn[] = mode === 'sheet' ? Array.from({ length: 6 }, (_, index) => ({ id: crypto.randomUUID(), name: cellKey(index, 0).replace(/\d+$/, ''), kind: 'text' })) : [{ id: crypto.randomUUID(), name: t('codex.field.name'), kind: 'text', field: 'title' }];
    const everyType = mode === 'live' && allSources;
    const document: WorldTable = { id: crypto.randomUUID(), title: name.trim(), mode: mode === 'sheet' ? 'sheet' : 'table', codexType: mode === 'live' && !everyType ? sourceType : undefined, ...(everyType ? { codexAllTypes: true } : {}), columns: everyType ? [...columns, { id: crypto.randomUUID(), name: copy.typeColumn, kind: 'text', field: '__type' }] : columns, rows: mode === 'sheet' ? Array.from({ length: 20 }, () => ({ id: crypto.randomUUID(), cells: {} })) : [] };
    await run(() => addTable(projectId, document), () => { setSelectedId(document.id); setCreating(false); setName(''); resetLocalView(); });
  };
  const requestDelete = (message: string, work: () => Promise<void>) => setConfirmation({ message, work });
  // An Excel workbook comes in as one sheet per worksheet, grouped as tabs of one book; what could not come is said.
  const reportText = (report: XlsxReport) => locale === 'es'
    ? `Importadas ${report.sheets} hojas, ${report.cells} celdas y ${report.formulas} fórmulas.${report.unsupportedFunctions.length ? ` Sin calcular aquí: ${report.unsupportedFunctions.join(', ')}.` : ''}${report.truncated.length ? ` Recortado: ${report.truncated.join('; ')}.` : ''}${report.dropped.length ? ` No se conserva: ${[...new Set(report.dropped)].join('; ')}.` : ''}`
    : `Imported ${report.sheets} sheets, ${report.cells} cells and ${report.formulas} formulas.${report.unsupportedFunctions.length ? ` Not computed here: ${report.unsupportedFunctions.join(', ')}.` : ''}${report.truncated.length ? ` Cut: ${report.truncated.join('; ')}.` : ''}${report.dropped.length ? ` Not kept: ${[...new Set(report.dropped)].join('; ')}.` : ''}`;
  const importWorkbook = async (file: File) => {
    setNotice('');
    await run(async () => {
      try {
        const { sheets, report } = await importXlsx(new Uint8Array(await file.arrayBuffer()));
        const created = sheetsToTables(sheets, file.name.replace(/\.xlsx$/i, ''));
        for (const sheet of created) await addTable(projectId, sheet);
        setSelectedId(created.find(sheet => !sheet.workbook?.hidden)?.id ?? created[0].id); setNotice(reportText(report));
      } catch (reason) {
        if (reason instanceof XlsxError) throw new Error(locale === 'es' ? ({ encrypted: 'El libro está protegido con contraseña; quítala en Excel y vuelve a importarlo.', not_xlsx: 'No es un libro .xlsx válido.', too_large: 'El libro pasa de 20 MB.', empty: 'El libro no tiene hojas de cálculo.' })[reason.code] : ({ encrypted: 'The workbook is password-protected; remove the password in Excel and import it again.', not_xlsx: 'Not a valid .xlsx workbook.', too_large: 'The workbook is over 20 MB.', empty: 'The workbook has no worksheets.' })[reason.code]);
        throw reason;
      }
    });
  };
  const downloadWorkbook = async () => {
    if (!table) return;
    await run(async () => {
      // A live view has no stored rows: export the rows it shows (the projection), not the empty stored list.
      const tabs = workbookTabs(tables, table), { blob, warnings } = await exportXlsxReport(tabs.map(item => item.id === table.id ? { ...table, rows } : item));
      if (warnings.length) setNotice(locale === 'es' ? `Excel puede no reconocer estas funciones y mostrar #NOMBRE?: ${warnings.join(', ')}.` : `Excel may not recognise these functions and show #NAME?: ${warnings.join(', ')}.`);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${(table.workbook?.name ?? table.title).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'libro'}.xlsx`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };
  if (!project) return <div aria-busy="true" className="p-5 text-text-muted">{copy.title}</div>;
  return <section className="flex h-full min-h-0 flex-col bg-deep" aria-label={copy.title}>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div><h2 className="flex items-center gap-2 font-display text-2xl text-text-primary"><Table2 size={24} />{copy.title}</h2><p className="mt-2 max-w-prose text-sm text-text-muted">{copy.intro}</p></div><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => setCreating(!creating)}><Plus size={16} />{copy.newTable}</button><button className={button} disabled={busy} onClick={() => importRef.current?.click()}><Upload size={16} />{copy.import}</button><input ref={importRef} className="hidden" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label={copy.import} data-testid="table-import" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (/\.xlsx$/i.test(file.name)) { void importWorkbook(file); return; } void run(async () => { if (file.size > 8_000_000) throw new Error('File too large'); setCsvInput({bytes:new Uint8Array(await file.arrayBuffer()),title:file.name.replace(/\.csv$/i, '')}); }); }} /></div></header>
    {csvInput&&<CsvDialog locale={locale} input={csvInput} onClose={()=>setCsvInput(undefined)} onImport={async imported=>{await addTable(projectId,imported);setSelectedId(imported.id);}}/>}
    {csvExport&&table&&<CsvDialog locale={locale} output={{table,rows,value:displayValue}} onClose={()=>setCsvExport(false)}/>}
    {error && <p role="alert" className="p-4 text-sm text-danger">{error}</p>}
    {notice && <p role="status" data-testid="table-import-report" className="flex flex-wrap items-start gap-2 p-4 text-sm text-text-muted">{notice}{(sorts.length > 0 || groupRules.length > 0) && <button type="button" className="underline underline-offset-2" disabled={busy} onClick={() => { saveView({ ...(groupRules.length ? { rules: [] } : {}), ...(sorts.length ? { sorts: [] } : {}) }, resetFolds); }}>{copy.manualOrder}</button>}<button type="button" className="underline" onClick={() => setNotice('')}>{locale === 'es' ? 'Cerrar' : 'Close'}</button></p>}
    {creating && <form className="flex flex-wrap items-end gap-3 border-b border-border p-4" onSubmit={event => { event.preventDefault(); void createDocument(); }}><label className="flex flex-col gap-1 text-sm text-text-primary">{copy.name}<input required maxLength={200} autoFocus className={control} value={name} onChange={event => setName(event.target.value)} /></label><select aria-label={copy.newTable} className={control} value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="table">{copy.table}</option><option value="sheet">{copy.sheet}</option><option value="live">{copy.live}</option></select>{mode === 'live' && <select className={control} aria-label={copy.live} data-testid="table-live-source" value={allSources?'__all':sourceTemplateId?`template:${sourceTemplateId}`:sourceType} onChange={event => {if(event.target.value==='__all'){setAllSources(true);setSourceTemplateId('');}else if(event.target.value.startsWith('template:')){setAllSources(false);setSourceTemplateId(event.target.value.slice(9));}else{setAllSources(false);setSourceTemplateId('');setSourceType(event.target.value as CodexEntryType);}}}><option value="__all">{copy.allTypes}</option><optgroup label={locale==='es'?'Tipos del Códice':'Codex types'}>{project.codexTemplates?.map(template=><option key={template.id} value={`template:${template.id}`}>{template.name}</option>)}</optgroup><optgroup label={locale==='es'?'Categorías existentes':'Existing categories'}>{codexTypes.map(type => <option key={type} value={type}>{t(`codex.types.${type}`)}</option>)}</optgroup></select>}<button disabled={busy} className={`${button} bg-accent-gold text-deep`} type="submit">{copy.create}</button><button className={button} type="button" onClick={() => setCreating(false)}>{copy.cancel}</button></form>}
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav className="shrink-0 overflow-auto border-b border-border p-3 md:w-52 md:border-r md:border-b-0" aria-label={copy.title}>{tables.length === 0 && <p className="p-2 text-sm text-text-muted">{copy.empty}</p>}{navTables.map(item => <button key={item.id} disabled={busy || Boolean(columnDraft)||Boolean(formulaDraft)} aria-current={item.id === table?.id || (item.workbook && item.workbook.id === table?.workbook?.id) ? 'page' : undefined} className={`mb-1 block w-full break-words rounded-lg p-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent-gold ${item.id === table?.id ? 'bg-elevated text-accent-gold' : 'text-text-primary hover:bg-surface'}`} onClick={() => selectTable(item.id)}>{item.workbook ? item.workbook.name : item.title}<span className="mt-1 block text-xs text-text-muted">{item.codexType ? copy.live : item.workbook ? (locale === 'es' ? `Libro · ${tables.filter(other => other.workbook?.id === item.workbook!.id).length} pestañas` : `Workbook · ${tables.filter(other => other.workbook?.id === item.workbook!.id).length} tabs`) : item.mode === 'sheet' ? copy.sheet : copy.table}</span></button>)}</nav>
      {table && <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 p-4"><h3 className="mr-auto min-w-0 break-words font-display text-xl text-text-primary">{table.title}{table.codexTemplateId&&<span className="mt-1 block font-sans text-xs font-normal text-text-muted">{locale==='es'?'Tipo del Códice':'Codex type'} · {project.codexTemplates?.find(item=>item.id===table.codexTemplateId)?.name??table.codexTemplateId}</span>}</h3><button className={button} disabled={busy || allTypes} onClick={() => { setInsertAt(null); setAddingColumn(true); setColumnDraft({ id: crypto.randomUUID(), name: '', kind: 'text' }); }}><Plus size={15} />{copy.column}</button>{table.mode!=='sheet'&&<button className={button} disabled={busy||!!formulaDraft} onClick={()=>void beginCalculation()}>{locale==='es'?'Añadir cálculo':'Add calculation'}</button>}<button className={button} onClick={() => setCsvExport(true)}><Download size={15} />{copy.export}</button><button className={button} data-testid="table-export-xlsx" disabled={busy} onClick={() => void downloadWorkbook()}><FileSpreadsheet size={15} />{locale === 'es' ? 'Excel (.xlsx)' : 'Excel (.xlsx)'}</button><button className={button} disabled={busy} aria-label={`${copy.remove} ${table.title}`} onClick={() => requestDelete(copy.removeDocument, () => deleteTable(projectId, table.id))}><Trash2 size={15} /></button></div>
        <WorkbookTabs tables={tables} table={table} locale={locale} busy={busy} onSelect={selectTable} onError={setError}
          onAdd={(sheet, makeWorkbook, viewCopy) => void run(async () => {
            await flushFilters();
            if (makeWorkbook) await changeTable(projectId, table.id, current => { current.workbook = { ...makeWorkbook, order: 0 }; });
            await addTableScoped(projectId, sheet, scope.eraId, viewCopy);
          }, () => { setSelectedId(sheet.id); resetLocalView(); })}
          onChange={(id, update) => void run(() => changeTable(projectId, id, update))}
          onDelete={id => { const sibling = workbookTabs(tables, table).find(item => item.id !== id && !item.workbook?.hidden); requestDelete(copy.removeDocument, async () => { await deleteTable(projectId, id); if (sibling) setSelectedId(sibling.id); }); }} />
        {formulaDraft&&<TableCalculationEditor draft={formulaDraft} columns={table.columns} inputRef={formulaRef} sharedType={Boolean(table.codexTemplateId)} busy={busy} locale={locale} onChange={setFormulaDraft} onToken={insertToken} onCancel={()=>setFormulaDraft(null)} onSave={()=>void run(async()=>{await saveTableCalculation(scope,formulaDraft);},()=>setFormulaDraft(null))}/>}
        {columnDraft && <form className="flex flex-wrap items-end gap-3 border-y border-border p-4" onSubmit={event => { event.preventDefault(); void run(async () => {
          if (addingColumn && insertAt !== null) await insertColumnAt(projectId, table.id, { ...columnDraft, field: table.codexType ? columnDraft.field?.trim() || columnDraft.name.trim() : undefined }, insertAt);
          else if (addingColumn) await addColumn(projectId, table.id, { ...columnDraft, field: table.codexType ? columnDraft.field?.trim() || columnDraft.name.trim() : undefined });
          else {
            try {
              await updateTableColumn(scope, table.id, columnDraft, columnVersion, columnTemplateRevision);
            } catch (reason) {
              if (reason instanceof Error && reason.message === 'table_column_kind_incompatible') throw new Error(copy.columnKindIncompatible);
              if (reason instanceof Error && reason.message === 'table_reference_invalid') throw new Error(copy.columnKindReferenceInvalid);
              throw reason;
            }
          }
        }, () => setColumnDraft(null)); }}>
          <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.columnName}<input className={control} required value={columnDraft.name} onChange={event => setColumnDraft({ ...columnDraft, name: event.target.value })} /></label>
          {(addingColumn ? table.mode !== 'sheet' : canChangeTableColumnKind(table, columnDraft)) && <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.columnKind}<select className={control} value={columnDraft.kind} disabled={busy} onChange={event => setColumnDraft({ ...columnDraft, kind: event.target.value as DataColumn['kind'] })}>{TABLE_COLUMN_KINDS.map(kind => <option key={kind} value={kind}>{copy[kind]}</option>)}</select></label>}
          {addingColumn && table.codexType && <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.field}<input className={control} value={columnDraft.field ?? ''} onChange={event => setColumnDraft({ ...columnDraft, field: event.target.value })} maxLength={200} /></label>}
          {!addingColumn && <label className="flex flex-col gap-1 text-sm text-text-primary">{copy.width}<input type="number" min={editedWidthLimits.min} max={editedWidthLimits.max} className={`${control} w-28`} value={columnDraft.width ?? DEFAULT_TABLE_COLUMN_WIDTH} onChange={event => setColumnDraft({ ...columnDraft, width: Number(event.target.value) })} /></label>}
          <button disabled={busy} type="submit" className={button}>{copy.save}</button><button type="button" className={button} onClick={() => setColumnDraft(null)}>{copy.cancel}</button>
        </form>}
        <div className="flex flex-wrap items-center gap-3 px-4 pb-3"><input className={`${control} min-w-40 flex-1`} aria-label={copy.search} placeholder={copy.search} value={query} onChange={event => { setQuery(event.target.value); setMatchAt(0); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); stepMatch(event.shiftKey ? -1 : 1); } }} />
          {query.trim() && <span className="flex items-center gap-1 text-xs tabular-nums text-text-muted" data-testid="table-find"><button type="button" className={button} aria-label={copy.findPrevious} disabled={!matches.length} onClick={() => stepMatch(-1)}><ChevronUp size={14} /></button><span data-testid="table-find-count">{matches.length ? `${Math.min(matchAt, matches.length - 1) + 1}/${matches.length}` : '0/0'}</span><button type="button" className={button} aria-label={copy.findNext} disabled={!matches.length} onClick={() => stepMatch(1)}><ChevronDown size={14} /></button></span>}
          {sorts.length > 0 && <button type="button" className={button} disabled={busy} onClick={() => saveView({ sorts: [] })}>{copy.clearSort}</button>}{Array.from({ length: groupControlCount }, (_, depth) => {
            const rule = groupRules[depth];
            const label = depth === 0 ? copy.group : depth === 1 ? copy.groupThen : copy.groupLevel.replace('{number}', String(depth + 1));
            return <div key={depth} className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-text-muted">{label}<select className={control} value={rule?.columnId ?? ''} disabled={busy} onChange={event => setGroupColumn(depth, event.target.value)}><option value="">{copy.none}</option>{table.columns.filter(column => column.id === rule?.columnId || !groupedColumns.has(column.id)).map(column => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
              {rule && <select className={control} aria-label={copy.groupOrder + ' · ' + label} value={rule.direction} disabled={busy} onChange={event => {
                const direction = event.target.value === 'desc' ? 'desc' : 'asc';
                saveView({ rules: groupRules.map((current, index) => index === depth ? { ...current, direction } : current) });
              }}><option value="asc">{copy.ascending}</option><option value="desc">{copy.descending}</option></select>}
            </div>;
          })}<span className="text-sm tabular-nums text-text-muted">{visible.length} {copy.count}</span></div>
        <TableFilters key={JSON.stringify([rowKey, filterEpoch])} columns={table.columns} conditions={conditions} stored={savedView.conditions} revision={savedView.conditionsRevision} busy={busy} copy={copy} registerFlush={registerFilterFlush}
          onDiscard={() => { setError(''); setFilterEpoch(value => value + 1); }}
          save={(next, expected) => saveTableView(projectId, table.id, { conditions: next }, { conditions: expected }, scope.eraId)} />
        {selectedRows.size > 0 && !live && <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm" data-testid="table-selection"><span className="text-text-muted">{copy.selected.replace('{count}', String(selectedRows.size))}</span>
          <button type="button" data-testid="table-selection-duplicate" className={button} disabled={busy} onClick={() => change(current => { duplicateRows(current, [...selectedRows]); })}><Copy size={14} />{copy.duplicateRows}</button>
          <button type="button" data-testid="table-selection-delete" className={`${button} text-danger`} disabled={busy} onClick={() => requestDelete(copy.removeRows.replace('{count}', String(selectedRows.size)), async () => { const ids = [...selectedRows]; await changeTable(projectId, table.id, current => { removeRows(current, ids); }); clearRowSelection(); })}><Trash2 size={14} />{copy.deleteRows}</button>
          <button type="button" className={button} onClick={clearRowSelection}>{copy.clearSelection}</button></div>}
        {table.mode === 'sheet' && <p className="px-4 pb-3 text-xs leading-relaxed text-text-muted">{copy.formulaHelp}</p>}
        <div className="min-h-0 flex-1 overflow-auto border-y border-border">
          <table ref={tableRef} {...keyboard.gridProps} aria-label={keyboard.enabled ? table.title : undefined} className="w-max min-w-full border-collapse text-sm text-text-primary"><thead className="sticky top-0 z-10 bg-surface"><tr><th className="border-r border-b border-border px-3 py-2 text-text-muted">{!live && <input type="checkbox" data-testid="table-select-all" aria-label={copy.selectAll} className="mr-2 accent-accent-gold" disabled={!expandedRows.length} checked={expandedRows.length > 0 && expandedRows.every(row => selectedRows.has(row.id))} onChange={event => selectShownRows(event.target.checked)} />}#</th>{table.columns.map((column, index) => <TableColumnHeader key={JSON.stringify([rowKey, column.id])} column={column}
            sort={sorts[0]?.id === column.id ? sorts[0].descending ? 'descending' : 'ascending' : 'none'}
            drop={columnDrag.target?.id === column.id ? columnDrag.target.side : undefined}
            resize={canResizeColumns ? { label: `${copy.resizeColumn} ${column.name}`, disabled: columnsBusy, save: (width, expected) => resizeColumn(column.id, width, expected) } : undefined}>
            {inlineRename?.columnId === column.id ? <form className={`flex min-w-0 gap-1 ${(column.width ?? DEFAULT_TABLE_COLUMN_WIDTH) < 100 ? 'flex-col' : 'items-center'}`}
              onSubmit={event => {
                event.preventDefault();
                const name = new FormData(event.currentTarget).get('name');
                if (typeof name === 'string') submitInlineRename(inlineRename, name);
              }} onKeyDown={event => {
                if (event.key !== 'Escape' || busy) return;
                event.preventDefault();
                event.stopPropagation();
                closeInlineRename(inlineRename);
              }}>
              <input name="name" required autoFocus defaultValue={inlineRename.name} aria-label={`${copy.columnName} · ${column.name}`}
                className={`${control} min-w-0 flex-1`} readOnly={busy} onFocus={event => event.currentTarget.select()} />
              <div className="flex shrink-0 gap-1">
                <button type="submit" aria-label={copy.save} title={copy.save} disabled={busy} className="rounded p-1.5 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold"><Check size={14} /></button>
                <button type="button" aria-label={copy.cancel} title={copy.cancel} disabled={busy} onClick={() => closeInlineRename(inlineRename)} className="rounded p-1.5 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold"><X size={14} /></button>
              </div>
            </form> :
            <div className={(column.width ?? 180) < 100 ? "flex w-full min-w-0 max-w-full flex-col items-start gap-1" : "flex items-center justify-between gap-1"} onKeyDown={event => {
              if (event.key !== 'F2' || !canResizeColumns || columnsBusy) return;
              event.preventDefault();
              event.stopPropagation();
              beginInlineRename(column);
            }}><button data-table-column-sort {...columnDrag.bind(column.id)} className={(column.width ?? 180) < 100 ? "flex min-h-9 w-full min-w-0 max-w-full items-center gap-2 text-left hover:text-accent-gold" : "flex min-h-9 min-w-0 items-center gap-2 text-left hover:text-accent-gold"} disabled={busy && !formulaDraft} onClick={event => formulaDraft?insertToken(`@[${column.name}]`):saveView({ sorts: toggleSort(sorts, column.id, event.shiftKey) })} title={[canResizeColumns || (column.width ?? 180) < 100 ? column.name : '', copy.sortMore, columnDragEnabled ? copy.dragColumn : ''].filter(Boolean).join(' · ')}><span className={(column.width ?? 180) < 100 ? "w-0 min-w-0 flex-1 truncate" : canResizeColumns ? "min-w-0 truncate" : undefined}>{table.mode === 'sheet' ? `${cellKey(index, 0).replace(/\d+$/, '')} · ` : ''}{column.name}</span><ArrowDownUp size={12} className={canResizeColumns || (column.width ?? 180) < 100 ? "shrink-0" : undefined} />{sorts.length > 1 && sorts.some(item => item.id === column.id) && <span data-testid={`table-sort-rank-${column.name}`} className="rounded bg-elevated px-1 text-[10px] text-accent-gold">{sorts.findIndex(item => item.id === column.id) + 1}{sorts.find(item => item.id === column.id)!.descending ? '↓' : '↑'}</span>}</button>
              {canResizeColumns && <button type="button" aria-label={`${copy.renameColumn} ${column.name}`} aria-keyshortcuts="F2" title={`${copy.renameColumn} (F2)`}
                disabled={columnsBusy} onClick={() => beginInlineRename(column)} className="inline-flex min-h-9 min-w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-40"><Pencil size={14} /></button>}
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
            </div>}
          </TableColumnHeader>)}<th className="border-b border-border px-2" /></tr></thead>
            <tbody>{groupItems.map(item => {
              if (item.kind === 'group') return <tr key={`group:${item.key}`} hidden={item.hidden} data-table-group-depth={item.depth + 1}>
                <th colSpan={table.columns.length + 2} className="bg-elevated px-2 py-1 text-left font-medium">
                  <button type="button" aria-expanded={item.expanded} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent-gold" style={{ paddingInlineStart: item.depth ? 'min(' + (0.5 + item.depth * 1.25) + 'rem, 35%)' : undefined }} onClick={() => updateFolded(folded => {
                    if (folded.has(item.key)) folded.delete(item.key);
                    else folded.add(item.key);
                  })}>{item.expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}<span className="break-words">{item.label || copy.emptyGroup}</span><span className="text-xs text-text-muted">{item.count} {item.count === 1 ? copy.oneRow : copy.count}</span></button>
                </th>
              </tr>;
              const row = item.row, index = visiblePosition.get(row.id)!;
              const savedIndex = rowPosition.get(row.id) ?? -1;
              return <TableRow key={`row:${row.id}`} row={row} keyboard={keyboard} hidden={item.hidden} savedIndex={savedIndex} columns={table.columns} calculatedColumnIds={allTypes ? table.columns.map(column => column.id) : projected?.calculatedColumnIds??[]} display={displayValue} calculatedFields={live ? Object.entries(projectedEntries.get(row.id)?.properties ?? {}).filter(([, value]) => value.calculated).map(([key]) => key) : []} entries={entries} sheet={table.mode === 'sheet'} disabled={busy || allTypes} copy={copy} value={rowValue} save={saveValue} openEntry={id => navigate(`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(id)}`)} selected={selectedRows.has(row.id)} onSelect={live ? undefined : (checked, extend) => selectRow(row.id, checked, extend)} matchColumnId={currentMatch?.rowId === row.id ? currentMatch.columnId : undefined} onDuplicate={live ? undefined : () => change(current => { duplicateRow(current, row.id); })} onInsertBelow={live ? undefined : () => change(current => { const at = current.rows.findIndex(item => item.id === row.id); insertRow(current, at + 1); })} rowOrderDisabled={!rowReady || rowWorking || busy} onInsertAbove={live ? undefined : () => void changeRows({ action: 'insert-row', beforeRowId: row.id })} onMoveUp={index === 0 ? undefined : () => void changeRows({ action: 'move-row', rowId: row.id, beforeRowId: visible[index - 1].id })} onMoveDown={index === visible.length - 1 ? undefined : () => void changeRows({ action: 'move-row', rowId: row.id, beforeRowId: visible[index + 2]?.id })} onRowPointerDown={event => beginRowDrag(row.id, event)} onRowPointerMove={moveRowPointer} onRowPointerEnd={endRowPointer} dropBefore={rowDrop?.epoch === rowOwner.current.epoch && rowDrop.id === row.id} action={live ? () => setEntryDraft(entries.find(entry => entry.id === row.id)!) : () => requestDelete(copy.removeRow, () => changeTable(projectId, table.id, current => { current.rows = current.rows.filter(item => item.id !== row.id); }))} live={live} />;
            })}</tbody>
          </table>
          {visible.length === 0 && <p className="p-5 text-sm text-text-muted">{copy.noRows}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 p-4" data-table-row-end={storedTable?.id}>{allTypes ? <p className="text-xs text-text-muted" data-testid="table-all-types-note">{copy.allTypesNote}</p> : <button className={button} disabled={busy || rows.length >= 20000} onClick={() => {
          if (table.codexType) { const now = Date.now(); setEntryDraft({ id: crypto.randomUUID(), projectId, type: table.codexType, templateId:table.codexTemplateId, title: '', fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now }); }
          else change(current => { current.rows.push({ id: crypto.randomUUID(), cells: {} }); });
        }}><Plus size={16} />{table.codexType ? copy.newCard : copy.addRow}</button>}<p className="text-xs text-text-muted" id={keyboard.enabled ? keyboard.hintId : undefined}>{copy.cellHint}{keyboard.enabled && ` ${sheetKeyboard ? copy.sheetKeyboardHint : copy.cellKeyboardHint}`}</p></footer>
      </div>}
    </div>
    <ConfirmDialog open={Boolean(confirmation)} destructive message={confirmation?.message ?? ''} onCancel={() => setConfirmation(null)} onConfirm={async () => { if (confirmation) await run(confirmation.work, () => setConfirmation(null)); }} />
    <Modal open={Boolean(entryDraft)} title={copy.editCard} onClose={() => setEntryDraft(null)} wide>{entryDraft && <CodexEntryForm key={entryDraft.id} projectId={projectId} entry={entryDraft} onCancel={() => setEntryDraft(null)} onSave={async (draft, base) => { const existing = await readEraRow<CodexEntry>(scope, 'codexEntries', draft.id); if (existing && base) await saveCodexDraft(base, draft, scope); else if (scope.eraId) await mutateEraRows(scope, [{ table: 'codexEntries', id: draft.id, row: draft as unknown as EraRow }]); else await createCodexEntry(draft); notifyDataChanged({ source: 'other', table: 'codexEntries', projectId, entityId: draft.id }); setEntryDraft(null); }} />}</Modal>
  </section>;
}

function TableFilters({ columns, conditions, stored, revision, copy, busy, save, onDiscard, registerFlush }: {
  columns: readonly DataColumn[]; conditions: TableCondition[]; stored: TableCondition[]; revision: number;
  copy: typeof tableCopy.en; busy: boolean;
  save: (conditions: TableCondition[], expected: string) => Promise<number>;
  onDiscard: () => void;
  registerFlush: (flush: () => Promise<boolean>) => () => void;
}) {
  const [acknowledged, setAcknowledged] = useState<{ revision: number; conditions: TableCondition[] }>();
  const confirmed = confirmedTableFilters(revision, stored, conditions, acknowledged);
  const expected = useRef(confirmed.stamp);
  const [discarding, setDiscarding] = useState(false);
  const field = useDebouncedField(JSON.stringify(confirmed.visible), async encoded => {
    const next = JSON.parse(encoded) as TableCondition[];
    const savedRevision = await save(next, expected.current);
    // The shared hook serializes its writes; queued text follows the prior successful draft.
    expected.current = filterStamp(savedRevision, next);
    setAcknowledged({ revision: savedRevision, conditions: next });
  });
  const { flush } = field;
  useEffect(() => registerFlush(flush), [registerFlush, flush]);
  const draft = JSON.parse(field.value) as TableCondition[];
  const edit = (next: TableCondition[], immediate = true) => {
    if (!field.dirty && !field.saving && !field.error) expected.current = confirmed.stamp;
    field.onChange(JSON.stringify(next));
    if (immediate) void field.flush();
  };
  return <div className="space-y-2 px-4 pb-3" data-testid={draft.length ? 'table-filters' : undefined}>
    <button type="button" data-testid="table-filter-add" className={button} disabled={busy || !columns.length || Boolean(field.error)}
      onClick={() => edit([...draft, { columnId: columns[0].id, op: 'contains', value: '' }])}><Filter size={14} />{copy.addFilter}</button>
    {draft.map((condition, at) => <div key={at} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-text-muted">{at === 0 ? copy.where : copy.and}</span>
      <select data-testid={'table-filter-column-' + at} className={control} value={condition.columnId} disabled={busy || Boolean(field.error)} onChange={event => edit(draft.map((item, i) => i === at ? { ...item, columnId: event.target.value } : item))}>{columns.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}</select>
      <select data-testid={'table-filter-op-' + at} className={control} value={condition.op} disabled={busy || Boolean(field.error)} onChange={event => edit(draft.map((item, i) => i === at ? { ...item, op: event.target.value as TableCondition['op'] } : item))}>{CONDITION_OPS.map(op => <option key={op} value={op}>{copy.ops[op]}</option>)}</select>
      {!['empty', 'notEmpty', 'checked', 'unchecked'].includes(condition.op) && <input data-testid={'table-filter-value-' + at} className={control} value={condition.value ?? ''} disabled={Boolean(field.error)}
        onChange={event => edit(draft.map((item, i) => i === at ? { ...item, value: event.target.value } : item), false)} onBlur={field.onBlur}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void field.flush(); } }} />}
      <button type="button" className={button} disabled={busy || Boolean(field.error)} aria-label={copy.removeFilter} onClick={() => edit(draft.filter((_, i) => i !== at))}><X size={14} /></button>
    </div>)}
    {field.error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
      {field.error.message}<button type="button" className={button} disabled={discarding} onClick={async () => { setDiscarding(true); await field.discard(); onDiscard(); }}>{copy.reloadFilters}</button>
    </div>}
  </div>;
}

function TableRow({ row, keyboard, savedIndex, columns, calculatedColumnIds,display,calculatedFields, entries, sheet, disabled, copy, hidden, value, save, openEntry, action, live, selected, onSelect, matchColumnId, onDuplicate, onInsertBelow, rowOrderDisabled, onInsertAbove, onMoveUp, onMoveDown, onRowPointerDown, onRowPointerMove, onRowPointerEnd, dropBefore }: {
  row: DataRow; keyboard: Pick<ReturnType<typeof useTableCellNavigation>, 'enabled' | 'cellProps' | 'trackWrite' | 'bindTextEditor'>; savedIndex: number; columns: DataColumn[];calculatedColumnIds:string[];display:(row:DataRow,column:DataColumn)=>string; calculatedFields: string[]; entries: CodexEntry[]; sheet: boolean; disabled: boolean; copy: typeof tableCopy.en; hidden: boolean;
  value: (row: DataRow, column: DataColumn) => string; save: (row: DataRow, column: DataColumn, value: string) => Promise<void>; openEntry: (id: string) => void; action: () => void; live: boolean;
  selected?: boolean; onSelect?: (checked: boolean, extend: boolean) => void; matchColumnId?: string; onDuplicate?: () => void; onInsertBelow?: () => void; rowOrderDisabled?: boolean; onInsertAbove?: () => void; onMoveUp?: () => void; onMoveDown?: () => void; onRowPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void; onRowPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void; onRowPointerEnd?: (event: ReactPointerEvent<HTMLButtonElement>, cancelled?: boolean) => void; dropBefore?: boolean;
}) {
  return <tr hidden={hidden} className={selected ? 'bg-accent-gold/10' : 'hover:bg-surface/50'} data-row-id={row.id} style={dropBefore ? { boxShadow: 'inset 0 2px 0 var(--color-accent-gold)' } : undefined}><th className="border-r border-b border-border px-3 text-xs font-normal tabular-nums text-text-muted">{onRowPointerDown && <button type="button" data-table-row-handle disabled={rowOrderDisabled} aria-label={`${copy.dragRow} ${savedIndex + 1}`} title={copy.dragRow} className="inline-flex h-9 w-9 items-center justify-center rounded text-text-muted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-40" style={{ touchAction: 'none' }} onPointerDown={onRowPointerDown} onPointerMove={onRowPointerMove} onPointerUp={event => onRowPointerEnd?.(event)} onPointerCancel={event => onRowPointerEnd?.(event, true)} onLostPointerCapture={event => onRowPointerEnd?.(event, true)}><GripVertical size={15} /></button>}{onSelect && <input type="checkbox" data-testid={`table-select-row-${savedIndex + 1}`} aria-label={`${copy.selectRow} ${savedIndex + 1}`} className="mr-2 accent-accent-gold" checked={!!selected} onChange={event => onSelect(event.target.checked, 'shiftKey' in event.nativeEvent && event.nativeEvent.shiftKey === true)} />}{savedIndex + 1}</th>{columns.map((column, columnIndex) => {
    const raw = row.cells[column.id] ?? ''; const computed = value(row, column); const label = `${cellKey(columnIndex, savedIndex)} ${column.name}`;
    return <td key={column.id} {...keyboard.cellProps(row.id, column.id)} data-cell={`${row.id}:${column.id}`} data-match={matchColumnId === column.id ? 'current' : undefined} className="border-r border-b border-border p-0 align-top data-[keyboard-selected=true]:bg-accent-gold/10 data-[keyboard-active=true]:ring-1 data-[keyboard-active=true]:ring-inset data-[keyboard-active=true]:ring-accent-gold" style={{ maxWidth: column.width ?? 180, ...(matchColumnId === column.id ? { outline: '2px solid #c4973b', outlineOffset: -2 } : {}) }}>
      {calculatedColumnIds.includes(column.id)?<output className={`block min-h-11 break-words px-3 py-2 ${computed.startsWith('#')?'text-danger':'text-text-primary'}`} aria-label={label}>{display(row,column)||'—'}</output>:<TableCell raw={raw} label={label} column={column} entries={entries} sheet={sheet} keyboard={keyboard.enabled} trackWrite={keyboard.enabled ? keyboard.trackWrite : undefined} bindTextEditor={sheet && keyboard.enabled ? keyboard.bindTextEditor : undefined} disabled={disabled || calculatedFields.includes(column.field ?? column.name)} copy={copy} save={value => save(row, column, value)} openEntry={openEntry} />}
      {sheet && raw.startsWith('=') && <output className={`block px-3 pb-2 text-xs ${computed.startsWith('#') ? 'text-danger' : 'text-accent-gold'}`} aria-label={`${copy.value} ${label}`}>{computed}</output>}
    </td>;
  })}<td className="border-b border-border px-2 whitespace-nowrap">{onRowPointerDown && <details className="relative inline-block"><summary aria-label={`${copy.rowActions} ${savedIndex + 1}`} className="inline-flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded text-text-muted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold"><Settings2 size={15}/></summary><div className="absolute right-0 z-20 flex w-48 flex-col gap-1 rounded-lg border border-border bg-surface p-1 shadow-lg" onClick={event => { if ((event.target as Element).closest('button')) event.currentTarget.parentElement?.removeAttribute('open'); }}>{onInsertAbove && <button type="button" disabled={rowOrderDisabled} className={`${button} w-full justify-start`} onClick={onInsertAbove}>{copy.insertAbove}</button>}<button type="button" disabled={rowOrderDisabled || !onMoveUp} className={`${button} w-full justify-start`} onClick={onMoveUp}>{copy.moveRowUp}</button><button type="button" disabled={rowOrderDisabled || !onMoveDown} className={`${button} w-full justify-start`} onClick={onMoveDown}>{copy.moveRowDown}</button></div></details>}{onInsertBelow && <button className="rounded p-2 text-text-muted hover:bg-elevated" disabled={disabled} aria-label={`${copy.insertBelow} ${savedIndex + 1}`} title={copy.insertBelow} onClick={onInsertBelow}><Plus size={15} /></button>}{onDuplicate && <button className="rounded p-2 text-text-muted hover:bg-elevated" disabled={disabled} aria-label={`${copy.duplicateRow} ${savedIndex + 1}`} title={copy.duplicateRow} onClick={onDuplicate}><Copy size={15} /></button>}<button className="rounded p-2 text-text-muted hover:bg-elevated" disabled={disabled} aria-label={live ? copy.editCard : `${copy.remove} ${savedIndex + 1}`} onClick={action}>{live ? <Settings2 size={15} /> : <Trash2 size={15} />}</button></td></tr>;
}

function TableCell({ raw, label, column, entries, sheet, keyboard, trackWrite, bindTextEditor, disabled, copy, save, openEntry }: { raw: string; label: string; column: DataColumn; entries: CodexEntry[]; sheet: boolean; keyboard: boolean; trackWrite?: (work: Promise<boolean>) => void; bindTextEditor?: (editor: HTMLInputElement, replaceText: (text: string) => void) => void; disabled: boolean; copy: typeof tableCopy.en; save: (value: string) => Promise<void>; openEntry: (id: string) => void }) {
  const field = useDebouncedField(raw, save, { delayMs: 750 });
  const onBlur = () => {
    if (trackWrite) trackWrite(field.flush());
    else field.onBlur();
  };
  return <>
    {!sheet && column.kind === 'checkbox' ? <input className="m-3 accent-accent-gold" type="checkbox" aria-label={label} checked={field.value === 'true'} disabled={disabled} onChange={event => field.onChange(String(event.target.checked))} onBlur={onBlur} />
      : !sheet && column.kind === 'reference' ? <div className="flex items-center"><select className="min-w-0 flex-1 bg-transparent p-3 outline-accent-gold" aria-label={label} value={field.value} disabled={disabled} onChange={event => field.onChange(event.target.value)} onBlur={onBlur}><option value="">{copy.noLink}</option>{field.value && !entries.some(entry => entry.id === field.value) && <option value={field.value}>{copy.missingLink}</option>}{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select>{entries.some(entry => entry.id === field.value) && <button className="mr-2 rounded p-1 text-accent-gold" aria-label={copy.openCard} onClick={() => openEntry(field.value)}><ExternalLink size={14} /></button>}</div>
        : !sheet && column.kind === 'text' ? <textarea aria-label={label} tabIndex={keyboard ? -1 : undefined} title={`${copy.cellHint} Shift+Enter: ↵`} rows={Math.min(8, field.value.split('\n').length)} className="block min-h-11 w-full min-w-0 resize-y bg-transparent px-3 py-2 outline-accent-gold focus:bg-elevated" value={field.value} disabled={disabled} onChange={event => field.onChange(event.target.value)} onBlur={onBlur} onKeyDown={event => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); field.onChange(raw); event.currentTarget.blur(); } }} />
          : <input ref={bindTextEditor ? element => { if (element) bindTextEditor(element, field.onChange); } : undefined} aria-label={label} tabIndex={keyboard ? -1 : undefined} title={copy.cellHint} className="min-h-11 w-full min-w-0 bg-transparent px-3 py-2 outline-accent-gold focus:bg-elevated" value={field.value} disabled={disabled} onChange={event => field.onChange(event.target.value)} onBlur={onBlur} onKeyDown={event => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { field.onChange(raw); event.currentTarget.blur(); } }} />}
    {field.error && <div role="alert" className="px-3 pb-2 text-xs text-danger"><p>{copy.error}</p><button className="mt-2 underline underline-offset-2" onClick={() => { void field.retry(); }}>{copy.retry}</button></div>}
  </>;
}
