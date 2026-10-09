import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db';
import { EngineSpinner } from '@/engines/_shared';
import { navigateTo } from '@/engines/_shared/anchoring';
import type { EngineComponentProps } from '@/engines/_types';
import { downloadTextFile } from '@/engines/writings/manuscriptExport';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import {
  deleteComment, importResponse, packageChapterStatus, refreshAnchors, renderStoredPackage,
  restoreComment, setCommentResolved, createPackage, writePackageFile, recordPackagePath,
  type PackageChapterStatus,
} from '@/services/betaReading/store';
import { statusOf, type BetaCommentRow, type BetaPackageRow, type BetaResponseRow, type BetaStatus } from '@/services/betaReading/types';
import type { Writing } from '@/types';
import '../i18n';

const fieldClass = 'rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-gold';
const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline focus-visible:outline-accent-gold disabled:opacity-50';
const primaryClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-gold px-3 py-1.5 text-sm font-medium text-background transition hover:brightness-110 focus-visible:outline focus-visible:outline-accent-gold disabled:opacity-50';
const cardClass = 'rounded-xl border border-border bg-surface';

const CHIP: Record<BetaStatus, string> = {
  attached: 'border-emerald-500 text-emerald-400',
  moved: 'border-amber-500 text-amber-400',
  orphaned: 'border-red-500 text-red-400',
  resolved: 'border-border text-text-dim',
};

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_all, key: string) => String(values[key] ?? ''));
}

interface Model {
  writings: Writing[];
  packages: BetaPackageRow[];
  responses: BetaResponseRow[];
  comments: BetaCommentRow[];
  chapterStatus: PackageChapterStatus[];
}

