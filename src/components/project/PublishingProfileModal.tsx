import {manuscriptProject,selectManuscriptWritings,writingSelection,type WritingSelection} from '@/engines/writings/manuscripts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  FileCode2,
  FileDown,
  FileText,
  FileType2,
  Loader2,
  Save,
} from 'lucide-react';
import Modal from '@/components/common/Modal';
import PublishingPreviewPane from '@/components/project/PublishingPreviewPane';
import BookStylePanel from '@/components/project/BookStylePanel';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { downloadBlobFile, sanitizeFilename } from '@/engines/writings/manuscriptExport';
import { TRIM_SIZES } from '@/engines/writings/bookStyle';
import { capturePublishingBatch, encodePublishingBatch, PUBLISHING_BATCH_OUTPUTS, type PublishingBatchCapture, type PublishingBatchFile, type PublishingBatchOutput } from '@/engines/writings/publishingBatch';
import { publishingSectionWordCount } from '@/engines/writings/publishingDocument';
import {
  defaultPublishingOrder,
  exportPublishingProfile,
  normalizePublishingProfile,
  resolvePublishingWritings,
  savePublishingProfile,
  type PublishingOutput,
} from '@/services/projectTools';
import type { Project, Writing } from '@/types';
import type {
  PublishingFormat,
  PublishingProfile,
  PublishingSelectionMode,
} from '@/types/projectTools';

export interface PublishingProfileModalProps {
  writingScope?:WritingSelection;
  eraId?:string;
  open: boolean;
  onClose: () => void;
  project: Pick<Project, 'id' | 'title'>;
  writings: Writing[];
  initialProfile?: PublishingProfile;
  variant: 'quick' | 'new' | 'edit';
  titleOverride?: string;
  onSaved?: (profile: PublishingProfile) => void;
}

const fieldClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold disabled:opacity-50';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent-gold px-3 py-2 text-sm font-semibold text-background transition hover:brightness-110 disabled:opacity-50';
const physicalFieldClass = 'w-full min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-base text-text-primary outline-none focus:border-accent-gold';
const batchSecondaryButton = secondaryButton.replace('text-sm', 'text-base') + ' min-h-10';
const batchPrimaryButton = primaryButton.replace('text-sm', 'text-base') + ' min-h-10';
const bulkButton = 'inline-flex items-center justify-center rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted transition hover:border-accent-gold hover:text-accent-gold disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted';

function initialDraft(
  project: Pick<Project, 'id' | 'title'>,
  writings: Writing[],
  variant: PublishingProfileModalProps['variant'],
  initialProfile?: PublishingProfile,
  writingScope?:WritingSelection,
): PublishingProfile {
  if (initialProfile) return normalizePublishingProfile(initialProfile);
  const ordered = defaultPublishingOrder(selectManuscriptWritings(writings.filter(writing => writing.projectId === project.id),writingScope));
  const quickSelection = ordered.filter(writing => writing.status !== 'idea').map(writing => writing.id);
  return {
    id: '',
    writingScope:writingSelection(writingScope),
    projectId: project.id,
    name: variant === 'quick' ? project.title : '',
    format: 'manuscript',
    includeTitlePage: true,
    includeToc: false,
    includeCopyright: false,
    includeBlurb: false,
    includeSynopsis: false,
    includeBibliography: false,
    citationStyle: 'apa',
    selectionMode: variant === 'quick' ? 'selected' : 'all',
    selectedWritingIds: variant === 'quick' ? quickSelection : ordered.map(writing => writing.id),
    writingOrder: ordered.map(writing => writing.id),
    createdAt: 0,
    updatedAt: 0,
  };
}

