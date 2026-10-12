import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown, ListTree, X } from 'lucide-react';
import { deriveWritingHeadings, type WritingHeading } from '@/engines/writings/navigation';

const COPY = {
  es: { title: 'Navegación', panel: 'Navegar por encabezados', close: 'Cerrar navegación', search: 'Buscar encabezados', placeholder: 'Buscar encabezado…', empty: 'Añade encabezados al texto para navegar por sus secciones.', noMatches: 'No hay encabezados que coincidan.', untitled: 'Encabezado sin texto', count: 'Encabezados', changed: 'El texto ha cambiado. Elige un encabezado de la lista actualizada.' },
  en: { title: 'Navigation', panel: 'Navigate headings', close: 'Close navigation', search: 'Search headings', placeholder: 'Find a heading…', empty: 'Add headings to navigate the sections of your text.', noMatches: 'No headings match your search.', untitled: 'Untitled heading', count: 'Headings', changed: 'The text has changed. Choose a heading from the updated list.' },
} as const;
const button = 'inline-flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';
const searchable = (text: string, locale: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(locale);
const sameHeading = (left: WritingHeading, right: WritingHeading) => left.text === right.text && left.level === right.level && left.chapterId === right.chapterId;

export default function HeadingNavigator({ editor, locale = 'es' }: { editor: Editor; locale?: 'es' | 'en' }) {
  const copy = COPY[locale]; const panelId = useId(); const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ editor, query: '', status: '' });
  if (form.editor !== editor) setForm({ editor, query: '', status: '' });
  const subscribe = (changed: () => void) => { editor.on('transaction', changed); editor.on('update', changed); return () => { editor.off('transaction', changed); editor.off('update', changed); }; };
  const state = useSyncExternalStore(subscribe, () => editor.state);
  const headings = useMemo(() => deriveWritingHeadings(state.doc), [state.doc]);
  const query = searchable(form.query.trim(), locale);
  const filtered = headings.filter(heading => searchable(heading.text || copy.untitled, locale).includes(query));
  const active = headings.slice().reverse().find(heading => heading.from <= state.selection.from);
  const close = () => { setOpen(false); toggleRef.current?.focus(); };
  const jump = (heading: WritingHeading) => {
    if (editor.isDestroyed) return;
    const current = deriveWritingHeadings(editor.state.doc);
    // A remote replacement can move a heading before React publishes its next
    // render. Match the current source; ambiguous duplicate titles need a fresh click.
    const matches = current.filter(candidate => sameHeading(candidate, heading));
    const target = state.doc === editor.state.doc ? matches.find(candidate => candidate.from === heading.from) : matches.length === 1 ? matches[0] : undefined;
    if (!target) { setForm(value => ({ ...value, status: copy.changed })); return; }
    editor.chain().focus().setTextSelection(target.from + 1).scrollIntoView().run();
    setForm(value => ({ ...value, status: '' }));
  };
  return <div data-heading-navigator className="w-full min-w-0 border-b border-border bg-surface/50 px-2 py-1.5">
    <button ref={toggleRef} type="button" className={button} aria-label={copy.panel} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}><ListTree size={15} aria-hidden="true" />{copy.title}<ChevronDown size={13} aria-hidden="true" /></button>
    {open && <nav id={panelId} aria-label={copy.panel} className="mt-3 min-w-0 space-y-2 text-xs text-text-primary" onKeyDown={event => { if (event.key === 'Escape') { close(); event.stopPropagation(); } }}>
      <div className="flex min-w-0 items-center gap-2"><label className="flex min-w-0 flex-1 flex-col gap-1">{copy.search}<input type="search" aria-label={copy.search} placeholder={copy.placeholder} value={form.query} onChange={event => setForm(value => ({ ...value, query: event.target.value, status: '' }))} className="min-w-0 rounded border border-border bg-surface px-2 py-1.5 text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold" /></label><button type="button" className={button} aria-label={copy.close} onClick={close}><X size={14} aria-hidden="true" /></button></div>
      <p className="text-text-secondary">{copy.count}: {filtered.length}{query ? ` / ${headings.length}` : ''}</p>
      <ul className="m-0 max-h-72 list-none space-y-1 overflow-y-auto p-0">{filtered.map(heading => <li key={heading.from} className="min-w-0" style={{ paddingInlineStart: (heading.level - 1) * 12 }}><button type="button" className={`${button} w-full justify-start text-left ${active?.from === heading.from ? 'border-accent-gold' : ''}`} aria-current={active?.from === heading.from ? 'location' : undefined} data-heading-position={heading.from} onClick={() => jump(heading)}><span aria-hidden="true" className="shrink-0 text-text-secondary">H{heading.level}</span><span className="min-w-0 break-words">{heading.text || copy.untitled}</span></button></li>)}</ul>
      {!filtered.length && <p className="text-text-secondary">{headings.length ? copy.noMatches : copy.empty}</p>}
      {form.status && <p role="status" aria-live="polite" className="text-text-secondary">{form.status}</p>}
    </nav>}
  </div>;
}
