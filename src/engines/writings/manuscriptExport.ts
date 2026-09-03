// ============================================
// Manuscript compile & export — Markdown / HTML / PDF
// ============================================
//
// Combines selected writings into a single manuscript. The HTML output is a
// self-contained printable document (serif, chapter page-breaks, title page)
// that doubles as the input for the desktop PDF pipeline
// (`window.electronAPI.exporter.scriptToPdf`, already used by video-planner).
//
// Downloads use the browser-native blob + <a download> pattern
// (tasks/lessons: the OS save dialog is the browser's job).

import type { Writing } from '@/types';
import { isDesktop } from '@/utils/platform';
import {
  footnoteAnchors,
  footnoteRefsOutOfCode,
  renderBookEndnotesHtml,
  renderEndnotesHtml,
  renderFootnoteRefs,
  formatFootnoteMarker,
  type EndnoteGroup,
  type ExtractedFootnote,
} from '@/components/editor/footnotes/footnoteModel';
import {
  composePublishingDocument,
  type PublishingDocument,
} from './publishingDocument';

export interface CompileOptions {
  projectTitle: string;
  includeTitlePage: boolean;
  includeSynopsis: boolean;
  /** Heading label for numbered chapters, e.g. "Capítulo" / "Chapter". */
  chapterLabel: string;
  /** Stands in for a writing whose title is blank, e.g. "Sin título". */
  untitledLabel?: string;
  /** Localized label rendered beside the title-page word count. */
  wordLabel?: string;
  /** Heading over a chapter's footnotes, e.g. "Notas" / "Notes". */
  notesLabel?: string;
  /** BCP 47 locale used for dates and numbers in the exported document. */
  locale?: string;
  /** Injectable timestamp keeps artifact tests deterministic. */
  generatedAt?: number;
}

// ---------------------------------------------------------------------------
// HTML → Markdown (minimal, tuned to Tiptap StarterKit output)
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

/** A note's body as the text after `[^n]: ` — later lines indented as Markdown continues a footnote. */
function markdownNoteText(text: string): string {
  return text.split(/\r?\n/).join('\n    ');
}

/** The `[^n]: …` definitions of some notes, one per line. */
function markdownFootnoteDefinitions(notes: readonly ExtractedFootnote[]): string {
  return notes.map((note) => `[^${note.index}]: ${markdownNoteText(note.text)}`).join('\n');
}

/**
 * One chapter's prose as Markdown, with its footnote references as `[^n]`
 * and the notes handed back separately so the caller decides where the
 * definitions go: after the chapter, or — numbered on from `start` — in one
 * list at the end of the book.
 */
export function htmlToMarkdownParts(
  html: string,
  start = 1,
): { prose: string; notes: ExtractedFootnote[] } {
  // Footnotes first, while the references are still elements: the generic
  // tag strip at the end would leave nothing of an empty <sup>. A reference
  // inside a code span is moved out of it first: `` `x[^1]` `` is code to a
  // Markdown reader, and the note would be lost.
  const footnotes = renderFootnoteRefs(footnoteRefsOutOfCode(html), (note) => `[^${note.index}]`, start);
  let s = footnotes.html.replace(/\r/g, '');

  // Inline marks first (so block regexes see clean text)
  s = s.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gis, '**$2**');
  s = s.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gis, '*$2*');
  s = s.replace(/<code[^>]*>(.*?)<\/code>/gis, '`$1`');
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, '[$2]($1)');
  s = s.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Headings
  s = s.replace(/<h1[^>]*>(.*?)<\/h1>/gis, '\n\n# $1\n\n');
  s = s.replace(/<h2[^>]*>(.*?)<\/h2>/gis, '\n\n## $1\n\n');
  s = s.replace(/<h3[^>]*>(.*?)<\/h3>/gis, '\n\n### $1\n\n');
  s = s.replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gis, '\n\n#### $1\n\n');

  // Blockquotes (Tiptap: <blockquote><p>…</p></blockquote>)
  s = s.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_m, inner: string) => {
    const text = inner.replace(/<p[^>]*>(.*?)<\/p>/gis, '$1\n');
    return (
      '\n\n' +
      text
        .split('\n')
        .filter((l: string) => l.trim())
        .map((l: string) => `> ${l.trim()}`)
        .join('\n') +
      '\n\n'
    );
  });

  // Lists — ordered get "1." (Markdown renderers auto-increment)
  s = s.replace(/<ol[^>]*>(.*?)<\/ol>/gis, (_m, inner: string) => {
    return '\n\n' + inner.replace(/<li[^>]*>(.*?)<\/li>/gis, (_m2, item: string) => `1. ${item.replace(/<\/?p[^>]*>/gi, '').trim()}\n`) + '\n';
  });
  s = s.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (_m, inner: string) => {
    return '\n\n' + inner.replace(/<li[^>]*>(.*?)<\/li>/gis, (_m2, item: string) => `- ${item.replace(/<\/?p[^>]*>/gi, '').trim()}\n`) + '\n';
  });

  // Scene / POV breaks — the editor's `---` input rule persists an <hr>.
  s = s.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n');

  // Paragraphs & line breaks
  s = s.replace(/<br\s*\/?>/gi, '  \n');
  s = s.replace(/<p[^>]*>(.*?)<\/p>/gis, '\n\n$1\n\n');

  // Anything left
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { prose: s, notes: footnotes.notes };
}

