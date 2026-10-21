import { getEraProject, listEraRows, readEraRow } from '@/services/worldEras/store';
import type { CodexEntry } from '@/types';
import { projectCodexEntry } from '@/engines/codex/properties';
import { BridgeError, optBoolean, optString, requireString, resolveProjectForEngine, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { createRadarChart, resolveRadarSeries, setRadarValue } from './model';
import { saveRadarChart, deleteRadarChart } from './operations';
import { RADAR_SKELETONS, radarFromPreset, radarFromSkeleton } from './presets';
import { exportRadarCsv, exportRadarJson, exportRadarSvgComplete, parseRadarCsv, parseRadarJson } from './interchange';
import { radarAudioEnabled, setRadarAudioEnabled } from './audio';
import type { RadarChartDocument } from './types';
async function current(args: ToolArgs): Promise<{ projectId: string; chart: RadarChartDocument }> {
  const projectId = resolveProjectId(args), id = requireString(args, 'chartId');
  const chart = (await getEraProject({ projectId, eraId: optString(args, 'eraId') }))?.radarCharts?.find(item => item.id === id);
  if (!chart) throw new BridgeError('not-found', 'No radar chart with that ID exists in this project.');
  return { projectId, chart };
}
async function resolved(projectId: string, chart: RadarChartDocument, eraId?: string) {
  const project = await getEraProject({ projectId, eraId }), entries = (await listEraRows<CodexEntry>({ projectId, eraId }, 'codexEntries')).map(entry => ({ ...entry, fields: projectCodexEntry(entry, project?.codexTemplates ?? []).fields }));
  return chart.series.map(series => resolveRadarSeries(series, chart.axes, entries, projectId));
}
function revision(args: ToolArgs): number { if (typeof args.expectedRevision !== 'number' || !Number.isSafeInteger(args.expectedRevision)) throw new BridgeError('bad-args', 'Read the current expectedRevision before editing.'); return args.expectedRevision; }
export const RADAR_HANDLERS = {
  async wh_radar_list(args: ToolArgs) {
    const projectId = resolveProjectId(args), project = await getEraProject({ projectId, eraId: optString(args, 'eraId') }); if (!project) throw new BridgeError('not-found', 'Project not found.');
    return { projectId, charts: (project.radarCharts ?? []).map(chart => ({ id: chart.id, title: chart.title, revision: chart.revision, axes: chart.axes.length, series: chart.series.length, isPreset: !!chart.isPreset, presetCategory: chart.presetCategory })), skeletons: RADAR_SKELETONS.map(item => ({ id: item.id, name: { es: item.es, en: item.en } })) };
  },
  async wh_radar_get(args: ToolArgs) { const { projectId, chart } = await current(args); return { projectId, chart, resolved: await resolved(projectId, chart, optString(args, 'eraId')) }; },
  async wh_radar_save(args: ToolArgs) {
    const projectId = await resolveProjectForEngine(args, 'radar');
    if (!args.chart || typeof args.chart !== 'object' || Array.isArray(args.chart)) throw new BridgeError('bad-args', 'chart is required.');
    const expected = args.expectedRevision === null ? null : revision(args), draft = { ...createRadarChart(), ...args.chart as Partial<RadarChartDocument> };
    const chart = await saveRadarChart(projectId, draft, expected, optString(args, 'eraId'));
    return withAudit({ projectId, chart }, { projectId, entityId: chart.id, kind: expected === null ? 'create' : 'update', summary: `Saved radar chart ${chart.title}` });
  },
  async wh_radar_set_value(args: ToolArgs) {
    await resolveProjectForEngine(args, 'radar'); const { projectId, chart } = await current(args);
    if (typeof args.value !== 'number' || !Number.isFinite(args.value)) throw new BridgeError('bad-args', 'value must be finite.');
    let draft: RadarChartDocument;
    try { draft = setRadarValue(chart, requireString(args, 'seriesId'), requireString(args, 'axisId'), args.value); } catch (reason) { throw new BridgeError('bad-args', reason instanceof Error ? reason.message : 'Cannot change this vertex.'); }
    const saved = await saveRadarChart(projectId, draft, revision(args), optString(args, 'eraId')); return withAudit({ projectId, chart: saved }, { projectId, entityId: saved.id, summary: `Changed radar value in ${saved.title}` });
  },
  async wh_radar_from_preset(args: ToolArgs) {
    const projectId = await resolveProjectForEngine(args, 'radar'), sourceId = optString(args, 'sourceChartId'), skeleton = optString(args, 'skeleton');
    if (!!sourceId === !!skeleton) throw new BridgeError('bad-args', 'Pass either sourceChartId or skeleton.');
    let draft: RadarChartDocument;
    if (sourceId) { const source = (await getEraProject({ projectId, eraId: optString(args, 'eraId') }))?.radarCharts?.find(item => item.id === sourceId); if (!source) throw new BridgeError('not-found', 'Preset chart not found in this project.'); draft = radarFromPreset(source); }
    else draft = radarFromSkeleton(skeleton!, optString(args, 'locale') === 'es' ? 'es' : 'en');
    draft.title = optString(args, 'title') ?? draft.title;
    const chart = await saveRadarChart(projectId, draft, null, optString(args, 'eraId')); return withAudit({ projectId, chart }, { projectId, entityId: chart.id, kind: 'create', summary: `Created radar from preset ${chart.title}` });
  },
  async wh_radar_export(args: ToolArgs) {
    const { projectId, chart } = await current(args), format = optString(args, 'format') ?? 'json', values = await resolved(projectId, chart, optString(args, 'eraId'));
    if (!['json', 'csv', 'svg'].includes(format)) throw new BridgeError('bad-args', 'format must be json, csv or svg.');
    return { projectId, chartId: chart.id, format, content: format === 'json' ? exportRadarJson(chart) : format === 'csv' ? exportRadarCsv(chart, values) : await exportRadarSvgComplete(chart, values) };
  },
  async wh_radar_import(args: ToolArgs) {
    const projectId = await resolveProjectForEngine(args, 'radar'), format = optString(args, 'format') ?? 'json';
    if (format !== 'json' && format !== 'csv') throw new BridgeError('bad-args', 'format must be json or csv.');
    const chart = format === 'json' ? parseRadarJson(requireString(args, 'content')) : parseRadarCsv(requireString(args, 'content'), optString(args, 'title') ?? 'Imported radar');
    if (optString(args, 'title') !== undefined) chart.title = optString(args, 'title')!;
    for (const series of chart.series) if (series.linkedEntryId && (await readEraRow<CodexEntry>({ projectId, eraId: optString(args, 'eraId') }, 'codexEntries', series.linkedEntryId))?.projectId !== projectId) series.linkedEntryId = undefined;
    const saved = await saveRadarChart(projectId, chart, null, optString(args, 'eraId')); return withAudit({ projectId, chart: saved }, { projectId, entityId: saved.id, kind: 'create', summary: `Imported radar ${saved.title}` });
  },
  async wh_radar_archive(args: ToolArgs) { await resolveProjectForEngine(args, 'radar'); const { projectId, chart } = await current(args); await deleteRadarChart(projectId, chart.id, revision(args), optString(args, 'eraId')); return withAudit({ projectId, chartId: chart.id, archived: true }, { projectId, entityId: chart.id, summary: `Archived radar ${chart.title}` }); },
  async wh_radar_settings(args: ToolArgs) { const projectId = await resolveProjectForEngine(args, 'radar'), enabled = optBoolean(args, 'soundEnabled'); if (enabled !== undefined) setRadarAudioEnabled(enabled); return { projectId, soundEnabled: radarAudioEnabled(), scope: 'local device' }; },
};
