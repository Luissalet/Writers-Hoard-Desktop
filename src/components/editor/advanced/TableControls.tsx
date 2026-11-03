import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { selectionCell, selectedRect } from '@tiptap/pm/tables';
import { Rows3, Columns3, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Table2, Trash2, Merge, Split } from 'lucide-react';
import { TABLE_COPY, canTableAction, runTableAction, tableActionLabel, type TableAction } from './tableActions';

const actions = ['rowBefore', 'row', 'columnBefore', 'column', 'header', 'merge', 'split', 'deleteRow', 'deleteColumn', 'deleteTable'] as const;
const icons = {
  rowBefore: <><Rows3 size={15} /><ArrowUp size={12} /></>, row: <><Rows3 size={15} /><ArrowDown size={12} /></>,
  columnBefore: <><Columns3 size={15} /><ArrowLeft size={12} /></>, column: <><Columns3 size={15} /><ArrowRight size={12} /></>,
  header: <Table2 size={16} />, merge: <Merge size={16} />, split: <Split size={16} />,
  deleteRow: <><Rows3 size={15} /><Trash2 size={12} /></>, deleteColumn: <><Columns3 size={15} /><Trash2 size={12} /></>, deleteTable: <Trash2 size={16} />,
};
type Box = { left: number; top: number; right: number; bottom: number };
type View = { editor: Editor; cell: HTMLElement; left: number; top: number; maxWidth: number; maxHeight: number; measured: boolean; enabled: boolean[]; header: boolean };
const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function activeCell(editor: Editor): HTMLElement | null {
  if (editor.isDestroyed || !editor.isEditable || !editor.schema.nodes.table || !editor.isActive('table')) return null;
  try {
    const node = editor.view.nodeDOM(selectionCell(editor.state).pos);
    return node?.nodeType === 1 && ['TD', 'TH'].includes((node as HTMLElement).tagName) ? node as HTMLElement : null;
  } catch { return null; }
}

