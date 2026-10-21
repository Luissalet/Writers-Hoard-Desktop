import { db } from '@/db';
import { getEraProject, readEraRow, readWorldDocument } from '@/services/worldEras/store';
import { resolveProjectForEngine, requireString, optString, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { emptyWord, nativeWord, searchWords, type WorldDictionary } from './types';
import { saveDictionary, saveWord } from './operations';
const scope = async (args: ToolArgs) => ({ projectId: await resolveProjectForEngine(args, 'dictionary'), eraId: optString(args, 'eraId') });
async function read(args: ToolArgs) { const target = await scope(args), source = await readWorldDocument(target, 'dictionary', requireString(args, 'dictionaryId')); if (!source) throw Error('dictionary_missing'); return { target, dictionary: source.document.root as unknown as WorldDictionary, version: source.version }; }
export const DICTIONARY_HANDLERS = {
  async wh_dictionary_search(args: ToolArgs) { const target = await scope(args), project = await getEraProject(target), query = optString(args, 'query') ?? ''; return { dictionaries: await Promise.all((project.dictionaries ?? []).map(async dictionary => ({ id: dictionary.id, name: dictionary.name, version: (await readWorldDocument(target, 'dictionary', dictionary.id))!.version, words: searchWords(dictionary, query).map(word => ({ ...word, native: nativeWord(word, dictionary.scriptMapping) })) }))) }; },
  async wh_dictionary_get(args: ToolArgs) { const { dictionary, version } = await read(args); return { dictionary, version }; },
  async wh_dictionary_create(args: ToolArgs) { const target = await scope(args), dictionary: WorldDictionary = { id: crypto.randomUUID(), name: requireString(args, 'name'), description: optString(args, 'description') ?? '', scriptMapping: optString(args, 'scriptMapping') ?? '', detectInManuscript: false, words: [] }; await saveDictionary(target.projectId, dictionary, undefined, target.eraId); return { dictionary, version: (await readWorldDocument(target, 'dictionary', dictionary.id))!.version }; },
  async wh_dictionary_save_word(args: ToolArgs) {
    const target = await scope(args), id = requireString(args, 'dictionaryId'), expected = requireString(args, 'expectedVersion'), payload = args.word;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('dictionary_word_invalid');
    const fields = payload as Record<string, unknown>, blank = emptyWord(), allowed = new Set([...Object.keys(blank), 'linkedEntryId']);
    if (Object.entries(fields).some(([key, value]) => !allowed.has(key) || typeof value !== 'string' || value.length > 50000)) throw Error('dictionary_word_invalid');
    const result = await db.transaction('rw', db.tables, async () => {
      const source = await readWorldDocument(target, 'dictionary', id); if (!source || source.version !== expected) throw Error('dictionary_conflict');
      const dictionary = source.document.root as unknown as WorldDictionary, base = typeof fields.id === 'string' ? dictionary.words.find(word => word.id === fields.id) : undefined;
      if (fields.id !== undefined && !base) throw Error('dictionary_word_missing');
      const word = { ...(base ?? blank), ...fields } as typeof blank;
      if ('linkedEntryId' in word && word.linkedEntryId) { const entry = await readEraRow<{ projectId: string }>(target, 'codexEntries', word.linkedEntryId); if (entry?.projectId !== target.projectId) throw Error('dictionary_foreign_link'); }
      await saveWord(target.projectId, id, word, base, target.eraId); return word;
    });
    return { word: result, version: (await readWorldDocument(target, 'dictionary', id))!.version };
  },
};
