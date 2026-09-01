// ============================================
// One chapter out of the book — export without a publishing profile
// ============================================
//
// The publishing studio compiles a BOOK. Everything it asks for — a profile
// name, a format, a title page, synopses, a citation style, a selection and an
// order — is a question about a manuscript, and every one of them is worth
// asking once for the thing a writer sends to an agent.
//
// It is not what a writer does most days. Most days they send ONE chapter to a
// beta reader or a workshop, and until now that meant opening the studio,
// naming a throwaway profile, unticking every other chapter and exporting the
// book minus the rest of the book. `WritingsView` even carried a fifteen-line
// fake `PublishingProfile` whose every field was a lie, invented purely to get
// past the studio's front door with a single chapter in hand.
//
// So this module answers the profile's questions ONCE, here, in prose, and
// then never asks them again (see `CHAPTER_EXPORT_DEFAULTS`). What it does not
// do is build a second document: the IR it hands out is the same
// `PublishingDocument` the studio composes, from the same
// `composePublishingDocument`, and it goes to the same DOCX and ePub writers.
// A chapter exported from here and the same chapter exported from the studio
// are the same bytes but for the answers below — which is the only property
// that makes it safe to have two doors into one file format.
//
// It deliberately does NOT go through `buildPublishingArtifacts`: that
// function's entire signature is a project and a profile, and the profile
// would have to be invented. Its bibliography plumbing, its `profile.name`
// filename stem and its `"${project} — ${profile}"` document title would all
// be overridden on the way past. `composePublishingDocument` is the composer;
// `buildPublishingArtifacts` is the profile adapter, and this path has no
// profile to adapt.
//
// The selection is a LIST rather than a single id because the same assembly
// serves "chapters 3 to 5, for Thursday's workshop" at no extra cost. The
// chapter menu asks for one; nothing here assumes it.

import type { Writing } from '@/types';
import { stripHtml } from '@/utils/text';
import { compareManuscriptOrder, numberedInOrder } from './chapterOrder';
import {
  downloadBlobFile,
  downloadTextFile,
  renderPublishingMarkdown,
  sanitizeFilename,
} from './manuscriptExport';
import { composePublishingDocument, type PublishingDocument } from './publishingDocument';

/**
 * What a chapter can leave as.
 *
 * Narrower than the studio's five on purpose. DOCX is what a beta reader
 * marks up and mails back, ePub is what they read on the sofa, and Markdown is
 * what a workshop pastes into a thread. HTML is the PDF pipeline's input
 * rather than a thing anyone is sent, and PDF is the format you choose when
 * you do NOT want the reader editing — the opposite of why a chapter goes out
 * early — besides being desktop-only, which would put a conditional in a
 * three-button menu. The studio still exports all five for the writer who
 * wants one.
 */
export type ChapterExportOutput = 'docx' | 'epub' | 'markdown';

/**
 * The three questions the publishing profile asks that a lone chapter must
 * answer for itself, answered once.
 *
 * TITLE PAGE — off. The studio's title page prints the book's title over the
 * SELECTION's word count and today's date; on one chapter that is a cover
 * sheet claiming the manuscript is four thousand words long, which is a lie
 * the writer did not tell and the reader cannot check. It is also a page to
 * scroll past before the prose, and the chapter's own heading already says
 * "Chapter 7 — The Drowned Chapel" while the file's name and its `dc:title`
 * carry the book. Nothing is lost by leaving it out and one false claim is
 * avoided. It has a second, quieter effect worth keeping: with no title page
 * the DOCX writer's `pageBreakBefore` stays off for the first section, so the
 * file opens on page one instead of on a blank.
 *
 * SYNOPSES — off. The argument for turning them ON is real: a chapter arriving
 * alone has no chapters before it, and the synopsis is the one line the writer
 * has already written that says where the reader is. It loses to what a
 * synopsis in this app actually IS — a planning line shown on the card in the
 * list, never in the manuscript — and to what it usually says: "Marta finds
 * the body" above the chapter that reveals it hands a beta reader the ending
 * in italics. The whole-book compile makes the same call, so a chapter and the
 * book it came from read the same way.
 *
 * BIBLIOGRAPHY — off, and expressed by handing the composer no citations at
 * all rather than by a flag, because there is nothing to gate. Citations are
 * stored per PROJECT: `getCitations(projectId)` returns everything the book has
 * ever cited, and `Citation.writingIds` — the one field that could narrow that
 * to this chapter — is written empty by both of its call sites, so today there
 * is no way to tell a chapter's sources from its book's. Attaching all forty
 * would tell a reader the chapter cites works it never mentions; attaching
 * none says nothing false. A writer who wants the real reference list still
 * has the studio and `exportBibliography`.
 */
