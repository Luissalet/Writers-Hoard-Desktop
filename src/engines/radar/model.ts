import type { RadarAxis, RadarChartDocument, RadarSeries } from './types';
import { radarCoordinate } from '@/utils/radar';
export const RADAR_COLORS = ['#c4973b', '#6ba88a', '#81a8d3', '#c77870', '#b596ca', '#b5b974', '#e8ab73', '#80bdc7'];
export const MAX_RADAR_AXES = 24, MAX_RADAR_SERIES = 32;
const bounded = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
export function createRadarChart(title = ''): RadarChartDocument {
  const axes = ['A', 'B', 'C', 'D', 'E'].map(label => ({ id: crypto.randomUUID(), label, min: 0, max: 10, unit: '' })), now = Date.now();
  return { id: crypto.randomUUID(), title, description: '', axes, series: [{ id: crypto.randomUUID(), name: 'A', color: RADAR_COLORS[0], values: Object.fromEntries(axes.map(axis => [axis.id, 5])) }], revision: 0, createdAt: now, updatedAt: now };
}
export function validateRadarChart(value: unknown, allowInvalidRanges = false): asserts value is RadarChartDocument {
  const fail = () => { throw new Error('radar_invalid'); };
  if (!record(value) || !text(value.id, 500) || !value.id || !text(value.title, 300) || !text(value.description, 50000)) return fail();
  for (const key of ['revision', 'createdAt', 'updatedAt']) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) return fail();
  if (!Array.isArray(value.axes) || value.axes.length < 3 || value.axes.length > MAX_RADAR_AXES || !Array.isArray(value.series) || value.series.length > MAX_RADAR_SERIES) return fail();
  const axisIds = new Set<string>();
  for (const axis of value.axes) { if (!record(axis) || !text(axis.id, 500) || !axis.id || axisIds.has(axis.id) || !text(axis.label, 100) || !text(axis.unit, 40) || !bounded(axis.min) || !bounded(axis.max) || !allowInvalidRanges && axis.min >= axis.max) return fail(); axisIds.add(axis.id); }
  const seriesIds = new Set<string>();
  for (const series of value.series) {
    if (!record(series) || !text(series.id, 500) || !series.id || seriesIds.has(series.id) || !text(series.name, 200) || typeof series.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(series.color) || !record(series.values) || series.visible !== undefined && typeof series.visible !== 'boolean' || series.linkedEntryId !== undefined && !text(series.linkedEntryId, 500)) return fail();
    seriesIds.add(series.id);
    if (Object.keys(series.values).length !== axisIds.size || Object.entries(series.values).some(([key, cell]) => !axisIds.has(key) || !bounded(cell))) return fail();
    if (series.bindings !== undefined && (!record(series.bindings) || Object.entries(series.bindings).some(([key, field]) => !axisIds.has(key) || !text(field, 200)))) return fail();
  }
}
export function normalizedRadarValue(axis: RadarAxis, value: number): number { if (!bounded(value) || !bounded(axis.min) || !bounded(axis.max) || axis.max <= axis.min) return 0; return Math.max(0, Math.min(1, (value - axis.min) / (axis.max - axis.min))); }
export function radarPoint(index: number, count: number, fraction: number, radius = 210): { x: number; y: number } { return radarCoordinate(index, count, fraction, 360, 300, radius); }
export interface RadarEntry { id: string; projectId: string; title: string; fields: Record<string, string> }
export interface ResolvedRadarSeries { source: RadarSeries; name: string; values: Record<string, number>; missingEntry: boolean; issues: Record<string, 'missing' | 'invalid' | 'outside'> }
export function resolveRadarSeries(series: RadarSeries, axes: RadarAxis[], entries: readonly RadarEntry[], projectId: string): ResolvedRadarSeries {
  const entry = series.linkedEntryId ? entries.find(item => item.id === series.linkedEntryId && item.projectId === projectId) : undefined;
  const values = { ...series.values }, issues: ResolvedRadarSeries['issues'] = Object.create(null);
  for (const axis of axes) {
    const field = Object.hasOwn(series.bindings ?? {}, axis.id) ? series.bindings![axis.id] : undefined;
    if (field) { const raw = entry && Object.hasOwn(entry.fields, field) ? entry.fields[field] : undefined; const numeric = typeof raw === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) ? Number(raw.trim()) : NaN;
      if (bounded(numeric)) values[axis.id] = numeric; else issues[axis.id] = raw === undefined || raw === '' ? 'missing' : 'invalid';
    }
    if (!issues[axis.id] && (values[axis.id] < axis.min || values[axis.id] > axis.max)) issues[axis.id] = 'outside';
  }
  return { source: series, name: series.name || entry?.title || '—', values, issues, missingEntry: Boolean(series.linkedEntryId && !entry) };
}
export function addRadarAxis(chart: RadarChartDocument, label: string): RadarChartDocument {
  if (chart.axes.length >= MAX_RADAR_AXES) throw new Error('radar_axis_limit'); const axis = { id: crypto.randomUUID(), label, min: 0, max: 10, unit: '' };
  return { ...chart, axes: [...chart.axes, axis], series: chart.series.map(series => ({ ...series, values: { ...series.values, [axis.id]: 0 } })) };
}
export function removeRadarAxis(chart: RadarChartDocument, id: string): RadarChartDocument {
  if (chart.axes.length <= 3) throw new Error('radar_axis_minimum');
  return { ...chart, axes: chart.axes.filter(axis => axis.id !== id), series: chart.series.map(series => { const values = { ...series.values }, bindings = { ...series.bindings }; delete values[id]; delete bindings[id]; return { ...series, values, bindings }; }) };
}
