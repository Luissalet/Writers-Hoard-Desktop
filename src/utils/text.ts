// ============================================
// Shared text utilities
// ============================================
//
// Single source of truth for word counting and HTML stripping. Previously
// re-implemented in 4+ places with TWO different algorithms — the
// `split(' ')` variant miscounted text with multiple/leading spaces, so
// word counts disagreed between engines.

/**
 * A footnote reference (`<sup data-footnote-id="…" data-footnote="…">`),
 * taken out whole before the tag stripping below. The note's body lives in
 * the attribute, and a `>` in it — "p > 0.05" — would end the generic
 * `<[^>]*>` early and let the rest of the attribute through as prose. The
 * serialiser escapes `>` today; content written before it did, and content
 * built by hand, may still carry one raw, so a quoted value may hold
 * anything but its own quote.
 */
const FOOTNOTE_REF_RE =
  /<sup\b(?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?)*\s*\/?>\s*(?:<\/sup>)?/gi;

/** Strip HTML tags and collapse whitespace into single spaces. */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(FOOTNOTE_REF_RE, (match) => (match.includes('data-footnote-id') ? '' : match))
    // Block-level closers/openers become separators so words don't glue together
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|br)[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    // Last: decoded first, `&amp;lt;` (the text "&lt;") would become "<".
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chinese and Japanese are written without spaces and counted per character
 * (字数, 文字数 — what Word reports too). Splitting on whitespace alone made a
 * whole paragraph of them one "word".
 */
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3005\u30FC]/gu;

/** Thai, Lao, Khmer and Burmese: no spaces and no per-character convention. */
const UNSPACED_SCRIPT_RE = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

let wordSegmenter: Intl.Segmenter | null | undefined;

function countSpacedWords(text: string): number {
  if (UNSPACED_SCRIPT_RE.test(text)) {
    wordSegmenter ??= typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'word' })
      : null;
    if (wordSegmenter) {
      let count = 0;
      for (const segment of wordSegmenter.segment(text)) if (segment.isWordLike) count += 1;
      return count;
    }
  }
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Count words in plain text or HTML (tags are stripped first). */
export function countWords(htmlOrText: string): number {
  const text = htmlOrText.includes('<') ? stripHtml(htmlOrText) : htmlOrText.trim();
  if (!text) return 0;
  const cjk = text.match(CJK_CHAR_RE)?.length ?? 0;
  if (!cjk) return countSpacedWords(text);
  // What the characters leave behind is Latin words and CJK punctuation (。、「」);
  // only the words count.
  const rest = text.replace(CJK_CHAR_RE, ' ').replace(/[^\s\p{L}\p{N}]+/gu, ' ');
  return cjk + countSpacedWords(rest);
}
