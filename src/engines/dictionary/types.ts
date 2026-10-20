import { parseDictionaryFont, type DictionaryFont } from './fonts';

export interface DictionaryWord {
  id: string;
  word: string;
  nativeForm: string;
  pronunciation: string;
  partOfSpeech: string;
  meaning: string;
  examples: string;
  phrases: string;
  derivatives: string;
  origin: string;
  linkedEntryId?: string;
}

export interface WorldDictionary {
  id: string;
  name: string;
  description: string;
  /** One source=target pair per line. Longest source wins, including digraphs. */
  scriptMapping: string;
  /** User-supplied embedded font, available offline and portable with exports. */
  font?: DictionaryFont;
  detectInManuscript: boolean;
  words: DictionaryWord[];
}

export function emptyWord(): DictionaryWord {
  return { id: crypto.randomUUID(), word: '', nativeForm: '', pronunciation: '', partOfSpeech: '', meaning: '', examples: '', phrases: '', derivatives: '', origin: '' };
}

export function parseScriptMapping(source: string): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const from = line.slice(0, separator).trim().normalize('NFC').toLowerCase();
    const to = line.slice(separator + 1).trim();
    if (from) mapping.set(from, to);
  }
  return mapping;
}

/** A fictional script substitution, not a claim of linguistic transliteration. */
export function nativeWord(word: Pick<DictionaryWord, 'word' | 'nativeForm'>, mapping: string): string {
  if (word.nativeForm.trim()) return word.nativeForm;
  const substitutions = [...parseScriptMapping(mapping)].sort((a, b) => b[0].length - a[0].length);
  const source = word.word.normalize('NFC');
  let result = '';
  for (let index = 0; index < source.length;) {
    const match = substitutions.find(([from]) => source.slice(index, index + from.length).toLowerCase() === from);
    if (match) { result += match[1]; index += match[0].length; }
    else { const point = String.fromCodePoint(source.codePointAt(index)!); result += point; index += point.length; }
  }
  return result;
}

export function searchWords(dictionary: WorldDictionary, query: string): DictionaryWord[] {
  const needle = query.normalize('NFC').toLocaleLowerCase().trim();
  return dictionary.words.filter(word => !needle || [word.word, nativeWord(word, dictionary.scriptMapping), word.pronunciation, word.partOfSpeech, word.meaning, word.examples, word.phrases, word.derivatives, word.origin].some(value => value.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => a.word.localeCompare(b.word));
}

const textFields = ['word', 'nativeForm', 'pronunciation', 'partOfSpeech', 'meaning', 'examples', 'phrases', 'derivatives', 'origin'] as const;

/** Imports only the documented portable schema, always assigning new local IDs. */
export function parseDictionaryImport(source: string): WorldDictionary {
  if (source.length > 8_000_000) throw new Error('Dictionary file exceeds 8 MB.');
  const data: unknown = JSON.parse(source);
  if (!data || typeof data !== 'object' || !('format' in data) || data.format !== 'writers-dictionary-v1' || !('dictionary' in data)) throw new Error('Invalid dictionary format.');
  const dictionary = data.dictionary;
  if (!dictionary || typeof dictionary !== 'object' || !('name' in dictionary) || typeof dictionary.name !== 'string' || !dictionary.name.trim() || !('words' in dictionary) || !Array.isArray(dictionary.words) || dictionary.words.length > 10000) throw new Error('Invalid dictionary.');
  const read = (object: object, key: string): string => {
    const value = Object.hasOwn(object, key) ? (object as Record<string, unknown>)[key] : '';
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > 50000) throw new Error(`Invalid ${key}.`);
    return value;
  };
  return {
    id: crypto.randomUUID(), name: dictionary.name.trim(), description: read(dictionary, 'description'), scriptMapping: read(dictionary, 'scriptMapping'),
    detectInManuscript: false,
    font: 'font' in dictionary && dictionary.font !== undefined ? parseDictionaryFont(dictionary.font) : undefined,
    words: dictionary.words.map((word: unknown) => {
      if (!word || typeof word !== 'object') throw new Error('Invalid word.');
      const result = emptyWord();
      for (const field of textFields) result[field] = read(word, field);
      if (!result.word.trim() || !result.meaning.trim()) throw new Error('Words require a spelling and meaning.');
      return result;
    }),
  };
}

export function exportDictionary(dictionary: WorldDictionary): string {
  // Project-specific Codex pointers and local identifiers do not travel as broken links.
  return JSON.stringify({ format: 'writers-dictionary-v1', dictionary: { name: dictionary.name, description: dictionary.description, scriptMapping: dictionary.scriptMapping, font: dictionary.font, words: dictionary.words.map(word => Object.fromEntries(textFields.map(field => [field, word[field]]))) } }, null, 2);
}