export const CHAPTER_EXPORT_DEFAULTS = {
  includeTitlePage: false,
  includeSynopsis: false,
  includeBibliography: false,
} as const;

export interface ChapterExportOptions {
  /**
   * The book's title. Names the document always, and the file only when a
   * multi-chapter selection needs something to hang its numbers off.
   */
  projectTitle: string;
  /** Heading label for numbered chapters, e.g. "Capítulo" / "Chapter". */
  chapterLabel: string;
  /** Stands in for a writing whose title is blank, e.g. "Sin título". */
  untitledLabel: string;
  /**
   * Localized label beside a title-page word count. No title page prints one
   * today, but it is part of the IR, and the composer's own default is the
   * English word — which is exactly how an English string ends up inside a
   * Spanish document the day somebody turns the page back on.
   */
  wordLabel: string;
  /** BCP 47 locale. Reaches the ePub as `xml:lang` and `dc:language`. */
  locale: string;
  /**
   * Digits to pad a chapter number to in the file name — see
   * `chapterNumberWidth`, which measures it against the whole book. Left out,
   * the selection measures itself, which is right for a caller that has no
   * book to hand and wrong for a folder that fills up one chapter at a time.
   */
  numberWidth?: number;
  /** Injectable timestamp keeps artifact tests deterministic. */
  generatedAt?: number;
}

export interface ChapterExportSelection {
  /** The pieces to export, in the order the manuscript reads them. */
  writings: Writing[];
  /** Ids the project no longer holds — a chapter deleted under the menu. */
  missingIds: string[];
  /** Linked Google Docs with no local copy. The file would be blank. */
  googleDocsWithoutContent: Writing[];
  /**
   * Pieces with no prose in them. Advisory, never fatal: exporting an empty
   * chapter is a mistake worth a question, not a thing to refuse, and a writer
   * who answers the question is sending a placeholder on purpose.
   */
  emptyWritings: Writing[];
}

export interface ChapterExportNaming {
  /** What an e-reader shelves the file under and Word puts in its title bar. */
  documentTitle: string;
  /** The file's name without its extension. Already safe. */
  filenameStem: string;
}

export interface ChapterExportArtifacts extends ChapterExportNaming {
  document: PublishingDocument;
  markdown: string;
  markdownFilename: string;
  docxFilename: string;
  epubFilename: string;
}

export type ChapterExportFailure =
  | 'no-writings'
  | 'google-docs-without-content'
  | 'export-failed';

export interface ChapterExportResult {
  ok: boolean;
  reason?: ChapterExportFailure;
  error?: string;
  /** The name the file was actually written under, for the confirmation. */
  filename?: string;
  omittedImageCount?: number;
  googleDocsWithoutContent: Array<{ id: string; title: string }>;
}

function hasNoProse(writing: Writing): boolean {
  return !stripHtml(writing.content).trim();
}

/**
 * The chosen pieces, in manuscript order, with what would spoil the export.
 *
 * The order is `compareManuscriptOrder` rather than the order the ids arrived
 * in, for the same reason `defaultPublishingOrder` delegates to it: a reader
 * sent chapters 3, 7 and 12 expects to read them in that order whatever order
 * they were ticked in, and an export that disagrees with the list is an export
 * whose chapters are in the wrong place in a file the writer has already sent.
 *
 * Total, like the rest of this path: unknown ids, duplicates and an empty
 * request all produce an empty or shorter selection rather than an exception.
 */
