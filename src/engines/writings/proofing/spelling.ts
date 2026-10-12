import nspell from 'nspell';
import type { SpellChecker, SpellWordResult } from './types';

/** Called in a worker by the normal browser path; also reusable in headless Node. */
export function createSpellChecker(dictionary: { aff: string; dic: string }): SpellChecker {
  const spell = nspell(dictionary); const yieldTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  return { async check(words, personalWords = []) {
    const personal = new Set(personalWords.map(word => word.normalize('NFC').toLocaleLowerCase('es-ES')));
    const cache = new Map<string, SpellWordResult>(); const results: SpellWordResult[] = []; let lastYield = performance.now();
    for (const word of words) {
      const normalized = word.normalize('NFC'); const key = normalized.toLocaleLowerCase('es-ES');
      let result = cache.get(normalized);
      if (!result) {
        const correct = personal.has(key) || spell.correct(normalized);
        result = { word, correct, suggestions: correct ? [] : spell.suggest(normalized) }; cache.set(normalized, result);
      }
      results.push({ ...result, word });
      if (performance.now() - lastYield >= 8) { await yieldTurn(); lastYield = performance.now(); }
    }
    return results;
  } };
}
