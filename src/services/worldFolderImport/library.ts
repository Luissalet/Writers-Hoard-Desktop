import { db } from '@/db';
import { getEraProject, updateWorldEraDefaults } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import { listWorkspaceDocuments } from '@/components/project/workspace/library/catalog';
import { applyWorkspaceLibraryAction, folderPath, readWorkspaceLibrary } from '@/components/project/workspace/library/model';
import { workspaceDocumentKey, type WorkspaceEngineId, type WorkspaceLibrary } from '@/components/project/workspace/library/types';
import type { Project } from '@/types';
import type { WorldFolderReferenceKind } from './types';

type Ref = { kind: WorldFolderReferenceKind; id: string };

/** The Library folder an import names, or an error if it no longer exists. */
export function libraryFolderOf(project: Pick<Project, 'workspaceFolders' | 'workspacePlacements' | 'workspaceRevision'>, folderId: string): { id: string; name: string; path: string } {
  const library = readWorkspaceLibrary(project), folder = library.folders.find(item => item.id === folderId);
  if (!folder) throw Error('world_folder_library_folder_missing');
  return { id: folder.id, name: folder.name, path: folderPath(library.folders, folder.id) };
}
async function save(scope: WorldEraScope, library: WorkspaceLibrary): Promise<void> {
  const changes = { workspaceFolders: library.folders, workspacePlacements: library.placements, workspaceRevision: library.revision };
  if (scope.eraId) await updateWorldEraDefaults(scope, changes); else await db.projects.update(scope.projectId, { ...changes, updatedAt: Date.now() });
}
/** Files the created documents in the chosen Library folder. Runs inside the import transaction. */
export async function placeImportedDocuments(scope: WorldEraScope, refs: readonly Ref[], folderId: string): Promise<void> {
  const project = await getEraProject(scope);
  libraryFolderOf(project, folderId);
  const library = readWorkspaceLibrary(project), catalog = await listWorkspaceDocuments(scope.projectId, project, scope.eraId), known = new Set(catalog.map(workspaceDocumentKey));
  const documents = refs.map(ref => ({ engineId: ref.kind as WorkspaceEngineId, entityId: ref.id })).filter(document => known.has(workspaceDocumentKey(document)));
  if (!documents.length) return;
  await save(scope, applyWorkspaceLibraryAction(library, { kind: 'place', documents, folderId }, catalog));
}
/** Undo of the above: the documents are gone, so their placements go too. */
export async function unplaceImportedDocuments(scope: WorldEraScope, refs: readonly Ref[]): Promise<boolean> {
  const project = await getEraProject(scope), library = readWorkspaceLibrary(project);
  const gone = new Set(refs.map(ref => workspaceDocumentKey({ engineId: ref.kind as WorkspaceEngineId, entityId: ref.id })));
  const placements = library.placements.filter(placement => !gone.has(workspaceDocumentKey(placement)));
  if (placements.length === library.placements.length) return false;
  await save(scope, { ...library, placements, revision: library.revision + 1 });
  return true;
}
