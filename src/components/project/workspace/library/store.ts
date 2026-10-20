import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { listWorkspaceDocuments, workspaceCatalogTables } from './catalog';
import { applyWorkspaceLibraryAction, readWorkspaceLibrary, WorkspaceLibraryConflict, type WorkspaceLibraryAction } from './model';

export async function updateWorkspaceLibrary(projectId: string, expectedRevision: number, action: WorkspaceLibraryAction): Promise<void> {
  await db.transaction('rw', [db.projects, ...workspaceCatalogTables], async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('Project not found.');
    const library = readWorkspaceLibrary(project); if (library.revision !== expectedRevision) throw new WorkspaceLibraryConflict('The document library changed elsewhere.');
    const documents = action.kind === 'place' || action.kind === 'order-document' || action.kind === 'prune' ? await listWorkspaceDocuments(projectId, project) : [];
    const next = applyWorkspaceLibraryAction(library, action, documents);
    await db.projects.update(projectId, { workspaceFolders: next.folders, workspacePlacements: next.placements, workspaceRevision: next.revision, updatedAt: Date.now() });
  });
  notifyProjectsChanged(); notifyDataChanged({ source: 'other', table: 'projects', projectId });
}
