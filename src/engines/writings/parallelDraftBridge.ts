import { optString, requireString, resolveProjectForEngine, withAudit, htmlFromMarkdown, markdownFromHtml, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { createParallelDraft, listParallelDraftMeta, loadPaneDocument, restoreParallelDraftHistory, savePaneDocument, type PaneDocument } from './parallelDrafts';
import { listParallelDraftHistory, readParallelDraftHistory } from './parallelDraftHistory';
async function scopeFor(args: ToolArgs) { return { projectId: await resolveProjectForEngine(args, 'writings'), eraId: optString(args, 'eraId'), writingId: requireString(args, 'writingId') }; }
async function documentFor(args: ToolArgs) { const scope = await scopeFor(args); return loadPaneDocument(scope.projectId, { writingId: scope.writingId, draftId: requireString(args, 'draftId') }, scope.eraId); }
function expectVersion(document: PaneDocument, args: ToolArgs) { if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion !== document.version) throw Error('parallel_draft_version_conflict'); }
function changed(document: PaneDocument, version: number) { return withAudit({ id: document.draftId, version, updated: true }, { projectId: document.projectId, entityId: document.draftId, table: 'writingSnapshots', kind: 'update', before: { __parallelDraft: { writingId: document.writingId, draftId: document.draftId, content: document.content, expectedVersion: version } }, summary: `updated draft "${document.draftName ?? ''}"` }); }
export const PARALLEL_DRAFT_HANDLERS = {
  async wh_parallel_draft_list(args: ToolArgs) { const scope = await scopeFor(args); await loadPaneDocument(scope.projectId, scope, scope.eraId); return listParallelDraftMeta(scope.projectId, scope.writingId, scope.eraId); },
  async wh_parallel_draft_get(args: ToolArgs) { const row = await documentFor(args); return { ...row, content: markdownFromHtml(row.content) }; },
  async wh_parallel_draft_create(args: ToolArgs) {
    const scope = await scopeFor(args), source = await loadPaneDocument(scope.projectId, { writingId: scope.writingId, draftId: optString(args, 'sourceDraftId') }, scope.eraId); expectVersion(source, args);
    const row = await createParallelDraft(source, requireString(args, 'name'));
    return withAudit({ ...row, created: true }, { projectId: scope.projectId, entityId: row.id, table: 'writingSnapshots', kind: 'create', before: { __parallelDraftCreated: { writingId: scope.writingId, draftId: row.id, expectedVersion: row.updatedAt ?? row.createdAt } }, summary: `created draft "${row.draftName}"` });
  },
  async wh_parallel_draft_save(args: ToolArgs) { const row = await documentFor(args); expectVersion(row, args); if (typeof args.content !== 'string') throw Error('parallel_draft_content_invalid'); return changed(row, await savePaneDocument(row, args.content ? htmlFromMarkdown(args.content) : '')); },
  async wh_parallel_draft_history(args: ToolArgs) { const row = await documentFor(args); return listParallelDraftHistory(row); },
  async wh_parallel_draft_history_read(args: ToolArgs) { const row = await readParallelDraftHistory(await documentFor(args), requireString(args, 'historyId')); return { ...row, content: markdownFromHtml(row.content) }; },
  async wh_parallel_draft_history_restore(args: ToolArgs) { const row = await documentFor(args); expectVersion(row, args); return changed(row, await restoreParallelDraftHistory(row, requireString(args, 'historyId'))); },
};
