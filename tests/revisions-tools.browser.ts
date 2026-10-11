import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { getWriting } from '@/engines/writings/operations';
import { listSnapshotMeta } from '@/engines/writings/snapshots';
import type { Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function testRevisionTools(): Promise<string[]> {
  const projectId = 'qa-revisions-' + crypto.randomUUID();
  const id = 'qa-revision-writing-' + crypto.randomUUID();
  const now = Date.now();
  const original = '<p><strong>Árbol</strong> y café 👩‍🚀.</p><p>Otro párrafo.</p>';
  await db.projects.add({ id: projectId, title: 'QA revisiones', mode: 'reporter', type: 'standalone', color: '#445566', description: '', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
  const writing: Writing = { id, projectId, title: 'QA revisión', content: original, wordCount: 7, tags: [], status: 'draft', createdAt: now, updatedAt: now };
  await db.writings.add(writing);
  const passed: string[] = [];
  try {
    const initial = await runBridgeTool('wh_get_writing_document', { id });
    assert(initial.ok, 'Rich document unavailable');
    const proposal = await runBridgeTool('wh_propose_writing_revision', { id, from: 1, to: 6, text: 'Bosque', author: 'Faustus', source: 'faustus', expectedUpdatedAt: now });
    assert(proposal.ok, 'Proposal failed: ' + proposal.error);
    const pending = await getWriting(id);
    assert(pending?.content.includes('Árbol') && pending.content.includes('Bosque') && pending.content.includes('<strong>') && pending.content.includes('👩‍🚀'), 'Original, format or Unicode lost');
    const queried = await runBridgeTool('wh_get_writing_revisions', { id });
    assert(queried.ok, 'Revision read failed');
    const revisions = (queried.result as { revisions: { id: string; deletedText: string; insertedText: string; author: string; source: string }[] }).revisions;
    assert(revisions.length === 1 && revisions[0].deletedText === 'Árbol' && revisions[0].insertedText === 'Bosque' && revisions[0].author === 'Faustus' && revisions[0].source === 'faustus', 'Pending change does not match proposal');
    assert((await listSnapshotMeta(id)).length === 1, 'Recovery snapshot missing');
    const finalRead = await runBridgeTool('wh_get_writing', { id });
    assert(finalRead.ok && (finalRead.result as { content: string; pendingRevisions?: boolean }).content.includes('Bosque') && !(finalRead.result as { content: string }).content.includes('Árbol') && (finalRead.result as { pendingRevisions?: boolean }).pendingRevisions, 'General manuscript read concatenated old and new text');
    passed.push('MCP proposal preserves original, rich format, Unicode, author and recovery');

    const formatted = await runBridgeTool('wh_format_writing', { id, format: { color: '#224466' } });
    assert(formatted.ok, 'Existing rich formatting failed');
    const stillPending = await runBridgeTool('wh_get_writing_revisions', { id });
    assert((stillPending.result as { revisions: unknown[] }).revisions.length === 1, 'Existing rich tool erased pending revisions');
    passed.push('Existing rich tools preserve revision marks and metadata');

    const stale = await runBridgeTool('wh_resolve_writing_revisions', { id, decision: 'accept', expectedUpdatedAt: now });
    assert(!stale.ok && stale.code === 'conflict', 'Stale resolution accepted');
    const invalid = await runBridgeTool('wh_propose_writing_revision', { id, from: -1, to: 6, text: 'Wrong' });
    assert(!invalid.ok, 'Invalid range accepted');
    const scoped = await runBridgeTool('wh_resolve_writing_revisions', { id, decision: 'accept', __scopeProjectId: 'another-project' });
    assert(!scoped.ok && scoped.code === 'scope', 'Cross-project revision accepted');
    const beforeAccept = (await getWriting(id))!;
    const accepted = await runBridgeTool('wh_resolve_writing_revisions', { id, decision: 'accept', ids: [revisions[0].id], expectedUpdatedAt: beforeAccept.updatedAt });
    assert(accepted.ok, 'Accept failed: ' + accepted.error);
    const afterAccept = (await getWriting(id))!;
    assert(!afterAccept.content.includes('Árbol') && afterAccept.content.includes('Bosque') && !afterAccept.content.includes('data-wh-revision-kind'), 'Accepted document incorrect');
    assert(afterAccept.content.includes('Otro párrafo') && afterAccept.content.includes('👩‍🚀'), 'Untouched content changed');
    passed.push('Exact revision acceptance preserves other content and ordinary conflict/scope checks');

    const acceptAudit = (accepted.result as { __audit: Record<string, unknown> }).__audit;
    await undoAuditEntry({ entry: { ...acceptAudit, kind: 'update' } });
    assert((await getWriting(id))?.content === beforeAccept.content, 'Undo failed to restore pending change exactly');
    const rejected = await runBridgeTool('wh_resolve_writing_revisions', { id, decision: 'reject', ids: [revisions[0].id] });
    assert(rejected.ok, 'Reject failed');
    const afterReject = (await getWriting(id))!;
    assert(afterReject.content.includes('Árbol') && !afterReject.content.includes('Bosque') && !afterReject.content.includes('data-wh-revision-kind'), 'Reject failed to restore original');
    passed.push('Normal bridge undo restores review state, then rejection preserves the original');

    const literal = await runBridgeTool('wh_propose_writing_revision', { id, from: 1, to: 1, text: '<img src=x onerror=alert(1)>', author: 'Autor " de prueba', source: '<fuente>' });
    assert(literal.ok, 'Literal insertion failed');
    const literalStored = (await getWriting(id))!.content;
    assert(literalStored.includes('&lt;img') && !literalStored.includes('<img src="x"'), 'Proposal interpreted HTML');
    passed.push('Proposed text and author/source metadata are literal data, not executable markup');
    return passed;
  } finally {
    await db.writingSnapshots.where('writingId').equals(id).delete();
    await db.writings.delete(id); await db.projects.delete(projectId);
  }
}
