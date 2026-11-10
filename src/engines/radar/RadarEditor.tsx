import IconPicker from '@/components/common/IconPicker';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { RadarChartDocument } from './types';
import { addRadarAxis, insertRadarAxis, moveRadarAxis, MAX_RADAR_AXES, MAX_RADAR_SERIES, RADAR_COLORS, removeRadarAxis, radarStep, setRadarValue, type RadarEntry, type ResolvedRadarSeries } from './model';
import { radarCopy } from './copy';
import RadarGraphic from './RadarGraphic';
import { NumberField, Field } from '@/engines/character-sheets/ui';
import { button, input } from '@/engines/character-sheets/uiStyles';
export default function RadarEditor({ chart, entries, resolved, locale, update, confirm }: { chart: RadarChartDocument; entries: RadarEntry[]; resolved: ResolvedRadarSeries[]; locale: 'en' | 'es'; update: (change: (chart: RadarChartDocument) => RadarChartDocument) => void; confirm: (message: string, action: () => void) => void }) {
  const c = radarCopy[locale], [tab, setTab] = useState<'axes' | 'series'>('series');
  const numeric = (value: number) => Math.max(-1e12, Math.min(1e12, value));
  const reorderHelpId = useId();
  const orderKey = JSON.stringify(chart.axes.map(axis => axis.id));
  const latest = useRef({ chartId: chart.id, orderKey }); latest.current = { chartId: chart.id, orderKey };
  const rows = useRef(new Map<string, HTMLElement>()), handles = useRef(new Map<string, HTMLButtonElement>());
  const pendingInsertFocus = useRef<{ chartId: string; ids: Set<string> } | undefined>(undefined);
  type AxisDrag = { pointerId: number; axisId: string; chartId: string; orderKey: string; element: HTMLButtonElement };
  const axisDrag = useRef<AxisDrag | undefined>(undefined), dropBefore = useRef<string | null | undefined>(undefined);
  const [dropPreview, setDropPreview] = useState<{ axisId: string; beforeAxisId: string | null }>();
  const cancelAxisDrag = useCallback(() => {
    const active = axisDrag.current; axisDrag.current = undefined; dropBefore.current = undefined; setDropPreview(undefined);
    if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
  }, []);
  useLayoutEffect(() => {
    const active = axisDrag.current;
    if (active && (active.chartId !== chart.id || active.orderKey !== orderKey || tab !== 'axes')) cancelAxisDrag();
  }, [chart.id, orderKey, tab, cancelAxisDrag]);
  useLayoutEffect(() => {
    const request = pendingInsertFocus.current; if (!request) return;
    if (request.chartId !== chart.id) { pendingInsertFocus.current = undefined; return; }
    const added = chart.axes.filter(axis => !request.ids.has(axis.id));
    if (added.length === 1 && tab === 'axes') {
      const field = rows.current.get(added[0].id)?.querySelector('input'); field?.focus(); field?.select(); pendingInsertFocus.current = undefined;
    } else if (added.length > 1) pendingInsertFocus.current = undefined;
  }, [chart.id, chart.axes, tab]);
  const insertAxis = (beforeAxisId: string) => {
    const captured = { chartId: chart.id, orderKey };
    pendingInsertFocus.current = { chartId: chart.id, ids: new Set(chart.axes.map(axis => axis.id)) }; setTab('axes');
    update(current => {
      if (current.id !== captured.chartId || JSON.stringify(current.axes.map(axis => axis.id)) !== captured.orderKey) { pendingInsertFocus.current = undefined; return current; }
      return insertRadarAxis(current, String(current.axes.length + 1), beforeAxisId);
    });
  };
  const reorder = (axisId: string, beforeAxisId: string | null, captured = latest.current) => update(current =>
    current.id === captured.chartId && JSON.stringify(current.axes.map(axis => axis.id)) === captured.orderKey ? moveRadarAxis(current, axisId, beforeAxisId) : current);
  const startAxisDrag = (event: React.PointerEvent<HTMLButtonElement>, axisId: string) => {
    if (event.button !== 0) return;
    cancelAxisDrag(); event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    axisDrag.current = { pointerId: event.pointerId, axisId, chartId: chart.id, orderKey, element: event.currentTarget }; dropBefore.current = axisId;
  };
  const previewAxisDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = axisDrag.current; if (!active || active.pointerId !== event.pointerId) return;
    if (active.chartId !== latest.current.chartId || active.orderKey !== latest.current.orderKey) { cancelAxisDrag(); return; }
    let closest = active.axisId, distance = Number.POSITIVE_INFINITY;
    for (const axis of chart.axes) {
      const bounds = handles.current.get(axis.id)?.getBoundingClientRect(); if (!bounds?.height) continue;
      const delta = Math.abs(event.clientY - bounds.top - bounds.height / 2); if (delta < distance) { closest = axis.id; distance = delta; }
    }
    const from = chart.axes.findIndex(axis => axis.id === active.axisId), to = chart.axes.findIndex(axis => axis.id === closest);
    const beforeAxisId = to > from ? chart.axes[to + 1]?.id ?? null : closest;
    dropBefore.current = beforeAxisId;
    setDropPreview(closest === active.axisId ? undefined : { axisId: active.axisId, beforeAxisId });
  };
  const finishAxisDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = axisDrag.current, beforeAxisId = dropBefore.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const current = latest.current, valid = active.chartId === current.chartId && active.orderKey === current.orderKey;
    cancelAxisDrag();
    if (valid && beforeAxisId !== undefined && beforeAxisId !== active.axisId) reorder(active.axisId, beforeAxisId, current);
  };
  const axisKey = (event: React.KeyboardEvent<HTMLButtonElement>, axisId: string) => {
    if (event.key === 'Escape' && axisDrag.current) { event.preventDefault(); cancelAxisDrag(); return; }
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); cancelAxisDrag();
    const index = chart.axes.findIndex(axis => axis.id === axisId);
    if (event.key === 'ArrowUp' && index > 0) reorder(axisId, chart.axes[index - 1].id);
    if (event.key === 'ArrowDown' && index >= 0 && index < chart.axes.length - 1) reorder(axisId, chart.axes[index + 2]?.id ?? null);
  };
  const move = (id: string, direction: number) => update(current => { const axes = [...current.axes], index = axes.findIndex(axis => axis.id === id), next = index + direction; if (next < 0 || next >= axes.length) return current; [axes[index], axes[next]] = [axes[next], axes[index]]; return { ...current, axes }; });
  return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
    <section aria-label={c.preview} className="min-w-0 rounded-xl border border-border bg-surface p-3 xl:sticky xl:top-0"><RadarGraphic chart={chart} series={resolved} locale={locale} onInsertAxis={insertAxis} onValue={(seriesId, axisId, value, restore) => update(current => restore ? { ...current, series: current.series.map(item => item.id === seriesId ? { ...item, values: { ...item.values, [axisId]: value } } : item) } : setRadarValue(current, seriesId, axisId, value))} />
      <div className="flex flex-wrap gap-3 px-2 pb-3">{resolved.map(item => <label key={item.source.id} className="flex items-center gap-2 break-words text-sm text-text-primary"><input type="checkbox" aria-label={`${c.visible} · ${item.name}`} checked={item.source.visible !== false} onChange={event => update(current => ({ ...current, series: current.series.map(series => series.id === item.source.id ? { ...series, visible: event.target.checked } : series) }))} /><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.source.color }} />{item.name}</label>)}</div>
      <details className="border-t border-border p-2"><summary className="cursor-pointer py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold">{c.table}</summary><div className="max-w-full overflow-x-auto"><table className="w-full text-sm text-text-primary"><thead><tr><th className="p-2 text-left">{c.compare}</th>{resolved.map(item => <th className="p-2 text-left" key={item.source.id}>{item.name}</th>)}</tr></thead><tbody>{chart.axes.map(axis => <tr key={axis.id}><th scope="row" className="p-2 text-left font-normal">{axis.label} ({axis.min}…{axis.max} {axis.unit})</th>{resolved.map(item => <td key={item.source.id} className="p-2 tabular-nums">{item.values[axis.id]} {axis.unit}{item.issues[axis.id] && <span className="block text-xs text-accent-gold">{c[item.issues[axis.id]]}</span>}</td>)}</tr>)}</tbody></table></div></details>
    </section>
    <section className="min-w-0 space-y-4"><div className="flex gap-2" aria-label={c.title}><button className={button} aria-pressed={tab === 'series'} onClick={() => setTab('series')}>{c.series}</button><button className={button} aria-pressed={tab === 'axes'} onClick={() => setTab('axes')}>{c.axes}</button></div>
      {tab === 'axes' ? <><p className="max-w-prose text-sm text-text-muted">{c.axisHelp}</p><p id={reorderHelpId} className="max-w-prose text-sm text-text-muted">{c.reorderHelp}</p><output aria-live="polite" className="block min-h-5 text-sm text-text-muted">{dropPreview ? dropPreview.beforeAxisId === null ? c.dropAtEnd : `${c.dropBefore} · ${chart.axes.find(axis => axis.id === dropPreview.beforeAxisId)?.label ?? ""}` : ""}</output>{chart.axes.map((axis, index) => <article key={axis.id} ref={node => { if (node) rows.current.set(axis.id, node); else rows.current.delete(axis.id); }} className={`space-y-3 rounded-lg border border-border p-3 ${dropPreview?.beforeAxisId === axis.id ? 'outline-1 outline-accent-gold' : ''}`}><div className="flex items-end gap-2"><button type="button" ref={node => { if (node) handles.current.set(axis.id, node); else handles.current.delete(axis.id); }} className={`${button} shrink-0 cursor-grab active:cursor-grabbing`} style={{ touchAction: 'none' }} aria-label={`${c.reorderAxis} · ${axis.label || index + 1}`} aria-describedby={reorderHelpId} title={c.reorderHelp} onPointerDown={event => startAxisDrag(event, axis.id)} onPointerMove={previewAxisDrag} onPointerUp={finishAxisDrag} onPointerCancel={cancelAxisDrag} onLostPointerCapture={cancelAxisDrag} onKeyDown={event => axisKey(event, axis.id)}><GripVertical size={16} aria-hidden="true" /></button><div className="min-w-0 flex-1"><Field label={c.label}><input className={input} aria-label={`${c.label} · ${index + 1}`} maxLength={100} value={axis.label} onChange={event => update(current => ({ ...current, axes: current.axes.map(item => item.id === axis.id ? { ...item, label: event.target.value } : item) }))} /></Field></div><button className={button} disabled={index === 0} aria-label={`${c.up} · ${index + 1}`} onClick={() => move(axis.id, -1)}><ArrowUp size={15} /></button><button className={button} disabled={index === chart.axes.length - 1} aria-label={`${c.down} · ${index + 1}`} onClick={() => move(axis.id, 1)}><ArrowDown size={15} /></button><button className={button} disabled={chart.axes.length <= 3} aria-label={`${c.remove} · ${axis.label}`} onClick={() => confirm(`${c.remove}: ${axis.label}?`, () => update(current => removeRadarAxis(current, axis.id)))}><Trash2 size={15} /></button></div>
        <div className="grid grid-cols-3 gap-3"><NumberField label={`${c.min} · ${index + 1}`} value={axis.min} onChange={value => update(current => ({ ...current, axes: current.axes.map(item => item.id === axis.id ? { ...item, min: numeric(value) } : item) }))} /><NumberField label={`${c.max} · ${index + 1}`} value={axis.max} onChange={value => update(current => ({ ...current, axes: current.axes.map(item => item.id === axis.id ? { ...item, max: numeric(value) } : item) }))} /><Field label={c.unit}><input className={input} aria-label={`${c.unit} · ${index + 1}`} maxLength={40} value={axis.unit} onChange={event => update(current => ({ ...current, axes: current.axes.map(item => item.id === axis.id ? { ...item, unit: event.target.value } : item) }))} /></Field></div>
        <div className="flex flex-wrap items-end gap-4"><div className="min-w-0 flex-1"><NumberField label={`${locale === 'es' ? 'Paso' : 'Step'} · ${index + 1}`} value={axis.step ?? radarStep(axis)} min={0} onChange={value => { update(current => ({ ...current, axes: current.axes.map(item => item.id === axis.id ? { ...item, step: value } : item) })); }} /></div><label className="space-y-1 text-sm text-text-muted">{locale === 'es' ? 'Color del eje' : 'Axis color'}<input type="color" className="block h-10 w-14 rounded border border-border bg-deep" aria-label={`${locale === 'es' ? 'Color del eje' : 'Axis color'} · ${index + 1}`} value={axis.color ?? '#c4973b'} onChange={event => update(current => ({ ...current, axes: current.axes.map(item => item.id === axis.id ? { ...item, color: event.target.value } : item) }))} /></label><div className="space-y-1" data-radar-axis-icon={axis.id}><span className="block text-sm text-text-muted">{locale === 'es' ? 'Icono del eje' : 'Axis icon'}</span><IconPicker value={axis.icon} color={axis.color} size="sm" onChange={icon => update(current => ({ ...current, axes: current.axes.map(item => item.id === axis.id ? { ...item, icon: icon || undefined } : item) }))} /></div><button type="button" className={button} onClick={() => update(current => ({ ...current, axes: current.axes.map(item => item.id === axis.id ? { ...item, icon: undefined, color: undefined, step: undefined } : item) }))}>{locale === 'es' ? 'Restablecer estilo y paso' : 'Reset style and step'}</button></div>
      </article>)}<button className={button} disabled={chart.axes.length >= MAX_RADAR_AXES} onClick={() => update(current => addRadarAxis(current, String(current.axes.length + 1)))}><Plus size={16} />{c.addAxis}</button></> : <><p className="max-w-prose text-sm text-text-muted">{c.bindingHelp}</p>{chart.series.map((series, index) => { const source = entries.find(entry => entry.id === series.linkedEntryId), live = resolved.find(item => item.source.id === series.id)!; return <article key={series.id} className="space-y-3 rounded-lg border border-border p-3"><div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Field label={c.seriesName}><input className={input} aria-label={`${c.seriesName} · ${index + 1}`} maxLength={200} placeholder={source?.title ?? ''} value={series.name} onChange={event => update(current => ({ ...current, series: current.series.map(item => item.id === series.id ? { ...item, name: event.target.value } : item) }))} /></Field></div><label className="space-y-1 text-xs text-text-muted">{c.color}<input type="color" aria-label={`${c.color} · ${index + 1}`} className="block h-10 w-12 rounded border border-border bg-deep" value={series.color} onChange={event => update(current => ({ ...current, series: current.series.map(item => item.id === series.id ? { ...item, color: event.target.value } : item) }))} /></label><button className={button} aria-label={`${c.remove} · ${live.name}`} onClick={() => confirm(`${c.remove}: ${live.name}?`, () => update(current => ({ ...current, series: current.series.filter(item => item.id !== series.id) })))}><Trash2 size={15} /></button></div>
        <p className="text-xs text-text-muted">{c.nameHelp}</p><Field label={c.codex}><select className={input} aria-label={`${c.codex} · ${index + 1}`} value={series.linkedEntryId ?? ''} onChange={event => update(current => ({ ...current, series: current.series.map(item => item.id === series.id ? { ...item, linkedEntryId: event.target.value || undefined } : item) }))}><option value="">{c.none}</option>{series.linkedEntryId && !source && <option value={series.linkedEntryId}>{c.missing}</option>}{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></Field>
        {source && <Link className="inline-block text-sm text-accent-gold underline underline-offset-4" to={`/project/${encodeURIComponent(source.projectId)}/codex?entry=${encodeURIComponent(source.id)}`}>{locale === 'es' ? 'Abrir ficha' : 'Open Codex entry'} · {source.title}</Link>}
        {live.missingEntry && <p className="text-xs text-accent-gold">{c.missing}</p>}
        {chart.axes.map(axis => <div key={axis.id} className="space-y-2 rounded border border-border p-3"><p className="break-words text-sm text-text-primary">{axis.label} · {axis.min}…{axis.max} {axis.unit}</p><div className="grid gap-3 sm:grid-cols-2"><NumberField label={`${c.manual} · ${index + 1} · ${axis.label}`} value={series.values[axis.id]} onChange={value => update(current => ({ ...current, series: current.series.map(item => item.id === series.id ? { ...item, values: { ...item.values, [axis.id]: numeric(value) } } : item) }))} /><Field label={c.binding}><input className={input} list={`radar-fields-${series.id}-${axis.id}`} aria-label={`${c.binding} · ${index + 1} · ${axis.label}`} maxLength={200} value={series.bindings?.[axis.id] ?? ''} onChange={event => update(current => ({ ...current, series: current.series.map(item => item.id === series.id ? { ...item, bindings: { ...item.bindings, [axis.id]: event.target.value } } : item) }))} /><datalist id={`radar-fields-${series.id}-${axis.id}`}>{Object.keys(source?.fields ?? {}).slice(0, 100).map(key => <option key={key} value={key} />)}</datalist></Field></div><output className="block text-sm text-text-primary">{live.values[axis.id]} {axis.unit}{series.bindings?.[axis.id] && <span className="ml-2 text-xs text-text-muted">{locale === 'es' ? 'Solo lectura en el gráfico · origen Codex' : 'Read-only in chart · Codex source'}</span>}</output>{live.issues[axis.id] && <p className="text-xs text-accent-gold">{c[live.issues[axis.id]]}</p>}</div>)}
      </article>; })}{!chart.series.length && <p className="text-sm text-text-muted">{c.noSeries}</p>}<button className={button} disabled={chart.series.length >= MAX_RADAR_SERIES} onClick={() => update(current => ({ ...current, series: [...current.series, { id: crypto.randomUUID(), name: `${current.series.length + 1}`, color: RADAR_COLORS[current.series.length % RADAR_COLORS.length], values: Object.fromEntries(current.axes.map(axis => [axis.id, axis.min])) }] }))}><Plus size={16} />{c.addSeries}</button></>}
    </section>
  </div>;
}
