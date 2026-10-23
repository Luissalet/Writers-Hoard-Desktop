// The name generator: an inn, a shop, a person, a village or a noble house in
// one of 13 styles, with the parts a writer needs next to the name (owner,
// charm, what it is known for, a secret, a trouble, a motto). Everything is
// made here from word tables and a seed: the same seed gives the same idea, and
// "pick again" on one part changes only that part. A free-text brief ("run by
// a widow", "por el puerto") favours table entries that share its words.
import { KIND_STEPS, type NameKind, type NameStep, type NameStyle, type StyleTable, type Syllables } from './types';
import { KIND_TABLES, STYLE_TABLES } from './tables';

export type NameLocale = 'es' | 'en';
export interface NameIdea { kind: NameKind; style: NameStyle; seed: string; brief: string; parts: Partial<Record<NameStep, string>>; rolls: Partial<Record<NameStep, number>> }

/** A small seeded generator (mulberry32 over a string hash). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'en', 'por', 'con', 'a', 'the', 'of', 'and', 'by', 'in', 'on', 'an', 'with', 'run', 'at', 'to']);
export function briefWords(brief: string): string[] {
  return [...new Set(fold(brief).split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && !STOP.has(word)))].slice(0, 12);
}

/** Pick from a list, six times likelier for an entry that shares a word stem with the brief. */
export function pickFor<T>(random: () => number, items: readonly T[], words: string[], text: (item: T) => string = item => String(item)): T {
  if (!items.length) throw new Error('empty_table');
  if (!words.length) return items[Math.floor(random() * items.length)];
  const weights = items.map(item => { const folded = fold(text(item)); return words.some(word => folded.includes(word.slice(0, Math.max(4, word.length - 2)))) ? 6 : 1; });
  let roll = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { roll -= weights[i]; if (roll < 0) return items[i]; }
  return items[items.length - 1];
}

const capital = (word: string) => word ? word[0].toLocaleUpperCase() + word.slice(1) : word;
function joinSyllables(random: () => number, table: Syllables, end?: string[]): string {
  const pick = (list: string[]) => list[Math.floor(random() * list.length)];
  let word = pick(table.start);
  if (table.middle?.length && random() < 0.35) word += pick(table.middle);
  const tail = pick(end?.length ? end : table.end);
  // Never three of the same letter in a row; two vowels meeting at the seam keep the ending's.
  word = /[aeiouy]$/.test(word) && /^[aeiou]/.test(tail) && word.length > 2 ? word.slice(0, -1) + tail : word + tail;
  return capital(word.replace(/(.)\1\1+/g, '$1$1'));
}

export function givenName(random: () => number, style: StyleTable, feminine?: boolean): string {
  if (feminine === undefined) feminine = random() < 0.5;
  return joinSyllables(random, style.given, feminine ? style.given.feminine : undefined);
}
export const familyName = (random: () => number, style: StyleTable) => joinSyllables(random, style.family);
export const placeName = (random: () => number, style: StyleTable) => joinSyllables(random, style.place);

function signName(random: () => number, style: StyleTable, locale: NameLocale, words: string[]): string {
  if (locale === 'es') {
    const [noun, gender] = pickFor(random, style.words.es.nouns, words, item => item[0]);
    const adjective = pickFor(random, style.words.es.adjectives, words, item => item.join(' '));
    const article = gender === 'f' ? 'La' : 'El';
    const form = random();
    if (form < 0.55) return `${article} ${capital(noun)} ${capital(gender === 'f' ? adjective[1] : adjective[0])}`;
    if (form < 0.8) return `${article} ${capital(noun)} de ${givenName(random, style)}`;
    const [other, otherGender] = pickFor(random, style.words.es.nouns.filter(item => item[0] !== noun), words, item => item[0]);
    return `${article} ${capital(noun)} y ${otherGender === 'f' ? 'la' : 'el'} ${capital(other)}`;
  }
  const noun = pickFor(random, style.words.en.nouns, words), adjective = pickFor(random, style.words.en.adjectives, words), form = random();
  if (form < 0.55) return `The ${adjective} ${noun}`;
  if (form < 0.8) return `${givenName(random, style)}'s ${noun}`;
  return `The ${noun} and ${pickFor(random, style.words.en.nouns.filter(item => item !== noun), words)}`;
}

