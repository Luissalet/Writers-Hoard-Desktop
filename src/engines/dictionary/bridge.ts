import { db } from '@/db';
import { getEraProject, readEraRow, readWorldDocument } from '@/services/worldEras/store';
import { resolveProjectForEngine, requireString, optString, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { emptyWord, nativeWord, normalizeSeeAlso, normalizeSenses, parseWordList, searchWords, type WorldDictionary } from './types';
import { importWords, saveDictionary, saveWord } from './operations';
const scope = async (args: ToolArgs) => ({ projectId: await resolveProjectForEngine(args, 'dictionary'), eraId: optString(args, 'eraId') });
async function read(args: ToolArgs) { const target = await scope(args), source = await readWorldDocument(target, 'dictionary', requireString(args, 'dictionaryId')); if (!source) throw Error('dictionary_missing'); return { target, dictionary: source.document.root as unknown as WorldDictionary, version: source.version }; }
export const DICTIONARY_HANDLERS = {
  async wh_dictionary_search(args: ToolArgs) { const target = await scope(args), project = await getEraProject(target), query = optString(args, 'query') ?? ''; return { dictionaries: await Promise.all((project.dictionaries ?? []).map(async dictionary => ({ id: dictionary.id, name: dictionary.name, version: (await readWorldDocument(target, 'dictionary', dictionary.id))!.version, words: searchWords(dictionary, query).map(word => ({ ...word, native: nativeWord(word, dictionary.scriptMapping) })) }))) }; },
  async wh_dictionary_get(args: ToolArgs) { const { dictionary, version } = await read(args); return { dictionary, version }; },
  async wh_dictionary_create(args: ToolArgs) { const target = await scope(args), dictionary: WorldDictionary = { id: crypto.randomUUID(), name: requireString(args, 'name'), description: optString(args, 'description') ?? '', scriptMapping: optString(args, 'scriptMapping') ?? '', detectInManuscript: false, ...(optString(args, 'color') ? { color: optString(args, 'color') } : {}), words: [] }; await saveDictionary(target.projectId, dictionary, undefined, target.eraId); return { dictionary, version: (await readWorldDocument(target, 'dictionary', dictionary.id))!.version }; },
  async wh_dictionary_settings(args: ToolArgs) {
    const { target, dictionary, version } = await read(args);
    if (requireString(args, 'expectedVersion') !== version) throw Error('dictionary_conflict');
    const next: WorldDictionary = structuredClone(dictionary);
    for (const key of ['name', 'description', 'scriptMapping'] as const) { const value = args[key]; if (value === undefined) continue; if (typeof value !== 'string' || value.length > 50000) throw Error('dictionary_settings_invalid'); next[key] = value; }
    for (const key of ['detectInManuscript', 'showNativeInProse'] as const) { const value = args[key]; if (value === undefined) continue; if (typeof value !== 'boolean') throw Error('dictionary_settings_invalid'); next[key] = value; }
    if (args.color !== undefined) { if (args.color === '') delete next.color; else if (typeof args.color === 'string') next.color = args.color; else throw Error('dictionary_settings_invalid'); }
    await saveDictionary(target.projectId, next, dictionary, target.eraId);
    const saved = await read(args);
    return { dictionary: { id: saved.dictionary.id, name: saved.dictionary.name, detectInManuscript: saved.dictionary.detectInManuscript, showNativeInProse: !!saved.dictionary.showNativeInProse, color: saved.dictionary.color ?? null }, version: saved.version };
  },
  async wh_dictionary_save_word(args: ToolArgs) {
    const target = await scope(args), id = requireString(args, 'dictionaryId'), expected = requireString(args, 'expectedVersion'), payload = args.word;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('dictionary_word_invalid');
    const fields = payload as Record<string, unknown>, blank = emptyWord(), allowed = new Set([...Object.keys(blank), 'linkedEntryId']);
    // Further senses and "see also" are lists; every other field is text.
    if (Object.entries(fields).some(([key, value]) => key === 'senses' || key === 'seeAlso' ? false : !allowed.has(key) || typeof value !== 'string' || value.length > 50000)) throw Error('dictionary_word_invalid');
    try { if (fields.senses !== undefined) fields.senses = normalizeSenses(fields.senses); if (fields.seeAlso !== undefined) fields.seeAlso = normalizeSeeAlso(fields.seeAlso, typeof fields.word === 'string' ? fields.word : ''); } catch { throw Error('dictionary_word_invalid'); }
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
  async wh_dictionary_import_words(args: ToolArgs) {
    const target = await scope(args), id = requireString(args, 'dictionaryId'), expected = requireString(args, 'expectedVersion'), text = requireString(args, 'text');
    if (text.length > 2_000_000) throw Error('dictionary_import_too_large');
    const { words, invalid } = parseWordList(text);
    if (!words.length) throw Error('dictionary_import_empty');
    const dryRun = args.dryRun === true;
    const result = await db.transaction('rw', db.tables, async () => {
      const source = await readWorldDocument(target, 'dictionary', id); if (!source || source.version !== expected) throw Error('dictionary_conflict');
      if (dryRun) {
        const dictionary = source.document.root as unknown as WorldDictionary;
        const key = (w: string, m: string) => `${w.normalize('NFC').trim().toLocaleLowerCase()}\u0000${m.trim().toLocaleLowerCase()}`;
        const have = new Set(dictionary.words.map(word => key(word.word, word.meaning)));
        let added = 0; for (const row of words) { const k = key(row.word, row.meaning); if (!have.has(k)) { have.add(k); added++; } }
        return { added, skipped: words.length - added };
      }
      return importWords(target.projectId, id, words, target.eraId);
    });
    return { ...result, invalidLines: invalid.slice(0, 50), invalid: invalid.length, dryRun, version: (await readWorldDocument(target, 'dictionary', id))!.version };
  },
};
