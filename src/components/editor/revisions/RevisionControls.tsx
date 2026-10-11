import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { Check, ChevronDown, GitCompareArrows, X } from 'lucide-react';
import { describeRevisions, getRevisionTracking, proposeRevision, resolveRevisions, setRevisionTracking, type RevisionSummary } from '@/engines/writings/revisions';
import { chapterBlocks, CHAPTER_HEADING_NAME } from '../chapterHeading/chapterBlocks';

const COPY = {
  es: {
    title: 'Cambios', panel: 'Control de cambios', track: 'Registrar cambios', author: 'Autor', source: 'Origen',
    filter: 'Filtrar propuestas', empty: 'No hay propuestas pendientes en este capítulo.', noMatches: 'No hay propuestas que coincidan con el filtro.',
    proposal: 'Texto propuesto', original: 'Texto original', replacement: 'Texto nuevo', propose: 'Proponer cambio',
    hint: 'Selecciona el texto que quieres sustituir. Sin selección, la propuesta se inserta en el cursor. Deja el campo vacío para proponer una eliminación.',
    reviewHint: 'Marca propuestas o selecciona su texto para revisarlas en conjunto. Las acciones se limitan al capítulo actual.',
    accept: 'Aceptar', reject: 'Rechazar', acceptSelected: 'Aceptar selección', rejectSelected: 'Rechazar selección',
    acceptAll: 'Aceptar todas las visibles', rejectAll: 'Rechazar todas las visibles', select: 'Seleccionar propuesta', locate: 'Ver en el texto',
    insertion: 'Inserción', deletion: 'Eliminación', replacementKind: 'Sustitución', done: 'Cambio aplicado. Puedes deshacerlo en el editor.',
    proposed: 'Propuesta añadida.', error: 'No se ha podido aplicar el cambio.',
    range: 'Selecciona texto dentro del cuerpo del capítulo actual.', stale: 'El texto ha cambiado. Selecciónalo de nuevo antes de proponer.',
    overlap: 'La selección coincide con otra propuesta pendiente. Revísala antes de sustituir ese texto.', structure: 'Selecciona texto dentro de párrafos compatibles, sin cruzar límites de capítulos, celdas u objetos.',
    trackingScope: 'Se ha conservado la edición de estructura. El registro automático cubre el texto dentro de un párrafo.',
    missing: 'La propuesta ya no está pendiente.', chapter: 'Capítulo actual', close: 'Cerrar control de cambios',
  },
  en: {
    title: 'Changes', panel: 'Track changes', track: 'Record changes', author: 'Author', source: 'Source',
    filter: 'Filter proposals', empty: 'There are no pending proposals in this chapter.', noMatches: 'No proposals match the filter.',
    proposal: 'Proposed text', original: 'Original text', replacement: 'New text', propose: 'Propose change',
    hint: 'Select the text to replace. With no selection, the proposal is inserted at the cursor. Leave the field empty to propose a deletion.',
    reviewHint: 'Check proposals or select their text to review them together. Actions are limited to the current chapter.',
    accept: 'Accept', reject: 'Reject', acceptSelected: 'Accept selection', rejectSelected: 'Reject selection',
    acceptAll: 'Accept all visible', rejectAll: 'Reject all visible', select: 'Select proposal', locate: 'Show in text',
    insertion: 'Insertion', deletion: 'Deletion', replacementKind: 'Replacement', done: 'Change applied. You can undo it in the editor.',
    proposed: 'Proposal added.', error: 'The change could not be applied.', range: 'Select text within the current chapter body.',
    stale: 'The text has changed. Select it again before proposing.', overlap: 'The selection overlaps a pending proposal. Review it before replacing that text.',
    structure: 'Select text within compatible paragraphs without crossing chapter, cell or object boundaries.', missing: 'The proposal is no longer pending.',
    trackingScope: 'The structural edit was preserved. Automatic tracking covers text within a paragraph.',
    chapter: 'Current chapter', close: 'Close track changes',
  },
} as const;

const control = 'min-w-0 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-40';
const button = `${control} inline-flex min-h-8 items-center justify-center gap-1.5 hover:bg-surface/80`;

interface ProposalAnchor { doc: Editor['state']['doc']; from: number; to: number }
interface ProposalDraft {
  editor: Editor;
  scopeKey: string;
  text: string;
  selected: string[];
  status: string;
  error: string;
  anchor?: ProposalAnchor;
}

function chapterRange(editor: Editor) {
  const type = editor.schema.nodes[CHAPTER_HEADING_NAME];
  if (!type) return { from: 0, to: editor.state.doc.content.size, title: '', key: '' };
  const blocks = chapterBlocks(editor.state.doc, type);
  const current = blocks.slice().reverse().find(block => block.from <= editor.state.selection.from) ?? blocks[0];
  if (!current) return { from: 0, to: 0, title: '', key: '' };
  const heading = current.headingPos === null ? null : editor.state.doc.nodeAt(current.headingPos);
  return { from: heading ? current.headingPos! + heading.nodeSize : current.from, to: current.to, title: heading?.textContent ?? '', key: current.writingId ?? current.clientId ?? `heading:${current.headingPos}` };
}

