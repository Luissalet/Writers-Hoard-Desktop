import { db } from '@/db';
import Dexie, { type Transaction } from 'dexie';
import { loadPaneDocument } from '@/engines/writings/parallelDrafts';
import { readEraRow } from '@/services/worldEras/store';
import { candidateKey, candidateOwnerKey, validateEntityCandidateContext, type EntityCandidateScope, type EntityCandidateDecision, type EntityCandidateDismissalLedger, type EntityCandidateDismissalResult } from './dismissalTypes';
import { changeCandidateDecision, dismissalSnapshot } from './dismissals';
import { createCodexEntry, notifyProjectsChanged } from '@/db/operations';
import { announceEraChange, assertWorldEra, listEraRows, saveEraDocument } from '@/services/worldEras/store';
import { createMentionIndex } from '@/services/codexReference/indexedMentions';
import { entryNames } from '@/services/codexReference/matcher';
import { foldAlias } from '@/services/codexReference/aliases';
import { generateId } from '@/utils/idGenerator';
import type { CodexEntry, CodexEntryType } from '@/types';
import type { EraRow } from '@/services/worldEras/types';
import { DEFAULT_ENTITY_PREFERENCES, type EntityDetectionPreferences, type EntitySpan } from './types';

export const suggestedEntityType = (label: EntitySpan['label']): CodexEntryType => label === 'PER' ? 'character' : label === 'LOC' ? 'location' : 'faction';
export function entityPreferences(project: { entityDetectionPreferences?: EntityDetectionPreferences }): EntityDetectionPreferences { return { ...DEFAULT_ENTITY_PREFERENCES, ...project.entityDetectionPreferences }; }
export function validateEntityPreferences(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('entity_preferences_invalid');
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 0 || ['detectNewEntities', 'autoLinkMentions', 'animateNewLinks'].some(key => typeof record[key] !== 'boolean') || Object.keys(record).some(key => !['revision', 'detectNewEntities', 'autoLinkMentions', 'animateNewLinks'].includes(key))) throw Error('entity_preferences_invalid');
}
/** Shared by all eras; only this metadata field is updated under CAS. */
export async function updateEntityDetectionPreferences(projectId: string, patch: Partial<Omit<EntityDetectionPreferences, 'revision'>>, expectedRevision: number): Promise<EntityDetectionPreferences> {
  const result = await db.transaction('rw', db.projects, async () => {
    const project = await assertWorldEra({ projectId }), current = entityPreferences(project);
    if (current.revision !== expectedRevision) throw Error('entity_preferences_conflict');
    const next = { ...current, ...patch, revision: current.revision + 1 }; validateEntityPreferences(next);
    await db.projects.update(projectId, { entityDetectionPreferences: next, updatedAt: Math.max(Date.now(), project.updatedAt + 1) }); return next;
  }); notifyProjectsChanged(); return result;
}
/** Known names and aliases, including ambiguous ones, are never new-card suggestions. */
export function newEntityCandidates(text: string, spans: EntitySpan[], entries: CodexEntry[]): EntitySpan[] {
  const known = createMentionIndex(entries).find(text), seen = new Set<string>();
  return spans.filter(span => {
    if (!Number.isInteger(span.from) || !Number.isInteger(span.to) || span.from < 0 || span.to <= span.from || text.slice(span.from, span.to) !== span.text || !['PER', 'LOC', 'ORG'].includes(span.label) || !Number.isFinite(span.score)) return false;
    const key = foldAlias(span.text.trim());
    if (!key || seen.has(key) || known.some(match => match.from <= span.from && match.to >= span.to)) return false;
    seen.add(key); return true;
  });
}
export interface CreateEntityCandidateInput { projectId: string; eraId?: string; text: string; candidate: EntitySpan; type: CodexEntryType }
/** Ordinary explicit creation. No biography, relationship, or prose change is inferred. */
export async function createEntityCandidate(input: CreateEntityCandidateInput, assertCurrent?: () => void): Promise<CodexEntry> {
  if (!['character', 'location', 'faction', 'item', 'concept', 'magic', 'custom'].includes(input.type)) throw Error('entity_type_invalid');
  return db.transaction('rw', db.tables, async () => {
    const scope = { projectId: input.projectId, eraId: input.eraId }, project = await assertWorldEra(scope);
    if (!project.enabledEngines.includes('codex')) throw Error('codex_engine_disabled');
    const entries = scope.eraId ? await listEraRows<CodexEntry>(scope, 'codexEntries') : await db.codexEntries.where('projectId').equals(scope.projectId).toArray();
    if (!newEntityCandidates(input.text, [input.candidate], entries).length || entries.some(entry => entryNames(entry).some(name => foldAlias(name.trim()) === foldAlias(input.candidate.text.trim())))) throw Error('entity_candidate_stale_or_existing');
    // UI and document-aware bridge callers recheck their live source after reads,
    // immediately before scheduling the write in this transaction.
    assertCurrent?.();
    const now = Date.now(), entry: CodexEntry = { id: generateId('codex'), projectId: scope.projectId, title: input.candidate.text.trim(), type: input.type, fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now };
    if (scope.eraId) await saveEraDocument(scope, 'codex', { root: entry as unknown as EraRow, children: {} }, null); else await createCodexEntry(entry);
    announceEraChange(scope.projectId); return entry;
  });
}

