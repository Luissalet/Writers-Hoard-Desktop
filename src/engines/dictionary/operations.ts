import { getEraProject, updateEraProjectMetadata } from '@/services/worldEras/store';
import { db } from '@/db';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { notifyProjectsChanged } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { DictionaryWord, WorldDictionary } from './types';
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
      for (const field of ['name', 'description', 'scriptMapping', 'detectInManuscript', 'font'] as const) {
        const equal = (left: unknown, right: unknown) => field === 'font' ? JSON.stringify(left) === JSON.stringify(right) : left === right;
        if (!equal(dictionary[field], base[field]) && !equal(existing[field], base[field]) && !equal(existing[field], dictionary[field])) throw new Error('Language changed elsewhere.');
        if (equal(dictionary[field], base[field])) Object.assign(updated, { [field]: existing[field] });
      }
    }
    if (existing) Object.assign(existing, { name: updated.name.trim(), description: updated.description, scriptMapping: updated.scriptMapping, detectInManuscript: updated.detectInManuscript, font: updated.font });
    else dictionaries.push(structuredClone(dictionary));
  }, eraId);
}

export function removeDictionary(projectId: string, id: string, eraId?: string): Promise<void> {
  return (eraId ? async (remove: () => Promise<void>) => remove() : (remove: () => Promise<void>) => archiveMetadataWithMutation('dictionary',projectId,id,remove))(()=>mutate(projectId, dictionaries => { const index = dictionaries.findIndex(d => d.id === id); if (index >= 0) dictionaries.splice(index, 1); }, eraId));
}

export function saveWord(projectId: string, dictionaryId: string, word: DictionaryWord, base?: DictionaryWord, eraId?: string): Promise<void> {
  if (!word.word.trim() || !word.meaning.trim()) return Promise.reject(new Error('Spelling and meaning are required.'));
  return mutate(projectId, dictionaries => {
    const dictionary = dictionaries.find(d => d.id === dictionaryId);
    if (!dictionary) throw new Error('Dictionary not found.');
    const index = dictionary.words.findIndex(item => item.id === word.id);
    const updated = { ...word, word: word.word.trim() };
    if (base) {
      const existing = dictionary.words[index]; if (!existing) throw new Error('Word was deleted.');
      for (const field of Object.keys(updated) as (keyof DictionaryWord)[]) {
        if (updated[field] !== base[field] && existing[field] !== base[field] && existing[field] !== updated[field]) throw new Error('Word changed elsewhere.');
        if (updated[field] === base[field]) Object.assign(updated, { [field]: existing[field] });
      }
    }
    if (index < 0) dictionary.words.push(updated); else dictionary.words[index] = updated;
  }, eraId);
}

export function removeWord(projectId: string, dictionaryId: string, id: string, eraId?: string): Promise<void> {
  return mutate(projectId, dictionaries => { const dictionary = dictionaries.find(d => d.id === dictionaryId); if (!dictionary) throw new Error('Dictionary not found.'); dictionary.words = dictionary.words.filter(word => word.id !== id); }, eraId);
}
