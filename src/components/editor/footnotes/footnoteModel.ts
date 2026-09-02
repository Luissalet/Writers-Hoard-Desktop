import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { FootnoteMarkerStyle, FootnotePlacement } from '@/types';

/**
 * Footnotes, as data.
 *
 * A footnote lives in the document as one inline atom node, serialised to
 * `<sup data-footnote-id="…" data-footnote="…" class="wh-footnote-ref"></sup>`.
 * The body travels in the attribute on purpose: it is not prose, so it must
 * not be counted, spell-checked or wrapped as prose, and the sanitizer keeps
 * `data-*` while dropping anything more inventive. (It IS the writer's own
 * words, though: the project search index, project-wide replace and the AI
 * bridge read it out through the helpers below.) The number
 * is nowhere in the markup — a CSS counter prints it in the editor and the
 * reader, so notes renumber themselves when one is added, moved or deleted.
 *
 * Nothing here imports Tiptap. The exporters and the reading view work from
 * persisted HTML and need the same numbering the editor shows, so the order
 * of the notes is defined once, here, as document order.
 */

export const FOOTNOTE_NODE_NAME = 'footnote';
export const FOOTNOTE_REF_CLASS = 'wh-footnote-ref';
export const FOOTNOTE_ID_ATTR = 'data-footnote-id';
export const FOOTNOTE_TEXT_ATTR = 'data-footnote';
export const FOOTNOTE_REF_SELECTOR = `sup[${FOOTNOTE_ID_ATTR}]`;

export const FOOTNOTE_MARKER_STYLES: readonly FootnoteMarkerStyle[] = ['numbers', 'symbols', 'roman', 'letters'];
export const DEFAULT_FOOTNOTE_STYLE: FootnoteMarkerStyle = 'numbers';

/** The classic printer's sequence; past the sixth note the symbols double, as in print. */
const MARKER_SYMBOLS = ['*', '†', '‡', '§', '‖', '¶'];

/** A style name from anywhere (a row, a setting) that may be stale or garbage. */
export function normalizeFootnoteStyle(value: unknown): FootnoteMarkerStyle {
  return FOOTNOTE_MARKER_STYLES.includes(value as FootnoteMarkerStyle)
    ? (value as FootnoteMarkerStyle)
    : DEFAULT_FOOTNOTE_STYLE;
}

export const FOOTNOTE_PLACEMENTS: readonly FootnotePlacement[] = ['chapter', 'book'];
export const DEFAULT_FOOTNOTE_PLACEMENT: FootnotePlacement = 'chapter';

/** A placement from anywhere (a row, a setting) that may be stale or garbage. */
export function normalizeFootnotePlacement(value: unknown): FootnotePlacement {
  return FOOTNOTE_PLACEMENTS.includes(value as FootnotePlacement)
    ? (value as FootnotePlacement)
    : DEFAULT_FOOTNOTE_PLACEMENT;
}

function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let rest = n;
  let out = '';
  for (const [value, glyph] of table) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

function toLetters(n: number): string {
  // a..z, then aa..az, ba.. — the spreadsheet column scheme (bijective base 26).
  let rest = n;
  let out = '';
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    out = String.fromCharCode(97 + digit) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

/**
 * The marker printed for the n-th note (1-based) in a style. This is the
 * one place that decides it; the CSS counter styles in `index.css` mirror it
 * for the editor and the reader, and the exporters that print markers
 * themselves (HTML, PDF, EPUB) call this.
 */
export function formatFootnoteMarker(index: number, style: FootnoteMarkerStyle): string {
  // A NaN would index past the symbols and an Infinity would spell roman
  // numerals forever; either is a caller's bug, and the first marker is the
  // honest answer to it.
  const n = Number.isFinite(index) ? Math.max(1, Math.floor(index)) : 1;
  switch (style) {
    case 'symbols': {
      const symbol = MARKER_SYMBOLS[(n - 1) % MARKER_SYMBOLS.length];
      return symbol.repeat(Math.floor((n - 1) / MARKER_SYMBOLS.length) + 1);
    }
    case 'roman':
      return toRoman(n);
    case 'letters':
      return toLetters(n);
    default:
      return String(n);
  }
}

/** A note found in a live ProseMirror document. */
export interface FootnoteRef {
  id: string;
  text: string;
  /** Position of the node when it was collected; an edit above it moves it. */
  pos: number;
  /** 1-based, in document order. */
  index: number;
}

/** A note read out of persisted HTML. */
export interface ExtractedFootnote {
  id: string;
  text: string;
  /** 1-based, in the order the references appear. */
  index: number;
}

/** Every footnote in the document, numbered in reading order. */
export function collectFootnotes(doc: ProseMirrorNode): FootnoteRef[] {
  const notes: FootnoteRef[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== FOOTNOTE_NODE_NAME) return true;
    notes.push({
      id: String(node.attrs.id ?? ''),
      text: String(node.attrs.text ?? ''),
      pos,
      index: notes.length + 1,
    });
    return false;
  });
  return notes;
}