/** Live model: the rows, re-anchored whenever a chapter or a comment changes. */
function useBetaReading(projectId: string) {
  const [model, setModel] = useState<Model | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const subscription = liveQuery(async () => ({
      writings: await db.writings.where('projectId').equals(projectId).toArray(),
      packages: await db.betaPackages.where('projectId').equals(projectId).toArray(),
      responses: await db.betaResponses.where('projectId').equals(projectId).toArray(),
      comments: await db.betaComments.where('projectId').equals(projectId).toArray(),
    })).subscribe({
      next: value => {
        void (async () => {
          try {
            // Writes nothing unless a chapter changed since a comment was judged; then the next emission is the fresh one.
            const moved = await refreshAnchors(projectId);
            if (moved || cancelled) return;
            const chapterStatus = await packageChapterStatus(projectId);
            if (!cancelled) { setModel({ ...value, chapterStatus }); setFailed(false); }
          } catch {
            if (!cancelled) setFailed(true);
          }
        })();
      },
      error: () => setFailed(true),
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [projectId, attempt]);

  return { model, failed, retry: () => setAttempt(value => value + 1) };
}

const byChapterOrder = (a: Writing, b: Writing) =>
  (a.chapter ?? Number.MAX_SAFE_INTEGER) - (b.chapter ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt;

export default function BetaReadingEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { model, failed, retry } = useBetaReading(projectId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<{ chapter: string; status: string; reader: string }>({ chapter: '', status: '', reader: '' });
  const [undo, setUndo] = useState<BetaCommentRow | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const chapters = useMemo(() => [...(model?.writings ?? [])].sort(byChapterOrder), [model?.writings]);
  const titles = useMemo(() => new Map(chapters.map(writing => [writing.id, writing.title || '—'])), [chapters]);
  const nextVersion = (model?.packages.reduce((max, row) => Math.max(max, row.version), 0) ?? 0) + 1;

  const create = useCallback(async () => {
    if (!picked.size) { toast.error(t('betaReading.create.pickSome')); return; }
    setBusy(true);
    try {
      const made = await createPackage(projectId, [...picked]);
      const path = await writePackageFile(made.html, made.filename);
      if (path) await recordPackagePath(made.row.id, path);
      else downloadTextFile(made.html, made.filename, 'text/html');
      toast.success(`${fill(t('betaReading.create.done'), { version: made.row.version, count: made.row.chapters.length })} ${
        path ? fill(t('betaReading.create.saved'), { path }) : t('betaReading.create.downloaded')}`);
      setPicked(new Set());
    } catch (error) {
      toast.error(fill(t('betaReading.create.failed'), { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }, [picked, projectId, t]);

  const downloadAgain = (row: BetaPackageRow) => {
    const { html, filename } = renderStoredPackage(row);
    downloadTextFile(html, filename, 'text/html');
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const report = await importResponse(projectId, await file.text());
        toast.success(fill(t('betaReading.import.result'), {
          reader: report.reader, imported: report.imported, duplicates: report.duplicates,
          attached: report.attached, moved: report.moved, orphaned: report.orphaned,
        }), 6000);
      } catch (error) {
        toast.error(fill(t('betaReading.import.failed'), { file: file.name, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const remove = async (row: BetaCommentRow) => {
    const gone = await deleteComment(row.id);
    if (!gone) return;
    setUndo(gone);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 10_000);
  };

  const undoDelete = async () => {
    if (!undo) return;
    await restoreComment(undo);
    setUndo(null);
  };

  if (failed) {
    return (
      <div role="alert" className="p-6 text-sm text-text-primary">
        {t('betaReading.loadError')} <button type="button" className={buttonClass} onClick={retry}>{t('betaReading.retry')}</button>
      </div>
    );
  }
  if (!model) return <EngineSpinner />;

  const readers = [...new Set(model.comments.map(row => row.reader))].sort();
  const visible = model.comments.filter(row =>
    (!filter.chapter || row.writingId === filter.chapter)
    && (!filter.reader || row.reader === filter.reader)
    && (!filter.status || statusOf(row) === filter.status));
  const orphaned = visible.filter(row => !row.resolved && row.anchorState === 'orphaned');
  const rest = visible.filter(row => !orphaned.includes(row));
  const chapterIds = [...new Set(rest.map(row => row.writingId))];
  const changeFor = (writingId: string) => model.chapterStatus.find(item => item.chapterId === writingId && item.change.changed);

  const commentCard = (row: BetaCommentRow) => {
    const status = statusOf(row);
    const gone = !titles.has(row.writingId);
    return (
      <li key={row.id} data-testid="beta-comment" data-status={status} className={`${cardClass} space-y-2 p-3`}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-dim">
          <span data-testid="beta-status" className={`rounded-full border px-2 py-0.5 ${CHIP[status]}`}>{t(`betaReading.status.${status}`)}</span>
          <span>{row.reader}</span>
          <span>{fill(t('betaReading.comments.version'), { version: row.packageVersion })}</span>
          {gone && <span>{t('betaReading.comments.missingChapter')}</span>}
        </div>
        {row.anchor.quote
          ? <blockquote className="border-l-2 border-border pl-3 text-sm italic text-text-dim">{row.anchor.quote}</blockquote>
          : <p className="text-xs text-text-dim">{t('betaReading.comments.wholeChapter')}</p>}
        {status === 'moved' && <p className="text-xs text-amber-400">{t('betaReading.comments.movedHint')}</p>}
        <p className="whitespace-pre-wrap text-sm text-text-primary">{row.text}</p>
        <div className="flex flex-wrap gap-2">
          {!gone && (
            <button type="button" className={buttonClass} onClick={() => navigateTo(`/project/${encodeURIComponent(projectId)}/writings?writing=${encodeURIComponent(row.writingId)}`)}>
              {t('betaReading.comments.jump')}
            </button>
          )}
          <button type="button" className={buttonClass} data-testid="beta-toggle-resolved" onClick={() => void setCommentResolved(row.id, !row.resolved)}>
            {row.resolved ? t('betaReading.comments.reopen') : t('betaReading.comments.resolve')}
          </button>
          <button type="button" className={buttonClass} data-testid="beta-delete" onClick={() => void remove(row)}>{t('betaReading.comments.delete')}</button>
        </div>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6" data-testid="beta-reading">
      <header className="space-y-2">
        <h2 className="font-serif text-xl font-semibold text-text-primary">{t('engines.beta-reading.name')}</h2>
        <p className="max-w-prose text-sm text-text-dim">{t('betaReading.intro')}</p>
      </header>

      <section className={`${cardClass} space-y-3 p-4`} aria-label={t('betaReading.create.title')}>
        <h3 className="text-base font-semibold text-text-primary">{t('betaReading.create.title')}</h3>
        <p className="text-sm text-text-dim">{fill(t('betaReading.create.hint'), { version: nextVersion })}</p>
        {chapters.length === 0 ? <p className="text-sm text-text-dim">{t('betaReading.create.none')}</p> : (
          <>
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={picked.size === chapters.length} onChange={event => setPicked(event.target.checked ? new Set(chapters.map(item => item.id)) : new Set())} />
              {t('betaReading.create.selectAll')}
            </label>
            <ul className="max-h-64 space-y-1 overflow-auto">
              {chapters.map(writing => (
                <li key={writing.id}>
                  <label className="flex items-center gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox" data-testid={`beta-pick-${writing.id}`} checked={picked.has(writing.id)}
                      onChange={event => setPicked(previous => { const next = new Set(previous); if (event.target.checked) next.add(writing.id); else next.delete(writing.id); return next; })}
                    />
                    <span>{writing.chapter !== undefined ? `${writing.chapter}. ` : ''}{writing.title || '—'}</span>
                    <span className="text-xs text-text-dim">{fill(t('betaReading.create.words'), { count: writing.wordCount })}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <button type="button" className={primaryClass} data-testid="beta-create" disabled={busy || chapters.length === 0} onClick={() => void create()}>
          {t('betaReading.create.button')}
        </button>
      </section>

      <section className={`${cardClass} space-y-3 p-4`} aria-label={t('betaReading.packages.title')}>
        <h3 className="text-base font-semibold text-text-primary">{t('betaReading.packages.title')}</h3>
        {model.packages.length === 0 ? <p className="text-sm text-text-dim">{t('betaReading.packages.empty')}</p> : (
          <ul className="space-y-3">
            {[...model.packages].sort((a, b) => b.version - a.version).map(pack => (
              <li key={pack.id} data-testid="beta-package" className="space-y-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-3 text-sm text-text-primary">
                  <strong>{fill(t('betaReading.packages.version'), { version: pack.version })}</strong>
                  <span className="text-text-dim">{new Date(pack.createdAt).toLocaleString()}</span>
                  <span className="text-text-dim">{fill(t('betaReading.packages.chapters'), { count: pack.chapters.length })}</span>
                  <button type="button" className={buttonClass} onClick={() => downloadAgain(pack)}>{t('betaReading.packages.download')}</button>
                </div>
                {pack.filePath && <p className="break-all text-xs text-text-dim">{pack.filePath}</p>}
                <ul className="text-xs text-text-dim">
                  {pack.chapters.map(chapter => {
                    const state = model.chapterStatus.find(item => item.packageId === pack.id && item.chapterId === chapter.chapterId);
                    const diff = state?.change.diff;
                    return (
                      <li key={chapter.chapterId} data-testid="beta-chapter-status" data-changed={state?.change.changed ? 'true' : 'false'}>
                        {chapter.title}: {!state?.exists ? t('betaReading.packages.gone')
                          : !state.change.changed ? t('betaReading.packages.unchanged')
                            : diff ? fill(t('betaReading.packages.changed'), { added: diff.added, removed: diff.removed, paragraphs: diff.changedParagraphs })
                              : t('betaReading.packages.changedNoText')}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${cardClass} space-y-3 p-4`} aria-label={t('betaReading.import.title')}>
        <h3 className="text-base font-semibold text-text-primary">{t('betaReading.import.title')}</h3>
        <p className="text-sm text-text-dim">{t('betaReading.import.hint')}</p>
        <input
          ref={fileInput} type="file" accept=".json,application/json" multiple className="hidden" data-testid="beta-import-input"
          onChange={event => void importFiles(event.target.files)}
        />
        <button type="button" className={primaryClass} onClick={() => fileInput.current?.click()}>{t('betaReading.import.button')}</button>
        {model.responses.length > 0 && (
          <ul className="text-xs text-text-dim" data-testid="beta-readers">
            {model.responses.map(response => (
              <li key={response.id}>{fill(t('betaReading.import.readerLine'), {
                reader: response.reader, version: response.packageVersion,
                count: model.comments.filter(row => row.responseId === response.id).length,
              })}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-label={t('betaReading.comments.title')}>
        <h3 className="text-base font-semibold text-text-primary">{t('betaReading.comments.title')} ({model.comments.length})</h3>
        {model.comments.length === 0 ? <p className="text-sm text-text-dim">{t('betaReading.comments.empty')}</p> : (
          <>
            <div className="flex flex-wrap gap-3 text-sm text-text-primary">
              <label className="space-y-1"><span className="block text-xs text-text-dim">{t('betaReading.comments.filterChapter')}</span>
                <select className={fieldClass} value={filter.chapter} onChange={event => setFilter(previous => ({ ...previous, chapter: event.target.value }))}>
                  <option value="">{t('betaReading.comments.all')}</option>
                  {[...new Set(model.comments.map(row => row.writingId))].map(id => <option key={id} value={id}>{titles.get(id) ?? id}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="block text-xs text-text-dim">{t('betaReading.comments.filterStatus')}</span>
                <select className={fieldClass} data-testid="beta-filter-status" value={filter.status} onChange={event => setFilter(previous => ({ ...previous, status: event.target.value }))}>
                  <option value="">{t('betaReading.comments.all')}</option>
                  {(['attached', 'moved', 'orphaned', 'resolved'] as const).map(key => <option key={key} value={key}>{t(`betaReading.status.${key}`)}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="block text-xs text-text-dim">{t('betaReading.comments.filterReader')}</span>
                <select className={fieldClass} value={filter.reader} onChange={event => setFilter(previous => ({ ...previous, reader: event.target.value }))}>
                  <option value="">{t('betaReading.comments.all')}</option>
                  {readers.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            </div>

            {chapterIds.map(id => {
              const changed = changeFor(id);
              const diff = changed?.change.diff;
              return (
                <div key={id} className="space-y-2" data-testid="beta-chapter-group">
                  <h4 className="text-sm font-semibold text-text-primary">
                    {titles.get(id) ?? t('betaReading.comments.missingChapter')}
                    {changed && (
                      <span className="ml-2 text-xs font-normal text-amber-400" data-testid="beta-chapter-changed">
                        {diff ? fill(t('betaReading.packages.changed'), { added: diff.added, removed: diff.removed, paragraphs: diff.changedParagraphs }) : t('betaReading.packages.changedNoText')}
                      </span>
                    )}
                  </h4>
                  <ul className="space-y-2">{rest.filter(row => row.writingId === id).sort((a, b) => a.createdAt - b.createdAt).map(commentCard)}</ul>
                </div>
              );
            })}

            {orphaned.length > 0 && (
              <div className="space-y-2" data-testid="beta-orphaned">
                <h4 className="text-sm font-semibold text-red-400">{t('betaReading.comments.orphanedTitle')} ({orphaned.length})</h4>
                <p className="text-xs text-text-dim">{t('betaReading.comments.orphanedHint')}</p>
                <ul className="space-y-2">{orphaned.map(commentCard)}</ul>
              </div>
            )}
          </>
        )}
      </section>

      {undo && (
        <div role="status" data-testid="beta-undo" className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text-primary shadow-lg">
          {t('betaReading.comments.deleted')}
          <button type="button" className={buttonClass} data-testid="beta-undo-button" onClick={() => void undoDelete()}>{t('betaReading.comments.undo')}</button>
        </div>
      )}
    </div>
  );
}
