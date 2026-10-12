import { createSpellChecker } from './spelling';
import type { SpellChecker } from './types';
let checker: Promise<SpellChecker> | undefined;
async function getChecker(base: string) {
  checker ??= Promise.all(['es_ES.aff', 'es_ES.dic'].map(async file => {
    const response = await fetch(new URL(`dictionaries/es-ES/${file}`, base)); if (!response.ok) throw new Error('The Spanish dictionary is unavailable.'); return response.text();
  })).then(([aff, dic]) => createSpellChecker({ aff, dic })).catch(error => { checker = undefined; throw error; });
  return checker;
}
self.onmessage = async (event: MessageEvent<{ id: number; base: string; words: string[]; personalWords: string[] }>) => {
  const { id, base, words, personalWords } = event.data;
  try { self.postMessage({ id, results: await (await getChecker(base)).check(words, personalWords) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'Dictionary checking failed.' }); }
};
