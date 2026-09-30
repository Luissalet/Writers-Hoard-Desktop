import { useMemo, useState } from 'react';
import { Copy, Download, Sparkles, X } from 'lucide-react';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { downloadTextFile, sanitizeFilename } from '@/engines/writings/manuscriptExport';
import { useAiStore } from '@/stores/aiStore';
import { useProject } from '@/hooks/useProjects';
import type { InquiryModel } from '../hooks';
import { ModelSummaryError, requestModelSummary } from '../modelSummary';
import { buildReport } from '../report';
import { buildReportCopy } from '../reportCopy';
import { buttonClass, cardClass, fill } from './styles';
import '../i18n';

export default function ReportTab({ projectId, model, asOf }: { projectId: string; model: InquiryModel; asOf: string | null }) {
  const { t, locale } = useTranslation();
  const { project } = useProject(projectId);
  const config = useAiStore(state => state.config);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const snapshot = model.snapshot!;

  const visibleViews = useMemo(() => model.views.filter(view => !asOf || view.inEffect), [model.views, asOf]);
  const report = useMemo(() => buildReport({
    projectTitle: project?.title ?? '',
    inquiryCase: snapshot.case,
    views: visibleViews,
    chronology: model.chronology,
    ach: model.ach,
    hypotheses: snapshot.hypotheses,
    entries: snapshot.entries,
    citations: snapshot.citations,
    copy: buildReportCopy(t),
    asOf,
    modelSummary: summary ?? undefined,
    // `locale` changes the wording, so it belongs in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [project?.title, snapshot, visibleViews, model.chronology, model.ach, asOf, summary, locale]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report.markdown);
      toast.success(t('inquiry.report.copied'));
    } catch {
      toast.error(t('inquiry.report.copyFailed'));
    }
  }

  function save() {
    downloadTextFile(report.markdown, `${sanitizeFilename(project?.title || 'investigation')}-investigation.md`, 'text/markdown');
  }

  async function summarise() {
    setBusy(true);
    setProblem(null);
    try {
      setSummary(await requestModelSummary(projectId, snapshot.case?.question ?? '', visibleViews, report.sources, config));
    } catch (error) {
      setProblem(error instanceof ModelSummaryError ? error.code : 'failed');
    } finally {
      setBusy(false);
    }
  }

  const { check } = report;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => void copy()}><Copy size={14} /> {t('inquiry.report.copy')}</button>
        <button type="button" className={buttonClass} onClick={save}><Download size={14} /> {t('inquiry.report.save')}</button>
        <button type="button" className={buttonClass} disabled={busy || visibleViews.length === 0} onClick={() => void summarise()}><Sparkles size={14} /> {busy ? t('inquiry.report.summarising') : t('inquiry.report.summarise')}</button>
        {summary && <button type="button" className={buttonClass} onClick={() => setSummary(null)}><X size={14} /> {t('inquiry.report.removeSummary')}</button>}
      </div>
      {problem && <p role="alert" className="text-sm text-red-400">{t(`inquiry.report.summaryError.${problem}`)}</p>}

      <section className={`${cardClass} p-4`} aria-label={t('inquiry.report.check')} data-testid="citation-check" data-ok={check.ok}>
        <h3 className="font-serif text-sm font-semibold text-text-primary">{t('inquiry.report.check')}</h3>
        <p className="mt-1 text-xs text-text-dim">{t('inquiry.report.checkHint')}</p>
        <p className={`mt-2 text-sm ${check.ok ? 'text-emerald-400' : 'text-amber-400'}`} role="status">
          {check.ok
            ? fill(t('inquiry.report.checkOk'), { n: check.factualSentences })
            : fill(t('inquiry.report.checkIssues'), { issues: check.issues.length, n: check.factualSentences, cited: check.citedSentences })}
        </p>
        {check.issues.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-text-primary">
            {check.issues.map((issue, index) => (
              <li key={index} data-issue={issue.kind}>
                <span className="text-xs text-amber-400">{t(`inquiry.report.issue.${issue.kind}`)}{issue.marker ? ` [${issue.marker}]` : ''}</span>{' '}
                “{issue.sentence}”
              </li>
            ))}
          </ul>
        )}
      </section>

      <pre className={`${cardClass} max-h-[60vh] overflow-auto whitespace-pre-wrap break-words p-4 font-sans text-sm text-text-primary`} data-testid="report-preview" tabIndex={0} aria-label={t('inquiry.tab.report')}>
        {report.markdown}
      </pre>
    </div>
  );
}
