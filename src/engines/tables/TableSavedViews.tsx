import { useRef, useState } from 'react';
import { Bookmark, ChevronDown } from 'lucide-react';
import type { SavedTableViewAction } from './operations';
import type { listSavedTableViews } from './viewGroups';

const labels = {
  es: {
    title: 'Vistas guardadas', save: 'Guardar vista actual', choose: 'Elegir vista', apply: 'Aplicar', rename: 'Renombrar',
    remove: 'Eliminar vista', name: 'Nombre de la vista', confirm: 'Guardar', cancel: 'Cancelar', base: 'Base',
    unavailable: 'Hay columnas de esta vista que faltan o han cambiado de tipo.', deletePrompt: '¿Eliminar la vista «{name}»?',
  },
  en: {
    title: 'Saved views', save: 'Save current view', choose: 'Choose view', apply: 'Apply', rename: 'Rename',
    remove: 'Delete view', name: 'View name', confirm: 'Save', cancel: 'Cancel', base: 'Base',
    unavailable: 'Some columns used by this view are missing or have changed type.', deletePrompt: 'Delete the view “{name}”?',
  },
};

export function TableSavedViews({ views, locale, busy, button, control, edit, confirmDelete }: {
  views: ReturnType<typeof listSavedTableViews>;
  locale: string;
  busy: boolean;
  button: string;
  control: string;
  edit: (action: SavedTableViewAction, done?: (id: string) => void) => void;
  confirmDelete: (message: string, id: string) => void;
}) {
  const copy = locale === 'es' ? labels.es : labels.en;
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<{ id?: string; name: string }>();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const view = views.find(item => item.id === selected);
  const close = () => { setOpen(false); setDraft(undefined); toggle.current?.focus(); };
  return <div className="min-w-0" onKeyDown={event => {
    if (open && event.key === 'Escape') { event.stopPropagation(); close(); }
  }}>
    <button ref={toggle} type="button" className={button} aria-expanded={open} onClick={() => {
      if (open) close(); else setOpen(true);
    }}><Bookmark size={15} aria-hidden="true" />{copy.title}<ChevronDown size={14} aria-hidden="true" /></button>
    {open && <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-2">
      {views.length > 0 && <label className="flex min-w-0 flex-col gap-1 text-sm text-text-muted">
        {copy.choose}
        <select className={control + ' w-full max-w-60'} value={view?.id ?? ''} disabled={busy} onChange={event => {
          setSelected(event.target.value);
          setDraft(undefined);
        }}>
          <option value="">{copy.choose}</option>
          {views.map(item => <option key={item.id} value={item.id}>{item.name}{item.inherited ? ' · ' + copy.base : ''}</option>)}
        </select>
      </label>}
      {view && <>
        <button type="button" className={button} disabled={busy || !view.available} onClick={() => edit({ action: 'apply', viewId: view.id }, close)}>{copy.apply}</button>
        {!view.inherited && <>
          <button type="button" className={button} disabled={busy} onClick={() => setDraft({ id: view.id, name: view.name })}>{copy.rename}</button>
          <button type="button" className={button} disabled={busy} onClick={() => confirmDelete(copy.deletePrompt.replace('{name}', () => view.name), view.id)}>{copy.remove}</button>
        </>}
      </>}
      <button type="button" className={button} disabled={busy} onClick={() => setDraft({ name: '' })}>{copy.save}</button>
      {view && !view.available && <p className="basis-full text-sm text-text-muted">{copy.unavailable}</p>}
      {draft && <form key={draft.id ?? 'new'} className="flex basis-full flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault();
        const name = draft.name.trim();
        if (!name) return;
        edit(draft.id ? { action: 'rename', viewId: draft.id, name } : { action: 'save', name }, id => {
          setSelected(id);
          close();
        });
      }}>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-text-muted">
          {copy.name}
          <input autoFocus required className={control + ' w-full'} value={draft.name} disabled={busy}
            onChange={event => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <button type="submit" className={button} disabled={busy || !draft.name.trim()}>{copy.confirm}</button>
        <button type="button" className={button} onClick={() => { setDraft(undefined); toggle.current?.focus(); }}>{copy.cancel}</button>
      </form>}
    </div>}
  </div>;
}
