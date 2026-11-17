import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePacingReport } from '@/services/pacing/usePacingReport';
import type { ProjectPacing } from '@/services/pacing/report';

const W = 300, H = 120, TOP = 8, BOTTOM = 100;
const button = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-elevated hover:text-text-primary';
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
const pct = (x: number) => `${Math.round(x * 100)} %`;
const y = (pace: number) => TOP + (1 - pace) * (BOTTOM - TOP);

function Curve({ report, writingId, onOpen }: { report: ProjectPacing; writingId: string; onOpen: (writingId: string, quote: string) => void }) {
  const { t } = useTranslation();
  const flagged = new Set(report.flags.filter((f) => f.kind === 'flat').flatMap((f) => f.sceneIds));
  const byId = new Map(report.scenes.map((s) => [s.id, s]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-deep" role="img" aria-label={t('pacing.curve')} data-testid="pacing-curve">
      {report.flags.filter((f) => f.kind === 'flat').map((f) => {
        const first = byId.get(f.sceneIds[0])!, last = byId.get(f.sceneIds[f.sceneIds.length - 1])!;
        return <rect key={f.sceneIds[0]} x={first.at * W - 3} y={TOP} width={Math.max(6, (last.at - first.at) * W + 6)} height={BOTTOM - TOP} fill="#d9770622" />;
      })}
      {report.beats.map((beat) => (
        <g key={beat.id}>
          <line x1={beat.at * W} x2={beat.at * W} y1={TOP} y2={BOTTOM} stroke="#8b7cc8" strokeDasharray="2 2" strokeWidth={0.8} />
          <title>{beat.title}</title>
        </g>
      ))}
      <polyline fill="none" stroke="#c4973b" strokeWidth={1.4} points={report.scenes.map((s) => `${s.at * W},${y(s.pace)}`).join(' ')} />
      {report.scenes.map((s) => (
        <circle key={s.id} data-testid="pacing-point" cx={s.at * W} cy={y(s.pace)} r={s.writingId === writingId ? 3.2 : 2.2}
          fill={flagged.has(s.id) ? '#d97706' : s.writingId === writingId ? '#f5d38a' : '#c4973b'} className="cursor-pointer" onClick={() => onOpen(s.writingId, s.quote)}>
          <title>{`${report.titles[s.writingId] ?? ''} · ${fill(t('pacing.sceneTip'), { n: s.index + 1, pace: pct(s.pace), dialogue: pct(s.dialogue), description: pct(s.description), words: s.words })}`}</title>
        </circle>
      ))}
      <text x={2} y={H - 4} fontSize={8} fill="#8a8578">{t('pacing.axisStart')}</text>
      <text x={W - 2} y={H - 4} fontSize={8} fill="#8a8578" textAnchor="end">{t('pacing.axisEnd')}</text>
      <text x={2} y={TOP + 6} fontSize={7} fill="#8a8578">{t('pacing.fast')}</text>
      <text x={2} y={BOTTOM - 2} fontSize={7} fill="#8a8578">{t('pacing.slow')}</text>
    </svg>
  );
}

/**
 * Pacing x-ray beside the manuscript: the pace curve of every scene with the
 * outline's beats over it, this chapter's mix, and the flat or lopsided stretches.
 */
export default function PacingPanel({ projectId, writingId, onOpen }: { projectId: string; writingId: string; onOpen: (writingId: string, quote: string) => void }) {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { report, loading, error } = usePacingReport(projectId, !open);
  const chapter = report?.chapters.find((c) => c.writingId === writingId);
  const scenes = report?.scenes.filter((s) => s.writingId === writingId) ?? [];
  const label = (sceneId: string) => { const s = report?.scenes.find((x) => x.id === sceneId); return s ? `${report!.titles[s.writingId] ?? ''} · ${fill(t('pacing.scene'), { n: s.index + 1 })}` : sceneId; };
  return (
    <section aria-label={t('pacing.title')} data-testid="pacing-panel" className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/10">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left">
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <Activity size={15} className="text-accent-gold" aria-hidden="true" />
        <h2 className="flex-1 text-xs font-bold text-text-primary">{t('pacing.title')}</h2>
        {report && report.flags.length > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-300">{report.flags.length}</span>}
      </button>
      {open && (
        <div className="space-y-3 p-3">
          {error && <p role="alert" className="text-[10px] text-red-300">{error}</p>}
          {!report ? <p className="text-[10px] text-text-dim">{t('pacing.loading')}</p> : !report.scenes.length ? <p className="text-[10px] text-text-dim">{t('pacing.empty')}</p> : (
            <>
              <Curve report={report} writingId={writingId} onOpen={onOpen} />
              <p className="text-[10px] text-text-dim">{fill(t('pacing.legend'), { scenes: report.scenes.length, beats: report.beats.length })}{loading ? ` · ${t('pacing.loading')}` : ''}</p>
              {chapter && (
                <div className="space-y-1 rounded-lg bg-deep p-2 text-[11px]" data-testid="pacing-chapter">
                  <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('pacing.thisChapter')}</p>
                  <div className="flex h-2 overflow-hidden rounded" aria-hidden="true">
                    <div style={{ width: pct(chapter.dialogue) }} className="bg-sky-500/70" />
                    <div style={{ width: pct(chapter.narration) }} className="bg-accent-gold/70" />
                    <div style={{ width: pct(chapter.description) }} className="bg-emerald-500/60" />
                  </div>
                  <p className="text-text-primary">{fill(t('pacing.mix'), { dialogue: pct(chapter.dialogue), narration: pct(chapter.narration), description: pct(chapter.description) })}</p>
                  <p className="text-text-muted">{fill(t('pacing.numbers'), { words: chapter.words.toLocaleString(locale), scenes: chapter.scenes, action: chapter.action.toLocaleString(locale), pace: pct(chapter.pace) })}</p>
                  <ul className="space-y-0.5 text-[10px] text-text-muted">
                    {scenes.map((s) => (
                      <li key={s.id}><button type="button" className={button} onClick={() => onOpen(s.writingId, s.quote)}>{fill(t('pacing.sceneLine'), { n: s.index + 1, words: s.words, pace: pct(s.pace), dialogue: pct(s.dialogue) })}</button></li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('pacing.flags')}</p>
                {!report.flags.length && <p className="text-[10px] text-text-dim">{t('pacing.noFlags')}</p>}
                <ul className="space-y-1">
                  {report.flags.map((f) => {
                    const first = report.scenes.find((s) => s.id === f.sceneIds[0])!;
                    return (
                      <li key={`${f.kind}:${f.sceneIds[0]}`} data-testid="pacing-flag" data-kind={f.kind} className="space-y-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px]">
                        <p className="text-text-primary">{fill(t(`pacing.flag.${f.kind}`), { n: f.sceneIds.length, share: pct(Number(f.detail)), words: Number(f.detail).toLocaleString(locale), times: Number(f.detail).toLocaleString(locale) })}</p>
                        <div className="flex items-center justify-between gap-2 text-[10px] text-text-dim">
                          <span className="truncate">{label(f.sceneIds[0])}{f.sceneIds.length > 1 ? ` → ${label(f.sceneIds[f.sceneIds.length - 1])}` : ''}</span>
                          <button type="button" data-testid="pacing-flag-open" className={button} onClick={() => onOpen(first.writingId, first.quote)}>{t('pacing.open')}</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {report.beats.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('pacing.beats')}</p>
                  <ul className="space-y-0.5 text-[10px]">
                    {report.beats.map((b) => (
                      <li key={b.id}><button type="button" data-testid="pacing-beat" className={button} onClick={() => navigate(`/project/${encodeURIComponent(projectId)}/outline?outline=${encodeURIComponent(b.outlineId)}&beat=${encodeURIComponent(b.id)}`)}>{pct(b.at)} · {b.title}</button></li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
