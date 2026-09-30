import { useTranslation } from '@/i18n/useTranslation';
import type { ClaimView } from '../derive';
import type { ClaimStatus } from '../types';
import { fill, STATUS_STYLE } from './styles';
import '../i18n';

export function StatusBadge({ status }: { status: ClaimStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${STATUS_STYLE[status].chip}`}
      title={t(`inquiry.statusHint.${status}`)}
      data-status={status}
    >
      {t(`inquiry.status.${status}`)}
    </span>
  );
}

/** Ended and stale are different things: one is over, the other is merely not re-checked. */
export function TimeBadge({ view }: { view: ClaimView }) {
  const { t } = useTranslation();
  if (view.timeState === 'current') return null;
  const ended = view.timeState === 'ended';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${ended ? 'border-border text-text-dim' : 'border-amber-500 text-amber-400'}`}
      title={ended ? t('inquiry.time.endedHint') : fill(t('inquiry.time.staleHint'), { days: view.ageDays ?? 0 })}
      data-time={view.timeState}
    >
      {ended ? t('inquiry.time.ended') : t('inquiry.time.stale')}
    </span>
  );
}

/** Excerpts and independent sources, the two numbers a claim's status rests on. */
export function CountsLine({ view }: { view: ClaimView }) {
  const { t } = useTranslation();
  return (
    <span className="text-xs text-text-dim" data-testid="claim-counts">
      {fill(t('inquiry.counts.excerpts'), { n: view.evidenceCount })} · {fill(t('inquiry.counts.independent'), { n: view.independentCount })}
      {view.inactiveCount > 0 && <span className="text-red-400"> · {fill(t('inquiry.counts.inactive'), { n: view.inactiveCount })}</span>}
    </span>
  );
}

