import { getEraProject, listEraRows } from '@/services/worldEras/store';
import { workspaceRoute, workspaceRouteKey, routeInEra } from '../routes';
import { db } from '@/db';
import Dexie from 'dexie';
import type { Project } from '@/types';
import type { WorkspaceDocument, WorkspaceEngineId } from './types';

export const workspaceCatalogTables = [db.codexEntries, db.writings, db.worldMaps, db.boards, db.timelines, db.notes, db.localMediaAssets, db.scenes, db.generatedWorlds];
const routeParam: Partial<Record<WorkspaceEngineId, string>> = { 'dialog-scene': 'scene', worldgen: 'world', codex: 'entry', writings: 'writing', maps: 'map', board: 'board', timeline: 'entity', notes: 'note', genealogy: 'tree' };
export function workspaceDocument(projectId: string, engineId: WorkspaceEngineId, entityId: string, title: string): WorkspaceDocument {
  return { engineId, entityId, title, route: `/project/${encodeURIComponent(projectId)}/${engineId}?${engineId.startsWith('local-tool-')?'document':routeParam[engineId] ?? 'entity'}=${encodeURIComponent(entityId)}` };
}
/** Catalog references only; media blobs and rich text never enter library state. */
export async function listWorkspaceDocuments(projectId: string, suppliedProject?: Project, eraId?: string): Promise<WorkspaceDocument[]> {
  const project = suppliedProject ?? await (eraId ? getEraProject({ projectId, eraId }) : db.projects.get(projectId));
  if (!project || project.id !== projectId) return [];
  const source = async (table: typeof db.codexEntries | typeof db.writings | typeof db.worldMaps | typeof db.boards | typeof db.timelines | typeof db.notes | typeof db.localMediaAssets | typeof db.scenes | typeof db.generatedWorlds, engineId: WorkspaceEngineId) => {
    const result: WorkspaceDocument[] = [];
    const append = (row: { id: string; title?: string; text?: string }) => {
      const title = typeof row.title === 'string' ? row.title : typeof row.text === 'string' ? row.text.split(/\r?\n/).map(line => line.trim()).find(Boolean)?.slice(0, 160) ?? '' : '';
      result.push(workspaceDocument(projectId, engineId, row.id, title));
    };
    if (eraId) (await listEraRows<{ id: string; title?: string; text?: string }>({ projectId, eraId }, table.name)).forEach(append); else await table.where('projectId').equals(projectId).each(append);
    return result;
  };
  const sources = [() => source(db.scenes, 'dialog-scene'), () => source(db.generatedWorlds, 'worldgen'), () => source(db.codexEntries, 'codex'), () => source(db.writings, 'writings'), () => source(db.worldMaps, 'maps'), () => source(db.boards, 'board'), () => source(db.timelines, 'timeline'), () => source(db.notes, 'notes'), () => source(db.localMediaAssets, 'media')];
  const batches: WorkspaceDocument[][] = [];
  // Era reads hash their inherited documents with Dexie.waitFor. Starting a
  // second such read while the first keeps the transaction alive can queue
  // its database requests behind that wait. Finish each source before the next.
  if (eraId && Dexie.currentTransaction) {
    for (const read of sources) batches.push(await read());
  } else batches.push(...await Promise.all(sources.map(read => read())));
  const documents = [...batches.flat(), ...(project.sourceToolDocuments??[]).map(row=>workspaceDocument(projectId,`local-tool-${row.namespace}`,row.id,row.title)), ...(project.dictionaries ?? []).map(row => workspaceDocument(projectId, 'dictionary', row.id, row.name)), ...(project.dataTables ?? []).map(row => workspaceDocument(projectId, 'tables', row.id, row.title)), ...(project.relationTrees ?? []).map(row => workspaceDocument(projectId, 'genealogy', row.id, row.title)), ...(project.characterSheets ?? []).map(row => workspaceDocument(projectId, 'character-sheets', row.id, row.title)), ...(project.radarCharts ?? []).map(row => workspaceDocument(projectId, 'radar', row.id, row.title)), ...(project.modelAssets ?? []).map(row => workspaceDocument(projectId, 'model-viewer', row.id, row.name))];
  return eraId ? documents.map(document => ({ ...document, route: workspaceRouteKey(routeInEra(workspaceRoute(document.route), eraId)) })) : documents;
}
