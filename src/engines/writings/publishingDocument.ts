import type { FootnoteMarkerStyle, FootnotePlacement, Writing } from '@/types';
import {
  normalizeFootnotePlacement,
  normalizeFootnoteStyle,
} from '@/components/editor/footnotes/footnoteModel';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { countWords } from '@/utils/text';
import { projectWritingHtml } from './revisionProjection';
import { applyBookStyle, normalizeBookStyle, type BookStyle } from './bookStyle';

/**
 * Portable exports deliberately omit every image. In particular, they never
 * fetch remote URLs while producing a document. HTML/PDF keep their existing
 * sanitized images; DOCX/ePub consume `portableHtml` instead.
 */
export const PORTABLE_PUBLISHING_IMAGE_POLICY = 'omit-all' as const;

// XML 1.0 admits no C0 control other than tab, LF and CR, no non-character,
// and no lone surrogate. Both portable formats are XML containers — an .epub
// is XHTML, a .docx is OOXML — so a single one of these anywhere in the
// manuscript is the difference between a file an editor can open and one Word
// calls corrupt, and neither writer can report the problem because both are
// producing a well-formed-looking file out of well-formed-looking parts.
//
// They are not hypothetical: the manuscript importer decodes `&#11;` and
// `&#12;` out of a .docx exactly as written (`decodeXml` in `manuscriptDocx`
// admits every code point above 0), `manuscriptDocx` collapses only tabs,
// NBSPs and spaces, DOMPurify has no opinion about control characters, and a
// .docx converted from a PDF is full of form feeds. So a chapter title carried
// in from someone else's manuscript can hold one, and did.
//
// Cleaning happens HERE, on the IR every writer reads, rather than in each
// writer: ePub had this guard and DOCX did not, which is exactly the shape of
// bug that survives — one format is fine, so the other looks like the
// reader's fault.
// eslint-disable-next-line no-control-regex -- matching the control characters is the point
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Drop what XML cannot carry, keeping tab, LF and CR — which are content in a
 * `<pre>` block — and every other character exactly as the writer typed it.
 * Accents, «», em dashes and astral emoji all pass through untouched; only a
 * surrogate with no partner becomes U+FFFD, because half a character is not a
 * character any encoder can write.
 */
export function xmlSafeText(value: string): string {
  return value.replace(XML_FORBIDDEN, '').replace(LONE_SURROGATE, '\uFFFD');
}

export interface PublishingDocumentSection {
  id: string;
  title: string;
  synopsis?: string;
  html: string;
  portableHtml: string;
  wordCount: number;
  omittedImageCount: number;
  /**
   * The chapter's header image from its Reader presentation, when the profile
   * prints them: a local raster data URL (never fetched), its layout, and the
   * label a banner prints over it.
   */
  headerImage?: { src: string; layout: 'above' | 'beside' | 'banner'; label?: string };
}

export interface PublishingDocument {
  identifier: string;
  title: string;
  /** The byline under the title, when the project has one. */
  author?: string;
  /** A copyright line on a page of its own after the title page. */
  copyright?: string;
  /** The back-cover text, as the book's last page. */
  blurb?: { title: string; text: string };
  /** How the whole book is set, when the profile picks a style. */
  bookStyle?: BookStyle;
  locale: string;
  generatedAt: number;
  includeTitlePage: boolean;
  /**
   * A list of the chapters, after the title page and before the first: a
   * `<nav>` of links in HTML, a list of links in Markdown, a page in the ePub
   * spine, a Word table of contents in DOCX. Off unless the profile asks.
   */
  includeToc: boolean;
  /** Heading over that list, e.g. "Contents" / "Índice". */
  tocTitle: string;
  wordLabel: string;
  wordCount: number;
  /** Heading over a chapter's footnotes, in every format that prints one. */
  notesLabel: string;
  /** How the formats that print their own markers (HTML, PDF, EPUB) mark a note. */
  footnoteStyle: FootnoteMarkerStyle;
  /**
   * `chapter`: each chapter prints its own notes, numbered from 1. `book`: one
   * notes section after the last chapter, grouped by chapter, numbered
   * continuously through the book — a reader sent to note 47 has to be able
   * to find note 47, and every format numbers the same way so a DOCX and an
   * EPUB of the same manuscript agree on which note that is.
   */
  footnotePlacement: FootnotePlacement;
  sections: PublishingDocumentSection[];
  bibliographyTitle?: string;
  bibliography: string[];
  omittedPortableImageCount: number;
}

