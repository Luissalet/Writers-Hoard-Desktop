import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { ProjectIcon } from '@/components/common/ProjectIcon';
import type { RadarChartDocument } from './types';
import { normalizedRadarValue, radarPoint, radarStep, radarNotches, radarValueAtPoint, snapRadarValue, type ResolvedRadarSeries } from './model';
import { playRadarNotch, radarAudioEnabled, setRadarAudioEnabled, RADAR_AUDIO_CHANGED } from './audio';
export default function RadarGraphic({ chart, series, onValue, locale = 'en' }: { chart: RadarChartDocument; series: ResolvedRadarSeries[]; onValue?: (seriesId: string, axisId: string, value: number, restore?: boolean) => void; locale?: 'en' | 'es' }) {
  const es = locale === 'es', svg = useRef<SVGSVGElement>(null), context = useRef<AudioContext | undefined>(undefined);
  const [sound, setSound] = useState(radarAudioEnabled), [announcement, setAnnouncement] = useState('');
  const [editingSeries, setEditingSeries] = useState('');
  const editableSeries = series.filter(item => item.source.visible !== false), selectedSeries = editableSeries.find(item => item.source.id === editingSeries)?.source.id ?? editableSeries[0]?.source.id;
  const drag = useRef<{ pointerId: number; seriesId: string; axisId: string; initial: number; last: number } | undefined>(undefined);
  useEffect(() => { const refresh = () => setSound(radarAudioEnabled()); window.addEventListener(RADAR_AUDIO_CHANGED, refresh); return () => { window.removeEventListener(RADAR_AUDIO_CHANGED, refresh); void context.current?.close(); }; }, []);
  const tick = (fraction: number) => { if (!sound) return; try { context.current ??= new AudioContext(); void context.current.resume(); playRadarNotch(context.current, fraction); } catch { /* A device without audio remains fully editable. */ } };
  const points = (fraction: number) => chart.axes.map((_, index) => { const p = radarPoint(index, chart.axes.length, fraction); return `${p.x},${p.y}`; }).join(' ');
  const plot = <>
    {[0.2, 0.4, 0.6, 0.8, 1].map(fraction => <polygon key={fraction} points={points(fraction)} fill="none" stroke="currentColor" opacity=".35" />)}
    {chart.axes.map((axis, index) => { const p = radarPoint(index, chart.axes.length, 1), label = radarPoint(index, chart.axes.length, 1, 255); return <g key={axis.id}>{radarNotches(axis).map(fraction => { const tick = radarPoint(index, chart.axes.length, fraction), dx = (p.y - 300) / 210 * 4, dy = -(p.x - 360) / 210 * 4; return <line key={fraction} x1={tick.x - dx} y1={tick.y - dy} x2={tick.x + dx} y2={tick.y + dy} stroke={axis.color ?? 'currentColor'} opacity=".6" />; })}<line x1="360" y1="300" x2={p.x} y2={p.y} stroke={axis.color ?? 'currentColor'} opacity=".7" />{axis.icon && <ProjectIcon name={axis.icon} x={label.x - 10} y={label.y - 38} width={20} height={20} color={axis.color ?? 'currentColor'} aria-hidden="true" />}<text x={label.x} y={label.y} textAnchor="middle" fill={axis.color ?? 'currentColor'} fontSize="17">{axis.label.slice(0, 24)}</text><text x={label.x} y={label.y + 20} textAnchor="middle" fill="currentColor" fontSize="13">{axis.min}…{axis.max} {axis.unit}</text></g>; })}
    {series.filter(item => item.source.visible !== false).map(item => <g key={item.source.id}><polygon points={chart.axes.map((axis, index) => { const p = radarPoint(index, chart.axes.length, normalizedRadarValue(axis, item.values[axis.id])); return `${p.x},${p.y}`; }).join(' ')} fill={item.source.color} fillOpacity=".12" stroke={item.source.color} strokeWidth="3" />{!onValue && chart.axes.map((axis, index) => { const p = radarPoint(index, chart.axes.length, normalizedRadarValue(axis, item.values[axis.id])); return <circle key={axis.id} cx={p.x} cy={p.y} r="4" fill={item.source.color}><title>{item.name}: {axis.label} = {item.values[axis.id]} {axis.unit}</title></circle>; })}</g>)}
  </>;
  return <div className="min-w-0">
    {onValue && <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-xs text-text-muted"><p className="max-w-prose">{es ? 'Arrastra un vértice. Con el foco: flechas, Inicio/Fin y Mayús para pasos mayores. Los valores del Codex son de solo lectura.' : 'Drag a vertex. When focused: arrows, Home/End and Shift for larger steps. Codex values are read-only.'}</p><button type="button" aria-pressed={sound} className="flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold" onClick={() => { setSound(!sound); setRadarAudioEnabled(!sound); }}>{sound ? <Volume2 size={15} /> : <VolumeX size={15} />}{es ? sound ? 'Sonido activado' : 'Sonido silenciado' : sound ? 'Sound on' : 'Sound muted'}</button></div>}
    <svg ref={svg} viewBox="0 0 720 610" role={onValue ? 'group' : 'img'} aria-label={chart.title || 'Radar'} className="max-h-128 w-full text-text-muted" style={{ touchAction: onValue ? 'none' : undefined }}>
      {onValue ? <svg viewBox="0 0 720 610" width="720" height="610" role="img" aria-label={chart.title || 'Radar'}>{plot}</svg> : plot}
      {onValue && series.filter(item => item.source.visible !== false).flatMap(item => chart.axes.map((axis, index) => {
        const current = item.values[axis.id], p = radarPoint(index, chart.axes.length, normalizedRadarValue(axis, current));
        const readonly = Boolean(item.source.bindings?.[axis.id]) || axis.max <= axis.min;
        const label = `${item.name} · ${axis.label}`, hint = readonly ? es ? 'Origen Codex: solo lectura. Desvincula el campo para editar el valor manual.' : 'Codex source: read-only. Unbind the field to edit the manual value.' : es ? 'Arrastra o usa las flechas para cambiar el valor.' : 'Drag or use arrow keys to change the value.';
        const change = (value: number) => { const next = snapRadarValue(axis, value); onValue(item.source.id, axis.id, next); if (next !== current) tick(normalizedRadarValue(axis, next)); setAnnouncement(`${label}: ${next} ${axis.unit}`); return next; };
        const pointerValue = (event: React.PointerEvent<SVGCircleElement>) => {
          const matrix = svg.current?.getScreenCTM(); if (!matrix) return current;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          return radarValueAtPoint(axis, index, chart.axes.length, point.x, point.y);
        };
        return <circle key={`${item.source.id}:${axis.id}`} data-radar-handle={`${item.source.id}:${axis.id}`} cx={p.x} cy={p.y} r={item.source.id === selectedSeries ? 10 : 5} fill={readonly ? 'var(--color-deep)' : item.source.color} stroke={item.source.color} strokeWidth={readonly ? 3 : 2} tabIndex={0} role="slider" aria-label={label} aria-valuemin={axis.min} aria-valuemax={axis.max} aria-valuenow={Math.max(axis.min, Math.min(axis.max, current))} aria-valuetext={`${current} ${axis.unit}${current < axis.min || current > axis.max ? es ? ' · fuera de escala' : ' · outside scale' : ''}${readonly ? es ? ' · solo lectura Codex' : ' · read-only Codex' : ''}`} aria-disabled={readonly} pointerEvents={item.source.id === selectedSeries ? 'all' : 'none'} onFocus={() => setEditingSeries(item.source.id)} className={`${readonly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} outline-none focus-visible:stroke-text-primary focus-visible:stroke-[4]`}
          onPointerDown={event => { if (readonly || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, seriesId: item.source.id, axisId: axis.id, initial: current, last: current }; }}
          onPointerMove={event => { const active = drag.current; if (readonly || active?.pointerId !== event.pointerId || active.seriesId !== item.source.id || active.axisId !== axis.id) return; const next = pointerValue(event); if (next !== active.last) { active.last = next; change(next); } }}
          onPointerUp={event => { if (drag.current?.pointerId !== event.pointerId) return; drag.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={event => { const active = drag.current; if (active?.pointerId === event.pointerId) { if (!readonly) onValue(item.source.id, axis.id, active.initial, true); drag.current = undefined; } }}
          onLostPointerCapture={() => { drag.current = undefined; }}
          onKeyDown={event => {
            if (readonly) return;
            if (event.key === 'Escape' && drag.current) { event.preventDefault(); const active = drag.current; onValue(item.source.id, axis.id, active.initial, true); drag.current = undefined; if (event.currentTarget.hasPointerCapture(active.pointerId)) event.currentTarget.releasePointerCapture(active.pointerId); return; }
            const direction = ['ArrowUp', 'ArrowRight', 'PageUp'].includes(event.key) ? 1 : ['ArrowDown', 'ArrowLeft', 'PageDown'].includes(event.key) ? -1 : 0;
            if (!direction && event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault(); change(event.key === 'Home' ? axis.min : event.key === 'End' ? axis.max : current + direction * radarStep(axis) * (event.shiftKey || event.key.startsWith('Page') ? 10 : 1));
          }}><title>{`${label}: ${current} ${axis.unit}. ${hint}`}</title></circle>;
      }))}
    </svg>
    {onValue && editableSeries.length > 1 && <label className="mx-2 mb-2 block text-sm text-text-muted">{es ? 'Serie para arrastrar' : 'Series to drag'}<select aria-label={es ? 'Serie para arrastrar' : 'Series to drag'} className="mt-1 w-full rounded-lg border border-border bg-deep px-3 py-2 text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold" value={selectedSeries} onChange={event => setEditingSeries(event.target.value)}>{editableSeries.map(item => <option key={item.source.id} value={item.source.id}>{item.name}</option>)}</select></label>}
    {onValue && <output aria-live="polite" className="sr-only">{announcement}</output>}
  </div>;
}
