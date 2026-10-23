// ============================================
// Manuscript import — pick, preview, import
// ============================================
//
// The door for a writer who already has a book: a .docx from Word, a folder of
// Markdown chapters, one long .md, or the whole thing pasted in.
//
// The order of the three panels is the point. Files are READ first (nothing is
// stored), the chapters that were found are SHOWN with their titles and word
// counts and the rule that produced them, and only a deliberate confirmation
// WRITES — as new drafts, appended after whatever the project already holds.
// Until that last click the database has not been touched, so the wrong rule,
// the wrong file, or a change of mind costs nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { db } from '@/db';
import { eraWritingOperations } from '@/services/worldEras/writings';
import { readWorldDocument } from '@/services/worldEras/store';
import { inspectManuscriptFile } from '../manuscriptReview/inspect';
import { planManuscriptImport } from '../manuscriptReview/plan';
import { applyManuscriptImport } from '../manuscriptReview/persist';
import { manuscriptFindingLabel } from '../manuscriptReview/findings';
import type { ImportChoice, InspectedManuscript, ManuscriptPlan, ManuscriptSourceRow } from '../manuscriptReview/types';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';
import { projectWritingHtml } from '../revisionProjection';
import { Upload, Files, Hash, Scissors, LoaderCircle, FileText } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { ConfirmDialog } from '@/engines/_shared';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import ManuscriptChapterList, { type ManuscriptChapterRow } from './ManuscriptChapterList';
import {
  MANUSCRIPT_ACCEPT,
  ManuscriptImportError,
  availableHeadingLevels,
  MAX_SOURCE_BYTES,
  MAX_TOTAL_BYTES,
  splitIntoChapters,
  suggestedHeadingLevel,
  suggestedSplitMode,
  type ChapterSplitMode,
  type ManuscriptErrorCode,
  type ManuscriptProgress,
} from '../manuscriptImport';
import type { ManuscriptImportResult } from '../manuscriptPersist';

interface ManuscriptImportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  eraId?: string;
  /** Called once the rows exist, so the list behind the modal catches up. */
  onImported: () => void | Promise<void>;
}

/** The scene break most manuscripts use. Editable, and remembered per session. */
const DEFAULT_SEPARATOR = '***';

type Translate = (key: string) => string;

/**
 * One literal key per refusal. A composed key (`error.${code}`) would read the
 * same and be invisible to the conformance check that proves every key a
 * screen asks for actually exists in both locales.
 */
function errorMessage(t: Translate, code: ManuscriptErrorCode): string {
  switch (code) {
    case 'empty':
      return t('writings.manuscriptImport.error.empty');
    case 'unsupported':
      return t('writings.manuscriptImport.error.unsupported');
    case 'too-large':
      return t('writings.manuscriptImport.error.too-large');
    case 'read-failed':
      return t('writings.manuscriptImport.error.read-failed');
    case 'not-zip':
      return t('writings.manuscriptImport.error.not-zip');
    case 'invalid-docx':
      return t('writings.manuscriptImport.error.invalid-docx');
    case 'no-text':
      return t('writings.manuscriptImport.error.no-text');
    case 'no-chapters':
      return t('writings.manuscriptImport.error.no-chapters');
    case 'invalid-epub':
      return t('writings.manuscriptImport.error.invalid-epub');
    case 'invalid-pdf':
      return t('writings.manuscriptImport.error.invalid-pdf');
    case 'scanned-pdf':
      return t('writings.manuscriptImport.error.scanned-pdf');
    case 'protected':
      return t('writings.manuscriptImport.error.protected');
  }
}

