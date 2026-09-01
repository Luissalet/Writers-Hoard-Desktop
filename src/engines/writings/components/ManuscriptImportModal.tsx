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

import { useCallback, useMemo, useRef, useState } from 'react';
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
  readManuscriptFiles,
  readPastedManuscript,
  splitIntoChapters,
  suggestedHeadingLevel,
  suggestedSplitMode,
  type ChapterSplitMode,
  type ManuscriptErrorCode,
  type ManuscriptProgress,
  type ManuscriptSource,
} from '../manuscriptImport';
import { importManuscript, type ManuscriptImportResult } from '../manuscriptPersist';

interface ManuscriptImportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
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
  }
}

export default function ManuscriptImportModal({
  open,
  onClose,
  projectId,
  onImported,
}: ManuscriptImportModalProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sources, setSources] = useState<ManuscriptSource[]>([]);
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
  const load = async (read: () => Promise<ManuscriptSource[]>): Promise<void> => {
    setWorking(true);
    setProgress({ phase: 'reading', ratio: 0 });
    try {
      const next = await read();
      setSources(next);
      setRenamed({});
      setExcluded({});
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
    void load(() => readManuscriptFiles(files, (value) => setProgress(value)));
  };

  const handlePaste = (): void => {
    const label = t('writings.manuscriptImport.pastedLabel');
    void load(async () => [await readPastedManuscript(pasted, label)]);
  };

  const handleImport = async (): Promise<void> => {
    setConfirming(false);
    const picked = chapters
      .filter((chapter) => !excluded[chapter.key])
      .map((chapter) => ({
        title: renamed[chapter.key] ?? chapter.title,
        blocks: chapter.blocks,
      }));
    if (picked.length === 0) return;

    setWorking(true);
    setProgress({ phase: 'writing', ratio: 0 });

    let result: ManuscriptImportResult;
    try {
      result = await importManuscript(projectId, picked, (value) => setProgress(value));
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
                    onRename={(key, title) => setRenamed((current) => ({ ...current, [key]: title }))}
                    onToggle={(key) =>
                      setExcluded((current) => ({ ...current, [key]: !current[key] }))
                    }
                  />
                )}
                <p className="text-xs text-text-dim">{t('writings.manuscriptImport.safeNote')}</p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={working || includedCount === 0}
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
        message={t('writings.manuscriptImport.confirm')
          .replace('{count}', String(includedCount))
          .replace('{words}', includedWords.toLocaleString())}
        confirmLabel={t('writings.manuscriptImport.import')}
        onConfirm={() => void handleImport()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
