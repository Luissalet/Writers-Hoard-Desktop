import type { EntitySpan } from './types';

export interface NerToken { index: number; entity: string; score: number }
type Tokenize = (text: string) => string[];
/** BERT basic token units, with exact UTF-16 source locations (including astral CJK). */
function basicUnits(text: string) {
  const result: Array<{ text: string; from: number; to: number }> = []; let word = '', start = 0, offset = 0;
  const flush = () => { if (word) result.push({ text: word, from: start, to: offset }); word = ''; };
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const chinese = code >= 0x4e00 && code <= 0x9fff || code >= 0x3400 && code <= 0x4dbf || code >= 0x20000 && code <= 0x2fa1f || code >= 0xf900 && code <= 0xfaff;
    const punctuation = /\p{P}/u.test(char) || code >= 33 && code <= 47 || code >= 58 && code <= 64 || code >= 91 && code <= 96 || code >= 123 && code <= 126;
    if (/\s/u.test(char) || code === 0 || code === 0xfffd || /\p{C}/u.test(char)) { flush(); offset += char.length; continue; }
    if (chinese || punctuation) { flush(); result.push({ text: char, from: offset, to: offset + char.length }); offset += char.length; continue; }
    if (!word) start = offset; word += char; offset += char.length;
  }
  flush(); return result;
}
/**
 * Transformers.js 4 exposes token indices, but no offsets. Re-tokenize exact
 * basic units and verify the entire token stream before mapping BIO labels.
 * A mismatch is an explicit error, never a guessed search for a decoded name.
 */
export function alignEntityTokens(text: string, tokenize: Tokenize, tokens: NerToken[]): EntitySpan[] {
  const offsets: Array<{ from: number; to: number } | undefined> = [undefined], verified: string[] = [];
  const units = basicUnits(text), starts = new Set(units.map(unit => unit.from)), ends = new Set(units.map(unit => unit.to));
  for (const unit of units) {
    const pieces = tokenize(unit.text); let cursor = unit.from;
    for (const piece of pieces) {
      verified.push(piece);
      if (piece === '[UNK]') { offsets.push({ from: unit.from, to: unit.to }); cursor = unit.to; continue; }
      const literal = piece.startsWith('##') ? piece.slice(2) : piece;
      if (text.slice(cursor, cursor + literal.length) !== literal) throw Error('entity_token_alignment_unavailable');
      offsets.push({ from: cursor, to: cursor + literal.length }); cursor += literal.length;
    }
    if (cursor !== unit.to) throw Error('entity_token_alignment_unavailable');
  }
  const full = tokenize(text);
  if (full.length !== verified.length || full.some((token, index) => token !== verified[index])) throw Error('entity_token_alignment_unavailable');
  const groups: Array<EntitySpan & { last: number; count: number }> = [];
  for (const token of tokens) {
    const position = offsets[token.index], match = /^([BI])-(PER|LOC|ORG)$/.exec(token.entity);
    if (!position || !match || !Number.isFinite(token.score)) continue;
    const label = match[2] as EntitySpan['label'], previous = groups.at(-1);
    if (match[1] === 'I' && previous?.label === label && previous.last + 1 === token.index) {
      previous.to = position.to; previous.score = (previous.score * previous.count + token.score) / ++previous.count; previous.last = token.index; previous.text = text.slice(previous.from, previous.to);
    } else groups.push({ ...position, text: text.slice(position.from, position.to), label, score: token.score, last: token.index, count: 1 });
  }
  // A complete BERT basic unit is the boundary, including each CJK character.
  // WordPiece fragments inside a Latin word remain invalid even without spaces.
  return groups.filter(group => group.score >= 0.8 && group.text.trim().length >= 2 && starts.has(group.from) && ends.has(group.to)).map(({ from, to, text: name, label, score }) => ({ from, to, text: name, label, score }));
}

/** Token-budget chunks cover all input; overlap protects entities at a boundary. */
export function entityChunks(text: string, tokenCount: (text: string) => number): Array<{ text: string; from: number }> {
  const chunks: Array<{ text: string; from: number }> = []; let from = 0;
  while (from < text.length) {
    let to = Math.min(text.length, from + 1600);
    while (tokenCount(text.slice(from, to)) > 448) {
      const next = from + Math.floor((to - from) * 0.75);
      if (next <= from) throw Error('entity_token_budget_unavailable'); to = next;
    }
    if (to < text.length) { const boundary = text.lastIndexOf(' ', to); if (boundary > from + (to - from) / 2) to = boundary; if (/^[\uDC00-\uDFFF]$/.test(text[to] ?? '')) to--; }
    chunks.push({ text: text.slice(from, to), from });
    if (to === text.length) break;
    const overlap = Math.min(160, Math.floor((to - from) / 4)); let next = to - overlap;
    const boundary = text.indexOf(' ', next); if (boundary >= next && boundary < to) next = boundary + 1;
    if (/^[\uDC00-\uDFFF]$/.test(text[next] ?? '')) next++;
    from = Math.max(from + 1, next);
  }
  return chunks;
}
