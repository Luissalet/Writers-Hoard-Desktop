import { foldAlias } from '@/services/codexReference/aliases';

export type EntityCandidateContext = { kind: 'writings'; documentId: string; draftId?: string } | { kind: 'codex'; documentId: string };
export interface EntityCandidateScope { projectId: string; eraId?: string; context: EntityCandidateContext }
export interface EntityCandidateDecision { key: string; name: string; discarded: boolean; version: string }
export interface EntityCandidateOwnerDecisions { eraId?: string; context: EntityCandidateContext; revision: number; decisions: EntityCandidateDecision[] }
export interface EntityCandidateDismissalLedger { version: 1; owners: EntityCandidateOwnerDecisions[] }
export interface EntityCandidateDismissals extends EntityCandidateScope { lifetime: 'document'; revision: number; decisions: EntityCandidateDecision[] }
export interface EntityCandidateDismissalResult extends EntityCandidateDismissals { changed: boolean; receiptId?: string }
export const candidateKey = (name: string) => foldAlias(name.trim());
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export function validateEntityCandidateContext(value: unknown): asserts value is EntityCandidateContext {
  if (!object(value) || !keys(value, ['kind', 'documentId', 'draftId']) || !['writings', 'codex'].includes(String(value.kind)) || !text(value.documentId) || (value.draftId !== undefined && (value.kind !== 'writings' || !text(value.draftId)))) throw Error('entity_candidate_context_invalid');
}
export const candidateOwnerKey = (owner: { eraId?: string; context: EntityCandidateContext }) => JSON.stringify([owner.eraId ?? null, owner.context.kind, owner.context.documentId, owner.context.kind === 'writings' ? owner.context.draftId ?? null : null]);
export function validateEntityCandidateDismissals(value: unknown): asserts value is EntityCandidateDismissalLedger | undefined {
  if (value === undefined) return;
  if (!object(value) || !keys(value, ['version', 'owners']) || value.version !== 1 || !Array.isArray(value.owners)) throw Error('entity_candidate_dismissals_invalid');
  const owners = new Set<string>();
  for (const row of value.owners) {
    if (!object(row) || !keys(row, ['eraId', 'context', 'revision', 'decisions']) || (row.eraId !== undefined && !text(row.eraId)) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || !Array.isArray(row.decisions)) throw Error('entity_candidate_dismissals_invalid');
    validateEntityCandidateContext(row.context);
    const owner = candidateOwnerKey(row as unknown as EntityCandidateOwnerDecisions);
    if (owners.has(owner)) throw Error('entity_candidate_dismissals_invalid'); owners.add(owner);
    const seen = new Set<string>();
    for (const decision of row.decisions) {
      if (!object(decision) || !keys(decision, ['key', 'name', 'discarded', 'version']) || !text(decision.name) || !text(decision.key) || decision.key !== candidateKey(decision.name) || seen.has(String(decision.key)) || typeof decision.discarded !== 'boolean' || !text(decision.version)) throw Error('entity_candidate_dismissals_invalid');
      seen.add(String(decision.key));
    }
  }
}
