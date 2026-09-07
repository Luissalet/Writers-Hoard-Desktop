import { makeTableOps } from '@/engines/_shared';
import type { CodexEntry } from '@/types';
import { db } from '@/db';
import { updateCodexEntry } from '@/db/operations';

export type CodexEditableKey = 'title' | 'content' | 'tags' | 'avatar' | 'avatarOriginal';
export interface CodexFieldConflict {
  key: CodexEditableKey | `fields.${string}`;
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

const editableKeys: CodexEditableKey[] = ['title', 'content', 'tags', 'avatar', 'avatarOriginal'];
const equalValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fieldValue = (entry: CodexEntry, key: CodexEditableKey) => key === 'avatarOriginal'
  ? entry.avatarOriginal || entry.avatar || undefined
  : entry[key];

/** Three-way merge inside the same transaction as character-name propagation. */
export async function saveCodexDraft(base: CodexEntry, draft: CodexEntry): Promise<CodexEntry> {
  if (base.id !== draft.id || base.projectId !== draft.projectId) throw new Error('Codex draft scope changed');
  return db.transaction('rw', [db.codexEntries, db.relationships, db.characterArcs], async () => {
    const current = await db.codexEntries.get(base.id);
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
    if (conflicts.length) throw new CodexEditConflict(conflicts, current);
    if (fieldsChanged) changes.fields = fields;
    if (Object.keys(changes).length) await updateCodexEntry(base.id, changes);
    return (await db.codexEntries.get(base.id))!;
  });
}

export const codexEntryOps = makeTableOps<CodexEntry>({
  tableName: 'codexEntries',
  scopeField: 'projectId',
});
