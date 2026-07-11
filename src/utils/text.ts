// ============================================
// Shared text utilities
// ============================================
//
// Single source of truth for word counting and HTML stripping. Previously
// re-implemented in 4+ places with TWO different algorithms — the
// `split(' ')` variant miscounted text with multiple/leading spaces, so
// word counts disagreed between engines.

/** Strip HTML tags and collapse whitespace into single spaces. */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
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
