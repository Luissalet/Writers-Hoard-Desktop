import { lazy, Suspense, useMemo, useState } from 'react';
import { EngineSpinner, useDeepLinkParam } from '@/engines/_shared';
import type { EngineComponentProps } from '@/engines/_types';
import { useTranslation } from '@/i18n/useTranslation';
import { isPartialDate, parsePartial } from '../dates';
import { useInquiry } from '../hooks';
import { saveCase } from '../operations';
import { DEFAULT_STALE_DAYS } from '../types';
import ChronologyTab from './ChronologyTab';
import ClaimsTab from './ClaimsTab';
import EntitiesTab from './EntitiesTab';
import HypothesesTab from './HypothesesTab';
import ReportTab from './ReportTab';
import { buttonClass, cardClass, fieldClass } from './styles';
import '../i18n';

// The graph pulls in the flow library; load it only when its tab opens.
const GraphTab = lazy(() => import('./GraphTab'));

type TabId = 'claims' | 'chronology' | 'graph' | 'hypotheses' | 'report' | 'entities';
const TABS: readonly TabId[] = ['claims', 'chronology', 'graph', 'hypotheses', 'report', 'entities'];

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function InquiryEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const focusClaimId = useDeepLinkParam('claim');
  const [tab, setTab] = useState<TabId>('claims');
  const [asOfInput, setAsOfInput] = useState('');
  const asOfValid = isPartialDate(asOfInput);
  const asOf = asOfInput.trim() && asOfValid ? asOfInput.trim() : null;
  const model = useInquiry(projectId, asOf);
  const [question, setQuestion] = useState<string | null>(null);
  const [staleDays, setStaleDays] = useState<string | null>(null);

  // A deep link to a claim opens the Claims tab once (state derived while rendering, not in an effect).
  const [appliedClaimLink, setAppliedClaimLink] = useState<string | null>(null);
  if (focusClaimId && focusClaimId !== appliedClaimLink) {
    setAppliedClaimLink(focusClaimId);
    setTab('claims');
  }

  // Year bounds of everything dated, for the slider.
  const years = useMemo(() => {
    const found: number[] = [];
    for (const claim of model.snapshot?.claims ?? []) {
      for (const value of [claim.validFrom, claim.validTo, claim.observedAt]) {
        try {
          const range = parsePartial(value);
          if (range) found.push(new Date(range.start * 86_400_000).getUTCFullYear());
        } catch { /* ignore: stored data was validated on write */ }
      }
    }
    return found.length ? { min: Math.min(...found), max: Math.max(...found, new Date().getFullYear()) } : null;
  }, [model.snapshot]);

  if (model.failed) {
    return (
      <div role="alert" className="p-6 text-sm text-text-primary">
        {t('inquiry.loadError')} <button type="button" className={buttonClass} onClick={model.retry}>{t('inquiry.retry')}</button>
      </div>
    );
  }
  if (model.loading || !model.snapshot) return <EngineSpinner />;

  const savedQuestion = model.snapshot.case?.question ?? '';
  const savedStale = model.snapshot.case?.staleDays ?? DEFAULT_STALE_DAYS;
  const commitQuestion = () => {
    if (question !== null && question !== savedQuestion) void saveCase(projectId, { question });
    setQuestion(null);
  };
  const commitStale = () => {
    const days = Number(staleDays);
    if (staleDays !== null && Number.isInteger(days) && days >= 1 && days <= 36_500 && days !== savedStale) void saveCase(projectId, { staleDays: days });
    setStaleDays(null);
  };
  const sliderYear = asOf ? Number(asOf.slice(0, 4)) : years?.max;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header className="space-y-3">
        <h2 className="font-serif text-xl font-semibold text-text-primary">{t('engines.inquiry.name')}</h2>
        <p className="max-w-prose text-sm text-text-dim">{t('inquiry.intro')}</p>
        <label className="block space-y-1 text-sm text-text-primary">
          <span>{t('inquiry.question')}</span>
          <textarea
            className={fieldClass} rows={2} maxLength={10000} placeholder={t('inquiry.questionPlaceholder')}
            value={question ?? savedQuestion} onChange={event => setQuestion(event.target.value)} onBlur={commitQuestion}
          />
        </label>
      </header>

      <section className={`${cardClass} space-y-2 p-3`} aria-label={t('inquiry.asOf.title')} data-testid="asof-bar">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm text-text-primary">
            <span>{t('inquiry.asOf.label')}</span>
            <input className={`${fieldClass} w-40`} value={asOfInput} placeholder="YYYY-MM-DD" aria-invalid={!asOfValid} onChange={event => setAsOfInput(event.target.value)} />
          </label>
          <button type="button" className={buttonClass} onClick={() => setAsOfInput(todayIso())}>{t('inquiry.asOf.today')}</button>
          <button type="button" className={buttonClass} disabled={!asOfInput} onClick={() => setAsOfInput('')}>{t('inquiry.asOf.clear')}</button>
          <label className="space-y-1 text-sm text-text-primary">
            <span>{t('inquiry.asOf.stale')}</span>
            <input
              className={`${fieldClass} w-24`} inputMode="numeric" value={staleDays ?? String(savedStale)}
              onChange={event => setStaleDays(event.target.value)} onBlur={commitStale}
            />
          </label>
        </div>
        {years && years.max > years.min && (
          <input
            type="range" className="w-full" min={years.min} max={years.max} value={sliderYear} aria-label={t('inquiry.asOf.slider')}
            onChange={event => setAsOfInput(event.target.value)}
          />
        )}
        {!asOfValid && <p role="alert" className="text-xs text-red-400">{t('inquiry.editor.dateHint')}</p>}
        <p className="text-xs text-text-dim" role="status">{asOf ? t('inquiry.asOf.active').replace('{date}', asOf) : t('inquiry.asOf.inactive')}</p>
      </section>

      <div role="tablist" aria-label={t('engines.inquiry.name')} className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map(id => (
          <button
            key={id} type="button" role="tab" id={`inquiry-tab-${id}`} aria-selected={tab === id} aria-controls={`inquiry-panel-${id}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${tab === id ? 'border-accent-gold text-accent-gold' : 'border-transparent text-text-dim hover:text-text-primary'}`}
            onClick={() => setTab(id)}
          >
            {t(`inquiry.tab.${id}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`inquiry-panel-${tab}`} aria-labelledby={`inquiry-tab-${tab}`}>
        {tab === 'claims' && <ClaimsTab projectId={projectId} model={model} asOf={asOf} focusClaimId={focusClaimId} />}
        {tab === 'chronology' && <ChronologyTab model={model} asOf={asOf} />}
        {tab === 'graph' && <Suspense fallback={<EngineSpinner />}><GraphTab model={model} asOf={asOf} /></Suspense>}
        {tab === 'hypotheses' && <HypothesesTab projectId={projectId} model={model} />}
        {tab === 'report' && <ReportTab projectId={projectId} model={model} asOf={asOf} />}
        {tab === 'entities' && <EntitiesTab projectId={projectId} model={model} />}
      </div>
    </div>
  );
}
