import { useEffect, useState } from 'react';
import { createLocalDraftStore } from '@/hooks/localDraftStore';
import type { DictionaryWord, WorldDictionary } from './types';

type Value = DictionaryWord | WorldDictionary;
export interface DictionaryRecovery { kind: 'language' | 'word'; dictionaryId?: string; base: Value; value: Value; existing: boolean }
export function dictionaryDrafts(projectId: string) {
  return createLocalDraftStore<DictionaryRecovery>(`wh.dictionary-drafts.v1.${projectId}`, (value): value is DictionaryRecovery => {
    if (!value || typeof value !== 'object') return false;
    const row = value as Partial<DictionaryRecovery>;
    const fields = row.kind === 'language' ? ['id', 'name', 'description', 'scriptMapping'] : ['id', 'word', 'nativeForm', 'pronunciation', 'partOfSpeech', 'meaning', 'examples', 'phrases', 'derivatives', 'origin'];
    return (row.kind === 'language' || row.kind === 'word') && typeof row.existing === 'boolean' && (row.kind !== 'word' || typeof row.dictionaryId === 'string') && [row.base, row.value].every(item => item && fields.every(field => typeof (item as unknown as Record<string, unknown>)[field] === 'string') && (row.kind !== 'language' || typeof (item as WorldDictionary).detectInManuscript === 'boolean' && Array.isArray((item as WorldDictionary).words)));
  });
}

export function useDictionaryDraft<T extends Value>(projectId: string, kind: DictionaryRecovery['kind'], initial: T, existing: boolean, dictionaryId?: string) {
  const store = dictionaryDrafts(projectId); const key = `${kind}:${initial.id}`;
  const [recovery] = useState(() => store.get(key));
  const [base] = useState(() => (recovery?.base ?? initial) as T);
  const [draft, setDraft] = useState(() => (recovery?.value ?? initial) as T);
  const [wasExisting] = useState(recovery?.existing ?? existing);
  useEffect(() => {
    const compact = (value: T): Value => kind === 'language' ? { ...value, words: [] } as WorldDictionary : value;
    if (JSON.stringify(draft) !== JSON.stringify(base)) store.set(key, { kind, dictionaryId, base: compact(base), value: compact(draft), existing: wasExisting });
  }, [base, dictionaryId, draft, key, kind, store, wasExisting]);
  return { draft, setDraft, base: wasExisting ? base : undefined, recovered: Boolean(recovery), clear: () => store.delete(key) };
}
