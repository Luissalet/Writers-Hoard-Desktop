import { useRef, useState, type AriaAttributes, type PropsWithChildren, type PointerEvent } from 'react';
import { clampTableColumnWidth, DEFAULT_TABLE_COLUMN_WIDTH, tableColumnWidthLimits } from './tableEdits';
import type { DataColumn } from './types';

interface ColumnResize {
  label: string;
  disabled: boolean;
  save: (width: number, expectedWidth: number | undefined) => void;
}

interface ColumnResizeDrag {
  pointerId: number;
  x: number;
  direction: 1 | -1;
  width: number | undefined;
}

function widthAt(drag: ColumnResizeDrag, x: number): number {
  const startWidth = drag.width ?? DEFAULT_TABLE_COLUMN_WIDTH;
  const offset = Math.round((x - drag.x) * drag.direction);
  return clampTableColumnWidth(startWidth + offset, drag.width);
}

export default function TableColumnHeader({ column, sort, drop, resize, children }: PropsWithChildren<{
  column: DataColumn;
  sort: AriaAttributes['aria-sort'];
  drop?: 'before' | 'after';
  resize?: ColumnResize;
}>) {
  const active = useRef<ColumnResizeDrag>(undefined);
  const [preview, setPreview] = useState<number>();
  const savedWidth = column.width ?? DEFAULT_TABLE_COLUMN_WIDTH;
  const width = preview ?? savedWidth;
  const limits = tableColumnWidthLimits(column.width);

  const finish = (handle: HTMLDivElement, pointerId: number) => {
    active.current = undefined;
    setPreview(undefined);
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  };

  const end = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = active.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    finish(event.currentTarget, event.pointerId);
    if (cancelled || !resize || resize.disabled) return;
    const next = widthAt(drag, event.clientX);
    if (next !== (drag.width ?? DEFAULT_TABLE_COLUMN_WIDTH)) resize.save(next, drag.width);
  };

  return <th data-table-column-id={column.id} data-table-column-drop={drop}
    style={{ width, minWidth: width, maxWidth: resize ? width : undefined }}
    className="relative border-r border-b border-border p-2 text-left font-medium" aria-sort={sort}>
    {drop && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent-gold"
      style={drop === 'before' ? { insetInlineStart: 0 } : { insetInlineEnd: 0 }} />}
    {children}
    {resize && <div role="separator" aria-orientation="vertical" aria-label={resize.label}
      aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={width}
      aria-disabled={resize.disabled || undefined} tabIndex={resize.disabled ? -1 : 0} title={resize.label}
      className="absolute inset-y-0 end-0 w-2 cursor-col-resize border-e-2 border-transparent hover:border-accent-gold focus-visible:border-accent-gold aria-disabled:pointer-events-none"
      style={{ touchAction: 'none', ...(preview !== undefined ? { borderColor: 'var(--color-accent-gold)' } : {}) }}
      onPointerDown={event => {
        if (resize.disabled || active.current || !event.isPrimary || event.button !== 0) return;
        const handle = event.currentTarget;
        try { handle.setPointerCapture(event.pointerId); } catch { return; }
        event.preventDefault();
        handle.focus({ preventScroll: true });
        active.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          direction: getComputedStyle(handle).direction === 'rtl' ? -1 : 1,
          width: column.width,
        };
      }}
      onPointerMove={event => {
        const drag = active.current;
        if (drag?.pointerId === event.pointerId) setPreview(widthAt(drag, event.clientX));
      }}
      onPointerUp={end}
      onPointerCancel={event => end(event, true)}
      onLostPointerCapture={event => end(event, true)}
      onKeyDown={event => {
        const drag = active.current;
        if (event.key === 'Escape' && drag) {
          event.preventDefault();
          event.stopPropagation();
          finish(event.currentTarget, drag.pointerId);
        } else if (!drag && !resize.disabled && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
          const delta = (event.key === 'ArrowRight') !== rtl ? 10 : -10;
          const next = clampTableColumnWidth(savedWidth + delta, column.width);
          if (next !== savedWidth) resize.save(next, column.width);
        }
      }} />}
  </th>;
}
