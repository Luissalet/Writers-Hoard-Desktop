// ============================================
// The book as one document — compose, split, diff
// ============================================
//
// Every chapter of a manuscript is its own row, and the book editor shows
// them as one document with a chapter heading (`ChapterHeadingNode`) at each
// boundary. This module is the pure model behind that: how the rows are
// joined into one HTML string, how the live document is cut back into
// sections, and how a set of sections is compared with what is on disk. It
// touches no editor and no database, which is what makes it testable in a
// loop and what keeps the save (`bookSave.ts`) a straight reading of a diff.
//
// Two splitters, one source of truth. `splitBookDoc` reads the live
// ProseMirror document and is what the save uses: it serialises each section
// with the editor's own schema, so what goes back into a row is exactly what
// the single-chapter editor would have written. `splitBookHtml` reads an HTML
// string with the browser's parser and exists for tests, imports and anything
// that has a string and no editor; it hands back each section's markup as it
// found it, entities and all.

import { Fragment, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model';
import { createDocument, getHTMLFromFragment } from '@tiptap/core';
import type { Writing } from '@/types';
import { CHAPTER_HEADING_ATTR, CHAPTER_HEADING_NAME } from '@/components/editor/chapterHeading/chapterBlocks';
import { compareManuscriptOrder } from './chapterOrder';

/** One chapter's worth of the book, as the editor holds it. */
export interface BookSection {
  /** The row this section belongs to, or null for a chapter that has no row yet. */
  writingId: string | null;
  /**
   * The heading node's editor-only identity (see `freshClientId`), so a row
   * created for a null section can be stamped on the right heading even if
   * the document moved while the row was being written. Null for a section
   * with no heading node — prose before the first heading — and for
   * sections read from HTML.
   */
  clientId: string | null;
  /** The heading's text. Empty for prose before the first heading. */
  title: string;
  /** The section's prose, WITHOUT the heading. */
  html: string;
}

/** What the diff compares a section against: the row as this session last saw it. */
export interface BookBaseEntry {
  title: string;
  html: string;
}

export interface BookDiff {
  /** Sections whose row exists and whose title or prose moved. */
  updates: { writingId: string; title: string; html: string }[];
  /**
   * Sections with no row: a heading the writer made, prose typed above the
   * first heading, or a heading whose id the base no longer knows (a row
   * deleted since, or a duplicated heading). `index` is the section's place
   * in `sections`.
   */
  creates: { index: number; clientId: string | null; title: string; html: string }[];
  /** Rows the base holds that no section carries any more. */
  missing: string[];
  /** The ids in document order, null where a section has no row yet. */
  order: (string | null)[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The heading the book editor gives a chapter. Attribute order and the empty
 * `data-page-break-before` / `data-chapter-heading` match what the node's
 * `renderHTML` produces, so a chapter whose prose is already canonical Tiptap
 * markup round-trips through `editor.getHTML()` unchanged and the host's
 * content-sync effect has nothing to re-set.
 */
export function chapterHeadingHtml(writing: Pick<Writing, 'id' | 'title' | 'chapter'>): string {
  const chapter = typeof writing.chapter === 'number' ? ` data-chapter="${writing.chapter}"` : '';
  return (
    `<h1 data-writing-id="${escapeHtml(writing.id)}"${chapter}` +
    ` class="wh-chapter-heading" data-page-break-before="" ${CHAPTER_HEADING_ATTR}="">${escapeHtml(writing.title)}</h1>`
  );
}

/** Whether an element is a chapter heading and not a plain `h1` inside a chapter's prose. */
function isChapterHeadingElement(element: Element): boolean {
  return (
    element.tagName === 'H1' &&
    (element.hasAttribute('data-writing-id') || element.hasAttribute(CHAPTER_HEADING_ATTR))
  );
}

/**
 * The book as one HTML string: each chapter's heading followed by its prose,
 * in manuscript order. The caller chooses which chapters are in the book;
 * this only puts them in order.
 */
export function composeBookHtml(writings: readonly Writing[]): string {
  return [...writings]
    .sort(compareManuscriptOrder)
    .map((writing) => chapterHeadingHtml(writing) + writing.content)
    .join('');
}

/**
 * A block that says nothing: whitespace, or a paragraph with no text and no
 * image in it. Prose before the first heading made only of these is not a
 * chapter waiting to be created.
 */
function isBlankNode(node: ChildNode): boolean {
  if (node.nodeType === 3) return !(node.textContent ?? '').trim();
  if (node.nodeType !== 1) return true;
  const element = node as Element;
  if (element.tagName !== 'P') return false;
  return !(element.textContent ?? '').trim() && !element.querySelector('img');
}

/**
 * Cut an HTML string into sections at every top-level chapter heading — an
 * `h1` carrying `data-writing-id` or `data-chapter-heading`, the two the
 * node parses; a bare `h1` is a scene heading inside its chapter. Nodes
 * before the first heading form a section with no id and no title, kept only
 * when they say something. Each section's markup is returned as the parser
 * saw it.
 */
export function splitBookHtml(html: string): BookSection[] {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const sections: BookSection[] = [];
  let current: { section: BookSection; nodes: ChildNode[] } | null = null;
  const close = () => {
    if (!current) return;
    const { section, nodes } = current;
    current = null;
    if (section.writingId === null && section.title === '' && nodes.every(isBlankNode)) return;
    const container = parsed.createElement('div');
    for (const node of nodes) container.appendChild(node);
    section.html = container.innerHTML;
    sections.push(section);
  };
  for (const node of [...parsed.body.childNodes]) {
    if (node.nodeType === 1 && isChapterHeadingElement(node as Element)) {
      close();
      const heading = node as Element;
      current = {
        section: {
          writingId: heading.getAttribute('data-writing-id') || null,
          clientId: null,
          title: (heading.textContent ?? '').trim(),
          html: '',
        },
        nodes: [],
      };
      continue;
    }
    if (!current) {
      current = { section: { writingId: null, clientId: null, title: '', html: '' }, nodes: [] };
    }
    current.nodes.push(node);
  }
  close();
  return sections;
}

/**
 * Cut the live document into sections along its top-level chapter headings.
 * Each section's prose is serialised with the editor's schema — the same
 * serialiser `editor.getHTML()` uses — so the row receives exactly what the
 * single-chapter editor would have saved.
 *
 * A heading whose id an earlier heading already carries (a copied heading
 * pasted back) is reported with a null id: two sections cannot share a row,
 * and the second is a new chapter.
 */
export function splitBookDoc(doc: ProseMirrorNode, schema: Schema): BookSection[] {
  const sections: BookSection[] = [];
  const seen = new Set<string>();
  let current: { section: BookSection; nodes: ProseMirrorNode[] } | null = null;
  const close = () => {
    if (!current) return;
    const { section, nodes } = current;
    current = null;
    if (
      section.writingId === null &&
      section.clientId === null &&
      nodes.every((node) => node.type.name === 'paragraph' && node.content.size === 0)
    ) {
      return;
    }
    section.html = getHTMLFromFragment(Fragment.from(nodes), schema);
    sections.push(section);
  };
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name === CHAPTER_HEADING_NAME) {
      close();
      const rawId = typeof node.attrs.writingId === 'string' ? node.attrs.writingId : null;
      const writingId = rawId !== null && !seen.has(rawId) ? rawId : null;
      if (writingId !== null) seen.add(writingId);
      current = {
        section: {
          writingId,
          clientId: typeof node.attrs.clientId === 'string' ? node.attrs.clientId : null,
          title: node.textContent.trim(),
          html: '',
        },
        nodes: [],
      };
      continue;
    }
    if (!current) {
      current = { section: { writingId: null, clientId: null, title: '', html: '' }, nodes: [] };
    }
    current.nodes.push(node);
  }
  close();
  return sections;
}

/**
 * A row's prose as the editor would serialise it. The diff compares a
 * section against this rather than against the raw row, because a row that
 * was imported or written by a model is not always in Tiptap's own spelling
 * (attribute order, an entity), and a chapter nobody touched must not be
 * rewritten for that.
 */
export function canonicalHtml(html: string, schema: Schema): string {
  const fragment = createDocument(html, schema).content;
  return getHTMLFromFragment(fragment, schema);
}

/** Prose that reads as nothing: the empty document, in either spelling. */
export function normalizeHtml(html: string): string {
  const trimmed = html.trim();
  return trimmed === '<p></p>' ? '' : trimmed;
}

/**
 * What changed between the rows this session last saw and the sections the
 * document holds now. Pure: it decides nothing, it only names the work.
 */
export function diffBookSections(
  base: ReadonlyMap<string, BookBaseEntry>,
  sections: readonly BookSection[],
): BookDiff {
  const diff: BookDiff = { updates: [], creates: [], missing: [], order: [] };
  const seen = new Set<string>();
  sections.forEach((section, index) => {
    const { writingId } = section;
    const entry = writingId !== null && !seen.has(writingId) ? base.get(writingId) : undefined;
    if (writingId === null || !entry) {
      diff.creates.push({ index, clientId: section.clientId, title: section.title, html: section.html });
      diff.order.push(null);
      return;
    }
    seen.add(writingId);
    diff.order.push(writingId);
    if (
      entry.title.trim() !== section.title.trim() ||
      normalizeHtml(entry.html) !== normalizeHtml(section.html)
    ) {
      diff.updates.push({ writingId, title: section.title, html: section.html });
    }
  });
  for (const id of base.keys()) {
    if (!seen.has(id)) diff.missing.push(id);
  }
  return diff;
}
