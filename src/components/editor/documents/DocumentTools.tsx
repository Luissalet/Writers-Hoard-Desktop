import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown, Download, FileText, Upload, X } from 'lucide-react';
import { saveAs } from 'file-saver';
import { base64FromBytes, bytesFromBase64, requestDocument } from '@/services/documents/client';
import { advancedHtmlForInterchange, normalizeAdvancedHtml } from '../advanced/interchange';
import { chapterBlocks, CHAPTER_HEADING_NAME } from '../chapterHeading/chapterBlocks';
import { describeRevisionDocument } from '@/engines/writings/revisions';
import { revisionDocumentHtml } from '@/engines/writings/revisionProjection';
import { manuscriptFindingLabel } from '@/engines/writings/manuscriptReview/findings';

const COPY = {
  es: {
    title: 'Documento', open: 'Herramientas de documento', import: 'Abrir archivo', source: 'Origen',
    editor: 'Texto del editor', imported: 'Archivo abierto', format: 'Formato', export: 'Descargar documento',
    file: 'Nombre del archivo', page: 'Página', preview: 'Previsualizar página', apply: 'Aplicar texto al editor', applyChapter: 'Aplicar al capítulo actual',
    caution: 'El archivo abierto conserva su estructura completa. Al aplicar su texto al editor, las cabeceras, revisiones y objetos que este no representa pueden perderse. Puedes descargar antes el documento completo.',
    editorNote: 'La descarga y la vista de página usan una copia del texto actual del editor.',
    importNote: 'DOCX, ODT, RTF, HTML, TXT o documento Writers. Abrir no modifica tu texto.',
    importing: 'Abriendo documento…', exporting: 'Preparando descarga…', rendering: 'Preparando página…',
    ready: 'Archivo abierto. Tu texto sigue intacto.', applied: 'Texto aplicado. Puedes deshacerlo en el editor.',
    exported: 'Descarga preparada.', cancelled: 'Operación cancelada. Tu texto sigue intacto.', cancel: 'Cancelar',
    error: 'No se ha podido completar la operación. Puedes volver a intentarlo.', image: 'Página del documento',
    close: 'Cerrar herramientas de documento', empty: 'Abre un archivo o previsualiza el texto del editor.',
    changes: 'Texto para descargar', final: 'Final: propuestas aceptadas en una copia', original: 'Original: propuestas rechazadas en una copia',
    reviewNote: 'La descarga y la vista de página usan la versión elegida. Las propuestas se conservan. Para compartirlas, descarga DOCX con cambios.',
    reviewExport: 'Descargar DOCX con cambios',
    printLanguage: 'Idioma de impresión', inherit: 'Conservar el documento', spanish: 'Español', english: 'Inglés',
    hyphenation: 'Guionado automático', enabled: 'Activado', disabled: 'Desactivado',
  },
  en: {
    title: 'Document', open: 'Document tools', import: 'Open file', source: 'Source', editor: 'Editor text',
    imported: 'Opened file', format: 'Format', export: 'Download document', file: 'File name', page: 'Page',
    preview: 'Preview page', apply: 'Apply text to editor', applyChapter: 'Apply to current chapter',
    caution: 'The opened file keeps its complete structure. Applying its text to the editor may lose headers, revisions and objects the editor cannot represent. You can download the complete document first.',
    editorNote: 'Downloads and page previews use a copy of the current editor text.',
    importNote: 'DOCX, ODT, RTF, HTML, TXT or Writers document. Opening a file does not change your text.',
    importing: 'Opening document…', exporting: 'Preparing download…', rendering: 'Preparing page…',
    ready: 'File opened. Your text is unchanged.', applied: 'Text applied. You can undo it in the editor.',
    exported: 'Download ready.', cancelled: 'Operation cancelled. Your text is unchanged.', cancel: 'Cancel',
    error: 'The operation could not be completed. You can try again.', image: 'Document page',
    close: 'Close document tools', empty: 'Open a file or preview the editor text.',
    changes: 'Download text', final: 'Final: proposals accepted in a copy', original: 'Original: proposals rejected in a copy',
    reviewNote: 'Downloads and page previews use the selected version. Editor proposals stay intact. Download DOCX with changes to share them.',
    reviewExport: 'Download DOCX with changes',
    printLanguage: 'Print language', inherit: 'Keep document settings', spanish: 'Spanish', english: 'English',
    hyphenation: 'Automatic hyphenation', enabled: 'Enabled', disabled: 'Disabled',
  },
} as const;

