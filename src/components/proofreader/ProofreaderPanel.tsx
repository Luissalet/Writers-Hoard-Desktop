// ============================================
// Lector de pruebas — the cockpit panel
// ============================================
//
// A working list, not a scoreboard. Every row names the thing, says in one
// line why it matters, and carries the two buttons that end the row: go to
// where it is fixed, or — when the action is unambiguous and reversible —
// apply the fix here.
//
// The analysis reads every chapter's prose, so it runs from an explicit
// button. Nothing here subscribes to a liveQuery; after a fix lands the panel
// re-runs the analysis itself, which is the only way the list can be trusted
// to reflect what the fix actually did.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  EyeOff,
  Info,
  Loader2,
  RefreshCcw,
  Search,
  Undo2,
} from 'lucide-react';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { ConfirmDialog } from '@/engines/_shared';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import {
  applyProofreaderFix,
  dismissFinding,
  getDismissedFindingIds,
  restoreAllFindings,
  restoreFinding,
  runProofreader,
  type ProofreaderFinding,
  type ProofreaderReport,
  type ProofreaderSeverity,
} from '@/services/proofreader';

type SeverityFilter = 'all' | ProofreaderSeverity;

const SEVERITY_FILTERS: readonly SeverityFilter[] = ['all', 'warning', 'info'];

const secondaryButton =
  'inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-50';
const primaryButton =
  'inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-gold px-4 py-2 text-sm font-medium text-background transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-50';

function SeverityIcon({ severity }: { severity: ProofreaderSeverity }) {
  return severity === 'warning' ? (
    <CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
  ) : (
    <Info size={16} className="mt-0.5 shrink-0 text-blue-400" aria-hidden="true" />
  );
}

function FindingRow({
  projectId,
  finding,
  busy,
  dismissingId,
  onFix,
  onDismiss,
}: {
  projectId: string;
  finding: ProofreaderFinding;
  busy: boolean;
  /** The finding whose dismissal is being written, if any. */
  dismissingId: string | null;
  onFix: (finding: ProofreaderFinding) => void;
  onDismiss: (finding: ProofreaderFinding) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Same bridge the rest of the cockpit uses: the engine's own anchor adapter
  // knows how to deep-link one of its entities; without one we can still open
  // the engine tab.
  //
  // `route` comes first because a finding that carries one is about the project
  // rather than about one row — "no beat points at a chapter yet" names no
  // entity for an adapter to deep-link, and its repair happens on the spine.
  const open = () => {
    if (finding.route) {
      navigate(`/project/${encodeURIComponent(projectId)}/${finding.route}`);
      return;
    }
    const adapter = getAnchorAdapter(finding.engineId);
    if (adapter) adapter.navigateToEntity(finding.entityId, projectId);
    else navigate(`/project/${encodeURIComponent(projectId)}/${encodeURIComponent(finding.engineId)}`);
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <SeverityIcon severity={finding.severity} />
        <div className="min-w-0">
          <p className="text-sm text-text-primary">{finding.title}</p>
          <p className="mt-0.5 text-xs text-text-muted">{finding.detail}</p>
          <p className="mt-1 text-xs text-text-dim">{t(`engines.${finding.engineId}.name`)}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pl-3">
        <button
          type="button"
          onClick={open}
          aria-label={t('proofreader.navigateAria').replace('{finding}', finding.detail)}
          className={secondaryButton}
        >
          <ExternalLink size={13} aria-hidden="true" />
          {t('common.open')}
        </button>
        {finding.fix && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onFix(finding)}
            className={secondaryButton}
          >
            {busy ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCcw size={13} aria-hidden="true" />
            )}
            {finding.fix.label}
          </button>
        )}
        {/* Disabled while ANY dismissal is being written — the same guard the
            fix button uses — because they all rewrite the one stored set. */}
        <button
          type="button"
          disabled={dismissingId !== null}
          onClick={() => onDismiss(finding)}
          aria-label={t('proofreader.dismissAria').replace('{finding}', finding.detail)}
          className={secondaryButton}
        >
          {dismissingId === finding.id ? (
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          ) : (
            <EyeOff size={13} aria-hidden="true" />
          )}
          {t('common.dismiss')}
        </button>
      </div>
    </div>
  );
}

