// ============================================================================
// Ghost text — the pure rules behind the inline continuation in the editor
// ============================================================================
//
// Nothing here touches the DOM, Dexie, Electron or a model. The editor
// extension (components/editor/ghostText), the request service and the tests
// all run this same code:
//
//   * when a suggestion may be asked for at all (`ghostEligibility`),
//   * which Codex entries the recent text brings into play
//     (`selectGhostCodexNotes`, built on the "Consultar" panel's matcher),
//   * what the model is told (`buildGhostMessages`),
//   * how its answer becomes one short continuation (`trimSuggestion`),
//   * which model answers (`pickGhostRoute`: local only, never a cloud one),
//   * the debounce that cancels what is in flight (`createGhostScheduler`).

import { sanitizeModelText } from '@/services/aiText';
import { entryNames, entrySummary, findMentions, normalizeForMatch } from '@/services/codexReference/matcher';
import type { AiChatMessage, AiConnectionSummary, AiModelDescriptor, AiRouteSelection } from '@/services/aiRuntime/types';

// --------------------------------------------------------------------------
// Limits
// --------------------------------------------------------------------------

/** Idle time after the last keystroke before a suggestion is asked for. */
export const GHOST_DEBOUNCE_MS = 900;
/** The paragraph being written must already say something. */
export const GHOST_MIN_PARAGRAPH_CHARS = 12;
/** Text before the cursor below which the model has nothing to continue. */
export const GHOST_MIN_BEFORE_CHARS = 40;
/** Text before the cursor handed to the model, at most. */
export const GHOST_MAX_BEFORE_CHARS = 2400;
/** A suggestion is one sentence; this is the ceiling when it never ends. */
export const GHOST_MAX_WORDS = 40;
/** Generation cap. ~40 Spanish words fit with room to spare. */
export const GHOST_MAX_TOKENS = 90;
/** Codex entries named in the prompt. */
export const GHOST_MAX_CODEX_NOTES = 4;
const GHOST_NOTE_SUMMARY_CHARS = 220;
const GHOST_STYLE_CHARS = 420;

// --------------------------------------------------------------------------
// Eligibility
// --------------------------------------------------------------------------

/** What the editor reports about the cursor; the rules below decide on it. */
export interface GhostSnapshot {
  editable: boolean;
  focused: boolean;
  /** An IME composition is open: the text under the cursor is not final. */
  composing: boolean;
  selectionEmpty: boolean;
  /** Node type of the block holding the cursor ('paragraph', 'heading', …). */
  parentType: string;
  /** Plain text of that block, before and after the cursor. */
  paragraphBefore: string;
  paragraphAfter: string;
  /** Text before the cursor across blocks, already bounded. */
  before: string;
}

export type GhostBlockReason =
  | 'read-only'
  | 'no-focus'
  | 'composing'
  | 'selection'
  | 'not-prose'
  | 'mid-word'
  | 'not-at-end'
  | 'short-paragraph'
  | 'short-text';

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * A suggestion is only offered where a writer would pause: the cursor sits at
 * the end of an ordinary paragraph that already has some sentence in it, with
 * no selection, in an editor that is editable and focused. Headings, chapter
 * titles and notes are not prose to continue.
 */
export function ghostEligibility(s: GhostSnapshot): { ok: true } | { ok: false; reason: GhostBlockReason } {
  if (!s.editable) return { ok: false, reason: 'read-only' };
  if (!s.focused) return { ok: false, reason: 'no-focus' };
  if (s.composing) return { ok: false, reason: 'composing' };
  if (!s.selectionEmpty) return { ok: false, reason: 'selection' };
  if (s.parentType !== 'paragraph') return { ok: false, reason: 'not-prose' };
  if (s.paragraphAfter.length > 0) {
    return { ok: false, reason: WORD_CHAR.test(s.paragraphAfter[0]) ? 'mid-word' : 'not-at-end' };
  }
  if (s.paragraphBefore.trim().length < GHOST_MIN_PARAGRAPH_CHARS) return { ok: false, reason: 'short-paragraph' };
  if (s.before.trim().length < GHOST_MIN_BEFORE_CHARS) return { ok: false, reason: 'short-text' };
  return { ok: true };
}

/** The last `max` characters, without starting in the middle of a word. */
export function boundedBefore(text: string, max = GHOST_MAX_BEFORE_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const startsMidWord = WORD_CHAR.test(cut[0]) && WORD_CHAR.test(text[text.length - max - 1] ?? ' ');
  return startsMidWord ? cut.replace(/^\S*\s+/, '') : cut;
}

