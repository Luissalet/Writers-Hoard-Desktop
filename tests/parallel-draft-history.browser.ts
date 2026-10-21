import '@/engines';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import type { Project, Writing } from '@/types';
import { createParallelDraft, loadPaneDocument, savePaneDocument, restoreParallelDraftHistory, renameParallelDraft } from '@/engines/writings/parallelDrafts';
import { listParallelDraftHistory, readParallelDraftHistory } from '@/engines/writings/parallelDraftHistory';
import { listSnapshots } from '@/engines/writings/snapshots';
import { preparePublishedEdition, commitPublishedEdition, publishEdition, getPublishedEdition } from '@/services/publishedEditions/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function rejects(fn: () => Promise<unknown>) { let rejected = false; try { await fn(); } catch { rejected = true; } assert(rejected, 'Expected refusal'); }
export async function testParallelDraftHistory() {
  const P = `draft-history-${Date.now()}`, W = `${P}-chapter`, ids = [P], results: string[] = [];
  const project: Project = { id: P, title: 'Draft archive fixture', type: 'standalone', mode: 'custom', color: '#776644', description: '', status: 'draft', enabledEngines: ['writings','codex'], engineOrder: ['writings'], worldEras: [{ id: 'past', name: 'Past', description: '', revision: 1, createdAt: 1, updatedAt: 1 }], createdAt: 1, updatedAt: 1 };
  const writing: Writing = { id: W, projectId: P, title: 'The Harbor', content: '<p>Canonical harbor.</p>', wordCount: 2, status: 'draft', tags: [], createdAt: 1, updatedAt: 1 };
  const load = (draftId: string, eraId?: string) => loadPaneDocument(P, { writingId: W, draftId }, eraId);
  try {
    await db.projects.put(project); await db.writings.put(writing);
    const canonical = await loadPaneDocument(P, { writingId: W }), a = await createParallelDraft(canonical, 'Quiet arrival'), b = await createParallelDraft(canonical, 'Storm arrival');
    let A = await load(a.id), B = await load(b.id);
    await savePaneDocument(A, '<p>A first scene.</p>'); A = await load(a.id);
    await savePaneDocument(B, '<p>B storm scene.</p>'); B = await load(b.id);
    await renameParallelDraft(A, 'Quiet renamed'); A = await load(a.id);
    await savePaneDocument(A, ''); A = await load(a.id);
    await savePaneDocument(A, '<p>A final scene.</p>'); A = await load(a.id);
    const aHistory = await listParallelDraftHistory(A), bHistory = await listParallelDraftHistory(B);
    assert(aHistory.length === 3 && bHistory.length === 1 && aHistory.every(row => !('content' in row) && row.sourceDraftId === a.id), 'Own history identity/metadata');
    const empty = aHistory.find(row => row.wordCount === 0)!; assert((await readParallelDraftHistory(A, empty.id)).content === '', 'Empty preimage lost');
    await rejects(() => readParallelDraftHistory(B, empty.id));
    const before = await db.writingSnapshots.count(); await savePaneDocument(A, A.content); A = await load(a.id); assert(await db.writingSnapshots.count() === before, 'No-op created history');
    const stale = A; await savePaneDocument(A, '<p>A newer scene.</p>'); A = await load(a.id);
    await rejects(() => restoreParallelDraftHistory(stale, empty.id)); assert((await load(a.id)).content === A.content, 'Stale restore overwrote current');
    assert((await listSnapshots(W)).every(row => !row.kind), 'Alternative rows leaked into canonical history');
    results.push('Independent alternatives: metadata-only own history, rename identity, empty/no-op semantics, foreign-history refusal and exact-version restore conflict');

    const currentCount = await db.writingSnapshots.count(), currentContent = A.content;
    await rejects(() => db.transaction('rw', db.tables, async () => { await savePaneDocument(A, '<p>Aborted content.</p>'); throw Error('abort outer'); }));
    assert(await db.writingSnapshots.count() === currentCount && (await load(a.id)).content === currentContent, 'History/replacement outer rollback split');
    await restoreParallelDraftHistory(A, empty.id); A = await load(a.id); assert(A.content === '' && (await load(b.id)).content === B.content && (await db.writings.get(W))!.content === writing.content, 'Restore changed another identity');
    await savePaneDocument(A, '<p>Alternative publication only.</p>'); A = await load(a.id);
    const eraA = await load(a.id, 'past'); await savePaneDocument(eraA, '<p>Past alternative publication.</p>');
    const eraHist = await listParallelDraftHistory(await load(a.id, 'past')); assert(eraHist.some(row => row.sourceDraftId === a.id) && (await load(a.id)).content === A.content, 'Era history mutated Base');
    results.push('History/replacement atomic outer rollback; restore and named-era edits preserve canonical prose and the other alternative');

    const input = { projectId: P, chapterIds: [W], chapterDraftIds: { [W]: a.id }, title: 'Alternative edition', locale: 'es' as const, expectedRevision: 0 };
    const prepared = await preparePublishedEdition(input); await savePaneDocument(A, '<p>Changed during publication.</p>'); A = await load(a.id); await rejects(() => commitPublishedEdition(prepared, 0));
    const published = await publishEdition(input); assert(published.edition.chapters[0].sourceDraftId === a.id && published.edition.chapters[0].sourceDraftName === A.draftName && published.edition.reader.html.includes('Changed during publication.') && !published.edition.reader.html.includes('Canonical harbor.'), 'Publication ignored exact selected alternative');
    assert((await db.writings.get(W))!.content === writing.content && (await load(b.id)).content === B.content, 'Publication promoted a draft');
    await rejects(() => publishEdition({ ...input, expectedRevision: 1, chapterDraftIds: { [W]: 'foreign' } }));
    const pastEdition = await publishEdition({ ...input, eraId: 'past', expectedRevision: 1 }); assert(pastEdition.edition.reader.html.includes('Past alternative publication.'), 'Publication chose Base instead of era alternative');
    results.push('Alternative selection publishes frozen prose without promotion, records identity/name/version, rejects changed/foreign sources and resolves named-era alternatives');

    const call = async (name: string, args: Record<string, unknown>) => { const result = await runBridgeTool(name, args); assert(result.ok, JSON.stringify(result)); return result.result as Record<string, unknown>; };
    const scope = { projectId: P, writingId: W, draftId: b.id };
    const saved = await call('wh_parallel_draft_save', { ...scope, expectedVersion: B.version, content: 'Native alternative changed.' });
    const envelope = saved.__audit as Record<string, unknown>; await undoAuditEntry({ entry: { ...envelope, tool: 'wh_parallel_draft_save' } });
    assert((await load(b.id)).content === B.content, 'Normal draft audit Undo failed');
    await rejects(() => undoAuditEntry({ entry: { ...envelope, tool: 'wh_parallel_draft_save' } }));
    const past = await load(b.id, 'past'), pastSaved = await call('wh_parallel_draft_save', { ...scope, eraId: 'past', expectedVersion: past.version, content: 'Past native alternative.' });
    await undoAuditEntry({ entry: { ...(pastSaved.__audit as object), tool: 'wh_parallel_draft_save', eraId: 'past' } }); assert((await load(b.id, 'past')).content === B.content && (await db.writings.get(W))!.content === writing.content, 'Era draft audit Undo wrote Base');
    results.push('Registered draft MCP save/audit Undo in Base and era use exact-version draft operations; replay refuses');

    const portable = await exportProjectData(P), cloneId = await importProjectData(portable); ids.push(cloneId);
    const clonedRows = await db.writingSnapshots.where('projectId').equals(cloneId).toArray(), cloneDraft = clonedRows.find(row => row.kind === 'parallel-draft' && row.draftName === A.draftName)!;
    assert(cloneDraft.id !== a.id && clonedRows.some(row => row.kind === 'parallel-draft-history' && row.sourceDraftId === cloneDraft.id), 'JSON clone did not remap source draft history');
    const cloneEdition = (await db.projects.get(cloneId))!.publishedEditions![0]; assert(cloneEdition.chapters[0].sourceDraftId === cloneDraft.id && cloneEdition.reader.html === published.edition.reader.html, 'Published draft reference/bytes clone failed');
    const zip = await createProjectZipArchive(P); await importProjectZip(new File([zip.blob], 'draft-history.zip'), { replaceProjectIds: [P] }); assert((await listParallelDraftHistory(await load(a.id))).length > 3, 'ZIP lost own draft history');
    await db.writingSnapshots.delete(a.id); assert((await getPublishedEdition(P, published.edition.id)).reader.html === published.edition.reader.html, 'Draft deletion rewrote frozen edition');
    results.push('Actual JSON clone and ZIP restore retain own history and remap draft/edition references while frozen Reader bytes survive source deletion');
    return results;
  } finally { for (const id of ids) await deleteProject(id); }
}
