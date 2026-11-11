import { useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { serializeTableClipboard } from './tableClipboard';

interface CellPosition { rowId: string; columnId: string }
interface CellSelection {
  owner: number;
  focus: CellPosition;
  anchor: CellPosition;
  appended?: { position: CellPosition; viewKey: string };
}
interface TableCellNavigationOptions {
  enabled: boolean;
  owner: number;
  viewKey: string;
  tableRef: RefObject<HTMLTableElement | null>;
  rows: readonly { id: string }[];
  columns: readonly { id: string }[];
  appendRow?: () => Promise<string | undefined>;
  readCell: (row: number, column: number) => string;
  pasteFrom: (text: string, row: number, column: number) => void;
}

const arrowSteps: Record<string, readonly [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};
const clamp = (value: number, count: number) => Math.max(0, Math.min(count - 1, value));
const sameCell = (a: CellPosition | undefined, b: CellPosition) => !!a && a.rowId === b.rowId && a.columnId === b.columnId;

function positionAt(target: EventTarget | null): CellPosition | undefined {
  const cell = target instanceof Element ? target.closest<HTMLElement>('[data-keyboard-cell-row]') : null;
  const rowId = cell?.dataset.keyboardCellRow, columnId = cell?.dataset.keyboardCellColumn;
  return rowId !== undefined && columnId !== undefined ? { rowId, columnId } : undefined;
}

export function useTableCellNavigation({ enabled, owner, viewKey, tableRef, rows, columns, appendRow, readCell, pasteFrom }: TableCellNavigationOptions) {
  const id = useId();
  const hintId = id + '-hint';
  const [selection, setSelection] = useState<CellSelection>();
  const appending = useRef<{ owner: number }>(undefined);
  const flushing = useRef(new Map<Promise<boolean>, number>());
  const rowIndices = new Map(enabled ? rows.map((row, index) => [row.id, index]) : []);
  const columnIndices = new Map(enabled ? columns.map((column, index) => [column.id, index]) : []);
  const cellAt = (row: number, column: number): CellPosition | undefined =>
    rows[row] && columns[column] ? { rowId: rows[row].id, columnId: columns[column].id } : undefined;
  const visible = (position: CellPosition | undefined): position is CellPosition =>
    !!position && rowIndices.has(position.rowId) && columnIndices.has(position.columnId);
  const scoped = enabled && selection?.owner === owner ? selection : undefined;
  const deferred = scoped?.appended?.viewKey === viewKey ? scoped.appended.position : undefined;
  const added = visible(deferred) ? deferred : undefined;
  if (scoped?.appended && (added || !deferred)) {
    const focus = added ?? scoped.focus;
    setSelection({ owner, focus, anchor: added ?? scoped.anchor });
  }
  const active = scoped && (added ?? (visible(scoped.focus) ? scoped.focus : cellAt(0, 0)));
  const anchor = active && !added && visible(scoped?.anchor) ? scoped.anchor : active;
  const bounds = active && anchor ? {
    firstRow: Math.min(rowIndices.get(anchor.rowId)!, rowIndices.get(active.rowId)!),
    lastRow: Math.max(rowIndices.get(anchor.rowId)!, rowIndices.get(active.rowId)!),
    firstColumn: Math.min(columnIndices.get(anchor.columnId)!, columnIndices.get(active.columnId)!),
    lastColumn: Math.max(columnIndices.get(anchor.columnId)!, columnIndices.get(active.columnId)!),
  } : undefined;
  const cellId = (position: CellPosition) => id + '-' + encodeURIComponent(JSON.stringify([position.rowId, position.columnId]));
  const activeId = active ? cellId(active) : undefined;
  const lookup = (position: CellPosition) => tableRef.current?.querySelector<HTMLElement>('#' + CSS.escape(cellId(position)));

  useLayoutEffect(() => {
    const grid = tableRef.current;
    if (activeId && grid && grid === document.activeElement) {
      grid.querySelector('#' + CSS.escape(activeId))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeId, tableRef]);

  const select = (position: CellPosition, from = position) => {
    setSelection({ owner, focus: position, anchor: from });
  };
  const focusGrid = (grid: HTMLTableElement, position: CellPosition, from?: CellPosition) => {
    select(position, from);
    grid.focus({ preventScroll: true });
  };
  const onFocus = (event: FocusEvent<HTMLTableElement>) => {
    const position = positionAt(event.target);
    if (position && !sameCell(active, position)) select(position);
    if (event.target === event.currentTarget && !active) {
      const first = cellAt(0, 0);
      if (first) setSelection(current => current?.owner === owner ? current : { owner, focus: first, anchor: first });
    }
  };
  const onPointerDown = (event: PointerEvent<HTMLTableElement>) => {
    const position = positionAt(event.target);
    if (!position || event.pointerType !== 'mouse' || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof Element)) return;
    if (event.target.closest('button, select, input[type="checkbox"]') ||
        event.target.matches('input:focus, textarea:focus')) return;
    event.preventDefault();
    focusGrid(event.currentTarget, position);
  };
  const beginEdit = (position: CellPosition) => {
    const editor = lookup(position)?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
    if (!editor) return;
    select(position);
    editor.focus();
  };
  const onDoubleClick = (event: MouseEvent<HTMLTableElement>) => {
    const position = positionAt(event.target);
    if (position && event.target instanceof Element && !event.target.closest('button, select, input[type="checkbox"]')) beginEdit(position);
  };
  const trackWrite = (work: Promise<boolean>) => {
    flushing.current.set(work, owner);
    const clear = () => { if (flushing.current.get(work) === owner) flushing.current.delete(work); };
    void work.then(clear, clear);
  };
  const hasPendingWrite = () => [...flushing.current.values()].includes(owner);
  const appendFrom = (grid: HTMLTableElement, position: CellPosition) => {
    if (!appendRow || appending.current?.owner === owner || hasPendingWrite()) return;
    const request = { owner };
    appending.current = request;
    void appendRow().then(rowId => {
      if (!rowId || appending.current !== request || document.activeElement !== grid || tableRef.current !== grid) return;
      const columnId = columns[0]?.id;
      if (columnId === undefined) return;
      setSelection(current => current?.owner === owner && sameCell(current.focus, position)
        ? { ...current, appended: { position: { rowId, columnId }, viewKey } } : current);
    }).finally(() => { if (appending.current === request) appending.current = undefined; });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const grid = event.currentTarget;
    const fromGrid = event.target === grid;
    const fromEditor = event.target instanceof Element && event.target.matches('input, textarea, select');
    if (!fromGrid && !fromEditor) return;
    const position = fromGrid ? active : positionAt(event.target);
    if (event.key === 'Escape') {
      if (!position) return;
      event.preventDefault();
      if (fromGrid) setSelection(undefined);
      else focusGrid(grid, position);
      return;
    }
    if (!position) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (fromGrid) beginEdit(position);
      else focusGrid(grid, position);
      return;
    }
    const arrow = fromGrid && Object.hasOwn(arrowSteps, event.key) ? arrowSteps[event.key] : undefined;
    if (!arrow && event.key !== 'Tab') return;
    if (!fromGrid && event.key === 'Tab' && !event.shiftKey && event.target instanceof HTMLSelectElement &&
        lookup(position)?.querySelector('button:not([disabled])')) return;
    const row = rowIndices.get(position.rowId), column = columnIndices.get(position.columnId);
    if (row === undefined || column === undefined) return;
    event.preventDefault();
    if (arrow) {
      const next = cellAt(clamp(row + arrow[0], rows.length), clamp(column + arrow[1], columns.length));
      if (next) focusGrid(grid, next, event.shiftKey ? anchor ?? position : next);
      return;
    }
    const offset = row * columns.length + column + (event.shiftKey ? -1 : 1);
    if (offset < 0) {
      if (!fromGrid) focusGrid(grid, position);
      return;
    }
    if (offset >= rows.length * columns.length) {
      focusGrid(grid, position);
      if (fromGrid && !event.repeat) appendFrom(grid, position);
      return;
    }
    const next = cellAt(Math.floor(offset / columns.length), offset % columns.length);
    if (next) focusGrid(grid, next);
  };

  const onCopy = (event: ClipboardEvent<HTMLTableElement>) => {
    if (event.target !== event.currentTarget || !bounds) return;
    const values: string[][] = [];
    for (let row = bounds.firstRow; row <= bounds.lastRow; row++) {
      const cells: string[] = [];
      for (let column = bounds.firstColumn; column <= bounds.lastColumn; column++) cells.push(readCell(row, column));
      values.push(cells);
    }
    event.clipboardData.setData('text/plain', serializeTableClipboard(values));
    event.preventDefault();
  };
  const onPaste = (event: ClipboardEvent<HTMLTableElement>) => {
    if (event.target !== event.currentTarget || !bounds) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    if (!hasPendingWrite()) pasteFrom(text, bounds.firstRow, bounds.firstColumn);
  };
  const isSelected = (position: CellPosition) => {
    if (!bounds) return false;
    const row = rowIndices.get(position.rowId), column = columnIndices.get(position.columnId);
    return row !== undefined && column !== undefined &&
      row >= bounds.firstRow && row <= bounds.lastRow && column >= bounds.firstColumn && column <= bounds.lastColumn;
  };
  const cellProps = (rowId: string, columnId: string) => {
    if (!enabled) return {};
    const position = { rowId, columnId };
    const selected = isSelected(position);
    return { id: cellId(position), role: 'gridcell' as const, 'aria-selected': selected,
      'data-keyboard-cell-row': rowId, 'data-keyboard-cell-column': columnId,
      'data-keyboard-selected': selected, 'data-keyboard-active': sameCell(active, position) };
  };
  return { enabled, hintId, cellProps, trackWrite, gridProps: enabled ? {
    role: 'grid' as const, tabIndex: 0, 'aria-activedescendant': activeId, 'aria-multiselectable': true,
    'aria-describedby': hintId,
    onFocus, onPointerDown, onDoubleClick, onKeyDown, onCopy, onPaste,
  } : {} };
}