export default function PublishingProfileModal({
  writingScope,eraId,
  open,
  onClose,
  project,
  writings,
  initialProfile,
  variant,
  titleOverride,
  onSaved,
}: PublishingProfileModalProps) {
  const { t, locale } = useTranslation();
  // The compile shortcuts pass only the id and the title: the byline, the back
  // cover and the chapter images come from the stored project, as the export does.
  const stored = useLiveQuery(() => db.projects.get(project.id), [project.id]);
  const [draft, setDraft] = useState<PublishingProfile>(() => initialDraft(project, writings, variant, initialProfile,writingScope));
  const previewProject=useMemo(()=>{try{return stored?manuscriptProject(stored,draft.writingScope,eraId):project;}catch{return{...project,title:locale==='es'?'Relato no disponible':'Unavailable manuscript',author:'',blurb:'',readerPresentation:undefined};}},[stored,draft.writingScope,eraId,project,locale]);
  const [busy, setBusy] = useState<PublishingOutput | 'save' | 'batch' | 'zip' | null>(null);

  const [outputs, setOutputs] = useState<PublishingBatchOutput[]>(['html', 'pdf', 'docx', 'epub']);
  const [capture, setCapture] = useState<PublishingBatchCapture | null>(null);
  const [files, setFiles] = useState<PublishingBatchFile[]>([]);
  const [batchError, setBatchError] = useState('');
  const [printLayout, setPrintLayout] = useState({ trimWidthMm: 152.4, trimHeightMm: 228.6, spineMm: 0, bleedMm: 3, dpi: 300 });
  const preparedOutputs = useRef<PublishingBatchOutput[]>([]);
  const controller = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const mounted = useRef(true);
  const scope = JSON.stringify([project.id, eraId ?? '', writingSelection(draft.writingScope)]);
  const currentScope = useRef(scope);
  currentScope.current = open ? scope : '';
  const captureScope = useRef('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    operation.current++;
    controller.current?.abort();
    setBusy(null);
  }, [scope, open]);
  const batchCurrent = !!capture && currentScope.current === captureScope.current;
  const outputLabel = (output: PublishingBatchOutput) => output === 'print-cover'
    ? t('projectTools.publishing.batch.printCover') : output === 'markdown' ? 'Markdown' : output.toUpperCase();

  const scopedWritings = useMemo(
    () => selectManuscriptWritings(writings.filter(writing => writing.projectId === project.id),draft.writingScope),
    [project.id, writings,draft.writingScope],
  );
  const byId = useMemo(() => new Map(scopedWritings.map(writing => [writing.id, writing])), [scopedWritings]);
  const orderedWritings = useMemo(() => {
    const fallback = defaultPublishingOrder(scopedWritings);
    const seen = new Set<string>();
    const ordered: Writing[] = [];
    for (const id of draft.writingOrder ?? []) {
      const writing = byId.get(id);
      if (writing && !seen.has(id)) {
        seen.add(id);
        ordered.push(writing);
      }
    }
    for (const writing of fallback) {
      if (!seen.has(writing.id)) ordered.push(writing);
    }
    return ordered;
  }, [byId, draft.writingOrder, scopedWritings]);
  // Selection is independent of physical layout. A partially typed margin
  // remains an editable draft; save/export still validate the original profile.
  const resolution = resolvePublishingWritings(scopedWritings, { ...draft, marginsMm: undefined, initialPageNumber: undefined });
  const selectedIds = new Set(draft.selectedWritingIds);
  const selectedCount = resolution.writings.length;
  // `publishingSectionWordCount`, not `writing.wordCount`: this line and the
  // preview's estimate sit a few centimetres apart in the same dialog and both
  // claim to count the same selection, so they have to use the one formula the
  // exported title page adds up.
  const totalWords = resolution.writings.reduce(
    (sum, writing) => sum + publishingSectionWordCount(writing),
    0,
  );
  const invalidSelection = draft.selectionMode === 'selected' && selectedCount === 0;
  const invalidName = !draft.name.trim();
  const trim = TRIM_SIZES[draft.bookStyle?.trim ?? 'a4'];
  const invalidLayout = !!draft.marginsMm && (Object.values(draft.marginsMm).some(value => !Number.isFinite(value) || value < 0)
    || draft.marginsMm.top + draft.marginsMm.bottom >= trim.height
    || draft.marginsMm.inside + draft.marginsMm.outside >= trim.width)
    || draft.initialPageNumber !== undefined && (!Number.isSafeInteger(draft.initialPageNumber) || draft.initialPageNumber < 1);
  const previewProfile = useMemo(() => invalidLayout
    ? { ...draft, marginsMm: undefined, initialPageNumber: undefined }
    : draft, [draft, invalidLayout]);
  const actionDisabled = busy !== null || invalidSelection || invalidName || invalidLayout;

  const update = <K extends keyof PublishingProfile>(key: K, value: PublishingProfile[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
  };

  const setSelectionMode = (selectionMode: PublishingSelectionMode) => {
    setDraft(current => ({
      ...current,
      selectionMode,
      selectedWritingIds: selectionMode === 'selected' && current.selectedWritingIds.length === 0
        ? orderedWritings.map(writing => writing.id)
        : current.selectedWritingIds,
    }));
  };

  const toggleWriting = (id: string) => {
    setDraft(current => {
      const selected = new Set(current.selectedWritingIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { ...current, selectedWritingIds: [...selected] };
    });
  };

  /**
   * Bulk selection. Sending a single chapter to a beta reader used to cost one
   * uncheck per other writing in the project, because the quick profile seeds
   * every non-idea writing and nothing here could clear it.
   */
  const applySelection = (keep: (selected: boolean) => boolean) => {
    setDraft(current => {
      const selected = new Set(current.selectedWritingIds);
      return {
        ...current,
        selectedWritingIds: orderedWritings
          .filter(writing => keep(selected.has(writing.id)))
          .map(writing => writing.id),
      };
    });
  };

  const moveWriting = (id: string, direction: -1 | 1) => {
    const ids = orderedWritings.map(writing => writing.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    update('writingOrder', ids);
  };

  const save = async () => {
    if (actionDisabled || variant === 'quick') return;
    setBusy('save');
    try {
      const saved = await savePublishingProfile({
        ...draft,
        id: draft.id || undefined,
        name: draft.name.trim(),
      });
      setDraft(saved);
      onSaved?.(saved);
      toast.success(t('projectTools.publishing.saved'));
    } catch (error) {
      console.error('Publishing profile save failed', error);
      toast.error(t('projectTools.publishing.saveError'));
    } finally {
      setBusy(null);
    }
  };

  const exportProfile = async (output: PublishingOutput) => {
    if (actionDisabled) return;
    const origin = currentScope.current, id = ++operation.current;
    setBusy(output);
    try {
      const result = await exportPublishingProfile(
        project,
        { ...draft, name: draft.name.trim() },
        output,
        { titleOverride,eraId,isCurrent: () => mounted.current && currentScope.current === origin && operation.current === id },
      );
      if (result.ok) {
        toast.success(t('projectTools.publishing.exported').replace('{name}', draft.name.trim()));
        if (result.omittedImageCount) {
          toast.info(t('projectTools.publishing.portableImagesOmitted').replace(
            '{count}',
            String(result.omittedImageCount),
          ));
        }
        if (result.missingWritingIds.length > 0) {
          toast.info(t('projectTools.publishing.missingReferences').replace('{count}', String(result.missingWritingIds.length)));
        }
      } else if (!result.canceled) {
        if (result.reason === 'google-docs-without-content') {
          toast.error(t('projectTools.publishing.googleDocsEmptyError').replace(
            '{titles}',
            result.googleDocsWithoutContent.map(writing => writing.title).join(', '),
          ));
        } else if (result.reason === 'no-writings') {
          toast.error(t('projectTools.publishing.selectSomething'));
        } else if (result.reason === 'pdf-unavailable') {
          toast.error(t('projectTools.publishing.pdfUnavailable'));
        } else {
          toast.error(result.error || t('projectTools.publishing.exportError'));
        }
      }
    } catch (error) {
      console.error('Publishing export failed', error);
      toast.error(t('projectTools.publishing.exportError'));
    } finally {
      if (mounted.current && currentScope.current === origin && operation.current === id) setBusy(null);
    }
  };

  const prepareFiles = async (retry = false) => {
    if (busy || (!retry && actionDisabled) || (retry && !batchCurrent)) return;
    const selected = retry ? files.filter(file => file.status !== 'ready').map(file => file.output) : [...outputs];
    if (!selected.length) return;
    const id = ++operation.current, origin = currentScope.current;
    const abort = new AbortController(); controller.current = abort;
    setBusy('batch'); setBatchError('');
    if (!retry) { preparedOutputs.current = selected; setFiles([]); setCapture(null); }
    const valid = () => mounted.current && operation.current === id && currentScope.current === origin;
    try {
      const snapshot = retry ? capture! : await capturePublishingBatch({ projectId: project.id, profile: { ...draft, name: draft.name.trim() }, eraId, titleOverride, ...(selected.includes('print-cover') ? { printLayout } : {}) }, { signal: abort.signal });
      if (!valid()) return;
      if (!retry) { captureScope.current = origin; setCapture(snapshot); }
      const result = await encodePublishingBatch(snapshot, selected, { signal: abort.signal, onResult: file => {
        if (valid()) setFiles(previous => [...previous.filter(old => old.output !== file.output), file]);
      } });
      if (valid()) setFiles(previous => [...previous.filter(old => !selected.includes(old.output)), ...result]);
    } catch (error) {
      if (valid()) setBatchError(abort.signal.aborted ? t('projectTools.publishing.batch.canceled') : error instanceof Error ? error.message : String(error));
    } finally {
      if (valid()) { controller.current = null; setBusy(null); }
    }
  };
  const diagnosticsFor = (file: PublishingBatchFile): string[] => {
    const report = file.report as { diagnostics?: unknown } | undefined;
    return Array.isArray(report?.diagnostics) ? report.diagnostics.filter((value): value is string => typeof value === 'string').map(value => value === 'Remote or uncaptured image omitted; no network request' ? t('projectTools.publishing.batch.remoteOmitted') : value) : [];
  };
  const downloadFile = async (file: PublishingBatchFile) => {
    if (!batchCurrent || file.status !== 'ready' || !file.bytes) return;
    const origin = captureScope.current, token = operation.current, snapshot = capture;
    const blob = new Blob([file.bytes.slice().buffer], { type: file.mime });
    // Keep the check after the final asynchronous materialization too.
    const bytes = await blob.arrayBuffer();
    if (!mounted.current || currentScope.current !== origin || snapshot !== capture || operation.current !== token) return;
    downloadBlobFile(new Blob([bytes], { type: file.mime }), file.filename);
  };
  const downloadZip = async () => {
    if (!batchCurrent || busy) return;
    const ready = files.filter(file => file.status === 'ready' && file.bytes);
    if (!ready.length) return;
    const origin = captureScope.current, token = operation.current, snapshot = capture;
    setBusy('zip');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const file of ready) zip.file(file.filename, file.bytes!.slice());
      const blob = await zip.generateAsync({ type: 'blob' });
      if (!mounted.current || currentScope.current !== origin || snapshot !== capture || operation.current !== token) return;
      downloadBlobFile(blob, `${sanitizeFilename(snapshot!.title)}.zip`);
    } catch (error) { if (mounted.current && currentScope.current === origin && operation.current === token) setBatchError(String(error)); }
    finally { if (mounted.current && currentScope.current === origin && operation.current === token) setBusy(null); }
  };

  const modalTitle = variant === 'quick'
    ? t('projectTools.publishing.studio.quick')
    : variant === 'edit'
      ? t('projectTools.publishing.studio.edit')
      : t('projectTools.publishing.studio.new');

  return (
    <Modal open={open} onClose={onClose} title={modalTitle} wide>
      <div className="space-y-5">
        {variant!=='quick'&&<label className="block text-sm text-text-muted">{locale==='es'?'Capítulos de':'Chapters from'}<select className={`${fieldClass} mt-1.5`} value={writingSelection(draft.writingScope).kind==='world'?'world':(writingSelection(draft.writingScope) as {id:string}).id} onChange={event=>{const scope:WritingSelection=event.target.value==='world'?{kind:'world'}:{kind:'manuscript',id:event.target.value};const ids=selectManuscriptWritings(writings,scope).map(row=>row.id);setDraft(value=>({...value,writingScope:scope,selectedWritingIds:ids,writingOrder:ids}));}}><option value="main">{locale==='es'?'Relato principal':'Main manuscript'}</option>{stored?.manuscriptCatalog?.entries.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}<option value="world">{locale==='es'?'Todo el mundo (selección combinada)':'Entire world (combined selection)'}</option></select></label>}
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <label className="text-sm text-text-muted">
            {t('projectTools.publishing.name')}
            <input
              value={draft.name}
              onChange={event => update('name', event.target.value)}
              className={`${fieldClass} mt-1.5`}
              autoFocus
            />
          </label>
          <label className="text-sm text-text-muted">
            {t('projectTools.publishing.formatLabel')}
            <select
              value={draft.format}
              onChange={event => update('format', event.target.value as PublishingFormat)}
              className={`${fieldClass} mt-1.5`}
            >
              {(['manuscript', 'screenplay', 'research', 'biography', 'video'] as PublishingFormat[]).map(format => (
                <option key={format} value={format}>{t(`projectTools.publishing.format.${format}`)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-3 rounded-lg border border-border bg-background/40 p-3 text-sm text-text-muted">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={draft.includeTitlePage} onChange={event => update('includeTitlePage', event.target.checked)} className="accent-accent-gold" />
            {t('projectTools.publishing.titlePage')}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={draft.includeToc ?? false} onChange={event => update('includeToc', event.target.checked)} className="accent-accent-gold" />
            {t('projectTools.publishing.includeToc')}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" data-testid="publishing-include-copyright" checked={draft.includeCopyright ?? false} onChange={event => update('includeCopyright', event.target.checked)} className="accent-accent-gold" />
            {t('projectTools.publishing.includeCopyright')}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" data-testid="publishing-include-blurb" checked={draft.includeBlurb ?? false} onChange={event => update('includeBlurb', event.target.checked)} className="accent-accent-gold" />
            {t('projectTools.publishing.includeBlurb')}
          </label>
          <label className="flex cursor-pointer items-center gap-2" title={t('projectTools.publishing.includeCoverHint')}>
            <input type="checkbox" data-testid="publishing-include-cover" checked={draft.includeCover ?? false} onChange={event => update('includeCover', event.target.checked)} className="accent-accent-gold" />
            {t('projectTools.publishing.includeCover')}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" data-testid="publishing-include-chapter-images" checked={draft.includeChapterImages ?? false} onChange={event => update('includeChapterImages', event.target.checked)} className="accent-accent-gold" />
            {t('projectTools.publishing.includeChapterImages')}
          </label>
          <label className="flex cursor-pointer items-center gap-2" title={t('projectTools.publishing.includeInlineImagesHint')}>
            <input type="checkbox" data-testid="publishing-include-inline-images" checked={draft.includeInlineImages ?? false} onChange={event => update('includeInlineImages', event.target.checked)} className="accent-accent-gold" />
            {t('projectTools.publishing.includeInlineImages')}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={draft.includeSynopsis} onChange={event => update('includeSynopsis', event.target.checked)} className="accent-accent-gold" />
            {t('projectTools.publishing.synopsis')}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={draft.includeBibliography} onChange={event => update('includeBibliography', event.target.checked)} className="accent-accent-gold" />
            {t('projectTools.publishing.bibliography')}
          </label>
          {draft.includeBibliography && (
            <select
              value={draft.citationStyle}
              onChange={event => update('citationStyle', event.target.value as PublishingProfile['citationStyle'])}
              aria-label={t('projectTools.publishing.citationStyle')}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
            >
              <option value="apa">APA</option>
              <option value="mla">MLA</option>
              <option value="chicago">Chicago</option>
            </select>
          )}
        </div>

        <BookStylePanel value={draft.bookStyle} onChange={bookStyle => update('bookStyle', bookStyle)} />

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-text-primary">{t('projectTools.publishing.layout.title')}</legend>
          <p id="publishing-layout-hint" className="text-xs text-text-muted">{t('projectTools.publishing.layout.hint')}</p>
          <label className="flex min-h-10 items-center gap-2 text-base text-text-primary"><input type="checkbox" checked={!!draft.marginsMm} onChange={event => update('marginsMm', event.target.checked ? { top: trim.margin, bottom: trim.margin, inside: trim.margin, outside: trim.margin } : undefined)} className="accent-accent-gold" />{t('projectTools.publishing.layout.customMargins')}</label>
          {draft.marginsMm && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(['top', 'bottom', 'inside', 'outside'] as const).map(side => <label key={side} className="min-w-0 text-xs text-text-muted">{t(`projectTools.publishing.layout.${side}`)} (mm)<input type="number" min="0" step="0.1" aria-describedby="publishing-layout-hint" value={draft.marginsMm![side]} onChange={event => update('marginsMm', { ...draft.marginsMm!, [side]: Number(event.target.value) })} className={`${physicalFieldClass} mt-1`} /></label>)}</div>}
          <label className="block max-w-60 text-xs text-text-muted">{t('projectTools.publishing.layout.initialPage')}<input type="number" min="1" step="1" value={draft.initialPageNumber ?? ''} placeholder={t('projectTools.publishing.layout.default')} onChange={event => update('initialPageNumber', event.target.value === '' ? undefined : Number(event.target.value))} className={`${physicalFieldClass} mt-1`} /></label>
          {invalidLayout && <p role="alert" className="text-sm text-red-300">{t('projectTools.publishing.layout.invalid')}</p>}
        </fieldset>

        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h3 className="mr-auto text-sm font-semibold text-text-primary">{t('projectTools.publishing.writings')}</h3>
            {(['all', 'selected'] as PublishingSelectionMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setSelectionMode(mode)}
                className={draft.selectionMode === mode ? primaryButton : secondaryButton}
              >
                {t(`projectTools.publishing.selection.${mode}`)}
              </button>
            ))}
          </div>

          {resolution.missingWritingIds.length > 0 && (
            <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              {t('projectTools.publishing.missingReferences').replace('{count}', String(resolution.missingWritingIds.length))}
            </p>
          )}
          {invalidSelection && (
            <p className="mb-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {t('projectTools.publishing.selectSomething')}
            </p>
          )}

          {/* Bulk selection. Disabled — never hidden — while the profile takes
              every writing: the checkboxes below are inert in that mode too,
              and a control that vanishes reads as a control that is missing. */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => applySelection(() => false)}
              disabled={draft.selectionMode === 'all'}
              className={bulkButton}
            >
              {t('projectTools.publishing.selectNone')}
            </button>
            <button
              type="button"
              onClick={() => applySelection(() => true)}
              disabled={draft.selectionMode === 'all'}
              className={bulkButton}
            >
              {t('projectTools.publishing.selectAll')}
            </button>
            <button
              type="button"
              onClick={() => applySelection(selected => !selected)}
              disabled={draft.selectionMode === 'all'}
              className={bulkButton}
            >
              {t('projectTools.publishing.selectInvert')}
            </button>
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-background/40 p-2">
            {orderedWritings.length === 0 && (
              <p className="py-6 text-center text-sm text-text-dim">{t('projectTools.publishing.noWritings')}</p>
            )}
            {orderedWritings.map((writing, index) => {
              const selected = draft.selectionMode === 'all' || selectedIds.has(writing.id);
              const missingGoogleContent = Boolean(writing.isGoogleDoc) && resolution.googleDocsWithoutContent.some(item => item.id === writing.id);
              return (
                <div
                  key={writing.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${selected ? 'border-accent-gold/30 bg-accent-gold/5' : 'border-transparent'}`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={draft.selectionMode === 'all'}
                    onChange={() => toggleWriting(writing.id)}
                    className="accent-accent-gold disabled:opacity-50"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">
                      {writing.chapter !== undefined && <span className="mr-1.5 font-semibold text-accent-gold">{writing.chapter}.</span>}
                      {writing.title}
                    </p>
                    <p className={`text-[10px] ${missingGoogleContent ? 'text-red-300' : 'text-text-dim'}`}>
                      {(writing.wordCount || 0).toLocaleString(locale)} {t('writings.words')}
                      {writing.isGoogleDoc && ` · ${t(missingGoogleContent ? 'projectTools.publishing.googleDocMissing' : 'projectTools.publishing.googleDocCached')}`}
                    </p>
                  </div>
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moveWriting(writing.id, -1)} disabled={index === 0} aria-label={t('projectTools.publishing.moveUp')} className="p-0.5 text-text-dim hover:text-text-primary disabled:opacity-20"><ChevronUp size={14} /></button>
                    <button type="button" onClick={() => moveWriting(writing.id, 1)} disabled={index === orderedWritings.length - 1} aria-label={t('projectTools.publishing.moveDown')} className="p-0.5 text-text-dim hover:text-text-primary disabled:opacity-20"><ChevronDown size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-text-dim">
            {t('projectTools.publishing.selectionSummary')
              .replace('{count}', String(selectedCount))
              .replace('{words}', totalWords.toLocaleString(locale))}
          </p>
        </section>

        <PublishingPreviewPane
          project={previewProject}
          profile={previewProfile}
          writings={scopedWritings}
          titleOverride={titleOverride}
        />

        <section aria-label={t('projectTools.publishing.batch.title')} className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-text-primary">{t('projectTools.publishing.batch.title')}</h3>
          <p className="text-xs text-text-muted">{t('projectTools.publishing.batch.hint')}</p>
          <fieldset disabled={busy === 'batch'} className="flex flex-wrap gap-x-5 gap-y-3"><legend className="sr-only">{t('projectTools.publishing.batch.formats')}</legend>{PUBLISHING_BATCH_OUTPUTS.map(output => <label key={output} className="flex min-h-10 items-center gap-2 text-base text-text-primary"><input type="checkbox" checked={outputs.includes(output)} onChange={event => setOutputs(previous => event.target.checked ? [...previous, output] : previous.filter(item => item !== output))} className="accent-accent-gold" />{outputLabel(output)}</label>)}</fieldset>
          {outputs.includes('print-cover') && <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-5"><legend className="mb-2 text-xs text-text-muted">{t('projectTools.publishing.batch.printHint')}</legend><button type="button" className={`${batchSecondaryButton} col-span-2 sm:col-span-5 justify-self-start`} onClick={() => setPrintLayout(value => ({ ...value, trimWidthMm: trim.width, trimHeightMm: trim.height }))}>{t('projectTools.publishing.batch.fitTrim')}</button>{(['trimWidthMm', 'trimHeightMm', 'spineMm', 'bleedMm', 'dpi'] as const).map(key => <label key={key} className="min-w-0 text-xs text-text-muted">{t(`projectTools.publishing.batch.${key}`)}<input type="number" min={key === 'spineMm' || key === 'bleedMm' ? 0 : 1} step={key === 'dpi' ? 1 : 0.1} value={printLayout[key]} onChange={event => setPrintLayout(value => ({ ...value, [key]: Number(event.target.value) }))} className={`${physicalFieldClass} mt-1`} /></label>)}</fieldset>}
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void prepareFiles()} disabled={actionDisabled || !outputs.length} className={batchPrimaryButton}>{busy === 'batch' && <Loader2 size={15} className="animate-spin" />}{t('projectTools.publishing.batch.prepare')}</button>{busy === 'batch' && <button type="button" onClick={() => controller.current?.abort()} className={batchSecondaryButton}>{t('common.cancel')}</button>}{capture && files.some(file => file.status !== 'ready') && <button type="button" onClick={() => void prepareFiles(true)} disabled={!!busy || !batchCurrent} className={batchSecondaryButton}>{t('projectTools.publishing.batch.retry')}</button>}</div>
          {batchError && <p role="alert" className="break-words text-sm text-red-300">{batchError}</p>}
          {capture && <div className="space-y-2" aria-live="polite"><p className="break-words text-xs text-text-muted">{capture.title} · {new Date(capture.capturedAt).toLocaleString(locale)} · {t('projectTools.publishing.batch.summary').replace('{ready}', String(files.filter(file => file.status === 'ready').length)).replace('{requested}', String(preparedOutputs.current.length))}</p>{!batchCurrent && <p className="text-xs text-amber-300">{t('projectTools.publishing.batch.contextChanged')}</p>}<ul className="divide-y divide-border">{files.map(file => <li key={file.output} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 break-words text-sm text-text-primary">{outputLabel(file.output)} · {t(`projectTools.publishing.batch.${file.status}`)}{file.bytes ? ` · ${file.bytes.byteLength.toLocaleString(locale)} B` : ''}{file.error && <span className="block break-words text-xs text-red-300">{file.error}</span>}{diagnosticsFor(file).map((message, index) => <span key={index} className="block break-words text-xs text-text-muted">{message}</span>)}</span>{file.status === 'ready' && <button type="button" disabled={!batchCurrent} onClick={() => void downloadFile(file)} className={batchSecondaryButton}>{t('projectTools.publishing.batch.download')}</button>}</li>)}</ul><button type="button" onClick={() => void downloadZip()} disabled={!!busy || !batchCurrent || !files.some(file => file.status === 'ready')} className={batchSecondaryButton}>{t('projectTools.publishing.batch.zip')}</button></div>}
        </section>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {variant !== 'quick' && (
            <button type="button" onClick={() => void save()} disabled={actionDisabled} className={secondaryButton}>
              {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {t('common.save')}
            </button>
          )}
          <button type="button" onClick={() => void exportProfile('markdown')} disabled={actionDisabled} className={secondaryButton}>
            {busy === 'markdown' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            Markdown
          </button>
          <button type="button" onClick={() => void exportProfile('html')} disabled={actionDisabled} className={secondaryButton}>
            {busy === 'html' ? <Loader2 size={15} className="animate-spin" /> : <FileCode2 size={15} />}
            HTML
          </button>
          <button type="button" onClick={() => void exportProfile('docx')} disabled={actionDisabled} className={secondaryButton}>
            {busy === 'docx' ? <Loader2 size={15} className="animate-spin" /> : <FileType2 size={15} />}
            {t('projectTools.publishing.output.docx')}
          </button>
          <button type="button" onClick={() => void exportProfile('epub')} disabled={actionDisabled} className={secondaryButton}>
            {busy === 'epub' ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />}
            {t('projectTools.publishing.output.epub')}
          </button>
          {(
            <button type="button" onClick={() => void exportProfile('pdf')} disabled={actionDisabled} className={primaryButton}>
              {busy === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
              PDF
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto px-3 py-2 text-sm text-text-muted hover:text-text-primary">
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
