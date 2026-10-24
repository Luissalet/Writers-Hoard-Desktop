import { useId, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { BookOpen, ChevronDown, X } from 'lucide-react';
import type { CodexEntry } from '@/types';
import { searchEntries } from '@/services/codexReference/matcher';
import { localAvatar } from './model';
import { canInsertCodexTextLink, insertCodexTextLink } from './inlineLinks';
import RulesCardPanel, { RulesCardRefresh } from './RulesCardPanel';
const copy = {
  es: { title: 'Bloque del Codex', open: 'Insertar referencia viva del Codex', close: 'Cerrar referencias del Codex', search: 'Buscar entrada', help: 'Inserta una vista vinculada: refleja los cambios del Codex sin copiar su texto al documento.', empty: 'No hay entradas disponibles en este proyecto.', noMatches: 'No hay coincidencias.', place: 'Coloca el cursor en el texto de un capítulo, fuera de su título y sin abarcar otros capítulos.', insert: 'Insertar', complete: 'Referencia insertada. Puedes deshacerla en el editor.' },
  en: { title: 'Codex block', open: 'Insert live Codex reference', close: 'Close Codex references', search: 'Find entry', help: 'Insert a linked view: it reflects Codex changes without copying source prose into the document.', empty: 'No Codex entries are available in this project.', noMatches: 'No matches.', place: 'Place the cursor in chapter prose, outside its title and without crossing other chapters.', insert: 'Insert', complete: 'Reference inserted. You can undo it in the editor.' },
};
const button = 'inline-flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-50';
export default function CodexBlockControls({ editor, projectId, entries, locale,textOnly=false }: { editor: Editor; projectId: string; entries: CodexEntry[]; locale: 'es' | 'en';textOnly?:boolean }) {
  const c = {...copy[locale],...(textOnly?(locale==='es'?{title:'Enlace al Códex',open:'Insertar enlace textual al Códex',help:'Vincula la selección a una entrada de este proyecto o inserta su título como texto enlazado.',place:'Coloca el cursor en el texto para insertar el enlace.'}:{title:'Codex link',open:'Insert a Codex text link',help:'Link the selection to an entry in this project, or insert its title as linked text.',place:'Place the cursor in prose to insert the link.'}):{})}, panelId = useId(), toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [status, setStatus] = useState('');
  const [mode, setMode] = useState<'block' | 'text' | 'rules'>(textOnly?'text':'block');
  const [rulesEntry, setRulesEntry] = useState<CodexEntry | null>(null);
  const subscribe = (changed: () => void) => { editor.on('transaction', changed); return () => { editor.off('transaction', changed); }; };
  useSyncExternalStore(subscribe, () => editor.state);
  const scoped = entries.filter(entry => entry.projectId === projectId);
  const filtered = query.trim() ? searchEntries(query, scoped, 30) : scoped.slice(0, 30);
  const canInsert = (textOnly||mode === 'text' || mode === 'rules' ? canInsertCodexTextLink(editor) : !editor.isDestroyed && editor.isEditable && editor.can().insertCodexLiveBlock({ projectId, entryId: 'placement-test', label: '' }))&&(!textOnly||editor.state.selection.$from.parent.isTextblock&&editor.state.selection.$to.parent.isTextblock);
  const close = () => { setOpen(false); toggle.current?.focus(); };
  return <div data-codex-block-controls className="w-full min-w-0 px-2 py-1.5">
    <button ref={toggle} type="button" className={button} aria-label={c.open} aria-expanded={open} aria-controls={panelId} onClick={() => { setOpen(value => !value); setStatus(''); }}><BookOpen size={15} aria-hidden="true" />{c.title}<ChevronDown size={13} aria-hidden="true" /></button>
    {open && <section id={panelId} aria-label={c.open} className="mt-3 space-y-3 text-sm text-text-primary" onKeyDown={event => { if (event.key === 'Escape') { close(); event.stopPropagation(); } }}>
      <div className="flex items-start gap-3"><p className="min-w-0 flex-1 text-xs text-text-secondary">{c.help}</p><button type="button" className={button} aria-label={c.close} onClick={close}><X size={14} aria-hidden="true" /></button></div>
      {!textOnly&&<label className="flex flex-wrap items-center gap-2 text-xs text-text-muted">{locale === 'es' ? 'Insertar como' : 'Insert as'}<select className="min-h-9 rounded border border-border bg-deep px-3 text-sm text-text-primary" value={mode} data-testid="codex-insert-mode" onChange={event => { setMode(event.target.value as 'block' | 'text' | 'rules'); setRulesEntry(null); }}><option value="block">{locale === 'es' ? 'Bloque vivo' : 'Live block'}</option><option value="text">{locale === 'es' ? 'Texto enlazado / vincular selección' : 'Linked text / link selection'}</option><option value="rules">{locale === 'es' ? 'Ficha de reglas (hechizo, objeto, criatura)' : 'Rules card (spell, item, creature)'}</option></select></label>}
      <label className="flex flex-col gap-1 text-xs text-text-muted">{c.search}<input type="search" aria-label={c.search} value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 rounded border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold" /></label>
      {!canInsert && <p className="text-xs text-text-muted">{c.place}</p>}
      <ul className="m-0 max-h-64 list-none space-y-2 overflow-y-auto p-0">{filtered.map(entry => <li key={entry.id}><button type="button" className={`${button} w-full justify-start gap-3 px-3 py-2 text-left`} disabled={!canInsert} onClick={() => {
        if (!scoped.some(current => current.id === entry.id)) return;
        if (mode === 'rules') { setRulesEntry(entry); return; }
        const inserted = textOnly||mode === 'text' ? insertCodexTextLink(editor, projectId, { projectId, entryId: entry.id, label: entry.title }) : editor.chain().focus().insertCodexLiveBlock({ projectId, entryId: entry.id, label: entry.title }).run();
        setStatus(inserted ? c.complete : c.place); if (inserted) setOpen(false);
      }}>{localAvatar(entry.avatar) && <img src={localAvatar(entry.avatar)} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}<span className="min-w-0 flex-1 break-words text-sm">{entry.title}</span><span className="shrink-0 text-xs text-text-muted">{c.insert}</span></button></li>)}</ul>
      {!filtered.length && <p className="text-xs text-text-secondary">{scoped.length ? c.noMatches : c.empty}</p>}
    </section>}
    {!textOnly&&open && mode === 'rules' && rulesEntry && <RulesCardPanel key={rulesEntry.id} editor={editor} entry={rulesEntry} locale={locale} onDone={message => { setStatus(message); setRulesEntry(null); setOpen(false); }} onCancel={() => setRulesEntry(null)} />}
    {!textOnly&&<RulesCardRefresh editor={editor} entries={scoped} locale={locale} onDone={setStatus} />}
    {status && <p role="status" className="mt-2 text-xs text-text-muted">{status}</p>}
  </div>;
}