export default function RevisionControls({ editor, locale = 'es' }: { editor: Editor; locale?: 'es' | 'en' }) {
  const copy = COPY[locale];
  const panelId = useId();
  const scope = chapterRange(editor);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState<ProposalDraft>({ editor, scopeKey: scope.key, text: '', selected: [], status: '', error: '' });
  if (draft.editor !== editor || (draft.scopeKey !== scope.key && (!draft.anchor || draft.anchor.doc === editor.state.doc))) setDraft({ editor, scopeKey: scope.key, text: '', selected: [], status: '', error: '' });
  useEffect(() => {
    const selected = ({ transaction }: { transaction: Editor['state']['tr'] }) => {
      if (transaction.docChanged || !transaction.selectionSet) return;
      const currentScope = chapterRange(editor);
      setDraft(current => {
        if (current.editor !== editor) return current;
        if (current.scopeKey !== currentScope.key && (!current.anchor || current.anchor.doc === editor.state.doc)) {
          return { editor, scopeKey: currentScope.key, text: '', selected: [], status: '', error: '' };
        }
        if (!current.anchor) return current;
        return { ...current, scopeKey: currentScope.key, anchor: { doc: editor.state.doc, from: transaction.selection.from, to: transaction.selection.to }, error: '', status: '' };
      });
    };
    editor.on('transaction', selected);
    return () => { editor.off('transaction', selected); };
  }, [editor]);
  const subscribe = (changed: () => void) => {
    editor.on('transaction', changed); editor.on('update', changed);
    return () => { editor.off('transaction', changed); editor.off('update', changed); };
  };
  const state = useSyncExternalStore(subscribe, () => editor.state);
  const editable = useSyncExternalStore(subscribe, () => editor.isEditable);
  const sourceChanged = !!draft.anchor && draft.anchor.doc !== state.doc;
  const tracking = getRevisionTracking(editor);
  const revisions = useMemo(() => {
    if (!open || state.doc !== editor.state.doc) return [];
    return describeRevisions(editor, { from: scope.from, to: scope.to });
  }, [editor, open, state.doc, scope.from, scope.to]);
  const scoped = revisions;
  const search = filter.trim().toLocaleLowerCase(locale);
  const visible = scoped.filter(revision => !search || [revision.author, revision.source, revision.deletedText, revision.insertedText].join(' ').toLocaleLowerCase(locale).includes(search));
  const selected = visible.filter(revision => draft.selected.length
    ? draft.selected.includes(revision.id)
    : !state.selection.empty && revision.ranges.some(range => range.from < state.selection.to && range.to > state.selection.from));
  const feedback = (status: string, error = '') => setDraft(current => ({ ...current, status, error }));
  const errorMessage = (reason?: string, message?: string) => {
    const messages: Record<string, string> = { 'invalid-range': copy.range, 'stale-source': copy.stale, 'overlapping-revision': copy.overlap, structure: copy.structure, 'not-found': copy.missing };
    return messages[reason ?? ''] ?? message ?? copy.error;
  };
  const resolve = (decision: 'accept' | 'reject', entries: RevisionSummary[]) => {
    if (!editor.isEditable || editor.isDestroyed || !entries.length) return;
    try {
      const result = resolveRevisions(editor, { decision, ids: entries.map(entry => entry.id), from: scope.from, to: scope.to });
      if (!result.ok) { feedback('', errorMessage(result.reason, result.message)); return; }
      setDraft(current => ({ ...current, selected: current.selected.filter(id => !result.ids.includes(id)), status: copy.done, error: '' }));
    } catch (error) { feedback('', error instanceof Error ? error.message : copy.error); }
  };
  const propose = () => {
    if (!editor.isEditable || editor.isDestroyed) return;
    if (draft.anchor && draft.anchor.doc !== editor.state.doc) { feedback('', copy.stale); return; }
    const { from, to } = draft.anchor ?? editor.state.selection;
    if (from < scope.from || to > scope.to) { feedback('', copy.range); return; }
    try {
      const result = proposeRevision(editor, { from, to, text: draft.text, author: tracking.author, source: tracking.source });
      if (!result.ok) { feedback('', errorMessage(result.reason, result.message)); return; }
      setDraft(current => ({ ...current, text: '', anchor: undefined, status: copy.proposed, error: '' }));
    } catch (error) { feedback('', error instanceof Error ? error.message : copy.error); }
  };
  const configure = (patch: Partial<typeof tracking>) => {
    try { setRevisionTracking(editor, { enabled: tracking.enabled, author: tracking.author, source: tracking.source, ...patch }); feedback(''); }
    catch (error) { feedback('', error instanceof Error ? error.message : copy.error); }
  };
  return <div data-revision-controls className="w-full min-w-0 border-b border-border bg-surface/50 px-2 py-1.5">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={button} aria-label={copy.panel} aria-controls={panelId} aria-expanded={open} onClick={() => setOpen(value => !value)}><GitCompareArrows size={15} aria-hidden="true" />{copy.title}<ChevronDown size={13} aria-hidden="true" /></button>
      <label className="inline-flex items-center gap-2 text-xs text-text-primary"><input type="checkbox" role="switch" className="accent-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold" aria-label={copy.track} checked={tracking.enabled} disabled={!editable} onChange={event => configure({ enabled: event.target.checked })} />{copy.track}</label>
      {tracking.warning && <span role="status" className="text-xs text-text-secondary">{tracking.warning.startsWith('This structural edit was kept normally;') ? copy.trackingScope : tracking.warning}</span>}
    </div>
    {open && <section id={panelId} aria-label={copy.panel} className="mt-3 min-w-0 space-y-3 text-xs text-text-primary" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } }}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">{copy.author}<input className={control} aria-label={copy.author} value={tracking.author} disabled={!editable} onChange={event => configure({ author: event.target.value })} /></label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">{copy.source}<input className={control} aria-label={copy.source} value={tracking.source} disabled={!editable} onChange={event => configure({ source: event.target.value })} /></label>
        <button type="button" className={button} aria-label={copy.close} onClick={() => setOpen(false)}><X size={14} aria-hidden="true" /></button>
      </div>
      {editor.schema.nodes[CHAPTER_HEADING_NAME] && <p className="text-text-secondary">{copy.chapter}{scope.title ? `: ${scope.title}` : ''}</p>}
      <label className="flex flex-col gap-1">{copy.proposal}<textarea className={`${control} min-h-20 w-full resize-y`} aria-label={copy.proposal} value={draft.text} disabled={!editable} onChange={event => {
        const text = event.target.value;
        const { from, to } = editor.state.selection;
        setDraft(current => ({ ...current, scopeKey: scope.key, text, anchor: current.anchor?.doc === editor.state.doc ? current.anchor : { doc: editor.state.doc, from, to }, error: '', status: '' }));
      }} /></label>
      {draft.anchor && sourceChanged && <p className="whitespace-pre-wrap break-words text-text-secondary" aria-label={copy.original}>{copy.original}: {draft.anchor.doc.textBetween(draft.anchor.from, draft.anchor.to, '\n')}</p>}
      <p className="max-w-prose text-text-secondary">{copy.hint}</p>
      <button type="button" className={`${button} border-accent-gold`} disabled={!editable || (!draft.text.length && state.selection.empty)} onClick={propose}>{copy.propose}</button>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <input type="search" className={`${control} w-full`} aria-label={copy.filter} placeholder={copy.filter} value={filter} onChange={event => setFilter(event.target.value)} />
        <button type="button" className={button} disabled={!editable || !selected.length} onClick={() => resolve('accept', selected)}>{copy.acceptSelected}</button>
        <button type="button" className={button} disabled={!editable || !selected.length} onClick={() => resolve('reject', selected)}>{copy.rejectSelected}</button>
        <button type="button" className={button} disabled={!editable || !visible.length} onClick={() => resolve('accept', visible)}>{copy.acceptAll}</button>
        <button type="button" className={button} disabled={!editable || !visible.length} onClick={() => resolve('reject', visible)}>{copy.rejectAll}</button>
      </div>
      <p className="text-text-secondary">{copy.reviewHint}</p>
      <ul className="m-0 list-none divide-y divide-border p-0" aria-label={copy.filter}>
        {visible.map(revision => <li key={revision.id} data-revision-id={revision.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex min-w-0 items-center gap-2"><input type="checkbox" aria-label={`${copy.select} ${revision.id}`} checked={draft.selected.includes(revision.id)} className="accent-accent-gold" onChange={event => setDraft(current => ({ ...current, selected: event.target.checked ? [...current.selected, revision.id] : current.selected.filter(id => id !== revision.id) }))} /><span className="break-words font-medium">{revision.author}</span><span className="break-words text-text-secondary">{revision.source}</span></label>
            <span className="text-text-secondary">{revision.deletedText && revision.insertedText ? copy.replacementKind : revision.deletedText ? copy.deletion : copy.insertion}</span>
          </div>
          {revision.deletedText && <del aria-label={copy.original} className="block whitespace-pre-wrap break-words text-text-secondary">{revision.deletedText}</del>}
          {revision.insertedText && <ins aria-label={copy.replacement} className="block whitespace-pre-wrap break-words text-text-primary decoration-accent-gold">{revision.insertedText}</ins>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} onClick={() => { editor.commands.setTextSelection({ from: revision.from, to: revision.to }); editor.commands.focus(); }}>{copy.locate}</button>
            <button type="button" className={button} disabled={!editable} onClick={() => resolve('accept', [revision])}><Check size={14} aria-hidden="true" />{copy.accept}</button>
            <button type="button" className={button} disabled={!editable} onClick={() => resolve('reject', [revision])}><X size={14} aria-hidden="true" />{copy.reject}</button>
          </div>
        </li>)}
      </ul>
      {!visible.length && <p className="py-2 text-text-secondary">{scoped.length ? copy.noMatches : copy.empty}</p>}
      <p role="status" aria-live="polite" className="break-words text-text-secondary">{draft.status}</p>
      {(draft.error || sourceChanged) && <p role="alert" className="break-words text-danger">{draft.error || copy.stale}</p>}
    </section>}
  </div>;
}
