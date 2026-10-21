import { deleteParallelDraft, loadPaneDocument, savePaneDocument } from './parallelDrafts';
export async function undoParallelDraftChange(projectId: string, eraId: string | undefined, before: Record<string, unknown>) {
  const created = before.__parallelDraftCreated, updated = before.__parallelDraft;
  const data = (created ?? updated) as Record<string, unknown> | undefined;
  if (!data || typeof data.writingId !== 'string' || typeof data.draftId !== 'string' || !Number.isSafeInteger(data.expectedVersion)) throw Error('parallel_draft_undo_invalid');
  const document = await loadPaneDocument(projectId, { writingId: data.writingId, draftId: data.draftId }, eraId);
  if (document.version !== data.expectedVersion) throw Error('parallel_draft_undo_conflict');
  if (created) await deleteParallelDraft(document);
  else { if (typeof data.content !== 'string') throw Error('parallel_draft_undo_invalid'); await savePaneDocument(document, data.content, true); }
  return data.draftId;
}
