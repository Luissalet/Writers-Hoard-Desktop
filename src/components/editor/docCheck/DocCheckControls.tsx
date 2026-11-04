import { useId, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ClipboardCheck, ChevronDown } from 'lucide-react';
import { checkMarkdownDoc, DOC_KINDS, type DocCheckReport, type DocKind } from '@/engines/docCheck/checker';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';

const KINDS = DOC_KINDS.filter(kind => kind !== 'generated');
const COPY = {
  es: { title: 'Comprobar documento', kind: 'Tipo de documento', check: 'Comprobar', clean: 'Sin diagnósticos.', line: 'línea', fix: 'Cómo arreglarlo', suppressed: 'excepciones con motivo', instructions: 'Comprueba el texto como Markdown: tipo declarado, un hecho un hogar, sin valores que caducan, punteros concretos y sin dirigirse a quien lo pidió. Un tipo en el frontmatter (kind: howto) manda sobre el elegido aquí.', error: 'No se ha podido comprobar el documento.', errors: 'errores', warnings: 'avisos', errorOne: 'error', warningOne: 'aviso' },
  en: { title: 'Check document', kind: 'Document kind', check: 'Check', clean: 'No diagnostics.', line: 'line', fix: 'How to fix', suppressed: 'exceptions with a reason', instructions: 'Checks the text as Markdown: declared kind, one fact one home, no fast-changing values, concrete pointers and no addressing of the requester. A kind in the frontmatter (kind: howto) wins over the one chosen here.', error: 'The document could not be checked.', errors: 'errors', warnings: 'warnings', errorOne: 'error', warningOne: 'warning' },
};
export default function DocCheckControls({ editor, locale = 'es' }: { editor: Editor; locale?: 'es' | 'en' }) {
  const copy = COPY[locale]; const panelId = useId();
  const [open, setOpen] = useState(false); const [kind, setKind] = useState<DocKind>('explanation');
  const [report, setReport] = useState<DocCheckReport | null>(null); const [status, setStatus] = useState('');
  const button = 'inline-flex items-center gap-1 rounded border border-border px-2 py-1.5 hover:bg-surface disabled:opacity-50';
  const run = () => {
    try { setReport(checkMarkdownDoc({ markdown: htmlToMarkdown(editor.getHTML()) }, { kind })); setStatus(''); }
    catch (error) { setReport(null); setStatus(error instanceof Error ? error.message : copy.error); }
  };
  return <div className="w-full min-w-0" data-doc-check-controls>
    <button type="button" className={button} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}><ClipboardCheck size={15} aria-hidden="true" />{copy.title}<ChevronDown size={13} aria-hidden="true" /></button>
    {open && <section id={panelId} aria-label={copy.title} className="mt-2 space-y-3 border-t border-border bg-surface/50 p-3 text-xs text-text-primary" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } }}>
      <div className="flex flex-wrap items-center gap-3"><label className="inline-flex items-center gap-1">{copy.kind}<select className="rounded border border-border bg-surface px-2 py-1" value={kind} onChange={event => { setKind(event.target.value as DocKind); setReport(null); }}>{KINDS.map(item => <option key={item} value={item}>{item}</option>)}</select></label><button type="button" className={button} data-doc-check-run onClick={run}>{copy.check}</button></div>
      <p className="max-w-prose text-text-secondary">{copy.instructions}</p>
      {status && <p role="alert">{status}</p>}
      {report && <p role="status" aria-live="polite">{report.counts.error} {copy.errors} · {report.counts.warning} {copy.warnings}{report.counts.suppressed ? ` · ${report.counts.suppressed} ${copy.suppressed}` : ''}</p>}
      {report && !report.diagnostics.length && <p>{copy.clean}</p>}
      <div className="max-h-80 space-y-2 overflow-auto">{report?.diagnostics.map((item, index) => <article key={`${item.rule}:${item.line}:${index}`} className="space-y-1 border-b border-border pb-2" data-doc-check-diagnostic={item.rule}>
        <div><strong>{item.rule}</strong> · {item.severity === 'error' ? copy.errorOne : copy.warningOne} · {copy.line} {item.line}</div>
        <p>{item.message}</p>{item.excerpt && <p className="text-text-secondary">«{item.excerpt}»</p>}
        <p><span className="text-text-secondary">{copy.fix}: </span>{item.fix}</p>
      </article>)}</div>
    </section>}
  </div>;
}
