import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  DatabaseBackup,
  FileCheck2,
  Loader2,
  RefreshCcw,
  ScanSearch,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import type {
  ProjectHealthIssue,
  ProjectHealthStatus,
} from '@/services/projectIntelligence';
import {
  ProjectHealthRepairError,
  isProjectHealthRepairIssueId,
  previewProjectHealthRepair,
  scanProjectProvenance,
  type ProjectHealthRepairIssueId,
  type ProjectHealthRepairPreview,
  type ProjectProvenanceFinding,
  type ProjectProvenanceReport,
} from '@/services/projectHealthRecovery';
import { executeProjectHealthRepair } from '@/services/projectHealthRecoveryBackup';

interface HealthRecoveryPanelProps {
  projectId: string;
  healthStatus: ProjectHealthStatus;
  issues: ProjectHealthIssue[];
  onOpenWorkflows: () => void;
  onRefreshIntegrity: () => void;
}

type ScanState =
  | { kind: 'not-checked' }
  | { kind: 'running' }
  | { kind: 'ready'; report: ProjectProvenanceReport }
  | { kind: 'failed' };

function severityClass(severity: 'error' | 'warning' | 'info'): string {
  if (severity === 'error') return 'text-red-400';
  if (severity === 'warning') return 'text-amber-400';
  return 'text-blue-400';
}

function InventoryValue({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="min-w-0 py-2">
      <dd className="text-xl font-semibold tabular-nums text-text-primary">{value}</dd>
      <dt className="mt-0.5 text-xs text-text-muted">{label}</dt>
    </div>
  );
}

function repairErrorKey(error: unknown): string {
  if (!(error instanceof ProjectHealthRepairError)) {
    return 'projectCockpit.healthRecovery.error.unknown';
  }
  return `projectCockpit.healthRecovery.error.${error.code}`;
}

