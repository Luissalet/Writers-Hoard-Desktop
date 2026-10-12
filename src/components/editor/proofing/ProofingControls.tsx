import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { Languages, ChevronDown } from 'lucide-react';
import { checkDocument, applySuggestion, type ProofingReport } from '@/engines/writings/proofing';
import { editPersonalWord, loadPersonalWords } from '@/services/proofing/dictionary';
import { chapterBlocks, CHAPTER_HEADING_NAME } from '../chapterHeading/chapterBlocks';
const COPY = {
  es: { title: 'Revisar español', language: 'Idioma del texto', spanish: 'Español (España)', grammar: 'Gramática local', check: 'Comprobar texto', checking: 'Comprobando…', none: 'No se han encontrado sugerencias.', stale: 'El texto ha cambiado. Vuelve a comprobarlo.', locate: 'Ver en el texto', add: 'Añadir al diccionario del proyecto', applied: 'Corrección aplicada. Puedes deshacerla.', spelling: 'Ortografía', grammarLabel: 'Gramática', unavailable: 'Parte de la revisión no está disponible.', instructions: 'Revisa las sugerencias antes de aplicarlas. El análisis usa el texto visible del capítulo y conserva las propuestas pendientes.', error: 'No se ha podido revisar el texto.' },
  en: { title: 'Check Spanish', language: 'Text language', spanish: 'Spanish (Spain)', grammar: 'Local grammar', check: 'Check text', checking: 'Checking…', none: 'No suggestions found.', stale: 'The text changed. Check it again.', locate: 'Locate in text', add: 'Add to project dictionary', applied: 'Correction applied. You can undo it.', spelling: 'Spelling', grammarLabel: 'Grammar', unavailable: 'Part of the check is unavailable.', instructions: 'Review suggestions before applying them. Analysis uses visible chapter text and preserves pending proposals.', error: 'Text check failed.' },
};
function scopeFor(editor: Editor) {
  const type = editor.schema.nodes[CHAPTER_HEADING_NAME];
  if (!type) return { from: 0, to: editor.state.doc.content.size };
  const chapters = chapterBlocks(editor.state.doc, type);
  const chapter = chapters.slice().reverse().find(block => block.from <= editor.state.selection.from) ?? chapters[0];
  if (!chapter) return { from: 0, to: 0 };
  return { from: chapter.headingPos === null ? chapter.from : chapter.headingPos + editor.state.doc.nodeAt(chapter.headingPos)!.nodeSize, to: chapter.to };
}
export default function ProofingControls({ editor, locale = 'es', projectId }: { editor: Editor; locale?: 'es' | 'en'; projectId?: string }) {
  const copy = COPY[locale]; const panelId = useId();
  const [open, setOpen] = useState(false); const [grammar, setGrammar] = useState(true);
  const [report, setReport] = useState<ProofingReport | null>(null); const [busy, setBusy] = useState(false); const [status, setStatus] = useState('');
  const [personalWords, setPersonalWords] = useState<string[]>([]); const [newWord, setNewWord] = useState('');
  const [personalOwner, setPersonalOwner] = useState(projectId);
  const reportOwner = useRef<{ editor: Editor; projectId?: string } | null>(null);
  const currentProject = useRef(projectId); currentProject.current = projectId;
  const operation = useRef({ value: 0 }); const currentEditor = useRef(editor); currentEditor.current = editor;
  useEffect(() => { const controller = operation.current; controller.value++; setReport(null); setBusy(false); setStatus(''); return () => { controller.value++; }; }, [editor, projectId]);
  const subscribe = (refresh: () => void) => { editor.on('transaction', refresh); editor.on('update', refresh); return () => { editor.off('transaction', refresh); editor.off('update', refresh); }; };
  useSyncExternalStore(subscribe, () => editor.state, () => editor.state);
  useEffect(() => { let active = true; void loadPersonalWords(projectId).then(words => { if (active) { setPersonalWords(words); setPersonalOwner(projectId); } }).catch(() => { if (active) setStatus(copy.error); }); return () => { active = false; }; }, [projectId, open, copy.error]);
  const stale = !!report && (reportOwner.current?.editor !== editor || reportOwner.current.projectId !== projectId || !editor.state.doc.eq(report.document));
  const button = 'inline-flex items-center gap-1 rounded border border-border px-2 py-1.5 hover:bg-surface disabled:opacity-50';
  const check = async () => {
    const token = ++operation.current.value; const active = () => token === operation.current.value && currentEditor.current === editor && currentProject.current === projectId && !editor.isDestroyed;
    const doc = editor.state.doc; const scope = scopeFor(editor); setBusy(true); setStatus('');
    try {
      const personalWords = await loadPersonalWords(projectId);
      const result = await checkDocument(doc, { language: 'es-ES', personalWords, scope, grammarCheck: grammar && window.electronAPI?.proofing ? text => window.electronAPI!.proofing!.check({ text, language: 'es' }) : undefined });
      if (active()) { reportOwner.current = { editor, projectId }; setReport(result); }
    } catch (error) { if (active()) setStatus(error instanceof Error ? error.message : copy.error); }
    finally { if (active()) setBusy(false); }
  };
  const addWord = async (word: string) => { try { const words = await editPersonalWord(word, 'add', projectId); if (currentProject.current !== projectId || currentEditor.current !== editor) return; setPersonalWords(words); setPersonalOwner(projectId); setNewWord(''); if (report && !stale) await check(); } catch (error) { if (currentProject.current === projectId) setStatus(error instanceof Error ? error.message : copy.error); } };
  const removeWord = async (word: string) => { try { const words = await editPersonalWord(word, 'remove', projectId); if (currentProject.current !== projectId || currentEditor.current !== editor) return; setPersonalWords(words); setPersonalOwner(projectId); setReport(null); } catch (error) { if (currentProject.current === projectId) setStatus(error instanceof Error ? error.message : copy.error); } };
  return <div className="w-full min-w-0" data-proofing-controls>
    <button type="button" className={button} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}><Languages size={15} aria-hidden="true" />{copy.title}<ChevronDown size={13} aria-hidden="true" /></button>
    {open && <section id={panelId} aria-label={copy.title} className="mt-2 space-y-3 border-t border-border bg-surface/50 p-3 text-xs text-text-primary" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } }}>
      <div className="flex flex-wrap items-center gap-3"><span>{copy.language}: {copy.spanish}</span><label className="inline-flex items-center gap-1"><input type="checkbox" checked={grammar} onChange={event => setGrammar(event.target.checked)} />{copy.grammar}</label><button type="button" className={button} disabled={busy} onClick={() => { void check(); }}>{busy ? copy.checking : copy.check}</button></div>
      <details><summary>{locale === 'es' ? 'Diccionario del proyecto' : 'Project dictionary'}</summary><div className="mt-2 flex flex-wrap gap-2"><input className="rounded border border-border bg-surface px-2 py-1" aria-label={locale === 'es' ? 'Palabra propia' : 'Personal word'} value={newWord} onChange={event => setNewWord(event.target.value)} /><button type="button" className={button} disabled={busy || !newWord.trim() || !editor.isEditable} onClick={() => { void addWord(newWord); }}>{locale === 'es' ? 'Añadir palabra' : 'Add word'}</button></div><ul className="mt-2 max-h-32 space-y-1 overflow-auto">{(personalOwner === projectId ? personalWords : []).map(word => <li key={word} className="flex flex-wrap items-center gap-2"><span>{word}</span><button type="button" className={button} disabled={busy || !editor.isEditable} aria-label={`${locale === 'es' ? 'Quitar' : 'Remove'} ${word}`} onClick={() => { void removeWord(word); }}>{locale === 'es' ? 'Quitar' : 'Remove'}</button></li>)}</ul></details>
      <p className="max-w-prose text-text-secondary">{copy.instructions}</p>
      <p role="status" aria-live="polite">{stale ? copy.stale : status}</p>
      {report && (report.status.spelling === 'unavailable' || report.status.grammar === 'unavailable' || (grammar && report.status.grammar === 'disabled')) && <p role="status">{copy.unavailable}</p>}
      {report && !report.findings.length && (report.status.spelling === 'ready' || report.status.grammar === 'ready') && <p>{copy.none}</p>}
      <div className="max-h-80 space-y-2 overflow-auto">{report?.findings.map(finding => <article key={finding.id} className="space-y-1 border-b border-border pb-2">
        <div><strong>{finding.original}</strong> · {finding.category === 'spelling' ? copy.spelling : copy.grammarLabel}</div><p>{finding.message}</p>
        <div className="flex flex-wrap gap-1"><button type="button" className={button} disabled={stale} onClick={() => editor.chain().focus().setTextSelection({ from: finding.from, to: finding.to }).run()}>{copy.locate}</button>
          {finding.suggestions.map((replacement, index) => <button type="button" className={button} key={`${replacement}:${index}`} disabled={busy || stale || !editor.isEditable} onClick={() => { const result = applySuggestion(editor, finding, replacement, { expectedDoc: report.document }); setStatus(result.ok ? copy.applied : copy.stale); }}>{replacement || '∅'}</button>)}
          {finding.category === 'spelling' && <button type="button" className={button} disabled={busy || !editor.isEditable} onClick={() => { void addWord(finding.original); }}>{copy.add}</button>}
        </div></article>)}</div>
    </section>}
  </div>;
}
