import { clearWritingRecoveryDraft, inspectWritingRecoveryDraft, registerWritingRecoveryOwner, writeWritingRecoveryDraft } from '@/engines/writings/recoveryJournal';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testWorkspaceRecovery(): Promise<string[]> {
  const projectId = `pane-recovery-${Date.now()}`, writing = { id: 'same-chapter', projectId, title: 'Chapter', content: '<p>Original.</p>' };
  const releasePrimary = registerWritingRecoveryOwner(projectId, writing.id), releaseCompanion = registerWritingRecoveryOwner(projectId, writing.id, 'old-pane');
  try {
    writeWritingRecoveryDraft(projectId, writing.id, writing.title, '<p>Primary unsaved.</p>', writing.title, writing.content);
    writeWritingRecoveryDraft(projectId, writing.id, writing.title, '<p>Companion unsaved.</p>', writing.title, writing.content, 'old-pane');
    assert(inspectWritingRecoveryDraft(writing, 'new-pane').kind === 'none', 'A new pane cannot adopt another live editor’s unconfirmed text');
    clearWritingRecoveryDraft(projectId, writing.id);
    const own = inspectWritingRecoveryDraft(writing, 'old-pane'); assert(own.kind === 'draft' && own.draft.content.includes('Companion'), 'A confirmed primary save clears only its own recovery copy');
    writeWritingRecoveryDraft(projectId, writing.id, writing.title, '<p>Primary unsaved.</p>', writing.title, writing.content);
    releasePrimary(); releaseCompanion();
    const reopened = inspectWritingRecoveryDraft(writing, 'reopened-pane'); assert(reopened.kind === 'draft', 'An inactive old pane journal remains recoverable after restarting');
    const content = reopened.draft.content;
    clearWritingRecoveryDraft(projectId, writing.id, 'reopened-pane');
    const remaining = inspectWritingRecoveryDraft({ ...writing, content }, 'another-pane');
    assert(remaining.kind === 'conflict' && remaining.draft.content !== content && remaining.draft.baseContent === writing.content, 'The other crash draft survives the first recovery and retains its old CAS baseline');
    const foreign = { ...writing, projectId: `${projectId}-other` };
    assert(inspectWritingRecoveryDraft(foreign).kind === 'none', 'Pane recovery never scans another project’s drafts');
    // Imported IDs can contain the suffix separator. Validation must not erase
    // a different document whose legitimate ID shares the candidate prefix.
    const nested = { ...writing, id: `${writing.id}:pane:legitimate-id` };
    writeWritingRecoveryDraft(projectId, nested.id, nested.title, '<p>Separate document.</p>', nested.title, nested.content);
    clearWritingRecoveryDraft(projectId, writing.id, 'another-pane'); inspectWritingRecoveryDraft(writing);
    assert(inspectWritingRecoveryDraft(nested).kind === 'draft', 'Prefix-shaped document IDs retain their own recovery journal');
    return ['Writing pane recovery: independent live-owner copies, guarded adoption, owner-only cleanup, multiple crash-draft recovery and project/ID isolation'];
  } finally {
    releasePrimary(); releaseCompanion();
    for (const key of Object.keys(localStorage)) if (key.startsWith(`writers-hoard:writing-recovery:${projectId}:`)) localStorage.removeItem(key);
  }
}