export function selectChapterExport(
  allWritings: readonly Writing[],
  ids: readonly string[],
): ChapterExportSelection {
  const wanted = new Set(ids);
  // Filtering the project's rows, rather than mapping the ids, is what makes
  // a repeated id impossible to export twice.
  const writings = allWritings
    .filter(writing => wanted.has(writing.id))
    .sort(compareManuscriptOrder);
  const found = new Set(writings.map(writing => writing.id));
  return {
    writings,
    missingIds: [...wanted].filter(id => !found.has(id)),
    googleDocsWithoutContent: writings.filter(
      writing => Boolean(writing.isGoogleDoc) && hasNoProse(writing),
    ),
    emptyWritings: writings.filter(writing => !writing.isGoogleDoc && hasNoProse(writing)),
  };
}

/**
 * Digits the widest chapter number in this BOOK needs, never fewer than two.
 *
 * Measured against the whole manuscript rather than the selection, because the
 * point of the padding is a folder: Finder and Explorer sort file names
 * byte-wise, so `1, 10, 2` is what a writer gets back when they export their
 * chapters one at a time over a month. Deriving the width from the book means
 * chapter 7 exported today and chapter 112 exported next spring still line up
 * in the same folder — a width taken from each selection would give `07` one
 * day and `7` the next.
 */
export function chapterNumberWidth(allWritings: readonly Writing[]): number {
  const highest = numberedInOrder(allWritings).at(-1)?.chapter ?? 0;
  return Math.max(2, String(highest).length);
}

/**
 * What the file is called, and what it calls itself.
 *
 * A file lands in someone else's mailbox, and the two things it has to survive
 * there are being FOUND and being SORTED. `Chapter.docx` and `Untitled.docx`
 * fail the first; an unpadded number fails the second. So one chapter is named
 * for the number and the title it already has — `07 The Drowned Chapel.docx` —
 * which reads as a chapter, sorts as a chapter, and needs no covering email to
 * explain it.
 *
 * A hand-picked selection is named for the book and every number in it,
 * `Wolves of Aral 03-07-12.docx`, and not for its first and last: `03-12`
 * would promise ten chapters and deliver three. Very long selections lose
 * their tail to `sanitizeFilename`'s 80-character slice, which is the right
 * trade — the file stays identifiable, and this is a door for a handful of
 * chapters, not for the book.
 *
 * The document title names the book FIRST in both cases, because that is what
 * an e-reader shelves and what Word shows: two chapters of one novel must not
 * arrive as two identically-named entries, and neither must they arrive with
 * no sign of which novel they came from.
 *
 * Everything returned as a file name has been through `sanitizeFilename`, so
 * there is no path out of this module that produces an unsafe one — a chapter
 * called `../../etc/hosts` or `Chapter 7: "Hola"` becomes something a
 * filesystem will take, and a chapter whose title is nothing but punctuation
 * still lands under that function's own fallback rather than as `.docx`.
 */
export function chapterExportNaming(
  pieces: readonly Writing[],
  options: { projectTitle: string; untitledLabel: string; numberWidth: number },
): ChapterExportNaming {
  // The composer's own fallback chain, repeated deliberately: the title field
  // is an unguarded input, so clearing it saves an empty string, and an empty
  // string is neither a file name nor the right half of a document title —
  // `Wolves of Aral — ` is the hanging em dash `chapterHeading` was taught to
  // avoid, arriving by another door.
  const label = (writing: Writing) =>
    writing.title.trim() || options.untitledLabel.trim() || 'Untitled';
  const padded = (chapter: number) => String(chapter).padStart(options.numberWidth, '0');

  if (pieces.length === 1) {
    const [only] = pieces;
    const title = label(only);
    return {
      documentTitle: `${options.projectTitle} — ${title}`,
      // An unnumbered piece keeps its bare title: an idea with no chapter
      // number is not chapter zero, and `00 ` in front of it would say it was.
      filenameStem: sanitizeFilename(
        only.chapter === undefined ? title : `${padded(only.chapter)} ${title}`,
      ),
    };
  }

  const numbers = numberedInOrder(pieces).map(row => padded(row.chapter));
  return {
    documentTitle: numbers.length
      ? `${options.projectTitle} — ${numbers.join(', ')}`
      : options.projectTitle,
    filenameStem: sanitizeFilename(
      numbers.length ? `${options.projectTitle} ${numbers.join('-')}` : options.projectTitle,
    ),
  };
}

/**
 * The chapter as the same IR the studio compiles, plus the names it travels
 * under. Pure — nothing here touches Dexie, the DOM's download path or a
 * format writer, which is what lets the whole naming and defaults story be
 * tested without producing a file.
 */