// --------------------------------------------------------------------------
// Codex context
// --------------------------------------------------------------------------

export interface GhostCodexEntry {
  id: string;
  type: string;
  title: string;
  fields?: Record<string, string>;
  content?: string;
}

export interface GhostCodexNote {
  title: string;
  type: string;
  summary: string;
}

/**
 * The Codex entries the recent text names (by title or alias, accents and case
 * ignored — the same matcher the "Consultar" panel uses), the most recently
 * mentioned first, each reduced to a short summary. A continuation should not
 * contradict a character's eyes or a town's name, and should not be handed the
 * whole Codex to find that out.
 */
export function selectGhostCodexNotes(
  before: string,
  entries: readonly GhostCodexEntry[],
  limit = GHOST_MAX_CODEX_NOTES,
): GhostCodexNote[] {
  if (entries.length === 0 || !before.trim()) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const haystack = normalizeForMatch(before);
  // Recency counts every name the entry answers to, not only its commonest.
  const hits = findMentions(before, entries).map((hit) => ({
    hit,
    last: Math.max(...entryNames(byId.get(hit.entryId) ?? { id: '', title: '' }).map((name) => haystack.lastIndexOf(normalizeForMatch(name)))),
  }));
  hits.sort((a, b) => b.last - a.last || b.hit.count - a.hit.count);
  const notes: GhostCodexNote[] = [];
  for (const { hit } of hits) {
    const entry = byId.get(hit.entryId);
    if (!entry) continue;
    notes.push({
      title: entry.title,
      type: entry.type,
      summary: entrySummary({ fields: entry.fields, content: entry.content }, GHOST_NOTE_SUMMARY_CHARS),
    });
    if (notes.length >= limit) break;
  }
  return notes;
}

/** The project's voice and rules in a few lines — or '' when the brief is off. */
export function styleBriefFromProfile(
  profile: { enabled: boolean; voice?: string; rules?: string } | null | undefined,
): string {
  if (!profile?.enabled) return '';
  const parts = [profile.voice?.trim() && `Voice: ${profile.voice.trim()}`, profile.rules?.trim() && `Rules: ${profile.rules.trim()}`]
    .filter(Boolean)
    .join('\n')
    .replace(/\s*\n\s*/g, '\n');
  return parts.length > GHOST_STYLE_CHARS ? `${parts.slice(0, GHOST_STYLE_CHARS - 1).trimEnd()}…` : parts;
}

// --------------------------------------------------------------------------
// Prompt
// --------------------------------------------------------------------------

export interface GhostPromptInput {
  before: string;
  notes: readonly GhostCodexNote[];
  style?: string;
}

const GHOST_SYSTEM_PROMPT = [
  'You continue a novel manuscript for its author, inside a writing app.',
  'Write ONLY the next sentence that follows the text: one sentence, at most 30 words.',
  'Use the same language, voice, tense and point of view as the text. Stay consistent with the world notes and never contradict them.',
  'Do not repeat, quote or rephrase anything already written. No preface, no labels, no quotation marks around your sentence, no lists, no line breaks, no new paragraph.',
].join(' ');

