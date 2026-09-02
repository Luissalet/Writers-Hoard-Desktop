import DOMPurify, { type Config } from 'dompurify';

const SAFE_RASTER_DATA_URL = /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp);base64,/i;

/**
 * The attributes a browser reads as a URL. Only these can carry a `data:`
 * document anywhere; a footnote body, an `alt` or a `title` that happens to
 * begin with the word "Data:" is text, and used to be thrown away with the
 * rest.
 */
const URI_ATTRIBUTES = new Set([
  'src', 'href', 'xlink:href', 'action', 'formaction', 'poster', 'background',
  'cite', 'data', 'ping', 'srcset', 'longdesc', 'usemap',
]);

// DOMPurify intentionally permits data: URLs on image-like elements. Narrow
// that exception so persisted SVG/XML documents cannot enter through <img>.
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (
    URI_ATTRIBUTES.has(data.attrName.toLowerCase())
    && data.attrValue.trimStart().toLowerCase().startsWith('data:')
    && !(node.nodeName === 'IMG' && data.attrName === 'src' && SAFE_RASTER_DATA_URL.test(data.attrValue))
  ) {
    data.keepAttr = false;
  }
});

/**
 * TipTap's persisted output is semantic HTML. Keep that vocabulary while
 * removing executable, interactive, and layout-injection primitives before
 * React inserts the markup into the document.
 */
const RICH_HTML_CONFIG: Config = {
  USE_PROFILES: { html: true },
  ALLOW_ARIA_ATTR: true,
  ALLOW_DATA_ATTR: true,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  RETURN_TRUSTED_TYPE: false,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: [
    'audio',
    'base',
    'button',
    'dialog',
    'embed',
    'form',
    'iframe',
    'input',
    'link',
    'meta',
    'object',
    'option',
    'select',
    'source',
    'style',
    'template',
    'textarea',
    'video',
  ],
  FORBID_ATTR: ['autofocus', 'formaction', 'srcdoc', 'srcset', 'style'],
  // DOMPurify's default URI policy blocks javascript:, vbscript:, file:, and
  // unknown schemes. The explicit policy also keeps the raster data URLs used
  // by TipTap images while rejecting active SVG data documents.
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel):|data:image\/(?:avif|bmp|gif|jpe?g|png|webp);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
};

/** Sanitize persisted rich text immediately before it enters an HTML sink. */
export function sanitizeRichHtml(html: string): string {
  return DOMPurify.sanitize(html, RICH_HTML_CONFIG);
}

/**
 * The sole bridge intended for React's `dangerouslySetInnerHTML` prop. Keeping
 * this shape centralized makes every persisted-HTML sink easy to audit.
 */
export function sanitizedHtml(html: string): { __html: string } {
  return { __html: sanitizeRichHtml(html) };
}