export default function ProofreaderPanel({ projectId }: { projectId: string }) {
  const { t, locale } = useTranslation();
  const [owner, setOwner] = useState(projectId);
  const [report, setReport] = useState<ProofreaderReport | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set<string>());
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pendingFix, setPendingFix] = useState<ProofreaderFinding | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  // Which project the panel shows RIGHT NOW, readable from a promise that was
  // started for another one. Every async callback below closes over the
  // `projectId` of the render that created it — which is exactly the value
  // that must not be trusted once the analysis comes back.
  const ownerRef = useRef(projectId);
  ownerRef.current = projectId;

  // Render-adjust rather than an effect (tasks/lessons #17): switching project
  // must drop the previous project's report in the same render that shows the
  // new project, never one paint later.
  if (owner !== projectId) {
    setOwner(projectId);
    setReport(null);
    setFailed(false);
    setPendingFix(null);
    setApplying(null);
    setDismissing(null);
    setShowDismissed(false);
  }

  useEffect(() => {
    let cancelled = false;
    void getDismissedFindingIds(projectId).then(ids => {
      if (!cancelled) setDismissed(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Reading a whole manuscript takes as long as it takes, and the panel is
  // reconciled — not remounted — when the writer moves to another project's
  // cockpit. A report that arrives after that belongs to a project this panel
  // no longer shows, and showing it would hand every row's fix and "Open" the
  // wrong project's entities.
  const analyse = async () => {
    const startedFor = projectId;
    setRunning(true);
    setFailed(false);
    try {
      const next = await runProofreader(startedFor);
      if (ownerRef.current === startedFor) setReport(next);
    } catch (error) {
      console.error('Proofreader analysis failed', error);
      if (ownerRef.current !== startedFor) return;
      setReport(null);
      setFailed(true);
      toast.error(t('proofreader.error'));
    } finally {
      // Always cleared: the button belongs to whichever project is on screen,
      // and leaving it disabled would strand the panel on "analysing".
      setRunning(false);
    }
  };

  const confirmFix = async () => {
    const finding = pendingFix;
    if (!finding?.fix) return;
    const action = finding.fix.action;
    setPendingFix(null);
    // A fix carries the project it was built for. Applying one from a report
    // the panel has moved on from would create a Codex character and rewrite
    // dialogue in a project the writer is not looking at.
    if ('projectId' in action && action.projectId !== projectId) {
      toast.error(t('proofreader.fixStale'));
      return;
    }
    const startedFor = projectId;
    setApplying(finding.id);
    try {
      await applyProofreaderFix(action);
      toast.success(t('proofreader.fixApplied'));
      // The data changed underneath the list, so the list is re-derived rather
      // than patched — a fix that only edited the screen would be a lie.
      const next = await runProofreader(startedFor);
      if (ownerRef.current === startedFor) setReport(next);
    } catch (error) {
      console.error('Proofreader fix failed', error);
      if (ownerRef.current === startedFor) toast.error(t('proofreader.fixError'));
    } finally {
      setApplying(null);
    }
  };

  const dismiss = async (finding: ProofreaderFinding) => {
    const startedFor = projectId;
    setDismissing(finding.id);
    try {
      const ids = await dismissFinding(startedFor, finding.id);
      if (ownerRef.current !== startedFor) return;
      setDismissed(ids);
      toast.success(t('proofreader.dismissedToast'));
    } catch (error) {
      console.error('Proofreader dismissal failed', error);
      if (ownerRef.current === startedFor) toast.error(t('proofreader.dismissError'));
    } finally {
      setDismissing(null);
    }
  };

  const restore = async (findingId: string) => {
    try {
      setDismissed(await restoreFinding(projectId, findingId));
    } catch (error) {
      console.error('Proofreader restore failed', error);
      toast.error(t('proofreader.dismissError'));
    }
  };

  const restoreAll = async () => {
    try {
      setDismissed(await restoreAllFindings(projectId));
    } catch (error) {
      console.error('Proofreader restore failed', error);
      toast.error(t('proofreader.dismissError'));
    }
  };

  const dismissedFindings = report?.findings.filter(finding => dismissed.has(finding.id)) ?? [];
  const openCount = report
    ? report.findings.filter(finding => !dismissed.has(finding.id)).length
    : 0;

  return (
    <section className="space-y-4" aria-labelledby="proofreader-title">
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Search className="text-accent-gold" size={20} aria-hidden="true" />
              <h3 id="proofreader-title" className="font-serif font-semibold text-text-primary">
                {t('proofreader.title')}
              </h3>
            </div>
            <p className="mt-1 text-sm text-text-muted">{t('proofreader.subtitle')}</p>
            <p className="mt-1 text-xs text-text-dim">{t('proofreader.onDemand')}</p>
            {report && (
              <p className="mt-2 text-xs text-text-dim">
                {t('proofreader.scanned')
                  .replace('{writings}', String(report.scanned.writings))
                  .replace('{codex}', String(report.scanned.codexEntries))
                  .replace('{scenes}', String(report.scanned.scenes))}
                {' · '}
                {t('proofreader.lastRun').replace(
                  '{time}',
                  new Date(report.generatedAt).toLocaleString(locale),
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {report && (
              <div
                role="group"
                aria-label={t('proofreader.filterLabel')}
                className="flex flex-wrap gap-1 rounded-lg border border-border/70 bg-surface/60 p-1"
              >
                {SEVERITY_FILTERS.map(value => {
                  const active = severity === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSeverity(value)}
                      className={`min-h-9 rounded-md px-3 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${
                        active
                          ? 'bg-elevated font-medium text-accent-gold'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {value === 'all'
                        ? t('common.all')
                        : value === 'warning'
                          ? t('proofreader.filter.warning')
                          : t('proofreader.filter.info')}
                    </button>
                  );
                })}
              </div>
            )}
            <button type="button" disabled={running} onClick={() => void analyse()} className={primaryButton}>
              {running ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Search size={14} aria-hidden="true" />
              )}
              {running
                ? t('proofreader.analysing')
                : report
                  ? t('proofreader.analyseAgain')
                  : t('proofreader.analyse')}
            </button>
          </div>
        </div>
      </div>

      {failed && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <AlertTriangle className="mx-auto text-red-400" size={26} aria-hidden="true" />
          <p className="mt-3 text-sm text-text-muted">{t('proofreader.error')}</p>
        </div>
      )}

      {!report && !failed && !running && (
        <div className="rounded-xl border border-border bg-surface p-10 text-center">
          <Search className="mx-auto text-text-dim" size={30} aria-hidden="true" />
          <h4 className="mt-3 font-serif text-lg font-semibold text-text-primary">
            {t('proofreader.idleTitle')}
          </h4>
          <p className="mt-2 text-sm text-text-muted">{t('proofreader.idleDetail')}</p>
        </div>
      )}

      {report && openCount === 0 && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-10 text-center">
          <CheckCircle2 className="mx-auto text-green-400" size={30} aria-hidden="true" />
          <h4 className="mt-3 font-serif text-lg font-semibold text-text-primary">
            {t('proofreader.clearTitle')}
          </h4>
          <p className="mt-2 text-sm text-text-muted">{t('proofreader.clearDetail')}</p>
        </div>
      )}

      {report && openCount > 0 && report.groups.map(group => {
        const open = group.findings.filter(finding => !dismissed.has(finding.id));
        const visible =
          severity === 'all' ? open : open.filter(finding => finding.severity === severity);
        return (
          <section key={group.id} className="rounded-xl border border-border bg-surface">
            <div className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h4 className="font-serif font-semibold text-text-primary">{group.title}</h4>
                <p className="mt-1 text-xs text-text-muted">{group.description}</p>
              </div>
              <span
                className="shrink-0 self-start rounded-full bg-elevated px-2.5 py-0.5 text-xs text-text-primary sm:self-center"
                aria-label={t('proofreader.openCount').replace('{count}', String(open.length))}
              >
                {open.length}
              </span>
            </div>
            {!group.applicable ? (
              <p className="px-5 py-4 text-sm text-text-muted">{group.notApplicableReason}</p>
            ) : open.length === 0 ? (
              <p className="px-5 py-4 text-sm text-green-400">{t('proofreader.groupClear')}</p>
            ) : visible.length === 0 ? (
              <p className="px-5 py-4 text-sm text-text-muted">{t('proofreader.filteredEmpty')}</p>
            ) : (
              <div className="divide-y divide-border">
                {visible.map(finding => (
                  <FindingRow
                    key={finding.id}
                    projectId={projectId}
                    finding={finding}
                    busy={applying !== null}
                    dismissingId={dismissing}
                    onFix={setPendingFix}
                    onDismiss={item => void dismiss(item)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {dismissedFindings.length > 0 && (
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h4 className="font-serif font-semibold text-text-primary">
                {t('proofreader.dismissedTitle').replace(
                  '{count}',
                  String(dismissedFindings.length),
                )}
              </h4>
              <p className="mt-1 text-xs text-text-muted">{t('proofreader.dismissedDetail')}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                aria-expanded={showDismissed}
                onClick={() => setShowDismissed(value => !value)}
                className={secondaryButton}
              >
                {showDismissed ? t('common.collapse') : t('common.expand')}
              </button>
              <button type="button" onClick={() => void restoreAll()} className={secondaryButton}>
                <Undo2 size={13} aria-hidden="true" />
                {t('proofreader.restoreAll')}
              </button>
            </div>
          </div>
          {showDismissed && (
            <div className="divide-y divide-border">
              {dismissedFindings.map(finding => (
                <div
                  key={finding.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-text-muted">{finding.title}</p>
                    <p className="mt-0.5 text-xs text-text-dim">{finding.detail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void restore(finding.id)}
                    aria-label={t('proofreader.restoreAria').replace('{finding}', finding.detail)}
                    className={secondaryButton}
                  >
                    <Undo2 size={13} aria-hidden="true" />
                    {t('proofreader.restore')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={pendingFix !== null}
        title={pendingFix?.fix?.confirmTitle}
        message={pendingFix?.fix?.confirmMessage ?? ''}
        confirmLabel={pendingFix?.fix?.label}
        onConfirm={confirmFix}
        onCancel={() => setPendingFix(null)}
      />
    </section>
  );
}
