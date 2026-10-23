import { getEraProject, updateWorldEraDefaults } from '@/services/worldEras/store';
import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { listWorkspaceDocuments, workspaceCatalogTables } from './catalog';
import { applyWorkspaceLibraryAction, readWorkspaceLibrary, WorkspaceLibraryConflict, WorkspaceLibraryInvalidAction, type WorkspaceLibraryAction } from './model';
import { recordUndoable, UndoStaleError } from '@/services/undoJournal';
import { t } from '@/i18n/useTranslation';

export async function updateWorkspaceLibrary(projectId: string, expectedRevision: number, action: WorkspaceLibraryAction, eraId?: string): Promise<void> {
  await db.transaction('rw', eraId ? db.tables : [db.projects, ...workspaceCatalogTables], async () => {
    const project = await (eraId ? getEraProject({ projectId, eraId }) : db.projects.get(projectId)); if (!project) throw new Error('Project not found.');
    const library = readWorkspaceLibrary(project); if (library.revision !== expectedRevision) throw new WorkspaceLibraryConflict('The document library changed elsewhere.');
    const documents = action.kind === 'place' || action.kind === 'order-document' || action.kind === 'prune' || action.kind === 'group' || action.kind === 'pin' ? await listWorkspaceDocuments(projectId, project, eraId) : [];
    const next = applyWorkspaceLibraryAction(library, action, documents);
    const changes = { workspaceFolders: next.folders, workspacePlacements: next.placements, workspaceRevision: next.revision };
    if (eraId) await updateWorldEraDefaults({ projectId, eraId }, changes); else await db.projects.update(projectId, { ...changes, updatedAt: Date.now() });
  });
  notifyProjectsChanged(); notifyDataChanged({ source: 'other', table: 'projects', projectId });
}

/**
 * Rename a Library folder and journal it. The receipt is the library revision:
 * the rename made it `expectedRevision + 1`, and the undo only runs while that
 * is still the current one. Anything else done to the Library since (even an
 * unrelated pin) moves the revision, and the undo is refused, never forced.
 */
export async function renameWorkspaceFolder(projectId: string, expectedRevision: number, folder: { id: string; name: string }, newName: string, eraId?: string): Promise<void> {
  await updateWorkspaceLibrary(projectId, expectedRevision, { kind: 'rename-folder', id: folder.id, name: newName }, eraId);
  const to = newName.trim();
  if (!to || to === folder.name) return;
  recordUndoable({
    projectId, kind: 'rename', label: `${folder.name} → ${to}`,
    notice: t('undo.renamedFolder').replace('{from}', folder.name).replace('{to}', to),
    undo: async () => {
      try { await updateWorkspaceLibrary(projectId, expectedRevision + 1, { kind: 'rename-folder', id: folder.id, name: folder.name }, eraId); }
      catch (error) { if (error instanceof WorkspaceLibraryConflict || error instanceof WorkspaceLibraryInvalidAction) throw new UndoStaleError(); throw error; }
    },
  });
}
