// Deleting several Library documents at once, each through the operation that
// deletes its kind correctly (the same registry the bridge's delete uses), so
// cascades and unlink rules are kept. Kinds kept inside the project file
// (dictionaries, tables, trees, sheets…) are deleted from their own engine.
import { DELETABLE } from '@/services/aiBridge/tools/deletion';
import { recordArchiveUndo } from '@/services/undoJournal';
import type { WorkspaceDocument } from './types';

const BY_ENGINE: Partial<Record<string, keyof typeof DELETABLE>> = {
  writings: 'writing', codex: 'codex-entry', notes: 'note', 'dialog-scene': 'scene', timeline: 'timeline', board: 'board', worldgen: 'generated-world',
};

/** Which of the chosen documents the Library can delete, and which it cannot. */
export function splitDeletable(documents: readonly WorkspaceDocument[]): { deletable: WorkspaceDocument[]; kept: WorkspaceDocument[] } {
  const deletable: WorkspaceDocument[] = [], kept: WorkspaceDocument[] = [];
  for (const document of documents) (BY_ENGINE[document.engineId] ? deletable : kept).push(document);
  return { deletable, kept };
}

/**
 * Delete them one by one; a failure stops there and says how many went.
 * With `projectId`, the ones that left an archive receipt are journalled and
 * announced with a "Deshacer" toast (see services/undoJournal.ts).
 */
export async function deleteLibraryDocuments(documents: readonly WorkspaceDocument[], projectId?: string): Promise<{ deleted: number }> {
  let deleted = 0;
  const since = Date.now(), removed: WorkspaceDocument[] = [];
  try {
    for (const document of splitDeletable(documents).deletable) {
      await DELETABLE[BY_ENGINE[document.engineId]!].remove(document.entityId);
      deleted++; removed.push(document);
    }
  } finally {
    // Whatever went before a failure can still be taken back.
    if (projectId && removed.length) await recordArchiveUndo({ projectId, sourceIds: removed.map(item => item.entityId), since, title: removed[0].title }).catch(() => 0);
  }
  return { deleted };
}
