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
  /** Further senses after the first (the first is partOfSpeech, meaning and examples above). */
  senses?: WordSense[];
  /** Related words, by spelling ("see also"). */
  seeAlso?: string[];
}

/** One more sense of a word: what it is, what it means, an example. */
export interface WordSense { partOfSpeech: string; meaning: string; examples: string }
export const SENSES_MAX = 20;
export const SEE_ALSO_MAX = 30;

/** Validate and tidy further senses: empty ones are dropped; a sense needs a meaning. */
export function normalizeSenses(raw: unknown): WordSense[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > SENSES_MAX) throw new Error(`senses must be a list of up to ${SENSES_MAX} senses.`);
  const out: WordSense[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each sense must be an object.');
    const read = (key: string) => { const v = (item as Record<string, unknown>)[key]; if (v === undefined) return ''; if (typeof v !== 'string' || v.length > 50000) throw new Error(`Invalid sense ${key}.`); return v; };
    for (const key of Object.keys(item)) if (!['partOfSpeech', 'meaning', 'examples'].includes(key)) throw new Error(`Unknown sense field "${key}".`);
    const sense = { partOfSpeech: read('partOfSpeech').trim(), meaning: read('meaning').trim(), examples: read('examples').trim() };
    if (!sense.meaning && !sense.partOfSpeech && !sense.examples) continue;
    if (!sense.meaning) throw new Error('A sense needs a meaning.');
    out.push(sense);
  }
  return out.length ? out : undefined;
}

/** Validate and tidy "see also": spellings, once each, never the word itself. */
export function normalizeSeeAlso(raw: unknown, own = ''): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const list = typeof raw === 'string' ? raw.split(/[,;\n]/) : raw;
  if (!Array.isArray(list) || list.length > SEE_ALSO_MAX * 2) throw new Error(`seeAlso must be a list of up to ${SEE_ALSO_MAX} words.`);
  const seen = new Set<string>(), out: string[] = [];
  const self = own.normalize('NFC').trim().toLocaleLowerCase();
  for (const item of list) {
    if (typeof item !== 'string' || item.length > 300) throw new Error('seeAlso holds words (text).');
    const word = item.normalize('NFC').trim();
    const key = word.toLocaleLowerCase();
    if (!word || key === self || seen.has(key)) continue;
    seen.add(key); out.push(word);
  }
  if (out.length > SEE_ALSO_MAX) throw new Error(`seeAlso takes up to ${SEE_ALSO_MAX} words.`);
  return out.length ? out : undefined;
}

/**
 * The superscript a word carries among words spelt the same (homographs),
 * 1, 2, 3 in the order they were added; 0 for a word spelt like no other.
 */
export function homographNumbers(words: readonly DictionaryWord[]): Map<string, number> {
  const groups = new Map<string, string[]>();
  for (const word of words) {
    const key = word.word.normalize('NFC').trim().toLocaleLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), word.id]);
  }
  const out = new Map<string, number>();
  for (const ids of groups.values()) ids.forEach((id, index) => out.set(id, ids.length > 1 ? index + 1 : 0));
  return out;
}

/** One line of a pasted word list, read: a word, its meaning, and a part of speech if one was given. */
export interface PastedWord { word: string; meaning: string; partOfSpeech: string }

/**
 * A pasted list, one word per line: "word<tab>meaning", "word - meaning",
 * "word – meaning", "word — meaning" or "word: meaning", optionally with the
 * part of speech in brackets after the word ("drak (n.): dragon"). Lines that
 * do not read as a word and a meaning are returned apart, by number.
 */
export function parseWordList(text: string): { words: PastedWord[]; invalid: number[] } {
  const words: PastedWord[] = [], invalid: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const raw = line.trim();
    if (!raw) return;
    const match = /^(.+?)(?:\t+|\s+[-–—]\s+|\s*:\s+)(.+)$/u.exec(raw);
    if (!match) { invalid.push(index + 1); return; }
    let head = match[1].trim();
    const meaning = match[2].trim();
    let partOfSpeech = '';
    const pos = /^(.*?)\s*\(([^()]{1,24})\)$/u.exec(head);
    if (pos && pos[1].trim()) { head = pos[1].trim(); partOfSpeech = pos[2].trim(); }
    if (!head || !meaning || head.length > 300 || meaning.length > 50000) { invalid.push(index + 1); return; }
    words.push({ word: head.normalize('NFC'), meaning, partOfSpeech });
  });
  return { words, invalid };
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
  /** With glosses on: the native-script spelling shown beside each glossed word in the manuscript (display only). */
  showNativeInProse?: boolean;
  /** The colour of the language's book in the list (#rrggbb). */
  color?: string;
  words: DictionaryWord[];
}

export const DICTIONARY_COLORS = ['#8a6d3b', '#c0504d', '#3d85c6', '#6aa84f', '#8e7cc3', '#e08a3c', '#c27ba0', '#7f8c8d'] as const;
export const isDictionaryColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

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
  return dictionary.words.filter(word => !needle || [word.word, nativeWord(word, dictionary.scriptMapping), word.pronunciation, word.partOfSpeech, word.meaning, word.examples, word.phrases, word.derivatives, word.origin, ...(word.senses ?? []).flatMap(sense => [sense.partOfSpeech, sense.meaning, sense.examples])].some(value => value.toLocaleLowerCase().includes(needle)))
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
      // Further senses and "see also" are optional: files written before them read as they always did.
      const senses = normalizeSenses((word as Record<string, unknown>).senses), seeAlso = normalizeSeeAlso((word as Record<string, unknown>).seeAlso, result.word);
      if (senses) result.senses = senses;
      if (seeAlso) result.seeAlso = seeAlso;
      return result;
    }),
  };
}

export function exportDictionary(dictionary: WorldDictionary): string {
  // Project-specific Codex pointers and local identifiers do not travel as broken links.
  return JSON.stringify({ format: 'writers-dictionary-v1', dictionary: { name: dictionary.name, description: dictionary.description, scriptMapping: dictionary.scriptMapping, font: dictionary.font, words: dictionary.words.map(word => ({ ...Object.fromEntries(textFields.map(field => [field, word[field]])), ...(word.senses?.length ? { senses: word.senses } : {}), ...(word.seeAlso?.length ? { seeAlso: word.seeAlso } : {}) })) } }, null, 2);
}
