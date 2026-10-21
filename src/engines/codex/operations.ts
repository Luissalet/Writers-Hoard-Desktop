import Dexie from 'dexie';
import { makeTableOps } from '@/engines/_shared';
import type { CodexEntry } from '@/types';
import { db } from '@/db';
import { updateCodexEntry } from '@/db/operations';
import { readWorldDocument, saveEraDocument } from '@/services/worldEras/store';
import type { WorldEraScope, EraRow } from '@/services/worldEras/types';

export type CodexEditableKey = 'title' | 'content' | 'tags' | 'avatar' | 'avatarOriginal' | 'templateId' | 'type';
export interface CodexFieldConflict {
  key: CodexEditableKey | `fields.${string}` | `referenceFields.${string}`;
  current: string | string[] | undefined;
  draft: string | string[] | undefined;
}
export class CodexEditConflict extends Error {
  readonly conflicts: CodexFieldConflict[];
  readonly current: CodexEntry;
  constructor(conflicts: CodexFieldConflict[], current: CodexEntry) {
    super('Codex fields changed while editing');
    this.name = 'CodexEditConflict';
    this.conflicts = conflicts;
    this.current = current;
  }
}

const editableKeys: CodexEditableKey[] = ['title', 'content', 'tags', 'avatar', 'avatarOriginal', 'templateId', 'type'];
const equalValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fieldValue = (entry: CodexEntry, key: CodexEditableKey) => key === 'avatarOriginal'
  ? entry.avatarOriginal || entry.avatar || undefined
  : entry[key];

/** Three-way merge inside the same transaction as character-name propagation. */
export async function saveCodexDraft(base: CodexEntry, draft: CodexEntry, scope?: WorldEraScope): Promise<CodexEntry> {
  if (base.id !== draft.id || base.projectId !== draft.projectId) throw new Error('Codex draft scope changed');
  return db.transaction('rw', scope?.eraId ? db.tables : [db.codexEntries, db.relationships, db.characterArcs], () => Dexie.Promise.resolve(scope?.eraId?readWorldDocument(scope,'codex',base.id):undefined).then(eraRead=>Dexie.Promise.resolve(scope?.eraId?eraRead?.document.root as unknown as CodexEntry|undefined:db.codexEntries.get(base.id)).then(current=>{
    if (!current || current.projectId !== base.projectId) throw new Error('Codex entry no longer exists in this project');
    const changes: Partial<CodexEntry> = {};
    const conflicts: CodexFieldConflict[] = [];
    for (const key of editableKeys) {
      const next = fieldValue(draft, key);
      const previous = fieldValue(base, key);
      const remote = fieldValue(current, key);
      if (equalValue(next, previous)) continue;
      if (!equalValue(remote, previous) && !equalValue(remote, next)) {
        conflicts.push({ key, current: remote, draft: next });
      } else {
        Object.assign(changes, { [key]: draft[key] });
      }
    }
    const fields = { ...current.fields };
    let fieldsChanged = false;
    for (const key of new Set([...Object.keys(base.fields), ...Object.keys(draft.fields)])) {
      const next = draft.fields[key];
      const previous = base.fields[key];
      const remote = current.fields[key];
      if (equalValue(next, previous)) continue;
      if (!equalValue(remote, previous) && !equalValue(remote, next)) {
        conflicts.push({ key: `fields.${key}`, current: remote, draft: next });
      } else {
        if (next === undefined) delete fields[key];
        else fields[key] = next;
        fieldsChanged = true;
      }
    }
    if (fieldsChanged) changes.fields = fields;
    const references = { ...(current.referenceFields ?? {}) };
    let referencesChanged = false;
    for (const key of new Set([...Object.keys(base.referenceFields ?? {}), ...Object.keys(draft.referenceFields ?? {})])) {
      const next = draft.referenceFields?.[key];
      const previous = base.referenceFields?.[key];
      const remote = current.referenceFields?.[key];
      if (equalValue(next, previous)) continue;
      if (!equalValue(remote, previous) && !equalValue(remote, next)) conflicts.push({ key: `referenceFields.${key}`, current: remote, draft: next });
      else { if (next === undefined) delete references[key]; else references[key] = [...next]; referencesChanged = true; }
    }
    if (conflicts.length) throw new CodexEditConflict(conflicts, current);
    if (referencesChanged) changes.referenceFields = references;
    if (Object.keys(changes).length) {
      if (scope?.eraId && eraRead) return saveEraDocument(scope, 'codex', { root: { ...current, ...changes } as unknown as EraRow, children: {} }, eraRead.version).then(result=>result.document.root as unknown as CodexEntry);
      return Dexie.Promise.resolve(updateCodexEntry(base.id,changes)).then(()=>db.codexEntries.get(base.id)).then(result=>result!);
    }
    return current;
  })));
}

export const codexEntryOps = makeTableOps<CodexEntry>({
  tableName: 'codexEntries',
  scopeField: 'projectId',
});
