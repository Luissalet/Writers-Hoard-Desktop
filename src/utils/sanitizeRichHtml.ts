import DOMPurify, { type Config } from 'dompurify';
import { FORMAT_ATTRIBUTES, formattingFromElement, formattingHtmlAttributes, INLINE_KEYS, BLOCK_KEYS, SCENE_BREAK_KEYS, normalizeColumnWidths } from '@/components/editor/advanced/model';
import { REVISION_ATTRIBUTES, REVISION_BREAK_ATTRIBUTES, revisionMetadataFromElement, revisionHtmlAttributes } from '@/engines/writings/revisions/model';
import { EDITORIAL_ATTRIBUTES, normalizeEditorialStyle, normalizeEditorialSection, normalizeEditorialCitation, parseEditorialAttribute, serializeEditorialMetadata } from '@/components/editor/editorial/model';

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

// Stored formatting is semantic data. Reconstruct only known, validated CSS
// after arbitrary incoming style attributes have been removed as before.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return;
  const semantic = [
    { attribute: EDITORIAL_ATTRIBUTES.styleDefinition, tag: 'DIV', value: parseEditorialAttribute(node, EDITORIAL_ATTRIBUTES.styleDefinition, normalizeEditorialStyle) },
    { attribute: EDITORIAL_ATTRIBUTES.section, tag: 'DIV', value: parseEditorialAttribute(node, EDITORIAL_ATTRIBUTES.section, normalizeEditorialSection) },
    { attribute: EDITORIAL_ATTRIBUTES.citation, tag: 'SPAN', value: parseEditorialAttribute(node, EDITORIAL_ATTRIBUTES.citation, normalizeEditorialCitation) },
  ];
  for (const { attribute, tag, value } of semantic) {
    node.removeAttribute(attribute);
    if (node.tagName === tag && value) node.setAttribute(attribute, serializeEditorialMetadata(value));
  }
  if (node.hasAttribute(EDITORIAL_ATTRIBUTES.styleDefinition)) node.setAttribute('hidden', '');
  for (const attribute of [EDITORIAL_ATTRIBUTES.styleId, EDITORIAL_ATTRIBUTES.bibliography]) {
    if (!/^(P|H[1-6])$/.test(node.tagName) || !node.getAttribute(attribute)) node.removeAttribute(attribute);
  }
  for (const boundary of [false, true]) {
    const revisionAttrs = boundary ? REVISION_BREAK_ATTRIBUTES : REVISION_ATTRIBUTES;
    const allowed = boundary ? /^(P|H[1-6])$/.test(node.tagName) : node.tagName === 'SPAN';
    const metadata = allowed ? revisionMetadataFromElement(node, boundary) : null;
    for (const attr of Object.values(revisionAttrs)) node.removeAttribute(attr);
    if (metadata) {
      for (const [attr, value] of Object.entries(revisionHtmlAttributes(metadata, boundary))) node.setAttribute(attr, value);
      if (!boundary) node.classList.add(`wh-revision-${metadata.kind}`);
    } else if (!boundary) {
      node.classList.remove('wh-revision-insertion', 'wh-revision-deletion');
    }
  }
  const keys = node.tagName === 'SPAN' ? INLINE_KEYS : /^(P|H[1-6])$/.test(node.tagName) ? BLOCK_KEYS : node.tagName==='HR'?SCENE_BREAK_KEYS:[];
  const attrs = formattingHtmlAttributes(formattingFromElement(node), keys);
  for (const attr of Object.values(FORMAT_ATTRIBUTES)) node.removeAttribute(attr);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (node.hasAttribute('data-wh-colwidth')) {
    const widths = /^(TD|TH)$/.test(node.tagName) ? normalizeColumnWidths(node.getAttribute('data-wh-colwidth')) : null;
    if (widths) node.setAttribute('data-wh-colwidth', widths.join(','));
    else node.removeAttribute('data-wh-colwidth');
  }
  if (node.hasAttribute('data-wh-page-break')) {
    if (node.tagName === 'DIV') {
      node.setAttribute('data-wh-page-break', 'true');
      node.setAttribute('class', 'wh-manual-page-break');
    } else node.removeAttribute('data-wh-page-break');
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