export function buildChapterExport(
  pieces: readonly Writing[],
  options: ChapterExportOptions,
): ChapterExportArtifacts {
  const naming = chapterExportNaming(pieces, {
    projectTitle: options.projectTitle,
    untitledLabel: options.untitledLabel,
    numberWidth: options.numberWidth ?? chapterNumberWidth(pieces),
  });
  const document = composePublishingDocument(pieces, {
    // Built from ids, not from the title: an e-reader keys its library on
    // this, so re-sending a chapter the writer has since renamed has to
    // REPLACE the old one on the reader's device rather than sit beside it.
    identifier: `urn:writers-hoard:${encodeURIComponent(pieces[0]?.projectId ?? '')}:chapters:${
      pieces.map(piece => encodeURIComponent(piece.id)).join('+')
    }`,
    projectTitle: naming.documentTitle,
    includeTitlePage: CHAPTER_EXPORT_DEFAULTS.includeTitlePage,
    includeSynopsis: CHAPTER_EXPORT_DEFAULTS.includeSynopsis,
    chapterLabel: options.chapterLabel,
    untitledLabel: options.untitledLabel,
    wordLabel: options.wordLabel,
    locale: options.locale,
    generatedAt: options.generatedAt,
  });
  return {
    ...naming,
    document,
    markdown: renderPublishingMarkdown(document),
    markdownFilename: `${naming.filenameStem}.md`,
    docxFilename: `${naming.filenameStem}.docx`,
    epubFilename: `${naming.filenameStem}.epub`,
  };
}

/**
 * Compile the chosen chapters and write the file.
 *
 * The one thing it refuses is a linked Google Doc with no local copy, which is
 * the studio's rule too: the app exports the cached text, so a doc that has
 * never been synced would leave as a chapter-shaped file with nothing in it,
 * and the writer would find out from the reader. An empty LOCAL chapter is not
 * refused — `selectChapterExport` reports it and the view asks — because that
 * one is a decision, not a missing prerequisite.
 *
 * `docx` and `jszip` arrive through dynamic imports, exactly as
 * `exportPublishingProfile` pulls them: neither belongs in the bundle a writer
 * loads to open a chapter.
 */
export async function exportChapter(
  allWritings: readonly Writing[],
  ids: readonly string[],
  output: ChapterExportOutput,
  options: ChapterExportOptions,
): Promise<ChapterExportResult> {
  const selection = selectChapterExport(allWritings, ids);
  const blocked = {
    googleDocsWithoutContent: selection.googleDocsWithoutContent.map(({ id, title }) => ({ id, title })),
  };
  if (selection.writings.length === 0) return { ok: false, reason: 'no-writings', ...blocked };
  if (selection.googleDocsWithoutContent.length > 0) {
    return { ok: false, reason: 'google-docs-without-content', ...blocked };
  }

  // The width comes from the whole project, not from the handful being sent,
  // so a folder filled one chapter at a time still sorts.
  const artifacts = buildChapterExport(selection.writings, {
    ...options,
    numberWidth: options.numberWidth ?? chapterNumberWidth(allWritings),
  });
  try {
    if (output === 'markdown') {
      downloadTextFile(artifacts.markdown, artifacts.markdownFilename, 'text/markdown');
      return { ok: true, filename: artifacts.markdownFilename, ...blocked };
    }
    if (output === 'docx') {
      const { buildPublishingDocx } = await import('./publishingDocx');
      downloadBlobFile(await buildPublishingDocx(artifacts.document), artifacts.docxFilename);
      return {
        ok: true,
        filename: artifacts.docxFilename,
        omittedImageCount: artifacts.document.omittedPortableImageCount,
        ...blocked,
      };
    }
    const { buildPublishingEpub } = await import('./publishingEpub');
    downloadBlobFile(await buildPublishingEpub(artifacts.document), artifacts.epubFilename);
    return {
      ok: true,
      filename: artifacts.epubFilename,
      omittedImageCount: artifacts.document.omittedPortableImageCount,
      ...blocked,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'export-failed',
      error: error instanceof Error ? error.message : String(error),
      ...blocked,
    };
  }
}
