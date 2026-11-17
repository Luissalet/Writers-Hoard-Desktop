// A story-state finding's proposal for the state ledger, read from the model's
// answer. Pure: it validates shape only; the author decides whether it is written.
import { JUDGE_LEDGER_ASPECTS, type JudgeLedgerProposal } from './types';

export function ledgerProposalValue(raw: unknown): JudgeLedgerProposal | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const character = typeof value.character === 'string' ? value.character.trim().slice(0, 120) : '';
  const aspect = value.aspect as JudgeLedgerProposal['aspect'];
  const text = typeof value.value === 'string' ? value.value.trim().slice(0, 300) : '';
  if (!character || !JUDGE_LEDGER_ASPECTS.includes(aspect)) return undefined;
  if (!text && aspect !== 'dies' && aspect !== 'appears') return undefined;
  return { character, aspect, value: text };
}