export default function HealthRecoveryPanel({
  projectId,
  healthStatus,
  issues,
  onOpenWorkflows,
  onRefreshIntegrity,
}: HealthRecoveryPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const controllerRef = useRef<AbortController | null>(null);
  const [scanState, setScanState] = useState<ScanState>({ kind: 'not-checked' });
  const [previewing, setPreviewing] = useState<ProjectHealthRepairIssueId | null>(null);
  const [pendingRepair, setPendingRepair] = useState<ProjectHealthRepairPreview | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const scan = async (): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setScanState({ kind: 'running' });
    try {
      const report = await scanProjectProvenance(projectId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setScanState({ kind: 'ready', report });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('Project provenance scan failed', error);
      setScanState({ kind: 'failed' });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const cancelScan = (): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setScanState({ kind: 'not-checked' });
  };

  const requestRepair = async (issueId: ProjectHealthRepairIssueId): Promise<void> => {
    if (previewing) return;
    setPreviewing(issueId);
    try {
      setPendingRepair(await previewProjectHealthRepair(projectId, issueId));
    } catch (error) {
      console.error('Project repair preview failed', error);
      toast.error(t(repairErrorKey(error)));
      if (error instanceof ProjectHealthRepairError && error.code === 'nothing-to-repair') {
        void scan();
      }
    } finally {
      setPreviewing(null);
    }
  };

  const confirmRepair = async (): Promise<void> => {
    if (!pendingRepair) return;
    try {
      const result = await executeProjectHealthRepair(pendingRepair);
      setPendingRepair(null);
      toast.success(
        t('projectCockpit.healthRecovery.repaired')
          .replace('{count}', String(result.repaired)),
      );
      onRefreshIntegrity();
      await scan();
    } catch (error) {
      console.error('Project repair failed', error);
      setPendingRepair(null);
      toast.error(t(repairErrorKey(error)));
    }
  };

  const openFinding = (finding: ProjectProvenanceFinding): void => {
    if (finding.id === 'broken-conversion-provenance') {
      onOpenWorkflows();
      return;
    }
    navigate(`/project/${encodeURIComponent(projectId)}/annotations`);
  };

  const structuralAffected = issues.reduce((sum, issue) => sum + issue.count, 0);
  const provenance = scanState.kind === 'ready' ? scanState.report : null;
  const previewMessage = pendingRepair
    ? t('projectCockpit.healthRecovery.preview.message')
        .replace('{count}', String(pendingRepair.count))
        .replace(
          '{scope}',
          t(`projectCockpit.healthRecovery.scope.${pendingRepair.scope}`),
        )
    : '';

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DatabaseBackup size={20} className="shrink-0 text-accent-gold" aria-hidden="true" />
              <h3 className="font-serif text-lg font-semibold text-text-primary">
                {t('projectCockpit.healthRecovery.title')}
              </h3>
            </div>
            <p className="mt-1 max-w-[70ch] text-sm text-text-muted">
              {t('projectCockpit.healthRecovery.subtitle')}
            </p>
          </div>
          {scanState.kind === 'running' ? (
            <button
              type="button"
              onClick={cancelScan}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-red-400 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
            >
              <X size={14} aria-hidden="true" />
              {t('projectCockpit.healthRecovery.scan.cancel')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void scan()}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
            >
              <ScanSearch size={15} aria-hidden="true" />
              {t(scanState.kind === 'failed'
                ? 'projectCockpit.healthRecovery.scan.retry'
                : 'projectCockpit.healthRecovery.scan.action')}
            </button>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-5 px-5 py-2 sm:grid-cols-4">
          <InventoryValue
            value={issues.length}
            label={t('projectCockpit.healthRecovery.inventory.structuralFindings')}
          />
          <InventoryValue
            value={structuralAffected}
            label={t('projectCockpit.healthRecovery.inventory.affectedRows')}
          />
          <InventoryValue
            value={provenance?.totals.records
              ?? t('projectCockpit.healthRecovery.inventory.notChecked')}
            label={t('projectCockpit.healthRecovery.inventory.provenanceRecords')}
          />
          <InventoryValue
            value={provenance?.totals.broken
              ?? t('projectCockpit.healthRecovery.inventory.notChecked')}
            label={t('projectCockpit.healthRecovery.inventory.brokenProvenance')}
          />
        </dl>

        <div
          className="flex items-start gap-3 border-t border-border px-5 py-3 text-sm"
          role={scanState.kind === 'failed' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {scanState.kind === 'running' ? (
            <Loader2 size={17} className="mt-0.5 shrink-0 animate-spin text-accent-gold" aria-hidden="true" />
          ) : scanState.kind === 'ready' && scanState.report.status === 'clean' ? (
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-green-400" aria-hidden="true" />
          ) : scanState.kind === 'ready' && scanState.report.status !== 'clean' ? (
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          ) : scanState.kind === 'failed' ? (
            <CircleAlert size={17} className="mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
          ) : (
            <Activity size={17} className="mt-0.5 shrink-0 text-text-dim" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-text-primary">
              {t(`projectCockpit.healthRecovery.scan.${
                scanState.kind === 'ready' ? scanState.report.status : scanState.kind
              }`)}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {t(`projectCockpit.healthRecovery.scan.${
                scanState.kind === 'ready' ? scanState.report.status : scanState.kind
              }Detail`)}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="health-integrity-title" className="space-y-3">
        <div>
          <h3 id="health-integrity-title" className="font-serif font-semibold text-text-primary">
            {t('projectCockpit.healthRecovery.integrity.title')}
          </h3>
          <p className="mt-1 text-sm text-text-muted">
            {t('projectCockpit.healthRecovery.integrity.detail')}
          </p>
        </div>

        {healthStatus === 'not-applicable' ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center">
            <Activity className="mx-auto text-text-dim" size={30} aria-hidden="true" />
            <p className="mt-3 font-medium text-text-primary">{t('projectCockpit.health.noData')}</p>
            <p className="mt-1 text-sm text-text-muted">{t('projectCockpit.health.noDataDetail')}</p>
          </div>
        ) : healthStatus === 'clean' ? (
          <div className="flex items-start gap-3 rounded-xl border border-green-500/20 bg-green-500/5 p-4">
            <CheckCircle2 className="mt-0.5 shrink-0 text-green-400" size={20} aria-hidden="true" />
            <div>
              <p className="font-medium text-text-primary">{t('projectCockpit.health.clean')}</p>
              <p className="mt-1 text-sm text-text-muted">{t('projectCockpit.health.cleanDetail')}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {issues.map((row) => (
              <article key={row.id} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-start">
                <AlertTriangle
                  size={20}
                  className={`mt-0.5 shrink-0 ${severityClass(row.severity)}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-medium text-text-primary">
                      {t(`projectCockpit.health.issue.${row.id}.title`)}
                    </h4>
                    <span className="rounded-full bg-elevated px-2 py-0.5 text-xs tabular-nums text-text-muted">
                      {row.count}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-text-muted">
                    {t(`projectCockpit.health.issue.${row.id}.detail`)}
                  </p>
                </div>
                {row.repairable && isProjectHealthRepairIssueId(row.id) && (
                  <button
                    type="button"
                    disabled={previewing !== null}
                    onClick={() => void requestRepair(row.id as ProjectHealthRepairIssueId)}
                    className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {previewing === row.id ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCcw size={14} aria-hidden="true" />
                    )}
                    {t(previewing === row.id
                      ? 'projectCockpit.healthRecovery.preview.loading'
                      : 'projectCockpit.health.repair')}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {provenance && (
        <section aria-labelledby="health-provenance-title" className="space-y-3">
          <div>
            <h3 id="health-provenance-title" className="font-serif font-semibold text-text-primary">
              {t('projectCockpit.healthRecovery.provenance.title')}
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              {t('projectCockpit.healthRecovery.provenance.detail')}
            </p>
          </div>

          {provenance.findings.length === 0 && provenance.status === 'clean' ? (
            <div className="flex items-start gap-3 rounded-xl border border-green-500/20 bg-green-500/5 p-4">
              <FileCheck2 size={20} className="mt-0.5 shrink-0 text-green-400" aria-hidden="true" />
              <p className="text-sm text-text-muted">
                {t('projectCockpit.healthRecovery.provenance.clean')}
              </p>
            </div>
          ) : provenance.findings.length > 0 ? (
            <div className="space-y-3">
              {provenance.findings.map((finding) => (
                <article key={finding.id} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-start">
                  <AlertTriangle
                    size={20}
                    className={`mt-0.5 shrink-0 ${severityClass(finding.severity)}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-medium text-text-primary">
                        {t(`projectCockpit.healthRecovery.provenance.issue.${finding.id}.title`)}
                      </h4>
                      <span className="rounded-full bg-elevated px-2 py-0.5 text-xs tabular-nums text-text-muted">
                        {finding.count}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-text-muted">
                      {t(`projectCockpit.healthRecovery.provenance.issue.${finding.id}.detail`)}
                    </p>
                  </div>
                  {finding.repairable && isProjectHealthRepairIssueId(finding.id) ? (
                    <button
                      type="button"
                      disabled={previewing !== null}
                      onClick={() => void requestRepair(
                        finding.id as ProjectHealthRepairIssueId,
                      )}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {previewing === finding.id ? (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCcw size={14} aria-hidden="true" />
                      )}
                      {t(previewing === finding.id
                        ? 'projectCockpit.healthRecovery.preview.loading'
                        : 'projectCockpit.health.repair')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openFinding(finding)}
                      className="min-h-10 shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
                    >
                      {t(finding.id === 'broken-conversion-provenance'
                        ? 'projectCockpit.healthRecovery.openWorkflows'
                        : 'projectCockpit.healthRecovery.openAnnotations')}
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <AlertTriangle
                size={20}
                className="mt-0.5 shrink-0 text-amber-400"
                aria-hidden="true"
              />
              <p className="text-sm text-text-muted">
                {t('projectCockpit.healthRecovery.scan.partialDetail')}
              </p>
            </div>
          )}

          <details className="rounded-xl border border-border bg-surface px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold">
              {t('projectCockpit.healthRecovery.provenance.technicalDetails')}
            </summary>
            <dl className="mt-3 divide-y divide-border text-sm">
              {provenance.coverage.map((row) => (
                <div key={row.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,auto)] sm:items-center sm:gap-5">
                  <dt className="min-w-0 text-text-primary">
                    {t(`projectCockpit.healthRecovery.provenance.coverage.${row.id}`)}
                  </dt>
                  <dd className="text-text-muted">
                    {t('projectCockpit.healthRecovery.provenance.verified')}: <span className="tabular-nums text-text-primary">{row.verified}</span>
                  </dd>
                  <dd className="text-text-muted">
                    {t('projectCockpit.healthRecovery.provenance.unchecked')}: <span className="tabular-nums text-text-primary">{row.unchecked}</span>
                  </dd>
                  <dd className="text-text-muted">
                    {t('projectCockpit.healthRecovery.provenance.broken')}: <span className="tabular-nums text-text-primary">{row.broken}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-border bg-elevated/40 p-4 text-sm text-text-muted">
        <DatabaseBackup size={18} className="mt-0.5 shrink-0 text-accent-gold" aria-hidden="true" />
        <p>{t('projectCockpit.healthRecovery.backupPolicy')}</p>
      </div>

      <ConfirmDialog
        open={pendingRepair !== null}
        destructive
        title={t('projectCockpit.healthRecovery.preview.title')}
        message={previewMessage}
        confirmLabel={t('projectCockpit.healthRecovery.preview.confirm')}
        onConfirm={confirmRepair}
        onCancel={() => setPendingRepair(null)}
      />
    </div>
  );
}