interface NativeSession {
  sessionId: string;
  summary?: { pages?: number };
}
interface OpenedDocument extends NativeSession { fileName: string; html: string; warnings: string[]; original: File }
interface BytesExport { dataBase64: string; mimeType: string; fileName?: string }
interface PageImage extends BytesExport { width: number; height: number }

const control = 'min-w-0 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-40';
const button = `${control} inline-flex min-h-8 items-center justify-center gap-1.5 hover:bg-surface/80`;
const FORMATS = ['docx', 'odt', 'rtf', 'pdf', 'writer.json', 'html', 'txt'] as const;

function formatOf(fileName: string): string {
  if (/\.(writer|writers)\.json$/i.test(fileName) || /\.json$/i.test(fileName)) return 'writer.json';
  const extension = fileName.split('.').at(-1)?.toLowerCase() ?? '';
  return extension === 'htm' ? 'html' : extension;
}

function exportName(name: string, format: string): string {
  const stem = name.trim().replace(/\.(?:writer\.json|writers\.json|docx|odt|rtf|pdf|html?|txt|json)$/i, '').replace(/[<>:"/\\|?*]/g, '_').split('').map(character => character.charCodeAt(0) < 32 ? '_' : character).join('');
  return `${stem || 'document'}.${format}`;
}

export default function DocumentTools({ editor, locale = 'es' }: { editor: Editor; locale?: 'es' | 'en' }) {
  const copy = COPY[locale];
  const inputId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState<OpenedDocument | null>(null);
  const [source, setSource] = useState<'editor' | 'imported'>('editor');
  const [reviewProjection, setReviewProjection] = useState<'accept' | 'reject'>('accept');
  const [format, setFormat] = useState<string>('docx');
  const [fileName, setFileName] = useState('document');
  const [page, setPage] = useState(1);
  const [printLanguage, setPrintLanguage] = useState<'document' | 'es-ES' | 'en-US'>('document');
  const [hyphenation, setHyphenation] = useState<'document' | 'on' | 'off'>('document');
  const printOptions = {
    ...(printLanguage === 'document' ? {} : { language: printLanguage }),
    ...(hyphenation === 'document' ? {} : { hyphenation: hyphenation === 'on' }),
  };
  const [image, setImage] = useState<(PageImage & { page: number }) | null>(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const session = useRef<string | null>(null);
  const operation = useRef(0);
  const mounted = useRef(true);
  const editable = useSyncExternalStore(changed => {
    editor.on('update', changed); editor.on('transaction', changed);
    return () => { editor.off('update', changed); editor.off('transaction', changed); };
  }, () => editor.isEditable);
  const currentDocument = useSyncExternalStore(changed => {
    editor.on('update', changed); editor.on('transaction', changed);
    return () => { editor.off('update', changed); editor.off('transaction', changed); };
  }, () => editor.state.doc);
  const pendingRevisions = describeRevisionDocument(currentDocument).length;

  useEffect(() => {
    const generation = operation;
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      if (session.current) void requestDocument('document.close', { sessionId: session.current }).catch(() => {});
      session.current = null;
    };
  }, []);

  const run = async (label: string, work: (active: () => boolean) => Promise<void>) => {
    const token = ++operation.current;
    const active = () => mounted.current && operation.current === token;
    setBusy(label); setStatus(''); setError('');
    try { await work(active); }
    catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : copy.error); }
    finally { if (active()) setBusy(''); }
  };

  const openFile = (file: File) => void run(copy.importing, async active => {
    const dataBase64 = base64FromBytes(new Uint8Array(await file.arrayBuffer()));
    if (!active()) return;
    const native = await requestDocument<NativeSession>('document.openBytes', { dataBase64, format: formatOf(file.name), fileName: file.name });
    let retained = false;
    try {
      const projection = await requestDocument<{ html: string; warnings?: string[] }>('document.exportHtml', { sessionId: native.sessionId, includeRevisions: true });
      if (!active()) return;
      const previous = session.current;
      session.current = native.sessionId;
      retained = true;
      setOpened({ ...native, fileName: file.name, html: normalizeAdvancedHtml(projection.html), warnings: projection.warnings ?? [], original: file });
      setSource('imported'); setImage(null); setPage(1); setFileName(file.name); setStatus(copy.ready);
      if (previous) void requestDocument('document.close', { sessionId: previous }).catch(() => {});
    } finally {
      if (!retained) await requestDocument('document.close', { sessionId: native.sessionId }).catch(() => {});
    }
  });

  const withSource = async (active: () => boolean, work: (sessionId: string) => Promise<void>) => {
    if (source === 'imported' && opened) {
      await work(opened.sessionId);
      return;
    }
    const html = advancedHtmlForInterchange(revisionDocumentHtml(editor.state.doc, reviewProjection));
    const snapshot = await requestDocument<NativeSession>('document.importHtml', { html });
    try { if (active()) await work(snapshot.sessionId); }
    finally { await requestDocument('document.close', { sessionId: snapshot.sessionId }).catch(() => {}); }
  };

  const preview = () => void run(copy.rendering, active => withSource(active, async sessionId => {
    const rendered = await requestDocument<PageImage>('document.renderPage', { sessionId, page, scale: 1, ...printOptions });
    if (active()) setImage({ ...rendered, page });
  }));

  const download = () => void run(copy.exporting, active => withSource(active, async sessionId => {
    const name = exportName(fileName, format);
    const result = format === 'pdf'
      ? await requestDocument<BytesExport>('document.exportPdf', { sessionId, ...printOptions })
      : await requestDocument<BytesExport>('document.exportBytes', { sessionId, format, fileName: name, ...printOptions });
    if (!active()) return;
    saveAs(new Blob([bytesFromBase64(result.dataBase64)], { type: result.mimeType }), name);
    setStatus(copy.exported);
  }));

  const downloadReview = () => void run(copy.exporting, async active => {
    const temporary = source === 'editor';
    const snapshot = temporary
      ? await requestDocument<NativeSession>('document.importHtml', { html: advancedHtmlForInterchange(editor.getHTML()) })
      : opened;
    if (!snapshot) return;
    try {
      if (!active()) return;
      const name = exportName(fileName, 'docx');
      const result = await requestDocument<BytesExport>('document.exportBytes', { sessionId: snapshot.sessionId, format: 'docx', fileName: name, ...printOptions });
      if (active()) { saveAs(new Blob([bytesFromBase64(result.dataBase64)], { type: result.mimeType }), name); setStatus(copy.exported); }
    } finally { if (temporary) await requestDocument('document.close', { sessionId: snapshot.sessionId }).catch(() => {}); }
  });

  const apply = () => {
    // Imported HTML includes supported changes; originals remain in their native session.
    if (!opened || !editor.isEditable || editor.isDestroyed) return;
    const headingType = editor.schema.nodes[CHAPTER_HEADING_NAME];
    if (headingType) {
      const blocks = chapterBlocks(editor.state.doc, headingType);
      const chapter = blocks.slice().reverse().find(block => block.from <= editor.state.selection.from) ?? blocks[0];
      if (!chapter) return;
      const from = chapter.headingPos === null ? chapter.from : chapter.headingPos + editor.state.doc.nodeAt(chapter.headingPos)!.nodeSize;
      editor.commands.insertContentAt({ from, to: chapter.to }, opened.html, { updateSelection: true });
    } else editor.commands.setContent(opened.html);
    editor.commands.focus();
    setSource('editor'); setImage(null); setPage(1);
    setStatus(copy.applied); setError('');
  };

  return <div className="w-full min-w-0" data-document-tools>
    <button type="button" className={button} aria-label={copy.open} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      <FileText size={15} aria-hidden="true" />{copy.title}<ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <section id={panelId} aria-label={copy.open} className="mt-2 w-full min-w-0 space-y-3 border-t border-border bg-surface/50 p-3 text-xs text-text-primary" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button type="button" className={button} disabled={!!busy} onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden="true" />{copy.import}</button>
          <input id={inputId} ref={fileInput} type="file" className="hidden" aria-label={copy.import} accept=".docx,.odt,.rtf,.html,.htm,.txt,.json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) openFile(file); }} />
          <span className="min-w-0 break-all text-text-secondary">{opened?.fileName}</span>
        </div>
        <button type="button" className={button} aria-label={copy.close} onClick={() => setOpen(false)}><X size={14} aria-hidden="true" /></button>
      </div>
      <p className="text-text-secondary">{copy.importNote}</p>
      {opened && <div className="space-y-1 text-text-secondary"><button type="button" className={button} onClick={() => saveAs(opened.original, opened.fileName)}>{locale === 'es' ? 'Descargar original exacto' : 'Download exact original'}</button>{opened.warnings.map(warning => <p key={warning}>{manuscriptFindingLabel(warning, locale)}</p>)}</div>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1">{copy.printLanguage}<select className={control} aria-label={copy.printLanguage} value={printLanguage} disabled={!!busy} onChange={event => { setPrintLanguage(event.target.value as typeof printLanguage); setImage(null); setPage(1); }}><option value="document">{copy.inherit}</option><option value="es-ES">{copy.spanish}</option><option value="en-US">{copy.english}</option></select></label>
        <label className="flex min-w-0 flex-col gap-1">{copy.hyphenation}<select className={control} aria-label={copy.hyphenation} value={hyphenation} disabled={!!busy} onChange={event => { setHyphenation(event.target.value as typeof hyphenation); setImage(null); setPage(1); }}><option value="document">{copy.inherit}</option><option value="on">{copy.enabled}</option><option value="off">{copy.disabled}</option></select></label>
        <label className="flex min-w-0 flex-col gap-1">{copy.source}<select className={control} aria-label={copy.source} value={source} disabled={!!busy} onChange={event => { setSource(event.target.value as typeof source); setPage(1); setImage(null); }}>
          <option value="editor">{copy.editor}</option><option value="imported" disabled={!opened}>{copy.imported}</option>
        </select></label>
        <label className="flex min-w-0 flex-col gap-1">{copy.format}<select className={control} aria-label={copy.format} value={format} disabled={!!busy} onChange={event => setFormat(event.target.value)}>{FORMATS.map(value => <option key={value} value={value}>{value === 'writer.json' ? 'Writers (.writer.json)' : value.toUpperCase()}</option>)}</select></label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">{copy.file}<input className={`${control} w-full`} aria-label={copy.file} value={fileName} disabled={!!busy} onChange={event => setFileName(event.target.value)} /></label>
        <button type="button" className={button} disabled={!!busy} onClick={download}><Download size={14} aria-hidden="true" />{copy.export}</button>
        <button type="button" className={button} disabled={!!busy} onClick={downloadReview}><Download size={14} aria-hidden="true" />{copy.reviewExport}</button>
      </div>
      <p className="max-w-prose text-text-secondary">{source === 'imported' ? copy.caution : pendingRevisions ? copy.reviewNote : copy.editorNote}</p>
      {source === 'editor' && pendingRevisions > 0 && <label className="flex flex-col gap-1">{copy.changes}<select className={control} aria-label={copy.changes} disabled={!!busy} value={reviewProjection} onChange={event => setReviewProjection(event.target.value as 'accept' | 'reject')}><option value="accept">{copy.final}</option><option value="reject">{copy.original}</option></select></label>}
      {source === 'imported' && opened && <button type="button" className={`${button} border-accent-gold`} disabled={!!busy || !editable} onClick={apply}>{editor.schema.nodes[CHAPTER_HEADING_NAME] ? copy.applyChapter : copy.apply}</button>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">{copy.page}<input type="number" className={`${control} w-20`} aria-label={copy.page} min={1} max={source === 'imported' ? opened?.summary?.pages : undefined} value={page} disabled={!!busy} onChange={event => setPage(Math.max(1, Math.trunc(Number(event.target.value) || 1)))} /></label>
        <button type="button" className={button} disabled={!!busy} onClick={preview}>{copy.preview}</button>
        {busy && <button type="button" className={button} onClick={() => { operation.current++; setBusy(''); setStatus(copy.cancelled); }}>{copy.cancel}</button>}
      </div>
      <div role="status" aria-live="polite" className="break-words text-text-secondary">{busy || status}</div>
      {error && <p role="alert" className="break-words text-danger">{error}</p>}
      {image ? <figure className="m-0 overflow-auto rounded bg-surface p-2"><img src={`data:${image.mimeType};base64,${image.dataBase64}`} alt={`${copy.image} ${image.page}`} width={image.width} height={image.height} className="mx-auto h-auto max-w-full" /></figure> : <p className="text-text-secondary">{copy.empty}</p>}
    </section>}
  </div>;
}
