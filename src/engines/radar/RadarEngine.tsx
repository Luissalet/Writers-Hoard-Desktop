import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { saveAs } from 'file-saver';
import { ChartNoAxesCombined, Copy, Download, Plus, Save, Trash2, Upload } from 'lucide-react';
import { db } from '@/db';
import type { EngineComponentProps } from '@/engines/_types';
import { useTranslation } from '@/i18n/useTranslation';
import { useDeepLinkParam } from '@/engines/_shared';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import { Field } from '@/engines/character-sheets/ui';
import { button, gold, input } from '@/engines/character-sheets/uiStyles';
import { createRadarChart, resolveRadarSeries } from './model';
import { exportRadarCsv, exportRadarJson, exportRadarSvg, parseRadarCsv, parseRadarJson } from './interchange';
import { deleteRadarChart, radarDraftStore, RadarConflict, saveRadarChart, type RadarDraft } from './operations';
import type { RadarChartDocument } from './types';
import { radarCopy } from './copy';
import RadarEditor from './RadarEditor';
export default function RadarEngine({ projectId }: EngineComponentProps) { return <RadarWorkspace key={projectId} projectId={projectId} />; }
function RadarWorkspace({ projectId }: EngineComponentProps) {
  const { locale } = useTranslation(), c = radarCopy[locale];
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const entries = useLiveQuery(() => db.codexEntries.where('projectId').equals(projectId).toArray(), [projectId]) ?? [];
  const charts = useMemo(() => project?.radarCharts ?? [], [project?.radarCharts]);
  const [journal] = useState(() => radarDraftStore(projectId)), [, rerender] = useState(0);
  const [selected, setSelected] = useState(''), [query, setQuery] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState(''), [conflict, setConflict] = useState(false), [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ message: string; label: string; action: () => void | Promise<void> } | null>(null);
  const pending = useRef(false), importRef = useRef<HTMLInputElement>(null), link = useDeepLinkParam('entity'); const [seenLink, setSeenLink] = useState('');
  const drafts = Object.fromEntries(journal);
  if (link && link !== seenLink && (charts.some(chart => chart.id === link) || drafts[link])) { setSelected(link); setSeenLink(link); }
  const changeDrafts = (change: (current: Record<string, RadarDraft>) => Record<string, RadarDraft>) => { const before = Object.fromEntries(journal), next = change(before); for (const [id, draft] of Object.entries(next)) if (draft !== before[id]) journal.set(id, draft); for (const id of Object.keys(before)) if (!next[id]) journal.delete(id); rerender(value => value + 1); };
  const removeDraft = (id: string) => changeDrafts(current => { const next = { ...current }; delete next[id]; return next; });
  const id = selected || charts[0]?.id || Object.keys(drafts)[0] || '', active = drafts[id], chart = active?.chart ?? charts.find(item => item.id === id);
  const documents = [...charts, ...Object.values(drafts).map(draft => draft.chart).filter(draft => !charts.some(item => item.id === draft.id))];
  const resolved = chart?.series.map(series => resolveRadarSeries(series, chart.axes, entries, projectId)) ?? [];
  const invalidRange = chart?.axes.some(axis => axis.min >= axis.max) ?? false;
  const update = (change: (chart: RadarChartDocument) => RadarChartDocument) => { if (!chart || busy) return; changeDrafts(current => ({ ...current, [chart.id]: { chart: change(structuredClone(current[chart.id]?.chart ?? chart)), base: current[chart.id] ? current[chart.id].base : chart.revision || null } })); setStatus(''); };
  const perform = async (action: () => Promise<void>) => { if (pending.current) return; pending.current = true; setBusy(true); setError(''); try { await action(); } catch (reason) { if (reason instanceof RadarConflict) { setConflict(true); setError(c.conflict); } else setError(c.failure); } finally { pending.current = false; setBusy(false); } };
  const select = (next: string) => { setSelected(next); setConflict(false); setError(''); setStatus(''); };
  const save = (asNew = false) => { if (!chart) return; void perform(async () => { const candidate = asNew ? { ...chart, id: crypto.randomUUID(), revision: 0, createdAt: Date.now() } : chart; const result = await saveRadarChart(projectId, candidate, asNew ? null : active ? active.base : chart.revision); removeDraft(chart.id); select(result.id); setStatus(c.saved); }); };
  const confirm = (message: string, action: () => void | Promise<void>, label = c.remove) => setConfirmation({ message, action, label });
  const download = (format: 'json' | 'csv' | 'svg') => { if (!chart) return; try { const content = format === 'json' ? exportRadarJson(chart) : format === 'csv' ? exportRadarCsv(chart, resolved) : exportRadarSvg(chart, resolved); const name = chart.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'radar'; saveAs(new Blob([content], { type: format === 'json' ? 'application/json' : format === 'svg' ? 'image/svg+xml;charset=utf-8' : 'text/csv;charset=utf-8' }), `${name}.${format}`); setError(''); } catch { setError(c.exportError); } };
  if (!project) return <p className="p-5 text-text-muted">…</p>;
  return <section className="flex h-full min-h-0 flex-col bg-deep" aria-label={c.title} data-testid="radar-engine">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div><h2 className="flex items-center gap-2 font-display text-2xl text-text-primary"><ChartNoAxesCombined size={24} aria-hidden="true" />{c.title}</h2><p className="mt-2 max-w-prose text-sm text-text-muted">{c.intro}</p></div><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => { const next = createRadarChart(); changeDrafts(current => ({ ...current, [next.id]: { chart: next, base: null } })); select(next.id); }}><Plus size={16} />{c.new}</button><button className={button} disabled={busy} onClick={() => importRef.current?.click()}><Upload size={16} />{c.import}</button></div>
      <input ref={importRef} type="file" accept=".json,.csv,application/json,text/csv" className="hidden" aria-label={c.import} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void perform(async () => { try { if (file.size > 8_000_000) throw new Error(); const text = await file.text(), next = /\.csv$/i.test(file.name) ? parseRadarCsv(text, file.name.replace(/\.csv$/i, '')) : parseRadarJson(text); for (const series of next.series) if (series.linkedEntryId) { const source = await db.codexEntries.get(series.linkedEntryId); if (!source || source.projectId !== projectId) series.linkedEntryId = undefined; } changeDrafts(current => ({ ...current, [next.id]: { chart: next, base: null } })); select(next.id); } catch { setError(c.importError); } }); }} />
    </header>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto md:flex-row"><nav className="shrink-0 border-b border-border p-3 md:w-56 md:overflow-y-auto md:border-r md:border-b-0" aria-label={c.title}>
      <div className="md:hidden"><Field label={c.current}><select className={input} aria-label={c.current} value={id} disabled={busy} onChange={event => select(event.target.value)}>{!documents.length && <option value="">{c.none}</option>}{documents.map(item => <option value={item.id} key={item.id}>{drafts[item.id]?.chart.title || item.title || c.new}{drafts[item.id] ? ' *' : ''}</option>)}</select></Field></div>
      <div className="hidden md:block"><input type="search" className={input} aria-label={c.current} value={query} onChange={event => setQuery(event.target.value)} placeholder={c.current} />{documents.filter(item => (drafts[item.id]?.chart.title ?? item.title).toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.id} disabled={busy} aria-current={id === item.id ? 'page' : undefined} className={`mt-2 w-full rounded-lg p-3 text-left focus-visible:outline-2 focus-visible:outline-accent-gold ${id === item.id ? 'bg-elevated text-accent-gold' : 'text-text-primary hover:bg-surface'}`} onClick={() => select(item.id)}><span className="block break-words text-sm">{drafts[item.id]?.chart.title || item.title || c.new}{drafts[item.id] ? ' *' : ''}</span><span className="mt-1 block text-xs text-text-muted">{item.axes.length} · {c.compare} / {item.series.length} {c.count}</span></button>)}</div>
    </nav><main className="min-w-0 flex-1 space-y-5 p-5 md:overflow-y-auto">{chart ? <>
      <div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><Field label={c.name}><input className={`${input} font-display text-lg`} aria-label={c.name} maxLength={300} value={chart.title} onChange={event => update(current => ({ ...current, title: event.target.value }))} /></Field></div><button className={gold} disabled={busy || !active || !chart.title.trim() || invalidRange} onClick={() => save()}><Save size={16} />{c.save}</button><button className={button} disabled={busy || !chart.title.trim() || invalidRange} onClick={() => save(true)}><Copy size={16} />{c.copy}</button></div>
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className={active ? 'text-accent-gold' : 'text-text-muted'}>{active ? c.unsaved : c.saved}</span>{active && <button className={button} disabled={busy} onClick={() => confirm(c.discardHelp, () => { removeDraft(chart.id); select(charts.some(item => item.id === chart.id) ? chart.id : ''); }, c.discard)}>{c.discard}</button>}{charts.some(item => item.id === chart.id) && <button className={`${button} text-danger`} disabled={busy} onClick={() => confirm(c.deleteHelp, () => perform(async () => { await deleteRadarChart(projectId, chart.id, active?.base ?? chart.revision); removeDraft(chart.id); select(''); }), c.delete)}><Trash2 size={16} />{c.delete}</button>}
        <div className="flex flex-wrap gap-2 md:ml-auto"><button className={button} disabled={busy || invalidRange} onClick={() => download('svg')}><Download size={15} />{c.svg}</button><button className={button} disabled={busy || invalidRange} onClick={() => download('json')}>{c.json}</button><button className={button} disabled={busy || invalidRange} onClick={() => download('csv')}>{c.csv}</button></div>
      </div>
      {invalidRange && <p role="alert" className="text-sm text-danger">{c.rangeError}</p>}{error && <div role="alert" className="space-y-3 rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}{conflict && <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || invalidRange || !chart.title.trim()} onClick={() => save(true)}>{c.copy}</button><button className={button} disabled={busy} onClick={() => confirm(c.discardHelp, () => { removeDraft(chart.id); setConflict(false); setError(''); }, c.reload)}>{c.reload}</button></div>}</div>}{status && <p role="status" className="text-sm text-text-muted">{status}</p>}
      <fieldset disabled={busy}><RadarEditor key={chart.id} chart={chart} entries={entries} resolved={resolved} locale={locale} update={update} confirm={(message, action) => confirm(message, action)} /></fieldset>
      <Field label={c.description}><textarea className={input} aria-label={c.description} disabled={busy} rows={3} maxLength={50000} value={chart.description} onChange={event => update(current => ({ ...current, description: event.target.value }))} /></Field><p className="max-w-prose text-xs text-text-muted">{c.fileHelp}</p>
    </> : <p className="py-12 text-center text-text-muted">{c.empty}</p>}</main></div>
    <ConfirmDialog open={!!confirmation} message={confirmation?.message ?? ''} confirmLabel={confirmation?.label} destructive onCancel={() => setConfirmation(null)} onConfirm={async () => { const action = confirmation?.action; setConfirmation(null); await action?.(); }} />
  </section>;
}
