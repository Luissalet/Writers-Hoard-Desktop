import { codexTextLinkTarget } from '@/components/editor/codexBlocks/inlineLinks';
import { blockIdentifier } from '@/components/editor/codexBlocks/model';

export interface ContentCodexReference { entryId: string; kind: 'link' | 'block' }
const named: Record<string, string> = { amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', apos: "'", nbsp: '\u00a0', sol: '/', colon: ':', quest: '?', equals: '=', num: '#', percnt: '%', Tab: '\t', NewLine: '\n' };
/** Decode once, as serialized attributes require. Unknown/ambiguous entities
 * fail closed rather than turning part of an ID into a query separator. */
function attributeValue(value: string): string | undefined {
  if (value.length > 32000) return undefined;
  let invalid = false;
  const decoded = value.replace(/&(#x[\da-f]+;?|#\d+;?|[a-z][a-z\d]*;?)/gi, (whole, entity: string, offset: number) => {
    const body = entity.replace(/;$/, ''), terminated = entity.endsWith(';');
    if (body.startsWith('#')) {
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || (code >= 0x80 && code <= 0x9f)) { invalid = true; return ''; }
      return String.fromCodePoint(code);
    }
    // In attribute values a semicolon-free name followed by '=' stays literal.
    if (!terminated && /[a-z\d=]/i.test(value[offset + whole.length] ?? '')) return whole;
    if (Object.hasOwn(named, body)) return named[body];
    invalid = true; return '';
  });
  return invalid ? undefined : decoded;
}
const wanted = new Set(['href', 'data-wh-codex-block', 'data-project-id', 'data-entry-id']);
function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    if (!wanted.has(key) || Object.hasOwn(result, key)) continue;
    const value = attributeValue(match[2] ?? match[3] ?? match[4] ?? '');
    // The first duplicate attribute wins, including an invalid first value.
    result[key] = value ?? '';
  }
  return result;
}

/** Worker-safe extraction of authored pointers, never cached labels. This is
 * a bounded serialization reader, not an HTML renderer or sanitizer. Quoted
 * attributes, comments and inert/raw-text elements cannot manufacture links.
 * Atomic Codex fallback bodies are removed from inferred mention analysis. */
export function extractContentCodexReferences(html: string, projectId: string): { references: ContentCodexReference[]; mentionHtml: string } {
  if (!/<(?:a\b|aside\b|script\b|style\b|template\b|textarea\b|!--)/i.test(html)) return { references: [], mentionHtml: html };
  const references: ContentCodexReference[] = [], removed: Array<[number, number]> = [];
  const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z\d:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  let block: { start: number; depth: number } | undefined;
  let inert: { start: number; depth: number } | undefined;
  let cursor = 0;
  for (let token = tags.exec(html); token; token = tags.exec(html)) {
    // A later '<a' inside an unterminated quoted tag is not a new element.
    if (/<\/?[a-z][a-z\d:-]*\b/i.test(html.slice(cursor, token.index))) break;
    cursor = tags.lastIndex;
    if (!token[1]) { if (!block && !inert) removed.push([token.index, tags.lastIndex]); continue; }
    const name = token[1].toLowerCase(), closing = /^<\//.test(token[0]);
    if (!closing && /^(script|style|title|textarea|xmp|iframe|noembed|noframes|noscript|plaintext)$/.test(name)) {
      const end = name === 'plaintext' ? null : new RegExp(`</${name}\\b[^>]*>`, 'gi');
      if (end) end.lastIndex = tags.lastIndex;
      const stop = end?.exec(html); const endIndex = stop ? end!.lastIndex : html.length;
      if (!block && !inert) removed.push([token.index, endIndex]);
      tags.lastIndex = endIndex; cursor = endIndex; continue;
    }
    if (inert) {
      if (name === 'template') { inert.depth += closing ? -1 : 1; if (!inert.depth) { if (!block) removed.push([inert.start, tags.lastIndex]); inert = undefined; } }
      continue;
    }
    if (name === 'template' && !closing) { inert = { start: token.index, depth: 1 }; continue; }
    if (block) {
      if (name === 'aside') { block.depth += closing ? -1 : 1; if (!block.depth) { removed.push([block.start, tags.lastIndex]); block = undefined; } }
      continue;
    }
    if (closing || (name !== 'a' && name !== 'aside')) continue;
    const attrs = attributes(token[2]);
    if (name === 'aside' && attrs['data-wh-codex-block'] === 'true') {
      block = { start: token.index, depth: 1 };
      const entryId = blockIdentifier(attrs['data-entry-id']);
      if (entryId && blockIdentifier(attrs['data-project-id']) === projectId) references.push({ entryId, kind: 'block' });
    } else if (name === 'a' && attrs.href) {
      const entryId = codexTextLinkTarget(attrs.href, projectId);
      if (entryId) references.push({ entryId, kind: 'link' });
    }
  }
  if (block) removed.push([block.start, html.length]);
  if (inert && !block) removed.push([inert.start, html.length]);
  if (!removed.length) return { references, mentionHtml: html };
  const pieces: string[] = []; let start = 0;
  for (const [from, to] of removed) { if (from < start) continue; pieces.push(html.slice(start, from), ' '); start = to; }
  pieces.push(html.slice(start));
  return { references, mentionHtml: pieces.join('') };
}
