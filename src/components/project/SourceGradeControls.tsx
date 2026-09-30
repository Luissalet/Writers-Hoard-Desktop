import { useEffect, useId, useState } from 'react';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import {
  claimsLeaningOnCitation, gradeCitation, restoreCitation, retractCitation,
  type ClaimImpactSummary,
} from '@/services/sourceGradingOps';
import {
  gradeLabel, isRetracted, originOf, SOURCE_CREDIBILITIES, SOURCE_RELIABILITIES,
} from '@/services/sourceGrading';
import type { Citation, SourceCredibility, SourceReliability } from '@/types/projectTools';

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold';
const button = 'inline-flex items-center justify-center rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline focus-visible:outline-accent-gold disabled:opacity-50';

/** The grade as a chip: "B2", or "ungraded" for a citation written before grading existed. */
export function GradeBadge({ citation }: { citation: Pick<Citation, 'reliability' | 'credibility' | 'retractedAt'> }) {
  const { t } = useTranslation();
  const label = gradeLabel(citation);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className={`rounded border px-1.5 py-0.5 ${label ? 'border-accent-gold text-accent-gold' : 'border-border text-text-dim'}`} data-testid="grade-badge">
        {label ?? t('sourceGrading.ungraded')}
      </span>
      {isRetracted(citation) && <span className="rounded border border-red-400 px-1.5 py-0.5 text-red-400" data-testid="retracted-badge">{t('sourceGrading.retractedBadge')}</span>}
    </span>
  );
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_all, key: string) => String(values[key] ?? ''));
}

/** Grade, retract and restore one citation. Retracting never deletes anything. */
export default function SourceGradeControls({ citation }: { citation: Citation }) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<'idle' | 'grade' | 'retract'>('idle');
  const [reliability, setReliability] = useState<SourceReliability | ''>(citation.reliability ?? '');
  const [credibility, setCredibility] = useState<SourceCredibility | ''>(citation.credibility ?? '');
  const [origin, setOrigin] = useState(citation.origin ?? '');
  const [reason, setReason] = useState('');
  const [leaning, setLeaning] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const retracted = isRetracted(citation);

  useEffect(() => {
    if (mode !== 'retract') return;
    let cancelled = false;
    void claimsLeaningOnCitation(citation.projectId, citation.id).then(count => { if (!cancelled) setLeaning(count); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [mode, citation.projectId, citation.id]);

  const report = (impact: ClaimImpactSummary, kind: 'retracted' | 'restored') => {
    if (kind === 'retracted') toast.success(fill(t('sourceGrading.retracted'), { n: impact.affected, lost: impact.becameUnsupported, weak: impact.weakened }));
    else toast.success(fill(t('sourceGrading.restored'), { n: impact.affected, back: impact.regainedSupport, more: impact.strengthened }));
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch { toast.error(t('sourceGrading.error')); } finally { setBusy(false); }
  }

  return (
    <div className="mt-2 space-y-2" data-testid="source-grade-controls">
      <div className="flex flex-wrap items-center gap-2">
        <GradeBadge citation={citation} />
        <span className="text-xs text-text-dim">{t('sourceGrading.originLabel')}: {originOf(citation).startsWith('citation:') ? '—' : originOf(citation)}</span>
        {mode === 'idle' && <>
          <button type="button" className={button} onClick={() => { setReliability(citation.reliability ?? ''); setCredibility(citation.credibility ?? ''); setOrigin(citation.origin ?? ''); setMode('grade'); }}>
            {gradeLabel(citation) ? t('sourceGrading.regrade') : t('sourceGrading.gradeButton')}
          </button>
          {retracted
            ? <button type="button" className={button} disabled={busy} onClick={() => void run(async () => { report((await restoreCitation(citation.projectId, citation.id)).impact, 'restored'); })}>{t('sourceGrading.restoreButton')}</button>
            : <button type="button" className={button} onClick={() => { setReason(''); setLeaning(null); setMode('retract'); }}>{t('sourceGrading.retractButton')}</button>}
        </>}
      </div>
      {retracted && (
        <p className="text-xs text-red-400" role="status">
          {fill(t('sourceGrading.retractedNotice'), { reason: citation.retractReason ? `: ${citation.retractReason}` : '' })}
        </p>
      )}
      {mode === 'grade' && (
        <form className="space-y-2 rounded-lg border border-border p-3" onSubmit={event => {
          event.preventDefault();
          void run(async () => {
            await gradeCitation(citation.projectId, citation.id, {
              reliability: reliability || null, credibility: credibility || null, origin: origin.trim() || null,
            });
            toast.success(t('sourceGrading.graded'));
            setMode('idle');
          });
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1 text-xs text-text-primary" htmlFor={`${id}-r`}><span>{t('sourceGrading.reliability')}</span>
              <select id={`${id}-r`} className={field} value={reliability} onChange={event => setReliability(event.target.value as SourceReliability | '')}>
                <option value="">{t('sourceGrading.notSet')}</option>
                {SOURCE_RELIABILITIES.map(value => <option key={value} value={value}>{t(`sourceGrading.reliability.${value}`)}</option>)}
              </select></label>
            <label className="block space-y-1 text-xs text-text-primary" htmlFor={`${id}-c`}><span>{t('sourceGrading.credibility')}</span>
              <select id={`${id}-c`} className={field} value={credibility} onChange={event => setCredibility(event.target.value ? Number(event.target.value) as SourceCredibility : '')}>
                <option value="">{t('sourceGrading.notSet')}</option>
                {SOURCE_CREDIBILITIES.map(value => <option key={value} value={value}>{t(`sourceGrading.credibility.${value}`)}</option>)}
              </select></label>
          </div>
          <label className="block space-y-1 text-xs text-text-primary" htmlFor={`${id}-o`}><span>{t('sourceGrading.origin')}</span>
            <input id={`${id}-o`} className={field} maxLength={200} value={origin} onChange={event => setOrigin(event.target.value)} /></label>
          <p className="text-xs text-text-dim">{t('sourceGrading.originHint')}</p>
          <div className="flex gap-2">
            <button type="submit" className={button} disabled={busy}>{t('sourceGrading.save')}</button>
            <button type="button" className={button} onClick={() => setMode('idle')}>{t('sourceGrading.cancel')}</button>
          </div>
        </form>
      )}
      {mode === 'retract' && (
        <form className="space-y-2 rounded-lg border border-border p-3" onSubmit={event => {
          event.preventDefault();
          void run(async () => {
            report((await retractCitation(citation.projectId, citation.id, reason)).impact, 'retracted');
            setMode('idle');
          });
        }}>
          <label className="block space-y-1 text-xs text-text-primary" htmlFor={`${id}-w`}><span>{t('sourceGrading.retractReason')}</span>
            <textarea id={`${id}-w`} className={field} rows={2} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <p className="text-xs text-text-dim">{t('sourceGrading.retractNote')}</p>
          {leaning !== null && <p className="text-xs text-text-primary" role="status">{leaning > 0 ? fill(t('sourceGrading.leaning'), { n: leaning }) : t('sourceGrading.leaningNone')}</p>}
          <div className="flex gap-2">
            <button type="submit" className={button} disabled={busy}>{t('sourceGrading.retractConfirm')}</button>
            <button type="button" className={button} onClick={() => setMode('idle')}>{t('sourceGrading.cancel')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
