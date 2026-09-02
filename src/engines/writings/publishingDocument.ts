import type { FootnoteMarkerStyle, FootnotePlacement, Writing } from '@/types';
import {
  normalizeFootnotePlacement,
  normalizeFootnoteStyle,
} from '@/components/editor/footnotes/footnoteModel';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { countWords } from '@/utils/text';

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
}

export interface PublishingDocument {
  identifier: string;
  title: string;
  locale: string;
  generatedAt: number;
  includeTitlePage: boolean;
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
  includeTitlePage: boolean;
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
  return writing.wordCount || countWords(writing.content);
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
  const sections = writings.map((writing) => {
    const html = xmlSafeText(sanitizeRichHtml(writing.content));
    const portable = omitImages(html);
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
    };
  });
  return {
    identifier: options.identifier ?? `urn:writers-hoard:${encodeURIComponent(options.projectTitle)}`,
    title: xmlSafeText(options.projectTitle),
    locale: options.locale ?? 'en-US',
    generatedAt: options.generatedAt ?? Date.now(),
    includeTitlePage: options.includeTitlePage,
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