/** Where one note is right now, or `null` when the document no longer holds it. */
export function findFootnote(
  doc: ProseMirrorNode,
  id: string,
): { node: ProseMirrorNode; pos: number } | null {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === FOOTNOTE_NODE_NAME && node.attrs.id === id) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

/** Same ids, same texts, same order: the list a panel shows has not changed. */
export function sameFootnotes(
  left: readonly Pick<FootnoteRef, 'id' | 'text'>[],
  right: readonly Pick<FootnoteRef, 'id' | 'text'>[],
): boolean {
  if (left.length !== right.length) return false;
  for (let at = 0; at < left.length; at += 1) {
    if (left[at].id !== right[at].id || left[at].text !== right[at].text) return false;
  }
  return true;
}

function parseFragment(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body;
}

function readRef(element: Element, index: number): ExtractedFootnote {
  return {
    id: element.getAttribute(FOOTNOTE_ID_ATTR) ?? '',
    text: element.getAttribute(FOOTNOTE_TEXT_ATTR) ?? '',
    index,
  };
}

/**
 * The notes of a persisted body, numbered as the editor numbers them.
 *
 * `DOMParser`, not a regex: the serialiser leaves `<` and `>` unescaped inside
 * attribute values, so a note reading "a > b" would cut a pattern short.
 */
export function extractFootnotesFromHtml(html: string): ExtractedFootnote[] {
  if (!html.includes(FOOTNOTE_ID_ATTR)) return [];
  return [...parseFragment(html).querySelectorAll(FOOTNOTE_REF_SELECTOR)].map((element, at) =>
    readRef(element, at + 1),
  );
}

/**
 * The body with every reference replaced by whatever an exporter prints in
 * its place — a numbered link, a Markdown marker — and the notes it found.
 *
 * `start` lets a format that numbers the whole book continuously (DOCX) pick
 * up where the previous chapter stopped; the others restart at 1. A body with
 * no references is returned untouched, byte for byte, so this pass costs a
 * chapter without notes nothing and cannot re-serialise it.
 */
export function renderFootnoteRefs(
  html: string,
  render: (note: ExtractedFootnote) => string,
  start = 1,
): { html: string; notes: ExtractedFootnote[] } {
  if (!html.includes(FOOTNOTE_ID_ATTR)) return { html, notes: [] };
  const body = parseFragment(html);
  const notes: ExtractedFootnote[] = [];
  for (const element of [...body.querySelectorAll(FOOTNOTE_REF_SELECTOR)]) {
    const note = readRef(element, start + notes.length);
    notes.push(note);
    const holder = body.ownerDocument.createElement('span');
    holder.innerHTML = render(note);
    element.replaceWith(...holder.childNodes);
  }
  return { html: body.innerHTML, notes };
}

export function escapeFootnoteHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The reference as persisted bytes, for code that builds a body without an
 * editor (the AI bridge reading Markdown). Same element, same attribute
 * order as `FootnoteNode.renderHTML`, so what it writes is what the editor
 * would have written.
 */
export function footnoteRefHtml(id: string, text: string): string {
  return `<sup ${FOOTNOTE_ID_ATTR}="${escapeFootnoteHtml(id)}" ${FOOTNOTE_TEXT_ATTR}="${escapeFootnoteHtml(text)}" class="${FOOTNOTE_REF_CLASS}"></sup>`;
}

/**
 * An id that can travel as a Markdown footnote label (`[^label]`) and come
 * back unchanged. The editor's own ids (`generateId()`: base-36 and an
 * underscore) always pass; anything else — an empty id, a label a model
 * invented with spaces or brackets — does not, and gets a fresh id instead.
 */
export function isFootnoteLabel(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,40}$/.test(value);
}

