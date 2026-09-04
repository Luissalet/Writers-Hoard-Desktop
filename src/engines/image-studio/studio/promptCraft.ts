// ============================================================================
// Prompt craft — the parts of it that are free, and that sd.cpp actually does
// ============================================================================
//
// stable-diffusion.cpp reads A1111 attention: `(word:1.2)` scales a span,
// `(word)` is 1.1 and `[word]` is 1/1.1. So weighting is real here and worth a
// keyboard shortcut, in the same way a novelist expects ctrl+B to be real.
//
// Two things this file deliberately does NOT offer, because the runtime cannot
// do either and offering them would produce a silently different image:
//
//   * prompt scheduling — `[a:b:0.4]` is parsed by A1111 and by ComfyUI, and
//     ignored here. A writer who typed it would get "a:b:0.4" encoded as words.
//   * BREAK — there is no chunk separator in this parser.
//
// The token count is an ESTIMATE and says so in the UI. The real tokeniser
// lives in the server, and a number presented as exact that is off by three
// would be worse than a number labelled as approximate: chunk boundaries are
// where a prompt silently changes meaning, and a writer needs to know roughly
// where they fall, not to be lied to precisely.

export const WEIGHT_STEP = 0.1;
export const WEIGHT_MIN = 0.1;
export const WEIGHT_MAX = 2;

/** CLIP takes 77 tokens per chunk; two are the start and end markers. */
export const TOKENS_PER_CHUNK = 75;

export interface WeightEdit {
  text: string;
  /** The selection to restore, so holding ctrl+↑ keeps working on the same span. */
  start: number;
  end: number;
}

function round(weight: number): number {
  return Math.round(weight * 100) / 100;
}

/** The word under the caret, when nothing is selected. */
function expandToWord(text: string, start: number, end: number): { start: number; end: number } {
  if (start !== end) return { start, end };
  let left = start;
  let right = end;
  while (left > 0 && /[^\s,()[\]]/.test(text[left - 1])) left -= 1;
  while (right < text.length && /[^\s,()[\]]/.test(text[right])) right += 1;
  return { start: left, end: right };
}

/**
 * Nudge the weight of the selection by `delta`.
 *
 * Wrapping an already-wrapped span again is the mistake this avoids: pressing
 * ctrl+↑ three times must give `(word:1.3)`, never `(((word)))`, which the
 * parser reads as 1.33 and which nobody can then edit by hand.
 */
export function adjustWeight(text: string, selStart: number, selEnd: number, delta: number): WeightEdit | null {
  const { start, end } = expandToWord(text, selStart, selEnd);
  const inner = text.slice(start, end).trim();
  if (!inner) return null;

  // Already `(inner:w)` around the selection? Then this is an edit, not a wrap.
  const before = text.slice(0, start);
  const after = text.slice(end);
  const open = /\($/.exec(before);
  const close = /^:(\d+(?:\.\d+)?)\)/.exec(after);
  if (open && close) {
    const weight = round(Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, Number(close[1]) + delta)));
    const head = before.slice(0, before.length - 1);
    const tail = after.slice(close[0].length);
    if (weight === 1) {
      // Back to neutral: take the parentheses off rather than leave `(x:1)`,
      // which is noise the writer then has to read past forever.
      return { text: `${head}${inner}${tail}`, start: head.length, end: head.length + inner.length };
    }
    const replaced = `${head}(${inner}:${weight.toFixed(2).replace(/0$/, '')})${tail}`;
    return { text: replaced, start: head.length + 1, end: head.length + 1 + inner.length };
  }

  const weight = round(Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, 1 + delta)));
  if (weight === 1) return null;
  const head = text.slice(0, start);
  const tail = text.slice(end);
  const wrapped = `${head}(${inner}:${weight.toFixed(2).replace(/0$/, '')})${tail}`;
  return { text: wrapped, start: head.length + 1, end: head.length + 1 + inner.length };
}

export interface WeightedSpan {
  text: string;
  weight: number;
  start: number;
  end: number;
}

/**
 * Every weighted span in the prompt, so the composer can show what is emphasised
 * without the writer having to read parentheses. `(x)` is 1.1 and `[x]` is its
 * reciprocal, which is what this parser does too.
 */
export function weightedSpans(prompt: string): WeightedSpan[] {
  const spans: WeightedSpan[] = [];
  const explicit = /\(([^()]+):(\d+(?:\.\d+)?)\)/g;
  for (const match of prompt.matchAll(explicit)) {
    spans.push({
      text: match[1],
      weight: Number(match[2]),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  const implicit = /\(([^():]+)\)|\[([^[\]:]+)\]/g;
  for (const match of prompt.matchAll(implicit)) {
    const isBracket = match[0].startsWith('[');
    spans.push({
      text: isBracket ? match[2] : match[1],
      weight: isBracket ? round(1 / 1.1) : 1.1,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return spans.sort((left, right) => left.start - right.start);
}

export interface TokenEstimate {
  tokens: number;
  chunks: number;
  /** Where the estimate says a chunk boundary falls, as a token index. */
  boundaries: number[];
  /** Always true. The real count is the server's, and this one says so. */
  approximate: true;
}

/**
 * A rough CLIP token count.
 *
 * BPE splits long or unusual words into several tokens, so a word is counted as
 * one token per four characters, and every comma and parenthesis costs one.
 * That lands within a few tokens of the real count on ordinary prompts, which
 * is all this is for: knowing whether the prompt has crossed into a second
 * chunk, where everything after the boundary is encoded separately and stops
 * interacting with what came before.
 */
export function estimateTokens(prompt: string): TokenEstimate {
  const text = prompt.trim();
  if (!text) return { tokens: 0, chunks: 0, boundaries: [], approximate: true };
  let tokens = 0;
  for (const word of text.split(/\s+/)) {
    const letters = word.replace(/[^A-Za-z0-9À-ɏ]/g, '');
    const marks = word.length - letters.length;
    tokens += Math.max(1, Math.ceil(letters.length / 4)) + marks;
  }
  const chunks = Math.max(1, Math.ceil(tokens / TOKENS_PER_CHUNK));
  const boundaries: number[] = [];
  for (let index = 1; index < chunks; index += 1) boundaries.push(index * TOKENS_PER_CHUNK);
  return { tokens, chunks, boundaries, approximate: true };
}

/**
 * Syntax this runtime does NOT implement, found in the prompt.
 *
 * A writer who has read an A1111 tutorial WILL type `[cat:dog:0.4]` and BREAK.
 * Both reach the text encoder here as literal words, so the composer says so
 * rather than letting them wonder why the trick everyone recommends does
 * nothing.
 */
export function unsupportedSyntax(prompt: string): string[] {
  const found: string[] = [];
  if (/\[[^\]]+:[^\]]+:\d*\.?\d+\]/.test(prompt)) found.push('scheduling');
  if (/\bBREAK\b/.test(prompt)) found.push('break');
  if (/<lora:[^>]+>/i.test(prompt)) found.push('loraToken');
  return found;
}
