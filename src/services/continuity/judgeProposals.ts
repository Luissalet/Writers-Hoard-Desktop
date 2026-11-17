// The Judge's story-state proposals for the state ledger: shown on the finding,
// written only when the author accepts one, put aside when they dismiss it.
import { db } from '@/db';
import { fold } from '@/engines/writings/continuity/ledger';
import type { LedgerEntry } from '@/engines/writings/continuity/types';
import type { JudgeFinding } from '@/services/judge/types';
import type { CodexEntry } from '@/types';
import { addLedgerEntry, type ContinuityReceipt } from './ledgerOps';

/** The character card a proposal names: same title, or a title whose first word is the name. */
export function matchCharacter(cards: readonly CodexEntry[], name: string): CodexEntry | null {
  const wanted = fold(name);
  const characters = cards.filter((c) => c.type === 'character');
  return characters.find((c) => fold(c.title) === wanted)
    ?? characters.find((c) => fold(c.title).split(' ')[0] === wanted)
    ?? null;
}

export async function acceptLedgerProposal(finding: JudgeFinding): Promise<ContinuityReceipt & { characterId: string }> {
  const proposal = finding.ledgerProposal;
  if (!proposal || proposal.status) throw new Error('This finding has no open proposal.');
  const cards = await db.codexEntries.where('projectId').equals(finding.projectId).toArray();
  const character = matchCharacter(cards, proposal.character);
  if (!character) throw new Error(`No character card is called "${proposal.character}".`);
  const entry: Partial<LedgerEntry> = { writingId: finding.writingId, kind: proposal.aspect, source: 'judge' };
  if (proposal.aspect === 'location') entry.place = { label: proposal.value };
  if (proposal.aspect === 'learns') entry.fact = proposal.value;
  if (proposal.aspect === 'gains' || proposal.aspect === 'loses') {
    const item = cards.find((c) => c.type === 'item' && fold(c.title) === fold(proposal.value));
    if (item) entry.itemId = item.id; else entry.item = proposal.value;
  }
  if (proposal.aspect === 'condition') entry.text = proposal.value;
  const receipt = await addLedgerEntry(finding.projectId, character.id, entry);
  await db.judgeFindings.update(finding.id, { ledgerProposal: { ...proposal, status: 'accepted' }, updatedAt: Date.now() });
  return receipt;
}

export async function dismissLedgerProposal(finding: JudgeFinding): Promise<void> {
  if (!finding.ledgerProposal) return;
  await db.judgeFindings.update(finding.id, { ledgerProposal: { ...finding.ledgerProposal, status: 'dismissed' }, updatedAt: Date.now() });
}