/** The anchor must remain visible, even though the portal escapes editor clipping. */
function visibleBox(cell: HTMLElement): Box {
  const win = cell.ownerDocument.defaultView!;
  const box = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
  for (let node = cell.parentElement; node; node = node.parentElement) {
    const style = win.getComputedStyle(node), rect = node.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { box.left = Math.max(box.left, rect.left); box.right = Math.min(box.right, rect.right); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { box.top = Math.max(box.top, rect.top); box.bottom = Math.min(box.bottom, rect.bottom); }
  }
  return box;
}

function sameView(a: View | null, b: View | null) {
  return a === b || !!a && !!b && a.editor === b.editor && a.cell === b.cell && a.left === b.left && a.top === b.top && a.maxWidth === b.maxWidth && a.maxHeight === b.maxHeight && a.measured === b.measured && a.header === b.header && a.enabled.every((value, i) => value === b.enabled[i]);
}

/** TableKit commands over the incumbent editor, with no document/storage of its own. */
export default function TableControls({ editor, locale = 'es' }: { editor: Editor; locale?: 'es' | 'en' }) {
  const [view, setView] = useState<View | null>(null);
  const [tabIndex, setTabIndex] = useState(0);
  const toolbar = useRef<HTMLDivElement>(null), schedule = useRef<(() => void) | null>(null), focusIndex = useRef<number | null>(null);
  const focusOwner = useRef<Element | null>(null);

  useLayoutEffect(() => {
    if (editor.isDestroyed) return;
    const doc = editor.view.dom.ownerDocument, win = doc.defaultView!;
    let frame = 0, dismissed = false, observedCell: HTMLElement | null = null, observedBar: HTMLElement | null = null;
    const publish = (next: View | null) => setView(previous => sameView(previous, next) ? previous : next);
    const update = () => {
      frame = 0;
      const cell = activeCell(editor), bar = toolbar.current, focused = doc.activeElement;
      if (!cell || dismissed) { focusIndex.current = null; focusOwner.current = null; publish(null); return; }
      if (focusIndex.current !== null && focused !== focusOwner.current && !bar?.contains(focused)) { focusIndex.current = null; focusOwner.current = null; }
      if (!editor.view.dom.contains(focused) && !bar?.contains(focused) && focusIndex.current === null) { publish(null); return; }
      const anchor = cell.getBoundingClientRect();
      if (!overlaps(anchor, visibleBox(cell))) { publish(null); return; }
      if (observedCell !== cell) { if (observedCell) observer.unobserve(observedCell); observer.observe(cell); observedCell = cell; }
      if (bar && observedBar !== bar) { if (observedBar) observer.unobserve(observedBar); observer.observe(bar); observedBar = bar; }
      const portal = editor.view.dom.closest<HTMLElement>('dialog,[role="dialog"]') ?? doc.body, modal = portal === doc.body ? null : portal.getBoundingClientRect();
      const bounds = { left: Math.max(0, modal?.left ?? 0), top: Math.max(0, modal?.top ?? 0), right: Math.min(win.innerWidth, modal?.right ?? win.innerWidth), bottom: Math.min(win.innerHeight, modal?.bottom ?? win.innerHeight) };
      const measured = bar?.getBoundingClientRect(), scaleX = bar?.offsetWidth ? measured!.width / bar.offsetWidth : 1, scaleY = bar?.offsetHeight ? measured!.height / bar.offsetHeight : 1;
      const maxWidth = Math.max(1, bounds.right - bounds.left - 16) / scaleX, maxHeight = Math.max(1, bounds.bottom - bounds.top - 16) / scaleY;
      const width = Math.min(measured?.width ?? 400, maxWidth * scaleX), height = Math.min(measured?.height ?? 40, maxHeight * scaleY);
      const left = Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - width - 8));
      const clampTop = (top: number) => Math.max(bounds.top + 8, Math.min(top, bounds.bottom - height - 8));
      const candidates = [anchor.bottom + 6, anchor.top - height - 6];
      const surface = editor.view.dom.closest('.tiptap-editor') ?? editor.view.dom.parentElement;
      const occupied = [...surface?.querySelectorAll('[data-editor-selection-actions], [data-testid="image-controls"]') ?? []].map(node => node.getBoundingClientRect());
      for (const rect of occupied) candidates.push(rect.bottom + 6, rect.top - height - 6);
      const tops = candidates.map(clampTop), top = tops.find(y => !occupied.some(rect => overlaps({ left, right: left + width, top: y, bottom: y + height }, rect))) ?? tops[0];
      let header = false;
      try { const first = selectedRect(editor.state).table.firstChild; header = !!first && first.childCount > 0; first?.forEach(node => { header &&= node.type.spec.tableRole === 'header_cell'; }); } catch { /* The next selection event will remove a retired table. */ }
      // A modal can establish a transformed containing block. Convert the
      // desired viewport point through the actual measured portal, not its CSS name.
      const cssLeft = bar ? parseFloat(bar.style.left) + (left - measured!.left) / scaleX : left;
      const cssTop = bar ? parseFloat(bar.style.top) + (top - measured!.top) / scaleY : top;
      publish({ editor, cell, left: Math.round(cssLeft * 100) / 100, top: Math.round(cssTop * 100) / 100, maxWidth, maxHeight, measured: !!bar, enabled: actions.map(action => canTableAction(editor, action)), header });
      if (!bar) enqueue();
    };
    const enqueue = () => { if (!frame) frame = win.requestAnimationFrame(update); };
    const observer = new ResizeObserver(enqueue);
    observer.observe(editor.view.dom);
    const selection = () => { dismissed = false; focusIndex.current = null; focusOwner.current = null; enqueue(); };
    const pointer = (event: Event) => { if (editor.view.dom.contains(event.target as Node)) { dismissed = false; enqueue(); } };
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null, inBar = !!target && !!toolbar.current?.contains(target), excluded = target?.closest('input,textarea,select,[contenteditable="false"],[role="dialog"]'), inEditor = !!target && editor.view.dom.contains(target) && (!excluded || !editor.view.dom.contains(excluded));
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab'].includes(event.key)) { focusIndex.current = null; focusOwner.current = null; }
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'F10' && inEditor && activeCell(editor)) {
        event.preventDefault(); event.stopImmediatePropagation(); const reopen = dismissed; dismissed = false;
        const first = !reopen && toolbar.current?.style.visibility === 'visible' ? toolbar.current.querySelector<HTMLButtonElement>('button:not(:disabled)') : null;
        if (first) first.focus(); else { focusIndex.current = 0; focusOwner.current = doc.activeElement; enqueue(); }
      } else if (event.key === 'Escape' && (inBar || inEditor) && !dismissed && toolbar.current && activeCell(editor)) {
        event.preventDefault(); event.stopImmediatePropagation(); dismissed = true; focusIndex.current = null; focusOwner.current = null; publish(null);
        if (inBar && !editor.isDestroyed) editor.commands.focus(null, { scrollIntoView: false });
      }
    };
    const focus = () => {
      if (!editor.view.dom.contains(doc.activeElement) && !toolbar.current?.contains(doc.activeElement)) { focusIndex.current = null; focusOwner.current = null; }
      enqueue();
    };
    schedule.current = enqueue;
    editor.on('selectionUpdate', selection); editor.on('transaction', enqueue); editor.on('update', enqueue); editor.on('focus', enqueue); editor.on('blur', enqueue); editor.on('destroy', enqueue);
    doc.addEventListener('focusin', focus); doc.addEventListener('focusout', enqueue); doc.addEventListener('pointerdown', pointer, true); doc.addEventListener('scroll', enqueue, true);
    win.addEventListener('resize', enqueue); win.addEventListener('keydown', keys, true);
    enqueue();
    return () => {
      if (frame) win.cancelAnimationFrame(frame);
      observer.disconnect(); focusIndex.current = null; focusOwner.current = null;
      if (schedule.current === enqueue) schedule.current = null;
      editor.off('selectionUpdate', selection); editor.off('transaction', enqueue); editor.off('update', enqueue); editor.off('focus', enqueue); editor.off('blur', enqueue); editor.off('destroy', enqueue);
      doc.removeEventListener('focusin', focus); doc.removeEventListener('focusout', enqueue); doc.removeEventListener('pointerdown', pointer, true); doc.removeEventListener('scroll', enqueue, true);
      win.removeEventListener('resize', enqueue); win.removeEventListener('keydown', keys, true);
    };
  }, [editor]);

  useLayoutEffect(() => {
    if (!view?.measured || view.editor !== editor || focusIndex.current === null) return;
    if (editor.view.dom.ownerDocument.activeElement !== focusOwner.current) { focusIndex.current = null; focusOwner.current = null; return; }
    const buttons = [...toolbar.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], wanted = actions[focusIndex.current];
    (buttons.find(button => button.dataset.tableAction === wanted) ?? buttons[0])?.focus();
    focusIndex.current = null; focusOwner.current = null;
  }, [view, editor]);

  if (!view || view.editor !== editor || editor.isDestroyed || !editor.isEditable) return null;
  const copy = TABLE_COPY[locale];
  const activate = (action: TableAction, event: MouseEvent<HTMLButtonElement>) => {
    if (!activeCell(editor)) return;
    const keyboard = event.detail === 0;
    focusIndex.current = null; focusOwner.current = null;
    if (!runTableAction(editor, action, !keyboard)) return;
    if (!activeCell(editor)) { focusIndex.current = null; editor.commands.focus(null, { scrollIntoView: false }); }
    else if (keyboard) {
      const available = [...toolbar.current!.querySelectorAll<HTMLButtonElement>('button')].filter(node => canTableAction(editor, node.dataset.tableAction as TableAction));
      (available.find(node => node.dataset.tableAction === action) ?? available[0])?.focus();
    }
    schedule.current?.();
  };
  return createPortal(<div ref={toolbar} role="toolbar" aria-label={copy.controls} title={copy.shortcut} data-table-controls className="z-40 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1 text-text-primary shadow-lg" style={{ position: 'fixed', left: view.left, top: view.top, maxWidth: view.maxWidth, maxHeight: view.maxHeight, overflowY: 'auto', visibility: view.measured ? 'visible' : 'hidden' }} onKeyDown={event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLButtonElement) {
      event.preventDefault(); event.stopPropagation(); event.target.click(); return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...toolbar.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], at = buttons.indexOf(event.target as HTMLButtonElement);
    if (at < 0 || !buttons.length) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }}>
    {actions.map((action, index) => <button key={action} type="button" data-table-action={action} title={tableActionLabel(action, locale)} aria-label={tableActionLabel(action, locale)} aria-pressed={action === 'header' ? view.header : undefined} disabled={!view.enabled[index]} tabIndex={index === (view.enabled[tabIndex] ? tabIndex : view.enabled.indexOf(true)) ? 0 : -1} onFocus={() => setTabIndex(index)} onMouseDown={event => event.preventDefault()} onClick={event => activate(action, event)} className={`inline-flex h-8 min-w-8 items-center justify-center gap-0.5 rounded px-1.5 text-xs outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-40 ${action.startsWith('delete') ? 'hover:text-danger' : ''}`}>{icons[action]}</button>)}
  </div>, editor.view.dom.closest('dialog,[role="dialog"]') ?? editor.view.dom.ownerDocument.body);
}
