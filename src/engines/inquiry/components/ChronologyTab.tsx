import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { dayToIso } from '../dates';
import type { ClaimView } from '../derive';
import type { InquiryModel } from '../hooks';
import { cardClass, fill, validityLabel } from './styles';
import { CountsLine, StatusBadge, TimeBadge } from './shared';

export default function ChronologyTab({ model, asOf }: { model: InquiryModel; asOf: string | null }) {
  const { t } = useTranslation();
  const { chronology } = model;
  const byId = useMemo(() => new Map(model.views.map(view => [view.claim.id, view])), [model.views]);
  const dated = chronology.entries.filter(entry => entry.day !== null);
  const undated = chronology.entries.filter(entry => entry.day === null);
  const statement = (id: string) => byId.get(id)?.claim.statement ?? id;

  const row = (view: ClaimView, anchor: string | null) => (
    <li key={view.claim.id} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[8rem_1fr]" data-claim-id={view.claim.id}>
      <span className="text-xs font-medium text-accent-gold">{anchor ?? t('inquiry.chronology.undated')}</span>
      <div className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className={`max-w-prose text-sm ${view.status === 'retracted' ? 'text-text-dim line-through' : 'text-text-primary'}`}>{view.claim.statement}</p>
          <span className="flex items-center gap-1.5"><StatusBadge status={view.status} /><TimeBadge view={view} /></span>
        </div>
        <div className="flex flex-wrap gap-x-3 text-xs text-text-dim">
          <CountsLine view={view} />
          {validityLabel(view.claim.validFrom, view.claim.validTo) && <span>{validityLabel(view.claim.validFrom, view.claim.validTo)}</span>}
        </div>
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      {asOf && <p className="text-sm text-text-dim" role="status">{fill(t('inquiry.chronology.asOfNote'), { date: asOf, n: chronology.entries.length })}</p>}

      {chronology.contradictions.length > 0 && (
        <section className="rounded-xl border border-orange-500/60 bg-surface p-4" aria-label={t('inquiry.chronology.conflicts')} data-testid="contradictions">
          <h3 className="flex items-center gap-2 font-serif text-sm font-semibold text-orange-400"><AlertTriangle size={14} /> {t('inquiry.chronology.conflicts')} ({chronology.contradictions.length})</h3>
          <p className="mt-1 text-xs text-text-dim">{t('inquiry.chronology.conflictsHint')}</p>
          <ul className="mt-2 space-y-2">
            {chronology.contradictions.map(conflict => (
              <li key={conflict.claimIds.join('|')} className="text-sm text-text-primary">
                <span className="text-xs text-text-dim">{conflict.predicate}</span>
                <span className="block">“{statement(conflict.claimIds[0])}”</span>
                <span className="block text-text-dim">{t('inquiry.chronology.versus')}</span>
                <span className="block">“{statement(conflict.claimIds[1])}”</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chronology.gaps.length > 0 && (
        <section className={`${cardClass} p-4`} aria-label={t('inquiry.chronology.gaps')} data-testid="gaps">
          <h3 className="font-serif text-sm font-semibold text-text-primary">{t('inquiry.chronology.gaps')} ({chronology.gaps.length})</h3>
          <p className="mt-1 text-xs text-text-dim">{t('inquiry.chronology.gapsHint')}</p>
          <ul className="mt-2 space-y-1 text-sm text-text-primary">
            {chronology.gaps.map(gap => (
              <li key={`${gap.afterClaimId}|${gap.beforeClaimId}`}>
                {fill(t('inquiry.chronology.gap'), { from: dayToIso(gap.fromDay), to: dayToIso(gap.toDay), days: gap.days, before: statement(gap.afterClaimId), after: statement(gap.beforeClaimId) })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {chronology.entries.length === 0
        ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-dim">{t('inquiry.chronology.empty')}</p>
        : (
          <section className={`${cardClass} overflow-hidden`} aria-label={t('inquiry.tab.chronology')}>
            <ol className="divide-y divide-border">
              {dated.map(entry => row(entry.view, entry.anchor))}
              {undated.map(entry => row(entry.view, null))}
            </ol>
          </section>
        )}
    </div>
  );
}
