import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlertTriangle,
  BookMarked,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Eye,
  FileSearch,
  Gavel,
  History,
  LoaderCircle,
  MapPinned,
  MessageCircleQuestion,
  Play,
  Scale,
  ShieldAlert,
  Sparkles,
  Square,
  TextCursorInput,
  X,
} from 'lucide-react';
import Modal from '@/components/common/Modal';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import {
  assessJudgeRunFreshness,
  buildJudgeDisclosure,
  dismissJudgeFinding,
  listJudgeFindings,
  listJudgeRuns,
  listProjectReferenceLinks,
  runJudge,
  type JudgeContextPermissions,
  type JudgeFinding,
  type JudgeMode,
  type JudgePayloadReceipt,
  type JudgeRun,
  type JudgeRunFreshness,
  type JudgeSelection,
  type JudgeScope,
  type JudgeSourceMode,
  type ProjectReferenceLink,
} from '@/services/judge';
import type { Writing } from '@/types';
import ReferenceLibrary from './ReferenceLibrary';

interface JudgePanelProps {
  projectId: string;
  writing: Writing;
  currentContent: string;
  writings: Writing[];
  editor: Editor | null;
  readOnly?: boolean;
  onNavigate: (writingId: string, quote: string, start?: number) => void;
  onNavigateEntity: (engineId: string, entityId: string, quote: string) => void;
  onCreateAnnotation: (finding: JudgeFinding) => void;
  onApplySuggestion: (finding: JudgeFinding) => Promise<boolean>;
}

const MODES: Array<{ id: JudgeMode; icon: typeof Gavel; key: string }> = [
  { id: 'judge', icon: Gavel, key: 'judge.mode.judge' },
  { id: 'questions', icon: MessageCircleQuestion, key: 'judge.mode.questions' },
  { id: 'reader', icon: Eye, key: 'judge.mode.reader' },
  { id: 'story-state', icon: MapPinned, key: 'judge.mode.storyState' },
];

function judgeErrorKey(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'judge.error.cancelled';
  const code = error instanceof Error ? error.message : '';
  if (code.includes('judge-route-missing')) return 'judge.error.route';
  if (code.includes('judge-selection-empty')) return 'judge.error.selection';
  if (code.includes('judge-reference-required') || code.includes('reference-lens-not-authorized') || code.includes('reference-lens-empty')) return 'judge.error.referenceRequired';
  if (code.includes('judge-output-unverifiable')) return 'judge.error.unverifiable';
  if (code.includes('judge-remote-consent-required')) return 'judge.error.consent';
  if (code.includes('judge-disclosure-stale')) return 'judge.error.disclosureStale';
  return 'judge.error.generic';
}

function confidenceClass(confidence: JudgeFinding['confidence']): string {
  if (confidence === 'high') return 'bg-success/10 text-success';
  if (confidence === 'medium') return 'bg-accent-amber/10 text-accent-amber';
  return 'bg-elevated text-text-muted';
}

