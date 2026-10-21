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
  if (value.isPreset !== undefined && typeof value.isPreset !== 'boolean' || value.presetCategory !== undefined && !text(value.presetCategory, 200)) return fail();
  for (const key of ['revision', 'createdAt', 'updatedAt']) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) return fail();
  if (!Array.isArray(value.axes) || value.axes.length < 3 || value.axes.length > MAX_RADAR_AXES || !Array.isArray(value.series) || value.series.length > MAX_RADAR_SERIES) return fail();
  const axisIds = new Set<string>();
  for (const axis of value.axes) { if (!record(axis) || !text(axis.id, 500) || !axis.id || axisIds.has(axis.id) || !text(axis.label, 100) || !text(axis.unit, 40) || !bounded(axis.min) || !bounded(axis.max) || !allowInvalidRanges && axis.min >= axis.max || axis.step !== undefined && (typeof axis.step !== 'number' || !Number.isFinite(axis.step) || !allowInvalidRanges && axis.step <= 0) || axis.color !== undefined && (typeof axis.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(axis.color)) || axis.icon !== undefined && (typeof axis.icon !== 'string' || !/^[A-Z][A-Za-z0-9]{0,79}$/.test(axis.icon))) return fail(); axisIds.add(axis.id); }
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
export function radarStep(axis: RadarAxis): number { return axis.step !== undefined && axis.step > 0 ? axis.step : (axis.max - axis.min) / 100; }
export function radarNotches(axis: RadarAxis): number[] {
  const steps = (axis.max - axis.min) / radarStep(axis); if (!Number.isFinite(steps) || steps <= 0) return [];
  // Keep marks at least sixteen SVG units apart; this changes drawing density, not the allowed value or step.
  const stride = Math.max(1, Math.ceil(steps / (210 / 16))), marks: number[] = [];
  for (let index = stride; index < steps; index += stride) marks.push(index / steps);
  return marks;
}
export function snapRadarValue(axis: RadarAxis, value: number): number {
  if (!Number.isFinite(value) || axis.max <= axis.min) throw new Error('radar_invalid_value');
  const step = radarStep(axis), clamped = Math.max(axis.min, Math.min(axis.max, value));
  if (clamped === axis.max || clamped === axis.min) return clamped;
  if (!Number.isFinite((clamped - axis.min) / step)) return clamped;
  return Math.max(axis.min, Math.min(axis.max, Number((axis.min + Math.round((clamped - axis.min) / step) * step).toPrecision(14))));
}
/** Project any point onto the selected axis; cross-axis motion cannot change a different value. */
export function radarValueAtPoint(axis: RadarAxis, index: number, count: number, x: number, y: number): number {
  const end = radarPoint(index, count, 1), dx = end.x - 360, dy = end.y - 300;
  const fraction = ((x - 360) * dx + (y - 300) * dy) / (dx * dx + dy * dy);
  return snapRadarValue(axis, axis.min + fraction * (axis.max - axis.min));
}
export function setRadarValue(chart: RadarChartDocument, seriesId: string, axisId: string, value: number): RadarChartDocument {
  const axis = chart.axes.find(item => item.id === axisId), series = chart.series.find(item => item.id === seriesId);
  if (!axis || !series) throw new Error('radar_value_target_missing');
  if (series.bindings?.[axisId]) throw new Error('radar_bound_value_readonly');
  return { ...chart, series: chart.series.map(item => item.id === seriesId ? { ...item, values: { ...item.values, [axisId]: snapRadarValue(axis, value) } } : item) };
}
/** Copies within and between documents always receive their own nested identities. */
export function cloneRadarChart(chart: RadarChartDocument, title = chart.title, clearReferences = false): RadarChartDocument {
  const identities = new Map(chart.axes.map(axis => [axis.id, crypto.randomUUID()])), now = Date.now();
  return { ...structuredClone(chart), id: crypto.randomUUID(), title, revision: 0, createdAt: now, updatedAt: now, axes: chart.axes.map(axis => ({ ...axis, id: identities.get(axis.id)! })), series: chart.series.map(series => ({ ...structuredClone(series), id: crypto.randomUUID(), ...(clearReferences ? { linkedEntryId: undefined } : {}), values: Object.fromEntries(Object.entries(series.values).map(([id, value]) => [identities.get(id)!, value])), bindings: clearReferences ? undefined : Object.fromEntries(Object.entries(series.bindings ?? {}).map(([id, value]) => [identities.get(id)!, value])) })) };
}
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
