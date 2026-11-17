// Dialogue lines of a manuscript and who says them. Pure: plain text in, lines out.
//
// Spanish dialogue opens a paragraph with a dash (—) and alternates speech and
// the narrator's aside (inciso) between dashes; English dialogue sits between
// quotes (“ ” or " ") with the narration around it; «» count when the paragraph
// opens with them. A speaker is taken, in this order, from a name or alias of
// a Codex character in the aside (`tag`), from the narration paragraph just
// before that names exactly one character (`beat`), or from the turn order of
// a two-voice exchange (`turn`). Dialog Scene blocks carry their character (`scene`).

export type VoiceGender = 'feminine' | 'masculine' | 'neutral';
export interface VoiceCharacter { id: string; name: string; aliases: readonly string[]; gender?: VoiceGender }
export interface VoiceSource { writingId: string; chapter: number | null; title: string; text: string }
export interface VoiceSceneBlock { id: string; sceneId: string; characterId: string; text: string }

export type Attribution = 'tag' | 'pronoun' | 'beat' | 'turn' | 'scene';
export interface DialogueAnchor { paragraph: number; column: number; quote: string }

export interface DialogueLine {
  /** `<writingId>:<paragraph>` or `scene:<blockId>`. */
  id: string;
  writingId?: string;
  sceneId?: string;
  chapter: number | null;
  paragraph: number;
  /** Speech only, asides removed. */
  text: string;
  /** The first stretch of speech exactly as written. */
  quote: string;
  /** Position of that stretch in the manuscript, absent for Dialog Scene blocks. */
  anchor?: DialogueAnchor;
  speakerId: string | null;
  attribution: Attribution | null;
}

