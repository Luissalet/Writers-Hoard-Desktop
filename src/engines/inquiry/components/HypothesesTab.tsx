import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/engines/_shared';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import type { InquiryModel } from '../hooks';
import { addHypothesis, deleteHypothesis, rateHypothesis, updateHypothesis } from '../operations';
import { ACH_RATINGS, type AchRating, type InquiryHypothesis } from '../types';
import { buttonClass, cardClass, fieldClass, fill, primaryClass } from './styles';
import { StatusBadge } from './shared';

export default function HypothesesTab({ projectId, model }: { projectId: string; model: InquiryModel }) {
  const { t } = useTranslation();
  const snapshot = model.snapshot!;
  const { ach } = model;
  const [draft, setDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<InquiryHypothesis | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const labels = useMemo(() => new Map(ach.hypotheses.map((row, index) => [row.hypothesis.id, `H${index + 1}`])), [ach.hypotheses]);
  const notes = useMemo(() => new Map(snapshot.ratings.map(row => [row.id, row.note])), [snapshot.ratings]);
  const claimText = (id: string) => model.views.find(view => view.claim.id === id)?.claim.statement ?? id;
  const fail = () => toast.error(t('inquiry.error.unknown'));

  const add = () => {
    if (!draft.trim()) return;
    void addHypothesis(projectId, draft).then(() => setDraft('')).catch(fail);
  };

  const leaders = ach.hypotheses.filter(row => row.leastContradicted);

  return (
    <div className="space-y-5">
      <section className={`${cardClass} space-y-3 p-4`} aria-label={t('inquiry.ach.hypotheses')}>
        <h3 className="font-serif text-sm font-semibold text-text-primary">{t('inquiry.ach.hypotheses')}</h3>
        <form className="flex gap-2" onSubmit={event => { event.preventDefault(); add(); }}>
          <input className={fieldClass} value={draft} maxLength={10000} placeholder={t('inquiry.ach.newPlaceholder')} aria-label={t('inquiry.ach.newPlaceholder')} onChange={event => setDraft(event.target.value)} />
          <button type="submit" className={primaryClass} disabled={!draft.trim()}><Plus size={14} /> {t('inquiry.ach.add')}</button>
        </form>
        {ach.hypotheses.length === 0 && <p className="text-sm text-text-dim">{t('inquiry.ach.empty')}</p>}
        <ul className="space-y-2">
          {ach.hypotheses.map(row => (
            <li key={row.hypothesis.id} className="flex flex-wrap items-center gap-2 text-sm" data-hypothesis-id={row.hypothesis.id}>
              <span className="rounded bg-elevated px-1.5 py-0.5 text-xs font-medium text-accent-gold">{labels.get(row.hypothesis.id)}</span>
              {editing?.id === row.hypothesis.id
                ? (
                  <form className="flex min-w-0 flex-1 gap-2" onSubmit={event => {
                    event.preventDefault();
                    void updateHypothesis(projectId, row.hypothesis.id, { statement: editing.text }).then(() => setEditing(null)).catch(fail);
                  }}>
                    <input className={fieldClass} autoFocus value={editing.text} aria-label={t('inquiry.ach.hypotheses')} onChange={event => setEditing({ id: editing.id, text: event.target.value })} />
                    <button type="submit" className={buttonClass}>{t('inquiry.editor.save')}</button>
                  </form>
                )
                : <span className={`min-w-0 flex-1 ${row.hypothesis.status === 'discarded' ? 'text-text-dim line-through' : 'text-text-primary'}`}>{row.hypothesis.statement}</span>}
              {row.hypothesis.status === 'discarded' && <span className="text-xs text-text-dim">{t('inquiry.ach.discarded')}</span>}
              <button type="button" className={buttonClass} onClick={() => setEditing({ id: row.hypothesis.id, text: row.hypothesis.statement })}>{t('common.edit')}</button>
              <button type="button" className={buttonClass} onClick={() => void updateHypothesis(projectId, row.hypothesis.id, { status: row.hypothesis.status === 'open' ? 'discarded' : 'open' }).catch(fail)}>
                {row.hypothesis.status === 'open' ? t('inquiry.ach.discard') : t('inquiry.ach.reopen')}
              </button>
              <button type="button" className="p-1.5 text-text-dim hover:text-red-400" aria-label={t('common.delete')} title={t('common.delete')} onClick={() => setPendingDelete(row.hypothesis)}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      </section>

      {ach.hypotheses.length > 0 && (
        <section className={`${cardClass} space-y-3 p-4`} aria-label={t('inquiry.ach.matrix')}>
          <h3 className="font-serif text-sm font-semibold text-text-primary">{t('inquiry.ach.matrix')}</h3>
          <p className="text-xs text-text-dim">{t('inquiry.ach.matrixHint')}</p>
          {ach.claims.length === 0
            ? <p className="text-sm text-text-dim">{t('inquiry.ach.noClaims')}</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-sm" data-testid="ach-matrix">
                  <thead>
                    <tr className="text-left text-xs text-text-dim">
                      <th className="p-2 font-medium">{t('inquiry.ach.claim')}</th>
                      {ach.hypotheses.map(row => <th key={row.hypothesis.id} className="p-2 text-center font-medium" title={row.hypothesis.statement}>{labels.get(row.hypothesis.id)}</th>)}
                      <th className="p-2 text-center font-medium">{t('inquiry.ach.diagnosticity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ach.claims.map(row => (
                      <tr key={row.view.claim.id} className="border-t border-border align-top" data-claim-id={row.view.claim.id}>
                        <td className="max-w-xs p-2 text-text-primary">
                          <span className="block">{row.view.claim.statement}</span>
                          <StatusBadge status={row.view.status} />
                        </td>
                        {ach.hypotheses.map(h => {
                          const current = row.ratings[h.hypothesis.id];
                          return (
                            <td key={h.hypothesis.id} className="p-2 text-center">
                              <select
                                className="rounded border border-border bg-background px-1 py-1 text-sm text-text-primary"
                                value={current ?? ''}
                                aria-label={`${labels.get(h.hypothesis.id)} / ${row.view.claim.statement}`}
                                data-testid={`rate-${h.hypothesis.id}-${row.view.claim.id}`}
                                onChange={event => void rateHypothesis(projectId, h.hypothesis.id, row.view.claim.id, (event.target.value || null) as AchRating | null, notes.get(`${h.hypothesis.id}|${row.view.claim.id}`) ?? '').catch(fail)}
                              >
                                <option value="">·</option>
                                {ACH_RATINGS.map(code => <option key={code} value={code}>{code}</option>)}
                              </select>
                            </td>
                          );
                        })}
                        <td className="p-2 text-center text-xs text-text-dim">{row.diagnosticity}{row.pivotal && <span className="ml-1 text-accent-gold" title={t('inquiry.ach.pivotalHint')}>★</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border text-sm font-medium text-text-primary">
                      <td className="p-2">{t('inquiry.ach.score')}</td>
                      {ach.hypotheses.map(row => <td key={row.hypothesis.id} className="p-2 text-center" data-testid={`score-${row.hypothesis.id}`}>{row.score}</td>)}
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          <dl className="grid gap-x-4 gap-y-1 text-xs text-text-dim sm:grid-cols-2">
            {ACH_RATINGS.map(code => <div key={code} className="flex gap-2"><dt className="w-7 font-medium text-text-primary">{code}</dt><dd>{t(`inquiry.ach.code.${code}`)}</dd></div>)}
          </dl>
        </section>
      )}

      {ach.hypotheses.length > 0 && (
        <section className={`${cardClass} space-y-2 p-4`} aria-label={t('inquiry.ach.reading')} data-testid="ach-reading">
          <h3 className="font-serif text-sm font-semibold text-text-primary">{t('inquiry.ach.reading')}</h3>
          {leaders.length > 0 && !ach.tied && (
            <p className="text-sm text-text-primary" data-testid="least-contradicted">
              <strong>{t('inquiry.ach.leastContradicted')}</strong>: {leaders.map(row => `${labels.get(row.hypothesis.id)} — ${row.hypothesis.statement}`).join('; ')}
              <span className="mt-1 block text-xs text-text-dim">{t('inquiry.ach.notProof')}</span>
            </p>
          )}
          {ach.tied && <p className="text-sm text-text-primary">{t('inquiry.ach.tied')}</p>}
          {leaders.length === 0 && !ach.tied && <p className="text-sm text-text-dim">{t('inquiry.ach.noRatings')}</p>}
          {ach.unratedCells > 0 && <p className="text-xs text-text-dim">{fill(t('inquiry.ach.unrated'), { n: ach.unratedCells })}</p>}
          {ach.excludedClaimIds.length > 0 && <p className="text-xs text-text-dim">{fill(t('inquiry.ach.excluded'), { n: ach.excludedClaimIds.length })}</p>}
          {ach.sensitivity.length > 0 && (
            <div className="space-y-1" data-testid="ach-sensitivity">
              <p className="text-xs font-medium text-text-primary">{t('inquiry.ach.sensitivity')}</p>
              <ul className="space-y-1 text-xs text-text-dim">
                {ach.sensitivity.map(note => (
                  <li key={note.claimId}>{fill(t('inquiry.ach.sensitivityLine'), { claim: claimText(note.claimId), list: note.leastContradictedWithout.map(id => labels.get(id)).join(', ') || '—' })}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        title={t('inquiry.ach.deleteTitle')}
        message={t('inquiry.ach.deleteMessage')}
        confirmLabel={t('common.delete')}
        onConfirm={() => { const target = pendingDelete; setPendingDelete(null); if (target) void deleteHypothesis(projectId, target.id).catch(fail); }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
