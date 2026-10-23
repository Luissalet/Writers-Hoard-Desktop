// ============================================
// World Markdown export — links between cards as [[wikilinks]]
// ============================================
// Two sources, both the ones the app already resolves:
//   1. links the author made (a text link or an embedded card block pointing
//      at a Codex card, read with the same helper the editor uses);
//   2. mentions of a card's title or alias in prose, found with the shared
//      indexed matcher. Ambiguous names (two cards, one name) never link, and
//      each card is linked once per document, the first time it appears.
// Nothing here touches stored data.

import { codexTextLinkTarget } from '@/components/editor/codexBlocks/inlineLinks';
import { blockIdentifier } from '@/components/editor/codexBlocks/model';
import { createMentionIndex, type MentionIndex } from '@/services/codexReference/indexedMentions';
import type { MatchableEntry } from '@/services/codexReference/matcher';
import { escapeHtml } from './names';

export interface CardRef { id: string; title: string; name: string; path: string }

export interface LinkContext {
  projectId: string;
  cards: ReadonlyMap<string, CardRef>;
  index: MentionIndex | null;
  mentions: boolean;
}

export function createLinkContext(projectId: string, entries: readonly (MatchableEntry & { id: string })[], cards: ReadonlyMap<string, CardRef>, mentions: boolean): LinkContext {
  return { projectId, cards, mentions, index: mentions && entries.length ? createMentionIndex(entries) : null };
}

const cleanLabel = (label: string) => label.replace(/[|[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

export function wikilink(card: CardRef, label?: string): string {
  const text = label === undefined ? '' : cleanLabel(label);
  return text && text !== card.name ? `[[${card.name}|${text}]]` : `[[${card.name}]]`;
}

/** Mentions in plain text. Returns the text with `[[…]]` where a card is named. */
export function linkPlainText(text: string, context: LinkContext, selfId?: string): string {
  if (!context.index || !text) return text;
  const seen = new Set<string>(selfId ? [selfId] : []);
  let out = '', cursor = 0;
  for (const hit of context.index.find(text)) {
    if (hit.ambiguous || hit.entryIds.length !== 1 || seen.has(hit.entryIds[0])) continue;
    const card = context.cards.get(hit.entryIds[0]);
    if (!card) continue;
    seen.add(card.id);
    out += text.slice(cursor, hit.from) + wikilink(card, text.slice(hit.from, hit.to));
    cursor = hit.to;
  }
  return out + text.slice(cursor);
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeBasic(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[entity.toLowerCase()] ?? whole;
  });
}

const attribute = (tag: string, name: string): string => {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return (match?.[1] ?? match?.[2] ?? '').replace(/&amp;/g, '&');
};

export interface HtmlLinkOptions {
  /** Where an embedded data-URL picture goes; null means the picture is left out. */
  image: (dataUrl: string) => string | null;
  imageOmitted: string;
  selfId?: string;
}

/**
 * Rich text (Tiptap HTML) prepared for the shared HTML → Markdown converter:
 * embedded pictures re-pointed or dropped, mentions and card links turned into
 * `[[…]]` text.
 */
export function linkHtml(html: string, context: LinkContext, options: HtmlLinkOptions): string {
  if (!html) return '';
  let source = html;
  if (source.includes('data:')) {
    source = source.replace(/<img\b[^>]*>/gi, tag => {
      const src = attribute(tag, 'src');
      if (!src.startsWith('data:')) return tag;
      const path = options.image(src);
      return path ? `<img src="${path}">` : `<em>${escapeHtml(options.imageOmitted)}</em>`;
    });
  }
  if (context.index) source = linkMentionsInHtml(source, context, options.selfId);
  if (/<a\b|data-wh-codex-block/i.test(source)) {
    source = source.replace(/<aside\b[^>]*\bdata-wh-codex-block\s*=\s*"true"[^>]*>[\s\S]*?<\/aside>/gi, block => {
      const id = blockIdentifier(attribute(block, 'data-entry-id'));
      const card = id && blockIdentifier(attribute(block, 'data-project-id')) === context.projectId ? context.cards.get(id) : undefined;
      return card ? `<p>${escapeHtml(wikilink(card))}</p>` : block;
    });
    source = source.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs: string, inner: string) => {
      const id = codexTextLinkTarget(attribute(attrs, 'href'), context.projectId);
      const card = id ? context.cards.get(id) : undefined;
      if (!card) return whole;
      return escapeHtml(wikilink(card, decodeBasic(inner.replace(/<[^>]+>/g, ''))));
    });
  }
  return source;
}

const SKIP_OPEN = /^<(a|code|pre|script|style)\b/i;
const SKIP_CLOSE = /^<\/(a|code|pre|script|style)\s*>/i;

function linkMentionsInHtml(html: string, context: LinkContext, selfId?: string): string {
  const seen = new Set<string>(selfId ? [selfId] : []);
  const parts = html.split(/(<[^>]*>)/);
  let skipDepth = 0, blockDepth = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('<')) {
      if (SKIP_OPEN.test(part) && !part.endsWith('/>')) skipDepth++;
      else if (SKIP_CLOSE.test(part)) skipDepth = Math.max(0, skipDepth - 1);
      else if (/^<aside\b/i.test(part) && /data-wh-codex-block/i.test(part)) blockDepth++;
      else if (blockDepth && /^<\/aside\s*>/i.test(part)) blockDepth--;
      continue;
    }
    if (!part.trim() || skipDepth || blockDepth) continue;
    let out = '', cursor = 0;
    for (const hit of context.index!.find(part)) {
      if (hit.ambiguous || hit.entryIds.length !== 1 || seen.has(hit.entryIds[0])) continue;
      const card = context.cards.get(hit.entryIds[0]);
      if (!card) continue;
      seen.add(card.id);
      const label = part.slice(hit.from, hit.to);
      out += part.slice(cursor, hit.from) + escapeHtml(wikilink(card, label.includes('&') ? undefined : label));
      cursor = hit.to;
    }
    parts[i] = out + part.slice(cursor);
  }
  return parts.join('');
}
