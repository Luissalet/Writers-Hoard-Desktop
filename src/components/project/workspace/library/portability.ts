import type { Project } from '@/types';
import { readWorkspaceLibrary } from './model';
import { workspaceSourcePrefix, type WorkspaceEngineId } from './types';

/** JSON cloning differs from ZIP restore: only source IDs actually carried by
 * the importer may travel into the cloned project's organizational references. */
export function remapWorkspaceLibrary(project: Project, remap: (id: string, prefix: string) => string, available: Partial<Record<WorkspaceEngineId, ReadonlySet<string>>>): Partial<Project> {
  const library = readWorkspaceLibrary(project), folders = new Set(library.folders.map(folder => folder.id));
  return {
    workspaceFolders: library.folders.map(folder => ({ ...folder, id: remap(folder.id, 'workspace-folder'), parentId: folder.parentId && folders.has(folder.parentId) ? remap(folder.parentId, 'workspace-folder') : undefined })),
    workspacePlacements: library.placements.filter(placement => available[placement.engineId]?.has(placement.entityId)).map(placement => ({ ...placement, entityId: remap(placement.entityId, workspaceSourcePrefix(placement.engineId)), folderId: placement.folderId && folders.has(placement.folderId) ? remap(placement.folderId, 'workspace-folder') : undefined })),
    workspaceRevision: 0,
  };
}