const DASH_START = /^\s*(?:[—―]|-(?!-)(?=\s*[\p{L}¿¡“"]))\s*/u;
const DASH_SPLIT = /\s*[—―]\s*/g;
const HYPHEN_SPLIT = /\s+-\s*|-(?=\s*[.,;:!?…]|$)/g;
const QUOTED = /[“"«]([^”"»]{1,2000})[”"»]/g;
const SPEECH_LEADING = /^[\s.,;:]+/;

export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const GENDER_VALUES: Partial<Record<string, VoiceGender>> = {
  femenino: 'feminine', mujer: 'feminine', female: 'feminine', feminine: 'feminine', woman: 'feminine',
  masculino: 'masculine', hombre: 'masculine', male: 'masculine', masculine: 'masculine', man: 'masculine',
  'no binario': 'neutral', 'no binaria': 'neutral', nonbinary: 'neutral', 'non-binary': 'neutral',
};

/** Codex supports author-defined fields, including gender in either language. */
export function readVoiceGender(fields: Record<string, string>): VoiceGender | undefined {
  const values = Object.entries(fields)
    .filter(([key, value]) => /^(gender|genero|sex|sexo)$/.test(foldText(key.trim())) && value.trim())
    .map(([, value]) => foldText(value.trim()))
    .map((key) => Object.hasOwn(GENDER_VALUES, key) ? GENDER_VALUES[key] : undefined);
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}

interface ParsedParagraph { speech: string[]; asides: string[]; column: number }

function parseParagraph(paragraph: string): ParsedParagraph | null {
  const speech: string[] = [], asides: string[] = [];
  let column = 0;
  const opening = DASH_START.exec(paragraph);
  if (opening) {
    let start = opening[0].length;
    const delimiters = paragraph.slice(start).matchAll(opening[0].includes('-') ? HYPHEN_SPLIT : DASH_SPLIT);
    let isSpeech = true;
    const add = (end: number) => {
      const text = paragraph.slice(start, end);
      if (!isSpeech) asides.push(text);
      else {
        const said = text.replace(SPEECH_LEADING, '').trim();
        if (said) {
          if (!speech.length) column = start + (SPEECH_LEADING.exec(text)?.[0].length ?? 0);
          speech.push(said);
        }
      }
    };
    for (const delimiter of delimiters) {
      const end = opening[0].length + delimiter.index;
      add(end);
      start = end + delimiter[0].length;
      isSpeech = !isSpeech;
    }
    add(paragraph.length);
  } else {
    if (!/^\s*[“"«]/.test(paragraph) && !/[“"][^”"]{2,}[”"]/.test(paragraph)) return null;
    let start = 0;
    for (const match of paragraph.matchAll(QUOTED)) {
      const said = match[1].trim();
      asides.push(paragraph.slice(start, match.index));
      if (said) {
        if (!speech.length) column = match.index + 1 + match[1].length - match[1].trimStart().length;
        speech.push(said);
      }
      start = match.index + match[0].length;
    }
    asides.push(paragraph.slice(start));
  }
  return speech.length ? { speech, asides, column } : null;
}

/** Speech and narration of one paragraph, or null when it is not dialogue. */
export function splitParagraph(paragraph: string): { speech: string[]; narration: string } | null {
  const parsed = parseParagraph(paragraph);
  return parsed && { speech: parsed.speech, narration: parsed.asides.join(' ').replace(/\s+/g, ' ').trim() };
}

interface NameIndex {
  characterId: string;
  folded: string;
  search: RegExp;
  before: RegExp;
  after: RegExp;
}

export function nameIndex(characters: readonly VoiceCharacter[]): NameIndex[] {
  const names: Pick<NameIndex, 'characterId' | 'folded'>[] = [];
  const firstWords = new Map<string, string[]>();
  for (const c of characters) {
    for (const name of [c.name, ...c.aliases]) {
      const folded = foldText(name.trim());
      if (folded.length >= 2) names.push({ characterId: c.id, folded });
    }
    const first = foldText(c.name.trim().split(/\s+/)[0] ?? '');
    if (first.length >= 3) firstWords.set(first, [...(firstWords.get(first) ?? []), c.id]);
  }
  // A first name counts when only one character has it.
  for (const [folded, ids] of firstWords) if (ids.length === 1 && !names.some((n) => n.folded === folded)) names.push({ characterId: ids[0], folded });
  return names.sort((a, b) => b.folded.length - a.folded.length).map(({ characterId, folded }) => {
    const name = escapeRegExp(folded);
    const start = '(^|[^\\p{L}\\p{N}])', end = '(?=$|[^\\p{L}\\p{N}])';
    return { characterId, folded, search: new RegExp(start + name + end, 'u'),
      before: new RegExp(start + name + '$', 'u'), after: new RegExp('^' + name + end, 'u') };
  });
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Characters named in a text, in the order they first appear. */
export function namedIn(text: string, names: readonly NameIndex[]): string[] {
  const folded = foldText(text);
  const hits: Array<{ id: string; at: number }> = [];
  for (const { characterId, search } of names) {
    const match = search.exec(folded);
    if (match) hits.push({ id: characterId, at: match.index + match[1].length });
  }
  hits.sort((a, b) => a.at - b.at);
  return [...new Set(hits.map((h) => h.id))];
}

const SPEECH_VERBS = new Set((
  'dijo dice respondio responde contesto contesta pregunto pregunta exclamo exclama grito grita ' +
  'susurro susurra murmuro murmura replico replica anadio anade afirmo afirma insistio insiste ' +
  'prosiguio continuo interrumpio observo comento explico declaro suplico protesto balbuceo tartamudeo ' +
  'said says answered answers replied replies asked asks exclaimed cried shouted whispered ' +
  'murmured muttered added continued interrupted observed commented explained declared insisted'
).split(' '));

function tagSubjects(asides: readonly string[], names: readonly NameIndex[]) {
  const speakers = new Set<string>(), pronouns = new Set<VoiceGender>();
  let speechVerb = false;
  const examine = (text: string, side: 'before' | 'after') => {
    const pronoun = (side === 'before' ? text.match(/(?:^|[^\p{L}])(ella|él|elle|she|he)$/iu)
      : text.match(/^(ella|él|elle|she|he)(?=$|[^\p{L}])/iu))?.[1].toLowerCase();
    if (pronoun) {
      pronouns.add(pronoun === 'elle' ? 'neutral' : ['ella', 'she'].includes(pronoun) ? 'feminine' : 'masculine');
      return;
    }
    const folded = foldText(text);
    const matches = names.filter((name) => name[side].test(folded));
    for (const match of matches) if (match.folded.length === matches[0].folded.length) speakers.add(match.characterId);
  };
  for (const aside of asides) {
    const text = aside.normalize('NFC');
    for (const word of text.matchAll(/\p{L}+/gu)) {
      if (!SPEECH_VERBS.has(foldText(word[0]))) continue;
      speechVerb = true;
      examine(text.slice(0, word.index).trimEnd(), 'before');
      examine(text.slice(word.index + word[0].length).trimStart(), 'after');
    }
  }
  if (!speechVerb && asides.length) for (const id of namedIn(asides.join(' '), names)) speakers.add(id);
  return { speakers: [...speakers], pronouns: [...pronouns] };
}

/** Every dialogue line of the manuscript and the Dialog Scene blocks, attributed where the text allows. */
export function extractDialogue(sources: readonly VoiceSource[], characters: readonly VoiceCharacter[], blocks: readonly VoiceSceneBlock[] = []): DialogueLine[] {
  const names = nameIndex(characters);
  const genders = new Map(characters.map((character) => [character.id, character.gender]));
  const out: DialogueLine[] = [];
  for (const source of sources) {
    let run: DialogueLine[] = [];
    let previousNarration: string[] | null = null;
    source.text.split(/\n+/).forEach((paragraph, index) => {
      if (!paragraph.trim()) return;
      const split = parseParagraph(paragraph);
      if (!split) {
        run = [];
        previousNarration = namedIn(paragraph, names);
        return;
      }
      const quote = split.speech[0];
      const line: DialogueLine = {
        id: `${source.writingId}:${index}`, writingId: source.writingId, chapter: source.chapter, paragraph: index,
        text: split.speech.join(' '), quote, anchor: { paragraph: index, column: split.column, quote },
        speakerId: null, attribution: null,
      };
      const tagged = tagSubjects(split.asides, names);
      const [a, b] = run.slice(-2).map(({ speakerId }) => speakerId);
      if (tagged.speakers.length === 1 && !tagged.pronouns.length) {
        line.speakerId = tagged.speakers[0]; line.attribution = 'tag';
      } else if (!tagged.speakers.length && tagged.pronouns.length === 1) {
        if (a && b && a !== b && genders.get(a) && genders.get(b)) {
          const matches = [a, b].filter((id) => genders.get(id) === tagged.pronouns[0]);
          if (matches.length === 1) { line.speakerId = matches[0]; line.attribution = 'pronoun'; }
        }
      } else if (!tagged.speakers.length && !tagged.pronouns.length) {
        if (!run.length && previousNarration?.length === 1) { line.speakerId = previousNarration[0]; line.attribution = 'beat'; }
        else if (a && b && a !== b) { line.speakerId = a; line.attribution = 'turn'; }
      }
      run.push(line);
      previousNarration = null;
      out.push(line);
    });
  }
  for (const block of blocks) {
    if (!block.text.trim()) continue;
    out.push({ id: `scene:${block.id}`, sceneId: block.sceneId, chapter: null, paragraph: 0, text: block.text.trim(), quote: block.text.trim(), speakerId: block.characterId, attribution: 'scene' });
  }
  return out;
}
