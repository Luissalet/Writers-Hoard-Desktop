import { useMemo, useState } from 'react';
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
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { canExportPdf } from '@/engines/writings/manuscriptExport';
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
const bulkButton = 'inline-flex items-center justify-center rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted transition hover:border-accent-gold hover:text-accent-gold disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted';

function initialDraft(
  project: Pick<Project, 'id' | 'title'>,
  writings: Writing[],
  variant: PublishingProfileModalProps['variant'],
  initialProfile?: PublishingProfile,
): PublishingProfile {
  if (initialProfile) return normalizePublishingProfile(initialProfile);
  const ordered = defaultPublishingOrder(writings.filter(writing => writing.projectId === project.id));
  const quickSelection = ordered.filter(writing => writing.status !== 'idea').map(writing => writing.id);
  return {
    id: '',
    projectId: project.id,
    name: variant === 'quick' ? project.title : '',
    format: 'manuscript',
    includeTitlePage: true,
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
  const [draft, setDraft] = useState<PublishingProfile>(() => initialDraft(project, writings, variant, initialProfile));
  const [busy, setBusy] = useState<PublishingOutput | 'save' | null>(null);

  const scopedWritings = useMemo(
    () => writings.filter(writing => writing.projectId === project.id),
    [project.id, writings],
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
  const resolution = resolvePublishingWritings(scopedWritings, draft);
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
  const actionDisabled = busy !== null || invalidSelection || invalidName;

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
    setBusy(output);
    try {
      const result = await exportPublishingProfile(
        project,
        { ...draft, name: draft.name.trim() },
        output,
        { titleOverride },
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
      setBusy(null);
    }
  };

  const modalTitle = variant === 'quick'
    ? t('projectTools.publishing.studio.quick')
    : variant === 'edit'
      ? t('projectTools.publishing.studio.edit')
      : t('projectTools.publishing.studio.new');

  return (
    <Modal open={open} onClose={onClose} title={modalTitle} wide>
      <div className="space-y-5">
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
          project={project}
          profile={draft}
          writings={scopedWritings}
          titleOverride={titleOverride}
        />

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
          {canExportPdf() && (
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
