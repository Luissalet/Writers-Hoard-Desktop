import { useId, useMemo, useState } from 'react';
import { GradeBadge } from '@/components/project/SourceGradeControls';
import { useTranslation } from '@/i18n/useTranslation';
import { isRetracted, originOf } from '@/services/sourceGrading';
import { ResearchEvidenceError } from '@/services/researchEvidence';
import type { CodexEntry } from '@/types';
import type { AtlasPlace } from '@/engines/real-atlas/types';
import { isPartialDate } from '../dates';
import {
  createClaim, InquiryError, updateClaim, type ClaimInput, type ClaimPatch, type InquirySnapshot, type QuoteSupport,
} from '../operations';
import {
  DEFAULT_FUNCTIONAL_PREDICATES, SYMMETRIC_PREDICATES,
  type InquiryClaim, type InquiryRef, type ManualClaimStatus,
} from '../types';
import { buttonClass, fieldClass, primaryClass } from './styles';

interface Props {
  projectId: string;
  snapshot: InquirySnapshot;
  places: readonly AtlasPlace[];
  /** Edit this claim; omit to create. */
  claim?: InquiryClaim;
  /** Start a new claim from this excerpt (used from the source library). */
  presetSupport?: { citationId: string; evidenceId: string };
  onDone: (claim: InquiryClaim) => void;
  onCancel: () => void;
}

type RefDraft = { mode: 'none' } | { mode: 'codex'; id: string } | { mode: 'text'; text: string };

function toDraft(ref: InquiryRef | undefined): RefDraft {
  if (!ref) return { mode: 'none' };
  return ref.kind === 'codex' ? { mode: 'codex', id: ref.id } : { mode: 'text', text: ref.text };
}

function fromDraft(draft: RefDraft): InquiryRef | null {
  if (draft.mode === 'codex') return { kind: 'codex', id: draft.id };
  if (draft.mode === 'text' && draft.text.trim()) return { kind: 'text', text: draft.text };
  return null;
}