/**
 * One chapter as Markdown. The numbers restart with the call, and the notes
 * are listed after the prose the way Markdown footnotes are.
 */
export function htmlToMarkdown(html: string): string {
  const { prose, notes } = htmlToMarkdownParts(html);
  return notes.length > 0 ? `${prose}\n\n${markdownFootnoteDefinitions(notes)}` : prose;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildManuscriptMarkdown(writings: Writing[], opts: CompileOptions): string {
  return renderPublishingMarkdown(composePublishingDocument(writings, opts));
}

/**
 * The anchor a Markdown renderer gives a heading, GitHub's way: lower case,
 * punctuation dropped, spaces to hyphens, a numeric suffix on a repeat. Most
 * renderers (GitHub, GitLab, pandoc near enough) agree on it, and it needs
 * no inline HTML in the file, which some of them strip.
 */
function markdownHeadingSlug(title: string, taken: Map<string, number>): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/ /g, '-');
  const seen = taken.get(base) ?? 0;
  taken.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

export function renderPublishingMarkdown(document: PublishingDocument): string {
  const parts: string[] = [];
  if (document.includeTitlePage) {
    const date = new Date(document.generatedAt).toLocaleDateString(document.locale);
    parts.push(`# ${escapeHtml(document.title)}\n\n*${document.wordCount.toLocaleString(document.locale)} ${escapeHtml(document.wordLabel)} · ${escapeHtml(date)}*\n\n---`);
  }
  if (document.includeToc && document.sections.length > 0) {
    const slugs = new Map<string, number>();
    const entries = document.sections.map(
      (section) => `- [${escapeHtml(section.title)}](#${markdownHeadingSlug(section.title, slugs)})`,
    );
    parts.push(`\n\n## ${escapeHtml(document.tocTitle)}\n\n${entries.join('\n')}\n\n---`);
  }
  // The labels count on through the whole file whatever the placement:
  // Markdown footnote labels are per file, so two chapters both defining
  // `[^1]` would be one definition lost — and a chapter's `[^1]` would point
  // at the first chapter's note. Per chapter the definitions still follow
  // their chapter; at the end of the book they gather under one heading.
  const bookNotes = document.footnotePlacement === 'book';
  const endnotes: EndnoteGroup[] = [];
  let nextNumber = 1;
  for (const section of document.sections) {
    parts.push(`\n\n## ${escapeHtml(section.title)}\n`);
    if (section.synopsis) parts.push(`*${escapeHtml(section.synopsis)}*\n`);
    const { prose, notes } = htmlToMarkdownParts(section.html, nextNumber);
    nextNumber += notes.length;
    if (bookNotes) {
      endnotes.push({ title: section.title, notes });
      parts.push(prose);
    } else {
      parts.push(notes.length > 0 ? `${prose}\n\n${markdownFootnoteDefinitions(notes)}` : prose);
    }
    parts.push('\n\n---');
  }
  if (bookNotes && endnotes.some((group) => group.notes.length > 0)) {
    parts.push(`\n\n# ${escapeHtml(document.notesLabel)}\n`);
    for (const group of endnotes) {
      if (group.notes.length === 0) continue;
      parts.push(`\n## ${escapeHtml(group.title)}\n\n${markdownFootnoteDefinitions(group.notes)}\n`);
    }
  }
  if (document.bibliography.length > 0 && document.bibliographyTitle) {
    parts.push(`\n\n# ${escapeHtml(document.bibliographyTitle)}\n`);
    for (const citation of document.bibliography) parts.push(`\n${escapeHtml(citation)}\n`);
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function buildManuscriptHtml(writings: Writing[], opts: CompileOptions): string {
  return renderPublishingHtml(composePublishingDocument(writings, opts));
}

/** The fragment id of the n-th chapter's heading (1-based), for the contents list. */
export function chapterAnchorId(n: number): string {
  return `ch-${n}`;
}

export function renderPublishingHtml(document: PublishingDocument): string {
  const date = new Date(document.generatedAt).toLocaleDateString(document.locale);
  // Numbers written into the file rather than left to a CSS counter: a mail
  // client or a PDF viewer's text layer has no counters. Per chapter they
  // restart and the notes follow the chapter they belong to; at the end of
  // the book they count on, and every chapter's notes wait for the section
  // after the last one. The ids and links are the same either way, and each
  // carries the chapter's number: two chapters can hold a note with one id.
  const bookNotes = document.footnotePlacement === 'book';
  const bookGroups: EndnoteGroup[] = [];
  let nextNumber = 1;
  const chapters = document.sections
    .map((section, at) => {
      const scope = at + 1;
      const footnotes = renderFootnoteRefs(section.html, (note) => {
        const anchors = footnoteAnchors(note.id, scope);
        const marker = escapeHtml(formatFootnoteMarker(note.index, document.footnoteStyle));
        return `<sup class="wh-footnote-ref" id="${escapeHtml(anchors.ref)}"><a href="#${escapeHtml(anchors.note)}">${marker}</a></sup>`;
      }, bookNotes ? nextNumber : 1);
      let endnotes = '';
      if (bookNotes) {
        nextNumber += footnotes.notes.length;
        bookGroups.push({ title: section.title, notes: footnotes.notes, scope });
      } else {
        endnotes = renderEndnotesHtml(footnotes.notes, {
          heading: document.notesLabel,
          style: document.footnoteStyle,
          scope,
        });
      }
      return `
    <section class="chapter">
      <h1 class="chapter-title" id="${chapterAnchorId(scope)}">${escapeHtml(section.title)}</h1>
      ${section.synopsis ? `<p class="synopsis">${escapeHtml(section.synopsis)}</p>` : ''}
      <div class="content">${footnotes.html}</div>
      ${endnotes}
    </section>`;
    })
    .join('\n');
  const toc = document.includeToc && document.sections.length > 0
    ? `<nav class="wh-toc"><h2>${escapeHtml(document.tocTitle)}</h2><ol>${document.sections
      .map((section, at) => `<li><a href="#${chapterAnchorId(at + 1)}">${escapeHtml(section.title)}</a></li>`)
      .join('')}</ol></nav>`
    : '';
  const bookEndnotes = bookNotes
    ? renderBookEndnotesHtml(bookGroups, { heading: document.notesLabel, style: document.footnoteStyle })
    : '';
  const bibliography = document.bibliography.length > 0 && document.bibliographyTitle
    ? `<section class="chapter bibliography"><h1 class="chapter-title">${escapeHtml(document.bibliographyTitle)}</h1>${document.bibliography.map(citation => `<p>${escapeHtml(citation)}</p>`).join('')}</section>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(document.title)}</title>
<style>
  @page { margin: 2.2cm 2cm; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 12pt;
    line-height: 1.65;
    color: #1a1a1a;
    max-width: 42em;
    margin: 0 auto;
    padding: 1em;
  }
  .title-page {
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    min-height: 80vh; text-align: center; page-break-after: always;
  }
  .title-page h1 { font-size: 26pt; letter-spacing: 0.04em; margin-bottom: 0.4em; }
  .title-page .meta { color: #666; font-style: italic; }
  .wh-toc { page-break-after: always; }
  .wh-toc h2 { font-size: 17pt; margin: 1.4em 0 1em; text-align: center; }
  .wh-toc ol { padding-left: 1.6em; }
  .wh-toc li { margin: 0 0 0.4em; }
  .wh-toc a { color: #1a1a1a; text-decoration: none; }
  .chapter { page-break-before: always; }
  .chapter:first-of-type { page-break-before: auto; }
  .chapter-title { font-size: 17pt; margin: 1.4em 0 1em; text-align: center; }
  .synopsis { font-style: italic; color: #555; text-align: center; margin-bottom: 2em; }
  .content p { margin: 0 0 0.15em; text-indent: 1.6em; }
  .content p:first-of-type { text-indent: 0; }
  .content h2 { font-size: 14pt; margin: 1.4em 0 0.6em; }
  .content blockquote { margin: 1em 2em; font-style: italic; color: #444; }
  .content img { max-width: 100%; }
  .content a { color: #1a1a1a; }
  .wh-footnote-ref { font-size: 0.7em; line-height: 1; vertical-align: super; }
  .wh-footnote-ref a { color: #1a1a1a; text-decoration: none; }
  .wh-endnotes ol.wh-endnotes-marked { list-style: none; padding-left: 0; }
  .wh-endnote-marker { display: inline-block; min-width: 1.4em; font-weight: 600; }
  .wh-endnotes { margin-top: 2em; padding-top: 0.6em; border-top: 1px solid #bbb; font-size: 10pt; color: #333; }
  .wh-endnotes h2 { font-size: 9pt; letter-spacing: 0.08em; text-transform: uppercase; color: #666; margin: 0 0 0.6em; }
  .wh-endnotes ol { padding-left: 1.6em; margin: 0; }
  .wh-endnotes--book { page-break-before: always; border-top: 0; margin-top: 0; padding-top: 0; font-size: 11pt; }
  .wh-endnotes--book h1 { font-size: 17pt; margin: 1.4em 0 1em; text-align: center; color: #1a1a1a; }
  .wh-endnotes--book h2 { font-size: 11pt; letter-spacing: 0; text-transform: none; color: #1a1a1a; margin: 1.4em 0 0.5em; }
  .wh-endnotes--book ol { margin-bottom: 0.6em; }
  .wh-endnotes li { margin: 0 0 0.3em; }
  .wh-endnote-back { color: #666; text-decoration: none; margin-left: 0.3em; }
  @media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
  ${
    document.includeTitlePage
      ? `<div class="title-page">
    <h1>${escapeHtml(document.title)}</h1>
    <p class="meta">${document.wordCount.toLocaleString(document.locale)} ${escapeHtml(document.wordLabel)} · ${escapeHtml(date)}</p>
  </div>`
      : ''
  }
  ${toc}
  ${chapters}
  ${bookEndnotes}
  ${bibliography}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Download / export entry points
// ---------------------------------------------------------------------------

export function downloadTextFile(text: string, filename: string, mime: string): void {
  downloadBlobFile(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function downloadBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\wÀ-ɏ -]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'manuscrito';
}

/** True when the native PDF pipeline is available (desktop shell). */
export function canExportPdf(): boolean {
  return isDesktop() && !!window.electronAPI?.exporter?.scriptToPdf;
}

/** Render the manuscript HTML to a real PDF via the Electron main process. */
export async function exportManuscriptPdf(
  writings: Writing[],
  opts: CompileOptions,
): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  if (!canExportPdf()) return { ok: false, error: 'PDF export requires the desktop app' };
  const html = buildManuscriptHtml(writings, opts);
  return exportHtmlPdf(html, `${sanitizeFilename(opts.projectTitle)}.pdf`);
}

/** Send an already-composed HTML artifact to the native PDF pipeline. */
export async function exportHtmlPdf(
  html: string,
  filename: string,
): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  if (!canExportPdf()) return { ok: false, error: 'PDF export requires the desktop app' };
  return window.electronAPI!.exporter.scriptToPdf(html, filename);
}
