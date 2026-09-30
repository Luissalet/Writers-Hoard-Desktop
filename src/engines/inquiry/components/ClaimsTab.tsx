import { useMemo, useState } from 'react';
import { Library, Plus } from 'lucide-react';
import { ConfirmDialog } from '@/engines/_shared';
import { toast } from '@/components/common/toast';
import { GradeBadge } from '@/components/project/SourceGradeControls';
import { useTranslation } from '@/i18n/useTranslation';
import { originOf } from '@/services/sourceGrading';
import type { CodexEntry } from '@/types';
import { filterViews, type ClaimView } from '../derive';
import type { InquiryModel } from '../hooks';
import { deleteClaim, restoreClaim, retractClaim } from '../operations';
import { CLAIM_STATUSES, type ClaimStatus, type InquiryClaim } from '../types';
import ClaimEditor from './ClaimEditor';
import LibrarySearch from './LibrarySearch';
import { buttonClass, cardClass, fieldClass, fill, primaryClass, refLabel, validityLabel } from './styles';
import { CountsLine, StatusBadge, TimeBadge } from './shared';

interface Props {
  projectId: string;
  model: InquiryModel;
  asOf: string | null;
  focusClaimId?: string | null;
}

function ClaimCard({ view, entries, expanded, onToggle, onEdit, onChanged }: {
  view: ClaimView;
  entries: ReadonlyMap<string, CodexEntry>;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { claim } = view;
  const [retracting, setRetracting] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const missing = t('inquiry.claim.missingEntity');
  const subject = refLabel(claim.subject, entries, missing);
  const object = refLabel(claim.object, entries, missing);
  const triple = subject || claim.predicate || object ? `${subject || '…'} — ${claim.predicate ?? '…'} → ${object || '…'}` : '';
  const validity = validityLabel(claim.validFrom, claim.validTo);

  return (
    <li className={`${cardClass} p-4`} data-claim-id={claim.id} data-status={view.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={`min-w-0 max-w-prose flex-1 whitespace-pre-wrap break-words text-sm font-medium ${view.status === 'retracted' ? 'text-text-dim line-through' : 'text-text-primary'}`}>
          {claim.statement}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={view.status} />
          <TimeBadge view={view} />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <CountsLine view={view} />
        {triple && <span className="text-xs text-text-dim">{triple}</span>}
        {validity && <span className="text-xs text-text-dim">{validity}</span>}
        {claim.observedAt && <span className="text-xs text-text-dim">{fill(t('inquiry.claim.observed'), { date: claim.observedAt })}</span>}
        {claim.tags.map(tag => <span key={tag} className="rounded bg-elevated px-1.5 py-0.5 text-xs text-text-dim">#{tag}</span>)}
      </div>
      {view.inactiveCount > 0 && view.status !== 'retracted' && (
        <p className="mt-2 text-xs text-red-400" role="status">{fill(t('inquiry.claim.inactiveNote'), { n: view.inactiveCount })}</p>
      )}
      {claim.manualStatus && (
        <p className="mt-1 text-xs text-text-dim">{t('inquiry.claim.override')}: {t(`inquiry.status.${claim.manualStatus}`)} — {claim.manualReason}</p>
      )}
      {claim.retractedAt && <p className="mt-1 text-xs text-red-400">{t('inquiry.claim.retractedByYou')}{claim.retractReason ? `: ${claim.retractReason}` : ''}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass} aria-expanded={expanded} onClick={onToggle}>{expanded ? t('inquiry.claim.hideSources') : t('inquiry.claim.showSources')}</button>
        <button type="button" className={buttonClass} onClick={onEdit}>{t('common.edit')}</button>
        {claim.retractedAt
          ? <button type="button" className={buttonClass} onClick={() => void restoreClaim(claim.projectId, claim.id).then(onChanged).catch(() => toast.error(t('inquiry.error.unknown')))}>{t('inquiry.claim.restore')}</button>
          : <button type="button" className={buttonClass} onClick={() => setRetracting(true)}>{t('inquiry.claim.retract')}</button>}
        <button type="button" className={`${buttonClass} hover:!border-red-400 hover:!text-red-400`} onClick={() => setConfirmDelete(true)}>{t('common.delete')}</button>
      </div>

      {retracting && (
        <form className="mt-3 space-y-2 rounded-lg border border-border p-3" onSubmit={event => {
          event.preventDefault();
          void retractClaim(claim.projectId, claim.id, reason).then(() => { setRetracting(false); onChanged(); }).catch(() => toast.error(t('inquiry.error.unknown')));
        }}>
          <input className={fieldClass} value={reason} placeholder={t('inquiry.claim.retractReason')} aria-label={t('inquiry.claim.retractReason')} onChange={event => setReason(event.target.value)} />
          <div className="flex gap-2">
            <button type="submit" className={primaryClass}>{t('inquiry.claim.retract')}</button>
            <button type="button" className={buttonClass} onClick={() => setRetracting(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {expanded && (
        <ul className="mt-3 space-y-2 border-t border-border pt-3" data-testid="claim-supports">
          {view.supports.map(support => (
            <li key={`${support.citationId}|${support.evidenceId}`} className={`text-sm ${support.active ? '' : 'opacity-70'}`}>
              {support.evidence && <blockquote className="whitespace-pre-wrap break-words border-l border-border pl-3 text-text-primary">{support.evidence.quote || support.evidence.statement}</blockquote>}
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-dim">
                {support.citation?.title ?? t('inquiry.claim.missingSource')}
                {support.evidence?.locator ? ` · ${support.evidence.locator}` : ''}
                {support.citation && <> · {originOf(support.citation).startsWith('citation:') ? '—' : originOf(support.citation)} <GradeBadge citation={support.citation} /></>}
                {support.problem && <span className="text-red-400">{t(`inquiry.claim.problem.${support.problem}`)}</span>}
              </p>
            </li>
          ))}
          {claim.notes && <li className="whitespace-pre-wrap text-xs text-text-dim">{claim.notes}</li>}
        </ul>
      )}

      <ConfirmDialog
        open={confirmDelete}
        destructive
        title={t('inquiry.claim.deleteTitle')}
        message={t('inquiry.claim.deleteMessage')}
        confirmLabel={t('common.delete')}
        onConfirm={() => { setConfirmDelete(false); void deleteClaim(claim.projectId, claim.id).then(onChanged).catch(() => toast.error(t('inquiry.error.unknown'))); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}

export default function ClaimsTab({ projectId, model, asOf, focusClaimId }: Props) {
  const { t } = useTranslation();
  const snapshot = model.snapshot!;
  const [statuses, setStatuses] = useState<ClaimStatus[]>([]);
  const [entityId, setEntityId] = useState('');
  const [tag, setTag] = useState('');
  const [timeState, setTimeState] = useState<'' | 'ended' | 'stale' | 'current'>('');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ claim?: InquiryClaim } | null>(null);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(focusClaimId ?? null);

  const [appliedLink, setAppliedLink] = useState<string | null>(focusClaimId ?? null);
  if (focusClaimId && focusClaimId !== appliedLink) {
    setAppliedLink(focusClaimId);
    setExpanded(focusClaimId);
  }

  const entries = useMemo(() => new Map(snapshot.entries.map(entry => [entry.id, entry])), [snapshot.entries]);
  const tags = useMemo(() => [...new Set(snapshot.claims.flatMap(claim => claim.tags))].sort(), [snapshot.claims]);
  const usedEntities = useMemo(() => {
    const ids = new Set<string>();
    for (const claim of snapshot.claims) {
      if (claim.subject?.kind === 'codex') ids.add(claim.subject.id);
      if (claim.object?.kind === 'codex') ids.add(claim.object.id);
    }
    return [...ids].map(id => entries.get(id)).filter((entry): entry is CodexEntry => !!entry).sort((a, b) => a.title.localeCompare(b.title));
  }, [snapshot.claims, entries]);

  const visible = useMemo(
    () => filterViews(model.views, { statuses, entityId: entityId || undefined, tag: tag || undefined, asOf, timeState: timeState || undefined, query }),
    [model.views, statuses, entityId, tag, asOf, timeState, query],
  );

  const toggleStatus = (status: ClaimStatus) => setStatuses(current => current.includes(status) ? current.filter(row => row !== status) : [...current, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-dim" role="status">{fill(t('inquiry.claims.count'), { shown: visible.length, total: model.views.length })}</p>
        {!editor && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} aria-expanded={searching} onClick={() => setSearching(value => !value)}><Library size={14} /> {t('inquiry.library.open')}</button>
            <button type="button" className={primaryClass} onClick={() => setEditor({})}><Plus size={14} /> {t('inquiry.claims.new')}</button>
          </div>
        )}
      </div>

      {searching && !editor && <LibrarySearch projectId={projectId} onClose={() => setSearching(false)} />}

      {editor && (
        <ClaimEditor
          key={editor.claim?.id ?? 'new'}
          projectId={projectId}
          snapshot={snapshot}
          places={model.places}
          claim={editor.claim}
          onDone={claim => { setEditor(null); setExpanded(claim.id); toast.success(t('inquiry.claims.saved')); }}
          onCancel={() => setEditor(null)}
        />
      )}

      <div className={`${cardClass} space-y-3 p-3`} role="group" aria-label={t('inquiry.claims.filters')}>
        <div className="flex flex-wrap gap-1.5">
          {CLAIM_STATUSES.map(status => (
            <button
              key={status} type="button" aria-pressed={statuses.includes(status)} onClick={() => toggleStatus(status)}
              className={`rounded border px-2 py-0.5 text-xs transition ${statuses.includes(status) ? 'border-accent-gold bg-accent-gold/10 text-accent-gold' : 'border-border text-text-dim hover:text-text-primary'}`}
            >
              {t(`inquiry.status.${status}`)} ({model.views.filter(view => view.status === status && (!asOf || view.inEffect)).length})
            </button>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <input className={fieldClass} value={query} placeholder={t('inquiry.claims.search')} aria-label={t('inquiry.claims.search')} onChange={event => setQuery(event.target.value)} />
          <select className={fieldClass} value={entityId} aria-label={t('inquiry.claims.entity')} onChange={event => setEntityId(event.target.value)}>
            <option value="">{t('inquiry.claims.anyEntity')}</option>
            {usedEntities.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select>
          <select className={fieldClass} value={tag} aria-label={t('inquiry.claims.tag')} onChange={event => setTag(event.target.value)}>
            <option value="">{t('inquiry.claims.anyTag')}</option>
            {tags.map(row => <option key={row} value={row}>#{row}</option>)}
          </select>
          <select className={fieldClass} value={timeState} aria-label={t('inquiry.claims.time')} onChange={event => setTimeState(event.target.value as typeof timeState)}>
            <option value="">{t('inquiry.claims.anyTime')}</option>
            <option value="current">{t('inquiry.time.current')}</option>
            <option value="ended">{t('inquiry.time.ended')}</option>
            <option value="stale">{t('inquiry.time.stale')}</option>
          </select>
        </div>
      </div>

      {model.views.length === 0 && !editor && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-dim">{t('inquiry.claims.empty')}</p>}
      {model.views.length > 0 && visible.length === 0 && <p className="text-sm text-text-dim">{t('inquiry.claims.noMatches')}</p>}
      <ul className="space-y-3">
        {visible.map(view => (
          <ClaimCard
            key={view.claim.id}
            view={view}
            entries={entries}
            expanded={expanded === view.claim.id}
            onToggle={() => setExpanded(current => current === view.claim.id ? null : view.claim.id)}
            onEdit={() => setEditor({ claim: view.claim })}
            onChanged={() => undefined}
          />
        ))}
      </ul>
    </div>
  );
}
