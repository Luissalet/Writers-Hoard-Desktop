import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { DataColumn } from './types';

type ColumnDrop = { id: string; side: 'before' | 'after' };
type ColumnDrag = {
  owner: string;
  id: string;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  handle: HTMLButtonElement;
  table: HTMLTableElement;
  order: string[];
  cancelled: boolean;
};

const handleStyle: CSSProperties = { cursor: 'grab', touchAction: 'pan-y', userSelect: 'none' };

function targetAt(event: PointerEvent<HTMLButtonElement>, drag: ColumnDrag): ColumnDrop | undefined {
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const heading = hit?.closest<HTMLElement>('th[data-table-column-id]');
  const id = heading?.dataset.tableColumnId;
  if (!heading || heading.closest('table') !== drag.table || !id || id === drag.id) return undefined;
  const rect = heading.getBoundingClientRect();
  const before = event.clientX < rect.left + rect.width / 2;
  const rtl = getComputedStyle(heading).direction === 'rtl';
  const side = before !== rtl ? 'before' : 'after';
  const sourceIndex = drag.order.indexOf(drag.id);
  const targetIndex = drag.order.indexOf(id);
  if (targetIndex < 0 || targetIndex === sourceIndex + (side === 'before' ? 1 : -1)) return undefined;
  return { id, side };
}

function release(drag: ColumnDrag) {
  if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
}

export function useTableColumnDrag(
  owner: string,
  columns: readonly DataColumn[],
  enabled: boolean,
  move: (id: string, target: ColumnDrop, expectedOrder: readonly string[]) => void,
) {
  const active = useRef<ColumnDrag>(undefined);
  const suppressClick = useRef<string>(undefined);
  const [preview, setPreview] = useState<{ owner: string; target: ColumnDrop }>();
  const [previousOwner, setPreviousOwner] = useState(owner);
  if (previousOwner !== owner) {
    setPreviousOwner(owner);
    setPreview(undefined);
  }

  useEffect(() => () => {
    const drag = active.current;
    active.current = undefined;
    suppressClick.current = undefined;
    if (drag) release(drag);
  }, [owner]);

  const start = (id: string, event: PointerEvent<HTMLButtonElement>) => {
    suppressClick.current = undefined;
    if (!enabled || active.current || !event.isPrimary || event.button !== 0) return;
    const handle = event.currentTarget;
    const table = handle.closest('table');
    if (!table) return;
    try { handle.setPointerCapture(event.pointerId); } catch { return; }
    event.preventDefault();
    handle.focus({ preventScroll: true });
    active.current = {
      owner, id, handle, table, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      moved: false, cancelled: false, order: columns.map(column => column.id),
    };
  };

  const update = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = active.current;
    if (!drag || drag.cancelled || drag.owner !== owner || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    drag.moved = true;
    event.preventDefault();
    const target = targetAt(event, drag);
    setPreview(previous => {
      if (!target) return undefined;
      if (previous?.owner === owner && previous.target.id === target.id && previous.target.side === target.side) return previous;
      return { owner, target };
    });
  };

  const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = active.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    active.current = undefined;
    setPreview(undefined);
    release(drag);
    if (!drag.moved) return;
    suppressClick.current = drag.id;
    if (cancelled || drag.cancelled || !enabled || drag.owner !== owner) return;
    const target = targetAt(event, drag);
    if (target) move(drag.id, target, drag.order);
  };

  return {
    target: preview?.owner === owner ? preview.target : undefined,
    hasActivePointer: () => active.current !== undefined,
    bind(id: string) {
      return {
        style: enabled ? handleStyle : undefined,
        onPointerDown: (event: PointerEvent<HTMLButtonElement>) => start(id, event),
        onPointerMove: update,
        onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event),
        onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
        onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
        onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
          const drag = active.current;
          if (event.key !== 'Escape' || !drag || drag.id !== id || !drag.moved) return;
          drag.cancelled = true;
          setPreview(undefined);
          event.preventDefault();
          event.stopPropagation();
        },
        onClickCapture: (event: MouseEvent<HTMLButtonElement>) => {
          if (!event.detail || suppressClick.current !== id) return;
          suppressClick.current = undefined;
          event.preventDefault();
          event.stopPropagation();
        },
      };
    },
  };
}