/**
 * The body with the text of some notes replaced, everything else byte for
 * byte as it was — the same DOM route as `renderFootnoteRefs`, so a body
 * whose note contains `>` or a quote is not cut short by a pattern. Ids the
 * body does not hold are ignored. Used by project-wide replace, which reads
 * a note as a plain-text field and has to write it back into the attribute.
 */
export function withFootnoteTexts(html: string, texts: ReadonlyMap<string, string>): string {
  if (texts.size === 0 || !html.includes(FOOTNOTE_ID_ATTR)) return html;
  const body = parseFragment(html);
  let changed = false;
  for (const element of body.querySelectorAll(FOOTNOTE_REF_SELECTOR)) {
    const text = texts.get(element.getAttribute(FOOTNOTE_ID_ATTR) ?? '');
    if (text === undefined || text === element.getAttribute(FOOTNOTE_TEXT_ATTR)) continue;
    element.setAttribute(FOOTNOTE_TEXT_ATTR, text);
    changed = true;
  }
  return changed ? body.innerHTML : html;
}

/** A note's body as inline HTML: escaped, with its line breaks kept. */
export function footnoteTextHtml(text: string): string {
  return text.split(/\r?\n/).map(escapeFootnoteHtml).join('<br>');
}

export interface EndnotesOptions {
  heading: string;
  /** Marker style; the `<ol>` then prints the marker itself rather than a decimal. */
  style?: FootnoteMarkerStyle;
  /**
   * Link each note back to `#fnref-<id>`. On by default for the exporters,
   * whose references carry that id; off for the reading view, whose
   * references do not (and whose sanitizer renames ids anyway).
   */
  backlinks?: boolean;
}

/**
 * The `<ol>` of some notes. Numbers come from the list, not from the note's
 * `index`: the list is built in order, so the two agree, and a renderer that
 * has no CSS (a mail client, a plain reader) still shows them. When the
 * notes do not start at 1 — a chapter's group in a book-level section, a
 * reading-view chapter numbered on from the last — the list says where it
 * starts, so the printed numbers keep matching the references.
 */
function endnotesList(notes: readonly ExtractedFootnote[], options: EndnotesOptions): string {
  const backlinks = options.backlinks ?? true;
  const items = notes
    .map((note) => {
      const id = escapeFootnoteHtml(note.id);
      const back = backlinks
        ? ` <a href="#fnref-${id}" class="wh-endnote-back" aria-label="${escapeFootnoteHtml(options.heading)} ${note.index}">↩</a>`
        : '';
      const marker = options.style && options.style !== 'numbers'
        ? `<span class="wh-endnote-marker">${escapeFootnoteHtml(formatFootnoteMarker(note.index, options.style))}</span> `
        : '';
      return `<li id="fn-${id}">${marker}${footnoteTextHtml(note.text)}${back}</li>`;
    })
    .join('');
  const listClass = options.style && options.style !== 'numbers' ? ' class="wh-endnotes-marked"' : '';
  const first = notes[0]?.index ?? 1;
  const start = first > 1 ? ` start="${first}"` : '';
  return `<ol${listClass}${start}>${items}</ol>`;
}

/** The notes of one chapter as a section to print after its prose. */
export function renderEndnotesHtml(
  notes: readonly ExtractedFootnote[],
  options: EndnotesOptions,
): string {
  if (notes.length === 0) return '';
  return `<section class="wh-endnotes"><h2>${escapeFootnoteHtml(options.heading)}</h2>${endnotesList(notes, options)}</section>`;
}

/** One chapter's share of a book-level notes section. */
export interface EndnoteGroup {
  /** The chapter's heading, as printed over its notes. */
  title: string;
  /** Its notes, numbered on from the previous chapter's. */
  notes: readonly ExtractedFootnote[];
}

/**
 * Every note of the book as one section to print after the last chapter:
 * the heading, then a sub-heading and a list per chapter that has notes.
 * Chapters without notes are left out — a heading over nothing is a fault,
 * not information. Same ids, same back-links as the per-chapter form, so
 * the references need not know which of the two they point into.
 */
export function renderBookEndnotesHtml(
  groups: readonly EndnoteGroup[],
  options: EndnotesOptions,
): string {
  const chapters = groups.filter((group) => group.notes.length > 0);
  if (chapters.length === 0) return '';
  const body = chapters
    .map((group) => `<h2>${escapeFootnoteHtml(group.title)}</h2>${endnotesList(group.notes, options)}`)
    .join('');
  return `<section class="wh-endnotes wh-endnotes--book"><h1>${escapeFootnoteHtml(options.heading)}</h1>${body}</section>`;
}