async function dismissalProject(scope: EntityCandidateScope) {
  validateEntityCandidateContext(scope.context);
  const project = await assertWorldEra(scope);
  if (scope.context.kind === 'writings') await loadPaneDocument(scope.projectId, { writingId: scope.context.documentId, draftId: scope.context.draftId }, scope.eraId);
  else {
    const entry = scope.eraId ? await readEraRow<CodexEntry>(scope, 'codexEntries', scope.context.documentId) : await db.codexEntries.get(scope.context.documentId);
    if (!entry || entry.projectId !== scope.projectId) throw Error('entity_candidate_owner_missing');
  }
  return project;
}
export async function getEntityCandidateDismissals(scope: EntityCandidateScope) {
  return dismissalSnapshot((await dismissalProject(scope)).entityCandidateDismissals, scope);
}
interface DismissalReceipt { scope: EntityCandidateScope; key: string; before?: EntityCandidateDecision; after: string; ownerExisted: boolean; ledgerExisted: boolean; reserved: boolean }
// Only committed Undo receipts live in memory. Decisions always come from IDB.
const dismissalReceipts = new Map<string, DismissalReceipt>();
function rootTransaction(): Transaction { let tx = Dexie.currentTransaction!; while (tx.parent) tx = tx.parent; return tx; }
export type EntityCandidateDismissalAction = { action: 'dismiss'; text: string; candidate: EntitySpan; expectedVersion: string } | { action: 'restore'; key: string; expectedVersion: string } | { action: 'undo'; receiptId: string };
export async function actOnEntityCandidateDismissal(scope: EntityCandidateScope, action: EntityCandidateDismissalAction, assertCurrent?: () => void): Promise<EntityCandidateDismissalResult> {
  let reservation: DismissalReceipt | undefined;
  try {
    return await db.transaction('rw', db.tables, async () => {
      const project = await dismissalProject(scope), ledger = project.entityCandidateDismissals;
      const before = dismissalSnapshot(ledger, scope), tx = rootTransaction();
      let next: EntityCandidateDismissalLedger | undefined, receiptId: string | undefined;
      if (action.action === 'undo') {
        const receipt = dismissalReceipts.get(action.receiptId);
        if (!receipt || receipt.reserved || receipt.scope.projectId !== scope.projectId || candidateOwnerKey(receipt.scope) !== candidateOwnerKey(scope)) throw Error('entity_candidate_dismissal_receipt_invalid');
        const current = before.decisions.find(row => row.key === receipt.key);
        if (!current || current.version !== receipt.after) throw Error('entity_candidate_dismissal_conflict');
        receipt.reserved = true; reservation = receipt;
        tx.on('abort', () => { receipt.reserved = false; });
        next = structuredClone(ledger!);
        const owner = next.owners.find(row => candidateOwnerKey(row) === candidateOwnerKey(scope))!;
        if (owner.revision === Number.MAX_SAFE_INTEGER) throw Error('entity_candidate_dismissal_revision_invalid');
        owner.decisions = owner.decisions.filter(row => row.key !== receipt.key);
        if (receipt.before) owner.decisions.push({ ...receipt.before, version: crypto.randomUUID() });
        owner.revision++;
        if (!owner.decisions.length && !receipt.ownerExisted) next.owners = next.owners.filter(row => row !== owner);
        if (!next.owners.length && !receipt.ledgerExisted) next = undefined;
        tx.on('complete', () => { dismissalReceipts.delete(action.receiptId); });
      } else {
        if (typeof action.expectedVersion !== 'string') throw Error('entity_candidate_dismissal_version_required');
        let name: string, key: string;
        if (action.action === 'dismiss') {
          const entries = scope.eraId ? await listEraRows<CodexEntry>(scope, 'codexEntries') : await db.codexEntries.where('projectId').equals(scope.projectId).toArray();
          if (!action.candidate || !newEntityCandidates(action.text, [action.candidate], entries).length) throw Error('entity_candidate_stale_or_existing');
          name = action.candidate.text.trim(); key = candidateKey(name);
        } else {
          key = action.key; const current = before.decisions.find(row => row.key === key);
          if (!key) throw Error('entity_candidate_dismissal_key_invalid');
          name = current?.name ?? key;
        }
        const change = changeCandidateDecision(ledger, scope, name, key, action.action === 'dismiss', action.expectedVersion);
        if (!change.changed) return { ...before, changed: false };
        next = change.ledger; receiptId = crypto.randomUUID();
        const receipt: DismissalReceipt = { scope: structuredClone(scope), key, before: change.current, after: change.decision.version, ownerExisted: !!ledger?.owners.some(row => candidateOwnerKey(row) === candidateOwnerKey(scope)), ledgerExisted: ledger !== undefined, reserved: false };
        const id = receiptId; tx.on('complete', () => { dismissalReceipts.set(id, receipt); });
      }
      assertCurrent?.();
      await db.projects.where('id').equals(scope.projectId).modify(row => { if (next === undefined) delete row.entityCandidateDismissals; else row.entityCandidateDismissals = next; });
      announceEraChange(scope.projectId, true);
      return { ...dismissalSnapshot(next, scope), changed: true, ...(receiptId ? { receiptId } : {}) };
    });
  } catch (cause) { if (reservation) reservation.reserved = false; throw cause; }
}