function FindingCard({
  finding,
  lensName,
  readOnly,
  onNavigate,
  onNavigateInternal,
  onAnnotate,
  onDismiss,
  onPreviewSuggestion,
}: {
  finding: JudgeFinding;
  lensName?: string;
  readOnly: boolean;
  onNavigate: () => void;
  onNavigateInternal: () => void;
  onAnnotate: () => void;
  onDismiss: () => void;
  onPreviewSuggestion: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  return (
    <article className="rounded-lg border border-border bg-deep/45">
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-gold/60"
      >
        {expanded ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-text-dim" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-text-dim" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-gold">{lensName || t(`judge.mode.${finding.mode === 'story-state' ? 'storyState' : finding.mode}`)}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${confidenceClass(finding.confidence)}`}>
              {t(`judge.confidence.${finding.confidence}`)}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs font-medium leading-relaxed text-text-primary">{finding.observation}</p>
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border/70 px-3 py-3">
          <button
            type="button"
            onClick={onNavigate}
            className="block w-full rounded-md border border-accent-gold/25 bg-surface px-2.5 py-2 text-left text-[11px] italic leading-relaxed text-text-muted hover:border-accent-gold/45 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50"
          >
            “{finding.anchor.quote}”
          </button>
          <p className="text-xs leading-relaxed text-text-primary">{finding.observation}</p>

          {finding.reference && (
            <div className="rounded-md border border-yarn-purple/25 bg-yarn-purple/5 p-2.5">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold text-yarn-purple">
                <BookMarked size={11} aria-hidden="true" />
                {finding.reference.documentName}
                {finding.reference.page ? ` · ${t('judge.citation.page')} ${finding.reference.page}` : ''}
                {finding.reference.sectionHeading ? ` · ${finding.reference.sectionHeading}` : ''}
              </p>
              {finding.principle && <p className="mt-1.5 text-[11px] leading-relaxed text-text-primary">{finding.principle}</p>}
              <p className="mt-1 text-[10px] italic leading-relaxed text-text-muted">“{finding.reference.quote}”</p>
            </div>
          )}

          {finding.internal && (
            <button
              type="button"
              onClick={onNavigateInternal}
              className="block w-full rounded-md border border-yarn-blue/25 bg-yarn-blue/5 p-2.5 text-left hover:bg-yarn-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yarn-blue/50"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-yarn-blue">
                <FileSearch size={11} aria-hidden="true" />
                {finding.internal.title}
              </span>
              <span className="mt-1 block text-[10px] italic leading-relaxed text-text-muted">“{finding.internal.quote}”</span>
            </button>
          )}

          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-text-dim">
            <CircleHelp size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
            {finding.contextLimits}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={onNavigate} className="rounded border border-border px-2 py-1 text-[10px] text-text-muted hover:border-accent-gold/40 hover:text-accent-gold">
              {t('judge.action.goToPassage')}
            </button>
            {!readOnly && (
              <button type="button" onClick={onAnnotate} className="rounded border border-border px-2 py-1 text-[10px] text-text-muted hover:border-yarn-blue/40 hover:text-yarn-blue">
                {t('judge.action.annotate')}
              </button>
            )}
            {finding.suggestion && !readOnly && finding.mode !== 'questions' && (
              <button type="button" onClick={onPreviewSuggestion} className="rounded border border-accent-gold/30 px-2 py-1 text-[10px] font-semibold text-accent-gold hover:bg-accent-gold/10">
                {t('judge.action.preview')}
              </button>
            )}
            <button type="button" onClick={onDismiss} className="rounded border border-border px-2 py-1 text-[10px] text-text-dim hover:border-success/40 hover:text-success">
              {t('judge.action.intentional')}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function JudgePanel({
  projectId,
  writing,
  currentContent,
  writings,
  editor,
  readOnly = false,
  onNavigate,
  onNavigateEntity,
  onCreateAnnotation,
  onApplySuggestion,
}: JudgePanelProps) {
  const { t, locale } = useTranslation();
  const abortRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [mode, setMode] = useState<JudgeMode>('judge');
  const [scope, setScope] = useState<JudgeScope>('chapter');
  const [sourceMode, setSourceMode] = useState<JudgeSourceMode>('both');
  const [context, setContext] = useState<JudgeContextPermissions>({
    previousWritings: true,
    selectedWritingIds: [],
    codex: false,
    outline: false,
    timeline: false,
  });
  const [links, setLinks] = useState<ProjectReferenceLink[]>([]);
  const [runs, setRuns] = useState<JudgeRun[]>([]);
  const [run, setRun] = useState<JudgeRun | null>(null);
  const [findings, setFindings] = useState<JudgeFinding[]>([]);
  const [freshness, setFreshness] = useState<JudgeRunFreshness | null>(null);
  const [selection, setSelection] = useState<JudgeSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ name: string; completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteDisclosure, setRemoteDisclosure] = useState<JudgePayloadReceipt | null>(null);
  const [pendingRun, setPendingRun] = useState<Parameters<typeof runJudge>[0] | null>(null);
  const [suggestionFinding, setSuggestionFinding] = useState<JudgeFinding | null>(null);
  const [applying, setApplying] = useState(false);

  const loadLinks = useCallback(async () => {
    setLinks(await listProjectReferenceLinks(projectId));
  }, [projectId]);

  const loadHistory = useCallback(async () => {
    const history = await listJudgeRuns(projectId, writing.id);
    setRuns(history);
    const latest = history.find(item => item.status === 'complete') ?? null;
    setRun(latest);
    setFindings(latest ? await listJudgeFindings(latest.id) : []);
  }, [projectId, writing.id]);

  useEffect(() => {
    void Promise.all([loadLinks(), loadHistory()]);
    return () => abortRef.current?.abort();
  }, [loadHistory, loadLinks]);

  useEffect(() => {
    if (!editor) {
      setSelection(null);
      return;
    }
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        setSelection(null);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, ' ', ' ').replace(/\s+/g, ' ').trim();
      const prefix = editor.state.doc.textBetween(0, from, ' ', ' ').replace(/\s+/g, ' ').trim();
      setSelection(text ? { text, start: prefix.length, end: prefix.length + text.length } : null);
    };
    update();
    editor.on('selectionUpdate', update);
    return () => { editor.off('selectionUpdate', update); };
  }, [editor]);

  useEffect(() => {
    if (scope === 'selection' && !selection) setScope('chapter');
  }, [scope, selection]);

  useEffect(() => {
    if (mode === 'reader') {
      setContext(current => ({
        ...current,
        previousWritings: true,
        selectedWritingIds: [],
        codex: false,
        outline: false,
        timeline: false,
      }));
    }
  }, [mode]);

  useEffect(() => {
    let alive = true;
    if (!run) {
      setFreshness(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void assessJudgeRunFreshness(run, { [writing.id]: currentContent }).then(value => {
        if (alive) setFreshness(value);
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [currentContent, run, writing.id]);

  const activeLinks = useMemo(
    () => links.filter(link => link.active && link.status === 'ready'),
    [links],
  );

  const makeInput = useCallback((): Parameters<typeof runJudge>[0] => ({
    projectId,
    writing,
    currentContent,
    mode,
    scope,
    sourceMode,
    lensIds: activeLinks.map(link => link.lensId),
    context,
    selection: selection ?? undefined,
    outputLanguage: locale === 'es' ? 'Spanish' : 'English',
  }), [activeLinks, context, currentContent, locale, mode, projectId, scope, selection, sourceMode, writing]);

  const execute = useCallback(async (input: Parameters<typeof runJudge>[0], allowRemote: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setStage({ name: 'collecting', completed: 0, total: 1 });
    try {
      const result = await runJudge({
        ...input,
        allowRemote,
        signal: controller.signal,
        onStage: (name, completed, total) => setStage({ name, completed, total }),
      });
      setRun(result.run);
      setFindings(result.findings);
      setFreshness({ stale: false, reasons: [] });
      await loadHistory();
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(t(judgeErrorKey(reason)));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setStage(null);
    }
  }, [loadHistory, t]);

  const requestRun = async () => {
    const input = makeInput();
    setError(null);
    try {
      const disclosure = await buildJudgeDisclosure(input);
      if (disclosure.route.locality === 'remote' && !disclosure.route.remoteConsentPolicy) {
        setPendingRun({
          ...input,
          expectedDisclosureFingerprint: disclosure.summary.disclosureFingerprint,
        });
        setRemoteDisclosure(disclosure.summary);
        return;
      }
      await execute(input, false);
    } catch (reason) {
      setError(t(judgeErrorKey(reason)));
    }
  };

  const selectRun = async (id: string) => {
    const selected = runs.find(item => item.id === id) ?? null;
    setRun(selected);
    setFindings(selected ? await listJudgeFindings(selected.id) : []);
  };

  const grouped = useMemo(() => {
    const groups = new Map<string, JudgeFinding[]>();
    for (const finding of findings.filter(item => item.status === 'active')) {
      const key = finding.lensId ?? '__internal__';
      groups.set(key, [...(groups.get(key) ?? []), finding]);
    }
    return [...groups.entries()];
  }, [findings]);

  const lensName = (id: string) => links.find(link => link.lensId === id)?.lensName;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center justify-between rounded-xl border border-accent-gold/25 bg-gradient-to-br from-accent-gold/10 to-yarn-purple/5 px-3 py-2.5 text-left transition-colors hover:border-accent-gold/45 hover:from-accent-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/60"
      >
        <span className="flex items-center gap-2">
          <Scale size={16} className="text-accent-gold" aria-hidden="true" />
          <span>
            <span className="block text-xs font-semibold text-text-primary">Judge</span>
            <span className="block text-[10px] text-text-dim">{t('judge.closedHint')}</span>
          </span>
        </span>
        <ChevronRight size={14} className="text-text-dim transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <section aria-label="Judge" className="overflow-hidden rounded-xl border border-accent-gold/30 bg-surface shadow-lg shadow-black/10">
      <div className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-accent-gold/10 to-transparent px-3 py-2.5">
        <Scale size={16} className="text-accent-gold" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-bold text-text-primary">Judge</h2>
          <p className="truncate text-[10px] text-text-dim">{writing.title}</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-text-dim hover:bg-elevated hover:text-text-primary" aria-label={t('common.close')}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4 p-3">
        <div role="tablist" aria-label={t('judge.modes')} className="grid grid-cols-2 gap-1 rounded-lg bg-deep p-1">
          {MODES.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={mode === item.id}
                onClick={() => setMode(item.id)}
                className={`flex items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50 ${mode === item.id ? 'bg-elevated font-semibold text-accent-gold shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
              >
                <Icon size={11} aria-hidden="true" />
                {t(item.key)}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] leading-relaxed text-text-dim">{t(`judge.modeHint.${mode === 'story-state' ? 'storyState' : mode}`)}</p>

        <fieldset>
          <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim">{t('judge.scope')}</legend>
          <div className="grid grid-cols-3 gap-1">
            {([
              ['selection', 'judge.scope.selection', TextCursorInput],
              ['chapter', 'judge.scope.chapter', FileSearch],
              ['writings', 'judge.scope.writings', BookMarked],
            ] as const).map(([id, key, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setScope(id)}
                disabled={id === 'selection' && !selection}
                aria-pressed={scope === id}
                className={`flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[9px] transition-colors ${scope === id ? 'border-accent-gold/50 bg-accent-gold/10 text-accent-gold' : 'border-border text-text-muted hover:bg-elevated'} disabled:cursor-not-allowed disabled:opacity-35`}
              >
                <Icon size={12} aria-hidden="true" />
                {t(key)}
              </button>
            ))}
          </div>
        </fieldset>

        {scope === 'writings' && (
          <fieldset className="max-h-28 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            <legend className="px-1 text-[10px] text-text-dim">{t('judge.scope.chooseWritings')}</legend>
            {writings.filter(row => row.id !== writing.id).map(row => (
              <label key={row.id} className="flex items-center gap-2 text-[10px] text-text-muted">
                <input
                  type="checkbox"
                  checked={context.selectedWritingIds.includes(row.id)}
                  onChange={event => setContext(current => ({
                    ...current,
                    selectedWritingIds: event.target.checked
                      ? [...current.selectedWritingIds, row.id]
                      : current.selectedWritingIds.filter(id => id !== row.id),
                  }))}
                  className="accent-[var(--color-accent-gold)]"
                />
                <span className="truncate">{row.title}</span>
              </label>
            ))}
          </fieldset>
        )}

        <fieldset disabled={mode === 'reader'}>
          <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim">{t('judge.sources')}</legend>
          <div className="grid grid-cols-3 gap-1">
            {(['reference', 'continuity', 'both'] as JudgeSourceMode[]).map(id => (
              <button
                key={id}
                type="button"
                onClick={() => setSourceMode(id)}
                aria-pressed={sourceMode === id}
                className={`rounded-md border px-1 py-1.5 text-[9px] transition-colors ${sourceMode === id ? 'border-yarn-purple/50 bg-yarn-purple/10 text-yarn-purple' : 'border-border text-text-muted hover:bg-elevated'}`}
              >
                {t(`judge.source.${id}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="rounded-lg border border-border bg-deep/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{t('judge.activeLenses')}</p>
            <button type="button" onClick={() => setShowLibrary(value => !value)} aria-expanded={showLibrary} className="text-[10px] font-semibold text-accent-gold hover:underline">
              {showLibrary ? t('judge.library.hide') : t('judge.library.manage')}
            </button>
          </div>
          {!showLibrary && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeLinks.length ? activeLinks.map(link => (
                <span key={link.id} className="rounded-full border border-yarn-purple/25 bg-yarn-purple/10 px-2 py-0.5 text-[9px] text-yarn-purple">
                  {link.lensName} · v{link.documentVersion}
                </span>
              )) : <span className="text-[10px] text-text-dim">{t('judge.noLenses')}</span>}
            </div>
          )}
          {showLibrary && <div className="mt-3 border-t border-border pt-3"><ReferenceLibrary projectId={projectId} onChange={loadLinks} /></div>}
        </div>

        {mode !== 'reader' && sourceMode !== 'reference' && (
          <fieldset>
            <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim">{t('judge.context')}</legend>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              {([
                ['previousWritings', 'judge.context.previous'],
                ['codex', 'judge.context.codex'],
                ['outline', 'judge.context.outline'],
                ['timeline', 'judge.context.timeline'],
              ] as const).map(([field, key]) => (
                <label key={field} className="flex items-center gap-1.5 text-[10px] text-text-muted">
                  <input
                    type="checkbox"
                    checked={context[field] as boolean}
                    onChange={event => setContext(current => ({ ...current, [field]: event.target.checked }))}
                    className="accent-[var(--color-accent-gold)]"
                  />
                  {t(key)}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {mode === 'reader' && (
          <p className="flex items-start gap-1.5 rounded-md border border-yarn-blue/25 bg-yarn-blue/5 p-2 text-[10px] leading-relaxed text-yarn-blue">
            <ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('judge.readerFutureGuard')}
          </p>
        )}

        <button
          type="button"
          onClick={() => busy ? abortRef.current?.abort() : void requestRun()}
          disabled={!busy && scope === 'selection' && !selection}
          className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/60 ${busy ? 'border border-border bg-elevated text-text-primary' : 'bg-accent-gold text-deep hover:bg-accent-amber'} disabled:opacity-40`}
        >
          {busy ? <><Square size={11} fill="currentColor" aria-hidden="true" />{t('judge.cancel')}</> : <><Play size={12} fill="currentColor" aria-hidden="true" />{t('judge.run')}</>}
        </button>
        {stage && (
          <div role="status" className="flex items-center gap-2 text-[10px] text-text-muted">
            <LoaderCircle size={12} className="animate-spin text-accent-gold" aria-hidden="true" />
            <span>{t(`judge.stage.${stage.name}`)}</span>
            {stage.total > 1 && <span>{stage.completed + 1}/{stage.total}</span>}
          </div>
        )}
        {error && <p role="alert" className="rounded-md border border-danger/25 bg-danger/5 p-2 text-[10px] leading-relaxed text-danger">{error}</p>}

        {runs.length > 0 && (
          <div className="border-t border-border pt-3">
            <label className="flex items-center gap-2 text-[10px] text-text-dim">
              <History size={12} aria-hidden="true" />
              <span>{t('judge.history')}</span>
              <select value={run?.id ?? ''} onChange={event => void selectRun(event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-deep px-1.5 py-1 text-[10px] text-text-primary outline-none focus-visible:border-accent-gold">
                {runs.map(item => (
                  <option key={item.id} value={item.id}>{new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(item.createdAt)} · {t(`judge.mode.${item.mode === 'story-state' ? 'storyState' : item.mode}`)}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {freshness?.stale && (
          <div role="status" className="flex items-start gap-2 rounded-md border border-accent-amber/30 bg-accent-amber/5 p-2 text-[10px] leading-relaxed text-accent-amber">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t('judge.stale')}</span>
          </div>
        )}

        {run?.status === 'complete' && !busy && grouped.length === 0 && (
          <div className="rounded-lg border border-success/25 bg-success/5 p-3 text-center">
            <Check size={16} className="mx-auto mb-1 text-success" aria-hidden="true" />
            <p className="text-[11px] text-text-muted">{t('judge.noFindings')}</p>
          </div>
        )}

        {grouped.map(([groupId, rows]) => (
          <section key={groupId} className="space-y-2">
            {grouped.length > 1 && (
              <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-yarn-purple">
                <Sparkles size={11} aria-hidden="true" />
                {groupId === '__internal__' ? t('judge.internalContinuity') : lensName(groupId) || t('judge.unknownLens')}
              </h3>
            )}
            {rows.map(finding => (
              <FindingCard
                key={finding.id}
                finding={finding}
                lensName={finding.lensId ? lensName(finding.lensId) : undefined}
                readOnly={readOnly}
                onNavigate={() => onNavigate(finding.writingId, finding.anchor.quote, finding.anchor.start)}
                onNavigateInternal={() => {
                  if (finding.internal) onNavigateEntity(finding.internal.engineId, finding.internal.entityId, finding.internal.quote);
                }}
                onAnnotate={() => onCreateAnnotation(finding)}
                onDismiss={() => {
                  void dismissJudgeFinding(finding.id).then(() => {
                    setFindings(current => current.map(item => item.id === finding.id ? { ...item, status: 'intentional' } : item));
                  });
                }}
                onPreviewSuggestion={() => setSuggestionFinding(finding)}
              />
            ))}
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(remoteDisclosure && pendingRun)}
        title={t('judge.remote.title')}
        message={remoteDisclosure
          ? t('judge.remote.message')
            .replace('{connection}', remoteDisclosure.routeName)
            .replace('{target}', String(remoteDisclosure.targetCharacters))
            .replace('{reference}', String(remoteDisclosure.referenceCharacters))
            .replace('{internal}', String(remoteDisclosure.internalCharacters))
          : ''}
        confirmLabel={t('judge.remote.sendOnce')}
        onCancel={() => {
          setRemoteDisclosure(null);
          setPendingRun(null);
        }}
        onConfirm={async () => {
          const input = pendingRun;
          setRemoteDisclosure(null);
          setPendingRun(null);
          if (input) await execute(input, true);
        }}
      />

      <Modal
        open={Boolean(suggestionFinding?.suggestion)}
        onClose={() => { if (!applying) setSuggestionFinding(null); }}
        title={t('judge.suggestion.title')}
        busy={applying}
      >
        {suggestionFinding?.suggestion && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-text-muted">{suggestionFinding.suggestion.rationale}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-danger/25 bg-danger/5 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">{t('judge.suggestion.before')}</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{suggestionFinding.suggestion.before}</p>
              </div>
              <div className="rounded-lg border border-success/25 bg-success/5 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-success">{t('judge.suggestion.after')}</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{suggestionFinding.suggestion.after}</p>
              </div>
            </div>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-text-dim">
              <Brain size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t('judge.suggestion.snapshotHint')}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={applying} onClick={() => setSuggestionFinding(null)} className="rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-50">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={applying}
                onClick={async () => {
                  setApplying(true);
                  try {
                    if (await onApplySuggestion(suggestionFinding)) setSuggestionFinding(null);
                  } finally {
                    setApplying(false);
                  }
                }}
                className="flex items-center gap-2 rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-deep hover:bg-accent-amber disabled:opacity-50"
              >
                {applying ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                {t('judge.suggestion.apply')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
