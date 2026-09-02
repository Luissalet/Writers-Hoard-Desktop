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
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Count words in plain text or HTML (tags are stripped first). */
export function countWords(htmlOrText: string): number {
  const text = htmlOrText.includes('<') ? stripHtml(htmlOrText) : htmlOrText.trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}