export function buildGhostMessages(input: GhostPromptInput): AiChatMessage[] {
  const sections: string[] = [];
  if (input.notes.length > 0) {
    sections.push(
      `WORLD NOTES (from the author's codex):\n${input.notes
        .map((note) => `- ${note.title} (${note.type})${note.summary ? `: ${note.summary}` : ''}`)
        .join('\n')}`,
    );
  }
  if (input.style?.trim()) sections.push(`STYLE BRIEF (the author's own words):\n${input.style.trim()}`);
  sections.push(`TEXT SO FAR (continue right after its last word):\n${input.before}`);
  return [
    { role: 'system', content: GHOST_SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n\n') },
  ];
}

// --------------------------------------------------------------------------
// The answer, reduced to one continuation
// --------------------------------------------------------------------------

export interface TrimOptions {
  maxWords?: number;
  /** The model hit its token cap: its last word may be cut off. */
  truncated?: boolean;
}

const ABBREVIATION = /(?:^|[\s(«“"'¿¡])(?:Sr|Sra|Srta|Dr|Dra|Dña|Prof|Mr|Mrs|Ms|St|etc|pág|núm|vs|cap|aprox|Ud|Uds)$/i;
const CLOSERS = '["\'»”’)\\]]*';

/**
 * Index just after the first sentence-ending mark (with its closing quotes),
 * or -1. `needSpaceAfter` demands whitespace behind it — the streaming test,
 * where "3." may still become "3.5".
 */
function sentenceEnd(text: string, needSpaceAfter: boolean): number {
  const pattern = new RegExp(`[.!?…]+${CLOSERS}(?=\\s${needSpaceAfter ? '' : '|$'})`, 'gu');
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    const mark = match[0].replace(new RegExp(`${CLOSERS}$`, 'u'), '');
    if (mark === '.' && ABBREVIATION.test(text.slice(0, match.index ?? 0))) continue;
    return end;
  }
  return -1;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function stripWrappers(text: string): string {
  let out = text
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .replace(/^\s*(?:next sentence|continuation|continuaci[oó]n|siguiente frase|texto)\s*:\s*/i, '');
  const wrapped: Array<[string, string]> = [['"', '"'], ['“', '”'], ['«', '»']];
  for (const [open, close] of wrapped) {
    if (out.startsWith(open) && out.endsWith(close) && out.length > 2 && !out.slice(1, -1).includes(open) && !out.slice(1, -1).includes(close)) {
      out = out.slice(1, -1);
    }
  }
  return out.trim();
}

/** Drops the start of `text` when it merely repeats the end of `before`. */
function withoutEcho(text: string, before: string): string {
  const tail = before.trimEnd();
  const max = Math.min(tail.length, text.length, 240);
  for (let n = max; n >= 8; n--) {
    if (!tail.endsWith(text.slice(0, n))) continue;
    const previous = tail[tail.length - n - 1];
    if (previous !== undefined && WORD_CHAR.test(previous) && WORD_CHAR.test(text[0])) continue;
    return text.slice(n).trimStart();
  }
  return text;
}

/** A first sentence already written within the recent text is a loop, not a continuation. */
function repeatsRecentText(text: string, before: string): boolean {
  const end = sentenceEnd(text, false);
  const first = (end === -1 ? text : text.slice(0, end)).trim();
  if (countWords(first) < 4) return false;
  return normalizeForMatch(before.slice(-1500)).includes(normalizeForMatch(first).replace(/\s+/g, ' '));
}

/** Cleaning shared by the final trim and the streaming "is it done?" test. */
function prepare(raw: string, before: string): string {
  const firstLine = stripWrappers(sanitizeModelText(raw ?? '')).split(/\r?\n/).find((line) => line.trim()) ?? '';
  return withoutEcho(firstLine.trim(), before);
}

/** Space between what is written and what is suggested. */
function joiner(before: string, text: string): string {
  if (!before || /\s$/.test(before)) return text.trimStart();
  if (/^[,.;:!?)\]»”’…]/.test(text)) return text;
  if (/[¿¡([«“‘]$/.test(before)) return text;
  return ` ${text}`;
}

/**
 * Turn a model's reply into the text to show after the cursor: one paragraph,
 * without a repeat of what was already written, cut at the end of the first
 * sentence (or the word cap), with the space the join needs. '' means "show
 * nothing" — which is the right answer far more often than a bad guess.
 */
export function trimSuggestion(raw: string, before: string, options: TrimOptions = {}): string {
  const maxWords = options.maxWords ?? GHOST_MAX_WORDS;
  let text = prepare(raw, before);
  if (!text || repeatsRecentText(text, before)) return '';

  const end = sentenceEnd(text, false);
  if (end !== -1) {
    text = text.slice(0, end);
  } else {
    const words = text.split(/\s+/);
    if (words.length > maxWords) text = words.slice(0, maxWords).join(' ');
    else if (options.truncated && words.length > 1) text = words.slice(0, -1).join(' ');
    text = text.replace(/[\s,;:\-–—]+$/u, '');
  }
  if (countWords(text) > maxWords) text = text.split(/\s+/).slice(0, maxWords).join(' ');

  text = text.trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  if (countWords(text) < 2 && sentenceEnd(text, false) === -1) return '';
  return joiner(before, text);
}

/**
 * True once the streamed text already holds a whole sentence (or the word cap):
 * the request can be cancelled there instead of letting the model run on.
 */
export function isSuggestionComplete(rawSoFar: string, before: string, maxWords = GHOST_MAX_WORDS): boolean {
  const text = prepare(rawSoFar, before);
  if (!text) return false;
  return sentenceEnd(text, true) !== -1 || countWords(text) >= maxWords;
}

/** Splits off the next word (with the space before it) for word-by-word accept. */
export function splitFirstWord(text: string): { word: string; rest: string } {
  const match = /^\s*\S+/.exec(text);
  if (!match) return { word: text, rest: '' };
  return { word: match[0], rest: text.slice(match[0].length) };
}

// --------------------------------------------------------------------------
// Which model answers
// --------------------------------------------------------------------------

export interface GhostRouteInput {
  /** The route the writer picked for the app's chat features. */
  defaultChat?: AiRouteSelection;
  connections: readonly AiConnectionSummary[];
  modelsByConnection: Readonly<Record<string, { models: readonly AiModelDescriptor[] } | undefined>>;
}

/** A model small enough that sharing the GPU with the chat model is not a problem. */
const SMALL_ENOUGH_B = 14;
/** Below this the continuations are noise. */
const TOO_SMALL_B = 1.5;
const CODER = /coder|-code|codestral|starcoder/i;

export function isLocalGhostConnection(connection: AiConnectionSummary): boolean {
  return (
    connection.enabled &&
    (connection.kind === 'ollama' || connection.kind === 'openai-compatible') &&
    (connection.locality === 'embedded' || connection.locality === 'loopback')
  );
}

function sizeInBillions(model: AiModelDescriptor): number | undefined {
  if (model.parameterCountB) return model.parameterCountB;
  if (model.sizeBytes) return model.sizeBytes / 0.6e9; // ~4-bit weights
  return undefined;
}

/**
 * The model for a continuation — local only. The app has no separate "fast"
 * slot, so: the writer's default chat model when it runs on this machine and is
 * not huge (it is already loaded, and a second model would push it out of GPU
 * memory); otherwise the smallest usable local chat model. A default that
 * lives on the network or in the cloud is never used for this, and without a
 * local model there is simply no suggestion (`null`).
 */
export function pickGhostRoute(input: GhostRouteInput): AiRouteSelection | null {
  const local = input.connections.filter(isLocalGhostConnection);
  const candidates: Array<{ route: AiRouteSelection; sizeB: number | undefined; model: AiModelDescriptor }> = [];
  for (const connection of local) {
    for (const model of input.modelsByConnection[connection.id]?.models ?? []) {
      if (model.type !== 'chat' || !model.capabilities.includes('chat')) continue;
      if (model.installed === false) continue;
      candidates.push({ route: { connectionId: connection.id, modelId: model.id }, sizeB: sizeInBillions(model), model });
    }
  }
  if (candidates.length === 0) return null;

  const chat = input.defaultChat;
  const preferred = chat
    ? candidates.find((c) => c.route.connectionId === chat.connectionId && c.route.modelId === chat.modelId)
    : undefined;
  if (preferred && (preferred.sizeB === undefined || preferred.sizeB <= SMALL_ENOUGH_B)) return preferred.route;

  const usable = candidates.filter((c) => !CODER.test(`${c.model.family ?? ''} ${c.model.id}`) && (c.sizeB === undefined || c.sizeB >= TOO_SMALL_B));
  const pool = usable.length > 0 ? usable : candidates;
  pool.sort(
    (a, b) =>
      (a.sizeB ?? Number.POSITIVE_INFINITY) - (b.sizeB ?? Number.POSITIVE_INFINITY) ||
      a.route.modelId.localeCompare(b.route.modelId),
  );
  return pool[0].route;
}

// --------------------------------------------------------------------------
// Debounce that cancels
// --------------------------------------------------------------------------

export interface GhostTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const REAL_TIMERS: GhostTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface GhostScheduler {
  /** (Re)start the countdown. Whatever was counting or in flight is cancelled. */
  schedule: (run: (signal: AbortSignal) => Promise<void> | void) => void;
  /** Stop counting and abort the request in flight. */
  cancel: () => void;
  readonly pending: boolean;
  readonly inFlight: boolean;
}

/**
 * One keystroke = `schedule`: the previous countdown is dropped and the
 * previous request's signal is aborted, so only the last pause ever produces a
 * suggestion and an old answer can never land on new text. `run` is never
 * awaited by the caller — typing does not wait for a model.
 */
export function createGhostScheduler(delayMs = GHOST_DEBOUNCE_MS, timers: GhostTimers = REAL_TIMERS): GhostScheduler {
  let handle: unknown = null;
  let controller: AbortController | null = null;

  const cancel = (): void => {
    if (handle !== null) {
      timers.clear(handle);
      handle = null;
    }
    if (controller) {
      controller.abort();
      controller = null;
    }
  };

  return {
    schedule(run) {
      cancel();
      handle = timers.set(() => {
        handle = null;
        const mine = new AbortController();
        controller = mine;
        void Promise.resolve()
          .then(() => run(mine.signal))
          .catch(() => undefined)
          .finally(() => {
            if (controller === mine) controller = null;
          });
      }, delayMs);
    },
    cancel,
    get pending() {
      return handle !== null;
    },
    get inFlight() {
      return controller !== null;
    },
  };
}
