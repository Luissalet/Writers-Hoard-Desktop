// Deleting several Library documents at once, each through the operation that
// deletes its kind correctly (the same registry the bridge's delete uses), so
// cascades and unlink rules are kept. Kinds kept inside the project file
// (dictionaries, tables, trees, sheets…) are deleted from their own engine.
import { DELETABLE } from '@/services/aiBridge/tools/deletion';
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

/** Delete them one by one; a failure stops there and says how many went. */
export async function deleteLibraryDocuments(documents: readonly WorkspaceDocument[]): Promise<{ deleted: number }> {
  let deleted = 0;
  for (const document of splitDeletable(documents).deletable) {
    await DELETABLE[BY_ENGINE[document.engineId]!].remove(document.entityId);
    deleted++;
  }
  return { deleted };
}
