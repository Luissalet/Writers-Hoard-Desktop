import { getEraProject, updateEraProjectMetadata } from '@/services/worldEras/store';
import { db } from '@/db';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { notifyProjectsChanged } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { emptyWord, isDictionaryColor, normalizeSeeAlso, normalizeSenses, type DictionaryWord, type PastedWord, type WorldDictionary } from './types';
import { parseDictionaryFont } from './fonts';

async function mutate(projectId: string, change: (dictionaries: WorldDictionary[]) => void, eraId?: string): Promise<void> {
  await db.transaction('rw', eraId ? db.tables : [db.projects], async () => {
    const project = await (eraId ? getEraProject({ projectId, eraId }) : db.projects.get(projectId));
    if (!project) throw new Error('Project not found.');
    const dictionaries = structuredClone(project.dictionaries ?? []);
    change(dictionaries);
    await updateEraProjectMetadata({ projectId, eraId }, { dictionaries, updatedAt: Date.now() });
  });
  notifyProjectsChanged();
  notifyDataChanged({ source: 'other', table: 'projects', projectId });
}

export function saveDictionary(projectId: string, dictionary: WorldDictionary, base?: WorldDictionary, eraId?: string): Promise<void> {
  if (!dictionary.name.trim()) return Promise.reject(new Error('A language name is required.'));
  if (dictionary.font) { try { parseDictionaryFont(dictionary.font); } catch (error) { return Promise.reject(error); } }
  return mutate(projectId, dictionaries => {
    const updated = { ...dictionary };
    const existing = dictionaries.find(d => d.id === dictionary.id);
    if (base) {
      if (!existing) throw new Error('Language was deleted.');
      for (const field of ['name', 'description', 'scriptMapping', 'detectInManuscript', 'showNativeInProse', 'font', 'color'] as const) {
        const equal = (left: unknown, right: unknown) => field === 'font' ? JSON.stringify(left) === JSON.stringify(right) : left === right;
        if (!equal(dictionary[field], base[field]) && !equal(existing[field], base[field]) && !equal(existing[field], dictionary[field])) throw new Error('Language changed elsewhere.');
        if (equal(dictionary[field], base[field])) Object.assign(updated, { [field]: existing[field] });
      }
    }
    if (updated.color !== undefined && !isDictionaryColor(updated.color)) throw new Error('Book colour must be #rrggbb.');
    if (existing) Object.assign(existing, { name: updated.name.trim(), description: updated.description, scriptMapping: updated.scriptMapping, detectInManuscript: updated.detectInManuscript, showNativeInProse: updated.showNativeInProse || undefined, font: updated.font, color: updated.color });
    else dictionaries.push(structuredClone(dictionary));
  }, eraId);
}

export function removeDictionary(projectId: string, id: string, eraId?: string): Promise<void> {
  return (eraId ? async (remove: () => Promise<void>) => remove() : (remove: () => Promise<void>) => archiveMetadataWithMutation('dictionary',projectId,id,remove))(()=>mutate(projectId, dictionaries => { const index = dictionaries.findIndex(d => d.id === id); if (index >= 0) dictionaries.splice(index, 1); }, eraId));
}

export function saveWord(projectId: string, dictionaryId: string, word: DictionaryWord, base?: DictionaryWord, eraId?: string): Promise<void> {
  if (!word.word.trim() || !word.meaning.trim()) return Promise.reject(new Error('Spelling and meaning are required.'));
  let senses: DictionaryWord['senses'], seeAlso: DictionaryWord['seeAlso'];
  try { senses = normalizeSenses(word.senses); seeAlso = normalizeSeeAlso(word.seeAlso, word.word); } catch (error) { return Promise.reject(error); }
  return mutate(projectId, dictionaries => {
    const dictionary = dictionaries.find(d => d.id === dictionaryId);
    if (!dictionary) throw new Error('Dictionary not found.');
    const index = dictionary.words.findIndex(item => item.id === word.id);
    const updated: DictionaryWord = { ...word, word: word.word.trim() };
    if (senses) updated.senses = senses; else delete updated.senses;
    if (seeAlso) updated.seeAlso = seeAlso; else delete updated.seeAlso;
    if (base) {
      const existing = dictionary.words[index]; if (!existing) throw new Error('Word was deleted.');
      // Lists compare by what they hold, not by which array they are.
      const same = (a: unknown, b: unknown) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : a === b);
      for (const field of new Set([...Object.keys(updated), ...Object.keys(base)]) as Set<keyof DictionaryWord>) {
        if (!same(updated[field], base[field]) && !same(existing[field], base[field]) && !same(existing[field], updated[field])) throw new Error('Word changed elsewhere.');
        if (same(updated[field], base[field])) {
          if (existing[field] === undefined) delete updated[field]; else Object.assign(updated, { [field]: existing[field] });
        }
      }
    }
    if (index < 0) dictionary.words.push(updated); else dictionary.words[index] = updated;
  }, eraId);
}

/**
 * Add a pasted list of words in one save: each with its meaning (and part of
 * speech if given). A word already in the dictionary with the same spelling
 * and meaning is skipped, so pasting the same list twice adds nothing.
 */
export async function importWords(projectId: string, dictionaryId: string, rows: readonly PastedWord[], eraId?: string): Promise<{ added: number; skipped: number }> {
  if (rows.length > 5000) throw new Error('Up to 5000 words at a time.');
  let added = 0, skipped = 0;
  await mutate(projectId, dictionaries => {
    const dictionary = dictionaries.find(d => d.id === dictionaryId);
    if (!dictionary) throw new Error('Dictionary not found.');
    const key = (word: string, meaning: string) => `${word.normalize('NFC').trim().toLocaleLowerCase()}\u0000${meaning.trim().toLocaleLowerCase()}`;
    const have = new Set(dictionary.words.map(word => key(word.word, word.meaning)));
    for (const row of rows) {
      const k = key(row.word, row.meaning);
      if (!row.word.trim() || !row.meaning.trim() || have.has(k)) { skipped++; continue; }
      have.add(k);
      dictionary.words.push({ ...emptyWord(), word: row.word.trim(), meaning: row.meaning.trim(), partOfSpeech: row.partOfSpeech.trim() });
      added++;
    }
  }, eraId);
  return { added, skipped };
}

export function removeWord(projectId: string, dictionaryId: string, id: string, eraId?: string): Promise<void> {
  return mutate(projectId, dictionaries => { const dictionary = dictionaries.find(d => d.id === dictionaryId); if (!dictionary) throw new Error('Dictionary not found.'); dictionary.words = dictionary.words.filter(word => word.id !== id); }, eraId);
}