/** One part of an idea; `roll` makes "pick again" give a different answer from the same seed. */
export function generatePart(kind: NameKind, style: NameStyle, step: NameStep, seed: string, roll: number, locale: NameLocale, brief = ''): string {
  const random = seededRandom(`${seed}|${kind}|${style}|${step}|${roll}|${locale}`);
  const table = STYLE_TABLES[style], kinds = KIND_TABLES[locale], words = briefWords(brief);
  const fill = (text: string) => text.replace(/\{name\}/g, () => givenName(random, table));
  switch (step) {
    case 'name':
      if (kind === 'person') return `${givenName(random, table)} ${familyName(random, table)}`;
      if (kind === 'village') { const place = placeName(random, table); return random() < 0.25 && locale === 'es' ? `${place} ${pickFor(random, ['de Abajo', 'de Arriba', 'del Río', 'de la Sierra', 'del Monte', 'de los Pinos'], words)}` : random() < 0.2 && locale === 'en' ? `${pickFor(random, ['Upper', 'Lower', 'Old', 'East', 'West'], words)} ${place}` : place; }
      if (kind === 'house') return `${locale === 'es' ? 'Casa' : 'House'} ${familyName(random, table)}`;
      if (kind === 'shop' && random() < 0.6) { const trade = pickFor(random, kinds.trades, words), name = givenName(random, table); return locale === 'es' ? `${trade} de ${name}` : `${name}'s ${trade}`; }
      return signName(random, table, locale, words);
    case 'owner': {
      const title = kind === 'person' ? '' : pickFor(random, kinds.ownerTitle[kind], words);
      // A Spanish title says whether the owner is a woman (tabernera, alcaldesa) or a man (posadero, regidor).
      const head = fold(title.split(/\s+/)[0] ?? ''), feminine = locale === 'es' && title ? /a$/.test(head) && !/^(patriarca|guia|centinela|espia|cabeza)$/.test(head) : undefined;
      const name = `${givenName(random, table, feminine === undefined ? undefined : feminine)} ${familyName(random, table)}`;
      return title ? (locale === 'es' ? `${name}, ${title}` : `${name}, ${title}`) : name;
    }
    case 'role': return capital(pickFor(random, kinds.role, words));
    case 'motto': return pickFor(random, kinds.mottos, words);
    case 'charm': return capital(fill(pickFor(random, kinds.charm[kind], words)));
    case 'knownFor': return capital(fill(pickFor(random, kinds.knownFor[kind], words)));
    case 'secret': return capital(fill(pickFor(random, kinds.secret[kind], words)));
    case 'trouble': return capital(fill(pickFor(random, kinds.trouble[kind], words)));
  }
}

/** A whole idea for a kind: every step the kind offers, from one seed. */
export function generateIdea(kind: NameKind, style: NameStyle, seed: string, locale: NameLocale, brief = ''): NameIdea {
  const parts: NameIdea['parts'] = {}, rolls: NameIdea['rolls'] = {};
  for (const step of KIND_STEPS[kind]) { parts[step] = generatePart(kind, style, step, seed, 0, locale, brief); rolls[step] = 0; }
  return { kind, style, seed, brief: brief.trim(), parts, rolls };
}

/** "Pick again" for one part, or skip it (the part is left out of the card). */
export function rerollPart(idea: NameIdea, step: NameStep, locale: NameLocale): NameIdea {
  const roll = (idea.rolls[step] ?? 0) + 1;
  return { ...idea, parts: { ...idea.parts, [step]: generatePart(idea.kind, idea.style, step, idea.seed, roll, locale, idea.brief) }, rolls: { ...idea.rolls, [step]: roll } };
}
export function skipPart(idea: NameIdea, step: NameStep): NameIdea {
  if (step === 'name') return idea;
  const parts = { ...idea.parts }; delete parts[step];
  return { ...idea, parts };
}

/** Several names of one kind at once, for a list to choose from. */
export function generateNames(kind: NameKind, style: NameStyle, seed: string, locale: NameLocale, count: number, brief = ''): string[] {
  const out = new Set<string>();
  for (let roll = 0; out.size < count && roll < count * 5; roll++) out.add(generatePart(kind, style, 'name', seed, roll, locale, brief));
  return [...out];
}

export const STEP_LABELS: Record<NameLocale, Record<NameStep, string>> = {
  es: { name: 'Nombre', owner: 'Quién lo lleva', role: 'Oficio', charm: 'Su encanto', knownFor: 'Conocido por', secret: 'Secreto', trouble: 'Problema', motto: 'Lema' },
  en: { name: 'Name', owner: 'Who runs it', role: 'Role', charm: 'Charm', knownFor: 'Known for', secret: 'Secret', trouble: 'Trouble', motto: 'Motto' },
};
export const KIND_LABELS: Record<NameLocale, Record<NameKind, string>> = {
  es: { inn: 'Posada', shop: 'Tienda', person: 'Persona', village: 'Pueblo', house: 'Casa noble' },
  en: { inn: 'Inn', shop: 'Shop', person: 'Person', village: 'Village', house: 'Noble house' },
};
