// ============================================
// HTML → plain text (anchor-stable)
// ============================================
//
// The writings + codex editors store HTML (Tiptap). We anchor against the
// HTML-stripped body so format-only edits ("bold this word") don't shift
// every offset downstream of them.
//
// Rules:
//   - block-level tags (p, div, h1-6, li, br, blockquote, pre, hr) are
//     replaced with `\n` so paragraphs stay separated when joined
//   - all other tags drop to whitespace-free joins
//   - HTML entities are decoded for &amp;, &lt;, &gt;, &quot;, &#39;, &nbsp;
//   - Multiple consecutive blank lines are collapsed to two
//
// Pure function. Same input always → same output. Important for caching
// and for diff-based reanchor heuristics.

const BLOCK_TAGS = /<\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|pre|hr|table|tr|article|section|header|footer|aside)(?:\s[^>]*)?>/gi;
const BR_TAG = /<br\s*\/?>/gi;
const ANY_TAG = /<\/?[a-z][^>]*>/gi;

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(input: string): string {
  return input
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENTITY_MAP[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/**
 * Convert HTML (or plain text — pass-through safe) to a plain-text body
 * suitable for character-offset anchoring.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  const withBreaks = html
    .replace(BR_TAG, '\n')
    .replace(BLOCK_TAGS, '\n');
  const stripped = withBreaks.replace(ANY_TAG, '');
  const decoded = decodeEntities(stripped);
  return decoded
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
