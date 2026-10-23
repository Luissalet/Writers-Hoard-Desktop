// The tabs of a workbook under a sheet: switch between them, add one, rename,
// duplicate, colour, hide or delete the current one (a workbook keeps at least
// one tab). A sheet that is not in a workbook yet becomes the first tab of one
// when a tab is added.
import { useState } from 'react';
import { Copy, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import type { WorldTable } from './types';
import { blankSheet, duplicateSheet, workbookTabs } from './workbook';

const TAB_COLOURS = ['', '#c4463a', '#d4a843', '#4a9e6d', '#4a7ec4', '#7c5cbf', '#888888'];
const COPY = {
  es: { tabs: 'Pestañas del libro', add: 'Añadir pestaña', rename: 'Renombrar pestaña', duplicate: 'Duplicar pestaña', colour: 'Color de la pestaña', none: 'Sin color', hide: 'Ocultar pestaña', show: 'Mostrar pestaña', remove: 'Borrar pestaña', hidden: (n: number) => `${n} oculta${n === 1 ? '' : 's'}`, showHidden: 'Ver ocultas', newTab: (n: number) => `Hoja ${n}`, copyOf: (title: string) => `${title} (copia)`, last: 'Un libro necesita al menos una pestaña visible.', name: 'Nombre' },
  en: { tabs: 'Workbook tabs', add: 'Add tab', rename: 'Rename tab', duplicate: 'Duplicate tab', colour: 'Tab colour', none: 'No colour', hide: 'Hide tab', show: 'Show tab', remove: 'Delete tab', hidden: (n: number) => `${n} hidden`, showHidden: 'Show hidden', newTab: (n: number) => `Sheet ${n}`, copyOf: (title: string) => `${title} (copy)`, last: 'A workbook needs at least one visible tab.', name: 'Name' },
};

export default function WorkbookTabs({ tables, table, locale, busy, onSelect, onAdd, onChange, onDelete, onError }: {
  tables: WorldTable[]; table: WorldTable; locale: 'es' | 'en'; busy: boolean;
  onSelect: (id: string) => void;
  onAdd: (sheet: WorldTable, makeWorkbook?: NonNullable<WorldTable['workbook']>) => void;
  onChange: (id: string, update: (table: WorldTable) => void) => void;
  onDelete: (id: string) => void;
  onError: (message: string) => void;
}) {
  const c = COPY[locale];
  const [showHidden, setShowHidden] = useState(false), [renaming, setRenaming] = useState(false), [draft, setDraft] = useState('');
  if (table.mode !== 'sheet' || table.codexType || table.codexAllTypes) return null;
  const tabs = workbookTabs(tables, table), hiddenCount = tabs.filter(item => item.workbook?.hidden).length;
  const visibleTabs = tabs.filter(item => showHidden || !item.workbook?.hidden || item.id === table.id);
  const nextOrder = Math.max(...tabs.map(item => item.workbook?.order ?? 0)) + 1;
  const ensureWorkbook = (): NonNullable<WorldTable['workbook']> => table.workbook ?? { id: crypto.randomUUID(), name: table.title, order: 0 };
  return <div className="flex flex-wrap items-center gap-1 border-t border-border bg-surface/40 px-4 py-2" role="tablist" aria-label={c.tabs} data-testid="workbook-tabs">
    {visibleTabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === table.id} data-testid={`workbook-tab-${item.title}`} disabled={busy} onClick={() => onSelect(item.id)} className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-1 text-sm ${item.id === table.id ? 'bg-elevated text-accent-gold' : 'text-text-muted hover:bg-elevated'} ${item.workbook?.hidden ? 'italic opacity-60' : ''}`} style={{ borderBottomColor: item.workbook?.color || 'transparent' }}>{item.title}</button>)}
    <button type="button" className="rounded p-1.5 text-text-muted hover:bg-elevated" aria-label={c.add} title={c.add} data-testid="workbook-add" disabled={busy} onClick={() => { const workbook = ensureWorkbook(); onAdd(blankSheet(c.newTab(tabs.length + 1), { id: workbook.id, name: workbook.name, order: table.workbook ? nextOrder : 1 }), table.workbook ? undefined : workbook); }}><Plus size={15} /></button>
    {hiddenCount > 0 && <button type="button" className="ml-1 text-xs text-text-muted underline" data-testid="workbook-show-hidden" onClick={() => setShowHidden(value => !value)}>{c.hidden(hiddenCount)} · {c.showHidden}</button>}
    <span className="ml-auto inline-flex items-center gap-1">
      {renaming ? <form className="inline-flex gap-1" onSubmit={event => { event.preventDefault(); const title = draft.trim().slice(0, 200); if (title) onChange(table.id, current => { current.title = title; }); setRenaming(false); }}><input autoFocus className="min-h-8 rounded border border-border bg-deep px-2 text-sm text-text-primary" aria-label={c.name} data-testid="workbook-rename-input" value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => setRenaming(false)} /></form>
        : <button type="button" className="rounded p-1.5 text-text-muted hover:bg-elevated" aria-label={c.rename} title={c.rename} data-testid="workbook-rename" disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => { setDraft(table.title); setRenaming(true); }}><Pencil size={14} /></button>}
      <button type="button" className="rounded p-1.5 text-text-muted hover:bg-elevated" aria-label={c.duplicate} title={c.duplicate} data-testid="workbook-duplicate" disabled={busy} onClick={() => { const workbook = ensureWorkbook(); const source = table.workbook ? table : { ...table, workbook }; onAdd(duplicateSheet(source, c.copyOf(table.title), table.workbook ? nextOrder : 1), table.workbook ? undefined : workbook); }}><Copy size={14} /></button>
      <select className="min-h-8 rounded border border-border bg-deep px-1 text-xs text-text-primary" aria-label={c.colour} data-testid="workbook-colour" disabled={busy} value={table.workbook?.color ?? ''} onChange={event => { const color = event.target.value, workbook = ensureWorkbook(); onChange(table.id, current => { current.workbook = { ...(current.workbook ?? workbook), ...(color ? { color } : {}) }; if (!color) delete current.workbook.color; }); }}>{TAB_COLOURS.map(colour => <option key={colour} value={colour} style={{ color: colour || undefined }}>{colour ? `● ${colour}` : c.none}</option>)}</select>
      {table.workbook && <button type="button" className="rounded p-1.5 text-text-muted hover:bg-elevated" aria-label={table.workbook.hidden ? c.show : c.hide} title={table.workbook.hidden ? c.show : c.hide} data-testid="workbook-hide" disabled={busy} onClick={() => { if (!table.workbook!.hidden && tabs.filter(item => !item.workbook?.hidden).length <= 1) { onError(c.last); return; } onChange(table.id, current => { current.workbook = { ...current.workbook!, hidden: !current.workbook!.hidden }; }); }}>{table.workbook.hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button>}
      {tabs.length > 1 && <button type="button" className="rounded p-1.5 text-text-muted hover:bg-elevated" aria-label={c.remove} title={c.remove} data-testid="workbook-remove" disabled={busy} onClick={() => { if (tabs.filter(item => item.id !== table.id && !item.workbook?.hidden).length < 1) { onError(c.last); return; } onDelete(table.id); }}><Trash2 size={14} /></button>}
    </span>
  </div>;
}
