import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { BookOpen, ChevronDown, X } from 'lucide-react';
import { applyEditorialStyle, configureEditorialList, describeEditorial, describeEditorialReferences, generateEditorialBibliography, insertEditorialCitation, refreshEditorialReferences, removeEditorialCitation, removeEditorialStyle, setEditorialSection, upsertEditorialStyle } from '@/engines/writings/editorial';
import { citationFromReference, DEFAULT_EDITORIAL_SECTION, type EditorialReference, type EditorialResult, type EditorialSection, type NamedEditorialStyle } from './model';
import { normalizeAdvancedFormatting } from '../advanced/model';
import { chapterBlocks, CHAPTER_HEADING_NAME } from '../chapterHeading/chapterBlocks';

const COPY = {
  es: {
    title: 'Editorial', panel: 'Herramientas editoriales', close: 'Cerrar herramientas editoriales', scope: 'Capítulo actual',
    styles: 'Estilos guardados', style: 'Estilo', newStyle: 'Nuevo estilo', name: 'Nombre del estilo', save: 'Guardar formato actual', apply: 'Aplicar estilo', update: 'Actualizar con el formato actual', rename: 'Renombrar estilo', remove: 'Eliminar estilo', styleHint: 'El estilo aplica el formato a los párrafos seleccionados. Actualizarlo cambia también los párrafos vinculados de este capítulo; eliminarlo conserva su formato.',
    layout: 'Diseño y secciones', section: 'Sección', newSection: 'Nueva sección', paper: 'Papel', custom: 'Personalizado', orientation: 'Orientación', portrait: 'Vertical', landscape: 'Horizontal', width: 'Anchura (pt)', height: 'Altura (pt)', marginTop: 'Margen superior (pt)', marginRight: 'Margen derecho (pt)', marginBottom: 'Margen inferior (pt)', marginLeft: 'Margen izquierdo (pt)', start: 'Inicio de sección', continuous: 'Continuo', nextPage: 'Página siguiente', evenPage: 'Página par', oddPage: 'Página impar', header: 'Cabecera', footer: 'Pie de página', saveLayout: 'Guardar diseño', insertSection: 'Nueva sección desde el cursor', layoutHint: 'Las medidas se guardan en puntos. La nueva sección comienza antes del bloque donde está el cursor.',
    references: 'Citas y bibliografía', source: 'Fuente de Investigación', chooseSource: 'Elegir fuente', noSources: 'Añade fuentes en Investigación para citarlas aquí.', loadingSources: 'Cargando fuentes de Investigación…', label: 'Texto visible de la cita', locator: 'Página o localizador', evidence: 'Identificador de evidencia (opcional)', insertCitation: 'Insertar cita', refresh: 'Actualizar fuentes citadas', bibliography: 'Generar o actualizar bibliografía', removeCitation: 'Quitar cita', changed: 'La fuente ha cambiado.', retracted: 'La fuente está retirada.', missing: 'La fuente ya no está disponible.', citationHint: 'La etiqueta fija el texto visible; página y evidencia se guardan con la copia de la fuente. La bibliografía reúne los datos de las fuentes citadas. Actualiza las copias cuando quieras incorporar cambios.', noCitations: 'No hay citas en este capítulo.',
    lists: 'Listas', listKind: 'Tipo de lista', ordered: 'Numerada', bullet: 'Viñetas', listStart: 'Número inicial', listLevel: 'Nivel', configureList: 'Aplicar lista',
    done: 'Guardado. Puedes deshacerlo en el editor.', unchanged: 'El documento ya tenía esos valores.', error: 'No se pudo aplicar el cambio. Revisa los campos y la selección.', range: 'Selecciona el cuerpo del capítulo actual.', layoutError: 'Las dimensiones y los márgenes deben dejar espacio para el texto.',
  },
  en: {
    title: 'Editorial', panel: 'Editorial tools', close: 'Close editorial tools', scope: 'Current chapter',
    styles: 'Saved styles', style: 'Style', newStyle: 'New style', name: 'Style name', save: 'Save current formatting', apply: 'Apply style', update: 'Update from current formatting', rename: 'Rename style', remove: 'Delete style', styleHint: 'A style formats the selected paragraphs. Updating it also updates linked paragraphs in this chapter; deleting it keeps their formatting.',
    layout: 'Page layout and sections', section: 'Section', newSection: 'New section', paper: 'Paper', custom: 'Custom', orientation: 'Orientation', portrait: 'Portrait', landscape: 'Landscape', width: 'Width (pt)', height: 'Height (pt)', marginTop: 'Top margin (pt)', marginRight: 'Right margin (pt)', marginBottom: 'Bottom margin (pt)', marginLeft: 'Left margin (pt)', start: 'Section start', continuous: 'Continuous', nextPage: 'Next page', evenPage: 'Even page', oddPage: 'Odd page', header: 'Header', footer: 'Footer', saveLayout: 'Save page layout', insertSection: 'New section at cursor', layoutHint: 'Measurements are saved in points. A new section starts before the block containing the cursor.',
    references: 'Citations and bibliography', source: 'Research source', chooseSource: 'Choose source', noSources: 'Add Research sources to cite them here.', loadingSources: 'Loading Research sources…', label: 'Citation display text', locator: 'Page or locator', evidence: 'Evidence identifier (optional)', insertCitation: 'Insert citation', refresh: 'Refresh cited sources', bibliography: 'Generate or update bibliography', removeCitation: 'Remove citation', changed: 'The source has changed.', retracted: 'The source is retracted.', missing: 'The source is no longer available.', citationHint: 'The label sets the visible text; the locator and evidence are saved with the source snapshot. The bibliography lists the cited source data. Refresh snapshots when you want to incorporate changes.', noCitations: 'This chapter has no citations.',
    lists: 'Lists', listKind: 'List type', ordered: 'Numbered', bullet: 'Bullets', listStart: 'Starting number', listLevel: 'Level', configureList: 'Apply list',
    done: 'Saved. You can undo this in the editor.', unchanged: 'The document already had those values.', error: 'The change could not be applied. Check the fields and selection.', range: 'Select the current chapter body.', layoutError: 'Page dimensions and margins must leave room for text.',
  },
} as const;
const control = 'min-w-0 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-40';
const button = `${control} inline-flex min-h-8 items-center justify-center gap-1.5 hover:bg-surface/80`;
const detailsClass = 'space-y-3 border-t border-border pt-3';
type SectionDraft = Omit<EditorialSection, 'id'>;

