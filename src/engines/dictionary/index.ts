import { lazy } from 'react';
import { Languages } from 'lucide-react';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import type { EngineDefinition } from '@/engines/_types';
import { registerLocaleStrings } from '@/i18n/useTranslation';
import { db } from '@/db';
import en from './locales/en';
import es from './locales/es';
import type { WorldDictionary } from './types';
import { nativeWord, searchWords } from './types';

registerLocaleStrings({ en, es });
const DictionaryEngine = lazy(() => import('./DictionaryEngine'));

// Owned by Project.dictionaries, so project backup/restore and deletion apply.
const dictionaryEngine: EngineDefinition = {
  id: 'dictionary',
  name: 'Languages',
  description: 'Local world-language dictionaries',
  icon: Languages,
  category: 'creative',
  tables: {},
  component: DictionaryEngine,
  countProjectItems: async projectId => (await db.projects.get(projectId))?.dictionaries?.reduce((total, dictionary) => total + 1 + dictionary.words.length, 0) ?? 0,
};
registerEngine(dictionaryEngine);

registerEntityResolver({
  engineId: 'dictionary', entityTypes: ['dictionary-word', 'dictionary'],
  async resolveEntity(entityId) {
    for (const project of await db.projects.toArray()) {
      for (const dictionary of project.dictionaries ?? []) {
        if (dictionary.id === entityId) return { id: dictionary.id, projectId: project.id, type: 'dictionary', engineId: 'dictionary', title: dictionary.name, subtitle: dictionary.description };
        const word = dictionary.words.find(item => item.id === entityId);
        if (word) return { id: word.id, projectId: project.id, type: 'dictionary-word', engineId: 'dictionary', title: word.word, subtitle: `${dictionary.name}: ${word.meaning}` };
      }
    }
    return null;
  },
  async searchEntities(query, projectId) {
    const projects = projectId ? [await db.projects.get(projectId)] : await db.projects.toArray();
    const wordResults = projects.flatMap(project => project ? (project.dictionaries ?? []).flatMap((dictionary: WorldDictionary) => searchWords(dictionary, query).map(word => ({ id: word.id, projectId: project.id, type: 'dictionary-word', engineId: 'dictionary', title: word.word, subtitle: `${dictionary.name} · ${nativeWord(word, dictionary.scriptMapping)} · ${word.meaning}` }))) : []);
    const languages = projects.flatMap(project => project ? (project.dictionaries ?? []).filter(dictionary => `${dictionary.name} ${dictionary.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(dictionary => ({ id: dictionary.id, projectId: project.id, type: 'dictionary', engineId: 'dictionary', title: dictionary.name, subtitle: dictionary.description })) : []);
    return [...languages, ...wordResults];
  },
});
