import { candidateOwnerKey, validateEntityCandidateDismissals, type EntityCandidateDecision, type EntityCandidateDismissalLedger, type EntityCandidateScope } from './dismissalTypes';

export function dismissalSnapshot(ledger: EntityCandidateDismissalLedger | undefined, scope: EntityCandidateScope) {
  validateEntityCandidateDismissals(ledger);
  const owner = ledger?.owners.find(row => candidateOwnerKey(row) === candidateOwnerKey(scope));
  return { ...structuredClone(scope), lifetime: 'document' as const, revision: owner?.revision ?? 0, decisions: structuredClone(owner?.decisions ?? []) };
}
/** Pure per-key CAS; unrelated names and owners are retained verbatim. */
export function changeCandidateDecision(ledger: EntityCandidateDismissalLedger | undefined, scope: EntityCandidateScope, name: string, key: string, discarded: boolean, expectedVersion: string) {
  const before = dismissalSnapshot(ledger, scope), current = before.decisions.find(row => row.key === key);
  if ((current?.discarded ?? false) === discarded) return { changed: false as const, ledger, before, current };
  if ((current?.version ?? '') !== expectedVersion) throw Error('entity_candidate_dismissal_conflict');
  if (before.revision === Number.MAX_SAFE_INTEGER) throw Error('entity_candidate_dismissal_revision_invalid');
  const next: EntityCandidateDismissalLedger = structuredClone(ledger ?? { version: 1, owners: [] });
  let owner = next.owners.find(row => candidateOwnerKey(row) === candidateOwnerKey(scope));
  if (!owner) { owner = { ...(scope.eraId ? { eraId: scope.eraId } : {}), context: structuredClone(scope.context), revision: 0, decisions: [] }; next.owners.push(owner); }
  const decision: EntityCandidateDecision = { key, name: current?.name ?? name, discarded, version: crypto.randomUUID() };
  owner.decisions = [...owner.decisions.filter(row => row.key !== key), decision]; owner.revision++;
  return { changed: true as const, ledger: next, before, current, decision };
}
/** Installation/copy renews tokens; ordinary reads and exports never call this. */
export function renewCandidateDismissals(value: EntityCandidateDismissalLedger, remap?: (id: string, prefix: string) => string): EntityCandidateDismissalLedger {
  validateEntityCandidateDismissals(value);
  return { version: 1, owners: value.owners.map(owner => ({
    ...(owner.eraId ? { eraId: remap ? remap(owner.eraId, 'era') : owner.eraId } : {}),
    context: { ...owner.context, documentId: remap ? remap(owner.context.documentId, owner.context.kind === 'writings' ? 'wr' : 'codex') : owner.context.documentId, ...(owner.context.kind === 'writings' && owner.context.draftId ? { draftId: remap ? remap(owner.context.draftId, 'wsnap') : owner.context.draftId } : {}) },
    revision: 0, decisions: owner.decisions.map(decision => ({ ...decision, version: crypto.randomUUID() })),
  })) };
}
