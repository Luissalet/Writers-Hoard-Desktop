// Dialogue lines of a manuscript and who says them. Pure: plain text in, lines out.
//
// Spanish dialogue opens a paragraph with a dash (—) and alternates speech and
// the narrator's aside (inciso) between dashes; English dialogue sits between
// quotes (“ ” or " ") with the narration around it; «» count when the paragraph
// opens with them. A speaker is taken, in this order, from a name or alias of
// a Codex character in the aside (`tag`), from the narration paragraph just
// before that names exactly one character (`beat`), or from the turn order of
// a two-voice exchange (`turn`). Dialog Scene blocks carry their character (`scene`).

export interface VoiceCharacter { id: string; name: string; aliases: readonly string[] }
export interface VoiceSource { writingId: string; chapter: number | null; title: string; text: string }
export interface VoiceSceneBlock { id: string; sceneId: string; characterId: string; text: string }

export type Attribution = 'tag' | 'beat' | 'turn' | 'scene';

export interface DialogueLine {
  /** `<writingId>:<paragraph>` or `scene:<blockId>`. */
  id: string;
  writingId?: string;
  sceneId?: string;
  chapter: number | null;
  paragraph: number;
  /** Speech only, asides removed. */
  text: string;
  /** The first stretch of speech exactly as written, to find it in the chapter. */
  quote: string;
  speakerId: string | null;
  attribution: Attribution | null;
}

const DASH_START = /^\s*[—―]\s*/;
const DASH_SPLIT = /\s*[—―]\s*/;
const QUOTED = /[“"«]([^”"»]{1,2000})[”"»]/g;

export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Speech and narration of one paragraph, or null when it is not dialogue. */
export function splitParagraph(paragraph: string): { speech: string[]; narration: string } | null {
  if (DASH_START.test(paragraph)) {
    const parts = paragraph.replace(DASH_START, '').split(DASH_SPLIT);
    const speech: string[] = [], asides: string[] = [];
    parts.forEach((part, index) => (index % 2 === 0 ? speech : asides).push(part));
    const cleaned = speech.map((s) => s.replace(/^[\s.,;:]+/, '').trim()).filter(Boolean);
    return cleaned.length ? { speech: cleaned, narration: asides.join(' ').trim() } : null;
  }
  const trimmed = paragraph.trim();
  if (!/^[“"«]/.test(trimmed) && !/[“"][^”"]{2,}[”"]/.test(trimmed)) return null;
  const speech: string[] = [];
  const narration = trimmed.replace(QUOTED, (_, said: string) => { if (said.trim()) speech.push(said.trim()); return ' '; }).replace(/\s+/g, ' ').trim();
  return speech.length ? { speech, narration } : null;
}

interface NameIndex { characterId: string; folded: string }

export function nameIndex(characters: readonly VoiceCharacter[]): NameIndex[] {
  const names: NameIndex[] = [];
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
  return names.sort((a, b) => b.folded.length - a.folded.length);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Characters named in a text, in the order they first appear. */
export function namedIn(text: string, names: readonly NameIndex[]): string[] {
  const folded = foldText(text);
  const hits: Array<{ id: string; at: number }> = [];
  for (const { characterId, folded: name } of names) {
    const match = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`, 'u').exec(folded);
    if (match) hits.push({ id: characterId, at: match.index + match[1].length });
  }
  hits.sort((a, b) => a.at - b.at);
  return [...new Set(hits.map((h) => h.id))];
}

/** Every dialogue line of the manuscript and the Dialog Scene blocks, attributed where the text allows. */
export function extractDialogue(sources: readonly VoiceSource[], characters: readonly VoiceCharacter[], blocks: readonly VoiceSceneBlock[] = []): DialogueLine[] {
  const names = nameIndex(characters);
  const out: DialogueLine[] = [];
  for (const source of sources) {
    let run: DialogueLine[] = [];
    let previousNarration: string[] | null = null;
    source.text.split(/\n+/).forEach((paragraph, index) => {
      if (!paragraph.trim()) return;
      const split = splitParagraph(paragraph);
      if (!split) {
        run = [];
        previousNarration = namedIn(paragraph, names);
        return;
      }
      const line: DialogueLine = { id: `${source.writingId}:${index}`, writingId: source.writingId, chapter: source.chapter, paragraph: index, text: split.speech.join(' '), quote: split.speech[0], speakerId: null, attribution: null };
      const tagged = split.narration ? namedIn(split.narration, names) : [];
      if (tagged.length) { line.speakerId = tagged[0]; line.attribution = 'tag'; }
      else if (!run.length && previousNarration?.length === 1) { line.speakerId = previousNarration[0]; line.attribution = 'beat'; }
      else if (run.length >= 2) {
        const a = run[run.length - 2].speakerId, b = run[run.length - 1].speakerId;
        if (a && b && a !== b) { line.speakerId = a; line.attribution = 'turn'; }
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
