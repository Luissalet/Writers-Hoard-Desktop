import { saveRevisionedEraMetadata, archiveEraMetadata } from '@/services/worldEras/metadata';
import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { createLocalDraftStore } from '@/hooks/localDraftStore';
import { validateRadarChart } from './model';
import type { RadarChartDocument } from './types';
export class RadarConflict extends Error { readonly current: RadarChartDocument | undefined; constructor(current: RadarChartDocument | undefined) { super('radar_conflict'); this.name = 'RadarConflict'; this.current = current; } }
export async function saveRadarChart(projectId: string, draft: RadarChartDocument, expectedRevision: number | null, eraId?: string): Promise<RadarChartDocument> {
  if (eraId) return saveRevisionedEraMetadata({ projectId, eraId }, 'radar', draft, expectedRevision, current => new RadarConflict(current));
  validateRadarChart(draft); if (!draft.title.trim()) throw new Error('radar_title_required');
  const saved = await db.transaction('rw', db.projects, db.codexEntries, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const charts = project.radarCharts ?? [], current = charts.find(chart => chart.id === draft.id);
    if (expectedRevision === null ? Boolean(current) : current?.revision !== expectedRevision) throw new RadarConflict(current);
    for (const series of draft.series) if (series.linkedEntryId) { const entry = await db.codexEntries.get(series.linkedEntryId); if (!entry || entry.projectId !== projectId) throw new Error('radar_foreign_entry'); }
    const now = Math.max(Date.now(), (current?.updatedAt ?? 0) + 1), next = structuredClone({ ...draft, title: draft.title.trim(), revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? draft.createdAt, updatedAt: now });
    await db.projects.update(projectId, { radarCharts: current ? charts.map(chart => chart.id === next.id ? next : chart) : [...charts, next], updatedAt: Math.max(now, project.updatedAt + 1) }); return next;
  }); notifyProjectsChanged(); return saved;
}
export async function deleteRadarChart(projectId: string, id: string, expectedRevision: number, eraId?: string): Promise<void> {
  if (eraId) return archiveEraMetadata({ projectId, eraId }, 'radar', id, expectedRevision, current => new RadarConflict(current));
  await archiveMetadataWithMutation('radar', projectId, id, () => db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const current = project.radarCharts?.find(chart => chart.id === id); if (current?.revision !== expectedRevision) throw new RadarConflict(current);
    await db.projects.update(projectId, { radarCharts: project.radarCharts!.filter(chart => chart.id !== id), updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
  })); notifyProjectsChanged();
}
export interface RadarDraft { chart: RadarChartDocument; base: number | null }
export function radarDraftStore(projectId: string, eraId?: string): Map<string, RadarDraft> {
  return createLocalDraftStore<RadarDraft>(`wh.radar-drafts.v1.${projectId}${eraId ? `.era:${eraId}` : ''}`, (value): value is RadarDraft => { try { const draft = value as RadarDraft; validateRadarChart(draft.chart, true); return draft.base === null || Number.isSafeInteger(draft.base); } catch { return false; } });
}