function currentChapter(editor: Editor) {
  const type = editor.schema.nodes[CHAPTER_HEADING_NAME];
  if (!type) return { from: 0, to: editor.state.doc.content.size, key: '', title: '' };
  const current = chapterBlocks(editor.state.doc, type).slice().reverse().find(block => block.from <= editor.state.selection.from);
  if (!current) return { from: 0, to: 0, key: '', title: '' };
  const heading = current.headingPos === null ? null : editor.state.doc.nodeAt(current.headingPos);
  return { from: heading ? current.headingPos! + heading.nodeSize : current.from, to: current.to, key: current.writingId ?? current.clientId ?? `heading:${current.headingPos}`, title: heading?.textContent ?? '' };
}
function capturedStyle(editor: Editor, id: string, name: string): NamedEditorialStyle {
  const headingLevel = editor.isActive('heading') ? editor.getAttributes('heading').level as NamedEditorialStyle['headingLevel'] : 0;
  return { id, name, format: normalizeAdvancedFormatting({ ...editor.getAttributes('advancedTextStyle'), ...editor.getAttributes(headingLevel ? 'heading' : 'paragraph') }), headingLevel, bold: editor.isActive('bold'), italic: editor.isActive('italic'), underline: editor.isActive('underline') };
}

export default function EditorialControls({ editor, locale = 'es', references }: { editor: Editor; locale?: 'es' | 'en'; references?: readonly EditorialReference[] }) {
  const copy = COPY[locale]; const panelId = useId(); const scope = currentChapter(editor);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ editor, scopeKey: scope.key, styleId: '', styleName: '', sectionId: '', section: { ...DEFAULT_EDITORIAL_SECTION } as SectionDraft, sourceId: '', label: '', locator: '', evidenceId: '', kind: 'ordered' as 'ordered' | 'bullet', start: 1, level: 1, status: '', error: '' });
  if (form.editor !== editor || form.scopeKey !== scope.key) setForm({ editor, scopeKey: scope.key, styleId: '', styleName: '', sectionId: '', section: { ...DEFAULT_EDITORIAL_SECTION }, sourceId: '', label: '', locator: '', evidenceId: '', kind: 'ordered', start: 1, level: 1, status: '', error: '' });
  const subscribe = (changed: () => void) => { editor.on('transaction', changed); editor.on('update', changed); return () => { editor.off('transaction', changed); editor.off('update', changed); }; };
  const state = useSyncExternalStore(subscribe, () => editor.state);
  const editable = useSyncExternalStore(subscribe, () => editor.isEditable);
  const description = useMemo(() => open && state.doc === editor.state.doc ? describeEditorial(editor, { from: scope.from, to: scope.to }) : { styles: [], sections: [], citations: [] }, [editor, open, state.doc, scope.from, scope.to]);
  const notices = useMemo(() => references && state.doc === editor.state.doc ? describeEditorialReferences(editor, references, { from: scope.from, to: scope.to }) : [], [editor, references, state.doc, scope.from, scope.to]);
  const selectedStyle = description.styles.find(style => style.id === form.styleId);
  const selectedReference = references?.find(reference => reference.id === form.sourceId);
  const mutate = (work: () => EditorialResult) => {
    if (!editor.isEditable || editor.isDestroyed) return;
    try {
      const result = work();
      setForm(current => ({ ...current, status: result.ok ? result.changed ? copy.done : copy.unchanged : '', error: result.ok ? '' : result.reason?.startsWith('Page dimensions') ? copy.layoutError : result.reason?.includes('chapter') || result.reason?.includes('selection') ? copy.range : copy.error }));
    } catch { setForm(current => ({ ...current, status: '', error: copy.error })); }
  };
  const toggle = () => {
    if (!open) {
      const data = describeEditorial(editor, scope);
      const active = data.sections.slice().reverse().find(section => section.position <= editor.state.selection.from) ?? data.sections[0];
      const styleId = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').editorialStyleId ?? '';
      setForm(current => ({ ...current, sectionId: active?.id ?? '', section: active ?? { ...DEFAULT_EDITORIAL_SECTION }, styleId, styleName: data.styles.find(style => style.id === styleId)?.name ?? '' }));
    }
    setOpen(value => !value);
  };
  const saveStyle = (update: boolean) => mutate(() => {
    const id = update ? form.styleId : crypto.randomUUID();
    const result = upsertEditorialStyle(editor, capturedStyle(editor, id, form.styleName.trim()), scope);
    if (result.ok) setForm(current => ({ ...current, styleId: id }));
    return result;
  });
  const saveSection = (atCursor: boolean) => mutate(() => {
    const id = atCursor || !form.sectionId ? crypto.randomUUID() : form.sectionId;
    const selection = editor.state.selection.$from;
    const from = atCursor ? Math.max(scope.from, selection.depth ? selection.before(1) : selection.pos) : scope.from;
    const result = setEditorialSection(editor, { ...form.section, id }, { from, to: scope.to });
    if (result.ok) setForm(current => ({ ...current, sectionId: id }));
    return result;
  });
  const insertCitation = () => mutate(() => {
    if (!selectedReference) return { ok: false, changed: false };
    const position = editor.state.selection.to;
    return insertEditorialCitation(editor, citationFromReference(selectedReference, { id: crypto.randomUUID(), label: form.label || selectedReference.title, locator: form.locator || undefined, evidenceId: form.evidenceId || undefined }), { from: position, to: position }, scope);
  });
  const numericKeys = ['pageWidth', 'pageHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
  const shortSide = Math.min(form.section.pageWidth, form.section.pageHeight);
  const longSide = Math.max(form.section.pageWidth, form.section.pageHeight);
  const paper = Math.abs(shortSide - 595.2756) < 1 && Math.abs(longSide - 841.8898) < 1 ? 'a4' : shortSide === 612 && longSide === 792 ? 'letter' : 'custom';
  return <div data-editorial-controls className="w-full min-w-0 border-b border-border bg-surface/50 px-2 py-1.5">
    <button type="button" className={button} aria-label={copy.panel} aria-expanded={open} aria-controls={panelId} onClick={toggle}><BookOpen size={15} aria-hidden="true" />{copy.title}<ChevronDown size={13} aria-hidden="true" /></button>
    {open && <section id={panelId} aria-label={copy.panel} className="mt-3 min-w-0 space-y-3 text-xs text-text-primary" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } }}>
      <div className="flex items-center justify-between gap-2"><span className="break-words text-text-secondary">{copy.scope}{scope.title ? `: ${scope.title}` : ''}</span><button type="button" className={button} aria-label={copy.close} onClick={() => setOpen(false)}><X size={14} aria-hidden="true" /></button></div>
      <details open className={detailsClass}>
        <summary className="cursor-pointer font-medium focus-visible:outline-accent-gold">{copy.styles}</summary>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">{copy.style}<select className={control} aria-label={copy.style} value={form.styleId} onChange={event => { const style = description.styles.find(item => item.id === event.target.value); setForm(current => ({ ...current, styleId: style?.id ?? '', styleName: style?.name ?? '' })); }}><option value="">{copy.newStyle}</option>{description.styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">{copy.name}<input className={control} aria-label={copy.name} value={form.styleName} disabled={!editable} onChange={event => setForm(current => ({ ...current, styleName: event.target.value }))} /></label>
        </div>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!editable || !form.styleName.trim()} onClick={() => saveStyle(false)}>{copy.save}</button><button type="button" className={button} disabled={!editable || !selectedStyle} onClick={() => mutate(() => applyEditorialStyle(editor, { id: form.styleId }, scope))}>{copy.apply}</button><button type="button" className={button} disabled={!editable || !selectedStyle || !form.styleName.trim()} onClick={() => saveStyle(true)}>{copy.update}</button><button type="button" className={button} disabled={!editable || !selectedStyle || !form.styleName.trim()} onClick={() => mutate(() => upsertEditorialStyle(editor, { ...selectedStyle!, name: form.styleName.trim() }, scope))}>{copy.rename}</button><button type="button" className={button} disabled={!editable || !selectedStyle} onClick={() => mutate(() => removeEditorialStyle(editor, form.styleId, scope))}>{copy.remove}</button></div>
        <p className="max-w-prose text-text-secondary">{copy.styleHint}</p>
      </details>
      <details className={detailsClass}>
        <summary className="cursor-pointer font-medium focus-visible:outline-accent-gold">{copy.layout}</summary>
        <label className="flex flex-col gap-1">{copy.section}<select className={control} aria-label={copy.section} value={form.sectionId} onChange={event => { const section = description.sections.find(item => item.id === event.target.value); setForm(current => ({ ...current, sectionId: section?.id ?? '', section: section ?? { ...DEFAULT_EDITORIAL_SECTION } })); }}><option value="">{copy.newSection}</option>{description.sections.map((section, index) => <option key={section.id} value={section.id}>{copy.section} {index + 1}</option>)}</select></label>
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1">{copy.paper}<select className={control} aria-label={copy.paper} value={paper} disabled={!editable} onChange={event => { const size = event.target.value === 'a4' ? { pageWidth: 595.2756, pageHeight: 841.8898 } : event.target.value === 'letter' ? { pageWidth: 612, pageHeight: 792 } : {}; setForm(current => ({ ...current, section: { ...current.section, ...size } })); }}><option value="a4">A4</option><option value="letter">Letter</option><option value="custom">{copy.custom}</option></select></label>
          <label className="flex flex-col gap-1">{copy.orientation}<select className={control} aria-label={copy.orientation} value={form.section.pageWidth > form.section.pageHeight ? 'landscape' : 'portrait'} disabled={!editable} onChange={event => { if ((event.target.value === 'landscape') !== (form.section.pageWidth > form.section.pageHeight)) setForm(current => ({ ...current, section: { ...current.section, pageWidth: current.section.pageHeight, pageHeight: current.section.pageWidth } })); }}><option value="portrait">{copy.portrait}</option><option value="landscape">{copy.landscape}</option></select></label>
          <label className="flex flex-col gap-1">{copy.start}<select className={control} aria-label={copy.start} value={form.section.start} disabled={!editable} onChange={event => setForm(current => ({ ...current, section: { ...current.section, start: event.target.value as EditorialSection['start'] } }))}>{(['continuous', 'nextPage', 'evenPage', 'oddPage'] as const).map(value => <option key={value} value={value}>{copy[value]}</option>)}</select></label>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{numericKeys.map(key => <label key={key} className="flex min-w-0 flex-col gap-1">{key === 'pageWidth' ? copy.width : key === 'pageHeight' ? copy.height : copy[key]}<input className={`${control} w-full`} type="number" min={0} step="any" aria-label={key === 'pageWidth' ? copy.width : key === 'pageHeight' ? copy.height : copy[key]} value={form.section[key]} disabled={!editable} onChange={event => setForm(current => ({ ...current, section: { ...current.section, [key]: Number(event.target.value) } }))} /></label>)}</div>
        {(['header', 'footer'] as const).map(key => <label key={key} className="flex flex-col gap-1">{copy[key]}<textarea className={`${control} w-full resize-y`} aria-label={copy[key]} value={form.section[key]} disabled={!editable} onChange={event => setForm(current => ({ ...current, section: { ...current.section, [key]: event.target.value } }))} /></label>)}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!editable} onClick={() => saveSection(false)}>{copy.saveLayout}</button><button type="button" className={button} disabled={!editable} onClick={() => saveSection(true)}>{copy.insertSection}</button></div><p className="text-text-secondary">{copy.layoutHint}</p>
      </details>
      <details className={detailsClass}>
        <summary className="cursor-pointer font-medium focus-visible:outline-accent-gold">{copy.references}</summary>
        <label className="flex flex-col gap-1">{copy.source}<select className={control} aria-label={copy.source} value={form.sourceId} disabled={!editable} onChange={event => { const source = references?.find(item => item.id === event.target.value); setForm(current => ({ ...current, sourceId: source?.id ?? '', label: source?.title ?? '' })); }}><option value="">{copy.chooseSource}</option>{references?.map(reference => <option key={reference.id} value={reference.id}>{reference.title}</option>)}</select></label>
        {!references?.length && <p className="text-text-secondary">{references ? copy.noSources : copy.loadingSources}</p>}
        {(['label', 'locator', 'evidenceId'] as const).map(key => <label key={key} className="flex flex-col gap-1">{key === 'evidenceId' ? copy.evidence : copy[key]}<input className={control} aria-label={key === 'evidenceId' ? copy.evidence : copy[key]} value={form[key]} disabled={!editable} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></label>)}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!editable || !selectedReference} onClick={insertCitation}>{copy.insertCitation}</button><button type="button" className={button} disabled={!editable || !references || !description.citations.length} onClick={() => mutate(() => refreshEditorialReferences(editor, references!, scope))}>{copy.refresh}</button><button type="button" className={button} disabled={!editable || !description.citations.length} onClick={() => mutate(() => generateEditorialBibliography(editor, references, scope))}>{copy.bibliography}</button></div>
        <p className="max-w-prose text-text-secondary">{copy.citationHint}</p>
        <ul className="m-0 list-none divide-y divide-border p-0">{description.citations.map(citation => <li key={citation.id} data-editorial-citation-id={citation.id} className="space-y-1 py-2"><p className="break-words font-medium">{citation.label}{citation.locator ? ` · ${citation.locator}` : ''}</p><p className="break-words text-text-secondary">{citation.title} · {citation.sourceId}</p>{notices.filter(notice => notice.citationId === citation.id).map(notice => <p key={notice.kind} data-source-notice={notice.kind} role="status" className="text-text-secondary">{copy[notice.kind]}</p>)}<button type="button" className={button} disabled={!editable} onClick={() => mutate(() => removeEditorialCitation(editor, citation.id, scope))}>{copy.removeCitation}</button></li>)}</ul>
        {!description.citations.length && <p className="text-text-secondary">{copy.noCitations}</p>}
      </details>
      <details className={detailsClass}>
        <summary className="cursor-pointer font-medium focus-visible:outline-accent-gold">{copy.lists}</summary>
        <div className="flex flex-wrap items-end gap-2"><label className="flex flex-col gap-1">{copy.listKind}<select className={control} aria-label={copy.listKind} value={form.kind} disabled={!editable} onChange={event => setForm(current => ({ ...current, kind: event.target.value as 'ordered' | 'bullet' }))}><option value="ordered">{copy.ordered}</option><option value="bullet">{copy.bullet}</option></select></label><label className="flex min-w-0 flex-1 flex-col gap-1">{copy.listStart}<input className={`${control} w-full`} type="number" aria-label={copy.listStart} value={form.start} disabled={!editable || form.kind === 'bullet'} onChange={event => setForm(current => ({ ...current, start: Number(event.target.value) }))} /></label><label className="flex min-w-0 flex-1 flex-col gap-1">{copy.listLevel}<input className={`${control} w-full`} type="number" min={1} aria-label={copy.listLevel} value={form.level} disabled={!editable} onChange={event => setForm(current => ({ ...current, level: Number(event.target.value) }))} /></label><button type="button" className={button} disabled={!editable} onClick={() => mutate(() => configureEditorialList(editor, { kind: form.kind, start: form.kind === 'ordered' ? form.start : undefined, level: form.level }, undefined, scope))}>{copy.configureList}</button></div>
      </details>
      <p role="status" aria-live="polite" className="break-words text-text-secondary">{form.status}</p>{form.error && <p role="alert" className="break-words text-danger">{form.error}</p>}
    </section>}
  </div>;
}
