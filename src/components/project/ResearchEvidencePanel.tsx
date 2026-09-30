import { useEffect, useId, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db';
import { useLocaleStore } from '@/stores/localeStore';
import type { Citation, ResearchEvidence } from '@/types/projectTools';
import type { Snapshot } from '@/engines/scrapper/types';
import { getResearchEvidence, ResearchEvidenceError, safeResearchUrl, saveResearchEvidence, type EvidenceInput } from '@/services/researchEvidence';
import { researchEvidenceCopy } from './researchEvidenceCopy';
import SourceGradeControls from './SourceGradeControls';

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold';
const button = 'inline-flex items-center justify-center rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline focus-visible:outline-accent-gold disabled:opacity-50';
const blank: EvidenceInput = { statement: '', quote: '', locator: '', notes: '', kind: 'fact', status: 'pending' };
type EvidenceRow = { citation: Citation; evidence: ResearchEvidence };

/** Key the inner form by project so a project switch cannot save a stale draft elsewhere. */
export default function ResearchEvidencePanel({ projectId }: { projectId: string }) {
  return <EvidencePanel key={projectId} projectId={projectId} />;
}
function EvidencePanel({ projectId }: { projectId: string }) {
  const locale = useLocaleStore(state => state.locale);
  const c = researchEvidenceCopy[locale];
  const prefix = useId();
  const [data, setData] = useState<{ citations: Citation[]; snapshots: Snapshot[]; rows: EvidenceRow[] }>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<EvidenceInput>(blank);
  const [source, setSource] = useState('');
  const [editing, setEditing] = useState<EvidenceRow>();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ResearchEvidenceError['code'] | 'saveError'>();
  const [saved, setSaved] = useState(false);
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    const subscription = liveQuery(async () => ({
      citations: await db.citations.where('projectId').equals(projectId).toArray(),
      snapshots: await db.snapshots.where('projectId').equals(projectId).toArray(),
      rows: await getResearchEvidence(projectId),
    })).subscribe({ next: value => { setData(value); setLoadFailed(false); }, error: () => setLoadFailed(true) });
    return () => subscription.unsubscribe();
  }, [projectId, attempt]);
  const change = <K extends keyof EvidenceInput>(key: K, value: EvidenceInput[K]) => { setDraft(current => ({ ...current, [key]: value })); setSaved(false); };
  async function save() {
    setBusy(true); setError(undefined); setSaved(false);
    try {
      const selectedSource = source.startsWith('citation:') ? { citationId: source.slice(9) } : { snapshotId: source.slice(9) };
      await saveResearchEvidence(projectId, selectedSource, draft, editing ? { id: editing.evidence.id, expectedUpdatedAt: editing.evidence.updatedAt } : undefined);
      setShowForm(false); setEditing(undefined); setDraft(blank); setSource(''); setSaved(true);
    } catch (cause) { setError(cause instanceof ResearchEvidenceError ? cause.code : 'saveError'); }
    finally { setBusy(false); }
  }
  const selectedSnapshotId = source.startsWith('snapshot:') ? source.slice(9) : data?.citations.find(row => row.id === source.slice(9))?.snapshotId;
  const sourceText = data?.snapshots.find(row => row.id === selectedSnapshotId)?.extractedText;
  const rows = data?.rows.filter(row => filter === 'all' || row.evidence.status === filter) ?? [];
  return <section className="space-y-4 rounded-xl border border-border bg-surface p-5" aria-labelledby={`${prefix}-title`}>
    <h3 id={`${prefix}-title`} className="text-lg font-semibold text-text-primary">{c.title}</h3>
    <p className="max-w-prose text-sm text-text-secondary">{c.intro}</p>
    {loadFailed && <div role="alert" className="text-sm text-text-primary">{c.loadError} <button className={button} onClick={() => setAttempt(value => value + 1)}>{c.retry}</button></div>}
    {!data && !loadFailed && <p role="status">{c.loading}</p>}
    {saved && <p role="status" className="text-sm text-text-secondary">{c.saved}</p>}
    {data && <>
      {!data.citations.length && !data.snapshots.length ? <p className="text-sm text-text-secondary">{c.noSources}</p> : !showForm && <button className={button} onClick={() => { setShowForm(true); setSaved(false); }}>{c.add}</button>}
      {showForm && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="space-y-3">
          <legend className="mb-2 font-medium text-text-primary">{editing ? c.edit : c.add}</legend>
          <label className="block space-y-1 text-sm text-text-primary"><span>{c.statement}</span><textarea className={field} required maxLength={10000} value={draft.statement} onChange={event => change('statement', event.target.value)} /></label>
          <label className="block space-y-1 text-sm text-text-primary"><span>{c.source}</span><select className={field} required value={source} disabled={!!editing} onChange={event => setSource(event.target.value)}>
            <option value="">{c.choose}</option>
            {data.citations.map(citation => <option key={citation.id} value={`citation:${citation.id}`}>{c.citation}: {citation.title}</option>)}
            {data.snapshots.filter(snapshot => !data.citations.some(citation => citation.snapshotId === snapshot.id)).map(snapshot => <option key={snapshot.id} value={`snapshot:${snapshot.id}`}>{c.snapshot}: {snapshot.title || snapshot.url}</option>)}
          </select></label>
          {sourceText && <details className="text-sm text-text-primary"><summary className="cursor-pointer py-2 text-accent-gold focus-visible:outline focus-visible:outline-accent-gold">{c.sourcePreview}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-3 font-sans">{sourceText.slice(0, 30000)}</pre>{sourceText.length > 30000 && <p className="mt-1 text-text-secondary">{c.previewLimit}</p>}</details>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm text-text-primary"><span>{c.kind}</span><select className={field} value={draft.kind} onChange={event => change('kind', event.target.value as EvidenceInput['kind'])}>{Object.entries(c.kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block space-y-1 text-sm text-text-primary"><span>{c.status}</span><select className={field} value={draft.status} onChange={event => change('status', event.target.value as EvidenceInput['status'])}>{Object.entries(c.statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <label className="block space-y-1 text-sm text-text-primary"><span>{c.quote}</span><textarea className={field} rows={4} maxLength={50000} required={draft.status === 'reviewed'} aria-describedby={`${prefix}-quote-hint`} value={draft.quote} onChange={event => change('quote', event.target.value)} /></label>
          <p id={`${prefix}-quote-hint`} className="text-sm text-text-secondary">{c.quoteHint}</p>
          <label className="block space-y-1 text-sm text-text-primary"><span>{c.locator}</span><input className={field} maxLength={2000} value={draft.locator} onChange={event => change('locator', event.target.value)} /></label>
          <label className="block space-y-1 text-sm text-text-primary"><span>{c.notes}</span><textarea className={field} maxLength={10000} value={draft.notes} onChange={event => change('notes', event.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-text-primary">{error === 'saveError' ? c.saveError : c.errors[error]}</p>}
          <div className="flex gap-2"><button className={button} type="submit">{busy ? c.saving : c.save}</button><button className={button} type="button" onClick={() => { setShowForm(false); setEditing(undefined); setDraft(blank); setSource(''); setError(undefined); }}>{c.cancel}</button></div>
        </fieldset>
      </form>}
      {!!data.rows.length && <label className="block max-w-xs space-y-1 text-sm text-text-primary"><span>{c.filter}</span><select className={field} value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{c.all}</option>{Object.entries(c.statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      {!rows.length && <p className="text-sm text-text-secondary">{data.rows.length ? c.noMatches : c.empty}</p>}
      <ul className="divide-y divide-border">{rows.map(({ citation, evidence }) => <li key={evidence.id} className="space-y-2 py-4 first:pt-0">
        <div className="flex flex-wrap items-start justify-between gap-2"><p className="max-w-prose whitespace-pre-wrap break-words font-medium text-text-primary">{evidence.statement}</p><button className={button} disabled={showForm} onClick={() => { setEditing({ citation, evidence }); setDraft({ statement: evidence.statement, kind: evidence.kind, quote: evidence.quote, locator: evidence.locator, status: evidence.status, notes: evidence.notes }); setSource(`citation:${citation.id}`); setShowForm(true); setSaved(false); }}>{c.edit}</button></div>
        <p className="text-sm text-text-secondary">{c.kinds[evidence.kind]} · {c.statuses[evidence.status]}</p>
        {evidence.quote && <blockquote className="max-w-prose whitespace-pre-wrap break-words border-l border-border pl-3 text-sm text-text-primary">{evidence.quote}</blockquote>}
        <p className="break-words text-sm text-text-primary">{citation.title}{citation.authors.length ? ` — ${citation.authors.join(', ')}` : ''}{evidence.locator ? ` · ${evidence.locator}` : ''}</p>
        <p className="text-xs text-text-secondary">{citation.publishedAt && `${c.published}: ${citation.publishedAt} · `}{c.accessed}: {citation.accessedAt}{evidence.reviewedAt ? ` · ${c.reviewed}: ${new Date(evidence.reviewedAt).toLocaleDateString(locale)}` : ''}</p>
        {safeResearchUrl(citation.url) && <a className="inline-block text-sm text-accent-gold underline underline-offset-4" href={safeResearchUrl(citation.url)} target="_blank" rel="noopener noreferrer">{c.open}</a>}
        {evidence.notes && <p className="max-w-prose whitespace-pre-wrap break-words text-sm text-text-secondary">{evidence.notes}</p>}
        <SourceGradeControls citation={citation} />
      </li>)}</ul>
    </>}
  </section>;
}
