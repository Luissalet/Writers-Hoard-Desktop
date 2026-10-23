// The to-do list: add what is left to do, mark it in progress, done or
// dropped, give it an urgency and a due day (today, tomorrow, next week or a
// date), link it to a chapter or a Codex card, and filter to what is open, has
// a due day or is done. Overdue items are flagged.
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, Link2, Plus, Trash2, X } from 'lucide-react';
import { db } from '@/db';
import { TODO_STATUSES, createTodo, dayFrom, isOpen, isOverdue, nextWeek, sortTodos, type TodoItem, type TodoLink, type TodoStatus } from './model';
import { TodoConflict, saveTodos } from './operations';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-2 text-sm text-text-primary';
const button = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
type Filter = 'open' | 'due' | 'done' | 'all';

const COPY = {
  es: { title: 'Tareas', add: 'Añadir', placeholder: 'Qué queda por hacer…', open: 'Pendientes', due: 'Con fecha', done: 'Hechas', all: 'Todas', none: 'Nada por aquí.', status: { todo: 'Por hacer', in_progress: 'En curso', done: 'Hecha', dropped: 'Descartada' }, urgency: 'Urgencia', urgencies: ['Sin prisa', 'Baja', 'Media', 'Alta'], dueDay: 'Para el', today: 'Hoy', tomorrow: 'Mañana', week: 'Próxima semana', clearDue: 'Sin fecha', overdue: 'Atrasada', link: 'Enlazar con…', remove: 'Borrar', conflict: 'La lista cambió en otra ventana; vuelve a intentarlo.', count: (n: number) => `${n} pendiente${n === 1 ? '' : 's'}`, chapters: 'Capítulos', cards: 'Fichas', edit: 'Texto de la tarea' },
  en: { title: 'To-do', add: 'Add', placeholder: 'What is left to do…', open: 'Open', due: 'With a date', done: 'Done', all: 'All', none: 'Nothing here.', status: { todo: 'To do', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' }, urgency: 'Urgency', urgencies: ['No rush', 'Low', 'Medium', 'High'], dueDay: 'Due', today: 'Today', tomorrow: 'Tomorrow', week: 'Next week', clearDue: 'No date', overdue: 'Overdue', link: 'Link to…', remove: 'Delete', conflict: 'The list changed in another window; try again.', count: (n: number) => `${n} open`, chapters: 'Chapters', cards: 'Cards', edit: 'Task text' },
};
const URGENCY_COLOUR = ['text-text-muted', 'text-sky-400', 'text-amber-400', 'text-danger'];

export default function TodoPanel({ projectId, locale, onOpenLink }: { projectId: string; locale: 'es' | 'en'; onOpenLink?: (link: TodoLink) => void }) {
  const c = COPY[locale];
  const list = useLiveQuery(async () => (await db.projects.get(projectId))?.todos ?? { revision: 0, items: [] }, [projectId]);
  const documents = useLiveQuery(async () => ({
    writings: (await db.writings.where('projectId').equals(projectId).toArray()).map(item => ({ kind: 'writing' as const, id: item.id, title: item.title || '—' })),
    codex: (await db.codexEntries.where('projectId').equals(projectId).toArray()).map(item => ({ kind: 'codex' as const, id: item.id, title: item.title || '—' })),
  }), [projectId]);
  const [text, setText] = useState(''), [filter, setFilter] = useState<Filter>('open'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const items = useMemo(() => sortTodos(list?.items ?? []), [list]);
  const today = dayFrom(0), openCount = items.filter(isOpen).length;
  const visible = items.filter(item => filter === 'all' ? true : filter === 'open' ? isOpen(item) : filter === 'due' ? !!item.due && isOpen(item) : !isOpen(item));
  const save = async (change: (items: TodoItem[]) => TodoItem[]) => {
    if (!list || busy) return; setBusy(true); setError('');
    try { await saveTodos(projectId, change(list.items), list.revision); }
    catch (failure) { setError(failure instanceof TodoConflict ? c.conflict : String(failure instanceof Error ? failure.message : failure)); }
    finally { setBusy(false); }
  };
  const update = (id: string, patch: Partial<TodoItem>) => void save(all => all.map(item => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item));
  return <section className="mx-auto max-w-3xl space-y-4 p-4" aria-label={c.title} data-testid="todo-panel">
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (!text.trim()) return; const item = createTodo(text.slice(0, 500)); setText(''); void save(all => [...all, item]); }}>
      <input className={`${control} flex-1`} data-testid="todo-new" placeholder={c.placeholder} aria-label={c.placeholder} value={text} maxLength={500} onChange={event => setText(event.target.value)} />
      <button type="submit" className={button} data-testid="todo-add" disabled={!text.trim() || busy}><Plus className="h-4 w-4" />{c.add}</button>
    </form>
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={c.title}>
      {(['open', 'due', 'done', 'all'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} data-testid={`todo-filter-${value}`} onClick={() => setFilter(value)} className={`rounded-full border px-3 py-1 text-xs ${filter === value ? 'border-accent-gold bg-accent-gold/10 text-accent-gold' : 'border-border text-text-muted hover:bg-elevated'}`}>{c[value]}</button>)}
      <span className="ml-auto text-xs text-text-muted" data-testid="todo-open-count">{c.count(openCount)}</span>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!visible.length && <p className="text-sm text-text-muted" data-testid="todo-empty">{c.none}</p>}
    <ul className="space-y-2" data-testid="todo-list">{visible.map(item => {
      const late = isOverdue(item, today);
      return <li key={item.id} data-testid="todo-item" data-status={item.status} className={`space-y-2 rounded-xl border p-3 ${late ? 'border-danger/60' : 'border-border'} ${isOpen(item) ? '' : 'opacity-70'}`}>
        <div className="flex items-start gap-2">
          <input type="checkbox" className="mt-2" aria-label={c.status.done} data-testid="todo-done" checked={item.status === 'done'} onChange={event => update(item.id, { status: event.target.checked ? 'done' : 'todo' })} />
          <input className={`${control} flex-1 ${item.status === 'done' || item.status === 'dropped' ? 'line-through' : ''}`} aria-label={c.edit} data-testid="todo-text" defaultValue={item.text} key={`${item.id}-${item.updatedAt}`} maxLength={500} onBlur={event => { const value = event.target.value.trim(); if (value && value !== item.text) update(item.id, { text: value }); else event.target.value = item.text; }} />
          <button type="button" className="rounded p-2 text-text-muted hover:bg-elevated" aria-label={`${c.remove}: ${item.text}`} data-testid="todo-remove" onClick={() => void save(all => all.filter(other => other.id !== item.id))}><Trash2 className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-6 text-xs">
          <select className={control} aria-label={c.title} data-testid="todo-status" value={item.status} onChange={event => update(item.id, { status: event.target.value as TodoStatus })}>{TODO_STATUSES.map(status => <option key={status} value={status}>{c.status[status]}</option>)}</select>
          <select className={`${control} ${URGENCY_COLOUR[item.urgency]}`} aria-label={c.urgency} data-testid="todo-urgency" value={item.urgency} onChange={event => update(item.id, { urgency: Number(event.target.value) as TodoItem['urgency'] })}>{c.urgencies.map((label, index) => <option key={label} value={index}>{'!'.repeat(index) || '·'} {label}</option>)}</select>
          <span className="inline-flex items-center gap-1 text-text-muted"><CalendarDays className="h-3.5 w-3.5" />{c.dueDay}</span>
          <input type="date" className={control} aria-label={c.dueDay} data-testid="todo-due" value={item.due ?? ''} onChange={event => update(item.id, event.target.value ? { due: event.target.value } : { due: undefined })} />
          <button type="button" className="underline text-text-muted" data-testid="todo-due-today" onClick={() => update(item.id, { due: dayFrom(0) })}>{c.today}</button>
          <button type="button" className="underline text-text-muted" data-testid="todo-due-tomorrow" onClick={() => update(item.id, { due: dayFrom(1) })}>{c.tomorrow}</button>
          <button type="button" className="underline text-text-muted" data-testid="todo-due-week" onClick={() => update(item.id, { due: nextWeek() })}>{c.week}</button>
          {item.due && <button type="button" className="underline text-text-muted" onClick={() => update(item.id, { due: undefined })}>{c.clearDue}</button>}
          {late && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-danger" data-testid="todo-overdue">{c.overdue}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-6 text-xs">
          {item.links.map(link => <span key={`${link.kind}:${link.id}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5"><button type="button" className="text-accent-gold hover:underline" data-testid="todo-link" onClick={() => onOpenLink?.(link)}>@{link.title}</button><button type="button" aria-label={`${c.remove}: ${link.title}`} onClick={() => update(item.id, { links: item.links.filter(other => other !== link) })}><X className="h-3 w-3" /></button></span>)}
          <label className="inline-flex items-center gap-1 text-text-muted"><Link2 className="h-3.5 w-3.5" /><select className={control} aria-label={c.link} data-testid="todo-link-add" value="" onChange={event => { const [kind, id] = event.target.value.split(':'); const found = [...(documents?.writings ?? []), ...(documents?.codex ?? [])].find(doc => doc.kind === kind && doc.id === id); if (found && !item.links.some(link => link.kind === found.kind && link.id === found.id)) update(item.id, { links: [...item.links, found] }); }}><option value="">{c.link}</option><optgroup label={c.chapters}>{documents?.writings.map(doc => <option key={doc.id} value={`writing:${doc.id}`}>{doc.title}</option>)}</optgroup><optgroup label={c.cards}>{documents?.codex.map(doc => <option key={doc.id} value={`codex:${doc.id}`}>{doc.title}</option>)}</optgroup></select></label>
        </div>
      </li>;
    })}</ul>
  </section>;
}
