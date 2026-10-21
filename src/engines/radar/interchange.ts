import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { curatedProjectIconCatalog, loadFullProjectIconCatalog } from '@/components/common/projectIconCatalog';
import type { ProjectIconCatalog } from '@/components/common/fullLucideIconCatalog';
import type { RadarChartDocument } from './types';
import { createRadarChart, RADAR_COLORS, MAX_RADAR_AXES, MAX_RADAR_SERIES, radarPoint, normalizedRadarValue, radarNotches, validateRadarChart, type ResolvedRadarSeries } from './model';
export function exportRadarJson(chart: RadarChartDocument): string { validateRadarChart(chart); return JSON.stringify({ format: 'writers-hoard-radar-chart', version: 1, chart }, null, 2); }
export function parseRadarJson(text: string): RadarChartDocument {
  if (text.length > 8_000_000) throw new Error('radar_import_limit'); const parsed = JSON.parse(text) as { format?: string; version?: number; chart?: unknown };
  if (parsed?.format !== 'writers-hoard-radar-chart' || parsed.version !== 1) throw new Error('radar_import_format'); validateRadarChart(parsed.chart);
  return { ...structuredClone(parsed.chart), id: crypto.randomUUID(), revision: 0, createdAt: Date.now(), updatedAt: Date.now() };
}
const quote = (value: string, numeric = false) => { if (!numeric && /^[\s]*[=+@-]/.test(value)) value = '\t' + value; return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value; };
export function exportRadarCsv(chart: RadarChartDocument, resolved?: ResolvedRadarSeries[]): string {
  validateRadarChart(chart); const series = resolved ?? chart.series.map(source => ({ source, name: source.name, values: source.values }));
  return [['axis', 'min', 'max', 'unit', 'step', 'icon', 'color', ...series.map(item => `series:${item.name}`)].map(value => quote(value)).join(','), ...chart.axes.map(axis => [quote(axis.label), quote(String(axis.min), true), quote(String(axis.max), true), quote(axis.unit), quote(axis.step === undefined ? '' : String(axis.step), true), quote(axis.icon ?? ''), quote(axis.color ?? ''), ...series.map(item => quote(String(item.values[axis.id]), true))].join(','))].join('\r\n');
}
export function parseRadarCsv(text: string, title = ''): RadarChartDocument {
  if (text.length > 8_000_000) throw new Error('radar_import_limit');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) { const char = source[index];
    if (quoted) { if (char === '"') { if (source[index + 1] === '"') { cell += '"'; index++; } else { quoted = false; closed = true; } } else cell += char; }
    else if (char === '"') { if (cell || closed) throw new Error('radar_csv_quote'); quoted = true; }
    else if (char === ',' || char === '\n' || char === '\r') { row.push(cell); cell = ''; closed = false; if (char !== ',') { rows.push(row); row = []; if (char === '\r' && source[index + 1] === '\n') index++; } }
    else { if (closed) throw new Error('radar_csv_quote'); cell += char; }
    if (rows.length > MAX_RADAR_AXES + 2 || row.length > MAX_RADAR_SERIES + 7 || cell.length > 10000) throw new Error('radar_import_limit');
  }
  if (quoted) throw new Error('radar_csv_quote'); if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift(), offset = header?.slice(4, 7).join(',') === 'step,icon,color' ? 7 : 4; if (!header || header.slice(0, 4).join(',') !== 'axis,min,max,unit' || header.length < 4 || header.length > MAX_RADAR_SERIES + offset || !header.slice(offset).every(value => value.startsWith('series:'))) throw new Error('radar_csv_header');
  if (rows.length < 3 || rows.length > MAX_RADAR_AXES || rows.some(value => value.length !== header.length)) throw new Error('radar_csv_shape');
  const chart = createRadarChart(title); chart.axes = rows.map(value => ({ id: crypto.randomUUID(), label: value[0].replace(/^\t/, ''), min: value[1].trim() ? Number(value[1]) : NaN, max: value[2].trim() ? Number(value[2]) : NaN, unit: value[3].replace(/^\t/, ''), ...(offset === 7 ? { step: value[4].trim() ? Number(value[4]) : undefined, icon: value[5] || undefined, color: value[6] || undefined } : {}) }));
  chart.series = header.slice(offset).map((name, column) => ({ id: crypto.randomUUID(), name: name.slice(7), color: RADAR_COLORS[column % RADAR_COLORS.length], values: Object.fromEntries(chart.axes.map((axis, index) => [axis.id, rows[index][column + offset].trim() ? Number(rows[index][column + offset]) : NaN])) }));
  validateRadarChart(chart); return chart;
}
const xml = (value: string) => Array.from(value).filter(char => { const code = char.codePointAt(0)!; return (code >= 32 || [9, 10, 13].includes(code)) && code !== 65534 && code !== 65535; }).join('').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
export function exportRadarSvg(chart: RadarChartDocument, resolved?: ResolvedRadarSeries[], icons: ProjectIconCatalog = curatedProjectIconCatalog): string {
  validateRadarChart(chart); const series = (resolved ?? chart.series.map(source => ({ source, name: source.name, values: source.values }))).filter(item => item.source.visible !== false), height = 610 + Math.ceil(series.length / 3) * 28;
  const points = (fraction: number) => chart.axes.map((_, index) => { const p = radarPoint(index, chart.axes.length, fraction); return `${p.x},${p.y}`; }).join(' ');
  const rings = [0.2, 0.4, 0.6, 0.8, 1].map(fraction => `<polygon points="${points(fraction)}" fill="none" stroke="#666b6b" stroke-width="1"/>`).join('');
  const axes = chart.axes.map((axis, index) => { const p = radarPoint(index, chart.axes.length, 1), label = radarPoint(index, chart.axes.length, 1, 255); const color = axis.color ?? '#e8e6e2'; const Icon = axis.icon ? icons[axis.icon] : undefined; const icon = Icon ? renderToStaticMarkup(createElement(Icon, { x: label.x - 10, y: label.y - 38, width: 20, height: 20, color })) : axis.icon ? `<title>${xml(axis.icon)}</title>` : ''; const notches = radarNotches(axis).map(fraction => { const tick = radarPoint(index, chart.axes.length, fraction), dx = (p.y - 300) / 210 * 4, dy = -(p.x - 360) / 210 * 4; return `<line x1="${tick.x - dx}" y1="${tick.y - dy}" x2="${tick.x + dx}" y2="${tick.y + dy}" stroke="${color}"/>`; }).join(''); return `<g data-axis-icon="${xml(axis.icon ?? '')}">${icon}${notches}<line x1="360" y1="300" x2="${p.x}" y2="${p.y}" stroke="${color}"/><text x="${label.x}" y="${label.y}" text-anchor="middle" fill="${color}" font-size="13">${xml(axis.label.slice(0, 32))}</text><text x="${label.x}" y="${label.y + 17}" text-anchor="middle" fill="#b7b9b9" font-size="11">${xml(`${axis.min}…${axis.max} ${axis.unit}`)}</text></g>`; }).join('');
  const polygons = series.map(item => `<polygon points="${chart.axes.map((axis, index) => { const p = radarPoint(index, chart.axes.length, normalizedRadarValue(axis, item.values[axis.id])); return `${p.x},${p.y}`; }).join(' ')}" fill="${item.source.color}" fill-opacity="0.12" stroke="${item.source.color}" stroke-width="2"/>`).join('');
  const legend = series.map((item, index) => `<rect x="${25 + index % 3 * 235}" y="${590 + Math.floor(index / 3) * 28}" width="12" height="12" fill="${item.source.color}"/><text x="${45 + index % 3 * 235}" y="${601 + Math.floor(index / 3) * 28}" fill="#e8e6e2" font-size="12">${xml(item.name.slice(0, 28))}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 ${height}" role="img"><title>${xml(chart.title)}</title><desc>${xml(chart.description)}</desc><rect width="720" height="${height}" fill="#191b1b"/><text x="360" y="25" text-anchor="middle" fill="#e8e6e2" font-size="20">${xml(chart.title.slice(0, 70))}</text>${rings}${axes}${polygons}${legend}</svg>`;
}

/** Normal UI/API export resolves the entire local Lucide catalogue before writing SVG. */
export async function exportRadarSvgComplete(chart: RadarChartDocument, resolved?: ResolvedRadarSeries[]): Promise<string> { return exportRadarSvg(chart, resolved, await loadFullProjectIconCatalog()); }
