import { useState } from 'react';
import { useEraNavigate } from '@/services/worldEras/navigation';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { ChevronDown, ChevronRight, GitCompare, Undo2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useDriftReport } from '@/services/planDrift/useDriftReport';
import { applyBeatProposal, revertBeatProposal, type DriftReceipt } from '@/services/planDrift/ops';
import type { ProjectDrift } from '@/services/planDrift/report';
import type { BeatDrift } from '@/engines/writings/planDrift/drift';

const button = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-elevated hover:text-text-primary';
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
const STATUS_STYLE: Record<string, string> = {
  kept: 'border-emerald-500/40 bg-emerald-500/10',
  drifted: 'border-amber-500/50 bg-amber-500/10',
  unwritten: 'border-border bg-elevated',
};

function BeatCard({ report, drift, projectId, onDone }: { report: ProjectDrift; drift: BeatDrift; projectId: string; onDone: (receipt: DriftReceipt) => void }) {
  const { t } = useTranslation();
  const navigate = useEraNavigate();
  const [showProposal, setShowProposal] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const row = report.beatRows[drift.beatId];
  const list = (ids: readonly string[]) => ids.map((id) => report.titles[id] ?? id).join(', ');
  const missing = [...drift.missing.characters, ...drift.missing.places, ...drift.missing.others];
  const base = `/project/${encodeURIComponent(projectId)}`;
  return (
    <li data-testid="drift-beat" data-status={drift.status} className={`space-y-1 rounded-lg border p-2 text-[11px] ${STATUS_STYLE[drift.status]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-text-primary">{row?.title || t('drift.untitledBeat')}</span>
        <span className="shrink-0 text-[10px] font-semibold">{t(`drift.status.${drift.status}`)}{drift.status !== 'unwritten' ? ` · ${Math.round(drift.score * 100)} %` : ''}</span>
      </div>
      <p className="text-[10px] text-text-dim">{report.outlines[drift.outlineId]}{drift.writingId ? ` · ${report.titles[drift.writingId]}` : ''}</p>
      {missing.length > 0 && <p className="text-[10px] text-text-muted">{fill(t('drift.missing'), { names: list(missing) })}</p>}
      {drift.missing.promises.length > 0 && <p className="text-[10px] text-text-muted">{fill(t('drift.missingPromises'), { names: list(drift.missing.promises) })}</p>}
      {(drift.extra.characters.length > 0 || drift.extra.places.length > 0) && <p className="text-[10px] text-text-muted">{fill(t('drift.extra'), { names: list([...drift.extra.characters, ...drift.extra.places]) })}</p>}
      <div className="flex flex-wrap gap-1">
        <button type="button" className={button} onClick={() => navigate(`${base}/outline?outline=${encodeURIComponent(drift.outlineId)}&beat=${encodeURIComponent(drift.beatId)}`)}>{t('drift.openBeat')}</button>
        {drift.writingId && <button type="button" className={button} onClick={() => navigate(`${base}/writings?writing=${encodeURIComponent(drift.writingId!)}`)}>{t('drift.openChapter')}</button>}
        {drift.proposal && <button type="button" data-testid="drift-show-proposal" className={button} onClick={() => setShowProposal((v) => !v)}>{t('drift.proposal.show')}</button>}
      </div>
      {showProposal && drift.proposal && (
        <div className="space-y-1 rounded-md bg-deep p-2" data-testid="drift-proposal">
          <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('drift.proposal.now')}</p>
          <p className="whitespace-pre-wrap text-[10px] text-text-muted line-through decoration-text-dim/50">{row?.title}{row?.description ? `\n${row.description}` : ''}</p>
          <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('drift.proposal.after')}</p>
          <p className="whitespace-pre-wrap text-[11px] text-text-primary">{drift.proposal.title}{`\n${drift.proposal.description}`}</p>
          <button type="button" data-testid="drift-apply" className="w-full rounded-md bg-accent-gold/20 px-2 py-1 text-[11px] font-semibold text-accent-gold hover:bg-accent-gold/30"
            onClick={() => { setFailure(null); applyBeatProposal(projectId, drift.beatId, drift.proposal!).then((r) => { setShowProposal(false); onDone(r); }, (e: unknown) => setFailure(e instanceof Error ? e.message : String(e))); }}>{t('drift.proposal.apply')}</button>
          {failure && <p role="alert" className="text-[10px] text-red-300">{failure}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * Plan drift beside the manuscript: does this chapter still do what its outline
 * beat says, which beats have no chapter, which chapters no beat; and the
 * outline updated from the chapter when the author accepts it, with Undo.
 */
export default function DriftPanel({ projectId, writingId }: { projectId: string; writingId: string }) {
  const { t } = useTranslation();
  const navigate = useEraNavigate();
  const { eraId } = useWorldEraScope(projectId);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [undo, setUndo] = useState<DriftReceipt | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { report, loading, error } = useDriftReport(projectId, !open, eraId);
  const drifted = report?.beats.filter((b) => b.status === 'drifted').length ?? 0;
  const shown = (report?.beats ?? []).filter((b) => (all ? b.status !== 'kept' || b.proposal : b.writingId === writingId));
  const base = `/project/${encodeURIComponent(projectId)}`;
  return (
    <section aria-label={t('drift.title')} data-testid="drift-panel" className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/10">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left">
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <GitCompare size={15} className="text-accent-gold" aria-hidden="true" />
        <h2 className="flex-1 text-xs font-bold text-text-primary">{t('drift.title')}</h2>
        {drifted > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-300">{drifted}</span>}
      </button>
      {open && (
        <div className="space-y-3 p-3">
          <div className="flex gap-1 text-[10px]">
            {[false, true].map((value) => <button key={String(value)} type="button" data-testid={value ? 'drift-all' : 'drift-this'} onClick={() => setAll(value)} className={`rounded px-2 py-0.5 ${all === value ? 'bg-elevated text-accent-gold' : 'text-text-muted'}`}>{t(value ? 'drift.allBeats' : 'drift.thisChapter')}</button>)}
          </div>
          {undo && (
            <div className="flex items-center justify-between rounded-md bg-elevated px-2 py-1 text-[10px] text-text-muted">
              <span className="truncate">{t('drift.applied')}</span>
              <button type="button" data-testid="drift-undo" className={button} onClick={() => { const r = undo; setUndo(null); revertBeatProposal(projectId, r).catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e))); }}><Undo2 size={11} aria-hidden="true" />{t('drift.undo')}</button>
            </div>
          )}
          {(failure || error) && <p role="alert" className="text-[10px] text-red-300">{failure ?? error}</p>}
          {!report ? <p className="text-[10px] text-text-dim">{t('drift.loading')}</p> : !Object.keys(report.beatRows).length ? <p className="text-[10px] text-text-dim">{t('drift.noOutline')}</p> : (
            <>
              {loading && <p className="text-[10px] text-text-dim">{t('drift.loading')}</p>}
              {!shown.length && <p className="text-[10px] text-text-dim">{t(all ? 'drift.allKept' : 'drift.noBeatHere')}</p>}
              <ul className="space-y-2">{shown.map((d) => <BeatCard key={d.beatId} report={report} drift={d} projectId={projectId} onDone={setUndo} />)}</ul>
              {all && report.unplanned.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('drift.unplanned')}</p>
                  <ul className="space-y-0.5">{report.unplanned.map((id) => <li key={id}><button type="button" data-testid="drift-unplanned" className={button} onClick={() => navigate(`${base}/writings?writing=${encodeURIComponent(id)}`)}>{report.titles[id]}</button></li>)}</ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
