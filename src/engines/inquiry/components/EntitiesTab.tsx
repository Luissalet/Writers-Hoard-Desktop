import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import type { CodexEntry } from '@/types';
import {
  applyEnrichment, electronTransport, EnrichmentError, isEnrichable, isPerson, previewEnrichment, searchCandidates,
  setPublicFigure, undoEnrichment, type EnrichmentPreview,
} from '../enrichment';
import type { InquiryModel } from '../hooks';
import type { EnrichmentRun } from '../types';
import type { WikidataCandidate } from '../wikidata';
import { buttonClass, cardClass, fieldClass, fill, primaryClass } from './styles';

function noteLabel(t: (key: string) => string, note: string): string {
  const [code, detail] = note.split(':');
  return detail ? `${t(`inquiry.entities.undo.${code}`)}: ${detail}` : t(`inquiry.entities.undo.${code}`);
}

function EnrichPanel({ projectId, entry, onClose }: { projectId: string; entry: CodexEntry; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const [query, setQuery] = useState(entry.title);
  const [candidates, setCandidates] = useState<WikidataCandidate[] | null>(null);
  const [preview, setPreview] = useState<EnrichmentPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<EnrichmentError['code'] | null>(null);

  const fail = (error: unknown) => setProblem(error instanceof EnrichmentError ? error.code : 'network');

  async function search() {
    setBusy(true); setProblem(null); setPreview(null);
    try { setCandidates((await searchCandidates(projectId, entry.id, { query, language: locale })).candidates); }
    catch (error) { fail(error); } finally { setBusy(false); }
  }

  async function choose(candidate: WikidataCandidate) {
    setBusy(true); setProblem(null);
    try { setPreview(await previewEnrichment(projectId, entry.id, candidate.qid, { language: locale })); }
    catch (error) { fail(error); } finally { setBusy(false); }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true); setProblem(null);
    try {
      await applyEnrichment(preview);
      toast.success(t('inquiry.entities.applied'));
      onClose();
    } catch (error) { fail(error); setBusy(false); }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border p-3" data-testid="enrich-panel">
      <p className="text-xs text-text-dim">{t('inquiry.entities.enrichHint')}</p>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void search(); }}>
        <input className={`${fieldClass} min-w-0 flex-1`} value={query} maxLength={200} aria-label={t('inquiry.entities.query')} onChange={event => setQuery(event.target.value)} />
        <button type="submit" className={primaryClass} disabled={busy || !query.trim()}>{t('inquiry.entities.search')}</button>
        <button type="button" className={buttonClass} onClick={onClose}>{t('common.cancel')}</button>
      </form>
      {problem && <p role="alert" className="text-sm text-red-400">{t(`inquiry.entities.error.${problem}`)}</p>}
      {candidates && candidates.length === 0 && !problem && <p className="text-sm text-text-dim">{t('inquiry.entities.noCandidates')}</p>}
      {candidates && candidates.length > 0 && !preview && (
        <ul className="space-y-1" aria-label={t('inquiry.entities.candidates')}>
          {candidates.map(candidate => (
            <li key={candidate.qid}>
              <button type="button" className="w-full rounded-lg border border-border p-2 text-left text-sm transition hover:border-accent-gold" disabled={busy} onClick={() => void choose(candidate)}>
                <span className="font-medium text-text-primary">{candidate.label}</span> <span className="text-xs text-accent-gold">{candidate.qid}</span>
                {candidate.description && <span className="block text-xs text-text-dim">{candidate.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <div className="space-y-2" data-testid="enrich-preview">
          <p className="text-sm font-medium text-text-primary">{preview.item.label} <span className="text-xs text-accent-gold">{preview.qid}</span></p>
          <p className="text-xs font-medium text-text-primary">{t('inquiry.entities.willFill')}</p>
          {preview.willFill.length === 0 && <p className="text-xs text-text-dim">{t('inquiry.entities.nothingToFill')}</p>}
          <ul className="space-y-0.5 text-xs text-text-dim">
            {preview.willFill.map(row => <li key={row.field}><span className="text-text-primary">{row.field}</span>: {row.value}</li>)}
          </ul>
          {preview.alreadyFilled.length > 0 && (
            <>
              <p className="text-xs font-medium text-text-primary">{t('inquiry.entities.alreadyFilled')}</p>
              <ul className="space-y-0.5 text-xs text-text-dim">{preview.alreadyFilled.map(row => <li key={row.field}>{row.field}</li>)}</ul>
            </>
          )}
          <p className="text-xs text-text-dim">{t('inquiry.entities.citationNote')}</p>
          <div className="flex gap-2">
            <button type="button" className={primaryClass} disabled={busy} onClick={() => void apply()}>{t('inquiry.entities.apply')}</button>
            <button type="button" className={buttonClass} onClick={() => setPreview(null)}>{t('inquiry.entities.back')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EntitiesTab({ projectId, model }: { projectId: string; model: InquiryModel }) {
  const { t } = useTranslation();
  const entries = model.snapshot!.entries;
  const [runs, setRuns] = useState<EnrichmentRun[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const available = electronTransport() !== null;

  useEffect(() => {
    const subscription = liveQuery(() => db.enrichmentRuns.where('projectId').equals(projectId).toArray()).subscribe({
      next: rows => setRuns(rows.sort((a, b) => b.createdAt - a.createdAt)),
      error: () => setRuns([]),
    });
    return () => subscription.unsubscribe();
  }, [projectId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...entries].filter(entry => !needle || entry.title.toLowerCase().includes(needle)).sort((a, b) => a.title.localeCompare(b.title));
  }, [entries, query]);
  const claimCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const claim of model.snapshot!.claims) {
      for (const ref of [claim.subject, claim.object]) if (ref?.kind === 'codex') counts.set(ref.id, (counts.get(ref.id) ?? 0) + 1);
    }
    return counts;
  }, [model.snapshot]);

  const fail = () => toast.error(t('inquiry.error.unknown'));

  return (
    <div className="space-y-4">
      <section className={`${cardClass} space-y-2 p-4`}>
        <h3 className="font-serif text-sm font-semibold text-text-primary">{t('inquiry.entities.title')}</h3>
        <p className="max-w-prose text-sm text-text-dim">{t('inquiry.entities.intro')}</p>
        {!available && <p className="text-xs text-amber-400" role="status">{t('inquiry.entities.unavailable')}</p>}
        <input className={fieldClass} value={query} placeholder={t('inquiry.entities.filter')} aria-label={t('inquiry.entities.filter')} onChange={event => setQuery(event.target.value)} />
      </section>

      {entries.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-dim">{t('inquiry.entities.empty')}</p>}
      <ul className="space-y-3">
        {visible.map(entry => {
          const entryRuns = runs.filter(run => run.entryId === entry.id);
          const person = isPerson(entry);
          const enrichable = isEnrichable(entry);
          return (
            <li key={entry.id} className={`${cardClass} p-4`} data-entry-id={entry.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">{entry.title} <span className="text-xs font-normal text-text-dim">({entry.type})</span></p>
                  <p className="text-xs text-text-dim">
                    {fill(t('inquiry.entities.claimCount'), { n: claimCount.get(entry.id) ?? 0 })}
                    {entry.wikidataQid && <> · <a className="text-accent-gold underline underline-offset-2" href={`https://www.wikidata.org/wiki/${entry.wikidataQid}`} target="_blank" rel="noopener noreferrer">{entry.wikidataQid}</a></>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {person && (
                    <label className="flex items-center gap-2 text-sm text-text-primary">
                      <input
                        type="checkbox" checked={entry.publicFigure === true}
                        onChange={event => void setPublicFigure(projectId, entry.id, event.target.checked).then(() => { if (!event.target.checked && open === entry.id) setOpen(null); }).catch(fail)}
                      />
                      {entry.publicFigure ? t('inquiry.entities.publicFigure') : t('inquiry.entities.privatePerson')}
                    </label>
                  )}
                  <button
                    type="button" className={buttonClass} disabled={!enrichable || !available}
                    title={!enrichable ? t('inquiry.entities.privateHint') : undefined}
                    onClick={() => setOpen(current => current === entry.id ? null : entry.id)}
                  >
                    {t('inquiry.entities.enrich')}
                  </button>
                </div>
              </div>
              {person && !entry.publicFigure && <p className="mt-1 text-xs text-text-dim">{t('inquiry.entities.privateHint')}</p>}
              {open === entry.id && enrichable && <EnrichPanel projectId={projectId} entry={entry} onClose={() => setOpen(null)} />}
              {entryRuns.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-2" aria-label={t('inquiry.entities.history')}>
                  {entryRuns.map(run => (
                    <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-dim" data-run-id={run.id} data-run-status={run.status}>
                      <span>
                        {new Date(run.createdAt).toLocaleString()} · {run.qid} · {fill(t('inquiry.entities.changes'), { n: run.changes.length })}
                        {run.status === 'undone' && <> · {t('inquiry.entities.undone')}{run.undoNotes?.length ? ` (${run.undoNotes.map(note => noteLabel(t, note)).join(', ')})` : ''}</>}
                      </span>
                      {run.status === 'ok' && (
                        <button type="button" className={buttonClass} onClick={() => void undoEnrichment(projectId, run.id).then(() => toast.success(t('inquiry.entities.undoneToast'))).catch(fail)}>{t('inquiry.entities.undo')}</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
