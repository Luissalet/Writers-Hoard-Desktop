import { db } from '@/db';
import type { Project } from '@/types';
import type { WorkspaceDocument, WorkspaceEngineId } from './types';

export const workspaceCatalogTables = [db.codexEntries, db.writings, db.worldMaps, db.boards, db.timelines, db.notes, db.localMediaAssets];
const routeParam: Partial<Record<WorkspaceEngineId, string>> = { codex: 'entry', writings: 'writing', maps: 'map', board: 'board', timeline: 'entity', notes: 'note', genealogy: 'tree' };
export function workspaceDocument(projectId: string, engineId: WorkspaceEngineId, entityId: string, title: string): WorkspaceDocument {
  return { engineId, entityId, title, route: `/project/${encodeURIComponent(projectId)}/${engineId}?${routeParam[engineId] ?? 'entity'}=${encodeURIComponent(entityId)}` };
}
/** Catalog references only; media blobs and rich text never enter library state. */
export async function listWorkspaceDocuments(projectId: string, suppliedProject?: Project): Promise<WorkspaceDocument[]> {
  const project = suppliedProject ?? await db.projects.get(projectId);
  if (!project || project.id !== projectId) return [];
  const source = async (table: typeof db.codexEntries | typeof db.writings | typeof db.worldMaps | typeof db.boards | typeof db.timelines | typeof db.notes | typeof db.localMediaAssets, engineId: WorkspaceEngineId) => {
    const result: WorkspaceDocument[] = [];
    await table.where('projectId').equals(projectId).each(row => {
      const title = 'title' in row ? row.title : 'text' in row ? row.text.split(/\r?\n/).map(line => line.trim()).find(Boolean)?.slice(0, 160) ?? '' : '';
      result.push(workspaceDocument(projectId, engineId, row.id, title));
    });
    return result;
  };
  const batches = await Promise.all([source(db.codexEntries, 'codex'), source(db.writings, 'writings'), source(db.worldMaps, 'maps'), source(db.boards, 'board'), source(db.timelines, 'timeline'), source(db.notes, 'notes'), source(db.localMediaAssets, 'media')]);
  return [...batches.flat(), ...(project.dictionaries ?? []).map(row => workspaceDocument(projectId, 'dictionary', row.id, row.name)), ...(project.dataTables ?? []).map(row => workspaceDocument(projectId, 'tables', row.id, row.title)), ...(project.relationTrees ?? []).map(row => workspaceDocument(projectId, 'genealogy', row.id, row.title)), ...(project.characterSheets ?? []).map(row => workspaceDocument(projectId, 'character-sheets', row.id, row.title)), ...(project.radarCharts ?? []).map(row => workspaceDocument(projectId, 'radar', row.id, row.title)), ...(project.modelAssets ?? []).map(row => workspaceDocument(projectId, 'model-viewer', row.id, row.name))];
}
