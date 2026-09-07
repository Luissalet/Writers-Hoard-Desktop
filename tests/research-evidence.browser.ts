import { db } from '@/db';
import { saveCitation, deleteCitation, citationFromSnapshot } from '@/services/projectTools';
import type { Project } from '@/types';
import { getResearchEvidence, ResearchEvidenceError, safeResearchUrl, saveResearchEvidence, type EvidenceInput } from '@/services/researchEvidence';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function rejects(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (error) { assert(error instanceof ResearchEvidenceError && error.code === code, `Expected ${code}`); return; }
  throw new Error(`Expected rejection: ${code}`);
}
async function rejectsAny(action: () => Promise<unknown>) {
  let rejected = false;
  try { await action(); } catch { rejected = true; }
  assert(rejected, 'Mutation should have been rejected');
}
export async function testResearchEvidence(): Promise<string[]> {
  const projectId = `evidence-test-${crypto.randomUUID()}`;
  const otherId = `${projectId}-other`;
  const snapshotId = `${projectId}-snapshot`;
  const now = Date.now();
  const consultedAt = new Date(2026, 6, 27, 0, 30).getTime();
  const project: Project = { id: projectId, title: 'Evidence test', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: now, updatedAt: now };
  const input: EvidenceInput = { statement: 'The witness reported rain.', kind: 'attribution', quote: '  It rained.\nExactly then.  ', locator: 'page 4', status: 'pending', notes: '' };
  try {
    await db.projects.bulkAdd([project, { ...project, id: otherId }]);
    await db.snapshots.add({ id: snapshotId, projectId, url: 'https://example.org/source', title: 'Interview', source: 'url', status: 'success', notes: '', tags: [], preservedAt: consultedAt, createdAt: now });
    await rejects(() => saveResearchEvidence(otherId, { snapshotId }, input), 'scope');
    const first = await saveResearchEvidence(projectId, { snapshotId }, input);
    let rows = await getResearchEvidence(projectId);
    assert(rows.length === 1 && rows[0].evidence.quote === input.quote, 'Literal whitespace and line breaks must remain intact');
    assert(!first.reviewedAt, 'Pending claim cannot look reviewed');
    assert(rows[0].citation.accessedAt === '2026-07-27', 'Evidence citation keeps the local consultation day');
    const citationId = rows[0].citation.id;
    await rejects(() => saveResearchEvidence(otherId, { citationId }, input), 'scope');
    await rejects(() => saveResearchEvidence(projectId, { citationId }, { ...input, status: 'reviewed', quote: ' ' }), 'quote');
    const reviewed = await saveResearchEvidence(projectId, { citationId }, { ...input, status: 'reviewed' }, { id: first.id, expectedUpdatedAt: first.updatedAt });
    assert(reviewed.reviewedAt && reviewed.id === first.id, 'Author review must preserve identity and record date');
    await rejects(() => saveResearchEvidence(projectId, { citationId }, input, { id: first.id, expectedUpdatedAt: first.updatedAt }), 'conflict');
    await saveResearchEvidence(projectId, { snapshotId }, { ...input, statement: 'An interpretation', kind: 'interpretation' });
    assert(await db.citations.where('projectId').equals(projectId).count() === 1, 'Reusing clipping must not duplicate citation');
    await saveResearchEvidence(projectId, { citationId }, { ...input, status: 'disputed' }, { id: reviewed.id, expectedUpdatedAt: reviewed.updatedAt });
    rows = await getResearchEvidence(projectId);
    assert(rows.find(row => row.evidence.id === first.id)?.evidence.reviewedAt === undefined, 'Reopened review clears the review date');
    assert((await getResearchEvidence(otherId)).length === 0, 'Project isolation');
    const staleCitation = (await db.citations.get(citationId))!;
    const beforeCount = staleCitation.researchEvidence!.length;
    await Promise.all([
      saveCitation({ ...staleCitation, title: 'Updated metadata', researchEvidence: [] }),
      saveResearchEvidence(projectId, { citationId }, { ...input, statement: 'Concurrent new claim' }),
    ]);
    const currentCitation = (await db.citations.get(citationId))!;
    assert(currentCitation.researchEvidence?.length === beforeCount + 1, 'Concurrent metadata edit must preserve all evidence');
    await rejectsAny(() => deleteCitation(citationId, { projectId, expectedUpdatedAt: staleCitation.updatedAt }));
    await rejectsAny(() => deleteCitation(citationId, { projectId: otherId, expectedUpdatedAt: currentCitation.updatedAt }));
    await rejectsAny(() => saveCitation({ ...currentCitation, projectId: otherId }));
    await rejectsAny(() => saveCitation({ ...currentCitation, url: 'https://example.org/replaced' }));
    await rejectsAny(() => saveCitation({ ...currentCitation, snapshotId: undefined }));
    const reused = await citationFromSnapshot(snapshotId);
    assert(reused.id === citationId && reused.researchEvidence?.length === beforeCount + 1, 'Citing again retains evidence and identity');
    await db.citations.update(citationId, { url: 'javascript:alert(1)' });
    await rejects(() => saveResearchEvidence(projectId, { citationId }, input), 'url');
    assert(!safeResearchUrl('file:///secret') && !safeResearchUrl('https://user:pass@example.org') && safeResearchUrl('https://example.org'), 'Only credential-free web links');
    const deletionTarget = (await db.citations.get(citationId))!;
    await deleteCitation(citationId, { projectId, expectedUpdatedAt: deletionTarget.updatedAt });
    assert((await getResearchEvidence(projectId)).length === 0 && await db.snapshots.get(snapshotId), 'Explicit deletion removes attached evidence and preserves original clipping');
    await rejectsAny(() => saveCitation({ ...deletionTarget, title: 'Stale edit must not resurrect deleted source' }));
    return ['Research evidence: literal provenance, project isolation, review transitions, optimistic concurrency, clipping reuse, unsafe URLs, concurrent citation preservation and guarded deletion'];
  } finally {
    await db.citations.where('projectId').equals(projectId).delete();
    await db.snapshots.delete(snapshotId);
    await db.projects.bulkDelete([projectId, otherId]);
  }
}