export interface PublishingDocumentOptions {
  identifier?: string;
  projectTitle: string;
  /** The project's author, printed as a byline on the title page. */
  author?: string;
  copyright?: string;
  blurb?: { title: string; text: string };
  bookStyle?: BookStyle;
  /**
   * Keep the manuscript's own pictures in DOCX and ePub. Off by default: the
   * portable formats then carry no image at all (`PORTABLE_PUBLISHING_IMAGE_POLICY`).
   * On, only pictures stored in the manuscript itself (PNG, JPEG, GIF, WebP data,
   * up to 3 MB each) travel; anything else is still left out and counted.
   */
  includeInlineImages?: boolean;
  /** Header images by writing id, from the Reader presentation; only local rasters are used. */
  chapterImages?: Record<string, { image?: string; imageLayout: string }>;
  includeTitlePage: boolean;
  /** Print a list of the chapters before the first one. Off when absent. */
  includeToc?: boolean;
  /** Heading over the chapter list. Defaults to English, like `wordLabel`. */
  tocTitle?: string;
  includeSynopsis: boolean;
  chapterLabel: string;
  /**
   * Stands in for a writing whose title is blank. Defaults to English for the
   * same reason `wordLabel` does: this module is pure, and the app passes the
   * translated one in.
   */
  untitledLabel?: string;
  wordLabel?: string;
  /** Heading over a chapter's footnotes. Defaults to English, like `wordLabel`. */
  notesLabel?: string;
  /** Marker style of the manuscript (`Project.footnoteStyle`); numbers when absent. */
  footnoteStyle?: FootnoteMarkerStyle;
  /** Where the notes go (`Project.footnotePlacement`); per chapter when absent. */
  footnotePlacement?: FootnotePlacement;
  locale?: string;
  generatedAt?: number;
  bibliographyTitle?: string;
  bibliography?: readonly string[];
}

/**
 * The heading one piece carries into every format.
 *
 * The title is trimmed and can be missing entirely, because the editor lets it
 * be: its title field is an unguarded input with a placeholder, so clearing it
 * saves an empty string, and that string used to reach the file as an empty
 * `<h1></h1>`, an empty `<title></title>`, a table-of-contents entry with
 * nothing to click, and — for a numbered chapter — a heading that read
 * "Chapter 5 — " with the em dash left hanging off the end. A named
 * placeholder is the one thing a reader can actually act on.
 */
function chapterHeading(writing: Writing, options: PublishingDocumentOptions): string {
  const title = writing.title.trim() || options.untitledLabel?.trim() || 'Untitled';
  // A kicker ("Prologue", "Interlude") is read in place of the number.
  const kicker = writing.kicker?.trim();
  if (kicker) return kicker === title ? title : `${kicker} — ${title}`;
  return writing.chapter !== undefined
    ? `${options.chapterLabel} ${writing.chapter} — ${title}`
    : title;
}

/**
 * The word count `composePublishingDocument` records for one piece — and so
 * the number the exported title page adds up. Exported so a preview can total
 * a whole selection without compiling it: one formula, one answer.
 */
export function publishingSectionWordCount(writing: Writing): number {
  if (writing.content.includes('data-wh-revision-')) return countWords(projectWritingHtml(writing.content));
  return writing.wordCount || countWords(writing.content);
}

const HEADER_RASTER = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

function headerImageFor(writing: Writing, options: PublishingDocumentOptions): { headerImage?: PublishingDocumentSection['headerImage'] } {
  const chosen = options.chapterImages?.[writing.id];
  if (!chosen?.image || !HEADER_RASTER.test(chosen.image) || chosen.image.length > 3_000_000) return {};
  const layout = chosen.imageLayout === 'beside' || chosen.imageLayout === 'banner' ? chosen.imageLayout : chosen.imageLayout === 'above' ? 'above' : null;
  if (!layout) return {};
  const kicker = writing.kicker?.trim();
  const label = kicker || (writing.chapter !== undefined ? `${options.chapterLabel} ${writing.chapter}` : undefined);
  return { headerImage: { src: chosen.image, layout, ...(layout === 'banner' && label ? { label: xmlSafeText(label) } : {}) } };
}

const INLINE_RASTER = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/** The pictures stored in the manuscript stay (with their width and frame); every other image goes and is counted. */
function keepLocalImages(html: string): { html: string; count: number } {
  const document = new DOMParser().parseFromString(html, 'text/html');
  let count = 0;
  for (const image of [...document.body.querySelectorAll('img')]) {
    const src = image.getAttribute('src') ?? '';
    if (!INLINE_RASTER.test(src) || src.length > 3_000_000) { image.remove(); count++; continue; }
    for (const attribute of [...image.attributes]) if (!['src', 'alt', 'data-wh-width', 'data-wh-frame'].includes(attribute.name)) image.removeAttribute(attribute.name);
  }
  return { html: document.body.innerHTML, count };
}

/**
 * A story email's header and a text message's sender are drawn from their
 * attributes in the editor; a compiled book writes them as text, so Word,
 * ePub and Markdown — which read no attributes — keep who wrote to whom.
 */