function RefField({ label, draft, entries, onChange }: {
  label: string; draft: RefDraft; entries: readonly CodexEntry[]; onChange: (draft: RefDraft) => void;
}) {
  const { t } = useTranslation();
  const value = draft.mode === 'codex' ? `codex:${draft.id}` : draft.mode === 'text' ? 'text' : '';
  return (
    <div className="space-y-1">
      <label className="block space-y-1 text-sm text-text-primary">
        <span>{label}</span>
        <select className={fieldClass} value={value} onChange={event => {
          const next = event.target.value;
          if (!next) onChange({ mode: 'none' });
          else if (next === 'text') onChange({ mode: 'text', text: draft.mode === 'text' ? draft.text : '' });
          else onChange({ mode: 'codex', id: next.slice(6) });
        }}>
          <option value="">{t('inquiry.editor.refNone')}</option>
          <option value="text">{t('inquiry.editor.refText')}</option>
          {entries.map(entry => <option key={entry.id} value={`codex:${entry.id}`}>{entry.title} ({entry.type})</option>)}
        </select>
      </label>
      {draft.mode === 'text' && (
        <input className={fieldClass} maxLength={500} aria-label={`${label}: ${t('inquiry.editor.refText')}`} value={draft.text} onChange={event => onChange({ mode: 'text', text: event.target.value })} />
      )}
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const valid = isPartialDate(value);
  return (
    <label className="block space-y-1 text-sm text-text-primary">
      <span>{label}</span>
      <input className={fieldClass} value={value} placeholder="YYYY-MM-DD" aria-invalid={!valid} onChange={event => onChange(event.target.value)} />
      {!valid && <span role="alert" className="text-xs text-red-400">{t('inquiry.editor.dateHint')}</span>}
    </label>
  );
}

export default function ClaimEditor({ projectId, snapshot, places, claim, presetSupport, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const entries = useMemo(() => [...snapshot.entries].sort((a, b) => a.title.localeCompare(b.title)), [snapshot.entries]);
  const [statement, setStatement] = useState(claim?.statement ?? '');
  const [subject, setSubject] = useState<RefDraft>(toDraft(claim?.subject));
  const [object, setObject] = useState<RefDraft>(toDraft(claim?.object));
  const [predicate, setPredicate] = useState(claim?.predicate ?? '');
  const [validFrom, setValidFrom] = useState(claim?.validFrom ?? '');
  const [validTo, setValidTo] = useState(claim?.validTo ?? '');
  const [observedAt, setObservedAt] = useState(claim?.observedAt ?? '');
  const [confidence, setConfidence] = useState(claim?.confidence ?? 0.5);
  const [notes, setNotes] = useState(claim?.notes ?? '');
  const [tags, setTags] = useState((claim?.tags ?? []).join(', '));
  const [placeIds, setPlaceIds] = useState<string[]>(claim?.placeIds ?? []);
  const [selected, setSelected] = useState<string[]>(
    (claim?.supports ?? (presetSupport ? [presetSupport] : [])).map(s => `${s.citationId}|${s.evidenceId}`),
  );
  const [filter, setFilter] = useState('');
  const [quotes, setQuotes] = useState<QuoteSupport[]>([]);
  const [quoteCitation, setQuoteCitation] = useState('');
  const [quoteText, setQuoteText] = useState('');
  const [quoteLocator, setQuoteLocator] = useState('');
  const [manual, setManual] = useState<ManualClaimStatus | ''>(claim?.manualStatus ?? '');
  const [manualReason, setManualReason] = useState(claim?.manualReason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excerpts = useMemo(() => snapshot.citations.flatMap(citation =>
    (citation.researchEvidence ?? []).map(evidence => ({ citation, evidence, key: `${citation.id}|${evidence.id}` }))), [snapshot.citations]);
  const shown = excerpts.filter(row => {
    const needle = filter.trim().toLowerCase();
    return !needle || `${row.citation.title} ${row.evidence.statement} ${row.evidence.quote}`.toLowerCase().includes(needle);
  });
  const predicates = useMemo(() => [...new Set([
    ...DEFAULT_FUNCTIONAL_PREDICATES, ...SYMMETRIC_PREDICATES,
    ...snapshot.claims.map(row => row.predicate).filter((p): p is string => !!p),
  ])].sort(), [snapshot.claims]);
  const datesOk = isPartialDate(validFrom) && isPartialDate(validTo) && isPartialDate(observedAt);
  const supportCount = selected.length + quotes.length;

  const toggle = (key: string) => setSelected(current => current.includes(key) ? current.filter(row => row !== key) : [...current, key]);
  const addQuote = () => {
    if (!quoteCitation || !quoteText.trim()) return;
    setQuotes(current => [...current, { citationId: quoteCitation, quote: quoteText, locator: quoteLocator }]);
    setQuoteText('');
    setQuoteLocator('');
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const supports = selected.map(key => { const [citationId, evidenceId] = key.split('|'); return { citationId, evidenceId }; });
      const common = {
        statement, subject: fromDraft(subject), object: fromDraft(object), predicate: predicate || null,
        validFrom: validFrom || null, validTo: validTo || null, observedAt: observedAt || null,
        confidence, notes, placeIds,
        tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
        supports, fromQuotes: quotes,
      };
      if (claim) {
        const patch: ClaimPatch = { ...common, manualStatus: manual || null, manualReason: manual ? manualReason : null };
        onDone(await updateClaim(projectId, claim.id, patch, { expectedUpdatedAt: claim.updatedAt }));
      } else {
        const input: ClaimInput = common;
        const created = await createClaim(projectId, input);
        if (manual) onDone(await updateClaim(projectId, created.id, { manualStatus: manual, manualReason }));
        else onDone(created);
      }
    } catch (cause) {
      setError(cause instanceof InquiryError ? cause.code
        : cause instanceof ResearchEvidenceError ? (cause.code === 'source' || cause.code === 'scope' ? 'source' : 'quote')
        : 'unknown');
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4 rounded-xl border border-accent-gold/60 bg-surface p-4"
      aria-label={claim ? t('inquiry.editor.edit') : t('inquiry.editor.new')}
      onSubmit={event => { event.preventDefault(); void submit(); }}
    >
      <h3 className="font-serif text-base font-semibold text-text-primary">{claim ? t('inquiry.editor.edit') : t('inquiry.editor.new')}</h3>
      <label className="block space-y-1 text-sm text-text-primary">
        <span>{t('inquiry.editor.statement')}</span>
        <textarea className={fieldClass} rows={2} required maxLength={10000} value={statement} onChange={event => setStatement(event.target.value)} />
      </label>

      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="mb-1 text-sm font-medium text-text-primary">{t('inquiry.editor.triple')}</legend>
        <RefField label={t('inquiry.editor.subject')} draft={subject} entries={entries} onChange={setSubject} />
        <label className="block space-y-1 text-sm text-text-primary">
          <span>{t('inquiry.editor.predicate')}</span>
          <input className={fieldClass} list={`${id}-predicates`} maxLength={120} value={predicate} onChange={event => setPredicate(event.target.value)} />
          <datalist id={`${id}-predicates`}>{predicates.map(row => <option key={row} value={row} />)}</datalist>
        </label>
        <RefField label={t('inquiry.editor.object')} draft={object} entries={entries} onChange={setObject} />
      </fieldset>

      <div className="grid gap-3 md:grid-cols-3">
        <DateField label={t('inquiry.editor.validFrom')} value={validFrom} onChange={setValidFrom} />
        <DateField label={t('inquiry.editor.validTo')} value={validTo} onChange={setValidTo} />
        <DateField label={t('inquiry.editor.observedAt')} value={observedAt} onChange={setObservedAt} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1 text-sm text-text-primary">
          <span>{t('inquiry.editor.confidence')}: {Math.round(confidence * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={confidence} onChange={event => setConfidence(Number(event.target.value))} className="w-full" />
          <span className="text-xs text-text-dim">{t('inquiry.editor.confidenceHint')}</span>
        </label>
        <label className="block space-y-1 text-sm text-text-primary">
          <span>{t('inquiry.editor.tags')}</span>
          <input className={fieldClass} value={tags} onChange={event => setTags(event.target.value)} />
        </label>
      </div>

      {places.length > 0 && (
        <label className="block space-y-1 text-sm text-text-primary">
          <span>{t('inquiry.editor.places')}</span>
          <select multiple className={`${fieldClass} h-24`} value={placeIds} onChange={event => setPlaceIds([...event.target.selectedOptions].map(option => option.value))}>
            {places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
          </select>
        </label>
      )}

      <label className="block space-y-1 text-sm text-text-primary">
        <span>{t('inquiry.editor.notes')}</span>
        <textarea className={fieldClass} rows={2} maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text-primary">{t('inquiry.editor.support')} ({supportCount})</legend>
        <p className="text-xs text-text-dim">{t('inquiry.editor.supportHint')}</p>
        {excerpts.length > 0 && (
          <>
            <input className={fieldClass} value={filter} placeholder={t('inquiry.editor.supportFilter')} aria-label={t('inquiry.editor.supportFilter')} onChange={event => setFilter(event.target.value)} />
            <ul className="max-h-56 space-y-1 overflow-auto rounded-lg border border-border p-2" data-testid="support-picker">
              {shown.map(row => (
                <li key={row.key}>
                  <label className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-elevated">
                    <input type="checkbox" className="mt-1" checked={selected.includes(row.key)} onChange={() => toggle(row.key)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-text-primary">{row.evidence.statement}</span>
                      {row.evidence.quote && <span className="block truncate text-xs italic text-text-dim">“{row.evidence.quote}”</span>}
                      <span className="flex flex-wrap items-center gap-2 text-xs text-text-dim">
                        {row.citation.title} · {originOf(row.citation).startsWith('citation:') ? '—' : originOf(row.citation)} <GradeBadge citation={row.citation} />
                        {isRetracted(row.citation) && <span className="text-red-400">{t('inquiry.editor.retractedSource')}</span>}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="p-2 text-xs text-text-dim">{t('inquiry.editor.noExcerpts')}</li>}
            </ul>
          </>
        )}
        {excerpts.length === 0 && <p className="text-sm text-text-dim">{t('inquiry.editor.noExcerptsYet')}</p>}
        {snapshot.citations.length > 0 && (
          <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
            <p className="text-sm text-text-primary">{t('inquiry.editor.fromQuote')}</p>
            <select className={fieldClass} value={quoteCitation} aria-label={t('inquiry.editor.quoteSource')} onChange={event => setQuoteCitation(event.target.value)}>
              <option value="">{t('inquiry.editor.quoteSource')}</option>
              {snapshot.citations.map(citation => <option key={citation.id} value={citation.id}>{citation.title}</option>)}
            </select>
            <textarea className={fieldClass} rows={2} maxLength={50000} value={quoteText} placeholder={t('inquiry.editor.quoteText')} aria-label={t('inquiry.editor.quoteText')} onChange={event => setQuoteText(event.target.value)} />
            <input className={fieldClass} value={quoteLocator} placeholder={t('inquiry.editor.quoteLocator')} aria-label={t('inquiry.editor.quoteLocator')} onChange={event => setQuoteLocator(event.target.value)} />
            <button type="button" className={buttonClass} disabled={!quoteCitation || !quoteText.trim()} onClick={addQuote}>{t('inquiry.editor.addQuote')}</button>
            {quotes.length > 0 && (
              <ul className="space-y-1 text-xs text-text-dim">
                {quotes.map((quote, index) => (
                  <li key={index} className="flex items-center justify-between gap-2">
                    <span className="truncate">“{quote.quote}”</span>
                    <button type="button" className="text-red-400" onClick={() => setQuotes(current => current.filter((_q, i) => i !== index))}>{t('common.delete')}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </fieldset>

      {claim && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text-primary">{t('inquiry.editor.override')}</legend>
          <select className={fieldClass} value={manual} aria-label={t('inquiry.editor.override')} onChange={event => setManual(event.target.value as ManualClaimStatus | '')}>
            <option value="">{t('inquiry.editor.overrideNone')}</option>
            <option value="confirmed">{t('inquiry.status.confirmed')}</option>
            <option value="disputed">{t('inquiry.status.disputed')}</option>
          </select>
          {manual && (
            <input className={fieldClass} required value={manualReason} placeholder={t('inquiry.editor.overrideReason')} aria-label={t('inquiry.editor.overrideReason')} onChange={event => setManualReason(event.target.value)} />
          )}
          <p className="text-xs text-text-dim">{t('inquiry.editor.overrideHint')}</p>
        </fieldset>
      )}

      {error && <p role="alert" className="text-sm text-red-400">{t(`inquiry.error.${error}`)}</p>}
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={busy || !statement.trim() || !datesOk || supportCount === 0}>
          {busy ? t('inquiry.editor.saving') : t('inquiry.editor.save')}
        </button>
        <button type="button" className={buttonClass} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}