export default function ManuscriptImportModal({
  open,
  onClose,
  projectId,
  eraId,
  onImported,
}: ManuscriptImportModalProps) {
  const { t, locale } = useTranslation();
  const es = locale === 'es';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sources, setSources] = useState<InspectedManuscript[]>([]);
  const [targets, setTargets] = useState<{ id: string; title: string; updatedAt: number; version: string }[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<ManuscriptPlan | null>(null);
  const [planError, setPlanError] = useState('');
  const [savedSources, setSavedSources] = useState<ManuscriptSourceRow[]>([]);
  const [pasted, setPasted] = useState('');
  const [mode, setMode] = useState<ChapterSplitMode>('heading');
  const [headingLevel, setHeadingLevel] = useState(1);
  const [separator, setSeparator] = useState(DEFAULT_SEPARATOR);
  /** Per-chapter overrides, keyed so they survive a change of rule. */
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<ManuscriptProgress | null>(null);
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);

  const chapterLabel = t('writings.chapter');
  useEffect(() => { let active = true; void (async () => {
    const scope = { projectId, eraId }, rows = await eraWritingOperations(scope).getWritings(projectId);
    const next = await Promise.all(rows.map(async row => ({ id: row.id, title: row.title, updatedAt: row.updatedAt, version: (await readWorldDocument(scope, 'writings', row.id))!.version })));
    const stored = (await db.manuscriptSources.where('projectId').equals(projectId).toArray()).filter(row => row.receipts.some(receipt => receipt.eraId === eraId));
    if (active) { setTargets(next); setSavedSources(stored); }
  })().catch(error => { if (active) setPlanError(String(error)); }); return () => { active = false; }; }, [projectId, eraId]);
  const levels = useMemo(() => availableHeadingLevels(sources), [sources]);

  const chapters = useMemo(
    () =>
      splitIntoChapters(sources, {
        mode,
        headingLevel,
        separator,
        fallbackTitle: (index) => `${chapterLabel} ${index}`,
      }),
    [sources, mode, headingLevel, separator, chapterLabel],
  );

  const rows: ManuscriptChapterRow[] = chapters.map((chapter) => ({
    key: chapter.key,
    title: renamed[chapter.key] ?? chapter.title,
    words: chapter.words,
    included: !excluded[chapter.key],
  }));
  const includedCount = rows.reduce((total, row) => total + (row.included ? 1 : 0), 0);
  const includedWords = rows.reduce((total, row) => total + (row.included ? row.words : 0), 0);
  const choices: ImportChoice[] = rows.map(row => { const target = targets.find(target => target.id === selectedTargets[row.key]); return { key: row.key, title: row.title || chapters.find(chapter => chapter.key === row.key)!.title, included: row.included, ...(target ? { targetId: target.id, expectedUpdatedAt: target.updatedAt, expectedDocumentVersion: target.version } : {}) }; });
  const choiceKey = JSON.stringify(choices);
  useEffect(() => { let active = true; setPlan(null); setPlanError(''); if (sources.length) void planManuscriptImport(sources, { mode, headingLevel, separator }, { projectId, eraId }, JSON.parse(choiceKey) as ImportChoice[]).then(value => { if (active) setPlan(value); }).catch(error => { if (active) setPlanError(error instanceof Error ? error.message : String(error)); }); return () => { active = false; }; }, [sources, mode, headingLevel, separator, choiceKey, projectId, eraId]);

  const describeError = useCallback(
    (error: unknown): string => {
      if (error instanceof ManuscriptImportError) {
        const message = errorMessage(t, error.code);
        return error.detail ? `${message} (${error.detail})` : message;
      }
      console.error('[manuscriptImport] failed', error);
      return t('writings.manuscriptImport.error.failed');
    },
    [t],
  );

  /** Read something new, then open the preview on the rule that suits it. */
  const load = async (read: () => Promise<InspectedManuscript[]>): Promise<void> => {
    setWorking(true);
    setProgress({ phase: 'reading', ratio: 0 });
    try {
      const next = await read();
      setSources(next);
      setRenamed({});
      setExcluded({});
      setSelectedTargets({});
      setMode(suggestedSplitMode(next));
      setHeadingLevel(suggestedHeadingLevel(next));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };

  const handleFiles = (list: FileList | null): void => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    void load(async () => {
      if (files.some(file => file.size > MAX_SOURCE_BYTES) || files.reduce((n, file) => n + file.size, 0) > MAX_TOTAL_BYTES) throw new ManuscriptImportError('too-large');
      const next: InspectedManuscript[] = [];
      for (const [index, file] of files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).entries()) { setProgress({ phase: 'reading', ratio: index / files.length, detail: file.name }); next.push(await inspectManuscriptFile(file)); }
      return next;
    });
  };

  const handlePaste = (): void => {
    const label = t('writings.manuscriptImport.pastedLabel');
    void load(async () => [await inspectManuscriptFile(new File([pasted], `${label}.md`, { type: 'text/markdown' }))]);
  };

  const handleImport = async (): Promise<void> => {
    setConfirming(false);
    if (!plan) return;

    setWorking(true);
    setProgress({ phase: 'writing', ratio: 0 });

    let result: ManuscriptImportResult;
    try {
      result = await applyManuscriptImport({ projectId, eraId }, sources, { mode, headingLevel, separator }, choices, plan.digest);
    } catch (error) {
      // The transaction rolled back: the project is exactly as it was, and the
      // preview stays on screen so the writer can try again or change the rule.
      toast.error(describeError(error));
      setWorking(false);
      setProgress(null);
      return;
    }

    toast.success(
      t('writings.manuscriptImport.done')
        .replace('{chapters}', String(result.chapterCount))
        .replace('{words}', result.wordCount.toLocaleString()),
    );

    try {
      await onImported();
    } catch (error) {
      // The chapters are committed. A list that failed to reload is not an
      // import that failed, and must never be reported as one.
      console.error('[manuscriptImport] the list could not be refreshed', error);
    }
    // Closing unmounts this modal, which is also how its state is reset.
    onClose();
  };

  /**
   * Escape and the backdrop must not walk out on a write in flight — nor take
   * the whole modal with them when the key was meant for the confirmation
   * dialog stacked on top of it.
   */
  const handleClose = (): void => {
    if (!working && !confirming) onClose();
  };

  const modeButton = (value: ChapterSplitMode, Icon: typeof Hash, label: string, enabled: boolean) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      disabled={!enabled || working}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm border transition disabled:opacity-40 ${
        mode === value
          ? 'border-accent-gold/40 bg-accent-gold/10 text-accent-gold font-semibold'
          : 'border-border text-text-muted hover:text-text-primary'
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  );

  const percent = progress ? Math.round(Math.min(1, Math.max(0, progress.ratio)) * 100) : 0;

  return (
    <>
      <Modal open={open} onClose={handleClose} title={t('writings.manuscriptImport.title')} wide>
        <div className="space-y-5">
          {savedSources.length > 0 && <details className="rounded-lg border border-border p-3 text-sm text-text-secondary"><summary>{es?'Fuentes originales conservadas':'Preserved original sources'} ({savedSources.length})</summary><ul className="mt-2 space-y-2">{savedSources.map(source => <li key={source.id}><button type="button" className="break-all text-left text-accent-gold underline-offset-4 hover:underline" onClick={() => saveAs(source.original, source.name)}>{source.name}</button><span className="ml-2 text-xs">{source.receipts.filter(receipt => receipt.eraId === eraId).length} {es?'importaciones':'imports'}</span></li>)}</ul></details>}
          {sources.length === 0 ? (
            <>
              <p className="text-sm text-text-muted">{t('writings.manuscriptImport.intro')}</p>

              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  handleFiles(event.dataTransfer.files);
                }}
                className={`flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-8 text-center transition ${
                  dragging ? 'border-accent-gold bg-accent-gold/5' : 'border-border'
                }`}
              >
                <Upload size={28} className="text-text-dim" />
                <p className="text-sm text-text-primary">{t('writings.manuscriptImport.dropHere')}</p>
                <p className="text-xs text-text-muted">{t('writings.manuscriptImport.formats')}</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={working}
                  className="px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition disabled:opacity-50"
                >
                  {t('writings.manuscriptImport.chooseFiles')}
                </button>
              </div>

              <div className="space-y-2">
                <label className="block text-sm text-text-muted">
                  {t('writings.manuscriptImport.pasteLabel')}
                </label>
                <textarea
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder={t('writings.manuscriptImport.pastePlaceholder')}
                  rows={5}
                  className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary placeholder:text-text-dim outline-none focus:border-accent-gold transition resize-y"
                />
                <button
                  type="button"
                  onClick={handlePaste}
                  disabled={working || !pasted.trim()}
                  className="px-4 py-2 border border-border text-text-primary text-sm rounded-lg hover:bg-elevated transition disabled:opacity-40"
                >
                  {t('writings.manuscriptImport.usePaste')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Files size={15} className="shrink-0" />
                <span className="truncate">{sources.map((source) => source.name).join(' · ')}</span>
              </div>

              {/* The rule, in the open and changeable — every change re-splits
                  the same parsed text, so it costs nothing to try another. */}
              <div className="space-y-2">
                <label className="block text-sm text-text-muted">
                  {t('writings.manuscriptImport.rule')}
                </label>
                <div className="flex gap-2">
                  {modeButton('heading', Hash, t('writings.manuscriptImport.rule.heading'), levels.length > 0)}
                  {modeButton('separator', Scissors, t('writings.manuscriptImport.rule.separator'), true)}
                  {modeButton('file', FileText, t('writings.manuscriptImport.rule.file'), true)}
                </div>

                {mode === 'heading' && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-muted">
                      {t('writings.manuscriptImport.headingLevel')}
                    </span>
                    <div className="flex gap-1">
                      {levels.map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setHeadingLevel(level)}
                          disabled={working}
                          className={`px-2.5 py-1 rounded-md text-xs border transition ${
                            headingLevel === level
                              ? 'border-accent-gold/40 bg-accent-gold/10 text-accent-gold'
                              : 'border-border text-text-muted hover:text-text-primary'
                          }`}
                        >
                          H{level}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-text-dim">
                      {t('writings.manuscriptImport.rule.headingHint')}
                    </span>
                  </div>
                )}

                {mode === 'separator' && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-muted">
                      {t('writings.manuscriptImport.separatorLabel')}
                    </span>
                    <input
                      value={separator}
                      disabled={working}
                      onChange={(event) => setSeparator(event.target.value)}
                      placeholder={DEFAULT_SEPARATOR}
                      className="w-32 px-2 py-1 bg-elevated border border-border rounded-md text-sm text-text-primary outline-none focus:border-accent-gold transition font-mono"
                    />
                    <span className="text-xs text-text-dim">
                      {t('writings.manuscriptImport.rule.separatorHint')}
                    </span>
                  </div>
                )}

                {mode === 'file' && (
                  <p className="text-xs text-text-dim">{t('writings.manuscriptImport.rule.fileHint')}</p>
                )}

                {levels.length === 0 && (
                  <p className="text-xs text-text-dim">{t('writings.manuscriptImport.rule.noHeadings')}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-text-muted">
                    {t('writings.manuscriptImport.chapters')}
                  </label>
                  <span className="text-xs text-text-muted">
                    {t('writings.manuscriptImport.summary')
                      .replace('{count}', String(includedCount))
                      .replace('{words}', includedWords.toLocaleString())}
                  </span>
                </div>
                {rows.length === 0 ? (
                  <p className="rounded-lg border border-border px-3 py-4 text-sm text-text-muted">
                    {t('writings.manuscriptImport.nothing')}
                  </p>
                ) : (
                  <ManuscriptChapterList
                    rows={rows}
                    disabled={working}
                    targets={targets}
                    selectedTargets={selectedTargets}
                    onTarget={(key, targetId) => setSelectedTargets(current => ({ ...current, [key]: targetId }))}
                    previews={Object.fromEntries(plan?.chapters.map(chapter => [chapter.key, `${es ? 'Texto final' : 'Final text'}: ${htmlToText(projectWritingHtml(chapter.content)).slice(0, 220)}${chapter.pendingRevisions ? ` · ${chapter.pendingRevisions} ${es ? 'cambios conservados para revisar' : 'changes retained for review'}` : ''}`]) ?? [])}
                    onRename={(key, title) => setRenamed((current) => ({ ...current, [key]: title }))}
                    onToggle={(key) =>
                      setExcluded((current) => ({ ...current, [key]: !current[key] }))
                    }
                  />
                )}
                <p className="text-xs text-text-dim">{choices.some(choice => choice.included && choice.targetId) ? (es?'Sólo se reemplazan los destinos elegidos. Se conserva su versión previa; un conflicto cancela todo el lote.':'Only selected targets are replaced. Their previous versions are preserved; a conflict cancels the whole batch.') : t('writings.manuscriptImport.safeNote')}</p>
                {plan && <section aria-label={es?'Diagnóstico de importación':'Import findings'} className="space-y-2 rounded-lg border border-border bg-elevated/40 p-3 text-xs leading-relaxed text-text-secondary"><p className="text-text-primary">{plan.importedComments} {es?'comentarios con rango exacto':'comments with exact ranges'} · {plan.retainedComments} {es?'disponibles sólo en el original':'available in the original only'}</p>{plan.findings.length > 0 && <ul className="space-y-1">{plan.findings.map((finding, index) => <li key={`${finding.code}-${index}`}>{manuscriptFindingLabel(finding.code, locale)} ({finding.count})</li>)}</ul>}<div className="flex flex-wrap gap-3">{sources.map((source, index) => <button type="button" key={`${source.sha256}-${index}`} className="break-all text-left text-accent-gold hover:underline" onClick={() => saveAs(source.original, source.name)}>{es?'Descargar original':'Download original'}: {source.name}</button>)}</div></section>}
                {planError && <p role="alert" className="text-sm text-danger">{planError}</p>}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={working || includedCount === 0 || !plan}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition disabled:opacity-40"
                >
                  {working && <LoaderCircle size={16} className="animate-spin" />}
                  {t('writings.manuscriptImport.import')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSources([]);
                    setRenamed({});
                    setExcluded({});
                  }}
                  disabled={working}
                  className="px-4 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition disabled:opacity-40"
                >
                  {t('writings.manuscriptImport.startOver')}
                </button>
              </div>
            </>
          )}

          {progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span className="truncate">
                  {progress.phase === 'reading'
                    ? t('writings.manuscriptImport.phase.reading')
                    : t('writings.manuscriptImport.phase.writing')}
                  {progress.detail ? ` · ${progress.detail}` : ''}
                </span>
                <span className="tabular-nums">{percent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                <div className="h-full bg-accent-gold" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={MANUSCRIPT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              handleFiles(event.target.files);
              // Let the same file be chosen again after a change of mind.
              event.target.value = '';
            }}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        title={t('writings.manuscriptImport.title')}
        message={choices.some(choice => choice.included && choice.targetId) ? (es?`Se aplicarán ${includedCount} capítulos: ${choices.filter(choice => choice.included && choice.targetId).length} reemplazos explícitos y los demás como borradores nuevos. Se conserva el original y la versión previa de los destinos.`:`Apply ${includedCount} chapters: ${choices.filter(choice => choice.included && choice.targetId).length} explicit replacements and the rest as new drafts. Original source and previous target versions are preserved.`) : t('writings.manuscriptImport.confirm')
          .replace('{count}', String(includedCount))
          .replace('{words}', includedWords.toLocaleString())}
        confirmLabel={t('writings.manuscriptImport.import')}
        onConfirm={() => void handleImport()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
