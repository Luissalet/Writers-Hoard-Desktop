import { db } from '@/db';
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