function materializeStoryBlocks(html: string): string {
  if (!html.includes('data-wh-email') && !html.includes('data-wh-sender')) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const email of [...document.body.querySelectorAll('div[data-wh-email]')]) {
    const from = email.getAttribute('data-wh-from') ?? '', to = email.getAttribute('data-wh-to') ?? '', subject = email.getAttribute('data-wh-subject') ?? '', date = email.getAttribute('data-wh-date') ?? '';
    if (!from && !to && !subject && !date) continue;
    const head = document.createElement('p');
    head.className = 'wh-email-head';
    const line = (text: string) => { if (head.childNodes.length) head.appendChild(document.createElement('br')); head.appendChild(document.createTextNode(text)); };
    if (from || to) line(`✉ ${from}${to ? ` → ${to}` : ''}`);
    if (subject || date) { if (head.childNodes.length) head.appendChild(document.createElement('br')); const strong = document.createElement('strong'); strong.textContent = subject; head.appendChild(strong); if (date) head.appendChild(document.createTextNode(`${subject ? ' · ' : ''}${date}`)); }
    email.prepend(head);
    email.setAttribute('data-wh-email-rendered', 'true');
  }
  for (const message of [...document.body.querySelectorAll('div[data-wh-message][data-wh-sender]')]) {
    const sender = document.createElement('p');
    sender.className = 'wh-message-sender';
    const strong = document.createElement('strong'); strong.textContent = message.getAttribute('data-wh-sender') ?? '';
    sender.appendChild(strong);
    message.prepend(sender);
    message.setAttribute('data-wh-sender-rendered', 'true');
  }
  return document.body.innerHTML;
}

function omitImages(html: string): { html: string; count: number } {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const images = [...document.body.querySelectorAll('img')];
  for (const image of images) image.remove();
  return { html: document.body.innerHTML, count: images.length };
}

/**
 * Compose titles, sanitized bodies, metadata, and bibliography exactly once.
 *
 * Every string that leaves here has been through `xmlSafeText`, so the two XML
 * writers downstream can interpolate the IR without each having to remember
 * to. `portableHtml` inherits it from `html`, which is cleaned before the
 * image pass parses it — one call, both bodies.
 */
export function composePublishingDocument(
  writings: readonly Writing[],
  options: PublishingDocumentOptions,
): PublishingDocument {
  const bookStyle = normalizeBookStyle(options.bookStyle);
  const sections = writings.map((writing) => {
    const clean = materializeStoryBlocks(xmlSafeText(sanitizeRichHtml(projectWritingHtml(writing.content))));
    const html = bookStyle ? applyBookStyle(clean, bookStyle) : clean;
    const portable = options.includeInlineImages ? keepLocalImages(html) : omitImages(html);
    // A synopsis of nothing but spaces is not a synopsis: it would print an
    // empty centred italic line above the chapter and read as a layout fault.
    const synopsis = options.includeSynopsis ? writing.synopsis?.trim() : undefined;
    return {
      id: writing.id,
      title: xmlSafeText(chapterHeading(writing, options)),
      synopsis: synopsis ? xmlSafeText(synopsis) : undefined,
      html,
      portableHtml: portable.html,
      wordCount: publishingSectionWordCount(writing),
      omittedImageCount: portable.count,
      ...headerImageFor(writing, options),
    };
  });
  return {
    identifier: options.identifier ?? `urn:writers-hoard:${encodeURIComponent(options.projectTitle)}`,
    title: xmlSafeText(options.projectTitle),
    ...(options.author?.trim() ? { author: xmlSafeText(options.author.trim().slice(0, 120)) } : {}),
    ...(options.copyright?.trim() ? { copyright: xmlSafeText(options.copyright.trim()) } : {}),
    ...(options.blurb?.text.trim() ? { blurb: { title: xmlSafeText(options.blurb.title), text: xmlSafeText(options.blurb.text.trim()) } } : {}),
    ...(bookStyle ? { bookStyle } : {}),
    locale: options.locale ?? 'en-US',
    generatedAt: options.generatedAt ?? Date.now(),
    includeTitlePage: options.includeTitlePage,
    includeToc: options.includeToc ?? false,
    tocTitle: xmlSafeText(options.tocTitle ?? 'Contents'),
    wordLabel: xmlSafeText(options.wordLabel ?? 'words'),
    notesLabel: xmlSafeText(options.notesLabel ?? 'Notes'),
    footnoteStyle: normalizeFootnoteStyle(options.footnoteStyle),
    footnotePlacement: normalizeFootnotePlacement(options.footnotePlacement),
    wordCount: sections.reduce((total, section) => total + section.wordCount, 0),
    sections,
    bibliographyTitle: options.bibliographyTitle ? xmlSafeText(options.bibliographyTitle) : undefined,
    bibliography: (options.bibliography ?? []).map((citation) => xmlSafeText(citation)),
    omittedPortableImageCount: sections.reduce((total, section) => total + section.omittedImageCount, 0),
  };
}
