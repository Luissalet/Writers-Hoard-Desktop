import { db } from '@/db';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';
import { exportDictionary, homographNumbers, normalizeSeeAlso, normalizeSenses, parseDictionaryImport, parseWordList, searchWords, type WorldDictionary } from '@/engines/dictionary/types';
import { importWords, saveWord } from '@/engines/dictionary/operations';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Dictionary: further senses, "see also", homograph numbers and pasting a list. */
export async function testDictionarySenses(): Promise<string[]> {
  const P = `dictionary-senses-${Date.now()}`;
  try {
    // ---- reading a pasted list ---------------------------------------------------------------
    const list = parseWordList('drak (n.): dragon\nshara\tfog at sea\nvel – river\nhalf-elf - one of two peoples\nnot a word line\n\nmor: sea: salt water');
    assert(list.words.length === 5 && list.invalid.join() === '5', `Read ${JSON.stringify(list)}`);
    assert(list.words[0].word === 'drak' && list.words[0].partOfSpeech === 'n.' && list.words[0].meaning === 'dragon', 'The part of speech in brackets');
    assert(list.words[3].word === 'half-elf' && list.words[4].word === 'mor' && list.words[4].meaning === 'sea: salt water', 'A hyphen inside a word stays; the first separator splits');
    // ---- senses and see also ----------------------------------------------------------------------
    assert(normalizeSenses([{ partOfSpeech: ' v. ', meaning: ' to burn ', examples: '' }, { partOfSpeech: '', meaning: '', examples: '' }])!.length === 1, 'Empty senses are dropped, the rest tidied');
    for (const bad of [[{ partOfSpeech: 'n.' }], [{ meaning: 'x', colour: 'red' }], 'x', Array.from({ length: 21 }, () => ({ meaning: 'x' }))]) {
      let refused = false; try { normalizeSenses(bad); } catch { refused = true; }
      assert(refused, `Refused senses ${JSON.stringify(bad).slice(0, 40)}`);
    }
    assert(normalizeSeeAlso('vel, Vel , drak,, ', 'drak')!.join('|') === 'vel', `See also tidied: ${normalizeSeeAlso('vel, Vel , drak,, ', 'drak')}`);
    // ---- homographs ----------------------------------------------------------------------------------
    const words = [{ id: 'a', word: 'mor' }, { id: 'b', word: 'vel' }, { id: 'c', word: 'Mor' }] as WorldDictionary['words'];
    const numbers = homographNumbers(words);
    assert(numbers.get('a') === 1 && numbers.get('c') === 2 && numbers.get('b') === 0, 'Words spelt alike are numbered 1, 2');
    // ---- through storage -------------------------------------------------------------------------------
    await db.projects.put({ id: P, title: 'Senses', mode: 'custom', type: 'standalone', enabledEngines: ['dictionary'], createdAt: 1, updatedAt: 1 });
    const created = await runBridgeTool('wh_dictionary_create', { projectId: P, name: 'Lúmico' }); assert(created.ok, JSON.stringify(created));
    const { dictionary, version } = created.result as { dictionary: WorldDictionary; version: string };
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    const dry = await runBridgeTool('wh_dictionary_import_words', { projectId: P, dictionaryId: dictionary.id, expectedVersion: version, text: 'drak (n.): dragon\nshara\tfog at sea\nnonsense', dryRun: true });
    assert(dry.ok && (dry.result as { added: number; invalid: number }).added === 2 && (dry.result as { invalid: number }).invalid === 1, `Dry run ${JSON.stringify(dry)}`);
    const imported = await runBridgeTool('wh_dictionary_import_words', { projectId: P, dictionaryId: dictionary.id, expectedVersion: version, text: 'drak (n.): dragon\nshara\tfog at sea\nnonsense' });
    const r1 = imported.result as { added: number; skipped: number; version: string };
    assert(imported.ok && r1.added === 2 && r1.skipped === 0, `Import ${JSON.stringify(imported)}`);
    bad(await runBridgeTool('wh_dictionary_import_words', { projectId: P, dictionaryId: dictionary.id, expectedVersion: version, text: 'vel: river' }), /conflict/, 'A stale version');
    const again = await runBridgeTool('wh_dictionary_import_words', { projectId: P, dictionaryId: dictionary.id, expectedVersion: r1.version, text: 'drak (n.): dragon\nvel: river' });
    const r2 = again.result as { added: number; skipped: number; version: string };
    assert(again.ok && r2.added === 1 && r2.skipped === 1, `Pasting twice adds only what is new: ${JSON.stringify(again)}`);
    const got = (await runBridgeTool('wh_dictionary_get', { projectId: P, dictionaryId: dictionary.id })).result as { dictionary: WorldDictionary; version: string };
    const drak = got.dictionary.words.find((word) => word.word === 'drak')!;
    assert(drak.partOfSpeech === 'n.' && drak.meaning === 'dragon', 'Imported with its part of speech');
    const saved = await runBridgeTool('wh_dictionary_save_word', { projectId: P, dictionaryId: dictionary.id, expectedVersion: got.version, word: { id: drak.id, word: 'drak', meaning: 'dragon', senses: [{ partOfSpeech: 'v.', meaning: 'to burn', examples: 'drak tor' }], seeAlso: ['vel', 'drak'] } });
    assert(saved.ok, JSON.stringify(saved));
    bad(await runBridgeTool('wh_dictionary_save_word', { projectId: P, dictionaryId: dictionary.id, expectedVersion: (saved.result as { version: string }).version, word: { id: drak.id, word: 'drak', meaning: 'dragon', senses: [{ partOfSpeech: 'n.' }] } }), /invalid/, 'A sense with no meaning');
    const after = (await db.projects.get(P))!.dictionaries![0];
    const stored = after.words.find((word) => word.id === drak.id)!;
    assert(stored.senses?.[0].meaning === 'to burn' && stored.seeAlso?.join() === 'vel', `Saved senses and see also: ${JSON.stringify(stored)}`);
    assert(searchWords(after, 'to burn').some((word) => word.id === drak.id), 'A further sense is found by search');
    // Concurrent edit of another field keeps the senses: lists compare by what they hold.
    await saveWord(P, after.id, { ...stored, origin: 'old tongue' }, stored);
    const merged = (await db.projects.get(P))!.dictionaries![0].words.find((word) => word.id === drak.id)!;
    assert(merged.origin === 'old tongue' && merged.senses?.length === 1, 'Editing one field keeps the senses');
    await saveWord(P, after.id, { ...merged, senses: [] }, merged);
    assert(!(await db.projects.get(P))!.dictionaries![0].words.find((word) => word.id === drak.id)!.senses, 'An empty list removes the senses');
    // Export and import carry them; an old file without them reads as before.
    const withSenses = (await db.projects.get(P))!.dictionaries![0];
    const current = withSenses.words.find((word) => word.id === drak.id)!;
    await saveWord(P, withSenses.id, { ...current, senses: [{ partOfSpeech: 'v.', meaning: 'to burn', examples: '' }] }, current);
    const round = parseDictionaryImport(exportDictionary((await db.projects.get(P))!.dictionaries![0]));
    assert(round.words.find((word) => word.word === 'drak')?.senses?.[0].meaning === 'to burn' && round.words.find((word) => word.word === 'drak')?.seeAlso?.join() === 'vel', 'Export and import carry senses and see also');
    const old = parseDictionaryImport(JSON.stringify({ format: 'writers-dictionary-v1', dictionary: { name: 'Old', words: [{ word: 'a', meaning: 'b' }] } }));
    assert(old.words[0].senses === undefined && old.words[0].seeAlso === undefined, 'An old file reads as before');
    const counted = await importWords(P, after.id, [{ word: 'vel', meaning: 'river', partOfSpeech: '' }, { word: 'tor', meaning: 'fire', partOfSpeech: 'n.' }]);
    assert(counted.added === 1 && counted.skipped === 1, `importWords ${JSON.stringify(counted)}`);
    return [
      'A pasted list reads "word – meaning", "word: meaning", tab-separated pairs and "word (n.): meaning"; lines that are not a word and a meaning are counted apart',
      'Further senses (a sense needs a meaning; empty ones dropped) and "see also" (no repeats, never the word itself) are saved, found by search, kept when another field is edited, carried by export and import; old files read as before; words spelt alike are numbered',
      'Bridge: wh_dictionary_import_words adds a pasted list in one save, skips what is already there, counts unread lines, refuses a stale version and counts only with dryRun; wh_dictionary_save_word takes senses and seeAlso and refuses a sense with no meaning',
    ];
  } finally {
    await db.projects.delete(P);
  }
}
