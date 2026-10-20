import type { RadarChartDocument } from './types';
import { normalizedRadarValue, radarPoint, type ResolvedRadarSeries } from './model';
export default function RadarGraphic({ chart, series }: { chart: RadarChartDocument; series: ResolvedRadarSeries[] }) {
  const points = (fraction: number) => chart.axes.map((_, index) => { const p = radarPoint(index, chart.axes.length, fraction); return `${p.x},${p.y}`; }).join(' ');
  return <svg viewBox="0 0 720 590" role="img" aria-label={chart.title || 'Radar'} className="max-h-128 w-full text-text-muted">
    {[0.2, 0.4, 0.6, 0.8, 1].map(fraction => <polygon key={fraction} points={points(fraction)} fill="none" stroke="currentColor" opacity=".35" />)}
    {chart.axes.map((axis, index) => { const p = radarPoint(index, chart.axes.length, 1), label = radarPoint(index, chart.axes.length, 1, 255); return <g key={axis.id}><line x1="360" y1="300" x2={p.x} y2={p.y} stroke="currentColor" opacity=".35" /><text x={label.x} y={label.y} textAnchor="middle" fill="currentColor" fontSize="17">{axis.label.slice(0, 24)}</text><text x={label.x} y={label.y + 20} textAnchor="middle" fill="currentColor" fontSize="13">{axis.min}…{axis.max} {axis.unit}</text></g>; })}
    {series.filter(item => item.source.visible !== false).map(item => <g key={item.source.id}><polygon points={chart.axes.map((axis, index) => { const p = radarPoint(index, chart.axes.length, normalizedRadarValue(axis, item.values[axis.id])); return `${p.x},${p.y}`; }).join(' ')} fill={item.source.color} fillOpacity=".12" stroke={item.source.color} strokeWidth="3" />{chart.axes.map((axis, index) => { const p = radarPoint(index, chart.axes.length, normalizedRadarValue(axis, item.values[axis.id])); return <circle key={axis.id} cx={p.x} cy={p.y} r="4" fill={item.source.color}><title>{item.name}: {axis.label} = {item.values[axis.id]} {axis.unit}</title></circle>; })}</g>)}
  </svg>;
}
